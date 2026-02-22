create table if not exists authz.active_login_sessions (
    user_id uuid primary key references auth.users(id) on delete cascade,
    device_id text not null,
    claimed_at timestamptz not null default now(),
    last_activity_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_authz_active_login_sessions_updated_at
    on authz.active_login_sessions(updated_at desc);

create index if not exists idx_authz_active_login_sessions_last_activity
    on authz.active_login_sessions(last_activity_at desc);

revoke all on authz.active_login_sessions from public;
revoke all on authz.active_login_sessions from anon;
revoke all on authz.active_login_sessions from authenticated;

create or replace function authz.session_guard_ping(
    p_device_id text,
    p_touch_activity boolean default false,
    p_allow_takeover boolean default false,
    p_idle_minutes integer default 60
)
returns text
language plpgsql
volatile
security definer
set search_path = authz, public
as $$
declare
    v_uid uuid;
    v_now timestamptz := now();
    v_device_id text := nullif(trim(coalesce(p_device_id, '')), '');
    v_idle_minutes integer := greatest(coalesce(p_idle_minutes, 60), 1);
    v_idle_interval interval := make_interval(mins => v_idle_minutes);
    v_row authz.active_login_sessions%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if v_device_id is null then
        raise exception 'DEVICE_ID_OBRIGATORIO';
    end if;

    select *
      into v_row
      from authz.active_login_sessions s
     where s.user_id = v_uid
     for update;

    if v_row.user_id is null then
        insert into authz.active_login_sessions (
            user_id,
            device_id,
            claimed_at,
            last_activity_at,
            updated_at
        )
        values (
            v_uid,
            v_device_id,
            v_now,
            v_now,
            v_now
        );
        return 'OK';
    end if;

    if v_row.device_id <> v_device_id then
        if not p_allow_takeover then
            return 'REPLACED';
        end if;

        update authz.active_login_sessions
           set device_id = v_device_id,
               claimed_at = v_now,
               last_activity_at = case
                   when p_touch_activity then v_now
                   else coalesce(v_row.last_activity_at, v_now)
               end,
               updated_at = v_now
         where user_id = v_uid;

        return 'OK';
    end if;

    if coalesce(v_row.last_activity_at, v_row.updated_at, v_now) + v_idle_interval < v_now then
        delete from authz.active_login_sessions s
         where s.user_id = v_uid
           and s.device_id = v_device_id;
        return 'IDLE_TIMEOUT';
    end if;

    update authz.active_login_sessions
       set last_activity_at = case
               when p_touch_activity then v_now
               else coalesce(last_activity_at, v_now)
           end,
           updated_at = v_now
     where user_id = v_uid
       and device_id = v_device_id;

    return 'OK';
end;
$$;

create or replace function authz.session_guard_release(p_device_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = authz, public
as $$
declare
    v_uid uuid;
    v_device_id text := nullif(trim(coalesce(p_device_id, '')), '');
begin
    v_uid := auth.uid();
    if v_uid is null then
        return false;
    end if;

    if v_device_id is null then
        return false;
    end if;

    delete from authz.active_login_sessions s
     where s.user_id = v_uid
       and s.device_id = v_device_id;

    return found;
end;
$$;

create or replace function public.rpc_session_guard_ping(
    p_device_id text,
    p_touch_activity boolean default false,
    p_allow_takeover boolean default false,
    p_idle_minutes integer default 60
)
returns table (
    status text
)
language sql
volatile
security definer
set search_path = authz, public
as $$
    select authz.session_guard_ping(
        p_device_id => p_device_id,
        p_touch_activity => p_touch_activity,
        p_allow_takeover => p_allow_takeover,
        p_idle_minutes => p_idle_minutes
    ) as status;
$$;

create or replace function public.rpc_session_guard_release(p_device_id text)
returns boolean
language sql
volatile
security definer
set search_path = authz, public
as $$
    select authz.session_guard_release(p_device_id => p_device_id);
$$;

grant execute on function authz.session_guard_ping(text, boolean, boolean, integer) to authenticated;
grant execute on function authz.session_guard_release(text) to authenticated;
grant execute on function public.rpc_session_guard_ping(text, boolean, boolean, integer) to authenticated;
grant execute on function public.rpc_session_guard_release(text) to authenticated;
