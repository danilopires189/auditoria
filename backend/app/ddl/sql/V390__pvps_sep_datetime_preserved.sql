alter table app.aud_pvps
    add column if not exists dt_hr_sep timestamptz;

update app.aud_pvps
set dt_hr_sep = coalesce(dt_hr_sep, dt_hr)
where dt_hr_sep is null;

alter table app.aud_pvps
    alter column dt_hr_sep set default now();

alter table app.aud_pvps
    alter column dt_hr_sep set not null;

create or replace function public.rpc_pvps_submit_sep(
    p_cd integer default null,
    p_coddv integer default null,
    p_end_sep text default null,
    p_end_sit text default null,
    p_val_sep text default null
)
returns table (
    audit_id uuid,
    status text,
    val_sep text,
    end_sit text,
    pul_total integer,
    pul_auditados integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
    v_mat text;
    v_nome text;
    v_end_sep text;
    v_end_sit text;
    v_val_sep text;
    v_audit_id uuid;
    v_pul_total integer;
    v_pul_auditados integer;
    v_status text := 'pendente_pul';
    v_flagged boolean := false;
    v_item_zona text;
    v_existing_auditor_id uuid;
    v_month_ref date := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
    v_sep_dt timestamptz := now();
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_coddv is null or p_coddv <= 0 then raise exception 'CODDV_OBRIGATORIO'; end if;
    v_end_sep := upper(nullif(trim(coalesce(p_end_sep, '')), ''));
    if v_end_sep is null then raise exception 'END_SEP_OBRIGATORIO'; end if;

    select d.zona into v_item_zona
    from app.db_pvps d
    where d.cd = v_cd and d.coddv = p_coddv and d.end_sep = v_end_sep
    limit 1;

    if v_item_zona is null then
        raise exception 'ITEM_PVPS_NAO_ENCONTRADO';
    end if;

    if app.pvps_admin_is_item_blacklisted(v_cd, 'pvps', v_item_zona, p_coddv, p_coddv::text || '|' || v_end_sep) then
        raise exception 'ITEM_BLOQUEADO_BLACKLIST';
    end if;

    if exists (
        select 1
        from app.db_pvps d
        where d.cd = v_cd
          and d.coddv = p_coddv
          and d.end_sep = v_end_sep
          and not d.is_pending
    ) then
        select ap.auditor_id
        into v_existing_auditor_id
        from app.aud_pvps ap
        where ap.cd = v_cd
          and ap.coddv = p_coddv
          and ap.end_sep = v_end_sep
        order by ap.dt_hr desc
        limit 1;

        if v_existing_auditor_id = v_uid then
            raise exception 'ITEM_PVPS_AUDITADO_PELO_USUARIO';
        end if;
        raise exception 'ITEM_PVPS_AUDITADO_POR_OUTRO_USUARIO';
    end if;

    v_end_sit := lower(trim(coalesce(p_end_sit, '')));
    if v_end_sit = '' then
        v_end_sit := null;
    elsif v_end_sit not in ('vazio', 'obstruido') then
        raise exception 'END_SIT_INVALIDO';
    end if;

    v_flagged := v_end_sit is not null;
    if v_flagged then
        v_val_sep := null;
    else
        v_val_sep := app.pvps_alocacao_normalize_validade(p_val_sep);
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    insert into app.aud_pvps (
        cd, zona, coddv, descricao, end_sep, end_sit, val_sep,
        auditor_id, auditor_mat, auditor_nome, status, dt_hr, dt_hr_sep, audit_month_ref
    )
    select
        d.cd,
        d.zona,
        d.coddv,
        d.descricao,
        d.end_sep,
        v_end_sit,
        v_val_sep,
        v_uid,
        v_mat,
        v_nome,
        case when v_flagged then 'concluido' else 'pendente_pul' end,
        v_sep_dt,
        v_sep_dt,
        v_month_ref
    from app.db_pvps d
    where d.cd = v_cd and d.coddv = p_coddv and d.end_sep = v_end_sep
    order by d.dat_ult_compra desc
    limit 1
    on conflict on constraint uq_aud_pvps_sep_month
    do update set
        end_sit = excluded.end_sit,
        val_sep = excluded.val_sep,
        auditor_id = excluded.auditor_id,
        auditor_mat = excluded.auditor_mat,
        auditor_nome = excluded.auditor_nome,
        status = excluded.status,
        dt_hr = excluded.dt_hr,
        dt_hr_sep = excluded.dt_hr_sep,
        audit_month_ref = excluded.audit_month_ref
    returning app.aud_pvps.audit_id into v_audit_id;

    select count(*)::integer
    into v_pul_total
    from app.db_pvps d
    where d.cd = v_cd and d.coddv = p_coddv and d.end_sep = v_end_sep;

    select count(*)::integer
    into v_pul_auditados
    from app.aud_pvps_pul apu
    where apu.audit_id = v_audit_id;

    if v_flagged then
        v_status := 'concluido';
        update app.db_pvps
        set is_pending = false
        where cd = v_cd and coddv = p_coddv and end_sep = v_end_sep;

        perform app.pvps_alocacao_replenish(v_cd, 'pvps');
    end if;

    return query
    select v_audit_id, v_status, v_val_sep, v_end_sit, coalesce(v_pul_total, 0), coalesce(v_pul_auditados, 0);
end;
$$;

drop function if exists public.rpc_pvps_completed_items_day(integer, date, integer, integer);

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
    dt_hr_sep timestamptz,
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
        coalesce(ap.dt_hr_sep, ap.dt_hr) as dt_hr_sep,
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

create or replace function public.rpc_vw_auditorias_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null,
    p_modulo text default 'ambos',
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    payload jsonb
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_role text;
    v_start_ts timestamptz;
    v_end_ts timestamptz;
    v_limit integer;
    v_offset integer;
    v_modulo text;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_role := authz.user_role(auth.uid());
    if v_role <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if p_dt_fim - p_dt_ini > 31 then
        raise exception 'JANELA_MAX_31_DIAS';
    end if;

    v_modulo := lower(coalesce(nullif(trim(p_modulo), ''), 'ambos'));
    if v_modulo not in ('pvps', 'alocacao', 'ambos') then
        raise exception 'MODULO_INVALIDO';
    end if;

    if p_cd is not null and not authz.can_access_cd(auth.uid(), p_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 1000);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    return query
    select case
        when lower(coalesce(v.modulo, '')) = 'pvps' then
            to_jsonb(v) || jsonb_build_object('dt_hr_sep', coalesce(ap.dt_hr_sep, ap.dt_hr))
        else
            to_jsonb(v)
    end as payload
    from vw_auditorias v
    left join lateral (
        select ap.dt_hr_sep, ap.dt_hr
        from app.aud_pvps ap
        where ap.audit_id::text = v.audit_id::text
        limit 1
    ) ap on lower(coalesce(v.modulo, '')) = 'pvps'
    where v.dt_hr >= v_start_ts
      and v.dt_hr < v_end_ts
      and (p_cd is null or v.cd = p_cd)
      and (v_modulo = 'ambos' or lower(coalesce(v.modulo, '')) = v_modulo)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), v.cd)
      )
    order by v.dt_hr desc, v.cd asc
    offset v_offset
    limit v_limit;
end;
$$;

grant execute on function public.rpc_pvps_submit_sep(integer, integer, text, text, text) to authenticated;
grant execute on function public.rpc_pvps_completed_items_day(integer, date, integer, integer) to authenticated;
grant execute on function public.rpc_vw_auditorias_report_rows(date, date, integer, text, integer, integer) to authenticated;
