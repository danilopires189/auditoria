create or replace function authz.normalize_mat(p_mat text)
returns text
language sql
immutable
as $$
    with raw as (
        select trim(coalesce(p_mat, '')) as value
    ),
    sanitized as (
        select case
            when value ~ '^[0-9]+([\\.,]0+)$'
                then regexp_replace(value, '^([0-9]+)([\\.,]0+)$', '\1')
            else value
        end as value
        from raw
    )
    select regexp_replace(value, '[^0-9]', '', 'g')
    from sanitized;
$$;

do $$
declare
    rec record;
begin
    for rec in
        select p.user_id, p.mat
        from authz.profiles p
    loop
        perform authz.ensure_profile_for_user(rec.user_id, rec.mat);
    end loop;
end;
$$;
