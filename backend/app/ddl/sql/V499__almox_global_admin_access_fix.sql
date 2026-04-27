create or replace function app.almox_current_profile()
returns table (
    user_id uuid,
    mat text,
    nome text,
    role text,
    cd_default integer,
    is_global_admin boolean
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_profile record;
    v_is_global_admin boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    if v_profile.user_id is null then raise exception 'PROFILE_NAO_ENCONTRADO'; end if;

    v_is_global_admin := authz.is_admin(v_uid);

    return query
    select
        v_uid,
        coalesce(nullif(trim(v_profile.mat), ''), '-')::text,
        coalesce(nullif(trim(v_profile.nome), ''), 'Usuário')::text,
        coalesce(nullif(trim(v_profile.role), ''), 'auditor')::text,
        v_profile.cd_default::integer,
        v_is_global_admin::boolean;
end;
$$;

create or replace function app.almox_require_global_admin()
returns table (
    user_id uuid,
    mat text,
    nome text,
    role text,
    cd_default integer,
    is_global_admin boolean
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
begin
    select * into v_profile from app.almox_current_profile() limit 1;
    if not coalesce(v_profile.is_global_admin, false) then raise exception 'APENAS_ADMIN_GLOBAL'; end if;
    return query
    select v_profile.user_id::uuid, v_profile.mat::text, v_profile.nome::text, v_profile.role::text,
           v_profile.cd_default::integer, v_profile.is_global_admin::boolean;
end;
$$;
