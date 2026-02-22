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
    select
        r.v_cd as cd,
        coalesce(st.visibility_mode, 'public_cd') as visibility_mode,
        st.updated_by,
        st.updated_at
    from (select v_cd as v_cd) r
    left join app.atividade_extra_cd_settings st
      on st.cd = r.v_cd;
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
    on conflict on constraint atividade_extra_cd_settings_pkey
    do update set
        visibility_mode = excluded.visibility_mode,
        updated_by = excluded.updated_by,
        updated_at = now();

    return query
    select
        st.cd as cd,
        st.visibility_mode as visibility_mode,
        st.updated_by as updated_by,
        st.updated_at as updated_at
    from app.atividade_extra_cd_settings st
    where st.cd = v_cd
    limit 1;
end;
$$;
