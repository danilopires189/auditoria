create or replace function app.produtividade_events_base_origem(
    p_cd integer,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_origem_link text default 'prevencaocd'
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
    with resolved_origem as (
        select app.conf_pedido_direto_resolve_origem_link(p_origem_link) as origem_link
    )
    select
        b.activity_key,
        b.activity_label,
        b.unit_label,
        b.user_id,
        b.mat,
        b.nome,
        b.event_date,
        b.metric_value,
        b.detail,
        b.source_ref,
        b.event_at
    from app.produtividade_events_base(p_cd, p_dt_ini, p_dt_fim) b
    left join app.conf_pedido_direto_itens i
      on b.activity_key = 'pedido_direto_sku'
     and b.source_ref = i.item_id::text
    left join app.conf_pedido_direto c
      on c.conf_id = i.conf_id
    where b.activity_key <> 'pedido_direto_sku'
       or c.origem_link = (select origem_link from resolved_origem);
$$;

create or replace function app.meta_mes_actuals_month(
    p_cd integer,
    p_month_start date,
    p_origem_link text
)
returns table (
    activity_key text,
    date_ref date,
    actual_value numeric(18, 3),
    updated_at timestamptz
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
    with resolved_origem as (
        select app.conf_pedido_direto_resolve_origem_link(p_origem_link) as origem_link
    ),
    month_bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    base as (
        select
            src.activity_key,
            src.date_ref,
            src.actual_value,
            src.updated_at
        from app.meta_mes_actuals_month(p_cd, p_month_start) src
        where src.activity_key <> 'pedido_direto_conferencia'
    ),
    pedido_direto_daily as (
        select
            'pedido_direto_conferencia'::text as activity_key,
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) as date_ref,
            count(distinct c.conf_id)::numeric(18, 3) as actual_value,
            max(coalesce(c.finalized_at, c.updated_at)) as updated_at
        from app.conf_pedido_direto c
        cross join month_bounds mb
        cross join resolved_origem ro
        where c.cd = p_cd
          and c.origem_link = ro.origem_link
          and c.status in ('finalizado_ok', 'finalizado_falta')
          and coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) >= mb.month_start
          and coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) <= mb.month_end
        group by 2
    )
    select
        src.activity_key,
        src.date_ref,
        src.actual_value,
        src.updated_at
    from base src

    union all

    select
        pd.activity_key,
        pd.date_ref,
        pd.actual_value,
        pd.updated_at
    from pedido_direto_daily pd
    where pd.date_ref is not null;
$$;

create or replace function app.meta_mes_daily_activity(
    p_cd integer,
    p_activity_key text,
    p_month_start date,
    p_origem_link text
)
returns table (
    date_ref date,
    day_number integer,
    weekday_label text,
    target_kind text,
    target_value numeric(18, 3),
    actual_value numeric(18, 3),
    percent_achievement numeric(18, 3),
    delta_value numeric(18, 3),
    cumulative_target numeric(18, 3),
    cumulative_actual numeric(18, 3),
    cumulative_percent numeric(18, 3),
    status text,
    is_holiday boolean,
    is_sunday boolean,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_activity record;
begin
    select *
    into v_activity
    from app.meta_mes_activity_catalog() catalog
    where catalog.activity_key = nullif(trim(coalesce(p_activity_key, '')), '')
    limit 1;

    if v_activity.activity_key is null then
        raise exception 'ATIVIDADE_INVALIDA';
    end if;

    return query
    with month_bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    days as (
        select generate_series(mb.month_start, mb.month_end, interval '1 day')::date as date_ref
        from month_bounds mb
    ),
    actuals as (
        select
            a.date_ref,
            a.actual_value,
            a.updated_at
        from app.meta_mes_actuals_month(p_cd, p_month_start, p_origem_link) a
        where a.activity_key = v_activity.activity_key
    ),
    effective_target as (
        select
            et.month_start,
            et.daily_target_value,
            et.updated_at
        from app.meta_mes_effective_month_target(p_cd, v_activity.activity_key, p_month_start) et
    ),
    holidays as (
        select
            t.date_ref,
            true as is_holiday,
            max(t.updated_at) as updated_at
        from app.meta_mes_daily_targets t
        cross join month_bounds mb
        where t.cd = p_cd
          and t.activity_key = v_activity.activity_key
          and coalesce(t.is_holiday, false)
          and t.date_ref >= mb.month_start
          and t.date_ref <= mb.month_end
        group by t.date_ref
    ),
    base as (
        select
            d.date_ref,
            extract(day from d.date_ref)::integer as day_number,
            case extract(isodow from d.date_ref)
                when 1 then 'Seg'
                when 2 then 'Ter'
                when 3 then 'Qua'
                when 4 then 'Qui'
                when 5 then 'Sex'
                when 6 then 'Sáb'
                else 'Dom'
            end as weekday_label,
            (extract(isodow from d.date_ref) = 7) as is_sunday,
            coalesce(h.is_holiday, false) as is_holiday,
            case
                when extract(isodow from d.date_ref) = 7 then 'domingo'
                when coalesce(h.is_holiday, false) then 'feriado'
                when et.daily_target_value is null then 'sem_meta'
                else 'meta'
            end as target_kind,
            case
                when extract(isodow from d.date_ref) = 7 then 0::numeric(18, 3)
                when coalesce(h.is_holiday, false) then null::numeric(18, 3)
                else et.daily_target_value
            end as target_value,
            coalesce(a.actual_value, 0)::numeric(18, 3) as actual_value,
            greatest(
                coalesce(a.updated_at, '-infinity'::timestamptz),
                coalesce(h.updated_at, '-infinity'::timestamptz),
                coalesce(et.updated_at, '-infinity'::timestamptz)
            ) as updated_at
        from days d
        left join actuals a
          on a.date_ref = d.date_ref
        left join holidays h
          on h.date_ref = d.date_ref
        left join effective_target et
          on true
    ),
    normalized as (
        select
            b.*,
            nullif(b.updated_at, '-infinity'::timestamptz) as normalized_updated_at
        from base b
    ),
    with_running as (
        select
            b.date_ref,
            b.day_number,
            b.weekday_label,
            b.target_kind,
            b.target_value,
            b.actual_value,
            case
                when b.target_kind = 'meta' and coalesce(b.target_value, 0) > 0
                    then round((b.actual_value / b.target_value) * 100, 3)
                else null::numeric
            end as percent_achievement,
            case
                when b.target_kind = 'meta'
                    then round(b.actual_value - coalesce(b.target_value, 0), 3)
                else null::numeric
            end as delta_value,
            sum(
                case
                    when b.target_kind = 'meta' then coalesce(b.target_value, 0)
                    else 0
                end
            ) over (order by b.date_ref rows between unbounded preceding and current row)::numeric(18, 3) as cumulative_target,
            sum(b.actual_value) over (order by b.date_ref rows between unbounded preceding and current row)::numeric(18, 3) as cumulative_actual,
            case
                when sum(
                    case
                        when b.target_kind = 'meta' then coalesce(b.target_value, 0)
                        else 0
                    end
                ) over (order by b.date_ref rows between unbounded preceding and current row) > 0
                then round(
                    (
                        sum(b.actual_value) over (order by b.date_ref rows between unbounded preceding and current row)
                        / nullif(
                            sum(
                                case
                                    when b.target_kind = 'meta' then coalesce(b.target_value, 0)
                                    else 0
                                end
                            ) over (order by b.date_ref rows between unbounded preceding and current row),
                            0
                        )
                    ) * 100,
                    3
                )
                else null::numeric
            end as cumulative_percent,
            case
                when b.target_kind = 'feriado' then 'feriado'
                when b.target_kind = 'domingo' then 'domingo'
                when b.target_kind = 'sem_meta' then 'sem_meta'
                when b.actual_value > coalesce(b.target_value, 0) then 'acima'
                when b.actual_value = coalesce(b.target_value, 0) then 'atingiu'
                else 'abaixo'
            end as status,
            b.is_holiday,
            b.is_sunday,
            b.normalized_updated_at as updated_at
        from normalized b
    )
    select
        wr.date_ref,
        wr.day_number,
        wr.weekday_label,
        wr.target_kind,
        wr.target_value,
        wr.actual_value,
        wr.percent_achievement,
        wr.delta_value,
        wr.cumulative_target,
        wr.cumulative_actual,
        wr.cumulative_percent,
        wr.status,
        wr.is_holiday,
        wr.is_sunday,
        wr.updated_at
    from with_running wr
    order by wr.date_ref;
end;
$$;

drop function if exists public.rpc_produtividade_collaborators(integer, date, date);
create or replace function public.rpc_produtividade_collaborators(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_origem_link text default 'prevencaocd'
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
        from app.produtividade_events_base_origem(v_cd, p_dt_ini, p_dt_fim, p_origem_link) e
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

drop function if exists public.rpc_produtividade_activity_totals(integer, uuid, date, date);
create or replace function public.rpc_produtividade_activity_totals(
    p_cd integer default null,
    p_target_user_id uuid default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_origem_link text default 'prevencaocd'
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

    if p_target_user_id is not null
       and p_target_user_id <> v_uid
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    if p_target_user_id is null
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    return query
    with catalog as (
        select c.sort_order, c.activity_key, c.activity_label, c.unit_label
        from app.produtividade_indicator_catalog() c
    ),
    agg as (
        select
            e.activity_key,
            count(*)::bigint as registros_count,
            round(coalesce(sum(e.metric_value), 0), 3)::numeric(18,3) as valor_total,
            max(e.event_date) as last_event_date
        from app.produtividade_events_base_origem(v_cd, p_dt_ini, p_dt_fim, p_origem_link) e
        where (p_target_user_id is null or e.user_id = p_target_user_id)
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

drop function if exists public.rpc_produtividade_daily(integer, uuid, date, date);
create or replace function public.rpc_produtividade_daily(
    p_cd integer default null,
    p_target_user_id uuid default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_origem_link text default 'prevencaocd'
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

    if p_target_user_id is not null
       and p_target_user_id <> v_uid
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
    from app.produtividade_events_base_origem(v_cd, p_dt_ini, p_dt_fim, p_origem_link) e
    where (p_target_user_id is null or e.user_id = p_target_user_id)
      and (
          v_is_admin
          or v_mode = 'public_cd'
          or e.user_id = v_uid
      )
    group by e.event_date, e.activity_key
    order by e.event_date desc, e.activity_key;
end;
$$;

drop function if exists public.rpc_produtividade_entries(integer, uuid, date, date, text, integer);
create or replace function public.rpc_produtividade_entries(
    p_cd integer default null,
    p_target_user_id uuid default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_activity_key text default null,
    p_limit integer default 400,
    p_origem_link text default 'prevencaocd'
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
    source_ref text,
    mat text,
    nome text
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
    v_activity_key := nullif(lower(trim(coalesce(p_activity_key, ''))), '');
    v_limit := greatest(1, least(coalesce(p_limit, 400), 2000));

    if p_target_user_id is not null
       and p_target_user_id <> v_uid
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    if p_target_user_id is null
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    if v_activity_key is not null and not exists (
        select 1
        from app.produtividade_indicator_catalog() c
        where c.activity_key = v_activity_key
    ) then
        raise exception 'ATIVIDADE_INVALIDA';
    end if;

    return query
    select
        concat_ws(
            ':',
            e.activity_key,
            to_char(e.event_date, 'YYYYMMDD'),
            e.user_id::text,
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
        e.source_ref,
        e.mat,
        e.nome
    from app.produtividade_events_base_origem(v_cd, p_dt_ini, p_dt_fim, p_origem_link) e
    where (p_target_user_id is null or e.user_id = p_target_user_id)
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

drop function if exists public.rpc_produtividade_ranking(integer, integer, integer);
create or replace function public.rpc_produtividade_ranking(
    p_cd integer default null,
    p_mes integer default null,
    p_ano integer default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    user_id uuid,
    mat text,
    nome text,
    posicao integer,
    coleta_pontos numeric(18,3),
    coleta_qtd numeric(18,3),
    pvps_pontos numeric(18,3),
    pvps_qtd numeric(18,3),
    vol_pontos numeric(18,3),
    vol_qtd numeric(18,3),
    blitz_pontos numeric(18,3),
    blitz_qtd numeric(18,3),
    zerados_pontos numeric(18,3),
    zerados_qtd numeric(18,3),
    atividade_extra_pontos numeric(18,3),
    atividade_extra_qtd numeric(18,3),
    alocacao_pontos numeric(18,3),
    alocacao_qtd numeric(18,3),
    devolucao_pontos numeric(18,3),
    devolucao_qtd numeric(18,3),
    conf_termo_pontos numeric(18,3),
    conf_termo_qtd numeric(18,3),
    conf_avulso_pontos numeric(18,3),
    conf_avulso_qtd numeric(18,3),
    pedido_direto_pontos numeric(18,3),
    pedido_direto_qtd numeric(18,3),
    conf_entrada_pontos numeric(18,3),
    conf_entrada_qtd numeric(18,3),
    conf_transferencia_cd_pontos numeric(18,3),
    conf_transferencia_cd_qtd numeric(18,3),
    conf_lojas_pontos numeric(18,3),
    conf_lojas_qtd numeric(18,3),
    aud_caixa_pontos numeric(18,3),
    aud_caixa_qtd numeric(18,3),
    caixa_termica_pontos numeric(18,3),
    caixa_termica_qtd numeric(18,3),
    ronda_quality_pontos numeric(18,3),
    ronda_quality_qtd numeric(18,3),
    checklist_pontos numeric(18,3),
    checklist_qtd numeric(18,3),
    total_pontos numeric(18,3)
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
    v_dt_ini date;
    v_dt_fim date;
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

    if p_mes is not null and p_ano is not null then
        v_dt_ini := make_date(p_ano, p_mes, 1);
        v_dt_fim := (v_dt_ini + interval '1 month' - interval '1 day')::date;
    else
        v_dt_ini := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
        v_dt_fim := (v_dt_ini + interval '1 month' - interval '1 day')::date;
    end if;

    return query
    with base as materialized (
        select
            e.user_id,
            e.mat,
            e.nome,
            e.activity_key,
            e.metric_value
        from app.produtividade_events_base_origem(v_cd, v_dt_ini, v_dt_fim, p_origem_link) e
        where (
            v_is_admin
            or v_mode = 'public_cd'
            or e.user_id = v_uid
        )
          and e.activity_key in (
            'coleta_sku',
            'pvps_endereco',
            'prod_vol_mes',
            'prod_blitz_un',
            'zerados_endereco',
            'atividade_extra_pontos',
            'alocacao_endereco',
            'devolucao_nfd',
            'termo_sku',
            'avulso_sku',
            'pedido_direto_sku',
            'entrada_notas_sku',
            'transferencia_cd_sku',
            'registro_embarque_loja',
            'auditoria_caixa_volume',
            'caixa_termica_mov',
            'ronda_quality_auditoria',
            'checklist_auditoria'
          )
    ),
    por_atividade as materialized (
        select
            b.user_id,
            min(b.mat) as mat,
            min(b.nome) as nome,
            sum(case when b.activity_key = 'coleta_sku' then b.metric_value else 0 end)::numeric(18,3) as coleta_qtd,
            sum(case when b.activity_key = 'pvps_endereco' then b.metric_value else 0 end)::numeric(18,3) as pvps_qtd,
            sum(case when b.activity_key = 'prod_vol_mes' then b.metric_value else 0 end)::numeric(18,3) as vol_qtd,
            sum(case when b.activity_key = 'prod_blitz_un' then b.metric_value else 0 end)::numeric(18,3) as blitz_qtd,
            sum(case when b.activity_key = 'zerados_endereco' then b.metric_value else 0 end)::numeric(18,3) as zerados_qtd,
            count(*) filter (where b.activity_key = 'atividade_extra_pontos')::numeric(18,3) as atividade_extra_qtd,
            sum(case when b.activity_key = 'atividade_extra_pontos' then b.metric_value else 0 end)::numeric(18,3) as atividade_extra_pontos,
            sum(case when b.activity_key = 'alocacao_endereco' then b.metric_value else 0 end)::numeric(18,3) as alocacao_qtd,
            sum(case when b.activity_key = 'devolucao_nfd' then b.metric_value else 0 end)::numeric(18,3) as devolucao_qtd,
            sum(case when b.activity_key = 'termo_sku' then b.metric_value else 0 end)::numeric(18,3) as conf_termo_qtd,
            sum(case when b.activity_key = 'avulso_sku' then b.metric_value else 0 end)::numeric(18,3) as conf_avulso_qtd,
            sum(case when b.activity_key = 'pedido_direto_sku' then b.metric_value else 0 end)::numeric(18,3) as pedido_direto_qtd,
            sum(case when b.activity_key = 'entrada_notas_sku' then b.metric_value else 0 end)::numeric(18,3) as conf_entrada_qtd,
            sum(case when b.activity_key = 'transferencia_cd_sku' then b.metric_value else 0 end)::numeric(18,3) as conf_transferencia_cd_qtd,
            sum(case when b.activity_key = 'registro_embarque_loja' then b.metric_value else 0 end)::numeric(18,3) as conf_lojas_qtd,
            sum(case when b.activity_key = 'auditoria_caixa_volume' then b.metric_value else 0 end)::numeric(18,3) as aud_caixa_qtd,
            count(*) filter (where b.activity_key = 'caixa_termica_mov')::numeric(18,3) as caixa_termica_qtd,
            sum(case when b.activity_key = 'ronda_quality_auditoria' then b.metric_value else 0 end)::numeric(18,3) as ronda_quality_qtd,
            sum(case when b.activity_key = 'checklist_auditoria' then b.metric_value else 0 end)::numeric(18,3) as checklist_qtd
        from base b
        group by b.user_id
    ),
    ranks as materialized (
        select
            a.*,
            dense_rank() over (order by a.pvps_qtd desc) as pvps_rank,
            dense_rank() over (order by a.vol_qtd desc) as vol_rank,
            dense_rank() over (order by a.blitz_qtd desc) as blitz_rank,
            dense_rank() over (order by a.zerados_qtd desc) as zerados_rank,
            dense_rank() over (order by a.alocacao_qtd desc) as alocacao_rank,
            dense_rank() over (order by a.devolucao_qtd desc) as devolucao_rank,
            dense_rank() over (order by a.conf_termo_qtd desc) as conf_termo_rank,
            dense_rank() over (order by a.conf_avulso_qtd desc) as conf_avulso_rank,
            dense_rank() over (order by a.pedido_direto_qtd desc) as pedido_direto_rank,
            dense_rank() over (order by a.conf_entrada_qtd desc) as conf_entrada_rank,
            dense_rank() over (order by a.conf_transferencia_cd_qtd desc) as conf_transferencia_cd_rank,
            dense_rank() over (order by a.conf_lojas_qtd desc) as conf_lojas_rank,
            dense_rank() over (order by a.aud_caixa_qtd desc) as aud_caixa_rank,
            dense_rank() over (order by a.caixa_termica_qtd desc) as caixa_termica_rank,
            dense_rank() over (order by a.ronda_quality_qtd desc) as ronda_quality_rank,
            dense_rank() over (order by a.checklist_qtd desc) as checklist_rank
        from por_atividade a
    ),
    pontuado as (
        select
            r.user_id,
            r.mat,
            r.nome,
            0::numeric(18,3) as coleta_pontos,
            round(r.coleta_qtd, 3)::numeric(18,3) as coleta_qtd,
            round(case when r.pvps_qtd > 0 then greatest(0.5, 3.5 - (r.pvps_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as pvps_pontos,
            round(r.pvps_qtd, 3)::numeric(18,3) as pvps_qtd,
            round(case when r.vol_qtd > 0 then greatest(0.5, 10.0 - (r.vol_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as vol_pontos,
            round(r.vol_qtd, 3)::numeric(18,3) as vol_qtd,
            round(case when r.blitz_qtd > 0 then greatest(0.5, 10.0 - (r.blitz_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as blitz_pontos,
            round(r.blitz_qtd, 3)::numeric(18,3) as blitz_qtd,
            round(case when r.zerados_qtd > 0 then greatest(0.5, 3.5 - (r.zerados_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as zerados_pontos,
            round(r.zerados_qtd, 3)::numeric(18,3) as zerados_qtd,
            round(r.atividade_extra_pontos, 3)::numeric(18,3) as atividade_extra_pontos,
            round(r.atividade_extra_qtd, 3)::numeric(18,3) as atividade_extra_qtd,
            round(case when r.alocacao_qtd > 0 then greatest(0.5, 3.5 - (r.alocacao_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as alocacao_pontos,
            round(r.alocacao_qtd, 3)::numeric(18,3) as alocacao_qtd,
            round(case when r.devolucao_qtd > 0 then greatest(0.5, 3.5 - (r.devolucao_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as devolucao_pontos,
            round(r.devolucao_qtd, 3)::numeric(18,3) as devolucao_qtd,
            round(case when r.conf_termo_qtd > 0 then greatest(0.5, 3.5 - (r.conf_termo_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as conf_termo_pontos,
            round(r.conf_termo_qtd, 3)::numeric(18,3) as conf_termo_qtd,
            round(case when r.conf_avulso_qtd > 0 then greatest(0.5, 3.5 - (r.conf_avulso_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as conf_avulso_pontos,
            round(r.conf_avulso_qtd, 3)::numeric(18,3) as conf_avulso_qtd,
            round(case when r.pedido_direto_qtd > 0 then greatest(0.5, 3.5 - (r.pedido_direto_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as pedido_direto_pontos,
            round(r.pedido_direto_qtd, 3)::numeric(18,3) as pedido_direto_qtd,
            round(case when r.conf_entrada_qtd > 0 then greatest(0.5, 3.5 - (r.conf_entrada_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as conf_entrada_pontos,
            round(r.conf_entrada_qtd, 3)::numeric(18,3) as conf_entrada_qtd,
            round(case when r.conf_transferencia_cd_qtd > 0 then greatest(0.5, 3.5 - (r.conf_transferencia_cd_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as conf_transferencia_cd_pontos,
            round(r.conf_transferencia_cd_qtd, 3)::numeric(18,3) as conf_transferencia_cd_qtd,
            round(case when r.conf_lojas_qtd > 0 then greatest(0.5, 3.5 - (r.conf_lojas_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as conf_lojas_pontos,
            round(r.conf_lojas_qtd, 3)::numeric(18,3) as conf_lojas_qtd,
            round(case when r.aud_caixa_qtd > 0 then greatest(0.5, 3.5 - (r.aud_caixa_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as aud_caixa_pontos,
            round(r.aud_caixa_qtd, 3)::numeric(18,3) as aud_caixa_qtd,
            round(case when r.caixa_termica_qtd > 0 then greatest(0.5, 3.5 - (r.caixa_termica_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as caixa_termica_pontos,
            round(r.caixa_termica_qtd, 3)::numeric(18,3) as caixa_termica_qtd,
            round(case when r.ronda_quality_qtd > 0 then greatest(0.5, 3.5 - (r.ronda_quality_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as ronda_quality_pontos,
            round(r.ronda_quality_qtd, 3)::numeric(18,3) as ronda_quality_qtd,
            round(case when r.checklist_qtd > 0 then greatest(0.2, 2.0 - (r.checklist_rank - 1) * 0.2) else 0 end, 3)::numeric(18,3) as checklist_pontos,
            round(r.checklist_qtd, 3)::numeric(18,3) as checklist_qtd
        from ranks r
    ),
    ranking as (
        select
            p.*,
            round(
                p.pvps_pontos +
                p.vol_pontos +
                p.blitz_pontos +
                p.zerados_pontos +
                p.atividade_extra_pontos +
                p.alocacao_pontos +
                p.devolucao_pontos +
                p.conf_termo_pontos +
                p.conf_avulso_pontos +
                p.pedido_direto_pontos +
                p.conf_entrada_pontos +
                p.conf_transferencia_cd_pontos +
                p.conf_lojas_pontos +
                p.aud_caixa_pontos +
                p.caixa_termica_pontos +
                p.ronda_quality_pontos +
                p.checklist_pontos,
                3
            )::numeric(18,3) as total_pontos
        from pontuado p
    )
    select
        r.user_id,
        r.mat,
        r.nome,
        dense_rank() over (order by r.total_pontos desc)::integer as posicao,
        r.coleta_pontos,
        r.coleta_qtd,
        r.pvps_pontos,
        r.pvps_qtd,
        r.vol_pontos,
        r.vol_qtd,
        r.blitz_pontos,
        r.blitz_qtd,
        r.zerados_pontos,
        r.zerados_qtd,
        r.atividade_extra_pontos,
        r.atividade_extra_qtd,
        r.alocacao_pontos,
        r.alocacao_qtd,
        r.devolucao_pontos,
        r.devolucao_qtd,
        r.conf_termo_pontos,
        r.conf_termo_qtd,
        r.conf_avulso_pontos,
        r.conf_avulso_qtd,
        r.pedido_direto_pontos,
        r.pedido_direto_qtd,
        r.conf_entrada_pontos,
        r.conf_entrada_qtd,
        r.conf_transferencia_cd_pontos,
        r.conf_transferencia_cd_qtd,
        r.conf_lojas_pontos,
        r.conf_lojas_qtd,
        r.aud_caixa_pontos,
        r.aud_caixa_qtd,
        r.caixa_termica_pontos,
        r.caixa_termica_qtd,
        r.ronda_quality_pontos,
        r.ronda_quality_qtd,
        r.checklist_pontos,
        r.checklist_qtd,
        r.total_pontos
    from ranking r
    order by r.total_pontos desc, r.nome asc;
end;
$$;

drop function if exists public.rpc_meta_mes_month_options(integer);
create or replace function public.rpc_meta_mes_month_options(
    p_cd integer default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    month_start date,
    month_label text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_origem_link text;
begin
    v_cd := app.meta_mes_resolve_cd(p_cd);
    v_origem_link := app.conf_pedido_direto_resolve_origem_link(p_origem_link);

    return query
    with available_months as (
        select date_trunc('month', timezone('America/Sao_Paulo', now())::date)::date as month_start

        union

        select date_trunc('month', timezone('America/Sao_Paulo', p.dt_hr)::date)::date
        from app.aud_pvps p
        where p.cd = v_cd

        union

        select date_trunc('month', timezone('America/Sao_Paulo', a.dt_hr)::date)::date
        from app.aud_alocacao a
        where a.cd = v_cd

        union

        select date_trunc('month', b.dt_conf)::date
        from app.db_conf_blitz b
        where b.cd = v_cd
          and b.dt_conf is not null

        union

        select date_trunc(
            'month',
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date)
        )::date
        from app.conf_entrada_notas c
        where c.cd = v_cd
          and c.status in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_parcial', 'finalizado_falta')

        union

        select date_trunc(
            'month',
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date)
        )::date
        from app.conf_termo c
        where c.cd = v_cd
          and c.status in ('finalizado_ok', 'finalizado_falta')

        union

        select date_trunc(
            'month',
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date)
        )::date
        from app.conf_pedido_direto c
        where c.cd = v_cd
          and c.origem_link = v_origem_link
          and c.status in ('finalizado_ok', 'finalizado_falta')

        union

        select date_trunc(
            'month',
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date)
        )::date
        from app.conf_volume_avulso c
        where c.cd = v_cd
          and c.status in ('finalizado_ok', 'finalizado_falta')

        union

        select date_trunc('month', c.cycle_date)::date
        from app.conf_inventario_counts c
        where c.cd = v_cd

        union

        select date_trunc('month', timezone('America/Sao_Paulo', c.data_hr)::date)::date
        from app.aud_caixa c
        where c.cd = v_cd

        union

        select date_trunc('month', timezone('America/Sao_Paulo', coalesce(a.signed_at, a.created_at))::date)::date
        from app.checklist_dto_pvps_audits a
        where a.cd = v_cd

        union

        select date_trunc('month', timezone('America/Sao_Paulo', r.created_at)::date)::date
        from app.aud_ronda_quality_sessions r
        where r.cd = v_cd

        union

        select date_trunc('month', t.date_ref)::date
        from app.meta_mes_daily_targets t
        where t.cd = v_cd

        union

        select mt.month_start
        from app.meta_mes_month_targets mt
        where mt.cd = v_cd
    )
    select
        am.month_start,
        to_char(am.month_start, 'MM/YYYY') as month_label
    from available_months am
    where am.month_start is not null
    group by am.month_start
    order by am.month_start desc;
end;
$$;

drop function if exists public.rpc_meta_mes_summary(integer, text, date);
create or replace function public.rpc_meta_mes_summary(
    p_cd integer default null,
    p_activity_key text default null,
    p_month_start date default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    activity_key text,
    activity_label text,
    unit_label text,
    value_mode text,
    month_start date,
    month_end date,
    updated_at timestamptz,
    total_actual numeric(18, 3),
    total_target numeric(18, 3),
    achievement_percent numeric(18, 3),
    daily_average numeric(18, 3),
    monthly_projection numeric(18, 3),
    days_with_target integer,
    days_hit integer,
    days_over integer,
    days_holiday integer,
    days_without_target integer,
    balance_to_target numeric(18, 3),
    daily_target_value numeric(18, 3),
    target_reference_month date,
    month_workdays integer,
    elapsed_workdays integer
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_activity record;
begin
    v_cd := app.meta_mes_resolve_cd(p_cd);

    select *
    into v_activity
    from app.meta_mes_activity_catalog() catalog
    where catalog.activity_key = nullif(trim(coalesce(p_activity_key, '')), '')
    limit 1;

    if v_activity.activity_key is null then
        raise exception 'ATIVIDADE_INVALIDA';
    end if;

    return query
    with month_bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    daily as (
        select *
        from app.meta_mes_daily_activity(v_cd, v_activity.activity_key, p_month_start, p_origem_link)
    ),
    effective_target as (
        select *
        from app.meta_mes_effective_month_target(v_cd, v_activity.activity_key, p_month_start)
    ),
    elapsed as (
        select
            least(timezone('America/Sao_Paulo', now())::date, mb.month_end) as elapsed_end
        from month_bounds mb
    ),
    aggregates as (
        select
            coalesce(sum(d.actual_value), 0)::numeric(18, 3) as total_actual,
            coalesce(sum(case when d.target_kind = 'meta' then coalesce(d.target_value, 0) else 0 end), 0)::numeric(18, 3) as total_target,
            count(*) filter (where d.target_kind = 'meta')::integer as days_with_target,
            count(*) filter (where d.target_kind = 'meta' and d.actual_value >= coalesce(d.target_value, 0))::integer as days_hit,
            count(*) filter (where d.target_kind = 'meta' and d.actual_value > coalesce(d.target_value, 0))::integer as days_over,
            count(*) filter (where d.target_kind = 'feriado')::integer as days_holiday,
            count(*) filter (where d.target_kind = 'sem_meta')::integer as days_without_target,
            max(d.updated_at) as updated_at
        from daily d
    ),
    elapsed_stats as (
        select
            coalesce(sum(d.actual_value) filter (where d.date_ref <= e.elapsed_end), 0)::numeric(18, 3) as elapsed_actual,
            count(*) filter (
                where d.date_ref <= e.elapsed_end
                  and d.target_kind not in ('domingo', 'feriado')
            )::integer as elapsed_workdays,
            count(*) filter (
                where d.target_kind not in ('domingo', 'feriado')
            )::integer as month_workdays
        from daily d
        cross join elapsed e
    )
    select
        v_activity.activity_key,
        v_activity.activity_label,
        v_activity.unit_label,
        v_activity.value_mode,
        mb.month_start,
        mb.month_end,
        nullif(
            greatest(
                coalesce(ag.updated_at, '-infinity'::timestamptz),
                coalesce(et.updated_at, '-infinity'::timestamptz)
            ),
            '-infinity'::timestamptz
        ),
        ag.total_actual,
        ag.total_target,
        case
            when ag.total_target > 0 then round((ag.total_actual / ag.total_target) * 100, 3)
            else null::numeric
        end as achievement_percent,
        case
            when es.elapsed_workdays > 0 then round(es.elapsed_actual / es.elapsed_workdays, 3)
            else ag.total_actual
        end as daily_average,
        case
            when es.elapsed_workdays > 0 and es.month_workdays > 0
                then round((es.elapsed_actual / es.elapsed_workdays) * es.month_workdays, 3)
            else ag.total_actual
        end as monthly_projection,
        ag.days_with_target,
        ag.days_hit,
        ag.days_over,
        ag.days_holiday,
        ag.days_without_target,
        round(ag.total_actual - ag.total_target, 3) as balance_to_target,
        et.daily_target_value,
        et.month_start as target_reference_month,
        es.month_workdays,
        es.elapsed_workdays
    from month_bounds mb
    cross join aggregates ag
    cross join elapsed_stats es
    left join effective_target et
      on true;
end;
$$;

drop function if exists public.rpc_meta_mes_daily_rows(integer, text, date);
create or replace function public.rpc_meta_mes_daily_rows(
    p_cd integer default null,
    p_activity_key text default null,
    p_month_start date default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    date_ref date,
    day_number integer,
    weekday_label text,
    target_kind text,
    target_value numeric(18, 3),
    actual_value numeric(18, 3),
    percent_achievement numeric(18, 3),
    delta_value numeric(18, 3),
    cumulative_target numeric(18, 3),
    cumulative_actual numeric(18, 3),
    cumulative_percent numeric(18, 3),
    status text,
    is_holiday boolean,
    is_sunday boolean,
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
    v_cd := app.meta_mes_resolve_cd(p_cd);

    return query
    select *
    from app.meta_mes_daily_activity(v_cd, p_activity_key, p_month_start, p_origem_link);
end;
$$;

drop function if exists public.rpc_apoio_gestor_daily_summary(integer, date);
create or replace function public.rpc_apoio_gestor_daily_summary(
    p_cd integer,
    p_date date default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    activity_key text,
    activity_label text,
    unit_label text,
    actual_today numeric,
    target_today numeric,
    achievement_pct numeric,
    has_meta boolean,
    sort_order integer
)
language sql
stable
security definer
set search_path = app, public
as $$
    with resolved_date as (
        select coalesce(p_date, timezone('America/Sao_Paulo', now())::date) as d
    ),

    meta_catalog as (
        select * from app.meta_mes_activity_catalog()
    ),

    meta_rows as (
        select
            c.activity_key,
            c.activity_label,
            c.unit_label,
            coalesce(day_row.actual_value, 0)::numeric as actual_today,
            case
                when day_row.target_kind = 'meta' then day_row.target_value::numeric
                else null::numeric
            end as target_today,
            case
                when day_row.target_kind = 'meta' and coalesce(day_row.target_value, 0) > 0
                then round(day_row.percent_achievement, 1)
                else null::numeric
            end as achievement_pct,
            (day_row.target_kind = 'meta') as has_meta,
            c.sort_order::integer
        from meta_catalog c
        left join lateral (
            select
                d.target_kind,
                d.target_value,
                d.actual_value,
                d.percent_achievement
            from app.meta_mes_daily_activity(
                p_cd,
                c.activity_key,
                (select d from resolved_date),
                p_origem_link
            ) d
            where d.date_ref = (select d from resolved_date)
            limit 1
        ) day_row on true
    ),

    conf_transferencia as (
        select
            'conf_transferencia_cd'::text,
            'Conf. Transferência CD'::text,
            'conferências'::text,
            count(*)::numeric, null::numeric, null::numeric, false, 100::integer
        from app.conf_transferencia_cd
        where (cd_ori = p_cd or cd_des = p_cd)
          and conf_date = (select d from resolved_date)
          and status in ('finalizado_ok', 'finalizado_falta')
    ),

    ativ_extra as (
        select
            'atividade_extra'::text,
            'Atividade Extra'::text,
            'pontos'::text,
            coalesce(sum(pontos), 0)::numeric, null::numeric, null::numeric, false, 110::integer
        from app.atividade_extra
        where cd = p_cd
          and data_inicio = (select d from resolved_date)
    ),

    coleta as (
        select
            'coleta_mercadoria'::text,
            'Coleta de Mercadorias'::text,
            'itens'::text,
            count(*)::numeric, null::numeric, null::numeric, false, 120::integer
        from app.aud_coleta
        where cd = p_cd
          and timezone('America/Sao_Paulo', data_hr)::date = (select d from resolved_date)
    ),

    embarque as (
        select
            'embarque_caixa_termica'::text,
            'Embarque Caixa Térmica'::text,
            'embarques'::text,
            count(*)::numeric, null::numeric, null::numeric, false, 140::integer
        from app.controle_caixa_termica_movs mov
        join app.controle_caixa_termica cxt on cxt.id = mov.caixa_id
        where cxt.cd = p_cd
          and mov.tipo = 'expedicao'
          and timezone('America/Sao_Paulo', mov.data_hr)::date = (select d from resolved_date)
    ),

    recebimento as (
        select
            'recebimento_caixa_termica'::text,
            'Recebimento Caixa Térmica'::text,
            'recebimentos'::text,
            count(*)::numeric, null::numeric, null::numeric, false, 145::integer
        from app.controle_caixa_termica_movs mov
        join app.controle_caixa_termica cxt on cxt.id = mov.caixa_id
        where cxt.cd = p_cd
          and mov.tipo = 'recebimento'
          and timezone('America/Sao_Paulo', mov.data_hr)::date = (select d from resolved_date)
    ),

    controle_avarias as (
        select
            'controle_avarias'::text,
            'Controle de Avarias'::text,
            'avarias'::text,
            count(*)::numeric, null::numeric, null::numeric, false, 150::integer
        from app.controle_avarias c
        where c.cd = p_cd
          and timezone('America/Sao_Paulo', c.data_hr)::date = (select d from resolved_date)
    )

    select * from meta_rows
    union all
    select * from conf_transferencia
    union all
    select * from ativ_extra
    union all
    select * from coleta
    union all
    select * from embarque
    union all
    select * from recebimento
    union all
    select * from controle_avarias
    order by 8;
$$;

drop function if exists public.rpc_apoio_gestor_day_flags(integer, date);
create or replace function public.rpc_apoio_gestor_day_flags(
    p_cd integer,
    p_date date default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    meta_defined_count integer,
    is_holiday boolean,
    is_sunday boolean
)
language sql
stable
security definer
set search_path = app, public
as $$
    with resolved_date as (
        select coalesce(p_date, timezone('America/Sao_Paulo', now())::date) as d
    ),
    meta_catalog as (
        select activity_key
        from app.meta_mes_activity_catalog()
    ),
    day_rows as (
        select
            c.activity_key,
            d.target_kind
        from meta_catalog c
        left join lateral (
            select target_kind
            from app.meta_mes_daily_activity(
                p_cd,
                c.activity_key,
                (select d from resolved_date),
                p_origem_link
            )
            where date_ref = (select d from resolved_date)
            limit 1
        ) d on true
    )
    select
        count(*) filter (where target_kind = 'meta')::integer as meta_defined_count,
        bool_or(target_kind = 'feriado') as is_holiday,
        bool_or(target_kind = 'domingo') as is_sunday
    from day_rows;
$$;

grant execute on function public.rpc_produtividade_collaborators(integer, date, date, text) to authenticated;
grant execute on function public.rpc_produtividade_activity_totals(integer, uuid, date, date, text) to authenticated;
grant execute on function public.rpc_produtividade_daily(integer, uuid, date, date, text) to authenticated;
grant execute on function public.rpc_produtividade_entries(integer, uuid, date, date, text, integer, text) to authenticated;
grant execute on function public.rpc_produtividade_ranking(integer, integer, integer, text) to authenticated;
grant execute on function public.rpc_meta_mes_month_options(integer, text) to authenticated;
grant execute on function public.rpc_meta_mes_summary(integer, text, date, text) to authenticated;
grant execute on function public.rpc_meta_mes_daily_rows(integer, text, date, text) to authenticated;
revoke all on function public.rpc_apoio_gestor_daily_summary(integer, date, text) from anon;
grant execute on function public.rpc_apoio_gestor_daily_summary(integer, date, text) to authenticated;
revoke all on function public.rpc_apoio_gestor_day_flags(integer, date, text) from anon;
grant execute on function public.rpc_apoio_gestor_day_flags(integer, date, text) to authenticated;

notify pgrst, 'reload schema';
