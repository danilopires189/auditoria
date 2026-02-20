create or replace function public.rpc_pvps_completed_items_day(
    p_cd integer default null,
    p_ref_date_brt date default ((now() at time zone 'America/Sao_Paulo')::date),
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    audit_id uuid,
    cd integer,
    zona text,
    coddv integer,
    descricao text,
    end_sep text,
    status text,
    end_sit text,
    val_sep text,
    dt_hr timestamptz,
    auditor_nome text
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
        ap.cd,
        ap.zona,
        ap.coddv,
        ap.descricao,
        ap.end_sep,
        ap.status,
        ap.end_sit,
        ap.val_sep,
        ap.dt_hr,
        ap.auditor_nome
    from app.aud_pvps ap
    where ap.cd = v_cd
      and (ap.dt_hr at time zone 'America/Sao_Paulo')::date = v_ref_date
    order by ap.dt_hr desc, ap.zona, ap.end_sep, ap.coddv
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_alocacao_completed_items_day(
    p_cd integer default null,
    p_ref_date_brt date default ((now() at time zone 'America/Sao_Paulo')::date),
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    audit_id uuid,
    queue_id uuid,
    cd integer,
    zona text,
    coddv integer,
    descricao text,
    endereco text,
    nivel text,
    end_sit text,
    val_sist text,
    val_conf text,
    aud_sit text,
    dt_hr timestamptz,
    auditor_nome text
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
        aa.audit_id,
        aa.queue_id,
        aa.cd,
        aa.zona,
        aa.coddv,
        aa.descricao,
        aa.endereco,
        aa.nivel,
        aa.end_sit,
        aa.val_sist,
        aa.val_conf,
        aa.aud_sit,
        aa.dt_hr,
        aa.auditor_nome
    from app.aud_alocacao aa
    where aa.cd = v_cd
      and (aa.dt_hr at time zone 'America/Sao_Paulo')::date = v_ref_date
    order by aa.dt_hr desc, aa.zona, aa.endereco, aa.coddv
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_pvps_submit_pul(
    p_cd integer default null,
    p_audit_id uuid default null,
    p_end_pul text default null,
    p_val_pul text default null
)
returns table (
    audit_id uuid,
    status text,
    pul_total integer,
    pul_auditados integer,
    conforme boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_aud_cd integer;
begin
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_audit_id is null then raise exception 'AUDIT_ID_OBRIGATORIO'; end if;

    select ap.cd into v_aud_cd
    from app.aud_pvps ap
    where ap.audit_id = p_audit_id;

    if v_aud_cd is null then
        raise exception 'AUDITORIA_PVPS_NAO_ENCONTRADA';
    end if;
    if v_aud_cd <> v_cd then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    select *
    from public.rpc_pvps_submit_pul(p_audit_id, p_end_pul, p_val_pul);
end;
$$;

create or replace function public.rpc_alocacao_submit(
    p_cd integer default null,
    p_queue_id uuid default null,
    p_end_sit text default null,
    p_val_conf text default null
)
returns table (
    audit_id uuid,
    aud_sit text,
    val_sist text,
    val_conf text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_item_cd integer;
begin
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_queue_id is null then raise exception 'QUEUE_ID_OBRIGATORIO'; end if;

    select d.cd into v_item_cd
    from app.db_alocacao d
    where d.queue_id = p_queue_id;

    if v_item_cd is null then
        raise exception 'ITEM_ALOCACAO_NAO_ENCONTRADO';
    end if;
    if v_item_cd <> v_cd then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    select *
    from public.rpc_alocacao_submit(p_queue_id, p_end_sit, p_val_conf);
end;
$$;

grant execute on function public.rpc_pvps_completed_items_day(integer, date, integer, integer) to authenticated;
grant execute on function public.rpc_alocacao_completed_items_day(integer, date, integer, integer) to authenticated;
grant execute on function public.rpc_pvps_submit_pul(integer, uuid, text, text) to authenticated;
grant execute on function public.rpc_alocacao_submit(integer, uuid, text, text) to authenticated;
