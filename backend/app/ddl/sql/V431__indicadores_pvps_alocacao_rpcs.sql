create or replace function app.indicadores_pvps_aloc_tipo(p_tipo text default 'ambos')
returns text
language sql
immutable
as $$
    select case
        when lower(trim(coalesce(p_tipo, ''))) in ('pvps', 'alocacao')
            then lower(trim(coalesce(p_tipo, '')))
        else 'ambos'
    end;
$$;

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
            true as eligible_audit,
            case
                when lower(coalesce(aa.end_sit, '')) in ('vazio', 'obstruido') then true
                when lower(coalesce(aa.aud_sit, '')) = 'nao_conforme' then true
                else false
            end as eligible_error,
            case
                when lower(coalesce(aa.end_sit, '')) in ('vazio', 'obstruido') then false
                when lower(coalesce(aa.aud_sit, '')) = 'nao_conforme' then false
                else true
            end as eligible_conform,
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

create or replace function public.rpc_indicadores_pvps_aloc_month_options(
    p_cd integer default null,
    p_tipo text default 'ambos'
)
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
    v_tipo text;
begin
    v_cd := app.indicadores_resolve_cd(p_cd);
    v_tipo := app.indicadores_pvps_aloc_tipo(p_tipo);

    return query
    with month_rows as (
        select date_trunc('month', timezone('America/Sao_Paulo', apu.dt_hr)::date)::date as month_start
        from app.aud_pvps_pul apu
        join app.aud_pvps ap
          on ap.audit_id = apu.audit_id
        where v_tipo in ('ambos', 'pvps')
          and ap.cd = v_cd

        union

        select date_trunc('month', timezone('America/Sao_Paulo', coalesce(ap.dt_hr_sep, ap.dt_hr))::date)::date as month_start
        from app.aud_pvps ap
        where v_tipo in ('ambos', 'pvps')
          and ap.cd = v_cd
          and lower(coalesce(ap.end_sit, '')) in ('vazio', 'obstruido')
          and not exists (
              select 1
              from app.aud_pvps_pul apu
              where apu.audit_id = ap.audit_id
          )

        union

        select date_trunc('month', timezone('America/Sao_Paulo', aa.dt_hr)::date)::date as month_start
        from app.aud_alocacao aa
        where v_tipo in ('ambos', 'alocacao')
          and aa.cd = v_cd
    )
    select
        mr.month_start,
        to_char(mr.month_start, 'MM/YYYY') as month_label
    from month_rows mr
    group by mr.month_start
    order by mr.month_start desc;
end;
$$;

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
    percentual_conformidade numeric
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
    days_with_data as (
        select
            min(br.date_ref) as available_day_start,
            max(br.date_ref) as available_day_end
        from base_rows br
    ),
    aggregates as (
        select
            max(br.updated_at) as updated_at,
            count(*) filter (where br.eligible_audit)::bigint as enderecos_auditados,
            count(*) filter (where br.status_dashboard = 'nao_conforme')::bigint as nao_conformes,
            count(*) filter (where br.status_dashboard in ('vazio', 'obstruido'))::bigint as ocorrencias_total,
            count(*) filter (where br.status_dashboard = 'vazio')::bigint as ocorrencias_vazio,
            count(*) filter (where br.status_dashboard = 'obstruido')::bigint as ocorrencias_obstruido,
            count(*) filter (where br.status_dashboard <> 'conforme')::bigint as erros_total,
            count(*) filter (where br.eligible_error)::bigint as erros_percentual_total,
            count(*) filter (where br.eligible_conform)::bigint as conformes_elegiveis
        from base_rows br
    )
    select
        mb.month_start,
        mb.month_end,
        dwd.available_day_start,
        dwd.available_day_end,
        agg.updated_at,
        agg.enderecos_auditados,
        agg.nao_conformes,
        agg.ocorrencias_total,
        agg.ocorrencias_vazio,
        agg.ocorrencias_obstruido,
        agg.erros_total,
        agg.erros_percentual_total,
        case
            when agg.enderecos_auditados > 0
                then round((agg.erros_percentual_total::numeric / agg.enderecos_auditados::numeric) * 100, 4)
            else 0::numeric
        end as percentual_erro,
        agg.conformes_elegiveis,
        case
            when agg.enderecos_auditados > 0
                then round((agg.conformes_elegiveis::numeric / agg.enderecos_auditados::numeric) * 100, 4)
            else 0::numeric
        end as percentual_conformidade
    from month_bounds mb
    cross join days_with_data dwd
    cross join aggregates agg;
end;
$$;

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
    percentual_conformidade numeric
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
    daily as (
        select
            br.date_ref,
            count(*) filter (where br.eligible_audit)::bigint as enderecos_auditados,
            count(*) filter (where br.status_dashboard = 'nao_conforme')::bigint as nao_conformes,
            count(*) filter (where br.status_dashboard in ('vazio', 'obstruido'))::bigint as ocorrencias_total,
            count(*) filter (where br.status_dashboard <> 'conforme')::bigint as erros_total,
            count(*) filter (where br.eligible_error)::bigint as erros_percentual_total,
            count(*) filter (where br.eligible_conform)::bigint as conformes_elegiveis
        from base_rows br
        group by br.date_ref
    )
    select
        d.date_ref,
        d.enderecos_auditados,
        d.nao_conformes,
        d.ocorrencias_total,
        d.erros_total,
        d.erros_percentual_total,
        case
            when d.enderecos_auditados > 0
                then round((d.erros_percentual_total::numeric / d.enderecos_auditados::numeric) * 100, 4)
            else 0::numeric
        end as percentual_erro,
        d.conformes_elegiveis,
        case
            when d.enderecos_auditados > 0
                then round((d.conformes_elegiveis::numeric / d.enderecos_auditados::numeric) * 100, 4)
            else 0::numeric
        end as percentual_conformidade
    from daily d
    order by d.date_ref asc;
end;
$$;

create or replace function public.rpc_indicadores_pvps_aloc_zone_totals(
    p_cd integer default null,
    p_month_start date default null,
    p_tipo text default 'ambos'
)
returns table (
    zona text,
    nao_conforme_total bigint,
    vazio_total bigint,
    obstruido_total bigint,
    erro_total bigint
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
        where status_dashboard <> 'conforme'
    )
    select
        br.zona,
        count(*) filter (where br.status_dashboard = 'nao_conforme')::bigint as nao_conforme_total,
        count(*) filter (where br.status_dashboard = 'vazio')::bigint as vazio_total,
        count(*) filter (where br.status_dashboard = 'obstruido')::bigint as obstruido_total,
        count(*)::bigint as erro_total
    from base_rows br
    group by br.zona
    having count(*) > 0
    order by erro_total desc, br.zona asc;
end;
$$;

create or replace function public.rpc_indicadores_pvps_aloc_day_details(
    p_cd integer default null,
    p_month_start date default null,
    p_tipo text default 'ambos',
    p_day date default null
)
returns table (
    date_ref date,
    modulo text,
    zona text,
    endereco text,
    descricao text,
    coddv integer,
    status_dashboard text,
    quantidade integer
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
        where status_dashboard <> 'conforme'
          and (p_day is null or date_ref = p_day)
    )
    select
        br.date_ref,
        br.modulo,
        br.zona,
        br.endereco,
        br.descricao,
        br.coddv,
        br.status_dashboard,
        1 as quantidade
    from base_rows br
    order by
        br.date_ref desc,
        br.zona asc,
        br.modulo asc,
        br.descricao asc,
        br.coddv asc;
end;
$$;

grant execute on function public.rpc_indicadores_pvps_aloc_month_options(integer, text) to authenticated;
grant execute on function public.rpc_indicadores_pvps_aloc_summary(integer, date, text) to authenticated;
grant execute on function public.rpc_indicadores_pvps_aloc_daily_series(integer, date, text) to authenticated;
grant execute on function public.rpc_indicadores_pvps_aloc_zone_totals(integer, date, text) to authenticated;
grant execute on function public.rpc_indicadores_pvps_aloc_day_details(integer, date, text, date) to authenticated;
