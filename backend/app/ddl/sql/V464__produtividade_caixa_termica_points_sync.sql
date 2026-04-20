do $$
begin
    if to_regprocedure('app.produtividade_events_base_legacy_v464(integer,date,date)') is null then
        alter function app.produtividade_events_base(integer, date, date)
        rename to produtividade_events_base_legacy_v464;
    end if;
end;
$$;

create or replace function app.produtividade_events_base(
    p_cd integer,
    p_dt_ini date default null,
    p_dt_fim date default null
)
returns table (
    activity_key text,
    activity_label text,
    unit_label text,
    user_id uuid,
    mat text,
    nome text,
    event_date date,
    metric_value numeric(18,3),
    detail text,
    source_ref text,
    event_at timestamptz
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $function$
    with base as (
        select
            b.activity_key,
            b.activity_label,
            b.unit_label,
            b.user_id,
            b.mat,
            b.nome,
            b.event_date,
            b.metric_value,
            b.detail,
            b.source_ref,
            b.event_at
        from app.produtividade_events_base_legacy_v464(p_cd, p_dt_ini, p_dt_fim) b
    ),
    caixa_termica_recalculada as (
        select
            b.activity_key,
            b.activity_label,
            b.unit_label,
            b.user_id,
            b.mat,
            b.nome,
            b.event_date,
            greatest(
                0.5,
                3.5 - (
                    (row_number() over (
                        partition by b.user_id, b.event_date
                        order by b.event_at, b.source_ref
                    ) - 1) * 0.5
                )
            )::numeric(18,3) as metric_value,
            b.detail,
            b.source_ref,
            b.event_at
        from base b
        where b.activity_key = 'caixa_termica_mov'
    )
    select
        b.activity_key,
        b.activity_label,
        b.unit_label,
        b.user_id,
        b.mat,
        b.nome,
        b.event_date,
        b.metric_value,
        b.detail,
        b.source_ref,
        b.event_at
    from base b
    where b.activity_key <> 'caixa_termica_mov'

    union all

    select
        c.activity_key,
        c.activity_label,
        c.unit_label,
        c.user_id,
        c.mat,
        c.nome,
        c.event_date,
        c.metric_value,
        c.detail,
        c.source_ref,
        c.event_at
    from caixa_termica_recalculada c;
$function$;

notify pgrst, 'reload schema';
