create table if not exists staging.db_gestao_estq (
    cd integer,
    data_mov date,
    coddv integer,
    descricao text,
    tipo_movimentacao text,
    valor_mov numeric,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default now()
);

create table if not exists app.db_gestao_estq (
    cd integer,
    data_mov date,
    coddv integer,
    descricao text,
    tipo_movimentacao text,
    valor_mov numeric,
    source_run_id uuid,
    updated_at timestamptz not null default now()
);

create table if not exists audit.rejections_db_gestao_estq (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_app_db_gestao_estq_cd
    on app.db_gestao_estq(cd);

create index if not exists idx_app_db_gestao_estq_cd_data_mov
    on app.db_gestao_estq(cd, data_mov);

create index if not exists idx_app_db_gestao_estq_cd_coddv
    on app.db_gestao_estq(cd, coddv);

create index if not exists idx_app_db_gestao_estq_cd_tipo
    on app.db_gestao_estq(cd, tipo_movimentacao);

create index if not exists idx_staging_db_gestao_estq_run_id
    on staging.db_gestao_estq(run_id);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_gestao_estq_source_run'
    ) then
        alter table app.db_gestao_estq
            add constraint fk_app_db_gestao_estq_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;
end;
$$;

select app.apply_runtime_security('db_gestao_estq');

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

create or replace function public.rpc_indicadores_gestao_estq_month_options(p_cd integer default null)
returns table (
    month_start date,
    month_label text
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
        date_trunc('month', g.data_mov)::date as month_start,
        to_char(date_trunc('month', g.data_mov)::date, 'MM/YYYY') as month_label
    from app.db_gestao_estq g
    where g.cd = v_cd
      and g.data_mov is not null
    group by 1
    order by 1 desc;
end;
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
    )
    select
        b.month_start,
        b.month_end,
        min(m.data_mov) as available_day_start,
        max(m.data_mov) as available_day_end,
        greatest(
            coalesce(max(m.updated_at), '-infinity'::timestamptz),
            coalesce(max(y.updated_at), '-infinity'::timestamptz)
        ) as updated_at,
        coalesce(sum(case when m.movement_group = 'entrada' then m.abs_valor else 0 end), 0)::numeric as total_entradas_mes,
        coalesce(sum(case when m.movement_group = 'saida' then m.abs_valor else 0 end), 0)::numeric as total_saidas_mes,
        coalesce(sum(case when m.natureza = 'sobra' then m.abs_valor else 0 end), 0)::numeric as total_sobras_mes,
        coalesce(sum(case when m.natureza = 'falta' then m.abs_valor else 0 end), 0)::numeric as total_faltas_mes,
        (
            coalesce(sum(case when m.natureza = 'falta' then m.abs_valor else 0 end), 0)
            - coalesce(sum(case when m.natureza = 'sobra' then m.abs_valor else 0 end), 0)
        )::numeric as perda_mes_atual,
        (
            coalesce(sum(case when y.natureza = 'falta' then y.abs_valor else 0 end), 0)
            - coalesce(sum(case when y.natureza = 'sobra' then y.abs_valor else 0 end), 0)
        )::numeric as perda_acumulada_ano,
        coalesce(sum(case when y.movement_group = 'entrada' then y.abs_valor else 0 end), 0)::numeric as acumulado_entradas_ano,
        coalesce(sum(case when y.movement_group = 'saida' then y.abs_valor else 0 end), 0)::numeric as acumulado_saidas_ano,
        count(distinct m.coddv)::bigint as produtos_distintos_mes
    from bounds b
    left join month_rows m on true
    left join year_rows y on true
    group by b.month_start, b.month_end;
end;
$$;

create or replace function public.rpc_indicadores_gestao_estq_daily_series(
    p_cd integer default null,
    p_month_start date default null,
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
            least(
                (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date,
                timezone('America/Sao_Paulo', now())::date
            ) as visible_end
    ),
    series as (
        select generate_series(b.month_start, b.visible_end, interval '1 day')::date as date_ref
        from bounds b
    ),
    rows_base as (
        select r.*
        from bounds b
        cross join lateral app.indicadores_gestao_estq_rows(v_cd, b.month_start, b.visible_end) r
        where v_filter = 'todas' or r.movement_group = v_filter
    ),
    daily as (
        select
            r.data_mov as date_ref,
            coalesce(sum(case when r.movement_group = 'entrada' then r.abs_valor else 0 end), 0)::numeric as entrada_total,
            coalesce(sum(case when r.movement_group = 'saida' then r.abs_valor else 0 end), 0)::numeric as saida_total,
            (
                coalesce(sum(case when r.natureza = 'falta' then r.abs_valor else 0 end), 0)
                - coalesce(sum(case when r.natureza = 'sobra' then r.abs_valor else 0 end), 0)
            )::numeric as perda_total
        from rows_base r
        group by r.data_mov
    )
    select
        s.date_ref,
        coalesce(d.entrada_total, 0)::numeric as entrada_total,
        coalesce(d.saida_total, 0)::numeric as saida_total,
        coalesce(d.perda_total, 0)::numeric as perda_total
    from series s
    left join daily d using (date_ref)
    order by s.date_ref;
end;
$$;

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

    return query
    with bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    rows_base as (
        select r.*
        from bounds b
        cross join lateral app.indicadores_gestao_estq_rows(v_cd, b.month_start, b.month_end) r
        where r.movement_group = v_rank_group
          and (p_day is null or r.data_mov = p_day)
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
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    rows_base as (
        select r.*
        from bounds b
        cross join lateral app.indicadores_gestao_estq_rows(v_cd, b.month_start, b.month_end) r
        where (v_filter = 'todas' or r.movement_group = v_filter)
          and (p_day is null or r.data_mov = p_day)
    )
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
    order by r.data_mov desc, valor_total desc, r.coddv asc;
end;
$$;

create or replace function public.rpc_indicadores_gestao_estq_year_reentry_items(
    p_cd integer default null,
    p_month_start date default null
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
begin
    v_cd := app.indicadores_resolve_cd(p_cd);

    return query
    with bounds as (
        select
            date_trunc('year', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as year_start,
            (date_trunc('year', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 year - 1 day')::date as year_end
    ),
    rows_base as (
        select r.*
        from bounds b
        cross join lateral app.indicadores_gestao_estq_rows(v_cd, b.year_start, b.year_end) r
        where r.movement_group in ('entrada', 'saida')
    ),
    exits as (
        select
            r.coddv,
            min(r.data_mov) as first_saida_date,
            coalesce(sum(r.abs_valor), 0)::numeric as total_saida_ano
        from rows_base r
        where r.movement_group = 'saida'
        group by r.coddv
    ),
    entries as (
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
        max(r.descricao) as descricao,
        e.first_saida_date,
        en.first_entrada_after_saida_date,
        e.total_saida_ano,
        coalesce(et.total_entrada_ano, 0)::numeric as total_entrada_ano,
        (coalesce(et.total_entrada_ano, 0) - e.total_saida_ano)::numeric as saldo_ano
    from exits e
    join entries en
      on en.coddv = e.coddv
    left join entry_totals et
      on et.coddv = e.coddv
    join rows_base r
      on r.coddv = e.coddv
    group by e.coddv, e.first_saida_date, en.first_entrada_after_saida_date, e.total_saida_ano, et.total_entrada_ano
    order by en.first_entrada_after_saida_date desc, e.total_saida_ano desc, e.coddv asc;
end;
$$;

grant execute on function public.rpc_indicadores_gestao_estq_month_options(integer) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_summary(integer, date, text) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_daily_series(integer, date, text) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_top_items(integer, date, date, text, text) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_details(integer, date, date, text) to authenticated;
grant execute on function public.rpc_indicadores_gestao_estq_year_reentry_items(integer, date) to authenticated;
