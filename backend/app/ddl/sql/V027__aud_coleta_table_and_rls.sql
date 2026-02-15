create table if not exists app.aud_coleta (
    id uuid primary key default gen_random_uuid(),
    etiqueta text,
    cd integer not null,
    barras text not null,
    coddv integer not null,
    descricao text not null,
    qtd integer not null check (qtd > 0),
    ocorrencia text check (ocorrencia in ('Avariado', 'Vencido')),
    lote text,
    val_mmaa char(4) check (val_mmaa ~ '^(0[1-9]|1[0-2])[0-9]{2}$'),
    mat_aud text not null,
    nome_aud text not null,
    user_id uuid not null references auth.users(id) on delete restrict,
    data_hr timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_app_db_barras_barras on app.db_barras(barras);

create index if not exists idx_aud_coleta_cd_data_hr on app.aud_coleta(cd, data_hr desc);
create index if not exists idx_aud_coleta_user_data_hr on app.aud_coleta(user_id, data_hr desc);
create index if not exists idx_aud_coleta_barras on app.aud_coleta(barras);
create index if not exists idx_aud_coleta_coddv on app.aud_coleta(coddv);

create or replace function app.aud_coleta_enrich_and_validate()
returns trigger
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_profile record;
    v_is_global_admin boolean;
    v_cd integer;
    v_coddv integer;
    v_descricao text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if tg_op = 'INSERT' then
        new.user_id := v_uid;
    else
        new.user_id := old.user_id;
    end if;

    new.barras := regexp_replace(coalesce(new.barras, ''), '\\s+', '', 'g');
    if new.barras = '' then
        raise exception 'BARRAS_OBRIGATORIA';
    end if;

    new.etiqueta := nullif(trim(coalesce(new.etiqueta, '')), '');
    new.lote := nullif(trim(coalesce(new.lote, '')), '');
    new.ocorrencia := nullif(trim(coalesce(new.ocorrencia, '')), '');

    if new.ocorrencia is not null and new.ocorrencia not in ('Avariado', 'Vencido') then
        raise exception 'OCORRENCIA_INVALIDA';
    end if;

    if new.val_mmaa is not null then
        new.val_mmaa := regexp_replace(new.val_mmaa, '[^0-9]', '', 'g');
        new.val_mmaa := nullif(new.val_mmaa, '');
    end if;

    if new.val_mmaa is not null and new.val_mmaa !~ '^(0[1-9]|1[0-2])[0-9]{2}$' then
        raise exception 'VALIDADE_INVALIDA_MMAA';
    end if;

    if coalesce(new.qtd, 0) <= 0 then
        raise exception 'QTD_INVALIDA';
    end if;

    select b.coddv, b.descricao
    into v_coddv, v_descricao
    from app.db_barras b
    where b.barras = new.barras
    order by b.updated_at desc nulls last, b.coddv
    limit 1;

    if v_coddv is null then
        raise exception 'BARRAS_NAO_ENCONTRADA';
    end if;

    new.coddv := v_coddv;
    new.descricao := coalesce(v_descricao, 'SEM DESCRICAO');

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    v_is_global_admin := authz.is_admin(v_uid);

    if tg_op = 'UPDATE' then
        new.cd := old.cd;
        new.mat_aud := old.mat_aud;
        new.nome_aud := old.nome_aud;
        new.data_hr := old.data_hr;
    elsif v_is_global_admin then
        if new.cd is null then
            raise exception 'CD_OBRIGATORIO_ADMIN_GLOBAL';
        end if;
        new.mat_aud := coalesce(nullif(trim(v_profile.mat), ''), new.mat_aud);
        new.nome_aud := coalesce(nullif(trim(v_profile.nome), ''), new.nome_aud);
    else
        v_cd := v_profile.cd_default;
        if v_cd is null then
            select min(ud.cd)
            into v_cd
            from authz.user_deposits ud
            where ud.user_id = v_uid;
        end if;

        if v_cd is null then
            raise exception 'CD_NAO_DEFINIDO_USUARIO';
        end if;

        if not authz.can_access_cd(v_uid, v_cd) then
            raise exception 'CD_SEM_ACESSO';
        end if;

        new.cd := v_cd;
        new.mat_aud := coalesce(nullif(trim(v_profile.mat), ''), new.mat_aud);
        new.nome_aud := coalesce(nullif(trim(v_profile.nome), ''), new.nome_aud);
    end if;

    if coalesce(nullif(trim(new.mat_aud), ''), '') = '' then
        raise exception 'MATRICULA_AUDITOR_OBRIGATORIA';
    end if;

    if coalesce(nullif(trim(new.nome_aud), ''), '') = '' then
        raise exception 'NOME_AUDITOR_OBRIGATORIO';
    end if;

    new.data_hr := coalesce(new.data_hr, now());
    new.updated_at := now();

    return new;
end;
$$;

drop trigger if exists trg_aud_coleta_enrich_and_validate on app.aud_coleta;

create trigger trg_aud_coleta_enrich_and_validate
before insert or update on app.aud_coleta
for each row
execute function app.aud_coleta_enrich_and_validate();

alter table app.aud_coleta enable row level security;

revoke all on app.aud_coleta from anon;
revoke all on app.aud_coleta from authenticated;
grant select, insert, update, delete on app.aud_coleta to authenticated;

drop policy if exists p_aud_coleta_select on app.aud_coleta;
drop policy if exists p_aud_coleta_insert on app.aud_coleta;
drop policy if exists p_aud_coleta_update on app.aud_coleta;
drop policy if exists p_aud_coleta_delete on app.aud_coleta;

create policy p_aud_coleta_select
on app.aud_coleta
for select
using (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_aud_coleta_insert
on app.aud_coleta
for insert
with check (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_aud_coleta_update
on app.aud_coleta
for update
using (
    authz.session_is_recent(6)
    and (
        user_id = auth.uid()
        or authz.is_admin(auth.uid())
    )
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
)
with check (
    authz.session_is_recent(6)
    and (
        user_id = auth.uid()
        or authz.is_admin(auth.uid())
    )
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_aud_coleta_delete
on app.aud_coleta
for delete
using (
    authz.session_is_recent(6)
    and (
        user_id = auth.uid()
        or authz.is_admin(auth.uid())
    )
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create or replace function public.rpc_db_barras_page(
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    barras text,
    coddv integer,
    descricao text,
    updated_at timestamptz
)
language sql
stable
security invoker
set search_path = app, authz, public
as $$
    select
        b.barras,
        b.coddv,
        b.descricao,
        b.updated_at
    from app.db_barras b
    where authz.session_is_recent(6)
      and authz.can_read_global_dim(auth.uid())
    order by b.barras
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 1000), 1), 2000);
$$;

create or replace function public.rpc_cd_options()
returns table (
    cd integer,
    cd_nome text
)
language sql
stable
security invoker
set search_path = app, authz, public
as $$
    select
        u.cd,
        coalesce(
            min(nullif(trim(u.cd_nome), '')),
            format('CD %s', u.cd)
        ) as cd_nome
    from app.db_usuario u
    where authz.session_is_recent(6)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), u.cd)
      )
    group by u.cd
    order by u.cd;
$$;

create or replace function public.rpc_aud_coleta_insert(
    p_cd integer,
    p_barras text,
    p_qtd integer,
    p_etiqueta text default null,
    p_ocorrencia text default null,
    p_lote text default null,
    p_val_mmaa text default null,
    p_data_hr timestamptz default null
)
returns table (
    id uuid,
    etiqueta text,
    cd integer,
    barras text,
    coddv integer,
    descricao text,
    qtd integer,
    ocorrencia text,
    lote text,
    val_mmaa char(4),
    mat_aud text,
    nome_aud text,
    user_id uuid,
    data_hr timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security invoker
set search_path = app, authz, public
as $$
begin
    return query
    insert into app.aud_coleta (
        etiqueta,
        cd,
        barras,
        qtd,
        ocorrencia,
        lote,
        val_mmaa,
        data_hr
    )
    values (
        p_etiqueta,
        p_cd,
        p_barras,
        p_qtd,
        p_ocorrencia,
        p_lote,
        p_val_mmaa,
        p_data_hr
    )
    returning
        aud_coleta.id,
        aud_coleta.etiqueta,
        aud_coleta.cd,
        aud_coleta.barras,
        aud_coleta.coddv,
        aud_coleta.descricao,
        aud_coleta.qtd,
        aud_coleta.ocorrencia,
        aud_coleta.lote,
        aud_coleta.val_mmaa,
        aud_coleta.mat_aud,
        aud_coleta.nome_aud,
        aud_coleta.user_id,
        aud_coleta.data_hr,
        aud_coleta.created_at,
        aud_coleta.updated_at;
end;
$$;

create or replace function public.rpc_aud_coleta_update(
    p_id uuid,
    p_qtd integer,
    p_etiqueta text default null,
    p_ocorrencia text default null,
    p_lote text default null,
    p_val_mmaa text default null
)
returns table (
    id uuid,
    etiqueta text,
    cd integer,
    barras text,
    coddv integer,
    descricao text,
    qtd integer,
    ocorrencia text,
    lote text,
    val_mmaa char(4),
    mat_aud text,
    nome_aud text,
    user_id uuid,
    data_hr timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security invoker
set search_path = app, authz, public
as $$
begin
    return query
    update app.aud_coleta
    set
        qtd = p_qtd,
        etiqueta = p_etiqueta,
        ocorrencia = p_ocorrencia,
        lote = p_lote,
        val_mmaa = p_val_mmaa
    where aud_coleta.id = p_id
    returning
        aud_coleta.id,
        aud_coleta.etiqueta,
        aud_coleta.cd,
        aud_coleta.barras,
        aud_coleta.coddv,
        aud_coleta.descricao,
        aud_coleta.qtd,
        aud_coleta.ocorrencia,
        aud_coleta.lote,
        aud_coleta.val_mmaa,
        aud_coleta.mat_aud,
        aud_coleta.nome_aud,
        aud_coleta.user_id,
        aud_coleta.data_hr,
        aud_coleta.created_at,
        aud_coleta.updated_at;

    if not found then
        raise exception 'COLETA_NAO_ENCONTRADA_OU_SEM_ACESSO';
    end if;
end;
$$;

create or replace function public.rpc_aud_coleta_delete(p_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = app, authz, public
as $$
begin
    delete from app.aud_coleta
    where id = p_id;

    return found;
end;
$$;

create or replace function public.rpc_aud_coleta_recent(p_limit integer default 200)
returns table (
    id uuid,
    etiqueta text,
    cd integer,
    barras text,
    coddv integer,
    descricao text,
    qtd integer,
    ocorrencia text,
    lote text,
    val_mmaa char(4),
    mat_aud text,
    nome_aud text,
    user_id uuid,
    data_hr timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language sql
stable
security invoker
set search_path = app, authz, public
as $$
    select
        c.id,
        c.etiqueta,
        c.cd,
        c.barras,
        c.coddv,
        c.descricao,
        c.qtd,
        c.ocorrencia,
        c.lote,
        c.val_mmaa,
        c.mat_aud,
        c.nome_aud,
        c.user_id,
        c.data_hr,
        c.created_at,
        c.updated_at
    from app.aud_coleta c
    where authz.session_is_recent(6)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      )
    order by c.data_hr desc, c.id desc
    limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

grant execute on function public.rpc_db_barras_page(integer, integer) to authenticated;
grant execute on function public.rpc_cd_options() to authenticated;
grant execute on function public.rpc_aud_coleta_insert(integer, text, integer, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.rpc_aud_coleta_update(uuid, integer, text, text, text, text) to authenticated;
grant execute on function public.rpc_aud_coleta_delete(uuid) to authenticated;
grant execute on function public.rpc_aud_coleta_recent(integer) to authenticated;
