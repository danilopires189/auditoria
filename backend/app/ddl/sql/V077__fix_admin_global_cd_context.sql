create or replace function authz.current_profile_context()
returns table (
    user_id uuid,
    nome text,
    mat text,
    role text,
    cd_default integer,
    cd_nome text
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
            case
                when p.role = 'admin' and p.cd_default is null then null
                else coalesce(
                    p.cd_default,
                    (
                        select min(ud.cd)
                        from authz.user_deposits ud
                        where ud.user_id = p.user_id
                    )
                )
            end as cd_effective
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
        end as cd_nome
    from profile_base pb
    limit 1;
end;
$$;

create or replace function authz.current_profile_context_v2()
returns table (
    user_id uuid,
    nome text,
    mat text,
    role text,
    cargo text,
    cd_default integer,
    cd_nome text
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
            case
                when p.role = 'admin' and p.cd_default is null then null
                else coalesce(
                    p.cd_default,
                    (
                        select min(ud.cd)
                        from authz.user_deposits ud
                        where ud.user_id = p.user_id
                    )
                )
            end as cd_effective
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
        end as cd_nome
    from profile_base pb
    limit 1;
end;
$$;

create or replace function public.rpc_current_profile_context_v2()
returns table (
    user_id uuid,
    nome text,
    mat text,
    role text,
    cargo text,
    cd_default integer,
    cd_nome text
)
language sql
stable
security definer
set search_path = authz, app, public
as $$
    select *
    from authz.current_profile_context_v2();
$$;

grant execute on function authz.current_profile_context() to authenticated;
grant execute on function authz.current_profile_context_v2() to authenticated;
grant execute on function public.rpc_current_profile_context_v2() to authenticated;
