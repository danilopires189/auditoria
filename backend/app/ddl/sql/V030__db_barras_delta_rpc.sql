create or replace function public.rpc_db_barras_delta(
    p_updated_after timestamptz,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    barras text,
    coddv integer,
    descricao text,
    updated_at timestamptz
)
language sql
stable
security invoker
set search_path = app, authz, public
as $$
    select
        b.barras,
        b.coddv,
        b.descricao,
        b.updated_at
    from app.db_barras b
    where authz.session_is_recent(6)
      and authz.can_read_global_dim(auth.uid())
      and (
          p_updated_after is null
          or b.updated_at > p_updated_after
      )
    order by b.updated_at nulls last, b.barras
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 1000), 1), 2000);
$$;

grant execute on function public.rpc_db_barras_delta(timestamptz, integer, integer) to authenticated;
