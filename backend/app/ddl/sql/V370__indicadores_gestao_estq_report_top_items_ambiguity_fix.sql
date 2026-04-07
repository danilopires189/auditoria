create or replace function public.rpc_indicadores_gestao_estq_report_top_items(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_rank_group text default null,
    p_movement_filter text default null
)
returns table (
    coddv integer,
    descricao text,
    movement_group text,
    total_valor numeric,
    movimentacoes bigint,
    dias_distintos bigint,
    first_date date,
    last_date date
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_rank_group text;
begin
    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;
    if p_dt_ini > p_dt_fim then
        raise exception 'INTERVALO_INVALIDO';
    end if;

    v_cd := app.indicadores_resolve_cd(p_cd);
    v_rank_group := lower(trim(coalesce(p_rank_group, '')));
    if v_rank_group not in ('entrada', 'saida') then
        v_rank_group := 'entrada';
    end if;

    return query
    with rows_base as (
        select *
        from app.indicadores_gestao_estq_report_rows(v_cd, p_dt_ini, p_dt_fim, p_movement_filter) as report_row
        where report_row.movement_group = v_rank_group
    )
    select
        r.coddv,
        max(r.descricao) as descricao,
        v_rank_group as movement_group,
        coalesce(sum(r.abs_valor), 0)::numeric as total_valor,
        count(*)::bigint as movimentacoes,
        count(distinct r.data_mov)::bigint as dias_distintos,
        min(r.data_mov) as first_date,
        max(r.data_mov) as last_date
    from rows_base r
    group by r.coddv
    order by total_valor desc, r.coddv asc
    limit 30;
end;
$$;

grant execute on function public.rpc_indicadores_gestao_estq_report_top_items(integer, date, date, text, text) to authenticated;
