create table if not exists app.conservadora_transportadoras (
    id uuid primary key default gen_random_uuid(),
    cd integer not null,
    nome text not null,
    nome_norm text not null,
    ativo boolean not null default true,
    created_at timestamptz not null default now(),
    created_by uuid not null references auth.users(id) on delete restrict,
    created_mat text not null,
    created_nome text not null,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete restrict,
    updated_mat text,
    updated_nome text,
    constraint uq_conservadora_transportadoras_cd_nome unique (cd, nome_norm)
);

create index if not exists idx_conservadora_transportadoras_cd_ativo
    on app.conservadora_transportadoras (cd, ativo, nome);

create table if not exists app.conservadora_rotas_transportadoras (
    id uuid primary key default gen_random_uuid(),
    cd integer not null,
    rota_descricao text not null,
    rota_norm text not null,
    transportadora_id uuid not null references app.conservadora_transportadoras(id) on delete restrict,
    created_at timestamptz not null default now(),
    created_by uuid not null references auth.users(id) on delete restrict,
    created_mat text not null,
    created_nome text not null,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete restrict,
    updated_mat text,
    updated_nome text,
    constraint uq_conservadora_rotas_transportadoras_cd_rota unique (cd, rota_norm)
);

create index if not exists idx_conservadora_rotas_transportadoras_cd
    on app.conservadora_rotas_transportadoras (cd, rota_norm);

create table if not exists app.conservadora_documento_confirmacoes (
    id uuid primary key default gen_random_uuid(),
    cd integer not null,
    embarque_key text not null,
    rota_descricao text not null,
    placa text not null,
    seq_ped text not null,
    confirmed_at timestamptz not null default now(),
    confirmed_by uuid not null references auth.users(id) on delete restrict,
    confirmed_mat text not null,
    confirmed_nome text not null,
    constraint uq_conservadora_documento_confirmacoes_cd_key unique (cd, embarque_key)
);

create index if not exists idx_conservadora_documento_confirmacoes_cd_confirmed_at
    on app.conservadora_documento_confirmacoes (cd, confirmed_at desc);

create or replace function app.conservadora_norm_text(p_value text)
returns text
language sql
immutable
as $$
    select upper(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;

create or replace function app.conservadora_norm_plate(p_value text)
returns text
language sql
immutable
as $$
    select upper(regexp_replace(trim(coalesce(p_value, '')), '[^A-Za-z0-9]+', '', 'g'));
$$;

create or replace function app.conservadora_embarque_key(
    p_rota text,
    p_placa text,
    p_seq_ped text
)
returns text
language sql
immutable
as $$
    select md5(
        app.conservadora_norm_text(p_rota)
        || '|'
        || app.conservadora_norm_plate(p_placa)
        || '|'
        || trim(coalesce(p_seq_ped, ''))
    );
$$;

create or replace function app.conservadora_resolve_cd(p_cd integer default null)
returns integer
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := coalesce(
        p_cd,
        (select p.cd_default from authz.profiles p where p.user_id = v_uid limit 1)
    );

    if v_cd is null then
        raise exception 'CD_NAO_DEFINIDO_USUARIO';
    end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return v_cd;
end;
$$;

create or replace function app.conservadora_embarques_base(p_cd integer)
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
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
    with src as materialized (
        select
            v.cd,
            nullif(trim(coalesce(v.descricao, '')), '') as rota_raw,
            app.conservadora_norm_text(v.descricao) as rota_norm,
            nullif(trim(coalesce(v.seq_ped, '')), '') as seq_ped,
            app.conservadora_norm_plate(v.placa) as placa_norm,
            nullif(trim(upper(coalesce(v.placa, ''))), '') as placa_display,
            v.dt_ped,
            v.dt_lib,
            v.encerramento,
            v.updated_at,
            nullif(trim(coalesce(v.usuario, v.aud, '')), '') as usuario_raw,
            authz.normalize_mat(coalesce(v.usuario, v.aud, '')) as usuario_norm
        from app.db_prod_vol v
        where v.cd = p_cd
          and nullif(trim(coalesce(v.descricao, '')), '') is not null
          and nullif(trim(coalesce(v.seq_ped, '')), '') is not null
          and app.conservadora_norm_plate(v.placa) <> ''
    ),
    user_lookup as materialized (
        select
            authz.normalize_mat(u.mat) as mat_norm,
            max(nullif(trim(u.mat), '')) as mat,
            max(nullif(trim(u.nome), '')) as nome
        from app.db_usuario u
        where u.cd = p_cd
          and authz.normalize_mat(u.mat) <> ''
        group by authz.normalize_mat(u.mat)
    ),
    aggregated as (
        select
            s.cd,
            max(s.rota_raw) as rota,
            s.rota_norm,
            max(s.placa_display) as placa,
            s.placa_norm,
            s.seq_ped,
            min(s.dt_ped) as dt_ped,
            min(s.dt_lib) as dt_lib,
            max(s.encerramento) as encerramento,
            max(s.updated_at) as source_updated_at,
            max(coalesce(ul.mat, s.usuario_raw, '-')) as responsavel_mat,
            max(coalesce(ul.nome, s.usuario_raw, 'Não informado')) as responsavel_nome,
            app.conservadora_embarque_key(max(s.rota_raw), max(s.placa_display), s.seq_ped) as embarque_key
        from src s
        left join user_lookup ul
          on ul.mat_norm = s.usuario_norm
        group by
            s.cd,
            s.rota_norm,
            s.placa_norm,
            s.seq_ped
    ),
    ordered as (
        select
            a.*,
            coalesce(a.dt_lib, a.dt_ped, a.encerramento, a.source_updated_at) as event_at,
            lead(coalesce(a.dt_lib, a.dt_ped, a.encerramento, a.source_updated_at)) over (
                partition by a.cd, a.placa_norm
                order by
                    coalesce(a.dt_lib, a.dt_ped, a.encerramento, a.source_updated_at),
                    a.rota_norm,
                    a.seq_ped,
                    a.embarque_key
            ) as next_embarque_at
        from aggregated a
    )
    select
        o.embarque_key,
        o.cd,
        o.rota,
        o.placa,
        o.seq_ped,
        o.dt_ped,
        o.dt_lib,
        o.encerramento,
        o.event_at,
        o.responsavel_mat,
        o.responsavel_nome,
        rt.transportadora_id,
        tp.nome as transportadora_nome,
        tp.ativo as transportadora_ativa,
        dc.confirmed_at as document_confirmed_at,
        dc.confirmed_mat as document_confirmed_mat,
        dc.confirmed_nome as document_confirmed_nome,
        o.next_embarque_at,
        case
            when dc.embarque_key is not null then 'documentacao_recebida'
            when o.next_embarque_at is null then 'em_transito'
            when now() > (o.next_embarque_at + interval '5 days') then 'documentacao_em_atraso'
            else 'aguardando_documento'
        end as status
    from ordered o
    left join app.conservadora_rotas_transportadoras rt
      on rt.cd = o.cd
     and rt.rota_norm = o.rota_norm
    left join app.conservadora_transportadoras tp
      on tp.id = rt.transportadora_id
    left join app.conservadora_documento_confirmacoes dc
      on dc.cd = o.cd
     and dc.embarque_key = o.embarque_key;
$$;

drop function if exists public.rpc_conservadora_cards_list(integer, text, text);
drop function if exists public.rpc_conservadora_history(integer, text, text, date, date, integer, integer);
drop function if exists public.rpc_conservadora_confirmar_documento(integer, text);
drop function if exists public.rpc_conservadora_transportadoras_list(integer);
drop function if exists public.rpc_conservadora_transportadora_upsert(uuid, integer, text);
drop function if exists public.rpc_conservadora_transportadora_inativar(integer, uuid);
drop function if exists public.rpc_conservadora_rotas_list(integer, text);
drop function if exists public.rpc_conservadora_rota_vincular(integer, text, uuid);

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

create or replace function public.rpc_conservadora_history(
    p_cd integer default null,
    p_search text default null,
    p_status text default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_offset integer default 0,
    p_limit integer default 100
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
    v_offset integer;
    v_limit integer;
begin
    v_cd := app.conservadora_resolve_cd(p_cd);
    v_status := lower(trim(coalesce(p_status, '')));
    v_search := upper(trim(coalesce(p_search, '')));
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);

    if p_dt_ini is not null and p_dt_fim is not null and p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

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
      and (p_dt_ini is null or timezone('America/Sao_Paulo', b.event_at)::date >= p_dt_ini)
      and (p_dt_fim is null or timezone('America/Sao_Paulo', b.event_at)::date <= p_dt_fim)
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
        b.event_at desc nulls last,
        b.rota asc,
        b.placa asc,
        b.seq_ped asc
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_conservadora_confirmar_documento(
    p_cd integer default null,
    p_embarque_key text default null
)
returns table (
    embarque_key text,
    confirmed_at timestamptz,
    confirmed_mat text,
    confirmed_nome text
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_embarque record;
    v_now timestamptz := now();
begin
    v_uid := auth.uid();
    v_cd := app.conservadora_resolve_cd(p_cd);

    if nullif(trim(coalesce(p_embarque_key, '')), '') is null then
        raise exception 'EMBARQUE_OBRIGATORIO';
    end if;

    select *
    into v_embarque
    from app.conservadora_embarques_base(v_cd) b
    where b.embarque_key = trim(p_embarque_key)
    limit 1;

    if v_embarque.embarque_key is null then
        raise exception 'EMBARQUE_NAO_ENCONTRADO';
    end if;

    insert into app.conservadora_documento_confirmacoes (
        cd,
        embarque_key,
        rota_descricao,
        placa,
        seq_ped,
        confirmed_at,
        confirmed_by,
        confirmed_mat,
        confirmed_nome
    )
    values (
        v_cd,
        v_embarque.embarque_key,
        coalesce(v_embarque.rota, '-'),
        coalesce(v_embarque.placa, '-'),
        coalesce(v_embarque.seq_ped, '-'),
        v_now,
        v_uid,
        coalesce(nullif(trim((select p.mat from authz.profiles p where p.user_id = v_uid limit 1)), ''), '-'),
        coalesce(nullif(trim((select p.nome from authz.profiles p where p.user_id = v_uid limit 1)), ''), 'Usuário')
    )
    on conflict (cd, embarque_key) do update
    set confirmed_at = excluded.confirmed_at,
        confirmed_by = excluded.confirmed_by,
        confirmed_mat = excluded.confirmed_mat,
        confirmed_nome = excluded.confirmed_nome
    returning
        conservadora_documento_confirmacoes.embarque_key,
        conservadora_documento_confirmacoes.confirmed_at,
        conservadora_documento_confirmacoes.confirmed_mat,
        conservadora_documento_confirmacoes.confirmed_nome
    into embarque_key, confirmed_at, confirmed_mat, confirmed_nome;

    return next;
end;
$$;

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
    where t.cd = v_cd
    order by
        t.ativo desc,
        upper(t.nome),
        t.created_at desc;
end;
$$;

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

    if exists (
        select 1
        from app.conservadora_transportadoras t
        where t.cd = v_cd
          and t.nome_norm = v_nome_norm
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
        where t.id = p_transportadora_id
          and t.cd = v_cd;

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
    where t.cd = v_cd
      and t.nome_norm = v_nome_norm
    limit 1;
end;
$$;

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
      and t.cd = v_cd
    returning t.id, t.ativo, t.updated_at
    into id, ativo, updated_at;

    if id is null then
        raise exception 'TRANSPORTADORA_NAO_ENCONTRADA';
    end if;

    return next;
end;
$$;

create or replace function public.rpc_conservadora_rotas_list(
    p_cd integer default null,
    p_search text default null
)
returns table (
    rota_descricao text,
    transportadora_id uuid,
    transportadora_nome text,
    transportadora_ativa boolean
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_search text;
begin
    v_cd := app.conservadora_resolve_cd(p_cd);
    v_search := upper(trim(coalesce(p_search, '')));

    return query
    with rotas as (
        select
            app.conservadora_norm_text(v.descricao) as rota_norm,
            max(nullif(trim(coalesce(v.descricao, '')), '')) as rota_descricao
        from app.db_prod_vol v
        where v.cd = v_cd
          and nullif(trim(coalesce(v.descricao, '')), '') is not null
        group by app.conservadora_norm_text(v.descricao)
    )
    select
        r.rota_descricao,
        crt.transportadora_id,
        ct.nome as transportadora_nome,
        ct.ativo as transportadora_ativa
    from rotas r
    left join app.conservadora_rotas_transportadoras crt
      on crt.cd = v_cd
     and crt.rota_norm = r.rota_norm
    left join app.conservadora_transportadoras ct
      on ct.id = crt.transportadora_id
    where (
        v_search = ''
        or upper(r.rota_descricao) like '%' || v_search || '%'
        or upper(coalesce(ct.nome, '')) like '%' || v_search || '%'
    )
    order by upper(r.rota_descricao);
end;
$$;

create or replace function public.rpc_conservadora_rota_vincular(
    p_cd integer default null,
    p_rota_descricao text default null,
    p_transportadora_id uuid default null
)
returns table (
    rota_descricao text,
    transportadora_id uuid,
    transportadora_nome text,
    transportadora_ativa boolean
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_rota text;
    v_rota_norm text;
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

    v_rota := nullif(trim(coalesce(p_rota_descricao, '')), '');
    if v_rota is null then
        raise exception 'ROTA_OBRIGATORIA';
    end if;
    v_rota_norm := app.conservadora_norm_text(v_rota);

    if not exists (
        select 1
        from app.db_prod_vol v
        where v.cd = v_cd
          and app.conservadora_norm_text(v.descricao) = v_rota_norm
    ) then
        raise exception 'ROTA_NAO_ENCONTRADA';
    end if;

    if not exists (
        select 1
        from app.conservadora_transportadoras t
        where t.id = p_transportadora_id
          and t.cd = v_cd
          and t.ativo = true
    ) then
        raise exception 'TRANSPORTADORA_NAO_ENCONTRADA';
    end if;

    v_mat := coalesce(nullif(trim((select p.mat from authz.profiles p where p.user_id = v_uid limit 1)), ''), '-');
    v_nome_usuario := coalesce(nullif(trim((select p.nome from authz.profiles p where p.user_id = v_uid limit 1)), ''), 'Usuário');

    insert into app.conservadora_rotas_transportadoras (
        cd,
        rota_descricao,
        rota_norm,
        transportadora_id,
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
        v_rota,
        v_rota_norm,
        p_transportadora_id,
        v_now,
        v_uid,
        v_mat,
        v_nome_usuario,
        v_now,
        v_uid,
        v_mat,
        v_nome_usuario
    )
    on conflict (cd, rota_norm) do update
    set rota_descricao = excluded.rota_descricao,
        transportadora_id = excluded.transportadora_id,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by,
        updated_mat = excluded.updated_mat,
        updated_nome = excluded.updated_nome;

    return query
    select
        r.rota_descricao,
        r.transportadora_id,
        r.transportadora_nome,
        r.transportadora_ativa
    from public.rpc_conservadora_rotas_list(v_cd, null) r
    where app.conservadora_norm_text(r.rota_descricao) = v_rota_norm
    limit 1;
end;
$$;

grant execute on function public.rpc_conservadora_cards_list(integer, text, text) to authenticated;
grant execute on function public.rpc_conservadora_history(integer, text, text, date, date, integer, integer) to authenticated;
grant execute on function public.rpc_conservadora_confirmar_documento(integer, text) to authenticated;
grant execute on function public.rpc_conservadora_transportadoras_list(integer) to authenticated;
grant execute on function public.rpc_conservadora_transportadora_upsert(uuid, integer, text) to authenticated;
grant execute on function public.rpc_conservadora_transportadora_inativar(integer, uuid) to authenticated;
grant execute on function public.rpc_conservadora_rotas_list(integer, text) to authenticated;
grant execute on function public.rpc_conservadora_rota_vincular(integer, text, uuid) to authenticated;
