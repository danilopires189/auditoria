drop function if exists public.rpc_pvps_completed_items_day(integer, date, integer, integer);

create function public.rpc_pvps_completed_items_day(
    p_cd integer default null,
    p_ref_date_brt date default ((now() at time zone 'America/Sao_Paulo')::date),
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    audit_id uuid,
    auditor_id uuid,
    cd integer,
    zona text,
    coddv integer,
    descricao text,
    end_sep text,
    status text,
    end_sit text,
    val_sep text,
    dt_hr timestamptz,
    auditor_nome text,
    pul_total integer,
    pul_auditados integer,
    pul_has_lower boolean,
    pul_lower_end text,
    pul_lower_val text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_ref_date date;
    v_offset integer;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_ref_date := coalesce(p_ref_date_brt, (now() at time zone 'America/Sao_Paulo')::date);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 1000);

    return query
    select
        ap.audit_id,
        ap.auditor_id,
        ap.cd,
        ap.zona,
        ap.coddv,
        ap.descricao,
        ap.end_sep,
        ap.status,
        ap.end_sit,
        ap.val_sep,
        ap.dt_hr,
        ap.auditor_nome,
        coalesce(ptotal.pul_total, 0) as pul_total,
        coalesce(paud.pul_auditados, 0) as pul_auditados,
        coalesce(paud.pul_has_lower, false) as pul_has_lower,
        plow.pul_lower_end,
        plow.pul_lower_val
    from app.aud_pvps ap
    left join lateral (
        select
            count(*)::integer as pul_total
        from app.db_pvps d
        where d.cd = ap.cd
          and d.coddv = ap.coddv
          and d.end_sep = ap.end_sep
    ) ptotal on true
    left join lateral (
        select
            count(*)::integer as pul_auditados,
            exists (
                select 1
                from app.aud_pvps_pul apu_low
                where apu_low.audit_id = ap.audit_id
                  and ap.val_sep is not null
                  and app.pvps_alocacao_validade_rank(apu_low.val_pul) < app.pvps_alocacao_validade_rank(ap.val_sep)
            ) as pul_has_lower
        from app.aud_pvps_pul apu
        where apu.audit_id = ap.audit_id
    ) paud on true
    left join lateral (
        select
            apu_low.end_pul as pul_lower_end,
            apu_low.val_pul as pul_lower_val
        from app.aud_pvps_pul apu_low
        where apu_low.audit_id = ap.audit_id
          and ap.val_sep is not null
          and app.pvps_alocacao_validade_rank(apu_low.val_pul) < app.pvps_alocacao_validade_rank(ap.val_sep)
        order by app.pvps_alocacao_validade_rank(apu_low.val_pul), apu_low.end_pul
        limit 1
    ) plow on true
    where ap.cd = v_cd
      and (ap.dt_hr at time zone 'America/Sao_Paulo')::date = v_ref_date
    order by ap.dt_hr desc, ap.zona, ap.end_sep, ap.coddv
    offset v_offset
    limit v_limit;
end;
$$;

grant execute on function public.rpc_pvps_completed_items_day(integer, date, integer, integer) to authenticated;
