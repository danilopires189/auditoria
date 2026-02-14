create or replace function authz.login_email_from_mat(p_mat text)
returns text
language plpgsql
stable
security definer
set search_path = authz, auth, public
as $$
declare
    v_mat text;
    v_email text;
begin
    v_mat := authz.normalize_mat(p_mat);

    if v_mat = '' then
        raise exception 'MATRICULA_INVALIDA';
    end if;

    select lower(nullif(trim(u.email), ''))
    into v_email
    from authz.profiles p
    join auth.users u
      on u.id = p.user_id
    where authz.normalize_mat(p.mat) = v_mat
      and u.deleted_at is null
      and nullif(trim(u.email), '') is not null
    order by u.updated_at desc nulls last, u.created_at desc nulls last
    limit 1;

    if v_email is null then
        v_email := lower(format('%s@pmenos.com.br', v_mat));
    end if;

    return v_email;
end;
$$;

do $$
begin
    with profile_target as (
        select
            p.user_id,
            authz.normalize_mat(p.mat) as mat_norm,
            lower(format('%s@pmenos.com.br', authz.normalize_mat(p.mat))) as new_email
        from authz.profiles p
        where authz.normalize_mat(p.mat) <> ''
    )
    update auth.users u
    set
        email = pt.new_email,
        updated_at = now(),
        raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email', pt.new_email)
    from profile_target pt
    where u.id = pt.user_id
      and lower(coalesce(u.email, '')) = lower(format('mat_%s@login.auditoria.local', pt.mat_norm));

    with profile_target as (
        select
            p.user_id,
            authz.normalize_mat(p.mat) as mat_norm,
            lower(format('%s@pmenos.com.br', authz.normalize_mat(p.mat))) as new_email
        from authz.profiles p
        where authz.normalize_mat(p.mat) <> ''
    )
    update auth.identities i
    set
        provider_id = pt.new_email,
        identity_data = coalesce(i.identity_data, '{}'::jsonb)
            || jsonb_build_object('email', pt.new_email, 'email_verified', true),
        updated_at = now()
    from profile_target pt
    where i.user_id = pt.user_id
      and i.provider = 'email'
      and lower(coalesce(i.provider_id, '')) = lower(format('mat_%s@login.auditoria.local', pt.mat_norm));
end
$$;

grant execute on function authz.login_email_from_mat(text) to anon;
grant execute on function authz.login_email_from_mat(text) to authenticated;
