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
                (10, 'prod_blitz_un', 'Produtividade Blitz', 'unidades'),
                (11, 'prod_vol_mes', 'Volume Expedido', 'volume'),
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
        case
            when e.activity_key = 'prod_blitz_un' then 'Produtividade Blitz'::text
            when e.activity_key = 'prod_vol_mes' then 'Volume Expedido'::text
            else min(e.activity_label)
        end as activity_label,
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
        case
            when e.activity_key = 'prod_blitz_un' then 'Produtividade Blitz'::text
            when e.activity_key = 'prod_vol_mes' then 'Volume Expedido'::text
            else e.activity_label
        end as activity_label,
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

grant execute on function public.rpc_produtividade_activity_totals(integer, uuid, date, date) to authenticated;
grant execute on function public.rpc_produtividade_daily(integer, uuid, date, date) to authenticated;
grant execute on function public.rpc_produtividade_entries(integer, uuid, date, date, text, integer) to authenticated;
