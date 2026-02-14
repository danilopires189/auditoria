create or replace function authz.user_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = authz, public
as $$
    select p.role
    from authz.profiles p
    where p.user_id = p_user_id;
$$;

create or replace function authz.is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = authz, public
as $$
    select coalesce(
        exists (
            select 1
            from authz.profiles p
            where p.user_id = p_user_id
              and p.role = 'admin'
              and p.cd_default is null
        ),
        false
    );
$$;

create or replace function authz.can_access_cd(p_user_id uuid, p_cd integer)
returns boolean
language sql
stable
security definer
set search_path = authz, public
as $$
    select exists (
        select 1
        from authz.user_deposits ud
        where ud.user_id = p_user_id
          and ud.cd = p_cd
    );
$$;

create or replace function authz.can_read_global_dim(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = authz, public
as $$
    select coalesce(authz.user_role(p_user_id) in ('admin', 'auditor', 'viewer'), false);
$$;

grant execute on function authz.user_role(uuid) to authenticated;
grant execute on function authz.is_admin(uuid) to authenticated;
grant execute on function authz.can_access_cd(uuid, integer) to authenticated;
grant execute on function authz.can_read_global_dim(uuid) to authenticated;
