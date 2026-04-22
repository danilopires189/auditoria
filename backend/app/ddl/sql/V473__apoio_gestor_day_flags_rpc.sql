create or replace function public.rpc_apoio_gestor_day_flags(
    p_cd   integer,
    p_date date default null
)
returns table (
    meta_defined_count integer,
    is_holiday boolean,
    is_sunday boolean
)
language sql
stable
security definer
set search_path = app, public
as $$
    with resolved_date as (
        select coalesce(p_date, timezone('America/Sao_Paulo', now())::date) as d
    ),
    meta_catalog as (
        select activity_key
        from app.meta_mes_activity_catalog()
    ),
    day_rows as (
        select
            c.activity_key,
            d.target_kind
        from meta_catalog c
        left join lateral (
            select target_kind
            from app.meta_mes_daily_activity(
                p_cd,
                c.activity_key,
                (select d from resolved_date)
            )
            where date_ref = (select d from resolved_date)
            limit 1
        ) d on true
    )
    select
        count(*) filter (where target_kind = 'meta')::integer as meta_defined_count,
        bool_or(target_kind = 'feriado') as is_holiday,
        bool_or(target_kind = 'domingo') as is_sunday
    from day_rows;
$$;

revoke all on function public.rpc_apoio_gestor_day_flags(integer, date) from anon;
grant execute on function public.rpc_apoio_gestor_day_flags(integer, date) to authenticated;
