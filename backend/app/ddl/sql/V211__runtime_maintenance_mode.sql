create table if not exists app.runtime_settings (
    id smallint primary key default 1,
    maintenance_mode boolean not null default false,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null,
    constraint ck_runtime_settings_singleton_id check (id = 1)
);

insert into app.runtime_settings (
    id,
    maintenance_mode
)
values (
    1,
    false
)
on conflict (id) do nothing;

revoke all on app.runtime_settings from anon;
revoke all on app.runtime_settings from authenticated;

create or replace function public.rpc_runtime_status()
returns table (
    maintenance_mode boolean,
    updated_at timestamptz
)
language sql
stable
security definer
set search_path = app, public
as $$
    with current_row as (
        select
            st.maintenance_mode,
            st.updated_at
        from app.runtime_settings st
        where st.id = 1
        limit 1
    )
    select
        coalesce(cr.maintenance_mode, false) as maintenance_mode,
        cr.updated_at
    from current_row cr
    right join (select 1) fallback on true;
$$;

grant execute on function public.rpc_runtime_status() to anon;
grant execute on function public.rpc_runtime_status() to authenticated;
