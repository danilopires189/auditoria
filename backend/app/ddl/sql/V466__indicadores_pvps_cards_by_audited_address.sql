create or replace function app.indicadores_pvps_aloc_card_rows(
    p_cd integer,
    p_month_start date default null,
    p_tipo text default 'ambos'
)
returns table (
    date_ref date,
    modulo text,
    audited_address_key text,
    coddv integer,
    card_status text,
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
    pvps_rows as (
        select
            timezone('America/Sao_Paulo', apu.dt_hr)::date as date_ref,
            'pvps'::text as modulo,
            coalesce(nullif(upper(trim(coalesce(apu.end_pul, ''))), ''), format('PVPS:%s', apu.audit_pul_id)) as audited_address_key,
            ap.coddv,
            case
                when lower(coalesce(apu.end_sit, '')) in ('vazio', 'obstruido') then 'ocorrencia'
                when ap.val_sep is null or apu.val_pul is null then 'nao_auditado'
                when app.pvps_alocacao_validade_rank(apu.val_pul) < app.pvps_alocacao_validade_rank(ap.val_sep)
                    then 'nao_conforme'
                else 'conforme'
            end as card_status,
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
    alocacao_rows as (
        select
            timezone('America/Sao_Paulo', aa.dt_hr)::date as date_ref,
            'alocacao'::text as modulo,
            format('ALOC:%s', aa.audit_id) as audited_address_key,
            aa.coddv,
            case
                when lower(coalesce(aa.end_sit, '')) in ('vazio', 'obstruido') then 'ocorrencia'
                when nullif(trim(coalesce(aa.val_conf, '')), '') is null then 'nao_auditado'
                when lower(coalesce(aa.aud_sit, '')) = 'nao_conforme' then 'nao_conforme'
                when lower(coalesce(aa.aud_sit, '')) = 'conforme' then 'conforme'
                else 'nao_auditado'
            end as card_status,
            coalesce(aa.updated_at, aa.dt_hr) as updated_at
        from app.aud_alocacao aa
        cross join bounds_ts bt
        cross join params p
        where p.tipo in ('ambos', 'alocacao')
          and aa.cd = p_cd
          and aa.dt_hr >= bt.month_start_ts
          and aa.dt_hr < bt.month_end_ts
    )
    select * from pvps_rows
    union all
    select * from alocacao_rows;
$$;

drop function if exists public.rpc_indicadores_pvps_aloc_summary(integer, date, text);

create or replace function public.rpc_indicadores_pvps_aloc_summary(
    p_cd integer default null,
    p_month_start date default null,
    p_tipo text default 'ambos'
)
returns table (
    month_start date,
    month_end date,
    available_day_start date,
    available_day_end date,
    updated_at timestamptz,
    enderecos_auditados bigint,
    nao_conformes bigint,
    ocorrencias_total bigint,
    ocorrencias_vazio bigint,
    ocorrencias_obstruido bigint,
    erros_total bigint,
    erros_percentual_total bigint,
    percentual_erro numeric,
    conformes_elegiveis bigint,
    percentual_conformidade numeric,
    produtos_unicos_auditados bigint,
    media_sku_dia numeric
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
    with month_bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    base_rows as (
        select *
        from app.indicadores_pvps_aloc_rows(v_cd, p_month_start, p_tipo)
    ),
    card_rows as (
        select *
        from app.indicadores_pvps_aloc_card_rows(v_cd, p_month_start, p_tipo)
    ),
    days_with_data as (
        select
            min(br.date_ref) as available_day_start,
            max(br.date_ref) as available_day_end
        from base_rows br
    ),
    aggregate_base as (
        select
            max(br.updated_at) as updated_at,
            count(*) filter (where br.status_dashboard in ('vazio', 'obstruido'))::bigint as ocorrencias_total,
            count(*) filter (where br.status_dashboard = 'vazio')::bigint as ocorrencias_vazio,
            count(*) filter (where br.status_dashboard = 'obstruido')::bigint as ocorrencias_obstruido,
            count(*) filter (where br.status_dashboard <> 'conforme')::bigint as erros_total
        from base_rows br
    ),
    aggregate_cards as (
        select
            count(distinct cr.audited_address_key) filter (where cr.card_status in ('conforme', 'nao_conforme'))::bigint as enderecos_auditados,
            count(distinct cr.audited_address_key) filter (where cr.card_status = 'nao_conforme')::bigint as nao_conformes,
            count(distinct cr.audited_address_key) filter (where cr.card_status = 'nao_conforme')::bigint as erros_percentual_total,
            count(distinct cr.audited_address_key) filter (where cr.card_status = 'conforme')::bigint as conformes_elegiveis,
            count(distinct format('%s:%s', cr.modulo, cr.coddv)) filter (where cr.card_status in ('conforme', 'nao_conforme'))::bigint as produtos_unicos_auditados
        from card_rows cr
    ),
    workdays as (
        select app.indicadores_pvps_aloc_workdays(v_cd, p_month_start, p_tipo) as dias_uteis_validos
    )
    select
        mb.month_start,
        mb.month_end,
        dwd.available_day_start,
        dwd.available_day_end,
        ab.updated_at,
        ac.enderecos_auditados,
        ac.nao_conformes,
        ab.ocorrencias_total,
        ab.ocorrencias_vazio,
        ab.ocorrencias_obstruido,
        ab.erros_total,
        ac.erros_percentual_total,
        case
            when ac.enderecos_auditados > 0
                then round((ac.erros_percentual_total::numeric / ac.enderecos_auditados::numeric) * 100, 4)
            else 0::numeric
        end as percentual_erro,
        ac.conformes_elegiveis,
        case
            when ac.enderecos_auditados > 0
                then round((ac.conformes_elegiveis::numeric / ac.enderecos_auditados::numeric) * 100, 4)
            else 0::numeric
        end as percentual_conformidade,
        ac.produtos_unicos_auditados,
        case
            when wd.dias_uteis_validos > 0
                then round((ac.produtos_unicos_auditados::numeric / wd.dias_uteis_validos::numeric), 4)
            else 0::numeric
        end as media_sku_dia
    from month_bounds mb
    cross join days_with_data dwd
    cross join aggregate_base ab
    cross join aggregate_cards ac
    cross join workdays wd;
end;
$$;

drop function if exists public.rpc_indicadores_pvps_aloc_daily_series(integer, date, text);

create or replace function public.rpc_indicadores_pvps_aloc_daily_series(
    p_cd integer default null,
    p_month_start date default null,
    p_tipo text default 'ambos'
)
returns table (
    date_ref date,
    enderecos_auditados bigint,
    nao_conformes bigint,
    ocorrencias_total bigint,
    erros_total bigint,
    erros_percentual_total bigint,
    percentual_erro numeric,
    conformes_elegiveis bigint,
    percentual_conformidade numeric,
    produtos_unicos_auditados bigint,
    media_sku_dia numeric
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
    with base_rows as (
        select *
        from app.indicadores_pvps_aloc_rows(v_cd, p_month_start, p_tipo)
    ),
    card_rows as (
        select *
        from app.indicadores_pvps_aloc_card_rows(v_cd, p_month_start, p_tipo)
    ),
    daily_base as (
        select
            br.date_ref,
            count(*) filter (where br.status_dashboard in ('vazio', 'obstruido'))::bigint as ocorrencias_total,
            count(*) filter (where br.status_dashboard <> 'conforme')::bigint as erros_total
        from base_rows br
        group by br.date_ref
    ),
    daily_cards as (
        select
            cr.date_ref,
            count(distinct cr.audited_address_key) filter (where cr.card_status in ('conforme', 'nao_conforme'))::bigint as enderecos_auditados,
            count(distinct cr.audited_address_key) filter (where cr.card_status = 'nao_conforme')::bigint as nao_conformes,
            count(distinct cr.audited_address_key) filter (where cr.card_status = 'nao_conforme')::bigint as erros_percentual_total,
            count(distinct cr.audited_address_key) filter (where cr.card_status = 'conforme')::bigint as conformes_elegiveis,
            count(distinct format('%s:%s', cr.modulo, cr.coddv)) filter (where cr.card_status in ('conforme', 'nao_conforme'))::bigint as produtos_unicos_auditados
        from card_rows cr
        group by cr.date_ref
    ),
    all_days as (
        select db.date_ref from daily_base db
        union
        select dc.date_ref from daily_cards dc
    )
    select
        ad.date_ref,
        coalesce(dc.enderecos_auditados, 0)::bigint as enderecos_auditados,
        coalesce(dc.nao_conformes, 0)::bigint as nao_conformes,
        coalesce(db.ocorrencias_total, 0)::bigint as ocorrencias_total,
        coalesce(db.erros_total, 0)::bigint as erros_total,
        coalesce(dc.erros_percentual_total, 0)::bigint as erros_percentual_total,
        case
            when coalesce(dc.enderecos_auditados, 0) > 0
                then round((dc.erros_percentual_total::numeric / dc.enderecos_auditados::numeric) * 100, 4)
            else 0::numeric
        end as percentual_erro,
        coalesce(dc.conformes_elegiveis, 0)::bigint as conformes_elegiveis,
        case
            when coalesce(dc.enderecos_auditados, 0) > 0
                then round((dc.conformes_elegiveis::numeric / dc.enderecos_auditados::numeric) * 100, 4)
            else 0::numeric
        end as percentual_conformidade,
        coalesce(dc.produtos_unicos_auditados, 0)::bigint as produtos_unicos_auditados,
        coalesce(dc.produtos_unicos_auditados, 0)::numeric as media_sku_dia
    from all_days ad
    left join daily_base db
      on db.date_ref = ad.date_ref
    left join daily_cards dc
      on dc.date_ref = ad.date_ref
    order by ad.date_ref asc;
end;
$$;

grant execute on function public.rpc_indicadores_pvps_aloc_summary(integer, date, text) to authenticated;
grant execute on function public.rpc_indicadores_pvps_aloc_daily_series(integer, date, text) to authenticated;
