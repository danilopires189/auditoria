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
        v_email := lower(format('mat_%s@login.auditoria.local', v_mat));
    end if;

    return v_email;
end;
$$;

grant execute on function authz.login_email_from_mat(text) to anon;
grant execute on function authz.login_email_from_mat(text) to authenticated;
