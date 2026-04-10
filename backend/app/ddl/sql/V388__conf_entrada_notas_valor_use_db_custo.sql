create or replace function app.conf_entrada_notas_item_values(
    p_cd integer,
    p_dt_ini date default null,
    p_dt_fim date default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    seq_entrada bigint,
    nf bigint,
    coddv integer,
    descricao text,
    barras text,
    qtd_esperada integer,
    qtd_conferida integer,
    updated_at timestamptz,
    custo_unitario numeric,
    valor_total numeric(18, 2),
    valor_conferido numeric(18, 2)
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.seq_entrada,
        c.nf,
        i.coddv,
        coalesce(nullif(trim(i.descricao), ''), format('Produto %s', i.coddv)) as descricao,
        nullif(trim(i.barras), '') as barras,
        greatest(coalesce(i.qtd_esperada, 0), 0)::integer as qtd_esperada,
        greatest(coalesce(i.qtd_conferida, 0), 0)::integer as qtd_conferida,
        greatest(
            coalesce(i.updated_at, c.updated_at),
            coalesce(c.finalized_at, c.updated_at)
        ) as updated_at,
        greatest(coalesce(dc.custo, 0), 0)::numeric as custo_unitario,
        (
            greatest(coalesce(i.qtd_esperada, 0), 0)::numeric
            * greatest(coalesce(dc.custo, 0), 0)::numeric
        )::numeric(18, 2) as valor_total,
        (
            greatest(coalesce(i.qtd_conferida, 0), 0)::numeric
            * greatest(coalesce(dc.custo, 0), 0)::numeric
        )::numeric(18, 2) as valor_conferido
    from app.conf_entrada_notas c
    join app.conf_entrada_notas_itens i
      on i.conf_id = c.conf_id
    left join app.db_custo dc
      on dc.coddv = i.coddv
    where c.cd = p_cd
      and (p_dt_ini is null or c.conf_date >= p_dt_ini)
      and (p_dt_fim is null or c.conf_date <= p_dt_fim);
$$;

create or replace function app.meta_mes_actuals_month(
    p_cd integer,
    p_month_start date
)
returns table (
    activity_key text,
    date_ref date,
    actual_value numeric(18, 3),
    updated_at timestamptz
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
    with month_bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    pvps_first_touch as (
        select
            min(timezone('America/Sao_Paulo', p.dt_hr)::date) as date_ref,
            count(*)::numeric(18, 3) as actual_value,
            max(p.updated_at) as updated_at
        from app.aud_pvps p
        cross join month_bounds mb
        where p.cd = p_cd
          and timezone('America/Sao_Paulo', p.dt_hr)::date >= mb.month_start
          and timezone('America/Sao_Paulo', p.dt_hr)::date <= mb.month_end
        group by p.coddv
    ),
    pvps_daily as (
        select
            'pvps_coddv'::text as activity_key,
            src.date_ref,
            count(*)::numeric(18, 3) as actual_value,
            max(src.updated_at) as updated_at
        from pvps_first_touch src
        group by src.date_ref
    ),
    alocacao_first_touch as (
        select
            min(timezone('America/Sao_Paulo', a.dt_hr)::date) as date_ref,
            count(*)::numeric(18, 3) as actual_value,
            max(a.updated_at) as updated_at
        from app.aud_alocacao a
        cross join month_bounds mb
        where a.cd = p_cd
          and timezone('America/Sao_Paulo', a.dt_hr)::date >= mb.month_start
          and timezone('America/Sao_Paulo', a.dt_hr)::date <= mb.month_end
        group by a.coddv
    ),
    alocacao_daily as (
        select
            'alocacao_coddv'::text as activity_key,
            src.date_ref,
            count(*)::numeric(18, 3) as actual_value,
            max(src.updated_at) as updated_at
        from alocacao_first_touch src
        group by src.date_ref
    ),
    blitz_daily as (
        select
            'blitz_unidades'::text as activity_key,
            b.dt_conf as date_ref,
            coalesce(sum(greatest(coalesce(b.tt_un, 0), 0)), 0)::numeric(18, 3) as actual_value,
            max(b.updated_at) as updated_at
        from app.db_conf_blitz b
        cross join month_bounds mb
        where b.cd = p_cd
          and b.dt_conf is not null
          and b.dt_conf >= mb.month_start
          and b.dt_conf <= mb.month_end
        group by b.dt_conf
    ),
    entrada_daily as (
        select
            'entrada_notas_valor'::text as activity_key,
            v.conf_date as date_ref,
            coalesce(sum(v.valor_conferido), 0)::numeric(18, 3) as actual_value,
            max(v.updated_at) as updated_at
        from month_bounds mb
        cross join lateral app.conf_entrada_notas_item_values(p_cd, mb.month_start, mb.month_end) v
        join app.conf_entrada_notas c
          on c.conf_id = v.conf_id
        where c.status in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_parcial', 'finalizado_falta')
        group by v.conf_date
    ),
    termo_daily as (
        select
            'termo_conferencia'::text as activity_key,
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) as date_ref,
            count(distinct c.conf_id)::numeric(18, 3) as actual_value,
            max(coalesce(c.finalized_at, c.updated_at)) as updated_at
        from app.conf_termo c
        cross join month_bounds mb
        where c.cd = p_cd
          and c.status in ('finalizado_ok', 'finalizado_falta')
          and coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) >= mb.month_start
          and coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) <= mb.month_end
        group by 2
    ),
    pedido_direto_daily as (
        select
            'pedido_direto_conferencia'::text as activity_key,
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) as date_ref,
            count(distinct c.conf_id)::numeric(18, 3) as actual_value,
            max(coalesce(c.finalized_at, c.updated_at)) as updated_at
        from app.conf_pedido_direto c
        cross join month_bounds mb
        where c.cd = p_cd
          and c.status in ('finalizado_ok', 'finalizado_falta')
          and coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) >= mb.month_start
          and coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) <= mb.month_end
        group by 2
    ),
    volume_avulso_daily as (
        select
            'volume_avulso_conferencia'::text as activity_key,
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) as date_ref,
            count(distinct c.conf_id)::numeric(18, 3) as actual_value,
            max(coalesce(c.finalized_at, c.updated_at)) as updated_at
        from app.conf_volume_avulso c
        cross join month_bounds mb
        where c.cd = p_cd
          and c.status in ('finalizado_ok', 'finalizado_falta')
          and coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) >= mb.month_start
          and coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) <= mb.month_end
        group by 2
    ),
    zerados_base as (
        select
            c.cycle_date as date_ref,
            c.endereco,
            max(c.updated_at) as updated_at
        from app.conf_inventario_counts c
        cross join month_bounds mb
        where c.cd = p_cd
          and c.cycle_date >= mb.month_start
          and c.cycle_date <= mb.month_end
          and c.endereco is not null
        group by c.cycle_date, c.endereco
    ),
    zerados_daily as (
        select
            'zerados_endereco'::text as activity_key,
            z.date_ref,
            count(*)::numeric(18, 3) as actual_value,
            max(z.updated_at) as updated_at
        from zerados_base z
        group by z.date_ref
    )
    select
        src.activity_key,
        src.date_ref,
        src.actual_value,
        src.updated_at
    from (
        select * from pvps_daily
        union all
        select * from alocacao_daily
        union all
        select * from blitz_daily
        union all
        select * from entrada_daily
        union all
        select * from termo_daily
        union all
        select * from pedido_direto_daily
        union all
        select * from volume_avulso_daily
        union all
        select * from zerados_daily
    ) src
    where src.date_ref is not null;
$$;

create or replace function public.rpc_conf_entrada_notas_route_overview(p_cd integer default null)
returns table (
    transportadora text,
    fornecedor text,
    seq_entrada bigint,
    nf bigint,
    total_itens integer,
    itens_conferidos integer,
    itens_divergentes integer,
    valor_total numeric(18, 2),
    valor_conferido numeric(18, 2),
    status text,
    colaborador_nome text,
    colaborador_mat text,
    status_at timestamptz,
    produtos_multiplos_seq integer
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_today date;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    return query
    with entrada_itens as (
        select
            t.seq_entrada,
            t.nf,
            coalesce(nullif(trim(t.transportadora), ''), 'SEM TRANSPORTADORA') as transportadora,
            coalesce(nullif(trim(t.forn), ''), 'SEM FORNECEDOR') as fornecedor,
            t.coddv,
            greatest(sum(greatest(coalesce(t.qtd_total, 0), 0)), 0)::numeric as qtd_total,
            greatest(coalesce(max(dc.custo), 0), 0)::numeric as custo_unitario
        from app.db_entrada_notas t
        left join app.db_custo dc
          on dc.coddv = t.coddv
        where t.cd = v_cd
          and t.seq_entrada is not null
          and t.nf is not null
          and t.coddv is not null
        group by
            t.seq_entrada,
            t.nf,
            coalesce(nullif(trim(t.transportadora), ''), 'SEM TRANSPORTADORA'),
            coalesce(nullif(trim(t.forn), ''), 'SEM FORNECEDOR'),
            t.coddv
    ),
    coddv_seq_count as (
        select
            e.coddv,
            count(distinct format('%s|%s', e.seq_entrada, e.nf))::integer as seq_count
        from entrada_itens e
        group by e.coddv
    ),
    base as (
        select
            e.transportadora,
            e.fornecedor,
            e.seq_entrada,
            e.nf,
            count(*)::integer as total_itens,
            count(*) filter (where c.seq_count > 1)::integer as produtos_multiplos_seq,
            coalesce(sum(e.qtd_total * e.custo_unitario), 0)::numeric(18, 2) as valor_total
        from entrada_itens e
        join coddv_seq_count c
          on c.coddv = e.coddv
        group by
            e.transportadora,
            e.fornecedor,
            e.seq_entrada,
            e.nf
    ),
    conf_values as (
        select
            v.conf_id,
            coalesce(sum(v.valor_conferido), 0)::numeric(18, 2) as valor_conferido
        from app.conf_entrada_notas_item_values(v_cd, v_today, v_today) v
        group by v.conf_id
    ),
    conf as (
        select
            c.conf_id,
            c.seq_entrada,
            c.nf,
            c.status,
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat,
            c.started_at,
            c.finalized_at,
            (
                select count(*)::integer
                from app.conf_entrada_notas_itens i
                where i.conf_id = c.conf_id
                  and i.qtd_conferida > 0
            ) as itens_conferidos,
            (
                select count(*)::integer
                from app.conf_entrada_notas_itens i
                where i.conf_id = c.conf_id
                  and (
                      i.qtd_conferida = 0
                      or i.qtd_conferida > i.qtd_esperada
                      or (i.qtd_conferida > 0 and i.qtd_conferida < i.qtd_esperada)
                  )
            ) as itens_divergentes,
            coalesce(v.valor_conferido, 0)::numeric(18, 2) as valor_conferido
        from app.conf_entrada_notas c
        left join conf_values v
          on v.conf_id = c.conf_id
        where c.cd = v_cd
          and c.conf_date = v_today
    )
    select
        b.transportadora,
        b.fornecedor,
        b.seq_entrada,
        b.nf,
        b.total_itens,
        coalesce(c.itens_conferidos, 0)::integer as itens_conferidos,
        coalesce(c.itens_divergentes, 0)::integer as itens_divergentes,
        coalesce(b.valor_total, 0)::numeric(18, 2) as valor_total,
        coalesce(c.valor_conferido, 0)::numeric(18, 2) as valor_conferido,
        case
            when c.status = 'finalizado_parcial' then 'conferido_parcialmente'
            when c.status in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_falta') then 'concluido'
            when c.status = 'em_conferencia' then 'em_andamento'
            else 'pendente'
        end as status,
        c.colaborador_nome,
        c.colaborador_mat,
        case
            when c.status = 'finalizado_parcial' then c.finalized_at
            when c.status in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_falta') then c.finalized_at
            when c.status = 'em_conferencia' then c.started_at
            else null
        end as status_at,
        coalesce(b.produtos_multiplos_seq, 0)::integer as produtos_multiplos_seq
    from base b
    left join conf c
      on c.seq_entrada = b.seq_entrada
     and c.nf = b.nf
    order by b.transportadora, b.fornecedor, b.seq_entrada, b.nf;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_limit integer default 1000,
    p_offset integer default 0
)
returns table (
    conf_date date,
    cd integer,
    seq_entrada bigint,
    nf bigint,
    transportadora text,
    fornecedor text,
    status text,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    total_itens integer,
    itens_conferidos integer,
    itens_divergentes integer,
    valor_total numeric(18, 2),
    valor_conferido numeric(18, 2),
    coddv integer,
    descricao text,
    barras text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    ocorrencia_avariado_qtd integer,
    ocorrencia_vencido_qtd integer,
    ocorrencia_avariado_updated_at timestamptz,
    ocorrencia_vencido_updated_at timestamptz,
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

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
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

    v_limit := greatest(coalesce(p_limit, 1000), 1);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_cd := authz.resolve_admin_report_cd(v_uid, p_cd);

    return query
    with filtered_conf as (
        select
            c.conf_id,
            c.conf_date,
            c.cd,
            c.seq_entrada,
            c.nf,
            coalesce(nullif(trim(c.transportadora), ''), 'SEM TRANSPORTADORA') as transportadora,
            coalesce(nullif(trim(c.fornecedor), ''), 'SEM FORNECEDOR') as fornecedor,
            c.status,
            nullif(trim(c.started_mat), '') as started_mat,
            nullif(trim(c.started_nome), '') as started_nome,
            c.started_at,
            c.finalized_at,
            c.updated_at
        from app.conf_entrada_notas c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    item_values as (
        select v.*
        from app.conf_entrada_notas_item_values(v_cd, p_dt_ini, p_dt_fim) v
    ),
    occ as (
        select
            o.conf_id,
            o.coddv,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Avariado'), 0)::integer as ocorrencia_avariado_qtd,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Vencido'), 0)::integer as ocorrencia_vencido_qtd,
            max(o.updated_at) filter (where o.tipo = 'Avariado' and o.qtd > 0) as ocorrencia_avariado_updated_at,
            max(o.updated_at) filter (where o.tipo = 'Vencido' and o.qtd > 0) as ocorrencia_vencido_updated_at
        from app.conf_entrada_notas_ocorrencias o
        join filtered_conf c
          on c.conf_id = o.conf_id
        group by o.conf_id, o.coddv
    ),
    conf_stats as (
        select
            i.conf_id,
            count(*)::integer as total_itens,
            count(*) filter (where coalesce(i.qtd_conferida, 0) > 0)::integer as itens_conferidos,
            count(*) filter (
                where coalesce(i.qtd_conferida, 0) = 0
                   or coalesce(i.qtd_conferida, 0) <> coalesce(i.qtd_esperada, 0)
                   or coalesce(o.ocorrencia_avariado_qtd, 0) > 0
                   or coalesce(o.ocorrencia_vencido_qtd, 0) > 0
            )::integer as itens_divergentes
        from app.conf_entrada_notas_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
        left join occ o
          on o.conf_id = i.conf_id
         and o.coddv = i.coddv
        group by i.conf_id
    ),
    conf_values as (
        select
            v.conf_id,
            coalesce(sum(v.valor_total), 0)::numeric(18, 2) as valor_total,
            coalesce(sum(v.valor_conferido), 0)::numeric(18, 2) as valor_conferido
        from item_values v
        group by v.conf_id
    )
    select
        c.conf_date,
        c.cd,
        c.seq_entrada,
        c.nf,
        c.transportadora,
        c.fornecedor,
        c.status,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        coalesce(s.total_itens, 0)::integer as total_itens,
        coalesce(s.itens_conferidos, 0)::integer as itens_conferidos,
        coalesce(s.itens_divergentes, 0)::integer as itens_divergentes,
        coalesce(v.valor_total, 0)::numeric(18, 2) as valor_total,
        coalesce(v.valor_conferido, 0)::numeric(18, 2) as valor_conferido,
        i.coddv,
        coalesce(nullif(trim(i.descricao), ''), iv.descricao, format('Produto %s', i.coddv)) as descricao,
        nullif(trim(i.barras), '') as barras,
        coalesce(i.qtd_esperada, 0)::integer as qtd_esperada,
        coalesce(i.qtd_conferida, 0)::integer as qtd_conferida,
        greatest(coalesce(i.qtd_esperada, 0) - coalesce(i.qtd_conferida, 0), 0)::integer as qtd_falta,
        greatest(coalesce(i.qtd_conferida, 0) - coalesce(i.qtd_esperada, 0), 0)::integer as qtd_sobra,
        case
            when coalesce(i.qtd_conferida, 0) = 0 then 'nao_conferido'
            when coalesce(i.qtd_conferida, 0) < coalesce(i.qtd_esperada, 0) then 'falta'
            when coalesce(i.qtd_conferida, 0) > coalesce(i.qtd_esperada, 0) then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        coalesce(o.ocorrencia_avariado_qtd, 0)::integer as ocorrencia_avariado_qtd,
        coalesce(o.ocorrencia_vencido_qtd, 0)::integer as ocorrencia_vencido_qtd,
        o.ocorrencia_avariado_updated_at,
        o.ocorrencia_vencido_updated_at,
        i.updated_at as item_updated_at
    from filtered_conf c
    join app.conf_entrada_notas_itens i
      on i.conf_id = c.conf_id
    left join item_values iv
      on iv.conf_id = i.conf_id
     and iv.coddv = i.coddv
    left join occ o
      on o.conf_id = i.conf_id
     and o.coddv = i.coddv
    left join conf_stats s
      on s.conf_id = c.conf_id
    left join conf_values v
      on v.conf_id = c.conf_id
    order by
        c.conf_date,
        c.transportadora,
        c.fornecedor,
        c.seq_entrada,
        c.nf,
        i.coddv
    limit v_limit
    offset v_offset;
end;
$$;

grant execute on function public.rpc_conf_entrada_notas_route_overview(integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_report_rows(date, date, integer, integer, integer) to authenticated;
