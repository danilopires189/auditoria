create or replace function authz.role_from_mat_and_cargo(
    p_mat text,
    p_cargo text
)
returns text
language sql
stable
as $$
    select case
        when authz.normalize_mat(p_mat) = '1' then 'admin'
        when upper(trim(coalesce(p_cargo, ''))) like 'SUPER%' then 'admin'
        else 'auditor'
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

    if v_mat = '1' then
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
            'admin',
            '1',
            'admin',
            null,
            now()
        )
        on conflict (user_id)
        do update set
            mat = '1',
            role = 'admin',
            cd_default = null;

        delete from authz.user_deposits
        where user_id = p_user_id;

        return true;
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

    v_role := authz.role_from_mat_and_cargo(v_mat, v_cargo);

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

do $$
begin
    update authz.profiles p
    set
        role = 'admin',
        cd_default = null
    where authz.normalize_mat(p.mat) = '1';

    with db_agg as (
        select
            authz.normalize_mat(u.mat) as mat_norm,
            bool_or(upper(trim(coalesce(u.cargo, ''))) like 'SUPER%') as is_super,
            min(u.cd) as cd_min,
            array_agg(distinct u.cd order by u.cd) as cds
        from app.db_usuario u
        where authz.normalize_mat(u.mat) <> ''
        group by authz.normalize_mat(u.mat)
    )
    update authz.profiles p
    set
        role = case when coalesce(db.is_super, false) then 'admin' else 'auditor' end,
        cd_default = coalesce(db.cd_min, p.cd_default)
    from db_agg db
    where db.mat_norm = authz.normalize_mat(p.mat)
      and authz.normalize_mat(p.mat) <> '1';

    delete from authz.user_deposits ud
    using authz.profiles p
    where ud.user_id = p.user_id
      and authz.normalize_mat(p.mat) = '1';

    with db_agg as (
        select
            authz.normalize_mat(u.mat) as mat_norm,
            array_agg(distinct u.cd order by u.cd) as cds
        from app.db_usuario u
        where authz.normalize_mat(u.mat) <> ''
        group by authz.normalize_mat(u.mat)
    )
    delete from authz.user_deposits ud
    using authz.profiles p
    join db_agg db
      on db.mat_norm = authz.normalize_mat(p.mat)
    where ud.user_id = p.user_id
      and authz.normalize_mat(p.mat) <> '1';

    with db_agg as (
        select
            authz.normalize_mat(u.mat) as mat_norm,
            array_agg(distinct u.cd order by u.cd) as cds
        from app.db_usuario u
        where authz.normalize_mat(u.mat) <> ''
        group by authz.normalize_mat(u.mat)
    )
    insert into authz.user_deposits (user_id, cd, created_at)
    select
        p.user_id,
        cd_item,
        now()
    from authz.profiles p
    join db_agg db
      on db.mat_norm = authz.normalize_mat(p.mat)
    cross join lateral unnest(db.cds) as cd_item
    where authz.normalize_mat(p.mat) <> '1'
    on conflict (user_id, cd) do nothing;
end
$$;

grant execute on function authz.role_from_mat_and_cargo(text, text) to authenticated;
