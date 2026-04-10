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
    entrada_conf as (
        select
            c.conf_id,
            c.cd,
            c.seq_entrada,
            c.nf,
            c.conf_date as date_ref,
            coalesce(c.finalized_at, c.updated_at) as updated_at
        from app.conf_entrada_notas c
        cross join month_bounds mb
        where c.cd = p_cd
          and c.status in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_parcial', 'finalizado_falta')
          and c.conf_date >= mb.month_start
          and c.conf_date <= mb.month_end
    ),
    entrada_itens_base as (
        select
            t.cd,
            t.seq_entrada,
            t.nf,
            t.coddv,
            greatest(coalesce(max(t.vl_tt), 0), 0)::numeric(18, 2) as vl_tt
        from app.db_entrada_notas t
        group by t.cd, t.seq_entrada, t.nf, t.coddv
    ),
    entrada_conf_value as (
        select
            ec.conf_id,
            ec.date_ref,
            ec.updated_at,
            coalesce(sum(eib.vl_tt), 0)::numeric(18, 3) as actual_value
        from entrada_conf ec
        join app.conf_entrada_notas_itens i
          on i.conf_id = ec.conf_id
        left join entrada_itens_base eib
          on eib.cd = ec.cd
         and eib.seq_entrada = ec.seq_entrada
         and eib.nf = ec.nf
         and eib.coddv = i.coddv
        group by ec.conf_id, ec.date_ref, ec.updated_at
    ),
    entrada_daily as (
        select
            'entrada_notas_valor'::text as activity_key,
            ecv.date_ref,
            coalesce(sum(ecv.actual_value), 0)::numeric(18, 3) as actual_value,
            max(ecv.updated_at) as updated_at
        from entrada_conf_value ecv
        group by ecv.date_ref
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

create or replace function public.rpc_meta_mes_month_options(p_cd integer default null)
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
    v_cd := app.meta_mes_resolve_cd(p_cd);

    return query
    with available_months as (
        select date_trunc('month', timezone('America/Sao_Paulo', now())::date)::date as month_start

        union

        select date_trunc('month', timezone('America/Sao_Paulo', p.dt_hr)::date)::date
        from app.aud_pvps p
        where p.cd = v_cd

        union

        select date_trunc('month', timezone('America/Sao_Paulo', a.dt_hr)::date)::date
        from app.aud_alocacao a
        where a.cd = v_cd

        union

        select date_trunc('month', b.dt_conf)::date
        from app.db_conf_blitz b
        where b.cd = v_cd
          and b.dt_conf is not null

        union

        select date_trunc('month', c.conf_date)::date
        from app.conf_entrada_notas c
        where c.cd = v_cd
          and c.status in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_parcial', 'finalizado_falta')

        union

        select date_trunc(
            'month',
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date)
        )::date
        from app.conf_termo c
        where c.cd = v_cd
          and c.status in ('finalizado_ok', 'finalizado_falta')

        union

        select date_trunc(
            'month',
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date)
        )::date
        from app.conf_pedido_direto c
        where c.cd = v_cd
          and c.status in ('finalizado_ok', 'finalizado_falta')

        union

        select date_trunc(
            'month',
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date)
        )::date
        from app.conf_volume_avulso c
        where c.cd = v_cd
          and c.status in ('finalizado_ok', 'finalizado_falta')

        union

        select date_trunc('month', c.cycle_date)::date
        from app.conf_inventario_counts c
        where c.cd = v_cd

        union

        select date_trunc('month', t.date_ref)::date
        from app.meta_mes_daily_targets t
        where t.cd = v_cd

        union

        select mt.month_start
        from app.meta_mes_month_targets mt
        where mt.cd = v_cd
    )
    select
        am.month_start,
        to_char(am.month_start, 'MM/YYYY') as month_label
    from available_months am
    where am.month_start is not null
    group by am.month_start
    order by am.month_start desc;
end;
$$;

grant execute on function public.rpc_meta_mes_month_options(integer) to authenticated;
