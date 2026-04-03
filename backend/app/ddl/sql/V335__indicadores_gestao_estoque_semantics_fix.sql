create or replace function app.indicadores_gestao_estq_rows(
    p_cd integer,
    p_start_date date,
    p_end_date date
)
returns table (
    data_mov date,
    coddv integer,
    descricao text,
    tipo_movimentacao text,
    valor_mov numeric,
    movement_group text,
    natureza text,
    abs_valor numeric,
    updated_at timestamptz
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
    select
        g.data_mov,
        g.coddv,
        coalesce(nullif(trim(g.descricao), ''), format('COD %s', coalesce(g.coddv::text, 'sem código'))) as descricao,
        upper(trim(coalesce(g.tipo_movimentacao, ''))) as tipo_movimentacao,
        coalesce(g.valor_mov, 0)::numeric as valor_mov,
        case
            when upper(trim(coalesce(g.tipo_movimentacao, ''))) in ('EA', 'EO') then 'entrada'
            when upper(trim(coalesce(g.tipo_movimentacao, ''))) in ('SO', 'SA') then 'saida'
            else 'outros'
        end as movement_group,
        case
            when upper(trim(coalesce(g.tipo_movimentacao, ''))) in ('EA', 'EO') then 'sobra'
            when upper(trim(coalesce(g.tipo_movimentacao, ''))) in ('SO', 'SA') then 'falta'
            when coalesce(g.valor_mov, 0) < 0 then 'sobra'
            when coalesce(g.valor_mov, 0) > 0 then 'falta'
            else 'neutro'
        end as natureza,
        abs(coalesce(g.valor_mov, 0))::numeric as abs_valor,
        g.updated_at
    from app.db_gestao_estq g
    where g.cd = p_cd
      and g.data_mov is not null
      and g.data_mov >= p_start_date
      and g.data_mov <= p_end_date;
$$;

create or replace function public.rpc_indicadores_gestao_estq_summary(
    p_cd integer default null,
    p_month_start date default null,
    p_movement_filter text default null
)
returns table (
    month_start date,
    month_end date,
    available_day_start date,
    available_day_end date,
    updated_at timestamptz,
    total_entradas_mes numeric,
    total_saidas_mes numeric,
    total_sobras_mes numeric,
    total_faltas_mes numeric,
    perda_mes_atual numeric,
    perda_acumulada_ano numeric,
    acumulado_entradas_ano numeric,
    acumulado_saidas_ano numeric,
    produtos_distintos_mes bigint
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_filter text;
begin
    v_cd := app.indicadores_resolve_cd(p_cd);
    v_filter := lower(trim(coalesce(p_movement_filter, '')));
    if v_filter not in ('entrada', 'saida') then
        v_filter := 'todas';
    end if;

    return query
    with bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end,
            date_trunc('year', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as year_start,
            (date_trunc('year', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 year - 1 day')::date as year_end
    ),
    month_rows as (
        select r.*
        from bounds b
        cross join lateral app.indicadores_gestao_estq_rows(v_cd, b.month_start, b.month_end) r
        where v_filter = 'todas' or r.movement_group = v_filter
    ),
    year_rows as (
        select r.*
        from bounds b
        cross join lateral app.indicadores_gestao_estq_rows(v_cd, b.year_start, b.year_end) r
        where v_filter = 'todas' or r.movement_group = v_filter
    ),
    month_totals as (
        select
            min(m.data_mov) as available_day_start,
            max(m.data_mov) as available_day_end,
            max(m.updated_at) as updated_at,
            coalesce(sum(case when m.movement_group = 'entrada' then m.abs_valor else 0 end), 0)::numeric as total_entradas_mes,
            coalesce(sum(case when m.movement_group = 'saida' then m.abs_valor else 0 end), 0)::numeric as total_saidas_mes,
            coalesce(sum(case when m.natureza = 'sobra' then m.abs_valor else 0 end), 0)::numeric as total_sobras_mes,
            coalesce(sum(case when m.natureza = 'falta' then m.abs_valor else 0 end), 0)::numeric as total_faltas_mes,
            count(distinct m.coddv)::bigint as produtos_distintos_mes
        from month_rows m
    ),
    year_totals as (
        select
            max(y.updated_at) as updated_at,
            (
                coalesce(sum(case when y.natureza = 'falta' then y.abs_valor else 0 end), 0)
                - coalesce(sum(case when y.natureza = 'sobra' then y.abs_valor else 0 end), 0)
            )::numeric as perda_acumulada_ano,
            coalesce(sum(case when y.movement_group = 'entrada' then y.abs_valor else 0 end), 0)::numeric as acumulado_entradas_ano,
            coalesce(sum(case when y.movement_group = 'saida' then y.abs_valor else 0 end), 0)::numeric as acumulado_saidas_ano
        from year_rows y
    )
    select
        b.month_start,
        b.month_end,
        mt.available_day_start,
        mt.available_day_end,
        nullif(
            greatest(
                coalesce(mt.updated_at, '-infinity'::timestamptz),
                coalesce(yt.updated_at, '-infinity'::timestamptz)
            ),
            '-infinity'::timestamptz
        ) as updated_at,
        mt.total_entradas_mes,
        mt.total_saidas_mes,
        mt.total_sobras_mes,
        mt.total_faltas_mes,
        (mt.total_faltas_mes - mt.total_sobras_mes)::numeric as perda_mes_atual,
        yt.perda_acumulada_ano,
        yt.acumulado_entradas_ano,
        yt.acumulado_saidas_ano,
        mt.produtos_distintos_mes
    from bounds b
    cross join month_totals mt
    cross join year_totals yt;
end;
$$;

grant execute on function public.rpc_indicadores_gestao_estq_summary(integer, date, text) to authenticated;
