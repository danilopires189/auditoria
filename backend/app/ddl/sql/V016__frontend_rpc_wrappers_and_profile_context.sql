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
    select
        p.user_id,
        p.nome,
        p.mat,
        p.role,
        p.cd_default,
        case
            when p.role = 'admin' then 'Todos CDs'
            when p.cd_default is null then null
            else coalesce(
                (
                    select min(nullif(trim(u.cd_nome), ''))
                    from app.db_usuario u
                    where authz.normalize_mat(u.mat) = authz.normalize_mat(p.mat)
                      and u.cd = p.cd_default
                ),
                format('CD %s', p.cd_default)
            )
        end as cd_nome
    from authz.profiles p
    where p.user_id = auth.uid()
    limit 1;
end;
$$;

grant execute on function authz.current_profile_context() to authenticated;

create or replace function public.rpc_login_email_from_mat(p_mat text)
returns text
language sql
stable
security definer
set search_path = authz, public
as $$
    select authz.login_email_from_mat(p_mat);
$$;

create or replace function public.rpc_start_identity_challenge(
    p_mat text,
    p_dt_nasc date,
    p_dt_adm date,
    p_purpose text default 'register'
)
returns table (
    challenge_id uuid,
    nome text,
    cargo text,
    role_suggested text,
    cd_default integer,
    cds integer[],
    expires_at timestamptz
)
language sql
security definer
set search_path = authz, app, public
as $$
    select *
    from authz.start_identity_challenge(
        p_mat => p_mat,
        p_dt_nasc => p_dt_nasc,
        p_dt_adm => p_dt_adm,
        p_purpose => p_purpose
    );
$$;

create or replace function public.rpc_complete_registration(p_challenge_id uuid)
returns table (
    user_id uuid,
    mat text,
    nome text,
    role text,
    cd_default integer,
    cds integer[]
)
language sql
security definer
set search_path = authz, app, public
as $$
    select *
    from authz.complete_registration(p_challenge_id);
$$;

create or replace function public.rpc_reset_password_with_challenge(
    p_challenge_id uuid,
    p_new_password text
)
returns boolean
language sql
security definer
set search_path = authz, auth, public
as $$
    select authz.reset_password_with_challenge(
        p_challenge_id => p_challenge_id,
        p_new_password => p_new_password
    );
$$;

create or replace function public.rpc_current_profile_context()
returns table (
    user_id uuid,
    nome text,
    mat text,
    role text,
    cd_default integer,
    cd_nome text
)
language sql
stable
security definer
set search_path = authz, app, public
as $$
    select *
    from authz.current_profile_context();
$$;

grant execute on function public.rpc_login_email_from_mat(text) to anon;
grant execute on function public.rpc_login_email_from_mat(text) to authenticated;
grant execute on function public.rpc_start_identity_challenge(text, date, date, text) to anon;
grant execute on function public.rpc_start_identity_challenge(text, date, date, text) to authenticated;
grant execute on function public.rpc_complete_registration(uuid) to authenticated;
grant execute on function public.rpc_reset_password_with_challenge(uuid, text) to anon;
grant execute on function public.rpc_reset_password_with_challenge(uuid, text) to authenticated;
grant execute on function public.rpc_current_profile_context() to authenticated;
