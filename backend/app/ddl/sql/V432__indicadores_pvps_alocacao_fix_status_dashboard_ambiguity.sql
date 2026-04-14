create or replace function public.rpc_indicadores_pvps_aloc_zone_totals(
    p_cd integer default null,
    p_month_start date default null,
    p_tipo text default 'ambos'
)
returns table (
    zona text,
    nao_conforme_total bigint,
    vazio_total bigint,
    obstruido_total bigint,
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
    with base_rows as (
        select *
        from app.indicadores_pvps_aloc_rows(v_cd, p_month_start, p_tipo) as br
        where br.status_dashboard <> 'conforme'
    )
    select
        br.zona,
        count(*) filter (where br.status_dashboard = 'nao_conforme')::bigint as nao_conforme_total,
        count(*) filter (where br.status_dashboard = 'vazio')::bigint as vazio_total,
        count(*) filter (where br.status_dashboard = 'obstruido')::bigint as obstruido_total,
        count(*)::bigint as erro_total
    from base_rows br
    group by br.zona
    having count(*) > 0
    order by erro_total desc, br.zona asc;
end;
$$;

create or replace function public.rpc_indicadores_pvps_aloc_day_details(
    p_cd integer default null,
    p_month_start date default null,
    p_tipo text default 'ambos',
    p_day date default null
)
returns table (
    date_ref date,
    modulo text,
    zona text,
    endereco text,
    descricao text,
    coddv integer,
    status_dashboard text,
    quantidade integer
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
    with base_rows as (
        select *
        from app.indicadores_pvps_aloc_rows(v_cd, p_month_start, p_tipo) as br
        where br.status_dashboard <> 'conforme'
          and (p_day is null or br.date_ref = p_day)
    )
    select
        br.date_ref,
        br.modulo,
        br.zona,
        br.endereco,
        br.descricao,
        br.coddv,
        br.status_dashboard,
        1 as quantidade
    from base_rows br
    order by
        br.date_ref desc,
        br.zona asc,
        br.modulo asc,
        br.descricao asc,
        br.coddv asc;
end;
$$;

grant execute on function public.rpc_indicadores_pvps_aloc_zone_totals(integer, date, text) to authenticated;
grant execute on function public.rpc_indicadores_pvps_aloc_day_details(integer, date, text, date) to authenticated;
