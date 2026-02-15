create or replace function public.rpc_db_barras_meta()
returns table (
    row_count bigint,
    updated_max timestamptz
)
language sql
stable
security invoker
set search_path = app, authz, public
as $$
    select
        count(*)::bigint as row_count,
        max(b.updated_at) as updated_max
    from app.db_barras b
    where authz.session_is_recent(6)
      and authz.can_read_global_dim(auth.uid());
$$;

create or replace function public.rpc_db_barras_delta_count(
    p_updated_after timestamptz
)
returns table (
    row_count bigint
)
language sql
stable
security invoker
set search_path = app, authz, public
as $$
    select
        count(*)::bigint as row_count
    from app.db_barras b
    where authz.session_is_recent(6)
      and authz.can_read_global_dim(auth.uid())
      and (
          p_updated_after is null
          or b.updated_at > p_updated_after
      );
$$;

grant execute on function public.rpc_db_barras_meta() to authenticated;
grant execute on function public.rpc_db_barras_delta_count(timestamptz) to authenticated;
