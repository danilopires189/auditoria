create or replace function app.atividade_extra_points(p_duration_seconds integer)
returns numeric
language plpgsql
immutable
as $$
declare
    v_duration integer := greatest(coalesce(p_duration_seconds, 0), 0);
    v_result numeric;
begin
    if v_duration < 300 then
        return 0;
    end if;

    if v_duration >= 21600 then
        return 1.5;
    end if;

    v_result := 0.01 + floor((v_duration - 300)::numeric / 1014::numeric) * 0.07095;
    return round(least(v_result, 1.5), 3);
end;
$$;

create or replace function public.rpc_atividade_extra_visibility_get(p_cd integer default null)
returns table (
    cd integer,
    visibility_mode text,
    updated_by uuid,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.atividade_extra_resolve_cd(p_cd);

    return query
    with settings_row as (
        select
            st.visibility_mode,
            st.updated_by,
            st.updated_at
        from app.atividade_extra_cd_settings st
        where st.cd = v_cd
        limit 1
    )
    select
        v_cd as cd,
        coalesce(sr.visibility_mode, 'public_cd') as visibility_mode,
        sr.updated_by,
        sr.updated_at
    from settings_row sr
    right join (select 1) as d on true;
end;
$$;

create or replace function public.rpc_atividade_extra_visibility_set(
    p_cd integer,
    p_visibility_mode text
)
returns table (
    cd integer,
    visibility_mode text,
    updated_by uuid,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if authz.user_role(v_uid) <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    v_cd := app.atividade_extra_resolve_cd(p_cd);
    v_mode := lower(trim(coalesce(p_visibility_mode, '')));

    if v_mode not in ('public_cd', 'owner_only') then
        raise exception 'VISIBILIDADE_INVALIDA';
    end if;

    insert into app.atividade_extra_cd_settings as st (
        cd,
        visibility_mode,
        updated_by,
        updated_at
    )
    values (
        v_cd,
        v_mode,
        v_uid,
        now()
    )
    on conflict (cd)
    do update set
        visibility_mode = excluded.visibility_mode,
        updated_by = excluded.updated_by,
        updated_at = now();

    return query
    select
        st.cd,
        st.visibility_mode,
        st.updated_by,
        st.updated_at
    from app.atividade_extra_cd_settings st
    where st.cd = v_cd
    limit 1;
end;
$$;

create or replace function public.rpc_atividade_extra_collaborators(p_cd integer default null)
returns table (
    user_id uuid,
    mat text,
    nome text,
    pontos_soma numeric(12,5),
    tempo_total_segundos bigint,
    tempo_total_hms text,
    atividades_count bigint
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
    v_is_admin boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.atividade_extra_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';

    select coalesce(st.visibility_mode, 'public_cd')
    into v_mode
    from app.atividade_extra_cd_settings st
    where st.cd = v_cd
    limit 1;

    v_mode := coalesce(v_mode, 'public_cd');

    return query
    with base as (
        select a.*
        from app.atividade_extra a
        where a.cd = v_cd
          and (
              v_is_admin
              or v_mode = 'public_cd'
              or a.user_id = v_uid
          )
    )
    select
        b.user_id,
        min(b.mat) as mat,
        min(b.nome) as nome,
        round(coalesce(sum(b.pontos), 0), 3)::numeric(12,5) as pontos_soma,
        coalesce(sum(b.duracao_segundos), 0)::bigint as tempo_total_segundos,
        app.atividade_extra_hms(coalesce(sum(b.duracao_segundos), 0)::bigint) as tempo_total_hms,
        count(*)::bigint as atividades_count
    from base b
    group by b.user_id
    order by
        round(coalesce(sum(b.pontos), 0), 3) desc,
        coalesce(sum(b.duracao_segundos), 0) desc,
        min(b.nome);
end;
$$;

create or replace function public.rpc_atividade_extra_entries(
    p_cd integer default null,
    p_target_user_id uuid default null
)
returns table (
    id uuid,
    cd integer,
    user_id uuid,
    mat text,
    nome text,
    data_inicio date,
    hora_inicio time,
    data_fim date,
    hora_fim time,
    duracao_segundos integer,
    tempo_gasto_hms text,
    pontos numeric(9,5),
    descricao text,
    created_at timestamptz,
    updated_at timestamptz,
    can_edit boolean
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
    v_is_admin boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.atividade_extra_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';

    select coalesce(st.visibility_mode, 'public_cd')
    into v_mode
    from app.atividade_extra_cd_settings st
    where st.cd = v_cd
    limit 1;

    v_mode := coalesce(v_mode, 'public_cd');

    if p_target_user_id is not null
       and p_target_user_id <> v_uid
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    return query
    select
        a.id,
        a.cd,
        a.user_id,
        a.mat,
        a.nome,
        a.data_inicio,
        a.hora_inicio,
        a.data_fim,
        a.hora_fim,
        a.duracao_segundos,
        app.atividade_extra_hms(a.duracao_segundos::bigint) as tempo_gasto_hms,
        round(a.pontos, 3)::numeric(9,5) as pontos,
        a.descricao,
        a.created_at,
        a.updated_at,
        (a.user_id = v_uid) as can_edit
    from app.atividade_extra a
    where a.cd = v_cd
      and (
          v_is_admin
          or v_mode = 'public_cd'
          or a.user_id = v_uid
      )
      and (p_target_user_id is null or a.user_id = p_target_user_id)
    order by a.data_inicio desc, a.hora_inicio desc, a.created_at desc, a.id desc;
end;
$$;
