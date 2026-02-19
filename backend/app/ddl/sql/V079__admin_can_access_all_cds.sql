create or replace function authz.can_access_cd(p_user_id uuid, p_cd integer)
returns boolean
language sql
stable
security definer
set search_path = authz, public
as $$
    select
        coalesce(
            exists (
                select 1
                from authz.profiles p
                where p.user_id = p_user_id
                  and p.role = 'admin'
            ),
            false
        )
        or exists (
            select 1
            from authz.user_deposits ud
            where ud.user_id = p_user_id
              and ud.cd = p_cd
        );
$$;

grant execute on function authz.can_access_cd(uuid, integer) to authenticated;
