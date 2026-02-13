create or replace function authz.login_email_from_mat(p_mat text)
returns text
language sql
immutable
as $$
    select format('mat_%s@login.auditoria.local', authz.normalize_mat(p_mat));
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
        encrypted_password = crypt(p_new_password, gen_salt('bf')),
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

grant execute on function authz.login_email_from_mat(text) to anon;
grant execute on function authz.login_email_from_mat(text) to authenticated;
grant execute on function authz.reset_password_with_challenge(uuid, text) to anon;
grant execute on function authz.reset_password_with_challenge(uuid, text) to authenticated;

