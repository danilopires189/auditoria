-- Make MAT 20750 equivalent to global admin behavior (same as MAT 88885).

create or replace function authz.ensure_profile_from_mat(p_mat text)
returns boolean
language plpgsql
security definer
set search_path = authz, auth, public
as $$
declare
    v_mat text;
    v_mat_canonical text;
    v_user_id uuid;
    v_ok boolean;
begin
    v_mat := authz.normalize_mat(p_mat);
    v_mat_canonical := nullif(regexp_replace(v_mat, '^0+(?=\\d)', ''), '');

    if v_mat = '' then
        return false;
    end if;

    select p.user_id
    into v_user_id
    from authz.profiles p
    where authz.normalize_mat(p.mat) = v_mat
    limit 1;

    if v_user_id is null then
        select u.id
        into v_user_id
        from auth.users u
        where u.deleted_at is null
          and lower(coalesce(u.email, '')) in (
              lower(v_mat || '@pmenos.com.br'),
              lower('mat_' || v_mat || '@login.auditoria.local'),
              lower(coalesce(v_mat_canonical, v_mat) || '@pmenos.com.br'),
              lower('mat_' || coalesce(v_mat_canonical, v_mat) || '@login.auditoria.local')
          )
        order by u.updated_at desc nulls last, u.created_at desc nulls last
        limit 1;
    end if;

    if v_user_id is null then
        return false;
    end if;

    v_ok := authz.ensure_profile_for_user(v_user_id, v_mat);
    if not v_ok then
        return false;
    end if;

    if v_mat = '20750' then
        update authz.profiles p
        set
            role = 'admin',
            cd_default = null
        where p.user_id = v_user_id;

        delete from authz.user_deposits
        where user_id = v_user_id;

        insert into authz.user_deposits (user_id, cd, created_at)
        select
            v_user_id,
            cds.cd,
            now()
        from (
            select distinct u.cd
            from app.db_usuario u
            where u.cd is not null
        ) cds
        on conflict (user_id, cd) do nothing;
    end if;

    return true;
end;
$$;

create or replace function public.rpc_reconcile_current_profile()
returns boolean
language plpgsql
security definer
set search_path = authz, public
as $$
declare
    v_uid uuid;
    v_ok boolean;
    v_mat text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        return false;
    end if;

    v_ok := authz.ensure_profile_for_user(v_uid, null);
    if not v_ok then
        return false;
    end if;

    select authz.normalize_mat(p.mat)
    into v_mat
    from authz.profiles p
    where p.user_id = v_uid
    limit 1;

    if v_mat = '20750' then
        update authz.profiles p
        set
            role = 'admin',
            cd_default = null
        where p.user_id = v_uid;

        delete from authz.user_deposits
        where user_id = v_uid;

        insert into authz.user_deposits (user_id, cd, created_at)
        select
            v_uid,
            cds.cd,
            now()
        from (
            select distinct u.cd
            from app.db_usuario u
            where u.cd is not null
        ) cds
        on conflict (user_id, cd) do nothing;
    end if;

    return true;
end;
$$;

do $$
begin
    perform authz.ensure_profile_from_mat('20750');
end
$$;
