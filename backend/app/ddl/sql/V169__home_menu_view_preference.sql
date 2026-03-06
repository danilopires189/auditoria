alter table authz.profiles
    add column if not exists home_menu_view text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'chk_authz_profiles_home_menu_view'
          and conrelid = 'authz.profiles'::regclass
    ) then
        alter table authz.profiles
            add constraint chk_authz_profiles_home_menu_view
            check (home_menu_view in ('list', 'grid') or home_menu_view is null);
    end if;
end
$$;

drop function if exists public.rpc_current_profile_context_v2();
drop function if exists public.rpc_current_profile_context();
drop function if exists authz.current_profile_context_v2();
drop function if exists authz.current_profile_context();

create function authz.current_profile_context()
returns table (
    user_id uuid,
    nome text,
    mat text,
    role text,
    cd_default integer,
    cd_nome text,
    home_menu_view text
)
language plpgsql
stable
security definer
set search_path = authz, app, public
as $$
begin
    if auth.uid() is null then
        return;
    end if;

    return query
    with profile_base as (
        select
            p.user_id,
            p.nome,
            p.mat,
            p.role,
            p.home_menu_view,
            coalesce(
                p.cd_default,
                (
                    select min(ud.cd)
                    from authz.user_deposits ud
                    where ud.user_id = p.user_id
                )
            ) as cd_effective
        from authz.profiles p
        where p.user_id = auth.uid()
    )
    select
        pb.user_id,
        pb.nome,
        pb.mat,
        pb.role,
        pb.cd_effective as cd_default,
        case
            when pb.role = 'admin' and pb.cd_effective is null then 'Todos CDs'
            when pb.cd_effective is null then null
            else coalesce(
                (
                    select min(nullif(trim(u.cd_nome), ''))
                    from app.db_usuario u
                    where authz.normalize_mat(u.mat) = authz.normalize_mat(pb.mat)
                      and u.cd = pb.cd_effective
                ),
                (
                    select min(nullif(trim(u.cd_nome), ''))
                    from app.db_usuario u
                    where u.cd = pb.cd_effective
                ),
                format('CD %s', pb.cd_effective)
            )
        end as cd_nome,
        pb.home_menu_view
    from profile_base pb
    limit 1;
end;
$$;

create function authz.current_profile_context_v2()
returns table (
    user_id uuid,
    nome text,
    mat text,
    role text,
    cargo text,
    cd_default integer,
    cd_nome text,
    home_menu_view text
)
language plpgsql
stable
security definer
set search_path = authz, app, public
as $$
begin
    if auth.uid() is null then
        return;
    end if;

    return query
    with profile_base as (
        select
            p.user_id,
            p.nome,
            p.mat,
            p.role,
            p.home_menu_view,
            coalesce(
                p.cd_default,
                (
                    select min(ud.cd)
                    from authz.user_deposits ud
                    where ud.user_id = p.user_id
                )
            ) as cd_effective
        from authz.profiles p
        where p.user_id = auth.uid()
    )
    select
        pb.user_id,
        pb.nome,
        pb.mat,
        pb.role,
        coalesce(
            (
                select min(nullif(trim(u.cargo), ''))
                from app.db_usuario u
                where authz.normalize_mat(u.mat) = authz.normalize_mat(pb.mat)
                  and (pb.cd_effective is null or u.cd = pb.cd_effective)
            ),
            (
                select min(nullif(trim(u.cargo), ''))
                from app.db_usuario u
                where authz.normalize_mat(u.mat) = authz.normalize_mat(pb.mat)
            )
        ) as cargo,
        pb.cd_effective as cd_default,
        case
            when pb.role = 'admin' and pb.cd_effective is null then 'Todos CDs'
            when pb.cd_effective is null then null
            else coalesce(
                (
                    select min(nullif(trim(u.cd_nome), ''))
                    from app.db_usuario u
                    where authz.normalize_mat(u.mat) = authz.normalize_mat(pb.mat)
                      and u.cd = pb.cd_effective
                ),
                (
                    select min(nullif(trim(u.cd_nome), ''))
                    from app.db_usuario u
                    where u.cd = pb.cd_effective
                ),
                format('CD %s', pb.cd_effective)
            )
        end as cd_nome,
        pb.home_menu_view
    from profile_base pb
    limit 1;
end;
$$;

create function public.rpc_current_profile_context()
returns table (
    user_id uuid,
    nome text,
    mat text,
    role text,
    cd_default integer,
    cd_nome text,
    home_menu_view text
)
language sql
stable
security definer
set search_path = authz, app, public
as $$
    select *
    from authz.current_profile_context();
$$;

create function public.rpc_current_profile_context_v2()
returns table (
    user_id uuid,
    nome text,
    mat text,
    role text,
    cargo text,
    cd_default integer,
    cd_nome text,
    home_menu_view text
)
language sql
stable
security definer
set search_path = authz, app, public
as $$
    select *
    from authz.current_profile_context_v2();
$$;

create or replace function public.rpc_set_home_menu_view(p_home_menu_view text)
returns text
language plpgsql
security definer
set search_path = authz, app, public
as $$
declare
    v_mode text;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_mode := lower(trim(coalesce(p_home_menu_view, '')));
    if v_mode not in ('list', 'grid') then
        raise exception 'HOME_MENU_VIEW_INVALID';
    end if;

    update authz.profiles p
       set home_menu_view = v_mode
     where p.user_id = auth.uid();

    if not found then
        raise exception 'USUARIO_NAO_CADASTRADO';
    end if;

    return v_mode;
end;
$$;

grant execute on function authz.current_profile_context() to authenticated;
grant execute on function authz.current_profile_context_v2() to authenticated;
grant execute on function public.rpc_current_profile_context() to authenticated;
grant execute on function public.rpc_current_profile_context_v2() to authenticated;
grant execute on function public.rpc_set_home_menu_view(text) to authenticated;
