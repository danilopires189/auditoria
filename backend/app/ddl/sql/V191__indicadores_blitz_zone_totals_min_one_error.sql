create or replace function public.rpc_indicadores_blitz_zone_totals(
    p_cd integer default null,
    p_month_start date default null
)
returns table (
    zona text,
    falta_total bigint,
    sobra_total bigint,
    fora_politica_total bigint,
    erro_total bigint
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
    select
        dm.zona,
        coalesce(sum(dm.falta_qty), 0)::bigint as falta_total,
        coalesce(sum(dm.sobra_qty), 0)::bigint as sobra_total,
        coalesce(sum(dm.fora_politica_qty), 0)::bigint as fora_politica_total,
        coalesce(sum(dm.falta_qty + dm.sobra_qty + dm.fora_politica_qty), 0)::bigint as erro_total
    from app.indicadores_blitz_month_rows(v_cd, p_month_start) dm
    group by dm.zona
    having coalesce(sum(dm.falta_qty + dm.sobra_qty + dm.fora_politica_qty), 0) >= 1
    order by erro_total desc, dm.zona asc;
end;
$$;

grant execute on function public.rpc_indicadores_blitz_zone_totals(integer, date) to authenticated;
