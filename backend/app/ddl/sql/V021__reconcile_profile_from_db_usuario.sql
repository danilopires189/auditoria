create or replace function authz.login_email_from_mat(p_mat text)
returns text
language plpgsql
stable
security definer
set search_path = authz, auth, public
as $$
declare
    v_mat text;
    v_mat_canonical text;
    v_email text;
begin
    v_mat := authz.normalize_mat(p_mat);
    v_mat_canonical := nullif(regexp_replace(v_mat, '^0+(?=\\d)', ''), '');

    if v_mat = '' then
        raise exception 'MATRICULA_INVALIDA';
    end if;

    select lower(nullif(trim(u.email), ''))
    into v_email
    from authz.profiles p
    join auth.users u
      on u.id = p.user_id
    where authz.normalize_mat(p.mat) = v_mat
      and u.deleted_at is null
      and nullif(trim(u.email), '') is not null
    order by u.updated_at desc nulls last, u.created_at desc nulls last
    limit 1;

    if v_email is null then
        select lower(nullif(trim(u.email), ''))
        into v_email
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

    if v_email is null then
        v_email := lower(v_mat || '@pmenos.com.br');
    end if;

    return v_email;
end;
$$;

create or replace function authz.ensure_profile_for_user(
    p_user_id uuid,
    p_mat text default null
)
returns boolean
language plpgsql
security definer
set search_path = authz, app, auth, public
as $$
declare
    v_mat text;
    v_email text;
    v_nome text;
    v_cargo text;
    v_cd_default integer;
    v_cds integer[];
    v_role text;
begin
    if p_user_id is null then
        return false;
    end if;

    select lower(nullif(trim(u.email), ''))
    into v_email
    from auth.users u
    where u.id = p_user_id
      and u.deleted_at is null
    limit 1;

    if v_email is null then
        return false;
    end if;

    v_mat := authz.normalize_mat(p_mat);

    if v_mat = '' then
        select authz.normalize_mat(p.mat)
        into v_mat
        from authz.profiles p
        where p.user_id = p_user_id
        limit 1;
    end if;

    if v_mat = '' then
        v_mat := authz.normalize_mat(split_part(v_email, '@', 1));
    end if;

    if v_mat = '' then
        select authz.normalize_mat(coalesce(u.raw_user_meta_data ->> 'mat', ''))
        into v_mat
        from auth.users u
        where u.id = p_user_id
        limit 1;
    end if;

    if v_mat = '' then
        return false;
    end if;

    select
        min(u.nome),
        min(u.cargo),
        min(u.cd),
        array_agg(distinct u.cd order by u.cd)
    into
        v_nome,
        v_cargo,
        v_cd_default,
        v_cds
    from app.db_usuario u
    where authz.normalize_mat(u.mat) = v_mat;

    if v_nome is null then
        return false;
    end if;

    v_role := authz.role_from_cargo(v_cargo);

    insert into authz.profiles (
        user_id,
        nome,
        mat,
        role,
        cd_default,
        created_at
    )
    values (
        p_user_id,
        v_nome,
        v_mat,
        v_role,
        v_cd_default,
        now()
    )
    on conflict (user_id)
    do update set
        nome = excluded.nome,
        mat = excluded.mat,
        role = excluded.role,
        cd_default = excluded.cd_default;

    if coalesce(array_length(v_cds, 1), 0) > 0 then
        delete from authz.user_deposits
        where user_id = p_user_id;

        insert into authz.user_deposits (user_id, cd, created_at)
        select p_user_id, cd_item, now()
        from unnest(v_cds) as cd_item
        on conflict (user_id, cd) do nothing;
    end if;

    return true;
end;
$$;

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

    return authz.ensure_profile_for_user(v_user_id, v_mat);
end;
$$;

create or replace function public.rpc_reconcile_profile_by_mat(p_mat text)
returns boolean
language sql
security definer
set search_path = authz, public
as $$
    select authz.ensure_profile_from_mat(p_mat);
$$;

create or replace function public.rpc_reconcile_current_profile()
returns boolean
language plpgsql
security definer
set search_path = authz, public
as $$
declare
    v_uid uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then
        return false;
    end if;
    return authz.ensure_profile_for_user(v_uid, null);
end;
$$;

create or replace function public.rpc_has_profile_by_mat(p_mat text)
returns boolean
language plpgsql
security definer
set search_path = authz, public
as $$
begin
    if exists (
        select 1
        from authz.profiles p
        where authz.normalize_mat(p.mat) = authz.normalize_mat(p_mat)
    ) then
        return true;
    end if;

    return authz.ensure_profile_from_mat(p_mat);
end;
$$;

grant execute on function authz.login_email_from_mat(text) to anon;
grant execute on function authz.login_email_from_mat(text) to authenticated;
grant execute on function public.rpc_reconcile_profile_by_mat(text) to anon;
grant execute on function public.rpc_reconcile_profile_by_mat(text) to authenticated;
grant execute on function public.rpc_reconcile_current_profile() to authenticated;
grant execute on function public.rpc_has_profile_by_mat(text) to anon;
grant execute on function public.rpc_has_profile_by_mat(text) to authenticated;
