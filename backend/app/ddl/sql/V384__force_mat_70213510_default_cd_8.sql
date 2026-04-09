-- Force MAT 70213510 to use CD 8 as the default context instead of the source DB value.

create or replace function authz.override_cd_default_for_mat(
    p_mat text,
    p_cd integer default null
)
returns integer
language sql
immutable
set search_path = authz, public
as $$
    select case
        when authz.normalize_mat(p_mat) = '70213510' then 8
        else p_cd
    end;
$$;

create or replace function authz.start_identity_challenge(
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
language plpgsql
security definer
set search_path = authz, app, public
as $$
declare
    v_mat text;
    v_nome text;
    v_cargo text;
    v_cd_default integer;
    v_cds_all integer[];
    v_cds integer[];
    v_role text;
    v_challenge_id uuid;
    v_expires_at timestamptz;
begin
    v_mat := authz.normalize_mat(p_mat);

    if v_mat = '' then
        raise exception 'MATRICULA_INVALIDA';
    end if;

    if p_purpose not in ('register', 'reset_password') then
        raise exception 'PURPOSE_INVALIDO';
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
        v_cds_all
    from app.db_usuario u
    where authz.normalize_mat(u.mat) = v_mat
      and u.dt_nasc = p_dt_nasc
      and u.dt_adm = p_dt_adm;

    if v_nome is null then
        raise exception 'MATRICULA_OU_DATAS_INVALIDAS';
    end if;

    if coalesce(array_length(v_cds_all, 1), 0) > 1 then
        raise exception 'MATRICULA_MULTIPLOS_CDS';
    end if;

    if p_purpose = 'register' and exists (
        select 1
        from authz.profiles p
        where authz.normalize_mat(p.mat) = v_mat
    ) then
        raise exception 'MATRICULA_JA_CADASTRADA';
    end if;

    if p_purpose = 'reset_password' and not exists (
        select 1
        from authz.profiles p
        where authz.normalize_mat(p.mat) = v_mat
    ) then
        raise exception 'USUARIO_NAO_CADASTRADO';
    end if;

    v_role := authz.role_from_cargo(v_cargo);
    v_cd_default := authz.override_cd_default_for_mat(v_mat, v_cd_default);
    v_cds := case
        when v_cd_default is null then '{}'::integer[]
        else array[v_cd_default]
    end;

    insert into authz.identity_challenges (
        purpose,
        mat,
        dt_nasc,
        dt_adm,
        nome,
        cargo,
        role_suggested,
        cd_default,
        cds,
        created_by
    )
    values (
        p_purpose,
        v_mat,
        p_dt_nasc,
        p_dt_adm,
        v_nome,
        v_cargo,
        v_role,
        v_cd_default,
        coalesce(v_cds, '{}'),
        auth.uid()
    )
    returning
        authz.identity_challenges.challenge_id,
        authz.identity_challenges.expires_at
    into
        v_challenge_id,
        v_expires_at;

    return query
    select
        v_challenge_id,
        v_nome,
        v_cargo,
        v_role,
        v_cd_default,
        coalesce(v_cds, '{}'),
        v_expires_at;
end;
$$;

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

        insert into authz.user_deposits (user_id, cd, created_at)
        select
            p_user_id,
            cds.cd,
            now()
        from (
            select distinct u.cd
            from app.db_usuario u
            where u.cd is not null
        ) cds
        on conflict (user_id, cd) do nothing;

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

    if authz.is_global_admin_exception(v_mat) then
        v_role := 'admin';
        v_cd_default := null;

        select array_agg(distinct u.cd order by u.cd)
        into v_cds
        from app.db_usuario u
        where u.cd is not null;
    else
        if v_mat = '126719' then
            v_cd_default := 10;
            v_cds := array[10, 11];
        elsif coalesce(array_length(v_cds, 1), 0) > 0 and (10 = any(v_cds) or 11 = any(v_cds)) then
            select array_agg(distinct cd_item order by cd_item)
            into v_cds
            from unnest(array_cat(v_cds, array[10, 11])) as cd_item;
        end if;

        v_cd_default := authz.override_cd_default_for_mat(v_mat, v_cd_default);

        if v_cd_default is not null and not (v_cd_default = any(coalesce(v_cds, '{}'::integer[]))) then
            if coalesce(array_length(v_cds, 1), 0) = 0 then
                v_cds := array[v_cd_default];
            else
                select array_agg(distinct cd_item order by cd_item)
                into v_cds
                from unnest(array_cat(v_cds, array[v_cd_default])) as cd_item;
            end if;
        end if;

        v_role := authz.role_from_mat_and_cargo(v_mat, v_cargo);
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

create or replace function authz.current_profile_context()
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
            case
                when p.role = 'admin' and p.cd_default is null then null
                else authz.override_cd_default_for_mat(
                    p.mat,
                    coalesce(
                        p.cd_default,
                        (
                            select min(ud.cd)
                            from authz.user_deposits ud
                            where ud.user_id = p.user_id
                        )
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
        end as cd_nome,
        pb.home_menu_view
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
            case
                when p.role = 'admin' and p.cd_default is null then null
                else authz.override_cd_default_for_mat(
                    p.mat,
                    coalesce(
                        p.cd_default,
                        (
                            select min(ud.cd)
                            from authz.user_deposits ud
                            where ud.user_id = p.user_id
                        )
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
        end as cd_nome,
        pb.home_menu_view
    from profile_base pb
    limit 1;
end;
$$;

do $$
begin
    update authz.profiles p
    set cd_default = 8
    where authz.normalize_mat(p.mat) = '70213510';

    insert into authz.user_deposits (user_id, cd, created_at)
    select distinct
        p.user_id,
        8,
        now()
    from authz.profiles p
    where authz.normalize_mat(p.mat) = '70213510'
      and p.user_id is not null
    on conflict (user_id, cd) do nothing;

    update authz.identity_challenges c
    set
        cd_default = 8,
        cds = array[8]
    where authz.normalize_mat(c.mat) = '70213510'
      and c.consumed_at is null;

    perform authz.ensure_profile_from_mat('70213510');
end
$$;
