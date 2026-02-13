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

create or replace function authz.ensure_default_admin(
    p_mat text default '1',
    p_nome text default 'admin',
    p_password text default 'admin'
)
returns uuid
language plpgsql
security definer
set search_path = authz, auth, public
as $$
declare
    v_mat text;
    v_email text;
    v_user_id uuid;
begin
    v_mat := authz.normalize_mat(p_mat);
    if v_mat = '' then
        raise exception 'MATRICULA_INVALIDA';
    end if;

    v_email := authz.login_email_from_mat(v_mat);

    select p.user_id
    into v_user_id
    from authz.profiles p
    where authz.normalize_mat(p.mat) = v_mat
    limit 1;

    if v_user_id is null then
        select u.id
        into v_user_id
        from auth.users u
        where lower(coalesce(u.email, '')) = lower(v_email)
        limit 1;
    end if;

    if v_user_id is null then
        v_user_id := gen_random_uuid();

        insert into auth.users (
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            created_at,
            updated_at,
            raw_app_meta_data,
            raw_user_meta_data,
            is_sso_user,
            is_anonymous
        )
        values (
            v_user_id,
            'authenticated',
            'authenticated',
            v_email,
            extensions.crypt(p_password, extensions.gen_salt('bf')),
            now(),
            now(),
            now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('nome', p_nome, 'mat', v_mat),
            false,
            false
        );
    else
        update auth.users
        set
            email = v_email,
            encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
            email_confirmed_at = coalesce(email_confirmed_at, now()),
            raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                || '{"provider":"email","providers":["email"]}'::jsonb,
            raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                || jsonb_build_object('nome', p_nome, 'mat', v_mat),
            is_sso_user = false,
            is_anonymous = false,
            deleted_at = null,
            updated_at = now()
        where id = v_user_id;
    end if;

    insert into auth.identities (
        id,
        provider_id,
        user_id,
        identity_data,
        provider,
        created_at,
        updated_at,
        last_sign_in_at
    )
    values (
        gen_random_uuid(),
        v_email,
        v_user_id,
        jsonb_build_object(
            'sub', v_user_id::text,
            'email', v_email,
            'email_verified', true,
            'phone_verified', false
        ),
        'email',
        now(),
        now(),
        now()
    )
    on conflict (provider_id, provider)
    do update set
        user_id = excluded.user_id,
        identity_data = excluded.identity_data,
        updated_at = excluded.updated_at;

    insert into authz.profiles (
        user_id,
        nome,
        mat,
        role,
        cd_default,
        created_at
    )
    values (
        v_user_id,
        p_nome,
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

    return v_user_id;
end;
$$;

do $$
begin
    perform authz.ensure_default_admin('1', 'admin', 'admin');
end
$$;

create or replace function authz.reset_password_with_challenge(
    p_challenge_id uuid,
    p_new_password text
)
returns boolean
language plpgsql
security definer
set search_path = authz, auth, public
as $$
declare
    v_challenge authz.identity_challenges%rowtype;
    v_user_id uuid;
begin
    if coalesce(length(p_new_password), 0) < 8 then
        raise exception 'SENHA_FRACA_MIN_8';
    end if;

    if p_new_password !~ '[A-Za-z]' or p_new_password !~ '[0-9]' then
        raise exception 'SENHA_DEVE_TER_LETRAS_E_NUMEROS';
    end if;

    select *
    into v_challenge
    from authz.identity_challenges c
    where c.challenge_id = p_challenge_id
      and c.purpose = 'reset_password'
    for update;

    if not found then
        raise exception 'CHALLENGE_INVALIDO';
    end if;

    if v_challenge.consumed_at is not null then
        raise exception 'CHALLENGE_JA_CONSUMIDO';
    end if;

    if v_challenge.expires_at < now() then
        raise exception 'CHALLENGE_EXPIRADO';
    end if;

    select p.user_id
    into v_user_id
    from authz.profiles p
    where authz.normalize_mat(p.mat) = authz.normalize_mat(v_challenge.mat)
    limit 1;

    if v_user_id is null then
        raise exception 'USUARIO_NAO_CADASTRADO';
    end if;

    if not exists (
        select 1
        from auth.users u
        where u.id = v_user_id
    ) then
        raise exception 'USUARIO_AUTH_NAO_ENCONTRADO';
    end if;

    update auth.users
    set
        encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
        updated_at = now()
    where id = v_user_id;

    delete from auth.sessions
    where user_id = v_user_id;

    update authz.identity_challenges
    set consumed_at = now()
    where challenge_id = p_challenge_id;

    return true;
end;
$$;
