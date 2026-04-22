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

    meta_catalog as (
        select * from app.meta_mes_activity_catalog()
    ),

    meta_rows as (
        select
            c.activity_key,
            c.activity_label,
            c.unit_label,
            coalesce(day_row.actual_value, 0)::numeric as actual_today,
            case
                when day_row.target_kind = 'meta' then day_row.target_value::numeric
                else null::numeric
            end as target_today,
            case
                when day_row.target_kind = 'meta' and coalesce(day_row.target_value, 0) > 0
                then round(day_row.percent_achievement, 1)
                else null::numeric
            end as achievement_pct,
            (day_row.target_kind = 'meta') as has_meta,
            c.sort_order::integer
        from meta_catalog c
        left join lateral (
            select
                d.target_kind,
                d.target_value,
                d.actual_value,
                d.percent_achievement
            from app.meta_mes_daily_activity(
                p_cd,
                c.activity_key,
                (select d from resolved_date)
            ) d
            where d.date_ref = (select d from resolved_date)
            limit 1
        ) day_row on true
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
