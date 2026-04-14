create or replace function app.indicadores_pvps_aloc_rows(
    p_cd integer,
    p_month_start date default null,
    p_tipo text default 'ambos'
)
returns table (
    date_ref date,
    modulo text,
    zona text,
    endereco text,
    descricao text,
    coddv integer,
    status_dashboard text,
    eligible_audit boolean,
    eligible_error boolean,
    eligible_conform boolean,
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
    bounds_ts as (
        select
            month_start,
            month_end,
            (month_start::timestamp at time zone 'America/Sao_Paulo') as month_start_ts,
            ((month_end + 1)::timestamp at time zone 'America/Sao_Paulo') as month_end_ts
        from month_bounds
    ),
    params as (
        select app.indicadores_pvps_aloc_tipo(p_tipo) as tipo
    ),
    pvps_pul_rows as (
        select
            timezone('America/Sao_Paulo', apu.dt_hr)::date as date_ref,
            'pvps'::text as modulo,
            coalesce(nullif(trim(ap.zona), ''), 'Sem zona') as zona,
            coalesce(nullif(trim(apu.end_pul), ''), nullif(trim(ap.end_sep), ''), 'Sem endereço') as endereco,
            coalesce(nullif(trim(ap.descricao), ''), format('CODDV %s', ap.coddv)) as descricao,
            ap.coddv,
            case
                when lower(coalesce(apu.end_sit, '')) in ('vazio', 'obstruido') then lower(apu.end_sit)
                when ap.val_sep is not null
                    and apu.val_pul is not null
                    and app.pvps_alocacao_validade_rank(apu.val_pul) < app.pvps_alocacao_validade_rank(ap.val_sep)
                    then 'nao_conforme'
                else 'conforme'
            end as status_dashboard,
            (apu.end_sit is null) as eligible_audit,
            (
                apu.end_sit is null
                and ap.val_sep is not null
                and apu.val_pul is not null
                and app.pvps_alocacao_validade_rank(apu.val_pul) < app.pvps_alocacao_validade_rank(ap.val_sep)
            ) as eligible_error,
            (
                apu.end_sit is null
                and not (
                    ap.val_sep is not null
                    and apu.val_pul is not null
                    and app.pvps_alocacao_validade_rank(apu.val_pul) < app.pvps_alocacao_validade_rank(ap.val_sep)
                )
            ) as eligible_conform,
            greatest(
                coalesce(apu.updated_at, apu.dt_hr),
                coalesce(ap.updated_at, coalesce(ap.dt_hr_sep, ap.dt_hr))
            ) as updated_at
        from app.aud_pvps_pul apu
        join app.aud_pvps ap
          on ap.audit_id = apu.audit_id
        cross join bounds_ts bt
        cross join params p
        where p.tipo in ('ambos', 'pvps')
          and ap.cd = p_cd
          and apu.dt_hr >= bt.month_start_ts
          and apu.dt_hr < bt.month_end_ts
    ),
    pvps_sep_occurrence_rows as (
        select
            timezone('America/Sao_Paulo', coalesce(ap.dt_hr_sep, ap.dt_hr))::date as date_ref,
            'pvps'::text as modulo,
            coalesce(nullif(trim(ap.zona), ''), 'Sem zona') as zona,
            coalesce(nullif(trim(ap.end_sep), ''), 'Sem endereço') as endereco,
            coalesce(nullif(trim(ap.descricao), ''), format('CODDV %s', ap.coddv)) as descricao,
            ap.coddv,
            lower(ap.end_sit) as status_dashboard,
            false as eligible_audit,
            false as eligible_error,
            false as eligible_conform,
            greatest(
                coalesce(ap.updated_at, ap.dt_hr),
                coalesce(ap.dt_hr_sep, ap.dt_hr)
            ) as updated_at
        from app.aud_pvps ap
        cross join bounds_ts bt
        cross join params p
        where p.tipo in ('ambos', 'pvps')
          and ap.cd = p_cd
          and lower(coalesce(ap.end_sit, '')) in ('vazio', 'obstruido')
          and coalesce(ap.dt_hr_sep, ap.dt_hr) >= bt.month_start_ts
          and coalesce(ap.dt_hr_sep, ap.dt_hr) < bt.month_end_ts
          and not exists (
              select 1
              from app.aud_pvps_pul apu
              where apu.audit_id = ap.audit_id
          )
    ),
    alocacao_rows as (
        select
            timezone('America/Sao_Paulo', aa.dt_hr)::date as date_ref,
            'alocacao'::text as modulo,
            coalesce(nullif(trim(aa.zona), ''), 'Sem zona') as zona,
            coalesce(nullif(trim(aa.endereco), ''), 'Sem endereço') as endereco,
            coalesce(nullif(trim(aa.descricao), ''), format('CODDV %s', aa.coddv)) as descricao,
            aa.coddv,
            case
                when lower(coalesce(aa.end_sit, '')) in ('vazio', 'obstruido') then lower(aa.end_sit)
                when lower(coalesce(aa.aud_sit, '')) = 'nao_conforme' then 'nao_conforme'
                else 'conforme'
            end as status_dashboard,
            (aa.end_sit is null and nullif(trim(coalesce(aa.val_conf, '')), '') is not null) as eligible_audit,
            (
                aa.end_sit is null
                and nullif(trim(coalesce(aa.val_conf, '')), '') is not null
                and lower(coalesce(aa.aud_sit, '')) = 'nao_conforme'
            ) as eligible_error,
            (
                aa.end_sit is null
                and nullif(trim(coalesce(aa.val_conf, '')), '') is not null
                and lower(coalesce(aa.aud_sit, '')) <> 'nao_conforme'
            ) as eligible_conform,
            coalesce(aa.updated_at, aa.dt_hr) as updated_at
        from app.aud_alocacao aa
        cross join bounds_ts bt
        cross join params p
        where p.tipo in ('ambos', 'alocacao')
          and aa.cd = p_cd
          and aa.dt_hr >= bt.month_start_ts
          and aa.dt_hr < bt.month_end_ts
    )
    select * from pvps_pul_rows
    union all
    select * from pvps_sep_occurrence_rows
    union all
    select * from alocacao_rows;
$$;

