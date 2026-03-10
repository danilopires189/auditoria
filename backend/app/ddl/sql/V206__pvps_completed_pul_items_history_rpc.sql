drop function if exists public.rpc_pvps_completed_pul_items(integer, uuid);

create or replace function public.rpc_pvps_completed_items_day(
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
        greatest(coalesce(ptotal.pul_total_db, 0), coalesce(paud.pul_auditados, 0)) as pul_total,
        coalesce(paud.pul_auditados, 0) as pul_auditados,
        coalesce(paud.pul_has_lower, false) as pul_has_lower,
        plow.pul_lower_end,
        plow.pul_lower_val
    from app.aud_pvps ap
    left join lateral (
        select count(*)::integer as pul_total_db
        from app.db_pvps d
        where d.cd = ap.cd
          and d.coddv = ap.coddv
          and upper(trim(coalesce(d.end_sep, ''))) = upper(trim(coalesce(ap.end_sep, '')))
    ) ptotal on true
    left join lateral (
        select
            count(*)::integer as pul_auditados,
            exists (
                select 1
                from app.aud_pvps_pul apu_low
                where apu_low.audit_id = ap.audit_id
                  and apu_low.val_pul is not null
                  and ap.val_sep is not null
                  and app.pvps_alocacao_validade_rank(apu_low.val_pul) < app.pvps_alocacao_validade_rank(ap.val_sep)
            ) as pul_has_lower
        from app.aud_pvps_pul apu
        where apu.audit_id = ap.audit_id
    ) paud on true
    left join lateral (
        select
            upper(trim(coalesce(apu_low.end_pul, ''))) as pul_lower_end,
            apu_low.val_pul as pul_lower_val
        from app.aud_pvps_pul apu_low
        where apu_low.audit_id = ap.audit_id
          and apu_low.val_pul is not null
          and ap.val_sep is not null
          and app.pvps_alocacao_validade_rank(apu_low.val_pul) < app.pvps_alocacao_validade_rank(ap.val_sep)
        order by app.pvps_alocacao_validade_rank(apu_low.val_pul), upper(trim(coalesce(apu_low.end_pul, '')))
        limit 1
    ) plow on true
    where ap.cd = v_cd
      and (ap.dt_hr at time zone 'America/Sao_Paulo')::date = v_ref_date
    order by ap.dt_hr desc, ap.zona, ap.end_sep, ap.coddv
    offset v_offset
    limit v_limit;
end;
$$;

create function public.rpc_pvps_completed_pul_items(
    p_cd integer default null,
    p_audit_id uuid default null
)
returns table (
    end_pul text,
    nivel text,
    val_pul text,
    end_sit text,
    auditado boolean,
    dt_hr timestamptz,
    auditor_nome text,
    is_lower boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_row app.aud_pvps%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_audit_id is null then raise exception 'AUDIT_ID_OBRIGATORIO'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);

    select *
    into v_row
    from app.aud_pvps ap
    where ap.audit_id = p_audit_id;

    if v_row.audit_id is null then
        raise exception 'AUDITORIA_PVPS_NAO_ENCONTRADA';
    end if;
    if v_row.cd <> v_cd then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    select
        upper(trim(coalesce(apu.end_pul, ''))) as end_pul,
        pul.nivel,
        apu.val_pul,
        apu.end_sit,
        true as auditado,
        apu.dt_hr,
        coalesce(nullif(trim(coalesce(v_row.auditor_nome, '')), ''), 'USUARIO') as auditor_nome,
        (
            v_row.val_sep is not null
            and apu.val_pul is not null
            and app.pvps_alocacao_validade_rank(apu.val_pul) < app.pvps_alocacao_validade_rank(v_row.val_sep)
        ) as is_lower
    from app.aud_pvps_pul apu
    left join lateral (
        select
            nullif(trim(coalesce(e.andar, '')), '') as nivel
        from app.db_end e
        where e.cd = v_row.cd
          and e.coddv = v_row.coddv
          and upper(trim(coalesce(e.tipo, ''))) = 'PUL'
          and upper(trim(coalesce(e.endereco, ''))) = upper(trim(coalesce(apu.end_pul, '')))
        order by
            case when nullif(trim(coalesce(e.andar, '')), '') is null then 1 else 0 end,
            nullif(trim(coalesce(e.andar, '')), '')
        limit 1
    ) pul on true
    where apu.audit_id = v_row.audit_id
    order by upper(trim(coalesce(apu.end_pul, '')));
end;
$$;

grant execute on function public.rpc_pvps_completed_items_day(integer, date, integer, integer) to authenticated;
grant execute on function public.rpc_pvps_completed_pul_items(integer, uuid) to authenticated;
