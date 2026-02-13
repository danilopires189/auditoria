create or replace function authz.current_user_id()
returns uuid
language sql
stable
as $$
    select auth.uid();
$$;

create or replace function authz.user_role(p_user_id uuid)
returns text
language sql
stable
as $$
    select p.role
    from authz.profiles p
    where p.user_id = p_user_id;
$$;

create or replace function authz.is_admin(p_user_id uuid)
returns boolean
language sql
stable
as $$
    select coalesce(authz.user_role(p_user_id) = 'admin', false);
$$;

create or replace function authz.can_access_cd(p_user_id uuid, p_cd integer)
returns boolean
language sql
stable
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
as $$
    select coalesce(authz.user_role(p_user_id) in ('admin', 'auditor', 'viewer'), false);
$$;

create or replace function app.apply_runtime_security(p_table text)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    has_cd boolean;
    policy_name text;
begin
    if not exists (
        select 1
        from information_schema.tables
        where table_schema = 'app'
          and table_name = p_table
    ) then
        raise exception 'app table % does not exist', p_table;
    end if;

    execute format('alter table app.%I enable row level security', p_table);
    execute format('revoke all on table app.%I from anon', p_table);
    execute format('revoke insert, update, delete, truncate, references, trigger on table app.%I from authenticated', p_table);
    execute format('grant select on table app.%I to authenticated', p_table);

    policy_name := format('p_%s_select', p_table);
    execute format('drop policy if exists %I on app.%I', policy_name, p_table);

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'app'
          and table_name = p_table
          and column_name = 'cd'
    ) into has_cd;

    if p_table = 'db_barras' then
        execute format(
            'create policy %I on app.%I for select using (authz.can_read_global_dim(auth.uid()))',
            policy_name,
            p_table
        );
    elsif has_cd then
        execute format(
            'create policy %I on app.%I for select using (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), cd))',
            policy_name,
            p_table
        );
    else
        execute format(
            'create policy %I on app.%I for select using (authz.is_admin(auth.uid()))',
            policy_name,
            p_table
        );
    end if;
end;
$$;

grant execute on function authz.current_user_id() to authenticated;
grant execute on function authz.user_role(uuid) to authenticated;
grant execute on function authz.is_admin(uuid) to authenticated;
grant execute on function authz.can_access_cd(uuid, integer) to authenticated;
grant execute on function authz.can_read_global_dim(uuid) to authenticated;