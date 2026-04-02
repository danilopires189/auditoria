-- Allow scoped admins to edit Meta do Mes targets and holidays within their accessible CDs.

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

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
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
        on conflict on constraint uq_meta_mes_month_targets
        do update set
            daily_target_value = excluded.daily_target_value,
            updated_by = excluded.updated_by,
            updated_mat = excluded.updated_mat,
            updated_nome = excluded.updated_nome,
            updated_at = now();
    end if;

    return query
    select
        result.month_start,
        result.activity_key,
        result.daily_target_value,
        result.target_reference_month,
        result.updated_at
    from (
        select
            v_effective_month_start as month_start,
            v_activity.activity_key as activity_key,
            mt.daily_target_value,
            mt.month_start as target_reference_month,
            mt.updated_at
        from app.meta_mes_effective_month_target(v_cd, v_activity.activity_key, v_effective_month_start) mt

        union all

        select
            v_effective_month_start as month_start,
            v_activity.activity_key as activity_key,
            null::numeric(18, 3) as daily_target_value,
            null::date as target_reference_month,
            null::timestamptz as updated_at
        where not exists (
            select 1
            from app.meta_mes_effective_month_target(v_cd, v_activity.activity_key, v_effective_month_start)
        )
    ) result;
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

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
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

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
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
        select
            v_cd,
            catalog.activity_key,
            p_date_ref,
            null,
            true,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
        from app.meta_mes_activity_catalog() catalog
        on conflict on constraint uq_meta_mes_daily_targets
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
          and t.date_ref = p_date_ref
          and t.activity_key in (
              select catalog.activity_key
              from app.meta_mes_activity_catalog() catalog
          );

        delete from app.meta_mes_daily_targets t
        where t.cd = v_cd
          and t.date_ref = p_date_ref
          and t.activity_key in (
              select catalog.activity_key
              from app.meta_mes_activity_catalog() catalog
          )
          and t.target_value is null
          and not t.is_holiday;
    end if;

    return query
    select day_row.*
    from app.meta_mes_daily_activity(v_cd, v_activity.activity_key, p_date_ref) day_row
    where day_row.date_ref = p_date_ref;
end;
$$;

grant execute on function public.rpc_meta_mes_set_month_target(integer, text, date, numeric) to authenticated;
grant execute on function public.rpc_meta_mes_set_daily_target(integer, text, date, numeric) to authenticated;
grant execute on function public.rpc_meta_mes_set_holiday(integer, text, date, boolean) to authenticated;
