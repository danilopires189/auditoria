alter table if exists staging.db_gestao_estq
    add column if not exists categoria_n1 text,
    add column if not exists fornecedor text;

alter table if exists app.db_gestao_estq
    add column if not exists categoria_n1 text,
    add column if not exists fornecedor text;

create index if not exists idx_app_db_gestao_estq_cd_data_mov_tipo
    on app.db_gestao_estq(cd, data_mov, tipo_movimentacao);

create index if not exists idx_app_db_gestao_estq_cd_data_mov_fornecedor
    on app.db_gestao_estq(cd, data_mov, fornecedor);

create index if not exists idx_app_db_gestao_estq_cd_data_mov_categoria_n1
    on app.db_gestao_estq(cd, data_mov, categoria_n1);

create or replace function app.indicadores_gestao_estq_dimension_rows(
    p_cd integer,
    p_start_date date,
    p_end_date date
)
returns table (
    data_mov date,
    coddv integer,
    descricao text,
    tipo_movimentacao text,
    categoria_n1 text,
    fornecedor text,
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
        coalesce(nullif(trim(g.categoria_n1), ''), 'Sem categoria') as categoria_n1,
        coalesce(nullif(trim(g.fornecedor), ''), 'Sem fornecedor') as fornecedor,
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
      and g.data_mov <= p_end_date
      and upper(trim(coalesce(g.tipo_movimentacao, ''))) in ('EA', 'EO', 'SO', 'SA');
$$;

drop function if exists public.rpc_indicadores_gestao_estq_details(integer, date, date, text);

create or replace function public.rpc_indicadores_gestao_estq_details(
    p_cd integer default null,
    p_month_start date default null,
    p_day date default null,
    p_movement_filter text default null,
    p_limit integer default 150
)
returns table (
    data_mov date,
    coddv integer,
    descricao text,
    tipo_movimentacao text,
    movement_group text,
    natureza text,
    valor_total numeric,
    valor_assinado numeric,
    ocorrencias bigint
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
    v_limit integer;
begin
    v_cd := app.indicadores_resolve_cd(p_cd);
    v_filter := lower(trim(coalesce(p_movement_filter, '')));
    if v_filter not in ('entrada', 'saida') then
        v_filter := 'todas';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 150), 1), 500);

    return query
    with bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    rows_base as (
        select r.*
        from bounds b
        cross join lateral app.indicadores_gestao_estq_dimension_rows(v_cd, b.month_start, b.month_end) r
        where (v_filter = 'todas' or r.movement_group = v_filter)
          and (p_day is null or r.data_mov = p_day)
    ),
    aggregated as (
        select
            r.data_mov,
            r.coddv,
            max(r.descricao) as descricao,
            r.tipo_movimentacao,
            r.movement_group,
            r.natureza,
            coalesce(sum(r.abs_valor), 0)::numeric as valor_total,
            coalesce(sum(r.valor_mov), 0)::numeric as valor_assinado,
            count(*)::bigint as ocorrencias
        from rows_base r
        group by r.data_mov, r.coddv, r.tipo_movimentacao, r.movement_group, r.natureza
    )
    select
        a.data_mov,
        a.coddv,
        a.descricao,
        a.tipo_movimentacao,
        a.movement_group,
        a.natureza,
        a.valor_total,
        a.valor_assinado,
        a.ocorrencias
    from aggregated a
    order by a.data_mov desc, a.valor_total desc, a.coddv asc
    limit v_limit;
end;
$$;

drop function if exists public.rpc_indicadores_gestao_estq_year_reentry_items(integer, date);

create or replace function public.rpc_indicadores_gestao_estq_year_reentry_items(
    p_cd integer default null,
    p_month_start date default null,
    p_limit integer default 30
)
returns table (
    coddv integer,
    descricao text,
    first_saida_date date,
    first_entrada_after_saida_date date,
    total_saida_ano numeric,
    total_entrada_ano numeric,
    saldo_ano numeric
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_limit integer;
begin
    v_cd := app.indicadores_resolve_cd(p_cd);
    v_limit := least(greatest(coalesce(p_limit, 30), 1), 100);

    return query
    with bounds as (
        select
            date_trunc('year', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as year_start,
            (date_trunc('year', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 year - 1 day')::date as year_end
    ),
    rows_base as (
        select
            r.coddv,
            r.descricao,
            r.data_mov,
            r.movement_group,
            r.abs_valor
        from bounds b
        cross join lateral app.indicadores_gestao_estq_dimension_rows(v_cd, b.year_start, b.year_end) r
        where r.movement_group in ('entrada', 'saida')
    ),
    exits as (
        select
            r.coddv,
            min(r.data_mov) as first_saida_date,
            max(r.descricao) as descricao,
            coalesce(sum(r.abs_valor), 0)::numeric as total_saida_ano
        from rows_base r
        where r.movement_group = 'saida'
        group by r.coddv
    ),
    entries_after_exit as (
        select
            e.coddv,
            min(r.data_mov) as first_entrada_after_saida_date
        from exits e
        join rows_base r
          on r.coddv = e.coddv
         and r.movement_group = 'entrada'
         and r.data_mov > e.first_saida_date
        group by e.coddv
    ),
    entry_totals as (
        select
            r.coddv,
            coalesce(sum(r.abs_valor), 0)::numeric as total_entrada_ano
        from rows_base r
        where r.movement_group = 'entrada'
        group by r.coddv
    )
    select
        e.coddv,
        e.descricao,
        e.first_saida_date,
        a.first_entrada_after_saida_date,
        e.total_saida_ano,
        coalesce(t.total_entrada_ano, 0)::numeric as total_entrada_ano,
        (coalesce(t.total_entrada_ano, 0) - e.total_saida_ano)::numeric as saldo_ano
    from exits e
    join entries_after_exit a
      on a.coddv = e.coddv
    left join entry_totals t
      on t.coddv = e.coddv
    order by a.first_entrada_after_saida_date desc, e.total_saida_ano desc, e.coddv asc
    limit v_limit;
end;
$$;

create or replace function public.rpc_indicadores_gestao_estq_loss_dimension(
    p_cd integer default null,
    p_month_start date default null,
    p_dimension text default null,
    p_movement_filter text default null,
    p_limit integer default 15
)
returns table (
    dimension_key text,
    perda_mes numeric,
    perda_acumulada_ano numeric,
    total_faltas_mes numeric,
    total_sobras_mes numeric,
    total_faltas_ano numeric,
    total_sobras_ano numeric,
    produtos_distintos_mes bigint,
    produtos_distintos_ano bigint
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
    v_dimension text;
    v_limit integer;
begin
    v_cd := app.indicadores_resolve_cd(p_cd);
    v_filter := lower(trim(coalesce(p_movement_filter, '')));
    if v_filter not in ('entrada', 'saida') then
        v_filter := 'todas';
    end if;

    v_dimension := lower(trim(coalesce(p_dimension, '')));
    if v_dimension not in ('fornecedor', 'categoria_n1') then
        raise exception 'DIMENSAO_INVALIDA';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 15), 1), 50);

    return query
    with bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end,
            date_trunc('year', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as year_start,
            (date_trunc('year', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 year - 1 day')::date as year_end
    ),
    month_rows as (
        select
            case
                when v_dimension = 'fornecedor' then r.fornecedor
                else r.categoria_n1
            end as dimension_key,
            r.coddv,
            r.natureza,
            r.abs_valor
        from bounds b
        cross join lateral app.indicadores_gestao_estq_rows(v_cd, b.month_start, b.month_end) r
        where v_filter = 'todas' or r.movement_group = v_filter
    ),
    year_rows as (
        select
            case
                when v_dimension = 'fornecedor' then r.fornecedor
                else r.categoria_n1
            end as dimension_key,
            r.coddv,
            r.natureza,
            r.abs_valor
        from bounds b
        cross join lateral app.indicadores_gestao_estq_rows(v_cd, b.year_start, b.year_end) r
        where v_filter = 'todas' or r.movement_group = v_filter
    ),
    month_totals as (
        select
            m.dimension_key,
            coalesce(sum(case when m.natureza = 'falta' then m.abs_valor else 0 end), 0)::numeric as total_faltas_mes,
            coalesce(sum(case when m.natureza = 'sobra' then m.abs_valor else 0 end), 0)::numeric as total_sobras_mes,
            count(distinct m.coddv)::bigint as produtos_distintos_mes
        from month_rows m
        group by m.dimension_key
    ),
    year_totals as (
        select
            y.dimension_key,
            coalesce(sum(case when y.natureza = 'falta' then y.abs_valor else 0 end), 0)::numeric as total_faltas_ano,
            coalesce(sum(case when y.natureza = 'sobra' then y.abs_valor else 0 end), 0)::numeric as total_sobras_ano,
            count(distinct y.coddv)::bigint as produtos_distintos_ano
        from year_rows y
        group by y.dimension_key
    )
    select
        coalesce(y.dimension_key, m.dimension_key) as dimension_key,
        (coalesce(m.total_faltas_mes, 0) - coalesce(m.total_sobras_mes, 0))::numeric as perda_mes,
        (coalesce(y.total_faltas_ano, 0) - coalesce(y.total_sobras_ano, 0))::numeric as perda_acumulada_ano,
        coalesce(m.total_faltas_mes, 0)::numeric as total_faltas_mes,
        coalesce(m.total_sobras_mes, 0)::numeric as total_sobras_mes,
        coalesce(y.total_faltas_ano, 0)::numeric as total_faltas_ano,
        coalesce(y.total_sobras_ano, 0)::numeric as total_sobras_ano,
        coalesce(m.produtos_distintos_mes, 0)::bigint as produtos_distintos_mes,
        coalesce(y.produtos_distintos_ano, 0)::bigint as produtos_distintos_ano
    from year_totals y
    full outer join month_totals m
      on m.dimension_key = y.dimension_key
    where
        (coalesce(y.total_faltas_ano, 0) - coalesce(y.total_sobras_ano, 0)) > 0
        or (coalesce(m.total_faltas_mes, 0) - coalesce(m.total_sobras_mes, 0)) > 0
    order by
        (coalesce(y.total_faltas_ano, 0) - coalesce(y.total_sobras_ano, 0)) desc,
        (coalesce(m.total_faltas_mes, 0) - coalesce(m.total_sobras_mes, 0)) desc,
        coalesce(y.dimension_key, m.dimension_key) asc
    limit v_limit;
end;
$$;

grant execute on function public.rpc_indicadores_gestao_estq_details(integer, date, date, text, integer) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_year_reentry_items(integer, date, integer) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_loss_dimension(integer, date, text, text, integer) to authenticated;
