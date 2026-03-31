create or replace function public.rpc_pvps_manifest_items_page(
    p_cd integer default null,
    p_zona text default null,
    p_offset integer default 0,
    p_limit integer default 100
)
returns table (
    cd integer,
    zona text,
    coddv integer,
    descricao text,
    end_sep text,
    pul_total integer,
    pul_auditados integer,
    status text,
    end_sit text,
    val_sep text,
    audit_id uuid,
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
    v_limit := least(greatest(coalesce(p_limit, 100), 1), 1000);

    perform app.pvps_alocacao_replenish_if_needed(
        p_cd => v_cd,
        p_modulo => 'pvps',
        p_force => false,
        p_min_pending => 80,
        p_cooldown_seconds => 120
    );

    return query
    with base as (
        select
            d.cd,
            d.zona,
            d.coddv,
            max(d.descricao) as descricao,
            d.end_sep,
            max(d.dat_ult_compra) as dat_ult_compra,
            max(d.qtd_est_disp) as qtd_est_disp,
            count(*)::integer as pul_total,
            min(app.pvps_admin_priority_score(
                v_cd,
                'pvps',
                d.zona,
                d.coddv,
                d.coddv::text || '|' || d.end_sep
            ))::integer as priority_score,
            bool_or(d.is_window_active) as is_window_active
        from app.db_pvps d
        where d.cd = v_cd
          and d.is_pending
          and (v_zona is null or d.zona = v_zona)
          and not app.pvps_admin_is_item_blacklisted(
            v_cd,
            'pvps',
            d.zona,
            d.coddv,
            d.coddv::text || '|' || d.end_sep
          )
        group by d.cd, d.zona, d.coddv, d.end_sep
    ),
    page_base as (
        select
            b.cd,
            b.zona,
            b.coddv,
            b.descricao,
            b.end_sep,
            b.pul_total,
            b.dat_ult_compra,
            b.qtd_est_disp,
            b.priority_score,
            b.is_window_active
        from base b
        order by
            b.is_window_active desc,
            b.priority_score asc,
            b.dat_ult_compra desc,
            b.zona,
            b.end_sep,
            b.coddv
        offset v_offset
        limit v_limit
    ),
    pul_done as (
        select
            pb.cd,
            pb.coddv,
            pb.end_sep,
            count(apu.audit_pul_id)::integer as pul_auditados
        from page_base pb
        join app.aud_pvps ap
          on ap.cd = pb.cd
         and ap.coddv = pb.coddv
         and ap.end_sep = pb.end_sep
        join app.aud_pvps_pul apu
          on apu.audit_id = ap.audit_id
        group by pb.cd, pb.coddv, pb.end_sep
    )
    select
        pb.cd,
        pb.zona,
        pb.coddv,
        pb.descricao,
        pb.end_sep,
        pb.pul_total,
        coalesce(pd.pul_auditados, 0) as pul_auditados,
        coalesce(ap.status, 'pendente_sep') as status,
        ap.end_sit,
        ap.val_sep,
        ap.audit_id,
        pb.dat_ult_compra,
        pb.qtd_est_disp,
        pb.priority_score,
        pb.is_window_active
    from page_base pb
    left join app.aud_pvps ap
      on ap.cd = pb.cd
     and ap.coddv = pb.coddv
     and ap.end_sep = pb.end_sep
    left join pul_done pd
      on pd.cd = pb.cd
     and pd.coddv = pb.coddv
     and pd.end_sep = pb.end_sep
    order by
        pb.is_window_active desc,
        pb.priority_score asc,
        pb.dat_ult_compra desc,
        pb.zona,
        pb.end_sep,
        pb.coddv;
end;
$$;

grant execute on function public.rpc_pvps_manifest_items_page(integer, text, integer, integer) to authenticated;
