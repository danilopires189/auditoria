drop function if exists public.rpc_gestao_estoque_product_history(integer, integer);

create function public.rpc_gestao_estoque_product_history(
    p_cd integer default null,
    p_coddv integer default null
)
returns table (
    movement_group text,
    data_mov date,
    qtd_mov integer,
    tipo_movimentacao text
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
    v_coddv integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_coddv := coalesce(p_coddv, 0);
    if v_coddv <= 0 then
        raise exception 'CODDV_INVALIDO';
    end if;

    return query
    select
        case
            when upper(trim(coalesce(g.tipo_movimentacao, ''))) in ('EA', 'EO') then 'entrada'
            else 'saida'
        end as movement_group,
        g.data_mov,
        g.qtd_mov,
        upper(trim(coalesce(g.tipo_movimentacao, ''))) as tipo_movimentacao
    from app.db_gestao_estq g
    where g.cd = v_cd
      and g.coddv = v_coddv
      and g.data_mov is not null
      and upper(trim(coalesce(g.tipo_movimentacao, ''))) in ('EA', 'EO', 'SA', 'SO')
    order by g.data_mov desc, upper(trim(coalesce(g.tipo_movimentacao, ''))) asc, g.qtd_mov desc nulls last;
end;
$$;

grant execute on function public.rpc_gestao_estoque_product_history(integer, integer) to authenticated;
