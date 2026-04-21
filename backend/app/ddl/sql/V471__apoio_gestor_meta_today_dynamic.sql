create or replace function public.rpc_apoio_gestor_daily_summary(
    p_cd   integer,
    p_date date default null
)
returns table (
    activity_key    text,
    activity_label  text,
    unit_label      text,
    actual_today    numeric,
    target_today    numeric,
    achievement_pct numeric,
    has_meta        boolean,
    sort_order      integer
)
language sql
stable
security definer
set search_path = app, public
as $$
    with
    resolved_date as (
        select coalesce(p_date, timezone('America/Sao_Paulo', now())::date) as d
    ),

    meta_actuals as (
        select
            a.activity_key,
            a.actual_value
        from app.meta_mes_actuals_month(
            p_cd,
            date_trunc('month', (select d from resolved_date))::date
        ) a
        where a.date_ref = (select d from resolved_date)
    ),

    meta_catalog as (
        select * from app.meta_mes_activity_catalog()
    ),

    meta_targets as (
        select
            t.activity_key,
            case
                when t.is_holiday = false and coalesce(t.target_value, 0) > 0
                then t.target_value
                else null::numeric
            end as target_value
        from app.meta_mes_daily_targets t
        where t.cd = p_cd
          and t.date_ref = (select d from resolved_date)
    ),

    meta_rows as (
        select
            c.activity_key,
            c.activity_label,
            c.unit_label,
            coalesce(a.actual_value, 0)::numeric as actual_today,
            t.target_value::numeric as target_today,
            case
                when t.target_value > 0
                then round((coalesce(a.actual_value, 0) / t.target_value) * 100, 1)
                else null
            end as achievement_pct,
            coalesce(t.target_value, 0) > 0 as has_meta,
            c.sort_order::integer
        from meta_catalog c
        left join meta_actuals a on a.activity_key = c.activity_key
        left join meta_targets t on t.activity_key = c.activity_key
    ),

    conf_transferencia as (
        select
            'conf_transferencia_cd'::text,
            'Conf. Transferência CD'::text,
            'conferências'::text,
            count(*)::numeric, null::numeric, null::numeric, false, 100::integer
        from app.conf_transferencia_cd
        where (cd_ori = p_cd or cd_des = p_cd)
          and conf_date = (select d from resolved_date)
          and status in ('finalizado_ok', 'finalizado_falta')
    ),

    ativ_extra as (
        select
            'atividade_extra'::text,
            'Atividade Extra'::text,
            'pontos'::text,
            coalesce(sum(pontos), 0)::numeric, null::numeric, null::numeric, false, 110::integer
        from app.atividade_extra
        where cd = p_cd
          and data_inicio = (select d from resolved_date)
    ),

    coleta as (
        select
            'coleta_mercadoria'::text,
            'Coleta de Mercadorias'::text,
            'itens'::text,
            count(*)::numeric, null::numeric, null::numeric, false, 120::integer
        from app.aud_coleta
        where cd = p_cd
          and timezone('America/Sao_Paulo', data_hr)::date = (select d from resolved_date)
    ),

    embarque as (
        select
            'embarque_caixa_termica'::text,
            'Embarque Caixa Térmica'::text,
            'embarques'::text,
            count(*)::numeric, null::numeric, null::numeric, false, 140::integer
        from app.controle_caixa_termica_movs mov
        join app.controle_caixa_termica cxt on cxt.id = mov.caixa_id
        where cxt.cd = p_cd
          and mov.tipo = 'expedicao'
          and timezone('America/Sao_Paulo', mov.data_hr)::date = (select d from resolved_date)
    )

    select * from meta_rows
    union all
    select * from conf_transferencia
    union all
    select * from ativ_extra
    union all
    select * from coleta
    union all
    select * from embarque
    order by 8;
$$;

revoke all on function public.rpc_apoio_gestor_daily_summary(integer, date) from anon;
grant execute on function public.rpc_apoio_gestor_daily_summary(integer, date) to authenticated;
