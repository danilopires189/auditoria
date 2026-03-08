create or replace function app.indicadores_resolve_cd(p_cd integer default null)
returns integer
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_role text;
    v_cd integer;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    v_role := coalesce(authz.user_role(v_uid), 'auditor');

    if v_role = 'admin' then
        v_cd := coalesce(
            p_cd,
            v_profile.cd_default,
            (
                select min(u.cd)
                from app.db_usuario u
                where u.cd is not null
            )
        );
    else
        v_cd := coalesce(
            v_profile.cd_default,
            p_cd,
            (
                select min(ud.cd)
                from authz.user_deposits ud
                where ud.user_id = v_uid
            )
        );
    end if;

    if v_cd is null then
        raise exception 'CD_NAO_DEFINIDO_USUARIO';
    end if;

    if not authz.can_access_cd(v_uid, v_cd) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return v_cd;
end;
$$;

create or replace function app.indicadores_parse_int(p_value text)
returns integer
language sql
immutable
as $$
    select case
        when trim(coalesce(p_value, '')) ~ '^-?[0-9]+([.,][0-9]+)?$'
            then trunc(replace(trim(p_value), ',', '.')::numeric)::integer
        else 0
    end;
$$;

create or replace function app.indicadores_blitz_month_rows(
    p_cd integer,
    p_month_start date
)
returns table (
    data_conf date,
    filial integer,
    filial_nome text,
    pedido bigint,
    seq integer,
    coddv integer,
    descricao text,
    zona text,
    qtd_nfo integer,
    conf_num integer,
    qtd_venc integer,
    falta_qty integer,
    sobra_qty integer,
    fora_politica_qty integer,
    vl_div numeric,
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
    )
    select
        d.data_conf,
        d.filial,
        coalesce(nullif(trim(r.nome), ''), format('Filial %s', d.filial)) as filial_nome,
        d.pedido,
        d.seq,
        d.coddv,
        coalesce(nullif(trim(d.descricao), ''), 'Item sem descrição') as descricao,
        coalesce(nullif(trim(d.zona), ''), 'Sem zona') as zona,
        coalesce(d.qtd_nfo, 0) as qtd_nfo,
        app.indicadores_parse_int(d.conf) as conf_num,
        coalesce(d.qtd_venc, 0) as qtd_venc,
        greatest(coalesce(d.qtd_nfo, 0) - app.indicadores_parse_int(d.conf), 0) as falta_qty,
        greatest(app.indicadores_parse_int(d.conf) - coalesce(d.qtd_nfo, 0), 0) as sobra_qty,
        coalesce(d.qtd_venc, 0) as fora_politica_qty,
        coalesce(d.vl_div, 0)::numeric as vl_div,
        d.updated_at
    from app.db_div_blitz d
    cross join month_bounds mb
    left join app.db_rotas r
      on r.cd = d.cd
     and r.filial = d.filial
    where d.cd = p_cd
      and d.data_conf is not null
      and d.data_conf >= mb.month_start
      and d.data_conf <= mb.month_end;
$$;

create or replace function public.rpc_indicadores_blitz_month_options(p_cd integer default null)
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
    v_cd := app.indicadores_resolve_cd(p_cd);

    return query
    with month_rows as (
        select date_trunc('month', c.dt_conf)::date as month_start
        from app.db_conf_blitz c
        where c.cd = v_cd
          and c.dt_conf is not null
        union
        select date_trunc('month', d.data_conf)::date as month_start
        from app.db_div_blitz d
        where d.cd = v_cd
          and d.data_conf is not null
    )
    select
        mr.month_start,
        to_char(mr.month_start, 'MM/YYYY') as month_label
    from month_rows mr
    group by mr.month_start
    order by mr.month_start desc;
end;
$$;

create or replace function public.rpc_indicadores_blitz_summary(
    p_cd integer default null,
    p_month_start date default null
)
returns table (
    month_start date,
    month_end date,
    available_day_start date,
    available_day_end date,
    updated_at timestamptz,
    conferido_total bigint,
    divergencia_oficial bigint,
    percentual_oficial numeric,
    fora_politica_total bigint,
    percentual_fora_politica numeric,
    avaria_mes bigint,
    erros_hoje bigint,
    media_conferencia_dia numeric
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
    conf_month as (
        select
            c.dt_conf,
            coalesce(c.tt_un, 0) as tt_un,
            coalesce(c.qtd_avaria, 0) as qtd_avaria,
            c.updated_at
        from app.db_conf_blitz c
        cross join month_bounds mb
        where c.cd = v_cd
          and c.dt_conf is not null
          and c.dt_conf >= mb.month_start
          and c.dt_conf <= mb.month_end
    ),
    div_month as (
        select *
        from app.indicadores_blitz_month_rows(v_cd, p_month_start)
    ),
    days_with_data as (
        select cm.dt_conf as day_ref
        from conf_month cm
        union
        select dm.data_conf as day_ref
        from div_month dm
    ),
    conf_days as (
        select count(distinct cm.dt_conf)::numeric as day_count
        from conf_month cm
        where extract(isodow from cm.dt_conf) <> 7
    ),
    conf_today as (
        select coalesce(sum(cm.tt_un), 0)::bigint as total_today
        from conf_month cm
        where cm.dt_conf = timezone('America/Sao_Paulo', now())::date
    ),
    div_today as (
        select coalesce(sum(dm.falta_qty + dm.sobra_qty + dm.fora_politica_qty), 0)::bigint as total_today
        from div_month dm
        where dm.data_conf = timezone('America/Sao_Paulo', now())::date
    ),
    conf_totals as (
        select
            coalesce(sum(cm.tt_un), 0)::bigint as conferido_total,
            coalesce(sum(cm.qtd_avaria), 0)::bigint as avaria_mes,
            max(cm.updated_at) as updated_at
        from conf_month cm
    ),
    div_totals as (
        select
            coalesce(sum(dm.falta_qty + dm.sobra_qty + dm.fora_politica_qty), 0)::bigint as divergencia_oficial,
            coalesce(sum(dm.fora_politica_qty), 0)::bigint as fora_politica_total,
            max(dm.updated_at) as updated_at
        from div_month dm
    )
    select
        mb.month_start,
        mb.month_end,
        (select min(dwd.day_ref) from days_with_data dwd) as available_day_start,
        (select max(dwd.day_ref) from days_with_data dwd) as available_day_end,
        case
            when ct.updated_at is null and dt.updated_at is null then null::timestamptz
            else greatest(
                coalesce(ct.updated_at, '-infinity'::timestamptz),
                coalesce(dt.updated_at, '-infinity'::timestamptz)
            )
        end as updated_at,
        ct.conferido_total,
        dt.divergencia_oficial,
        case
            when ct.conferido_total > 0
                then round((dt.divergencia_oficial::numeric / ct.conferido_total::numeric) * 100, 4)
            else 0::numeric
        end as percentual_oficial,
        dt.fora_politica_total,
        case
            when ct.conferido_total > 0
                then round((dt.fora_politica_total::numeric / ct.conferido_total::numeric) * 100, 4)
            else 0::numeric
        end as percentual_fora_politica,
        ct.avaria_mes,
        case
            when (select total_today from conf_today) > 0
                then (select total_today from div_today)
            else null::bigint
        end as erros_hoje,
        case
            when (select day_count from conf_days) > 0
                then round(ct.conferido_total::numeric / (select day_count from conf_days), 2)
            else 0::numeric
        end as media_conferencia_dia
    from month_bounds mb
    cross join conf_totals ct
    cross join div_totals dt;
end;
$$;

create or replace function public.rpc_indicadores_blitz_daily_series(
    p_cd integer default null,
    p_month_start date default null
)
returns table (
    date_ref date,
    conferido_total bigint,
    divergencia_oficial bigint,
    percentual_oficial numeric
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
    conf_daily as (
        select
            c.dt_conf as date_ref,
            coalesce(sum(c.tt_un), 0)::bigint as conferido_total
        from app.db_conf_blitz c
        cross join month_bounds mb
        where c.cd = v_cd
          and c.dt_conf is not null
          and c.dt_conf >= mb.month_start
          and c.dt_conf <= mb.month_end
        group by c.dt_conf
    ),
    div_daily as (
        select
            dm.data_conf as date_ref,
            coalesce(sum(dm.falta_qty + dm.sobra_qty + dm.fora_politica_qty), 0)::bigint as divergencia_oficial
        from app.indicadores_blitz_month_rows(v_cd, p_month_start) dm
        group by dm.data_conf
    )
    select
        gs.day_ref as date_ref,
        coalesce(cd.conferido_total, 0) as conferido_total,
        coalesce(dd.divergencia_oficial, 0) as divergencia_oficial,
        case
            when coalesce(cd.conferido_total, 0) > 0
                then round((coalesce(dd.divergencia_oficial, 0)::numeric / cd.conferido_total::numeric) * 100, 4)
            else 0::numeric
        end as percentual_oficial
    from month_bounds mb
    cross join lateral generate_series(mb.month_start, mb.month_end, interval '1 day') as gs(day_ref)
    left join conf_daily cd
      on cd.date_ref = gs.day_ref
    left join div_daily dd
      on dd.date_ref = gs.day_ref
    order by gs.day_ref;
end;
$$;

create or replace function public.rpc_indicadores_blitz_zone_totals(
    p_cd integer default null,
    p_month_start date default null
)
returns table (
    zona text,
    falta_total bigint,
    sobra_total bigint,
    fora_politica_total bigint,
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
    select
        dm.zona,
        coalesce(sum(dm.falta_qty), 0)::bigint as falta_total,
        coalesce(sum(dm.sobra_qty), 0)::bigint as sobra_total,
        coalesce(sum(dm.fora_politica_qty), 0)::bigint as fora_politica_total,
        coalesce(sum(dm.falta_qty + dm.sobra_qty + dm.fora_politica_qty), 0)::bigint as erro_total
    from app.indicadores_blitz_month_rows(v_cd, p_month_start) dm
    group by dm.zona
    having coalesce(sum(dm.falta_qty + dm.sobra_qty + dm.fora_politica_qty), 0) > 1
    order by erro_total desc, dm.zona asc;
end;
$$;

create or replace function public.rpc_indicadores_blitz_day_details(
    p_cd integer default null,
    p_month_start date default null,
    p_day date default null
)
returns table (
    data_conf date,
    filial integer,
    filial_nome text,
    pedido bigint,
    seq integer,
    coddv integer,
    descricao text,
    zona text,
    status text,
    quantidade integer,
    vl_div numeric
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_day date;
begin
    v_cd := app.indicadores_resolve_cd(p_cd);
    v_day := coalesce(p_day, timezone('America/Sao_Paulo', now())::date);

    return query
    with base_rows as (
        select *
        from app.indicadores_blitz_month_rows(v_cd, p_month_start)
        where data_conf = v_day
    )
    select
        br.data_conf,
        br.filial,
        br.filial_nome,
        br.pedido,
        br.seq,
        br.coddv,
        br.descricao,
        br.zona,
        detail.status,
        detail.quantidade,
        br.vl_div
    from base_rows br
    cross join lateral (
        values
            ('Falta'::text, br.falta_qty),
            ('Sobra'::text, br.sobra_qty),
            ('Fora da Política'::text, br.fora_politica_qty)
    ) as detail(status, quantidade)
    where detail.quantidade > 0
    order by
        br.data_conf desc,
        br.zona asc,
        br.filial asc,
        detail.status asc,
        br.descricao asc,
        br.pedido asc,
        br.coddv asc;
end;
$$;

grant execute on function public.rpc_indicadores_blitz_month_options(integer) to authenticated;
grant execute on function public.rpc_indicadores_blitz_summary(integer, date) to authenticated;
grant execute on function public.rpc_indicadores_blitz_daily_series(integer, date) to authenticated;
grant execute on function public.rpc_indicadores_blitz_zone_totals(integer, date) to authenticated;
grant execute on function public.rpc_indicadores_blitz_day_details(integer, date, date) to authenticated;
