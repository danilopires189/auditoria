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
        ap.auditor_nome
    from app.aud_pvps ap
    where ap.cd = v_cd
      and (ap.dt_hr at time zone 'America/Sao_Paulo')::date = v_ref_date
    order by ap.dt_hr desc, ap.zona, ap.end_sep, ap.coddv
    offset v_offset
    limit v_limit;
end;
$$;

drop function if exists public.rpc_alocacao_completed_items_day(integer, date, integer, integer);

create function public.rpc_alocacao_completed_items_day(
    p_cd integer default null,
    p_ref_date_brt date default ((now() at time zone 'America/Sao_Paulo')::date),
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    audit_id uuid,
    auditor_id uuid,
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
        aa.auditor_id,
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

create or replace function public.rpc_alocacao_edit_completed(
    p_cd integer default null,
    p_audit_id uuid default null,
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
    v_uid uuid;
    v_cd integer;
    v_row app.aud_alocacao%rowtype;
    v_end_sit text;
    v_val_conf text;
    v_val_sist text;
    v_aud_sit text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    if p_audit_id is null then raise exception 'AUDIT_ID_OBRIGATORIO'; end if;
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);

    select * into v_row from app.aud_alocacao where audit_id = p_audit_id for update;
    if v_row.audit_id is null then raise exception 'AUDITORIA_ALOCACAO_NAO_ENCONTRADA'; end if;
    if v_row.cd <> v_cd then raise exception 'CD_SEM_ACESSO'; end if;
    if not (authz.is_admin(v_uid) or v_row.auditor_id = v_uid) then
        raise exception 'SEM_PERMISSAO_EDICAO';
    end if;

    v_end_sit := lower(trim(coalesce(p_end_sit, '')));
    if v_end_sit = '' then
        v_end_sit := null;
    elsif v_end_sit not in ('vazio', 'obstruido') then
        raise exception 'END_SIT_INVALIDO';
    end if;

    v_val_sist := app.pvps_alocacao_normalize_validade(v_row.val_sist);
    if v_end_sit is not null then
        v_val_conf := null;
        v_aud_sit := 'ocorrencia';
    else
        v_val_conf := app.pvps_alocacao_normalize_validade(p_val_conf);
        v_aud_sit := case when v_val_conf = v_val_sist then 'conforme' else 'nao_conforme' end;
    end if;

    update app.aud_alocacao
    set
        end_sit = v_end_sit,
        val_conf = v_val_conf,
        aud_sit = v_aud_sit,
        dt_hr = now()
    where audit_id = v_row.audit_id;

    return query
    select v_row.audit_id, v_aud_sit, v_val_sist, v_val_conf;
end;
$$;

grant execute on function public.rpc_pvps_completed_items_day(integer, date, integer, integer) to authenticated;
grant execute on function public.rpc_alocacao_completed_items_day(integer, date, integer, integer) to authenticated;
grant execute on function public.rpc_alocacao_edit_completed(integer, uuid, text, text) to authenticated;
