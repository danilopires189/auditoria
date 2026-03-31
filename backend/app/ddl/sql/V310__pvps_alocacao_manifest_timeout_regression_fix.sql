create or replace function public.rpc_alocacao_manifest_items_page(
    p_cd integer default null,
    p_zona text default null,
    p_offset integer default 0,
    p_limit integer default 200
)
returns table (
    queue_id uuid,
    cd integer,
    zona text,
    coddv integer,
    descricao text,
    endereco text,
    nivel text,
    val_sist text,
    dat_ult_compra date,
    qtd_est_disp integer,
    priority_score integer,
    is_window_active boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zona text;
    v_offset integer;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_zona := upper(nullif(trim(coalesce(p_zona, '')), ''));
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 200), 1), 1000);

    perform app.pvps_alocacao_replenish_if_needed(
        p_cd => v_cd,
        p_modulo => 'alocacao',
        p_force => false,
        p_min_pending => 80,
        p_cooldown_seconds => 120
    );

    return query
    with eligible_rows as (
        select
            d.queue_id,
            d.cd,
            d.zona,
            d.coddv,
            d.descricao,
            d.endereco,
            d.nivel,
            d.val_sist,
            d.dat_ult_compra,
            d.qtd_est_disp,
            app.pvps_admin_priority_score(v_cd, 'alocacao', d.zona, d.coddv, d.queue_id::text) as priority_score,
            d.is_window_active
        from app.db_alocacao d
        where d.cd = v_cd
          and d.is_pending
          and (v_zona is null or d.zona = v_zona)
          and not app.pvps_admin_is_item_blacklisted(v_cd, 'alocacao', d.zona, d.coddv, d.queue_id::text)
    ),
    page_base as (
        select
            e.queue_id,
            e.cd,
            e.zona,
            e.coddv,
            e.descricao,
            e.endereco,
            e.nivel,
            e.val_sist,
            e.dat_ult_compra,
            e.qtd_est_disp,
            e.priority_score,
            e.is_window_active
        from eligible_rows e
        order by
            e.is_window_active desc,
            e.priority_score asc,
            e.dat_ult_compra desc,
            e.zona,
            e.endereco,
            e.coddv
        offset v_offset
        limit v_limit
    )
    select
        b.queue_id,
        b.cd,
        b.zona,
        b.coddv,
        b.descricao,
        b.endereco,
        b.nivel,
        coalesce(curr.val_sist, b.val_sist) as val_sist,
        b.dat_ult_compra,
        b.qtd_est_disp,
        b.priority_score,
        b.is_window_active
    from page_base b
    left join lateral (
        select app.pvps_alocacao_normalize_validade(e.validade) as val_sist
        from app.db_end e
        where e.cd = b.cd
          and e.coddv = b.coddv
          and upper(trim(coalesce(e.tipo, ''))) = 'PUL'
          and upper(trim(coalesce(e.endereco, ''))) = b.endereco
          and nullif(trim(coalesce(e.validade, '')), '') is not null
        order by
            app.pvps_alocacao_validade_rank(app.pvps_alocacao_normalize_validade(e.validade)),
            app.pvps_alocacao_normalize_validade(e.validade),
            e.updated_at desc nulls last
        limit 1
    ) curr on true
    order by
        b.is_window_active desc,
        b.priority_score asc,
        b.dat_ult_compra desc,
        b.zona,
        b.endereco,
        b.coddv;
end;
$$;

grant execute on function public.rpc_alocacao_manifest_items_page(integer, text, integer, integer) to authenticated;
