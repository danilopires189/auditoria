create or replace function public.rpc_indicadores_blitz_daily_series(
    p_cd integer default null,
    p_month_start date default null
)
returns table (
    date_ref date,
    conferido_total bigint,
    divergencia_oficial bigint,
    percentual_oficial numeric
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
    conf_daily as (
        select
            c.dt_conf as date_ref,
            coalesce(sum(c.tt_un), 0)::bigint as conferido_total
        from app.db_conf_blitz c
        cross join month_bounds mb
        where c.cd = v_cd
          and c.dt_conf is not null
          and c.dt_conf >= mb.month_start
          and c.dt_conf <= mb.month_end
        group by c.dt_conf
    ),
    div_daily as (
        select
            dm.data_conf as date_ref,
            coalesce(sum(dm.falta_qty + dm.sobra_qty + dm.fora_politica_qty), 0)::bigint as divergencia_oficial
        from app.indicadores_blitz_month_rows(v_cd, p_month_start) dm
        group by dm.data_conf
    )
    select
        gs.day_ref::date as date_ref,
        coalesce(cd.conferido_total, 0)::bigint as conferido_total,
        coalesce(dd.divergencia_oficial, 0)::bigint as divergencia_oficial,
        case
            when coalesce(cd.conferido_total, 0) > 0
                then round((coalesce(dd.divergencia_oficial, 0)::numeric / cd.conferido_total::numeric) * 100, 4)
            else 0::numeric
        end as percentual_oficial
    from month_bounds mb
    cross join lateral generate_series(mb.month_start, mb.month_end, interval '1 day') as gs(day_ref)
    left join conf_daily cd
      on cd.date_ref = gs.day_ref::date
    left join div_daily dd
      on dd.date_ref = gs.day_ref::date
    order by gs.day_ref::date;
end;
$$;

grant execute on function public.rpc_indicadores_blitz_daily_series(integer, date) to authenticated;
