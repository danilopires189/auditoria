create or replace function public.rpc_has_profile_by_mat(p_mat text)
returns boolean
language sql
stable
security definer
set search_path = authz, public
as $$
    select exists (
        select 1
        from authz.profiles p
        where authz.normalize_mat(p.mat) = authz.normalize_mat(p_mat)
    );
$$;

grant execute on function public.rpc_has_profile_by_mat(text) to anon;
grant execute on function public.rpc_has_profile_by_mat(text) to authenticated;
