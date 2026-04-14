create or replace function app.indicadores_pvps_aloc_workdays(
    p_cd integer,
    p_month_start date default null,
    p_tipo text default 'ambos'
)
returns integer
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
    with month_bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    elapsed as (
        select
            least(timezone('America/Sao_Paulo', now())::date, mb.month_end) as elapsed_end
        from month_bounds mb
    ),
    params as (
        select app.indicadores_pvps_aloc_tipo(p_tipo) as tipo
    ),
    days as (
        select generate_series(mb.month_start, mb.month_end, interval '1 day')::date as date_ref
        from month_bounds mb
    ),
    pvps_calendar as (
        select
            d.date_ref,
            d.target_kind
        from params p
        join lateral app.meta_mes_daily_activity(p_cd, 'pvps_coddv', p_month_start) d
          on p.tipo in ('ambos', 'pvps')
    ),
    alocacao_calendar as (
        select
            d.date_ref,
            d.target_kind
        from params p
        join lateral app.meta_mes_daily_activity(p_cd, 'alocacao_coddv', p_month_start) d
          on p.tipo in ('ambos', 'alocacao')
    ),
    holiday_union as (
        select c.date_ref
        from pvps_calendar c
        where c.target_kind = 'feriado'
        union
        select c.date_ref
        from alocacao_calendar c
        where c.target_kind = 'feriado'
    )
    select count(*)::integer
    from days d
    cross join elapsed e
    left join holiday_union h
      on h.date_ref = d.date_ref
    where d.date_ref <= e.elapsed_end
      and extract(isodow from d.date_ref) <> 7
      and h.date_ref is null;
$$;

drop function if exists public.rpc_indicadores_pvps_aloc_summary(integer, date, text);

create or replace function public.rpc_indicadores_pvps_aloc_summary(
    p_cd integer default null,
    p_month_start date default null,
    p_tipo text default 'ambos'
)
returns table (
    month_start date,
    month_end date,
    available_day_start date,
    available_day_end date,
    updated_at timestamptz,
    enderecos_auditados bigint,
    nao_conformes bigint,
    ocorrencias_total bigint,
    ocorrencias_vazio bigint,
    ocorrencias_obstruido bigint,
    erros_total bigint,
    erros_percentual_total bigint,
    percentual_erro numeric,
    conformes_elegiveis bigint,
    percentual_conformidade numeric,
    produtos_unicos_auditados bigint,
    media_sku_dia numeric
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
    v_cd := app.indicadores_resolve_cd(p_cd);

    return query
    with month_bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    base_rows as (
        select *
        from app.indicadores_pvps_aloc_rows(v_cd, p_month_start, p_tipo)
    ),
    days_with_data as (
        select
            min(br.date_ref) as available_day_start,
            max(br.date_ref) as available_day_end
        from base_rows br
    ),
    aggregates as (
        select
            max(br.updated_at) as updated_at,
            count(*) filter (where br.eligible_audit)::bigint as enderecos_auditados,
            count(*) filter (where br.status_dashboard = 'nao_conforme')::bigint as nao_conformes,
            count(*) filter (where br.status_dashboard in ('vazio', 'obstruido'))::bigint as ocorrencias_total,
            count(*) filter (where br.status_dashboard = 'vazio')::bigint as ocorrencias_vazio,
            count(*) filter (where br.status_dashboard = 'obstruido')::bigint as ocorrencias_obstruido,
            count(*) filter (where br.status_dashboard <> 'conforme')::bigint as erros_total,
            count(*) filter (where br.eligible_error)::bigint as erros_percentual_total,
            count(*) filter (where br.eligible_conform)::bigint as conformes_elegiveis,
            count(distinct br.coddv) filter (where br.eligible_audit)::bigint as produtos_unicos_auditados
        from base_rows br
    ),
    workdays as (
        select app.indicadores_pvps_aloc_workdays(v_cd, p_month_start, p_tipo) as dias_uteis_validos
    )
    select
        mb.month_start,
        mb.month_end,
        dwd.available_day_start,
        dwd.available_day_end,
        agg.updated_at,
        agg.enderecos_auditados,
        agg.nao_conformes,
        agg.ocorrencias_total,
        agg.ocorrencias_vazio,
        agg.ocorrencias_obstruido,
        agg.erros_total,
        agg.erros_percentual_total,
        case
            when agg.enderecos_auditados > 0
                then round((agg.erros_percentual_total::numeric / agg.enderecos_auditados::numeric) * 100, 4)
            else 0::numeric
        end as percentual_erro,
        agg.conformes_elegiveis,
        case
            when agg.enderecos_auditados > 0
                then round((agg.conformes_elegiveis::numeric / agg.enderecos_auditados::numeric) * 100, 4)
            else 0::numeric
        end as percentual_conformidade,
        agg.produtos_unicos_auditados,
        case
            when wd.dias_uteis_validos > 0
                then round((agg.produtos_unicos_auditados::numeric / wd.dias_uteis_validos::numeric), 4)
            else 0::numeric
        end as media_sku_dia
    from month_bounds mb
    cross join days_with_data dwd
    cross join aggregates agg
    cross join workdays wd;
end;
$$;

grant execute on function public.rpc_indicadores_pvps_aloc_summary(integer, date, text) to authenticated;
