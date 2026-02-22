create table if not exists app.produtividade_cd_settings (
    cd integer primary key,
    visibility_mode text not null default 'public_cd'
        check (visibility_mode in ('public_cd', 'owner_only')),
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);

create index if not exists idx_produtividade_cd_settings_visibility_mode
    on app.produtividade_cd_settings (visibility_mode);

create or replace function app.produtividade_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_produtividade_cd_settings_touch_updated_at on app.produtividade_cd_settings;
create trigger trg_produtividade_cd_settings_touch_updated_at
before update on app.produtividade_cd_settings
for each row
execute function app.produtividade_touch_updated_at();

alter table app.produtividade_cd_settings enable row level security;

revoke all on app.produtividade_cd_settings from anon;
revoke all on app.produtividade_cd_settings from authenticated;

create or replace function app.produtividade_norm_digits(p_value text)
returns text
language sql
immutable
as $$
    select regexp_replace(coalesce(p_value, ''), '[^0-9]+', '', 'g');
$$;

create or replace function app.produtividade_norm_text(p_value text)
returns text
language sql
immutable
as $$
    select regexp_replace(
        translate(
            upper(coalesce(trim(p_value), '')),
            'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
            'AAAAAEEEEIIIIOOOOOUUUUCN'
        ),
        '[^A-Z0-9]+',
        '',
        'g'
    );
$$;

create or replace function app.produtividade_resolve_cd(p_cd integer default null)
returns integer
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_role text;
    v_cd integer;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    v_role := coalesce(authz.user_role(v_uid), 'auditor');

    if v_role = 'admin' then
        v_cd := coalesce(
            p_cd,
            v_profile.cd_default,
            (
                select min(u.cd)
                from app.db_usuario u
                where u.cd is not null
            )
        );
    else
        v_cd := coalesce(
            v_profile.cd_default,
            p_cd,
            (
                select min(ud.cd)
                from authz.user_deposits ud
                where ud.user_id = v_uid
            )
        );
    end if;

    if v_cd is null then
        raise exception 'CD_NAO_DEFINIDO_USUARIO';
    end if;

    if not authz.can_access_cd(v_uid, v_cd) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return v_cd;
end;
$$;

create or replace function app.produtividade_visibility_mode(p_cd integer)
returns text
language sql
stable
security definer
set search_path = app, authz, public
as $$
    select coalesce(
        (
            select st.visibility_mode
            from app.produtividade_cd_settings st
            where st.cd = p_cd
            limit 1
        ),
        'public_cd'
    );
$$;

create or replace function app.produtividade_events_base(
    p_cd integer,
    p_dt_ini date default null,
    p_dt_fim date default null
)
returns table (
    activity_key text,
    activity_label text,
    unit_label text,
    user_id uuid,
    mat text,
    nome text,
    event_date date,
    metric_value numeric(18,3),
    detail text,
    source_ref text,
    event_at timestamptz
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
    with profiles_cd as (
        select
            p.user_id,
            coalesce(nullif(trim(p.mat), ''), '-') as mat,
            coalesce(nullif(trim(p.nome), ''), 'Usuário') as nome,
            app.produtividade_norm_digits(p.mat) as mat_norm,
            app.produtividade_norm_text(p.nome) as nome_norm
        from authz.profiles p
        join authz.user_deposits ud
          on ud.user_id = p.user_id
         and ud.cd = p_cd
    ),
    inventario_enderecos as (
        select
            c.cd,
            c.counted_by as user_id,
            min(c.counted_mat) as mat,
            min(c.counted_nome) as nome,
            c.cycle_date as event_date,
            c.zona,
            upper(c.endereco) as endereco,
            c.etapa::integer as etapa,
            min(c.count_id::text) as source_ref,
            max(c.updated_at) as event_at
        from app.conf_inventario_counts c
        where c.cd = p_cd
        group by
            c.cd,
            c.counted_by,
            c.cycle_date,
            c.zona,
            upper(c.endereco),
            c.etapa
    ),
    prod_vol_src as (
        select
            v.cd,
            coalesce(v.aud, '') as aud,
            coalesce(v.vol_conf, 0) as vol_conf,
            app.produtividade_norm_digits(v.aud) as aud_digits,
            app.produtividade_norm_text(v.aud) as aud_norm,
            timezone('America/Sao_Paulo', now())::date as event_date,
            v.updated_at
        from app.db_prod_vol v
        where v.cd = p_cd
          and coalesce(v.vol_conf, 0) > 0
    ),
    prod_blitz_src as (
        select
            b.cd,
            b.filial,
            b.nr_pedido,
            coalesce(b.auditor, '') as auditor,
            coalesce(b.qtd_un, 0) as qtd_un,
            app.produtividade_norm_digits(b.auditor) as aud_digits,
            app.produtividade_norm_text(b.auditor) as aud_norm,
            coalesce(
                timezone('America/Sao_Paulo', b.dt_conf)::date,
                timezone('America/Sao_Paulo', b.updated_at)::date
            ) as event_date,
            coalesce(b.dt_conf, b.updated_at) as event_at
        from app.db_prod_blitz b
        where b.cd = p_cd
          and coalesce(b.qtd_un, 0) > 0
    )
    select
        e.activity_key,
        e.activity_label,
        e.unit_label,
        e.user_id,
        e.mat,
        e.nome,
        e.event_date,
        e.metric_value,
        e.detail,
        e.source_ref,
        e.event_at
    from (
        select
            'coleta_sku'::text as activity_key,
            'Coleta de Mercadoria'::text as activity_label,
            'sku'::text as unit_label,
            c.user_id,
            c.mat_aud as mat,
            c.nome_aud as nome,
            timezone('America/Sao_Paulo', c.data_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | %s', c.coddv, left(coalesce(c.descricao, ''), 110)) as detail,
            c.id::text as source_ref,
            c.data_hr as event_at
        from app.aud_coleta c
        where c.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', c.data_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', c.data_hr)::date <= p_dt_fim)

        union all

        select
            'pvps_endereco'::text as activity_key,
            'PVPS'::text as activity_label,
            'endereços'::text as unit_label,
            p.auditor_id as user_id,
            p.auditor_mat as mat,
            p.auditor_nome as nome,
            timezone('America/Sao_Paulo', p.dt_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('SEP %s | Coddv %s', p.end_sep, p.coddv) as detail,
            p.audit_id::text as source_ref,
            p.dt_hr as event_at
        from app.aud_pvps p
        where p.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', p.dt_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', p.dt_hr)::date <= p_dt_fim)

        union all

        select
            'atividade_extra_pontos'::text as activity_key,
            'Atividade Extra'::text as activity_label,
            'pontos'::text as unit_label,
            a.user_id,
            a.mat,
            a.nome,
            a.data_inicio as event_date,
            round(coalesce(a.pontos, 0), 3)::numeric(18,3) as metric_value,
            left(coalesce(a.descricao, ''), 160) as detail,
            a.id::text as source_ref,
            a.created_at as event_at
        from app.atividade_extra a
        where a.cd = p_cd
          and (p_dt_ini is null or a.data_inicio >= p_dt_ini)
          and (p_dt_fim is null or a.data_inicio <= p_dt_fim)

        union all

        select
            'alocacao_endereco'::text as activity_key,
            'Alocação'::text as activity_label,
            'endereços'::text as unit_label,
            a.auditor_id as user_id,
            a.auditor_mat as mat,
            a.auditor_nome as nome,
            timezone('America/Sao_Paulo', a.dt_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Endereço %s | Coddv %s', a.endereco, a.coddv) as detail,
            a.audit_id::text as source_ref,
            a.dt_hr as event_at
        from app.aud_alocacao a
        where a.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', a.dt_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', a.dt_hr)::date <= p_dt_fim)

        union all

        select
            'entrada_notas_sku'::text as activity_key,
            'Entrada de Notas'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_entrada_notas_itens i
        join app.conf_entrada_notas c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'termo_sku'::text as activity_key,
            'Conferência de Termo'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_termo_itens i
        join app.conf_termo c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'pedido_direto_sku'::text as activity_key,
            'Conferência Pedido Direto'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_pedido_direto_itens i
        join app.conf_pedido_direto c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'zerados_endereco'::text as activity_key,
            'Inventário (Zerados)'::text as activity_label,
            'endereços'::text as unit_label,
            z.user_id,
            z.mat,
            z.nome,
            z.event_date,
            1::numeric(18,3) as metric_value,
            format('Zona %s | Endereço %s | Etapa %s', z.zona, z.endereco, z.etapa) as detail,
            z.source_ref,
            z.event_at
        from inventario_enderecos z
        where (p_dt_ini is null or z.event_date >= p_dt_ini)
          and (p_dt_fim is null or z.event_date <= p_dt_fim)

        union all

        select
            'devolucao_nfd'::text as activity_key,
            'Devolução de Mercadoria'::text as activity_label,
            'nfd'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) as event_date,
            1::numeric(18,3) as metric_value,
            coalesce(
                format('NFD %s', c.nfd::text),
                format('Chave %s', nullif(trim(coalesce(c.chave, '')), '')),
                format('Ref %s', left(c.conf_id::text, 8))
            ) as detail,
            c.conf_id::text as source_ref,
            coalesce(c.finalized_at, c.updated_at) as event_at
        from app.conf_devolucao c
        where c.cd = p_cd
          and c.conference_kind = 'com_nfd'
          and c.status in ('finalizado_ok', 'finalizado_falta')
          and (
              p_dt_ini is null
              or coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) >= p_dt_ini
          )
          and (
              p_dt_fim is null
              or coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) <= p_dt_fim
          )

        union all

        select
            'prod_vol_mes'::text as activity_key,
            'Produtividade Volume (base externa)'::text as activity_label,
            'volume'::text as unit_label,
            pr.user_id,
            pr.mat,
            pr.nome,
            v.event_date,
            v.vol_conf::numeric(18,3) as metric_value,
            format('Auditor "%s" | total mensal', nullif(trim(v.aud), '')) as detail,
            format('prod_vol:%s', nullif(trim(v.aud), '')) as source_ref,
            v.updated_at as event_at
        from prod_vol_src v
        join lateral (
            select
                p.user_id,
                p.mat,
                p.nome
            from profiles_cd p
            where (
                v.aud_digits <> ''
                and p.mat_norm = v.aud_digits
            ) or (
                v.aud_norm <> ''
                and p.nome_norm = v.aud_norm
            )
            order by
                case when v.aud_digits <> '' and p.mat_norm = v.aud_digits then 0 else 1 end,
                p.user_id
            limit 1
        ) pr on true
        where (p_dt_ini is null or v.event_date >= p_dt_ini)
          and (p_dt_fim is null or v.event_date <= p_dt_fim)

        union all

        select
            'prod_blitz_un'::text as activity_key,
            'Produtividade Blitz (base externa)'::text as activity_label,
            'unidades'::text as unit_label,
            pr.user_id,
            pr.mat,
            pr.nome,
            b.event_date,
            b.qtd_un::numeric(18,3) as metric_value,
            format('Filial %s | Pedido %s', b.filial::text, b.nr_pedido::text) as detail,
            format('prod_blitz:%s:%s', b.filial::text, b.nr_pedido::text) as source_ref,
            b.event_at
        from prod_blitz_src b
        join lateral (
            select
                p.user_id,
                p.mat,
                p.nome
            from profiles_cd p
            where (
                b.aud_digits <> ''
                and p.mat_norm = b.aud_digits
            ) or (
                b.aud_norm <> ''
                and p.nome_norm = b.aud_norm
            )
            order by
                case when b.aud_digits <> '' and p.mat_norm = b.aud_digits then 0 else 1 end,
                p.user_id
            limit 1
        ) pr on true
        where (p_dt_ini is null or b.event_date >= p_dt_ini)
          and (p_dt_fim is null or b.event_date <= p_dt_fim)
    ) e;
$$;

create or replace function public.rpc_produtividade_visibility_get(p_cd integer default null)
returns table (
    cd integer,
    visibility_mode text,
    updated_by uuid,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
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

    v_cd := app.produtividade_resolve_cd(p_cd);

    return query
    with settings_row as (
        select
            st.visibility_mode,
            st.updated_by,
            st.updated_at
        from app.produtividade_cd_settings st
        where st.cd = v_cd
        limit 1
    )
    select
        v_cd as cd,
        coalesce(sr.visibility_mode, 'public_cd') as visibility_mode,
        sr.updated_by,
        sr.updated_at
    from settings_row sr
    right join (select 1) as d on true;
end;
$$;

create or replace function public.rpc_produtividade_visibility_set(
    p_cd integer,
    p_visibility_mode text
)
returns table (
    cd integer,
    visibility_mode text,
    updated_by uuid,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if authz.user_role(v_uid) <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    v_cd := app.produtividade_resolve_cd(p_cd);
    v_mode := lower(trim(coalesce(p_visibility_mode, '')));

    if v_mode not in ('public_cd', 'owner_only') then
        raise exception 'VISIBILIDADE_INVALIDA';
    end if;

    insert into app.produtividade_cd_settings as st (
        cd,
        visibility_mode,
        updated_by,
        updated_at
    )
    values (
        v_cd,
        v_mode,
        v_uid,
        now()
    )
    on conflict (cd)
    do update set
        visibility_mode = excluded.visibility_mode,
        updated_by = excluded.updated_by,
        updated_at = now();

    return query
    select
        st.cd,
        st.visibility_mode,
        st.updated_by,
        st.updated_at
    from app.produtividade_cd_settings st
    where st.cd = v_cd
    limit 1;
end;
$$;

create or replace function public.rpc_produtividade_collaborators(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null
)
returns table (
    user_id uuid,
    mat text,
    nome text,
    registros_count bigint,
    dias_ativos bigint,
    atividades_count bigint,
    valor_total numeric(18,3)
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
    v_is_admin boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.produtividade_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';
    v_mode := app.produtividade_visibility_mode(v_cd);

    return query
    with filtered as (
        select *
        from app.produtividade_events_base(v_cd, p_dt_ini, p_dt_fim) e
        where v_is_admin
           or v_mode = 'public_cd'
           or e.user_id = v_uid
    )
    select
        f.user_id,
        min(f.mat) as mat,
        min(f.nome) as nome,
        count(*)::bigint as registros_count,
        count(distinct f.event_date)::bigint as dias_ativos,
        count(distinct f.activity_key)::bigint as atividades_count,
        round(coalesce(sum(f.metric_value), 0), 3)::numeric(18,3) as valor_total
    from filtered f
    group by f.user_id
    order by
        count(distinct f.event_date) desc,
        round(coalesce(sum(f.metric_value), 0), 3) desc,
        min(f.nome);
end;
$$;

create or replace function public.rpc_produtividade_activity_totals(
    p_cd integer default null,
    p_target_user_id uuid default null,
    p_dt_ini date default null,
    p_dt_fim date default null
)
returns table (
    sort_order integer,
    activity_key text,
    activity_label text,
    unit_label text,
    registros_count bigint,
    valor_total numeric(18,3),
    last_event_date date
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
    v_is_admin boolean;
    v_target_user_id uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.produtividade_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';
    v_mode := app.produtividade_visibility_mode(v_cd);
    v_target_user_id := coalesce(p_target_user_id, v_uid);

    if v_target_user_id <> v_uid
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    return query
    with catalog as (
        select * from (
            values
                (1, 'coleta_sku', 'Coleta de Mercadoria', 'sku'),
                (2, 'pvps_endereco', 'PVPS', 'endereços'),
                (3, 'atividade_extra_pontos', 'Atividade Extra', 'pontos'),
                (4, 'alocacao_endereco', 'Alocação', 'endereços'),
                (5, 'entrada_notas_sku', 'Entrada de Notas', 'sku'),
                (6, 'termo_sku', 'Conferência de Termo', 'sku'),
                (7, 'pedido_direto_sku', 'Conferência Pedido Direto', 'sku'),
                (8, 'zerados_endereco', 'Inventário (Zerados)', 'endereços'),
                (9, 'devolucao_nfd', 'Devolução de Mercadoria', 'nfd'),
                (10, 'prod_blitz_un', 'Produtividade Blitz (base externa)', 'unidades'),
                (11, 'prod_vol_mes', 'Produtividade Volume (base externa)', 'volume'),
                (12, 'registro_embarque_loja', 'Registro de Embarque', 'lojas')
        ) as t(sort_order, activity_key, activity_label, unit_label)
    ),
    agg as (
        select
            e.activity_key,
            count(*)::bigint as registros_count,
            round(coalesce(sum(e.metric_value), 0), 3)::numeric(18,3) as valor_total,
            max(e.event_date) as last_event_date
        from app.produtividade_events_base(v_cd, p_dt_ini, p_dt_fim) e
        where e.user_id = v_target_user_id
          and (
              v_is_admin
              or v_mode = 'public_cd'
              or e.user_id = v_uid
          )
        group by e.activity_key
    )
    select
        c.sort_order,
        c.activity_key,
        c.activity_label,
        c.unit_label,
        coalesce(a.registros_count, 0)::bigint as registros_count,
        coalesce(a.valor_total, 0)::numeric(18,3) as valor_total,
        a.last_event_date
    from catalog c
    left join agg a
      on a.activity_key = c.activity_key
    order by c.sort_order;
end;
$$;

create or replace function public.rpc_produtividade_daily(
    p_cd integer default null,
    p_target_user_id uuid default null,
    p_dt_ini date default null,
    p_dt_fim date default null
)
returns table (
    date_ref date,
    activity_key text,
    activity_label text,
    unit_label text,
    registros_count bigint,
    valor_total numeric(18,3)
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
    v_is_admin boolean;
    v_target_user_id uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.produtividade_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';
    v_mode := app.produtividade_visibility_mode(v_cd);
    v_target_user_id := coalesce(p_target_user_id, v_uid);

    if v_target_user_id <> v_uid
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    return query
    select
        e.event_date as date_ref,
        e.activity_key,
        min(e.activity_label) as activity_label,
        min(e.unit_label) as unit_label,
        count(*)::bigint as registros_count,
        round(coalesce(sum(e.metric_value), 0), 3)::numeric(18,3) as valor_total
    from app.produtividade_events_base(v_cd, p_dt_ini, p_dt_fim) e
    where e.user_id = v_target_user_id
      and (
          v_is_admin
          or v_mode = 'public_cd'
          or e.user_id = v_uid
      )
    group by e.event_date, e.activity_key
    order by e.event_date desc, e.activity_key;
end;
$$;

create or replace function public.rpc_produtividade_entries(
    p_cd integer default null,
    p_target_user_id uuid default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_activity_key text default null,
    p_limit integer default 400
)
returns table (
    entry_id text,
    event_at timestamptz,
    event_date date,
    activity_key text,
    activity_label text,
    unit_label text,
    metric_value numeric(18,3),
    detail text,
    source_ref text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
    v_is_admin boolean;
    v_target_user_id uuid;
    v_activity_key text;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.produtividade_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';
    v_mode := app.produtividade_visibility_mode(v_cd);
    v_target_user_id := coalesce(p_target_user_id, v_uid);
    v_activity_key := nullif(lower(trim(coalesce(p_activity_key, ''))), '');
    v_limit := greatest(1, least(coalesce(p_limit, 400), 2000));

    if v_target_user_id <> v_uid
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    if v_activity_key is not null and v_activity_key not in (
        'coleta_sku',
        'pvps_endereco',
        'atividade_extra_pontos',
        'alocacao_endereco',
        'entrada_notas_sku',
        'termo_sku',
        'pedido_direto_sku',
        'zerados_endereco',
        'devolucao_nfd',
        'prod_blitz_un',
        'prod_vol_mes',
        'registro_embarque_loja'
    ) then
        raise exception 'ATIVIDADE_INVALIDA';
    end if;

    return query
    select
        concat_ws(
            ':',
            e.activity_key,
            to_char(e.event_date, 'YYYYMMDD'),
            coalesce(e.source_ref, left(md5(coalesce(e.detail, '')), 12))
        ) as entry_id,
        e.event_at,
        e.event_date,
        e.activity_key,
        e.activity_label,
        e.unit_label,
        e.metric_value,
        e.detail,
        e.source_ref
    from app.produtividade_events_base(v_cd, p_dt_ini, p_dt_fim) e
    where e.user_id = v_target_user_id
      and (
          v_is_admin
          or v_mode = 'public_cd'
          or e.user_id = v_uid
      )
      and (v_activity_key is null or e.activity_key = v_activity_key)
    order by
        e.event_date desc,
        e.event_at desc nulls last,
        e.activity_label,
        e.source_ref
    limit v_limit;
end;
$$;

grant execute on function public.rpc_produtividade_visibility_get(integer) to authenticated;
grant execute on function public.rpc_produtividade_visibility_set(integer, text) to authenticated;
grant execute on function public.rpc_produtividade_collaborators(integer, date, date) to authenticated;
grant execute on function public.rpc_produtividade_activity_totals(integer, uuid, date, date) to authenticated;
grant execute on function public.rpc_produtividade_daily(integer, uuid, date, date) to authenticated;
grant execute on function public.rpc_produtividade_entries(integer, uuid, date, date, text, integer) to authenticated;
