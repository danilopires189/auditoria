-- Migration V451: Conservadoras - Filter by transportadora, global transportadoras, and status filter support
-- 1. Only show routes with transportadora vinculated in documentation status lists
-- 2. Make transportadoras global (shared across all CDs)
-- 3. Add support for status filter in frontend

-- Step 1: Make transportadoras global
-- Remove CD-specific constraint and add global unique constraint on nome_norm
alter table app.conservadora_transportadoras drop constraint if exists uq_conservadora_transportadoras_cd_nome;

-- Add global constraint if not exists
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'uq_conservadora_transportadoras_nome'
    ) then
        alter table app.conservadora_transportadoras add constraint uq_conservadora_transportadoras_nome unique (nome_norm);
    end if;
end $$;

-- Remove CD index and add global index
drop index if exists app.idx_conservadora_transportadoras_cd_ativo;
create index if not exists idx_conservadora_transportadoras_ativo on app.conservadora_transportadoras (ativo, nome);

-- Step 2: Update transportadoras list RPC to return global transportadoras
drop function if exists public.rpc_conservadora_transportadoras_list(integer);
create or replace function public.rpc_conservadora_transportadoras_list(
    p_cd integer default null
)
returns table (
    id uuid,
    cd integer,
    nome text,
    ativo boolean,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
begin
    v_cd := app.conservadora_resolve_cd(p_cd);

    return query
    select
        t.id,
        t.cd,
        t.nome,
        t.ativo,
        t.created_at,
        t.updated_at
    from app.conservadora_transportadoras t
    order by
        t.ativo desc,
        upper(t.nome),
        t.created_at desc;
end;
$$;

-- Step 3: Update transportadora upsert to work globally
drop function if exists public.rpc_conservadora_transportadora_upsert(uuid, integer, text);
create or replace function public.rpc_conservadora_transportadora_upsert(
    p_transportadora_id uuid default null,
    p_cd integer default null,
    p_nome text default null
)
returns table (
    id uuid,
    cd integer,
    nome text,
    ativo boolean,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_nome text;
    v_nome_norm text;
    v_now timestamptz := now();
    v_mat text;
    v_nome_usuario text;
begin
    v_uid := auth.uid();
    v_cd := app.conservadora_resolve_cd(p_cd);

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    v_nome := nullif(trim(coalesce(p_nome, '')), '');
    if v_nome is null then
        raise exception 'TRANSPORTADORA_NOME_OBRIGATORIO';
    end if;
    v_nome_norm := app.conservadora_norm_text(v_nome);
    v_mat := coalesce(nullif(trim((select p.mat from authz.profiles p where p.user_id = v_uid limit 1)), ''), '-');
    v_nome_usuario := coalesce(nullif(trim((select p.nome from authz.profiles p where p.user_id = v_uid limit 1)), ''), 'Usuário');

    -- Check for duplicate globally (not per CD)
    if exists (
        select 1
        from app.conservadora_transportadoras t
        where t.nome_norm = v_nome_norm
          and (p_transportadora_id is null or t.id <> p_transportadora_id)
    ) then
        raise exception 'TRANSPORTADORA_JA_CADASTRADA';
    end if;

    if p_transportadora_id is null then
        insert into app.conservadora_transportadoras (
            cd,
            nome,
            nome_norm,
            ativo,
            created_at,
            created_by,
            created_mat,
            created_nome,
            updated_at,
            updated_by,
            updated_mat,
            updated_nome
        )
        values (
            v_cd,
            v_nome,
            v_nome_norm,
            true,
            v_now,
            v_uid,
            v_mat,
            v_nome_usuario,
            v_now,
            v_uid,
            v_mat,
            v_nome_usuario
        );
    else
        update app.conservadora_transportadoras t
        set nome = v_nome,
            nome_norm = v_nome_norm,
            updated_at = v_now,
            updated_by = v_uid,
            updated_mat = v_mat,
            updated_nome = v_nome_usuario
        where t.id = p_transportadora_id;

        if not found then
            raise exception 'TRANSPORTADORA_NAO_ENCONTRADA';
        end if;
    end if;

    return query
    select
        t.id,
        t.cd,
        t.nome,
        t.ativo,
        t.created_at,
        t.updated_at
    from app.conservadora_transportadoras t
    where t.nome_norm = v_nome_norm
    limit 1;
end;
$$;

-- Step 4: Update transportadora inativar to work globally
drop function if exists public.rpc_conservadora_transportadora_inativar(integer, uuid);
create or replace function public.rpc_conservadora_transportadora_inativar(
    p_cd integer default null,
    p_transportadora_id uuid default null
)
returns table (
    id uuid,
    ativo boolean,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_now timestamptz := now();
    v_mat text;
    v_nome_usuario text;
begin
    v_uid := auth.uid();
    v_cd := app.conservadora_resolve_cd(p_cd);

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;
    if p_transportadora_id is null then
        raise exception 'TRANSPORTADORA_OBRIGATORIA';
    end if;

    v_mat := coalesce(nullif(trim((select p.mat from authz.profiles p where p.user_id = v_uid limit 1)), ''), '-');
    v_nome_usuario := coalesce(nullif(trim((select p.nome from authz.profiles p where p.user_id = v_uid limit 1)), ''), 'Usuário');

    update app.conservadora_transportadoras t
    set ativo = false,
        updated_at = v_now,
        updated_by = v_uid,
        updated_mat = v_mat,
        updated_nome = v_nome_usuario
    where t.id = p_transportadora_id
    returning t.id, t.ativo, t.updated_at
    into id, ativo, updated_at;

    if id is null then
        raise exception 'TRANSPORTADORA_NAO_ENCONTRADA';
    end if;

    return next;
end;
$$;

-- Step 5: Update cards list to only show transportadora-vinculated routes for documentation statuses
drop function if exists public.rpc_conservadora_cards_list(integer, text, text);
create or replace function public.rpc_conservadora_cards_list(
    p_cd integer default null,
    p_status text default null,
    p_search text default null
)
returns table (
    embarque_key text,
    cd integer,
    rota text,
    placa text,
    seq_ped text,
    dt_ped timestamptz,
    dt_lib timestamptz,
    encerramento timestamptz,
    event_at timestamptz,
    responsavel_mat text,
    responsavel_nome text,
    transportadora_id uuid,
    transportadora_nome text,
    transportadora_ativa boolean,
    document_confirmed_at timestamptz,
    document_confirmed_mat text,
    document_confirmed_nome text,
    next_embarque_at timestamptz,
    status text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_status text;
    v_search text;
begin
    v_cd := app.conservadora_resolve_cd(p_cd);
    v_status := lower(trim(coalesce(p_status, '')));
    v_search := upper(trim(coalesce(p_search, '')));

    if v_status not in ('em_transito', 'aguardando_documento', 'documentacao_em_atraso', 'documentacao_recebida') then
        v_status := '';
    end if;

    return query
    select
        b.embarque_key,
        b.cd,
        b.rota,
        b.placa,
        b.seq_ped,
        b.dt_ped,
        b.dt_lib,
        b.encerramento,
        b.event_at,
        b.responsavel_mat,
        b.responsavel_nome,
        b.transportadora_id,
        b.transportadora_nome,
        b.transportadora_ativa,
        b.document_confirmed_at,
        b.document_confirmed_mat,
        b.document_confirmed_nome,
        b.next_embarque_at,
        b.status
    from app.conservadora_embarques_base(v_cd) b
    where (v_status = '' or b.status = v_status)
      -- Only show transportadora-vinculated routes for documentation statuses
      and (
        b.status = 'em_transito'
        or b.transportadora_id is not null
      )
      and (
        v_search = ''
        or upper(coalesce(b.rota, '')) like '%' || v_search || '%'
        or upper(coalesce(b.placa, '')) like '%' || v_search || '%'
        or upper(coalesce(b.seq_ped, '')) like '%' || v_search || '%'
        or upper(coalesce(b.transportadora_nome, '')) like '%' || v_search || '%'
        or upper(coalesce(b.responsavel_nome, '')) like '%' || v_search || '%'
        or upper(coalesce(b.responsavel_mat, '')) like '%' || v_search || '%'
      )
    order by
        case b.status
            when 'documentacao_em_atraso' then 0
            when 'aguardando_documento' then 1
            when 'em_transito' then 2
            else 3
        end,
        b.event_at desc nulls last,
        b.rota asc,
        b.placa asc,
        b.seq_ped asc;
end;
$$;
