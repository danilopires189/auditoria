create or replace function public.rpc_gestao_estoque_stock_updated_at(
    p_cd integer default null
)
returns table (
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);

    return query
    select e.updated_at
    from app.db_estq_entr e
    where e.cd = v_cd
    order by e.updated_at desc nulls last, e.coddv
    limit 1;
end;
$$;

grant execute on function public.rpc_gestao_estoque_stock_updated_at(integer) to authenticated;
