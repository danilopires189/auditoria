create or replace function public.rpc_db_barras_lookup(
    p_barras text
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
      and b.barras = regexp_replace(coalesce(p_barras, ''), '\s+', '', 'g')
    order by b.updated_at desc nulls last, b.coddv
    limit 1;
$$;

grant execute on function public.rpc_db_barras_lookup(text) to authenticated;
