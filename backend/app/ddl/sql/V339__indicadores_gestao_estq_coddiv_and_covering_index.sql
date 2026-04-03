create index if not exists idx_app_db_gestao_estq_cd_data_mov_cover
    on app.db_gestao_estq (cd, data_mov)
    include (coddv, descricao, tipo_movimentacao, valor_mov, fornecedor, categoria_n1, categoria_n2, usuario, updated_at);

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
        coalesce(nullif(trim(g.descricao), ''), format('CODDV %s', coalesce(g.coddv::text, 'sem código'))) as descricao,
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

create or replace function app.indicadores_gestao_estq_dimension_rows_v2(
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
    categoria_n2 text,
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
        coalesce(nullif(trim(g.descricao), ''), format('CODDV %s', coalesce(g.coddv::text, 'sem código'))) as descricao,
        upper(trim(coalesce(g.tipo_movimentacao, ''))) as tipo_movimentacao,
        coalesce(nullif(trim(g.categoria_n1), ''), 'Sem categoria') as categoria_n1,
        coalesce(nullif(trim(g.categoria_n2), ''), 'Sem categoria') as categoria_n2,
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
