create or replace function public.rpc_conf_inventario_sync_pull(
    p_cd integer default null,
    p_cycle_date date default null,
    p_since timestamptz default null
)
returns table (
    counts jsonb,
    reviews jsonb,
    locks jsonb,
    server_time timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_cycle_date date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    v_cycle_date := coalesce(p_cycle_date, app.conf_inventario_today());

    return query
    with counts_data as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'cycle_date', c.cycle_date,
                    'cd', c.cd,
                    'zona', c.zona,
                    'endereco', c.endereco,
                    'coddv', c.coddv,
                    'descricao', c.descricao,
                    'estoque', c.estoque,
                    'etapa', c.etapa,
                    'qtd_contada', c.qtd_contada,
                    'barras', c.barras,
                    'resultado', c.resultado,
                    'counted_by', c.counted_by,
                    'counted_mat', c.counted_mat,
                    'counted_nome', c.counted_nome,
                    'updated_at', c.updated_at
                )
                order by c.zona, c.endereco, c.coddv, c.etapa
            ),
            '[]'::jsonb
        ) as payload
        from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date
          and c.cd = v_cd
          and (p_since is null or c.updated_at >= p_since)
    ),
    reviews_data as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'cycle_date', r.cycle_date,
                    'cd', r.cd,
                    'zona', r.zona,
                    'endereco', r.endereco,
                    'coddv', r.coddv,
                    'descricao', r.descricao,
                    'estoque', r.estoque,
                    'reason_code', r.reason_code,
                    'snapshot', r.snapshot,
                    'status', r.status,
                    'final_qtd', r.final_qtd,
                    'final_barras', r.final_barras,
                    'final_resultado', r.final_resultado,
                    'resolved_by', r.resolved_by,
                    'resolved_mat', r.resolved_mat,
                    'resolved_nome', r.resolved_nome,
                    'resolved_at', r.resolved_at,
                    'updated_at', r.updated_at
                )
                order by r.zona, r.endereco, r.coddv
            ),
            '[]'::jsonb
        ) as payload
        from app.conf_inventario_reviews r
        where r.cycle_date = v_cycle_date
          and r.cd = v_cd
          and (p_since is null or r.updated_at >= p_since)
    ),
    locks_data as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'lock_id', l.lock_id,
                    'cycle_date', l.cycle_date,
                    'cd', l.cd,
                    'zona', l.zona,
                    'etapa', l.etapa,
                    'locked_by', l.locked_by,
                    'locked_mat', l.locked_mat,
                    'locked_nome', l.locked_nome,
                    'heartbeat_at', l.heartbeat_at,
                    'expires_at', l.expires_at,
                    'updated_at', l.updated_at
                )
                order by l.zona, l.etapa
            ),
            '[]'::jsonb
        ) as payload
        from app.conf_inventario_zone_locks l
        where l.cycle_date = v_cycle_date
          and l.cd = v_cd
          and l.expires_at > now()
          and (p_since is null or l.updated_at >= p_since)
    )
    select counts_data.payload, reviews_data.payload, locks_data.payload, now()
    from counts_data, reviews_data, locks_data;
end;
$$;

grant execute on function public.rpc_conf_inventario_sync_pull(integer, date, timestamptz) to authenticated;
