drop function if exists public.rpc_gestao_estoque_list(integer, date, text);

create function public.rpc_gestao_estoque_list(
    p_cd integer default null,
    p_date date default null,
    p_type text default 'baixa'
)
returns table (
    id uuid,
    movement_date date,
    movement_type text,
    coddv integer,
    barras_informado text,
    quantidade integer,
    descricao text,
    endereco_sep text,
    endereco_pul text,
    qtd_est_atual integer,
    qtd_est_disp integer,
    dat_ult_compra date,
    custo_unitario numeric,
    custo_total numeric,
    created_nome text,
    created_mat text,
    created_at timestamptz,
    updated_nome text,
    updated_mat text,
    updated_at timestamptz,
    resolved_refreshed_at timestamptz,
    is_frozen boolean,
    qtd_mov_dia integer,
    valor_mov_dia numeric
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_date date;
    v_type text;
    v_today date;
    v_type_codes text[];
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_today := app.gestao_estoque_today_brasilia();
    v_date := coalesce(p_date, v_today);
    v_type := app.gestao_estoque_normalize_type(p_type);
    v_type_codes := case
        when v_type = 'entrada' then array['EA', 'EO']
        else array['SA', 'SO']
    end;

    perform app.gestao_estoque_freeze_past_items(v_cd);
    if v_date = v_today then
        perform app.gestao_estoque_refresh_current_items(v_cd, v_type);
    end if;

    return query
    with gestao_aggregated as (
        select
            g.cd,
            g.data_mov,
            g.coddv,
            sum(greatest(coalesce(nullif(g.qtd_mov, 0), 1), 1))::integer as qtd_mov_dia,
            coalesce(sum(abs(coalesce(g.valor_mov, 0))), 0)::numeric as valor_mov_dia
        from app.db_gestao_estq g
        where g.cd = v_cd
          and g.data_mov = v_date
          and upper(trim(coalesce(g.tipo_movimentacao, ''))) = any(v_type_codes)
        group by g.cd, g.data_mov, g.coddv
    )
    select
        i.id,
        i.movement_date,
        i.movement_type,
        i.coddv,
        i.barras_informado,
        i.quantidade,
        i.descricao,
        i.endereco_sep,
        i.endereco_pul,
        i.qtd_est_atual,
        i.qtd_est_disp,
        i.dat_ult_compra,
        i.custo_unitario,
        i.custo_total,
        i.created_nome,
        i.created_mat,
        i.created_at,
        i.updated_nome,
        i.updated_mat,
        i.updated_at,
        i.resolved_refreshed_at,
        i.is_frozen,
        coalesce(g.qtd_mov_dia, 0)::integer as qtd_mov_dia,
        coalesce(g.valor_mov_dia, 0)::numeric as valor_mov_dia
    from app.gestao_estoque_items i
    left join gestao_aggregated g
      on g.cd = i.cd
     and g.data_mov = i.movement_date
     and g.coddv = i.coddv
    where i.cd = v_cd
      and i.movement_date = v_date
      and i.movement_type = v_type
    order by i.updated_at desc, i.coddv;
end;
$$;

grant execute on function public.rpc_gestao_estoque_list(integer, date, text) to authenticated;
