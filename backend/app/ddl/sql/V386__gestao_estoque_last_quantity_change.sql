drop function if exists public.rpc_gestao_estoque_list(integer, date, text);

create or replace function public.rpc_gestao_estoque_list(
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
    motivo text,
    estoque_updated_at timestamptz,
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
    last_quantity_before integer,
    last_quantity_after integer,
    last_quantity_change_at timestamptz,
    qtd_mov_dia integer,
    valor_mov_dia numeric,
    is_em_recebimento_previsto boolean
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
    ),
    recebimento_previsto as (
        select distinct
            t.coddv
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.coddv is not null
          and t.dh_consistida is not null
    ),
    latest_quantity_change as (
        select distinct on (e.item_id)
            e.item_id,
            nullif(e.before_payload ->> 'quantidade', '')::integer as last_quantity_before,
            nullif(e.after_payload ->> 'quantidade', '')::integer as last_quantity_after,
            e.event_at as last_quantity_change_at
        from app.gestao_estoque_events e
        where e.cd = v_cd
          and e.movement_date = v_date
          and e.movement_type = v_type
          and e.event_type = 'update_quantity'
          and e.item_id is not null
        order by e.item_id, e.event_at desc
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
        i.motivo,
        i.estoque_updated_at,
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
        lqc.last_quantity_before,
        lqc.last_quantity_after,
        lqc.last_quantity_change_at,
        coalesce(g.qtd_mov_dia, 0)::integer as qtd_mov_dia,
        coalesce(g.valor_mov_dia, 0)::numeric as valor_mov_dia,
        (rp.coddv is not null) as is_em_recebimento_previsto
    from app.gestao_estoque_items i
    left join gestao_aggregated g
      on g.cd = i.cd
     and g.data_mov = i.movement_date
     and g.coddv = i.coddv
    left join recebimento_previsto rp
      on rp.coddv = i.coddv
    left join latest_quantity_change lqc
      on lqc.item_id = i.id
    where i.cd = v_cd
      and i.movement_date = v_date
      and i.movement_type = v_type
    order by i.updated_at desc, i.coddv;
end;
$$;

drop function if exists public.rpc_gestao_estoque_deleted_list(integer, date, text);

create function public.rpc_gestao_estoque_deleted_list(
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
    motivo text,
    estoque_updated_at timestamptz,
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
    last_quantity_before integer,
    last_quantity_after integer,
    last_quantity_change_at timestamptz,
    qtd_mov_dia integer,
    valor_mov_dia numeric,
    is_em_recebimento_previsto boolean,
    deleted_at timestamptz,
    deleted_nome text,
    deleted_mat text
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
    ),
    recebimento_previsto as (
        select distinct
            t.coddv
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.coddv is not null
          and t.dh_consistida is not null
    ),
    latest_quantity_change as (
        select distinct on (e.item_id)
            e.item_id,
            nullif(e.before_payload ->> 'quantidade', '')::integer as last_quantity_before,
            nullif(e.after_payload ->> 'quantidade', '')::integer as last_quantity_after,
            e.event_at as last_quantity_change_at
        from app.gestao_estoque_events e
        where e.cd = v_cd
          and e.movement_date = v_date
          and e.movement_type = v_type
          and e.event_type = 'update_quantity'
          and e.item_id is not null
        order by e.item_id, e.event_at desc
    ),
    deleted_events as (
        select
            e.event_id,
            e.item_id,
            e.cd,
            e.movement_date,
            e.movement_type,
            e.coddv,
            e.actor_nome,
            e.actor_mat,
            e.event_at,
            e.before_payload
        from app.gestao_estoque_events e
        where e.cd = v_cd
          and e.movement_date = v_date
          and e.movement_type = v_type
          and e.event_type = 'delete'
          and e.before_payload is not null
    )
    select
        coalesce(d.item_id, d.event_id) as id,
        coalesce(nullif(d.before_payload ->> 'movement_date', '')::date, d.movement_date) as movement_date,
        coalesce(nullif(d.before_payload ->> 'movement_type', ''), d.movement_type) as movement_type,
        coalesce(nullif(d.before_payload ->> 'coddv', '')::integer, d.coddv) as coddv,
        nullif(d.before_payload ->> 'barras_informado', '') as barras_informado,
        greatest(coalesce(nullif(d.before_payload ->> 'quantidade', '')::integer, 0), 0) as quantidade,
        coalesce(nullif(d.before_payload ->> 'descricao', ''), format('CODDV %s', coalesce(d.before_payload ->> 'coddv', d.coddv::text))) as descricao,
        nullif(d.before_payload ->> 'endereco_sep', '') as endereco_sep,
        nullif(d.before_payload ->> 'endereco_pul', '') as endereco_pul,
        greatest(coalesce(nullif(d.before_payload ->> 'qtd_est_atual', '')::integer, 0), 0) as qtd_est_atual,
        greatest(coalesce(nullif(d.before_payload ->> 'qtd_est_disp', '')::integer, 0), 0) as qtd_est_disp,
        nullif(d.before_payload ->> 'motivo', '') as motivo,
        nullif(d.before_payload ->> 'estoque_updated_at', '')::timestamptz as estoque_updated_at,
        nullif(d.before_payload ->> 'dat_ult_compra', '')::date as dat_ult_compra,
        nullif(d.before_payload ->> 'custo_unitario', '')::numeric as custo_unitario,
        coalesce(nullif(d.before_payload ->> 'custo_total', '')::numeric, 0)::numeric as custo_total,
        coalesce(nullif(d.before_payload ->> 'created_nome', ''), 'Usuário') as created_nome,
        coalesce(nullif(d.before_payload ->> 'created_mat', ''), '-') as created_mat,
        nullif(d.before_payload ->> 'created_at', '')::timestamptz as created_at,
        coalesce(nullif(d.before_payload ->> 'updated_nome', ''), 'Usuário') as updated_nome,
        coalesce(nullif(d.before_payload ->> 'updated_mat', ''), '-') as updated_mat,
        nullif(d.before_payload ->> 'updated_at', '')::timestamptz as updated_at,
        nullif(d.before_payload ->> 'resolved_refreshed_at', '')::timestamptz as resolved_refreshed_at,
        coalesce(nullif(d.before_payload ->> 'is_frozen', '')::boolean, false) as is_frozen,
        lqc.last_quantity_before,
        lqc.last_quantity_after,
        lqc.last_quantity_change_at,
        coalesce(g.qtd_mov_dia, 0)::integer as qtd_mov_dia,
        coalesce(g.valor_mov_dia, 0)::numeric as valor_mov_dia,
        (rp.coddv is not null) as is_em_recebimento_previsto,
        d.event_at as deleted_at,
        d.actor_nome as deleted_nome,
        d.actor_mat as deleted_mat
    from deleted_events d
    left join gestao_aggregated g
      on g.cd = d.cd
     and g.data_mov = d.movement_date
     and g.coddv = d.coddv
    left join recebimento_previsto rp
      on rp.coddv = d.coddv
    left join latest_quantity_change lqc
      on lqc.item_id = d.item_id
    order by d.event_at desc, d.coddv;
end;
$$;

grant execute on function public.rpc_gestao_estoque_list(integer, date, text) to authenticated;
grant execute on function public.rpc_gestao_estoque_deleted_list(integer, date, text) to authenticated;
