create or replace function app.indicadores_gestao_estq_report_rows(
    p_cd integer,
    p_dt_ini date,
    p_dt_fim date,
    p_movement_filter text default null
)
returns table (
    data_mov date,
    coddv integer,
    descricao text,
    tipo_movimentacao text,
    categoria_n1 text,
    categoria_n2 text,
    fornecedor text,
    usuario text,
    qtd_mov integer,
    valor_mov numeric,
    movement_group text,
    natureza text,
    abs_valor numeric,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_filter text;
begin
    v_filter := lower(trim(coalesce(p_movement_filter, '')));
    if v_filter not in ('entrada', 'saida') then
        v_filter := 'todas';
    end if;

    return query
    select
        g.data_mov,
        g.coddv,
        coalesce(nullif(trim(g.descricao), ''), format('CODDV %s', coalesce(g.coddv::text, 'sem código'))) as descricao,
        upper(trim(coalesce(g.tipo_movimentacao, ''))) as tipo_movimentacao,
        nullif(trim(coalesce(g.categoria_n1, '')), '') as categoria_n1,
        nullif(trim(coalesce(g.categoria_n2, '')), '') as categoria_n2,
        nullif(trim(coalesce(g.fornecedor, '')), '') as fornecedor,
        nullif(trim(coalesce(g.usuario, '')), '') as usuario,
        g.qtd_mov,
        coalesce(g.valor_mov, 0)::numeric as valor_mov,
        case
            when upper(trim(coalesce(g.tipo_movimentacao, ''))) in ('EA', 'EO') then 'entrada'
            else 'saida'
        end as movement_group,
        case
            when upper(trim(coalesce(g.tipo_movimentacao, ''))) in ('EA', 'EO') then 'sobra'
            else 'falta'
        end as natureza,
        abs(coalesce(g.valor_mov, 0))::numeric as abs_valor,
        g.updated_at
    from app.db_gestao_estq g
    where g.cd = p_cd
      and g.data_mov is not null
      and g.data_mov >= p_dt_ini
      and g.data_mov <= p_dt_fim
      and upper(trim(coalesce(g.tipo_movimentacao, ''))) in ('EA', 'EO', 'SO', 'SA')
      and (
          v_filter = 'todas'
          or (v_filter = 'entrada' and upper(trim(coalesce(g.tipo_movimentacao, ''))) in ('EA', 'EO'))
          or (v_filter = 'saida' and upper(trim(coalesce(g.tipo_movimentacao, ''))) in ('SO', 'SA'))
      );
end;
$$;

create or replace function public.rpc_indicadores_gestao_estq_report_summary(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_movement_filter text default null
)
returns table (
    dt_ini date,
    dt_fim date,
    available_day_start date,
    available_day_end date,
    updated_at timestamptz,
    total_entradas_periodo numeric,
    total_saidas_periodo numeric,
    total_sobras_periodo numeric,
    total_faltas_periodo numeric,
    perda_liquida_periodo numeric,
    produtos_distintos_periodo bigint
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
    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;
    if p_dt_ini > p_dt_fim then
        raise exception 'INTERVALO_INVALIDO';
    end if;

    v_cd := app.indicadores_resolve_cd(p_cd);

    return query
    with rows_base as (
        select *
        from app.indicadores_gestao_estq_report_rows(v_cd, p_dt_ini, p_dt_fim, p_movement_filter)
    )
    select
        p_dt_ini as dt_ini,
        p_dt_fim as dt_fim,
        min(r.data_mov) as available_day_start,
        max(r.data_mov) as available_day_end,
        max(r.updated_at) as updated_at,
        coalesce(sum(r.abs_valor) filter (where r.movement_group = 'entrada'), 0)::numeric as total_entradas_periodo,
        coalesce(sum(r.abs_valor) filter (where r.movement_group = 'saida'), 0)::numeric as total_saidas_periodo,
        coalesce(sum(r.abs_valor) filter (where r.natureza = 'sobra'), 0)::numeric as total_sobras_periodo,
        coalesce(sum(r.abs_valor) filter (where r.natureza = 'falta'), 0)::numeric as total_faltas_periodo,
        (
            coalesce(sum(r.abs_valor) filter (where r.natureza = 'falta'), 0)
            - coalesce(sum(r.abs_valor) filter (where r.natureza = 'sobra'), 0)
        )::numeric as perda_liquida_periodo,
        count(distinct r.coddv)::bigint as produtos_distintos_periodo
    from rows_base r;
end;
$$;

create or replace function public.rpc_indicadores_gestao_estq_report_daily_series(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_movement_filter text default null
)
returns table (
    date_ref date,
    entrada_total numeric,
    saida_total numeric,
    perda_total numeric
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
    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;
    if p_dt_ini > p_dt_fim then
        raise exception 'INTERVALO_INVALIDO';
    end if;

    v_cd := app.indicadores_resolve_cd(p_cd);

    return query
    with calendar as (
        select gs.day_ref::date as date_ref
        from generate_series(p_dt_ini::timestamp, p_dt_fim::timestamp, interval '1 day') as gs(day_ref)
    ),
    rows_base as (
        select *
        from app.indicadores_gestao_estq_report_rows(v_cd, p_dt_ini, p_dt_fim, p_movement_filter)
    ),
    daily as (
        select
            r.data_mov as date_ref,
            coalesce(sum(r.abs_valor) filter (where r.movement_group = 'entrada'), 0)::numeric as entrada_total,
            coalesce(sum(r.abs_valor) filter (where r.movement_group = 'saida'), 0)::numeric as saida_total,
            (
                coalesce(sum(r.abs_valor) filter (where r.natureza = 'falta'), 0)
                - coalesce(sum(r.abs_valor) filter (where r.natureza = 'sobra'), 0)
            )::numeric as perda_total
        from rows_base r
        group by r.data_mov
    )
    select
        c.date_ref,
        coalesce(d.entrada_total, 0)::numeric as entrada_total,
        coalesce(d.saida_total, 0)::numeric as saida_total,
        coalesce(d.perda_total, 0)::numeric as perda_total
    from calendar c
    left join daily d
      on d.date_ref = c.date_ref
    order by c.date_ref asc;
end;
$$;

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
        from app.indicadores_gestao_estq_report_rows(v_cd, p_dt_ini, p_dt_fim, p_movement_filter)
        where movement_group = v_rank_group
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

create or replace function public.rpc_indicadores_gestao_estq_report_reentry_items(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_movement_filter text default null
)
returns table (
    coddv integer,
    descricao text,
    first_saida_date date,
    first_entrada_after_saida_date date,
    total_saida_periodo numeric,
    total_entrada_periodo numeric,
    saldo_periodo numeric
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
    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;
    if p_dt_ini > p_dt_fim then
        raise exception 'INTERVALO_INVALIDO';
    end if;

    v_cd := app.indicadores_resolve_cd(p_cd);

    return query
    with rows_base as (
        select *
        from app.indicadores_gestao_estq_report_rows(v_cd, p_dt_ini, p_dt_fim, p_movement_filter)
    ),
    product_totals as (
        select
            r.coddv,
            max(r.descricao) as descricao,
            min(r.data_mov) filter (where r.movement_group = 'saida') as first_saida_date,
            coalesce(sum(r.abs_valor) filter (where r.movement_group = 'saida'), 0)::numeric as total_saida_periodo,
            coalesce(sum(r.abs_valor) filter (where r.movement_group = 'entrada'), 0)::numeric as total_entrada_periodo
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
        p.total_saida_periodo,
        p.total_entrada_periodo,
        (p.total_entrada_periodo - p.total_saida_periodo)::numeric as saldo_periodo
    from product_totals p
    join entries_after_exit e
      on e.coddv = p.coddv
    where p.total_saida_periodo > 0
    order by e.first_entrada_after_saida_date desc, p.total_saida_periodo desc, p.coddv asc
    limit 30;
end;
$$;

create or replace function public.rpc_indicadores_gestao_estq_report_loss_dimension(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_dimension text default null,
    p_movement_filter text default null
)
returns table (
    dimension_key text,
    perda_periodo numeric,
    total_faltas_periodo numeric,
    total_sobras_periodo numeric,
    produtos_distintos_periodo bigint
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_dimension text;
begin
    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;
    if p_dt_ini > p_dt_fim then
        raise exception 'INTERVALO_INVALIDO';
    end if;

    v_cd := app.indicadores_resolve_cd(p_cd);
    v_dimension := lower(trim(coalesce(p_dimension, '')));
    if v_dimension not in ('fornecedor', 'categoria_n2') then
        raise exception 'DIMENSAO_INVALIDA';
    end if;

    return query
    with rows_base as (
        select *
        from app.indicadores_gestao_estq_report_rows(v_cd, p_dt_ini, p_dt_fim, p_movement_filter)
    ),
    normalized as (
        select
            case
                when v_dimension = 'fornecedor' then coalesce(r.fornecedor, 'Sem fornecedor')
                else coalesce(r.categoria_n2, 'Sem categoria')
            end as dimension_key,
            r.coddv,
            r.natureza,
            r.abs_valor
        from rows_base r
    )
    select
        n.dimension_key,
        (
            coalesce(sum(n.abs_valor) filter (where n.natureza = 'falta'), 0)
            - coalesce(sum(n.abs_valor) filter (where n.natureza = 'sobra'), 0)
        )::numeric as perda_periodo,
        coalesce(sum(n.abs_valor) filter (where n.natureza = 'falta'), 0)::numeric as total_faltas_periodo,
        coalesce(sum(n.abs_valor) filter (where n.natureza = 'sobra'), 0)::numeric as total_sobras_periodo,
        count(distinct n.coddv)::bigint as produtos_distintos_periodo
    from normalized n
    group by n.dimension_key
    having
        (
            coalesce(sum(n.abs_valor) filter (where n.natureza = 'falta'), 0)
            - coalesce(sum(n.abs_valor) filter (where n.natureza = 'sobra'), 0)
        ) > 0
    order by perda_periodo desc, n.dimension_key asc
    limit 15;
end;
$$;

create or replace function public.rpc_indicadores_gestao_estq_report_details(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_movement_filter text default null
)
returns table (
    data_mov date,
    coddv integer,
    descricao text,
    tipo_movimentacao text,
    movement_group text,
    natureza text,
    valor_total numeric,
    responsavel text,
    cargo text,
    ocorrencias bigint,
    quantidade bigint
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
    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;
    if p_dt_ini > p_dt_fim then
        raise exception 'INTERVALO_INVALIDO';
    end if;

    v_cd := app.indicadores_resolve_cd(p_cd);

    return query
    with user_lookup as materialized (
        select
            authz.normalize_mat(u.mat) as mat_norm,
            max(nullif(trim(u.mat), '')) as mat,
            max(nullif(trim(u.nome), '')) as nome,
            max(nullif(trim(u.cargo), '')) as cargo
        from app.db_usuario u
        where u.cd = v_cd
          and authz.normalize_mat(u.mat) <> ''
        group by authz.normalize_mat(u.mat)
    ),
    rows_base as materialized (
        select
            r.data_mov,
            r.coddv,
            r.descricao,
            r.tipo_movimentacao,
            r.movement_group,
            r.natureza,
            r.abs_valor,
            greatest(coalesce(nullif(r.qtd_mov, 0), 1), 1)::bigint as quantidade_item,
            r.usuario as usuario_raw,
            authz.normalize_mat(r.usuario) as usuario_norm
        from app.indicadores_gestao_estq_report_rows(v_cd, p_dt_ini, p_dt_fim, p_movement_filter) r
    ),
    rows_enriched as materialized (
        select
            r.data_mov,
            r.coddv,
            r.descricao,
            r.tipo_movimentacao,
            r.movement_group,
            r.natureza,
            r.abs_valor,
            r.quantidade_item,
            case
                when ul.mat is not null and ul.nome is not null then ul.mat || ' - ' || ul.nome
                when ul.mat is not null then ul.mat
                when r.usuario_raw is not null then r.usuario_raw
                else 'Não informado'
            end as responsavel,
            coalesce(ul.cargo, '-') as cargo
        from rows_base r
        left join user_lookup ul
          on ul.mat_norm = r.usuario_norm
    )
    select
        r.data_mov,
        r.coddv,
        max(r.descricao) as descricao,
        r.tipo_movimentacao,
        r.movement_group,
        r.natureza,
        coalesce(sum(r.abs_valor), 0)::numeric as valor_total,
        r.responsavel,
        r.cargo,
        count(*)::bigint as ocorrencias,
        coalesce(sum(r.quantidade_item), 0)::bigint as quantidade
    from rows_enriched r
    group by
        r.data_mov,
        r.coddv,
        r.tipo_movimentacao,
        r.movement_group,
        r.natureza,
        r.responsavel,
        r.cargo
    order by r.data_mov asc, valor_total desc, r.coddv asc, r.responsavel asc;
end;
$$;

create or replace function public.rpc_indicadores_gestao_estq_report_base(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_movement_filter text default null
)
returns table (
    cd integer,
    data_mov date,
    coddv integer,
    descricao text,
    tipo_movimentacao text,
    categoria_n1 text,
    categoria_n2 text,
    fornecedor text,
    usuario text,
    qtd_mov integer,
    valor_mov numeric,
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
    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;
    if p_dt_ini > p_dt_fim then
        raise exception 'INTERVALO_INVALIDO';
    end if;

    v_cd := app.indicadores_resolve_cd(p_cd);

    return query
    select
        v_cd as cd,
        r.data_mov,
        r.coddv,
        r.descricao,
        r.tipo_movimentacao,
        r.categoria_n1,
        r.categoria_n2,
        r.fornecedor,
        r.usuario,
        r.qtd_mov,
        r.valor_mov,
        r.updated_at
    from app.indicadores_gestao_estq_report_rows(v_cd, p_dt_ini, p_dt_fim, p_movement_filter) r
    order by r.data_mov asc, r.coddv asc, r.tipo_movimentacao asc;
end;
$$;

grant execute on function public.rpc_indicadores_gestao_estq_report_summary(integer, date, date, text) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_report_daily_series(integer, date, date, text) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_report_top_items(integer, date, date, text, text) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_report_reentry_items(integer, date, date, text) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_report_loss_dimension(integer, date, date, text, text) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_report_details(integer, date, date, text) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_report_base(integer, date, date, text) to authenticated;
