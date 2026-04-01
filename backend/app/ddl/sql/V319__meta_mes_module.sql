create table if not exists app.meta_mes_daily_targets (
    target_id uuid primary key default gen_random_uuid(),
    cd integer not null,
    activity_key text not null
        check (activity_key in (
            'pvps_coddv',
            'alocacao_coddv',
            'blitz_unidades',
            'entrada_notas_valor',
            'termo_conferencia',
            'pedido_direto_conferencia',
            'volume_avulso_conferencia',
            'zerados_endereco'
        )),
    date_ref date not null,
    target_value numeric(18, 3),
    is_holiday boolean not null default false,
    updated_by uuid references auth.users(id) on delete set null,
    updated_mat text,
    updated_nome text,
    updated_at timestamptz not null default now(),
    constraint uq_meta_mes_daily_targets unique (cd, activity_key, date_ref),
    constraint ck_meta_mes_daily_targets_target_value
        check (target_value is null or target_value >= 0)
);

create index if not exists idx_meta_mes_daily_targets_cd_activity_date
    on app.meta_mes_daily_targets(cd, activity_key, date_ref);

create or replace function app.meta_mes_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_meta_mes_daily_targets_touch_updated_at on app.meta_mes_daily_targets;
create trigger trg_meta_mes_daily_targets_touch_updated_at
before update on app.meta_mes_daily_targets
for each row
execute function app.meta_mes_touch_updated_at();

alter table app.meta_mes_daily_targets enable row level security;

revoke all on app.meta_mes_daily_targets from anon;
revoke all on app.meta_mes_daily_targets from authenticated;

create or replace function app.meta_mes_resolve_cd(p_cd integer default null)
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

create or replace function app.meta_mes_activity_catalog()
returns table (
    sort_order integer,
    activity_key text,
    activity_label text,
    unit_label text,
    value_mode text
)
language sql
immutable
as $$
    values
        (1, 'pvps_coddv'::text, 'PVPS'::text, 'CODDVs'::text, 'integer'::text),
        (2, 'alocacao_coddv'::text, 'Alocação'::text, 'CODDVs'::text, 'integer'::text),
        (3, 'blitz_unidades'::text, 'Blitz'::text, 'unidades'::text, 'integer'::text),
        (4, 'entrada_notas_valor'::text, 'Conf. entrada de notas'::text, 'valor'::text, 'currency'::text),
        (5, 'termo_conferencia'::text, 'Conf. termo'::text, 'conferências'::text, 'integer'::text),
        (6, 'pedido_direto_conferencia'::text, 'Conf. pedido direto'::text, 'conferências'::text, 'integer'::text),
        (7, 'volume_avulso_conferencia'::text, 'Conf. volume avulso'::text, 'conferências'::text, 'integer'::text),
        (8, 'zerados_endereco'::text, 'Zerados'::text, 'endereços'::text, 'integer'::text);
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
            coalesce(
                timezone('America/Sao_Paulo', b.dt_conf)::date,
                timezone('America/Sao_Paulo', b.updated_at)::date
            ) as date_ref,
            coalesce(sum(greatest(coalesce(b.qtd_un, 0), 0)), 0)::numeric(18, 3) as actual_value,
            max(coalesce(b.dt_conf, b.updated_at)) as updated_at
        from app.db_prod_blitz b
        cross join month_bounds mb
        where b.cd = p_cd
          and coalesce(b.qtd_un, 0) > 0
          and coalesce(
                timezone('America/Sao_Paulo', b.dt_conf)::date,
                timezone('America/Sao_Paulo', b.updated_at)::date
              ) >= mb.month_start
          and coalesce(
                timezone('America/Sao_Paulo', b.dt_conf)::date,
                timezone('America/Sao_Paulo', b.updated_at)::date
              ) <= mb.month_end
        group by 2
    ),
    entrada_conf as (
        select
            c.conf_id,
            c.cd,
            c.seq_entrada,
            c.nf,
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) as date_ref,
            coalesce(c.finalized_at, c.updated_at) as updated_at
        from app.conf_entrada_notas c
        cross join month_bounds mb
        where c.cd = p_cd
          and c.status in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_parcial', 'finalizado_falta')
          and coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) >= mb.month_start
          and coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) <= mb.month_end
    ),
    entrada_itens_base as (
        select
            t.cd,
            t.seq_entrada,
            t.nf,
            t.coddv,
            greatest(coalesce(max(t.vl_tt), 0), 0)::numeric(18, 2) as vl_tt
        from app.db_entrada_notas t
        where t.cd = p_cd
          and t.seq_entrada is not null
          and t.nf is not null
          and t.coddv is not null
        group by t.cd, t.seq_entrada, t.nf, t.coddv
    ),
    entrada_conf_values as (
        select
            fc.conf_id,
            least(
                coalesce(sum(
                    case
                        when greatest(coalesce(i.qtd_esperada, 0), 0) <= 0 then 0::numeric
                        else (
                            least(
                                greatest(coalesce(i.qtd_conferida, 0)::numeric, 0::numeric),
                                greatest(coalesce(i.qtd_esperada, 0)::numeric, 0::numeric)
                            )
                            / nullif(greatest(coalesce(i.qtd_esperada, 0)::numeric, 0::numeric), 0::numeric)
                        ) * coalesce(e.vl_tt, 0::numeric)
                    end
                ), 0::numeric),
                coalesce(sum(coalesce(e.vl_tt, 0::numeric)), 0::numeric)
            )::numeric(18, 2) as valor_conferido
        from entrada_conf fc
        join app.conf_entrada_notas_itens i
          on i.conf_id = fc.conf_id
        left join entrada_itens_base e
          on e.cd = fc.cd
         and e.seq_entrada = fc.seq_entrada
         and e.nf = fc.nf
         and e.coddv = i.coddv
        group by fc.conf_id
    ),
    entrada_daily as (
        select
            'entrada_notas_valor'::text as activity_key,
            fc.date_ref,
            coalesce(sum(ecv.valor_conferido), 0)::numeric(18, 3) as actual_value,
            max(fc.updated_at) as updated_at
        from entrada_conf fc
        left join entrada_conf_values ecv
          on ecv.conf_id = fc.conf_id
        group by fc.date_ref
    ),
    termo_daily as (
        select
            'termo_conferencia'::text as activity_key,
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) as date_ref,
            count(*)::numeric(18, 3) as actual_value,
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
            count(*)::numeric(18, 3) as actual_value,
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
            count(*)::numeric(18, 3) as actual_value,
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
            upper(trim(c.endereco)) as endereco,
            c.etapa,
            max(c.updated_at) as updated_at
        from app.conf_inventario_counts c
        cross join month_bounds mb
        where c.cd = p_cd
          and c.cycle_date >= mb.month_start
          and c.cycle_date <= mb.month_end
        group by c.cycle_date, upper(trim(c.endereco)), c.etapa
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
    select *
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

create or replace function app.meta_mes_daily_activity(
    p_cd integer,
    p_activity_key text,
    p_month_start date default null
)
returns table (
    date_ref date,
    day_number integer,
    weekday_label text,
    target_kind text,
    target_value numeric(18, 3),
    actual_value numeric(18, 3),
    percent_achievement numeric(18, 3),
    delta_value numeric(18, 3),
    cumulative_target numeric(18, 3),
    cumulative_actual numeric(18, 3),
    cumulative_percent numeric(18, 3),
    status text,
    is_holiday boolean,
    is_sunday boolean,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_activity record;
begin
    select *
    into v_activity
    from app.meta_mes_activity_catalog() catalog
    where catalog.activity_key = nullif(trim(coalesce(p_activity_key, '')), '')
    limit 1;

    if v_activity.activity_key is null then
        raise exception 'ATIVIDADE_INVALIDA';
    end if;

    return query
    with month_bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    days as (
        select generate_series(mb.month_start, mb.month_end, interval '1 day')::date as date_ref
        from month_bounds mb
    ),
    actuals as (
        select
            a.date_ref,
            a.actual_value,
            a.updated_at
        from app.meta_mes_actuals_month(p_cd, p_month_start) a
        where a.activity_key = v_activity.activity_key
    ),
    targets as (
        select
            t.date_ref,
            t.target_value,
            t.is_holiday,
            t.updated_at
        from app.meta_mes_daily_targets t
        cross join month_bounds mb
        where t.cd = p_cd
          and t.activity_key = v_activity.activity_key
          and t.date_ref >= mb.month_start
          and t.date_ref <= mb.month_end
    ),
    base as (
        select
            d.date_ref,
            extract(day from d.date_ref)::integer as day_number,
            case extract(isodow from d.date_ref)
                when 1 then 'Seg'
                when 2 then 'Ter'
                when 3 then 'Qua'
                when 4 then 'Qui'
                when 5 then 'Sex'
                when 6 then 'Sáb'
                else 'Dom'
            end as weekday_label,
            (extract(isodow from d.date_ref) = 7) as is_sunday,
            coalesce(t.is_holiday, false) as is_holiday,
            case
                when extract(isodow from d.date_ref) = 7 then 'domingo'
                when coalesce(t.is_holiday, false) then 'feriado'
                when t.target_value is null then 'sem_meta'
                else 'meta'
            end as target_kind,
            case
                when extract(isodow from d.date_ref) = 7 then 0::numeric(18, 3)
                when coalesce(t.is_holiday, false) then null::numeric(18, 3)
                else t.target_value
            end as target_value,
            coalesce(a.actual_value, 0)::numeric(18, 3) as actual_value,
            case
                when t.updated_at is not null and a.updated_at is not null then greatest(t.updated_at, a.updated_at)
                else coalesce(t.updated_at, a.updated_at)
            end as updated_at
        from days d
        left join actuals a
          on a.date_ref = d.date_ref
        left join targets t
          on t.date_ref = d.date_ref
    ),
    with_running as (
        select
            b.date_ref,
            b.day_number,
            b.weekday_label,
            b.target_kind,
            b.target_value,
            b.actual_value,
            case
                when b.target_kind = 'meta' and coalesce(b.target_value, 0) > 0
                    then round((b.actual_value / b.target_value) * 100, 3)
                else null::numeric
            end as percent_achievement,
            case
                when b.target_kind = 'meta'
                    then round(b.actual_value - coalesce(b.target_value, 0), 3)
                else null::numeric
            end as delta_value,
            sum(
                case
                    when b.target_kind = 'meta' then coalesce(b.target_value, 0)
                    else 0
                end
            ) over (order by b.date_ref rows between unbounded preceding and current row)::numeric(18, 3) as cumulative_target,
            sum(b.actual_value) over (order by b.date_ref rows between unbounded preceding and current row)::numeric(18, 3) as cumulative_actual,
            case
                when sum(
                    case
                        when b.target_kind = 'meta' then coalesce(b.target_value, 0)
                        else 0
                    end
                ) over (order by b.date_ref rows between unbounded preceding and current row) > 0
                then round(
                    (
                        sum(b.actual_value) over (order by b.date_ref rows between unbounded preceding and current row)
                        / nullif(
                            sum(
                                case
                                    when b.target_kind = 'meta' then coalesce(b.target_value, 0)
                                    else 0
                                end
                            ) over (order by b.date_ref rows between unbounded preceding and current row),
                            0
                        )
                    ) * 100,
                    3
                )
                else null::numeric
            end as cumulative_percent,
            case
                when b.target_kind = 'domingo' then 'domingo'
                when b.target_kind = 'feriado' then 'feriado'
                when b.target_kind = 'sem_meta' then 'sem_meta'
                when b.actual_value > coalesce(b.target_value, 0) then 'acima'
                when b.actual_value = coalesce(b.target_value, 0) then 'atingiu'
                else 'abaixo'
            end as status,
            b.is_holiday,
            b.is_sunday,
            b.updated_at
        from base b
    )
    select
        wr.date_ref,
        wr.day_number,
        wr.weekday_label,
        wr.target_kind,
        wr.target_value,
        wr.actual_value,
        wr.percent_achievement,
        wr.delta_value,
        wr.cumulative_target,
        wr.cumulative_actual,
        wr.cumulative_percent,
        wr.status,
        wr.is_holiday,
        wr.is_sunday,
        wr.updated_at
    from with_running wr
    order by wr.date_ref;
end;
$$;

drop function if exists public.rpc_meta_mes_activities(integer);
drop function if exists public.rpc_meta_mes_month_options(integer);
drop function if exists public.rpc_meta_mes_summary(integer, text, date);
drop function if exists public.rpc_meta_mes_daily_rows(integer, text, date);
drop function if exists public.rpc_meta_mes_set_daily_target(integer, text, date, numeric);
drop function if exists public.rpc_meta_mes_set_holiday(integer, text, date, boolean);

create or replace function public.rpc_meta_mes_activities(p_cd integer default null)
returns table (
    sort_order integer,
    activity_key text,
    activity_label text,
    unit_label text,
    value_mode text
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
    select
        c.sort_order,
        c.activity_key,
        c.activity_label,
        c.unit_label,
        c.value_mode
    from app.meta_mes_activity_catalog() c
    order by c.sort_order, c.activity_label;
end;
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

        select date_trunc(
            'month',
            coalesce(
                timezone('America/Sao_Paulo', b.dt_conf)::date,
                timezone('America/Sao_Paulo', b.updated_at)::date
            )
        )::date
        from app.db_prod_blitz b
        where b.cd = v_cd
          and coalesce(b.qtd_un, 0) > 0

        union

        select date_trunc(
            'month',
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date)
        )::date
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

create or replace function public.rpc_meta_mes_summary(
    p_cd integer default null,
    p_activity_key text default null,
    p_month_start date default null
)
returns table (
    activity_key text,
    activity_label text,
    unit_label text,
    value_mode text,
    month_start date,
    month_end date,
    updated_at timestamptz,
    total_actual numeric(18, 3),
    total_target numeric(18, 3),
    achievement_percent numeric(18, 3),
    daily_average numeric(18, 3),
    monthly_projection numeric(18, 3),
    days_with_target integer,
    days_hit integer,
    days_over integer,
    days_holiday integer,
    days_without_target integer,
    balance_to_target numeric(18, 3)
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_activity record;
begin
    v_cd := app.meta_mes_resolve_cd(p_cd);

    select *
    into v_activity
    from app.meta_mes_activity_catalog() catalog
    where catalog.activity_key = nullif(trim(coalesce(p_activity_key, '')), '')
    limit 1;

    if v_activity.activity_key is null then
        raise exception 'ATIVIDADE_INVALIDA';
    end if;

    return query
    with month_bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    daily as (
        select *
        from app.meta_mes_daily_activity(v_cd, v_activity.activity_key, p_month_start)
    ),
    elapsed as (
        select
            least(timezone('America/Sao_Paulo', now())::date, mb.month_end) as elapsed_end
        from month_bounds mb
    ),
    aggregates as (
        select
            coalesce(sum(d.actual_value), 0)::numeric(18, 3) as total_actual,
            coalesce(sum(case when d.target_kind = 'meta' then coalesce(d.target_value, 0) else 0 end), 0)::numeric(18, 3) as total_target,
            count(*) filter (where d.target_kind = 'meta')::integer as days_with_target,
            count(*) filter (where d.target_kind = 'meta' and d.actual_value >= coalesce(d.target_value, 0))::integer as days_hit,
            count(*) filter (where d.target_kind = 'meta' and d.actual_value > coalesce(d.target_value, 0))::integer as days_over,
            count(*) filter (where d.target_kind = 'feriado')::integer as days_holiday,
            count(*) filter (where d.target_kind = 'sem_meta')::integer as days_without_target,
            max(d.updated_at) as updated_at
        from daily d
    ),
    elapsed_stats as (
        select
            coalesce(sum(d.actual_value) filter (where d.date_ref <= e.elapsed_end), 0)::numeric(18, 3) as elapsed_actual,
            count(*) filter (
                where d.date_ref <= e.elapsed_end
                  and d.target_kind not in ('domingo', 'feriado')
            )::integer as elapsed_workdays,
            count(*) filter (
                where d.target_kind not in ('domingo', 'feriado')
            )::integer as month_workdays
        from daily d
        cross join elapsed e
    )
    select
        v_activity.activity_key,
        v_activity.activity_label,
        v_activity.unit_label,
        v_activity.value_mode,
        mb.month_start,
        mb.month_end,
        ag.updated_at,
        ag.total_actual,
        ag.total_target,
        case
            when ag.total_target > 0 then round((ag.total_actual / ag.total_target) * 100, 3)
            else null::numeric
        end as achievement_percent,
        case
            when es.elapsed_workdays > 0 then round(es.elapsed_actual / es.elapsed_workdays, 3)
            else ag.total_actual
        end as daily_average,
        case
            when es.elapsed_workdays > 0 and es.month_workdays > 0
                then round((es.elapsed_actual / es.elapsed_workdays) * es.month_workdays, 3)
            else ag.total_actual
        end as monthly_projection,
        ag.days_with_target,
        ag.days_hit,
        ag.days_over,
        ag.days_holiday,
        ag.days_without_target,
        round(ag.total_actual - ag.total_target, 3) as balance_to_target
    from month_bounds mb
    cross join aggregates ag
    cross join elapsed_stats es;
end;
$$;

create or replace function public.rpc_meta_mes_daily_rows(
    p_cd integer default null,
    p_activity_key text default null,
    p_month_start date default null
)
returns table (
    date_ref date,
    day_number integer,
    weekday_label text,
    target_kind text,
    target_value numeric(18, 3),
    actual_value numeric(18, 3),
    percent_achievement numeric(18, 3),
    delta_value numeric(18, 3),
    cumulative_target numeric(18, 3),
    cumulative_actual numeric(18, 3),
    cumulative_percent numeric(18, 3),
    status text,
    is_holiday boolean,
    is_sunday boolean,
    updated_at timestamptz
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
    select *
    from app.meta_mes_daily_activity(v_cd, p_activity_key, p_month_start);
end;
$$;

create or replace function public.rpc_meta_mes_set_daily_target(
    p_cd integer default null,
    p_activity_key text default null,
    p_date_ref date default null,
    p_target_value numeric default null
)
returns table (
    date_ref date,
    day_number integer,
    weekday_label text,
    target_kind text,
    target_value numeric(18, 3),
    actual_value numeric(18, 3),
    percent_achievement numeric(18, 3),
    delta_value numeric(18, 3),
    cumulative_target numeric(18, 3),
    cumulative_actual numeric(18, 3),
    cumulative_percent numeric(18, 3),
    status text,
    is_holiday boolean,
    is_sunday boolean,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_activity record;
    v_profile record;
    v_current_month_start date := date_trunc('month', timezone('America/Sao_Paulo', now())::date)::date;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if not authz.is_admin(v_uid) then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_date_ref is null then
        raise exception 'DATA_OBRIGATORIA';
    end if;

    if date_trunc('month', p_date_ref)::date <> v_current_month_start then
        raise exception 'APENAS_MES_ATUAL';
    end if;

    if extract(isodow from p_date_ref) = 7 then
        raise exception 'DOMINGO_META_ZERO';
    end if;

    if p_target_value is not null and p_target_value < 0 then
        raise exception 'META_INVALIDA';
    end if;

    v_cd := app.meta_mes_resolve_cd(p_cd);

    select *
    into v_activity
    from app.meta_mes_activity_catalog() catalog
    where catalog.activity_key = nullif(trim(coalesce(p_activity_key, '')), '')
    limit 1;

    if v_activity.activity_key is null then
        raise exception 'ATIVIDADE_INVALIDA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    if p_target_value is null then
        update app.meta_mes_daily_targets t
        set
            target_value = null,
            is_holiday = false,
            updated_by = v_uid,
            updated_mat = coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            updated_nome = coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            updated_at = now()
        where t.cd = v_cd
          and t.activity_key = v_activity.activity_key
          and t.date_ref = p_date_ref;

        delete from app.meta_mes_daily_targets t
        where t.cd = v_cd
          and t.activity_key = v_activity.activity_key
          and t.date_ref = p_date_ref
          and t.target_value is null
          and not t.is_holiday;
    else
        insert into app.meta_mes_daily_targets (
            cd,
            activity_key,
            date_ref,
            target_value,
            is_holiday,
            updated_by,
            updated_mat,
            updated_nome
        )
        values (
            v_cd,
            v_activity.activity_key,
            p_date_ref,
            round(p_target_value, 3),
            false,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
        )
        on conflict (cd, activity_key, date_ref)
        do update set
            target_value = excluded.target_value,
            is_holiday = false,
            updated_by = excluded.updated_by,
            updated_mat = excluded.updated_mat,
            updated_nome = excluded.updated_nome,
            updated_at = now();
    end if;

    return query
    select day_row.*
    from app.meta_mes_daily_activity(v_cd, v_activity.activity_key, p_date_ref) day_row
    where day_row.date_ref = p_date_ref;
end;
$$;

create or replace function public.rpc_meta_mes_set_holiday(
    p_cd integer default null,
    p_activity_key text default null,
    p_date_ref date default null,
    p_is_holiday boolean default true
)
returns table (
    date_ref date,
    day_number integer,
    weekday_label text,
    target_kind text,
    target_value numeric(18, 3),
    actual_value numeric(18, 3),
    percent_achievement numeric(18, 3),
    delta_value numeric(18, 3),
    cumulative_target numeric(18, 3),
    cumulative_actual numeric(18, 3),
    cumulative_percent numeric(18, 3),
    status text,
    is_holiday boolean,
    is_sunday boolean,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_activity record;
    v_profile record;
    v_current_month_start date := date_trunc('month', timezone('America/Sao_Paulo', now())::date)::date;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if not authz.is_admin(v_uid) then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_date_ref is null then
        raise exception 'DATA_OBRIGATORIA';
    end if;

    if date_trunc('month', p_date_ref)::date <> v_current_month_start then
        raise exception 'APENAS_MES_ATUAL';
    end if;

    if extract(isodow from p_date_ref) = 7 then
        raise exception 'DOMINGO_META_ZERO';
    end if;

    v_cd := app.meta_mes_resolve_cd(p_cd);

    select *
    into v_activity
    from app.meta_mes_activity_catalog() catalog
    where catalog.activity_key = nullif(trim(coalesce(p_activity_key, '')), '')
    limit 1;

    if v_activity.activity_key is null then
        raise exception 'ATIVIDADE_INVALIDA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    if coalesce(p_is_holiday, true) then
        insert into app.meta_mes_daily_targets (
            cd,
            activity_key,
            date_ref,
            target_value,
            is_holiday,
            updated_by,
            updated_mat,
            updated_nome
        )
        values (
            v_cd,
            v_activity.activity_key,
            p_date_ref,
            null,
            true,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
        )
        on conflict (cd, activity_key, date_ref)
        do update set
            target_value = null,
            is_holiday = true,
            updated_by = excluded.updated_by,
            updated_mat = excluded.updated_mat,
            updated_nome = excluded.updated_nome,
            updated_at = now();
    else
        update app.meta_mes_daily_targets t
        set
            is_holiday = false,
            updated_by = v_uid,
            updated_mat = coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            updated_nome = coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            updated_at = now()
        where t.cd = v_cd
          and t.activity_key = v_activity.activity_key
          and t.date_ref = p_date_ref;

        delete from app.meta_mes_daily_targets t
        where t.cd = v_cd
          and t.activity_key = v_activity.activity_key
          and t.date_ref = p_date_ref
          and t.target_value is null
          and not t.is_holiday;
    end if;

    return query
    select day_row.*
    from app.meta_mes_daily_activity(v_cd, v_activity.activity_key, p_date_ref) day_row
    where day_row.date_ref = p_date_ref;
end;
$$;

grant execute on function public.rpc_meta_mes_activities(integer) to authenticated;
grant execute on function public.rpc_meta_mes_month_options(integer) to authenticated;
grant execute on function public.rpc_meta_mes_summary(integer, text, date) to authenticated;
grant execute on function public.rpc_meta_mes_daily_rows(integer, text, date) to authenticated;
grant execute on function public.rpc_meta_mes_set_daily_target(integer, text, date, numeric) to authenticated;
grant execute on function public.rpc_meta_mes_set_holiday(integer, text, date, boolean) to authenticated;
