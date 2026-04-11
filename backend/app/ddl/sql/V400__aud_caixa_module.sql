create table if not exists app.aud_caixa (
    id uuid primary key default gen_random_uuid(),
    etiqueta text not null,
    id_knapp text,
    cd integer not null,
    pedido bigint not null,
    data_pedido date,
    dv text,
    filial bigint not null,
    filial_nome text,
    uf text,
    rota text not null default 'Sem rota',
    volume text,
    ocorrencia text check (
        ocorrencia in (
            'Basqueta quebrada',
            'Sem lacre',
            'Lacramento não conforme',
            'Duplicidade',
            'Sem etiqueta',
            'Volume misturado',
            'Avaria',
            'Termo embagalem (N/OK)',
            'Caixa papelão não conforme',
            'Falta',
            'Sobra',
            'Altura não conforme'
        )
    ),
    mat_aud text not null,
    nome_aud text not null,
    user_id uuid not null references auth.users(id) on delete restrict,
    data_hr timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint chk_aud_caixa_id_knapp_format check (
        id_knapp is null or id_knapp ~ '^[0-9]{8}$'
    ),
    constraint chk_aud_caixa_etiqueta_len check (
        char_length(trim(etiqueta)) in (17, 18, 23, 25, 26, 27)
    )
);

create index if not exists idx_aud_caixa_cd_data_hr on app.aud_caixa(cd, data_hr desc);
create index if not exists idx_aud_caixa_user_data_hr on app.aud_caixa(user_id, data_hr desc);
create index if not exists idx_aud_caixa_etiqueta on app.aud_caixa((upper(trim(etiqueta))));
create index if not exists idx_aud_caixa_cd_rota_filial on app.aud_caixa(cd, rota, filial);
create index if not exists idx_aud_caixa_cd_filial on app.aud_caixa(cd, filial);
create unique index if not exists uq_aud_caixa_etiqueta_id_knapp
    on app.aud_caixa ((upper(trim(etiqueta))), (coalesce(nullif(trim(id_knapp), ''), '')));

create or replace function app.aud_caixa_strip_leading_zeros(p_value text)
returns text
language plpgsql
immutable
as $$
declare
    v_value text;
begin
    v_value := regexp_replace(coalesce(p_value, ''), '\s+', '', 'g');
    if v_value = '' then
        return null;
    end if;

    v_value := regexp_replace(v_value, '^0+', '');
    if v_value = '' then
        return '0';
    end if;

    return v_value;
end;
$$;

create or replace function app.aud_caixa_enrich_and_validate()
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
    v_len integer;
    v_current_year integer;
    v_year_text text;
    v_year_num integer;
    v_pedido_text text;
    v_day_num integer;
    v_dv_text text;
    v_filial_text text;
    v_filial_num bigint;
    v_volume_text text;
    v_existing_same_etiqueta_count integer;
    v_existing_same_pair_count integer;
    v_route_rota text;
    v_route_nome text;
    v_route_uf text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if tg_op = 'INSERT' then
        new.user_id := v_uid;
        new.created_at := coalesce(new.created_at, now());
    else
        new.user_id := old.user_id;
        new.cd := old.cd;
        new.mat_aud := old.mat_aud;
        new.nome_aud := old.nome_aud;
        new.data_hr := old.data_hr;
        new.created_at := old.created_at;
    end if;

    new.etiqueta := regexp_replace(coalesce(new.etiqueta, ''), '\s+', '', 'g');
    if new.etiqueta = '' then
        raise exception 'ETIQUETA_OBRIGATORIA';
    end if;

    new.id_knapp := regexp_replace(coalesce(new.id_knapp, ''), '\D+', '', 'g');
    new.id_knapp := nullif(new.id_knapp, '');
    new.ocorrencia := nullif(trim(coalesce(new.ocorrencia, '')), '');

    if new.ocorrencia is not null and new.ocorrencia not in (
        'Basqueta quebrada',
        'Sem lacre',
        'Lacramento não conforme',
        'Duplicidade',
        'Sem etiqueta',
        'Volume misturado',
        'Avaria',
        'Termo embagalem (N/OK)',
        'Caixa papelão não conforme',
        'Falta',
        'Sobra',
        'Altura não conforme'
    ) then
        raise exception 'OCORRENCIA_INVALIDA';
    end if;

    v_len := char_length(new.etiqueta);
    if v_len not in (17, 18, 23, 25, 26, 27) then
        raise exception 'ETIQUETA_TAMANHO_INVALIDO';
    end if;

    v_current_year := extract(year from timezone('America/Sao_Paulo', now()))::integer;

    if v_len in (23, 25, 26, 27) then
        if left(new.etiqueta, 1) not between '1' and '9' then
            raise exception 'ETIQUETA_INVALIDA_PREFIXO';
        end if;

        v_year_text := substring(new.etiqueta from 2 for 4);
        if v_year_text !~ '^\d{4}$' then
            raise exception 'ETIQUETA_INVALIDA_ANO';
        end if;

        v_year_num := v_year_text::integer;
        if v_year_num < 2024 or v_year_num > v_current_year then
            raise exception 'ETIQUETA_INVALIDA_ANO';
        end if;
    end if;

    if v_len in (17, 18) then
        if new.id_knapp is not null and new.id_knapp !~ '^\d{8}$' then
            raise exception 'ID_KNAPP_INVALIDO';
        end if;
    else
        new.id_knapp := null;
    end if;

    if v_len = 17 then
        v_pedido_text := left(new.etiqueta, 7);
        v_dv_text := substring(new.etiqueta from 8 for 7);
        v_filial_text := right(new.etiqueta, 3);
        v_volume_text := case when new.id_knapp is not null then app.aud_caixa_strip_leading_zeros(new.id_knapp) else null end;
    elsif v_len = 18 then
        v_pedido_text := left(new.etiqueta, 7);
        v_dv_text := substring(new.etiqueta from 8 for 7);
        v_filial_text := right(new.etiqueta, 4);
        v_volume_text := case when new.id_knapp is not null then app.aud_caixa_strip_leading_zeros(new.id_knapp) else null end;
    else
        v_pedido_text := substring(new.etiqueta from 2 for 7);
        v_dv_text := substring(new.etiqueta from 9 for 3);
        v_filial_text := substring(new.etiqueta from 12 for 4);
        v_volume_text := case
            when v_len = 23 then app.aud_caixa_strip_leading_zeros(right(new.etiqueta, 3))
            when v_len = 25 then app.aud_caixa_strip_leading_zeros(right(new.etiqueta, 2))
            when v_len = 26 then app.aud_caixa_strip_leading_zeros(substring(new.etiqueta from 17 for 3))
            else app.aud_caixa_strip_leading_zeros(substring(new.etiqueta from 18 for 3))
        end;
    end if;

    if v_pedido_text !~ '^\d{7}$' then
        raise exception 'PEDIDO_INVALIDO';
    end if;

    if v_filial_text !~ '^\d+$' then
        raise exception 'FILIAL_INVALIDA';
    end if;

    new.pedido := v_pedido_text::bigint;
    v_day_num := coalesce(nullif(substring(v_pedido_text from 5 for 3), ''), '0')::integer;
    new.data_pedido := make_date(left(v_pedido_text, 4)::integer, 1, 1) + v_day_num;
    new.dv := nullif(trim(coalesce(v_dv_text, '')), '');
    v_filial_num := app.aud_caixa_strip_leading_zeros(v_filial_text)::bigint;
    new.filial := v_filial_num;
    new.volume := nullif(v_volume_text, '');

    select count(*)
    into v_existing_same_etiqueta_count
    from app.aud_caixa c
    where upper(trim(c.etiqueta)) = upper(trim(new.etiqueta))
      and (tg_op <> 'UPDATE' or c.id <> old.id);

    if v_len in (17, 18) and v_existing_same_etiqueta_count > 0 and new.id_knapp is null then
        raise exception 'ETIQUETA_DUPLICADA_EXIGE_ID_KNAPP';
    end if;

    select count(*)
    into v_existing_same_pair_count
    from app.aud_caixa c
    where upper(trim(c.etiqueta)) = upper(trim(new.etiqueta))
      and coalesce(nullif(trim(c.id_knapp), ''), '') = coalesce(new.id_knapp, '')
      and (tg_op <> 'UPDATE' or c.id <> old.id);

    if v_len in (17, 18) then
        if new.id_knapp is not null and v_existing_same_pair_count > 0 then
            raise exception 'ETIQUETA_ID_KNAPP_DUPLICADO';
        end if;
    elsif v_existing_same_pair_count > 0 then
        raise exception 'ETIQUETA_DUPLICADA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    v_is_global_admin := authz.is_admin(v_uid);

    if tg_op = 'INSERT' then
        if v_is_global_admin then
            if new.cd is null then
                raise exception 'CD_OBRIGATORIO_ADMIN_GLOBAL';
            end if;
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
        end if;

        if not authz.can_access_cd(v_uid, new.cd) then
            raise exception 'CD_SEM_ACESSO';
        end if;

        new.mat_aud := coalesce(nullif(trim(v_profile.mat), ''), new.mat_aud);
        new.nome_aud := coalesce(nullif(trim(v_profile.nome), ''), new.nome_aud);
    end if;

    if coalesce(nullif(trim(new.mat_aud), ''), '') = '' then
        raise exception 'MATRICULA_AUDITOR_OBRIGATORIA';
    end if;

    if coalesce(nullif(trim(new.nome_aud), ''), '') = '' then
        raise exception 'NOME_AUDITOR_OBRIGATORIO';
    end if;

    select
        nullif(trim(r.rota), '') as rota,
        nullif(trim(r.nome), '') as nome,
        nullif(trim(r.uf), '') as uf
    into v_route_rota, v_route_nome, v_route_uf
    from app.db_rotas r
    where r.cd = new.cd
      and r.filial = new.filial
    order by r.updated_at desc nulls last
    limit 1;

    new.rota := coalesce(v_route_rota, 'Sem rota');
    new.filial_nome := v_route_nome;
    new.uf := v_route_uf;
    new.data_hr := coalesce(new.data_hr, now());
    new.updated_at := now();

    return new;
end;
$$;

drop trigger if exists trg_aud_caixa_enrich_and_validate on app.aud_caixa;

create trigger trg_aud_caixa_enrich_and_validate
before insert or update on app.aud_caixa
for each row
execute function app.aud_caixa_enrich_and_validate();

alter table app.aud_caixa enable row level security;

revoke all on app.aud_caixa from anon;
revoke all on app.aud_caixa from authenticated;
grant select, insert, update, delete on app.aud_caixa to authenticated;

drop policy if exists p_aud_caixa_select on app.aud_caixa;
drop policy if exists p_aud_caixa_insert on app.aud_caixa;
drop policy if exists p_aud_caixa_update on app.aud_caixa;
drop policy if exists p_aud_caixa_delete on app.aud_caixa;

create policy p_aud_caixa_select
on app.aud_caixa
for select
using (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_aud_caixa_insert
on app.aud_caixa
for insert
with check (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_aud_caixa_update
on app.aud_caixa
for update
using (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
)
with check (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_aud_caixa_delete
on app.aud_caixa
for delete
using (
    authz.session_is_recent(6)
    and user_id = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create or replace function public.rpc_db_rotas_meta(p_cd integer)
returns table (
    row_count integer,
    updated_max timestamptz
)
language plpgsql
stable
security invoker
set search_path = app, authz, public
as $$
declare
    v_cd integer;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    v_cd := p_cd;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if not authz.can_access_cd(auth.uid(), v_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    select
        count(*)::integer as row_count,
        max(r.updated_at) as updated_max
    from app.db_rotas r
    where r.cd = v_cd;
end;
$$;

create or replace function public.rpc_db_rotas_page(
    p_cd integer,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    filial bigint,
    uf text,
    nome text,
    rota text,
    updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = app, authz, public
as $$
declare
    v_cd integer;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    v_cd := p_cd;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if not authz.can_access_cd(auth.uid(), v_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    select
        r.filial,
        r.uf,
        r.nome,
        r.rota,
        r.updated_at
    from app.db_rotas r
    where r.cd = v_cd
    order by r.filial
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 1000), 1), 2000);
end;
$$;

create or replace function public.rpc_aud_caixa_insert(
    p_cd integer,
    p_etiqueta text,
    p_id_knapp text default null,
    p_ocorrencia text default null,
    p_data_hr timestamptz default null
)
returns table (
    id uuid,
    etiqueta text,
    id_knapp text,
    cd integer,
    pedido bigint,
    data_pedido date,
    dv text,
    filial bigint,
    filial_nome text,
    uf text,
    rota text,
    volume text,
    ocorrencia text,
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
    insert into app.aud_caixa (
        etiqueta,
        id_knapp,
        cd,
        ocorrencia,
        data_hr
    )
    values (
        p_etiqueta,
        p_id_knapp,
        p_cd,
        p_ocorrencia,
        p_data_hr
    )
    returning
        aud_caixa.id,
        aud_caixa.etiqueta,
        aud_caixa.id_knapp,
        aud_caixa.cd,
        aud_caixa.pedido,
        aud_caixa.data_pedido,
        aud_caixa.dv,
        aud_caixa.filial,
        aud_caixa.filial_nome,
        aud_caixa.uf,
        aud_caixa.rota,
        aud_caixa.volume,
        aud_caixa.ocorrencia,
        aud_caixa.mat_aud,
        aud_caixa.nome_aud,
        aud_caixa.user_id,
        aud_caixa.data_hr,
        aud_caixa.created_at,
        aud_caixa.updated_at;
end;
$$;

create or replace function public.rpc_aud_caixa_update(
    p_id uuid,
    p_etiqueta text,
    p_id_knapp text default null,
    p_ocorrencia text default null
)
returns table (
    id uuid,
    etiqueta text,
    id_knapp text,
    cd integer,
    pedido bigint,
    data_pedido date,
    dv text,
    filial bigint,
    filial_nome text,
    uf text,
    rota text,
    volume text,
    ocorrencia text,
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
    update app.aud_caixa
    set
        etiqueta = p_etiqueta,
        id_knapp = p_id_knapp,
        ocorrencia = p_ocorrencia
    where aud_caixa.id = p_id
    returning
        aud_caixa.id,
        aud_caixa.etiqueta,
        aud_caixa.id_knapp,
        aud_caixa.cd,
        aud_caixa.pedido,
        aud_caixa.data_pedido,
        aud_caixa.dv,
        aud_caixa.filial,
        aud_caixa.filial_nome,
        aud_caixa.uf,
        aud_caixa.rota,
        aud_caixa.volume,
        aud_caixa.ocorrencia,
        aud_caixa.mat_aud,
        aud_caixa.nome_aud,
        aud_caixa.user_id,
        aud_caixa.data_hr,
        aud_caixa.created_at,
        aud_caixa.updated_at;

    if not found then
        raise exception 'AUD_CAIXA_NAO_ENCONTRADA_OU_SEM_ACESSO';
    end if;
end;
$$;

create or replace function public.rpc_aud_caixa_delete(p_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = app, authz, public
as $$
begin
    delete from app.aud_caixa
    where id = p_id;

    return found;
end;
$$;

create or replace function public.rpc_aud_caixa_today(
    p_cd integer,
    p_limit integer default 1000
)
returns table (
    id uuid,
    etiqueta text,
    id_knapp text,
    cd integer,
    pedido bigint,
    data_pedido date,
    dv text,
    filial bigint,
    filial_nome text,
    uf text,
    rota text,
    volume text,
    ocorrencia text,
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
    with bounds as (
        select (timezone('America/Sao_Paulo', now()))::date as today_br
    )
    select
        c.id,
        c.etiqueta,
        c.id_knapp,
        c.cd,
        c.pedido,
        c.data_pedido,
        c.dv,
        c.filial,
        c.filial_nome,
        c.uf,
        c.rota,
        c.volume,
        c.ocorrencia,
        c.mat_aud,
        c.nome_aud,
        c.user_id,
        c.data_hr,
        c.created_at,
        c.updated_at
    from app.aud_caixa c
    cross join bounds b
    where authz.session_is_recent(6)
      and p_cd is not null
      and c.cd = p_cd
      and c.data_hr >= (b.today_br::timestamp at time zone 'America/Sao_Paulo')
      and c.data_hr < ((b.today_br + 1)::timestamp at time zone 'America/Sao_Paulo')
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      )
    order by c.data_hr desc, c.id desc
    limit least(greatest(coalesce(p_limit, 1000), 1), 3000);
$$;

create or replace function public.rpc_aud_caixa_report_count(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null
)
returns bigint
language plpgsql
stable
security invoker
set search_path = app, authz, public
as $$
declare
    v_role text;
    v_start_ts timestamptz;
    v_end_ts timestamptz;
    v_count bigint;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_role := authz.user_role(auth.uid());
    if v_role <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if p_dt_fim - p_dt_ini > 31 then
        raise exception 'JANELA_MAX_31_DIAS';
    end if;

    if p_cd is not null and not authz.can_access_cd(auth.uid(), p_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    select count(*)
    into v_count
    from app.aud_caixa c
    where c.data_hr >= v_start_ts
      and c.data_hr < v_end_ts
      and (p_cd is null or c.cd = p_cd)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      );

    return v_count;
end;
$$;

create or replace function public.rpc_aud_caixa_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null,
    p_limit integer default 20000
)
returns table (
    id uuid,
    etiqueta text,
    id_knapp text,
    cd integer,
    pedido bigint,
    data_pedido date,
    dv text,
    filial bigint,
    filial_nome text,
    uf text,
    rota text,
    volume text,
    ocorrencia text,
    mat_aud text,
    nome_aud text,
    user_id uuid,
    data_hr timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = app, authz, public
as $$
declare
    v_role text;
    v_start_ts timestamptz;
    v_end_ts timestamptz;
    v_limit integer;
    v_count bigint;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_role := authz.user_role(auth.uid());
    if v_role <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if p_dt_fim - p_dt_ini > 31 then
        raise exception 'JANELA_MAX_31_DIAS';
    end if;

    if p_cd is not null and not authz.can_access_cd(auth.uid(), p_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 20000), 1), 50000);
    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    select count(*)
    into v_count
    from app.aud_caixa c
    where c.data_hr >= v_start_ts
      and c.data_hr < v_end_ts
      and (p_cd is null or c.cd = p_cd)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      );

    if v_count > v_limit then
        raise exception 'RELATORIO_MUITO_GRANDE_%', v_count;
    end if;

    return query
    select
        c.id,
        c.etiqueta,
        c.id_knapp,
        c.cd,
        c.pedido,
        c.data_pedido,
        c.dv,
        c.filial,
        c.filial_nome,
        c.uf,
        c.rota,
        c.volume,
        c.ocorrencia,
        c.mat_aud,
        c.nome_aud,
        c.user_id,
        c.data_hr,
        c.created_at,
        c.updated_at
    from app.aud_caixa c
    where c.data_hr >= v_start_ts
      and c.data_hr < v_end_ts
      and (p_cd is null or c.cd = p_cd)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      )
    order by c.data_hr desc, c.id desc
    limit v_limit;
end;
$$;

grant execute on function public.rpc_db_rotas_meta(integer) to authenticated;
grant execute on function public.rpc_db_rotas_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_aud_caixa_insert(integer, text, text, text, timestamptz) to authenticated;
grant execute on function public.rpc_aud_caixa_update(uuid, text, text, text) to authenticated;
grant execute on function public.rpc_aud_caixa_delete(uuid) to authenticated;
grant execute on function public.rpc_aud_caixa_today(integer, integer) to authenticated;
grant execute on function public.rpc_aud_caixa_report_count(date, date, integer) to authenticated;
grant execute on function public.rpc_aud_caixa_report_rows(date, date, integer, integer) to authenticated;
