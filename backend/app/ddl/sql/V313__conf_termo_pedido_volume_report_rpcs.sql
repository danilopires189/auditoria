drop function if exists public.rpc_conf_termo_report_count(date, date, integer);
create or replace function public.rpc_conf_termo_report_count(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer
)
returns table (
    total_conferencias bigint,
    total_itens bigint
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if not authz.is_admin(v_uid) then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_dt_ini is null then
        raise exception 'DATA_INICIAL_OBRIGATORIA';
    end if;

    if p_dt_fim is null then
        raise exception 'DATA_FINAL_OBRIGATORIA';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    v_cd := app.conf_termo_resolve_cd(p_cd);

    return query
    with filtered_conf as (
        select c.conf_id
        from app.conf_termo c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    filtered_items as (
        select i.item_id
        from app.conf_termo_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
    )
    select
        (select count(*)::bigint from filtered_conf) as total_conferencias,
        (select count(*)::bigint from filtered_items) as total_itens;
end;
$$;

drop function if exists public.rpc_conf_termo_report_rows(date, date, integer, integer, integer);
create or replace function public.rpc_conf_termo_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_limit integer default 1000,
    p_offset integer default 0
)
returns table (
    conf_date date,
    cd integer,
    id_etiqueta text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    status text,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    total_itens integer,
    itens_conferidos integer,
    itens_divergentes integer,
    falta_motivo text,
    coddv integer,
    descricao text,
    barras text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    item_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_limit integer;
    v_offset integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if not authz.is_admin(v_uid) then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_dt_ini is null then
        raise exception 'DATA_INICIAL_OBRIGATORIA';
    end if;

    if p_dt_fim is null then
        raise exception 'DATA_FINAL_OBRIGATORIA';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    v_limit := greatest(coalesce(p_limit, 1000), 1);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_cd := app.conf_termo_resolve_cd(p_cd);

    return query
    with filtered_conf as (
        select
            c.conf_id,
            c.conf_date,
            c.cd,
            c.id_etiqueta,
            nullif(trim(coalesce(c.caixa, '')), '') as caixa,
            c.pedido,
            c.filial,
            coalesce(nullif(trim(c.filial_nome), ''), 'SEM FILIAL') as filial_nome,
            coalesce(nullif(trim(c.rota), ''), 'SEM ROTA') as rota,
            c.status,
            nullif(trim(c.started_mat), '') as started_mat,
            nullif(trim(c.started_nome), '') as started_nome,
            c.started_at,
            c.finalized_at,
            c.updated_at,
            nullif(trim(coalesce(c.falta_motivo, '')), '') as falta_motivo
        from app.conf_termo c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    conf_stats as (
        select
            i.conf_id,
            count(*)::integer as total_itens,
            count(*) filter (where coalesce(i.qtd_conferida, 0) > 0)::integer as itens_conferidos,
            count(*) filter (
                where coalesce(i.qtd_conferida, 0) <> coalesce(i.qtd_esperada, 0)
            )::integer as itens_divergentes
        from app.conf_termo_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
        group by i.conf_id
    )
    select
        c.conf_date,
        c.cd,
        c.id_etiqueta,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
        c.status,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        coalesce(s.total_itens, 0)::integer as total_itens,
        coalesce(s.itens_conferidos, 0)::integer as itens_conferidos,
        coalesce(s.itens_divergentes, 0)::integer as itens_divergentes,
        c.falta_motivo,
        i.coddv,
        coalesce(nullif(trim(i.descricao), ''), format('Produto %s', i.coddv)) as descricao,
        nullif(trim(i.barras), '') as barras,
        coalesce(i.qtd_esperada, 0)::integer as qtd_esperada,
        coalesce(i.qtd_conferida, 0)::integer as qtd_conferida,
        greatest(coalesce(i.qtd_esperada, 0) - coalesce(i.qtd_conferida, 0), 0)::integer as qtd_falta,
        greatest(coalesce(i.qtd_conferida, 0) - coalesce(i.qtd_esperada, 0), 0)::integer as qtd_sobra,
        case
            when coalesce(i.qtd_conferida, 0) < coalesce(i.qtd_esperada, 0) then 'falta'
            when coalesce(i.qtd_conferida, 0) > coalesce(i.qtd_esperada, 0) then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at as item_updated_at
    from filtered_conf c
    join app.conf_termo_itens i
      on i.conf_id = c.conf_id
    left join conf_stats s
      on s.conf_id = c.conf_id
    order by
        c.conf_date,
        c.rota,
        c.filial_nome,
        c.id_etiqueta,
        i.coddv
    limit v_limit
    offset v_offset;
end;
$$;

drop function if exists public.rpc_conf_pedido_direto_report_count(date, date, integer);
create or replace function public.rpc_conf_pedido_direto_report_count(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer
)
returns table (
    total_conferencias bigint,
    total_itens bigint
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if not authz.is_admin(v_uid) then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_dt_ini is null then
        raise exception 'DATA_INICIAL_OBRIGATORIA';
    end if;

    if p_dt_fim is null then
        raise exception 'DATA_FINAL_OBRIGATORIA';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);

    return query
    with filtered_conf as (
        select c.conf_id
        from app.conf_pedido_direto c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    filtered_items as (
        select i.item_id
        from app.conf_pedido_direto_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
    )
    select
        (select count(*)::bigint from filtered_conf) as total_conferencias,
        (select count(*)::bigint from filtered_items) as total_itens;
end;
$$;

drop function if exists public.rpc_conf_pedido_direto_report_rows(date, date, integer, integer, integer);
create or replace function public.rpc_conf_pedido_direto_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_limit integer default 1000,
    p_offset integer default 0
)
returns table (
    conf_date date,
    cd integer,
    id_vol text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    status text,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    total_itens integer,
    itens_conferidos integer,
    itens_divergentes integer,
    falta_motivo text,
    coddv integer,
    descricao text,
    barras text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    item_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_limit integer;
    v_offset integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if not authz.is_admin(v_uid) then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_dt_ini is null then
        raise exception 'DATA_INICIAL_OBRIGATORIA';
    end if;

    if p_dt_fim is null then
        raise exception 'DATA_FINAL_OBRIGATORIA';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    v_limit := greatest(coalesce(p_limit, 1000), 1);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);

    return query
    with filtered_conf as (
        select
            c.conf_id,
            c.conf_date,
            c.cd,
            c.id_vol,
            nullif(trim(coalesce(c.caixa, '')), '') as caixa,
            c.pedido,
            c.filial,
            coalesce(nullif(trim(c.filial_nome), ''), 'SEM FILIAL') as filial_nome,
            coalesce(nullif(trim(c.rota), ''), 'SEM ROTA') as rota,
            c.status,
            nullif(trim(c.started_mat), '') as started_mat,
            nullif(trim(c.started_nome), '') as started_nome,
            c.started_at,
            c.finalized_at,
            c.updated_at,
            nullif(trim(coalesce(c.falta_motivo, '')), '') as falta_motivo
        from app.conf_pedido_direto c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    conf_stats as (
        select
            i.conf_id,
            count(*)::integer as total_itens,
            count(*) filter (where coalesce(i.qtd_conferida, 0) > 0)::integer as itens_conferidos,
            count(*) filter (
                where coalesce(i.qtd_conferida, 0) <> coalesce(i.qtd_esperada, 0)
            )::integer as itens_divergentes
        from app.conf_pedido_direto_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
        group by i.conf_id
    )
    select
        c.conf_date,
        c.cd,
        c.id_vol,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
        c.status,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        coalesce(s.total_itens, 0)::integer as total_itens,
        coalesce(s.itens_conferidos, 0)::integer as itens_conferidos,
        coalesce(s.itens_divergentes, 0)::integer as itens_divergentes,
        c.falta_motivo,
        i.coddv,
        coalesce(nullif(trim(i.descricao), ''), format('Produto %s', i.coddv)) as descricao,
        nullif(trim(i.barras), '') as barras,
        coalesce(i.qtd_esperada, 0)::integer as qtd_esperada,
        coalesce(i.qtd_conferida, 0)::integer as qtd_conferida,
        greatest(coalesce(i.qtd_esperada, 0) - coalesce(i.qtd_conferida, 0), 0)::integer as qtd_falta,
        greatest(coalesce(i.qtd_conferida, 0) - coalesce(i.qtd_esperada, 0), 0)::integer as qtd_sobra,
        case
            when coalesce(i.qtd_conferida, 0) < coalesce(i.qtd_esperada, 0) then 'falta'
            when coalesce(i.qtd_conferida, 0) > coalesce(i.qtd_esperada, 0) then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at as item_updated_at
    from filtered_conf c
    join app.conf_pedido_direto_itens i
      on i.conf_id = c.conf_id
    left join conf_stats s
      on s.conf_id = c.conf_id
    order by
        c.conf_date,
        c.rota,
        c.filial_nome,
        c.id_vol,
        i.coddv
    limit v_limit
    offset v_offset;
end;
$$;

drop function if exists public.rpc_conf_volume_avulso_report_count(date, date, integer);
create or replace function public.rpc_conf_volume_avulso_report_count(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer
)
returns table (
    total_conferencias bigint,
    total_itens bigint
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if not authz.is_admin(v_uid) then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_dt_ini is null then
        raise exception 'DATA_INICIAL_OBRIGATORIA';
    end if;

    if p_dt_fim is null then
        raise exception 'DATA_FINAL_OBRIGATORIA';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);

    return query
    with filtered_conf as (
        select c.conf_id
        from app.conf_volume_avulso c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    filtered_items as (
        select i.item_id
        from app.conf_volume_avulso_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
    )
    select
        (select count(*)::bigint from filtered_conf) as total_conferencias,
        (select count(*)::bigint from filtered_items) as total_itens;
end;
$$;

drop function if exists public.rpc_conf_volume_avulso_report_rows(date, date, integer, integer, integer);
create or replace function public.rpc_conf_volume_avulso_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_limit integer default 1000,
    p_offset integer default 0
)
returns table (
    conf_date date,
    cd integer,
    nr_volume text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    status text,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    total_itens integer,
    itens_conferidos integer,
    itens_divergentes integer,
    falta_motivo text,
    coddv integer,
    descricao text,
    barras text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    lotes text,
    validades text,
    item_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_limit integer;
    v_offset integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if not authz.is_admin(v_uid) then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_dt_ini is null then
        raise exception 'DATA_INICIAL_OBRIGATORIA';
    end if;

    if p_dt_fim is null then
        raise exception 'DATA_FINAL_OBRIGATORIA';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    v_limit := greatest(coalesce(p_limit, 1000), 1);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);

    return query
    with filtered_conf as (
        select
            c.conf_id,
            c.conf_date,
            c.cd,
            c.nr_volume,
            nullif(trim(coalesce(c.caixa, '')), '') as caixa,
            c.pedido,
            c.filial,
            coalesce(nullif(trim(c.filial_nome), ''), 'SEM FILIAL') as filial_nome,
            coalesce(nullif(trim(c.rota), ''), 'SEM ROTA') as rota,
            c.status,
            nullif(trim(c.started_mat), '') as started_mat,
            nullif(trim(c.started_nome), '') as started_nome,
            c.started_at,
            c.finalized_at,
            c.updated_at,
            nullif(trim(coalesce(c.falta_motivo, '')), '') as falta_motivo
        from app.conf_volume_avulso c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    conf_stats as (
        select
            i.conf_id,
            count(*)::integer as total_itens,
            count(*) filter (where coalesce(i.qtd_conferida, 0) > 0)::integer as itens_conferidos,
            count(*) filter (
                where coalesce(i.qtd_conferida, 0) <> coalesce(i.qtd_esperada, 0)
            )::integer as itens_divergentes
        from app.conf_volume_avulso_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
        group by i.conf_id
    )
    select
        c.conf_date,
        c.cd,
        c.nr_volume,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
        c.status,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        coalesce(s.total_itens, 0)::integer as total_itens,
        coalesce(s.itens_conferidos, 0)::integer as itens_conferidos,
        coalesce(s.itens_divergentes, 0)::integer as itens_divergentes,
        c.falta_motivo,
        i.coddv,
        coalesce(nullif(trim(i.descricao), ''), format('Produto %s', i.coddv)) as descricao,
        nullif(trim(i.barras), '') as barras,
        coalesce(i.qtd_esperada, 0)::integer as qtd_esperada,
        coalesce(i.qtd_conferida, 0)::integer as qtd_conferida,
        greatest(coalesce(i.qtd_esperada, 0) - coalesce(i.qtd_conferida, 0), 0)::integer as qtd_falta,
        greatest(coalesce(i.qtd_conferida, 0) - coalesce(i.qtd_esperada, 0), 0)::integer as qtd_sobra,
        case
            when coalesce(i.qtd_conferida, 0) < coalesce(i.qtd_esperada, 0) then 'falta'
            when coalesce(i.qtd_conferida, 0) > coalesce(i.qtd_esperada, 0) then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        lv.lotes,
        lv.validades,
        i.updated_at as item_updated_at
    from filtered_conf c
    join app.conf_volume_avulso_itens i
      on i.conf_id = c.conf_id
    left join conf_stats s
      on s.conf_id = c.conf_id
    left join lateral (
        select
            nullif(
                string_agg(
                    distinct nullif(trim(t.lote), ''),
                    ', ' order by nullif(trim(t.lote), '')
                ),
                ''
            ) as lotes,
            nullif(
                string_agg(
                    distinct nullif(trim(t.val), ''),
                    ', ' order by nullif(trim(t.val), '')
                ),
                ''
            ) as validades
        from app.db_avulso t
        where t.cd = c.cd
          and t.nr_volume = c.nr_volume
          and t.coddv = i.coddv
    ) lv on true
    order by
        c.conf_date,
        c.rota,
        c.filial_nome,
        c.nr_volume,
        i.coddv
    limit v_limit
    offset v_offset;
end;
$$;

grant execute on function public.rpc_conf_termo_report_count(date, date, integer) to authenticated;
grant execute on function public.rpc_conf_termo_report_rows(date, date, integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_report_count(date, date, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_report_rows(date, date, integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_report_count(date, date, integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_report_rows(date, date, integer, integer, integer) to authenticated;
