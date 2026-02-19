-- Global login support with mandatory CD selection in frontend.

create table if not exists authz.global_login_accounts (
    login_email text primary key,
    mat text null,
    nome text null,
    active boolean not null default true,
    created_at timestamptz not null default now()
);

comment on table authz.global_login_accounts is
    'Allowed login emails for global admin access (cross-CD with runtime CD selection).';

comment on column authz.global_login_accounts.login_email is
    'Exact email used on Supabase Auth sign-in.';

comment on column authz.global_login_accounts.mat is
    'Optional matrícula to persist on authz.profiles for this global account.';

comment on column authz.global_login_accounts.nome is
    'Optional display name to persist on authz.profiles for this global account.';

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
    v_global authz.global_login_accounts%rowtype;
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

    select *
    into v_global
    from authz.global_login_accounts g
    where lower(trim(g.login_email)) = v_email
      and g.active = true
    limit 1;

    if v_global.login_email is not null then
        v_mat := authz.normalize_mat(v_global.mat);
        if v_mat = '' then
            v_mat := authz.normalize_mat(p_mat);
        end if;
        if v_mat = '' then
            v_mat := '1';
        end if;

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
            coalesce(nullif(trim(v_global.nome), ''), 'admin global'),
            v_mat,
            'admin',
            null,
            now()
        )
        on conflict (user_id)
        do update set
            nome = excluded.nome,
            mat = excluded.mat,
            role = 'admin',
            cd_default = null;

        delete from authz.user_deposits
        where user_id = p_user_id;

        insert into authz.user_deposits (user_id, cd, created_at)
        select p_user_id, cds.cd, now()
        from (
            select distinct u.cd
            from app.db_usuario u
            where u.cd is not null
        ) cds
        on conflict (user_id, cd) do nothing;

        return true;
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

create or replace function public.rpc_list_available_cds()
returns table (
    cd integer,
    cd_nome text
)
language plpgsql
stable
security definer
set search_path = authz, app, public
as $$
declare
    v_uid uuid;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    return query
    with allowed as (
        select distinct ud.cd
        from authz.user_deposits ud
        where ud.user_id = v_uid
        union
        select v_profile.cd_default
        where v_profile.cd_default is not null
    ),
    names as (
        select
            u.cd,
            min(nullif(trim(u.cd_nome), '')) as cd_nome
        from app.db_usuario u
        where u.cd is not null
        group by u.cd
    )
    select
        a.cd,
        coalesce(n.cd_nome, format('CD %s', a.cd)) as cd_nome
    from allowed a
    left join names n on n.cd = a.cd
    where a.cd is not null
    order by a.cd;
end;
$$;

grant execute on function public.rpc_list_available_cds() to authenticated;

