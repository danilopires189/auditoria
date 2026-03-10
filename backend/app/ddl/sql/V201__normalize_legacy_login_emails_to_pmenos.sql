do $$
begin
    with profile_target as (
        select
            p.user_id,
            authz.normalize_mat(p.mat) as mat_norm,
            lower(format('%s@pmenos.com.br', authz.normalize_mat(p.mat))) as new_email
        from authz.profiles p
        join auth.users u
          on u.id = p.user_id
        where u.deleted_at is null
          and authz.normalize_mat(p.mat) <> ''
          and lower(coalesce(u.email, '')) <> lower(format('%s@pmenos.com.br', authz.normalize_mat(p.mat)))
          and not exists (
              select 1
              from auth.users u2
              where u2.id <> p.user_id
                and lower(coalesce(u2.email, '')) = lower(format('%s@pmenos.com.br', authz.normalize_mat(p.mat)))
          )
    )
    update auth.users u
    set
        email = pt.new_email,
        email_change = '',
        updated_at = now(),
        raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
            || jsonb_build_object('email', pt.new_email, 'email_verified', true)
    from profile_target pt
    where u.id = pt.user_id;

    with profile_target as (
        select
            p.user_id,
            authz.normalize_mat(p.mat) as mat_norm,
            lower(format('%s@pmenos.com.br', authz.normalize_mat(p.mat))) as new_email
        from authz.profiles p
        join auth.users u
          on u.id = p.user_id
        where u.deleted_at is null
          and authz.normalize_mat(p.mat) <> ''
          and lower(coalesce(u.email, '')) = lower(format('%s@pmenos.com.br', authz.normalize_mat(p.mat)))
    )
    update auth.identities i
    set
        identity_data = coalesce(i.identity_data, '{}'::jsonb)
            || jsonb_build_object('email', pt.new_email, 'email_verified', true),
        updated_at = now()
    from profile_target pt
    where i.user_id = pt.user_id
      and i.provider = 'email';

    update authz.global_login_accounts g
    set login_email = lower(format('%s@pmenos.com.br', authz.normalize_mat(g.mat)))
    where authz.normalize_mat(g.mat) <> ''
      and lower(coalesce(g.login_email, '')) <> lower(format('%s@pmenos.com.br', authz.normalize_mat(g.mat)))
      and not exists (
          select 1
          from authz.global_login_accounts g2
          where lower(coalesce(g2.login_email, '')) = lower(format('%s@pmenos.com.br', authz.normalize_mat(g.mat)))
      );
end
$$;
