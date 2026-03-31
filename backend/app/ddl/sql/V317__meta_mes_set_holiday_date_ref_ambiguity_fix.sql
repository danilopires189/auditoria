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
