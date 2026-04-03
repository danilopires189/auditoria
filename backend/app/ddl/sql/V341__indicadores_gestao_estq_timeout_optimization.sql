create index if not exists idx_app_db_gestao_estq_cd_coddv_data_mov
    on app.db_gestao_estq (cd, coddv, data_mov)
    include (descricao, tipo_movimentacao, valor_mov);

create index if not exists idx_app_db_gestao_estq_cd_data_mov_core_types
    on app.db_gestao_estq (cd, data_mov, coddv)
    include (descricao, tipo_movimentacao, valor_mov, fornecedor, categoria_n1, categoria_n2, updated_at)
    where upper(trim(coalesce(tipo_movimentacao, ''))) in ('EA', 'EO', 'SO', 'SA');

create or replace function public.rpc_indicadores_gestao_estq_top_items(
    p_cd integer default null,
    p_month_start date default null,
    p_day date default null,
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
    v_filter text;
    v_rank_group text;
    v_type_codes text[];
begin
    v_cd := app.indicadores_resolve_cd(p_cd);
    v_filter := lower(trim(coalesce(p_movement_filter, '')));
    if v_filter not in ('entrada', 'saida') then
        v_filter := 'todas';
    end if;

    v_rank_group := lower(trim(coalesce(p_rank_group, '')));
    if v_rank_group not in ('entrada', 'saida') then
        v_rank_group := 'entrada';
    end if;

    if v_filter <> 'todas' and v_filter <> v_rank_group then
        return;
    end if;

    v_type_codes := case
        when v_rank_group = 'entrada' then array['EA', 'EO']
        else array['SO', 'SA']
    end;

    return query
    with bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    rows_base as materialized (
        select
            g.coddv,
            coalesce(nullif(trim(g.descricao), ''), format('CODDV %s', coalesce(g.coddv::text, 'sem código'))) as descricao,
            g.data_mov,
            abs(coalesce(g.valor_mov, 0))::numeric as abs_valor
        from app.db_gestao_estq g
        cross join bounds b
        cross join lateral (
            select upper(trim(coalesce(g.tipo_movimentacao, ''))) as tipo_norm
        ) norm
        where g.cd = v_cd
          and g.data_mov is not null
          and g.data_mov >= b.month_start
          and g.data_mov <= b.month_end
          and (p_day is null or g.data_mov = p_day)
          and norm.tipo_norm = any(v_type_codes)
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
    v_type_codes text[];
begin
    v_cd := app.indicadores_resolve_cd(p_cd);
    v_filter := lower(trim(coalesce(p_movement_filter, '')));
    if v_filter not in ('entrada', 'saida') then
        v_filter := 'todas';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 150), 1), 500);
    v_type_codes := case
        when v_filter = 'entrada' then array['EA', 'EO']
        when v_filter = 'saida' then array['SO', 'SA']
        else array['EA', 'EO', 'SO', 'SA']
    end;

    return query
    with bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    rows_base as materialized (
        select
            g.data_mov,
            g.coddv,
            coalesce(nullif(trim(g.descricao), ''), format('CODDV %s', coalesce(g.coddv::text, 'sem código'))) as descricao,
            norm.tipo_norm as tipo_movimentacao,
            case
                when norm.tipo_norm in ('EA', 'EO') then 'entrada'
                else 'saida'
            end as movement_group,
            case
                when norm.tipo_norm in ('EA', 'EO') then 'sobra'
                else 'falta'
            end as natureza,
            abs(coalesce(g.valor_mov, 0))::numeric as abs_valor,
            coalesce(g.valor_mov, 0)::numeric as valor_mov
        from app.db_gestao_estq g
        cross join bounds b
        cross join lateral (
            select upper(trim(coalesce(g.tipo_movimentacao, ''))) as tipo_norm
        ) norm
        where g.cd = v_cd
          and g.data_mov is not null
          and g.data_mov >= b.month_start
          and g.data_mov <= b.month_end
          and (p_day is null or g.data_mov = p_day)
          and norm.tipo_norm = any(v_type_codes)
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
    rows_base as materialized (
        select
            g.coddv,
            coalesce(nullif(trim(g.descricao), ''), format('CODDV %s', coalesce(g.coddv::text, 'sem código'))) as descricao,
            g.data_mov,
            abs(coalesce(g.valor_mov, 0))::numeric as abs_valor,
            case
                when norm.tipo_norm in ('EA', 'EO') then 'entrada'
                else 'saida'
            end as movement_group
        from app.db_gestao_estq g
        cross join bounds b
        cross join lateral (
            select upper(trim(coalesce(g.tipo_movimentacao, ''))) as tipo_norm
        ) norm
        where g.cd = v_cd
          and g.data_mov is not null
          and g.data_mov >= b.year_start
          and g.data_mov <= b.year_end
          and norm.tipo_norm in ('EA', 'EO', 'SO', 'SA')
    ),
    product_totals as (
        select
            r.coddv,
            max(r.descricao) as descricao,
            min(r.data_mov) filter (where r.movement_group = 'saida') as first_saida_date,
            coalesce(sum(r.abs_valor) filter (where r.movement_group = 'saida'), 0)::numeric as total_saida_ano,
            coalesce(sum(r.abs_valor) filter (where r.movement_group = 'entrada'), 0)::numeric as total_entrada_ano
        from rows_base r
        group by r.coddv
    ),
    entries_after_exit as (
        select
            p.coddv,
            min(r.data_mov) as first_entrada_after_saida_date
        from product_totals p
        join rows_base r
          on r.coddv = p.coddv
         and r.movement_group = 'entrada'
         and r.data_mov > p.first_saida_date
        where p.first_saida_date is not null
        group by p.coddv
    )
    select
        p.coddv,
        p.descricao,
        p.first_saida_date,
        e.first_entrada_after_saida_date,
        p.total_saida_ano,
        p.total_entrada_ano,
        (p.total_entrada_ano - p.total_saida_ano)::numeric as saldo_ano
    from product_totals p
    join entries_after_exit e
      on e.coddv = p.coddv
    where p.total_saida_ano > 0
    order by e.first_entrada_after_saida_date desc, p.total_saida_ano desc, p.coddv asc
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
    if v_dimension not in ('fornecedor', 'categoria_n1', 'categoria_n2') then
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
    rows_base as materialized (
        select
            g.data_mov,
            g.coddv,
            case
                when v_dimension = 'fornecedor' then coalesce(nullif(trim(g.fornecedor), ''), 'Sem fornecedor')
                when v_dimension = 'categoria_n2' then coalesce(nullif(trim(g.categoria_n2), ''), 'Sem categoria')
                else coalesce(nullif(trim(g.categoria_n1), ''), 'Sem categoria')
            end as dimension_key,
            case
                when norm.tipo_norm in ('EA', 'EO') then 'entrada'
                else 'saida'
            end as movement_group,
            case
                when norm.tipo_norm in ('EA', 'EO') then 'sobra'
                else 'falta'
            end as natureza,
            abs(coalesce(g.valor_mov, 0))::numeric as abs_valor
        from app.db_gestao_estq g
        cross join bounds b
        cross join lateral (
            select upper(trim(coalesce(g.tipo_movimentacao, ''))) as tipo_norm
        ) norm
        where g.cd = v_cd
          and g.data_mov is not null
          and g.data_mov >= b.year_start
          and g.data_mov <= b.year_end
          and norm.tipo_norm in ('EA', 'EO', 'SO', 'SA')
          and (
              v_filter = 'todas'
              or (v_filter = 'entrada' and norm.tipo_norm in ('EA', 'EO'))
              or (v_filter = 'saida' and norm.tipo_norm in ('SO', 'SA'))
          )
    ),
    aggregated as (
        select
            r.dimension_key,
            coalesce(sum(r.abs_valor) filter (
                where r.natureza = 'falta'
                  and r.data_mov >= b.month_start
                  and r.data_mov <= b.month_end
            ), 0)::numeric as total_faltas_mes,
            coalesce(sum(r.abs_valor) filter (
                where r.natureza = 'sobra'
                  and r.data_mov >= b.month_start
                  and r.data_mov <= b.month_end
            ), 0)::numeric as total_sobras_mes,
            coalesce(sum(r.abs_valor) filter (where r.natureza = 'falta'), 0)::numeric as total_faltas_ano,
            coalesce(sum(r.abs_valor) filter (where r.natureza = 'sobra'), 0)::numeric as total_sobras_ano,
            count(distinct r.coddv) filter (
                where r.data_mov >= b.month_start
                  and r.data_mov <= b.month_end
            ) as produtos_distintos_mes,
            count(distinct r.coddv) as produtos_distintos_ano
        from rows_base r
        cross join bounds b
        group by r.dimension_key
    )
    select
        a.dimension_key,
        (a.total_faltas_mes - a.total_sobras_mes)::numeric as perda_mes,
        (a.total_faltas_ano - a.total_sobras_ano)::numeric as perda_acumulada_ano,
        a.total_faltas_mes,
        a.total_sobras_mes,
        a.total_faltas_ano,
        a.total_sobras_ano,
        a.produtos_distintos_mes,
        a.produtos_distintos_ano
    from aggregated a
    where
        (a.total_faltas_ano - a.total_sobras_ano) > 0
        or (a.total_faltas_mes - a.total_sobras_mes) > 0
    order by
        (a.total_faltas_ano - a.total_sobras_ano) desc,
        (a.total_faltas_mes - a.total_sobras_mes) desc,
        a.dimension_key asc
    limit v_limit;
end;
$$;

grant execute on function public.rpc_indicadores_gestao_estq_top_items(integer, date, date, text, text) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_details(integer, date, date, text, integer) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_year_reentry_items(integer, date, integer) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_loss_dimension(integer, date, text, text, integer) to authenticated;
