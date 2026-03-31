create table if not exists app.meta_mes_month_targets (
    month_target_id uuid primary key default gen_random_uuid(),
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
    month_start date not null
        check (month_start = date_trunc('month', month_start)::date),
    daily_target_value numeric(18, 3) not null
        check (daily_target_value >= 0),
    updated_by uuid references auth.users(id) on delete set null,
    updated_mat text,
    updated_nome text,
    updated_at timestamptz not null default now(),
    constraint uq_meta_mes_month_targets unique (cd, activity_key, month_start)
);

create index if not exists idx_meta_mes_month_targets_cd_activity_month
    on app.meta_mes_month_targets(cd, activity_key, month_start desc);

drop trigger if exists trg_meta_mes_month_targets_touch_updated_at on app.meta_mes_month_targets;
create trigger trg_meta_mes_month_targets_touch_updated_at
before update on app.meta_mes_month_targets
for each row
execute function app.meta_mes_touch_updated_at();

alter table app.meta_mes_month_targets enable row level security;

revoke all on app.meta_mes_month_targets from anon;
revoke all on app.meta_mes_month_targets from authenticated;

insert into app.meta_mes_month_targets (
    cd,
    activity_key,
    month_start,
    daily_target_value,
    updated_by,
    updated_mat,
    updated_nome,
    updated_at
)
select distinct on (src.cd, src.activity_key, src.month_start)
    src.cd,
    src.activity_key,
    src.month_start,
    src.target_value,
    src.updated_by,
    src.updated_mat,
    src.updated_nome,
    src.updated_at
from (
    select
        t.cd,
        t.activity_key,
        date_trunc('month', t.date_ref)::date as month_start,
        round(t.target_value, 3) as target_value,
        t.updated_by,
        t.updated_mat,
        t.updated_nome,
        t.updated_at
    from app.meta_mes_daily_targets t
    where t.target_value is not null
      and not coalesce(t.is_holiday, false)
      and extract(isodow from t.date_ref) <> 7
) src
order by src.cd, src.activity_key, src.month_start, src.updated_at desc, src.target_value desc
on conflict (cd, activity_key, month_start)
do nothing;

create or replace function app.meta_mes_effective_month_target(
    p_cd integer,
    p_activity_key text,
    p_month_start date default null
)
returns table (
    month_start date,
    daily_target_value numeric(18, 3),
    updated_at timestamptz
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
    select
        mt.month_start,
        mt.daily_target_value,
        mt.updated_at
    from app.meta_mes_month_targets mt
    where mt.cd = p_cd
      and mt.activity_key = p_activity_key
      and mt.month_start <= date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date
    order by mt.month_start desc
    limit 1;
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
    effective_target as (
        select
            et.month_start,
            et.daily_target_value,
            et.updated_at
        from app.meta_mes_effective_month_target(p_cd, v_activity.activity_key, p_month_start) et
    ),
    holidays as (
        select
            t.date_ref,
            true as is_holiday,
            max(t.updated_at) as updated_at
        from app.meta_mes_daily_targets t
        cross join month_bounds mb
        where t.cd = p_cd
          and t.activity_key = v_activity.activity_key
          and coalesce(t.is_holiday, false)
          and t.date_ref >= mb.month_start
          and t.date_ref <= mb.month_end
        group by t.date_ref
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
            coalesce(h.is_holiday, false) as is_holiday,
            case
                when extract(isodow from d.date_ref) = 7 then 'domingo'
                when coalesce(h.is_holiday, false) then 'feriado'
                when et.daily_target_value is null then 'sem_meta'
                else 'meta'
            end as target_kind,
            case
                when extract(isodow from d.date_ref) = 7 then 0::numeric(18, 3)
                when coalesce(h.is_holiday, false) then null::numeric(18, 3)
                else et.daily_target_value
            end as target_value,
            coalesce(a.actual_value, 0)::numeric(18, 3) as actual_value,
            greatest(
                coalesce(a.updated_at, '-infinity'::timestamptz),
                coalesce(h.updated_at, '-infinity'::timestamptz),
                coalesce(et.updated_at, '-infinity'::timestamptz)
            ) as updated_at
        from days d
        left join actuals a
          on a.date_ref = d.date_ref
        left join holidays h
          on h.date_ref = d.date_ref
        left join effective_target et
          on true
    ),
    normalized as (
        select
            b.*,
            nullif(b.updated_at, '-infinity'::timestamptz) as normalized_updated_at
        from base b
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
                when b.target_kind = 'feriado' then 'feriado'
                when b.target_kind = 'domingo' then 'domingo'
                when b.target_kind = 'sem_meta' then 'sem_meta'
                when b.actual_value > coalesce(b.target_value, 0) then 'acima'
                when b.actual_value = coalesce(b.target_value, 0) then 'atingiu'
                else 'abaixo'
            end as status,
            b.is_holiday,
            b.is_sunday,
            b.normalized_updated_at as updated_at
        from normalized b
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

        select date_trunc('month', p.dt_hr)::date
        from app.aud_pvps p
        where p.cd = v_cd

        union

        select date_trunc('month', a.dt_hr)::date
        from app.aud_alocacao a
        where a.cd = v_cd

        union

        select date_trunc('month', coalesce(b.dt_conf, b.updated_at))::date
        from app.db_prod_blitz b
        where b.cd = v_cd

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

drop function if exists public.rpc_meta_mes_summary(integer, text, date);
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
    balance_to_target numeric(18, 3),
    daily_target_value numeric(18, 3),
    target_reference_month date,
    month_workdays integer,
    elapsed_workdays integer
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
    effective_target as (
        select *
        from app.meta_mes_effective_month_target(v_cd, v_activity.activity_key, p_month_start)
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
        nullif(
            greatest(
                coalesce(ag.updated_at, '-infinity'::timestamptz),
                coalesce(et.updated_at, '-infinity'::timestamptz)
            ),
            '-infinity'::timestamptz
        ),
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
        round(ag.total_actual - ag.total_target, 3) as balance_to_target,
        et.daily_target_value,
        et.month_start as target_reference_month,
        es.month_workdays,
        es.elapsed_workdays
    from month_bounds mb
    cross join aggregates ag
    cross join elapsed_stats es
    left join effective_target et
      on true;
end;
$$;

create or replace function public.rpc_meta_mes_set_month_target(
    p_cd integer default null,
    p_activity_key text default null,
    p_month_start date default null,
    p_daily_target_value numeric default null
)
returns table (
    month_start date,
    activity_key text,
    daily_target_value numeric(18, 3),
    target_reference_month date,
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
    v_effective_month_start date := date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date;
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

    if v_effective_month_start <> v_current_month_start then
        raise exception 'APENAS_MES_ATUAL';
    end if;

    if p_daily_target_value is not null and p_daily_target_value < 0 then
        raise exception 'META_DIARIA_INVALIDA';
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

    if p_daily_target_value is null then
        delete from app.meta_mes_month_targets mt
        where mt.cd = v_cd
          and mt.activity_key = v_activity.activity_key
          and mt.month_start = v_effective_month_start;
    else
        insert into app.meta_mes_month_targets (
            cd,
            activity_key,
            month_start,
            daily_target_value,
            updated_by,
            updated_mat,
            updated_nome
        )
        values (
            v_cd,
            v_activity.activity_key,
            v_effective_month_start,
            round(p_daily_target_value, 3),
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
        )
        on conflict (cd, activity_key, month_start)
        do update set
            daily_target_value = excluded.daily_target_value,
            updated_by = excluded.updated_by,
            updated_mat = excluded.updated_mat,
            updated_nome = excluded.updated_nome,
            updated_at = now();
    end if;

    return query
    select
        v_effective_month_start as month_start,
        v_activity.activity_key,
        mt.daily_target_value,
        mt.month_start as target_reference_month,
        mt.updated_at
    from app.meta_mes_effective_month_target(v_cd, v_activity.activity_key, v_effective_month_start) mt

    union all

    select
        v_effective_month_start,
        v_activity.activity_key,
        null::numeric(18, 3),
        null::date,
        null::timestamptz
    where not exists (
        select 1
        from app.meta_mes_effective_month_target(v_cd, v_activity.activity_key, v_effective_month_start)
    );
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
        raise exception 'META_DIARIA_INVALIDA';
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

    perform 1
    from public.rpc_meta_mes_set_month_target(
        v_cd,
        v_activity.activity_key,
        date_trunc('month', p_date_ref)::date,
        p_target_value
    );

    return query
    select day_row.*
    from app.meta_mes_daily_activity(v_cd, v_activity.activity_key, p_date_ref) day_row
    where day_row.date_ref = p_date_ref;
end;
$$;

grant execute on function public.rpc_meta_mes_set_month_target(integer, text, date, numeric) to authenticated;
