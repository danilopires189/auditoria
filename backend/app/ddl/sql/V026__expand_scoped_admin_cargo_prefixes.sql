create or replace function authz.role_from_cargo(p_cargo text)
returns text
language sql
stable
as $$
    select case
        when upper(trim(coalesce(p_cargo, ''))) like 'SUPER%' then 'admin'
        when upper(trim(coalesce(p_cargo, ''))) like 'ASSISTEN%' then 'admin'
        when upper(trim(coalesce(p_cargo, ''))) like 'ANALIST%' then 'admin'
        when upper(trim(coalesce(p_cargo, ''))) like 'COORDE%' then 'admin'
        else 'auditor'
    end;
$$;

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
        when upper(trim(coalesce(p_cargo, ''))) like 'ASSISTEN%' then 'admin'
        when upper(trim(coalesce(p_cargo, ''))) like 'ANALIST%' then 'admin'
        when upper(trim(coalesce(p_cargo, ''))) like 'COORDE%' then 'admin'
        else 'auditor'
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
            bool_or(
                upper(trim(coalesce(u.cargo, ''))) like 'SUPER%'
                or upper(trim(coalesce(u.cargo, ''))) like 'ASSISTEN%'
                or upper(trim(coalesce(u.cargo, ''))) like 'ANALIST%'
                or upper(trim(coalesce(u.cargo, ''))) like 'COORDE%'
            ) as is_scoped_admin,
            min(u.cd) as cd_min,
            array_agg(distinct u.cd order by u.cd) as cds
        from app.db_usuario u
        where authz.normalize_mat(u.mat) <> ''
        group by authz.normalize_mat(u.mat)
    )
    update authz.profiles p
    set
        role = case when coalesce(db.is_scoped_admin, false) then 'admin' else 'auditor' end,
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

grant execute on function authz.role_from_cargo(text) to authenticated;
grant execute on function authz.role_from_mat_and_cargo(text, text) to authenticated;
