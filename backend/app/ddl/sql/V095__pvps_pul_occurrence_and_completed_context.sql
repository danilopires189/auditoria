alter table app.aud_pvps_pul
    add column if not exists end_sit text;

alter table app.aud_pvps_pul
    alter column val_pul drop not null;

alter table app.aud_pvps_pul
    drop constraint if exists aud_pvps_pul_end_sit_check;

alter table app.aud_pvps_pul
    add constraint aud_pvps_pul_end_sit_check
    check (end_sit is null or end_sit in ('vazio', 'obstruido'));

drop function if exists public.rpc_pvps_pul_items(integer, integer, text);

create or replace function public.rpc_pvps_pul_items(
    p_cd integer default null,
    p_coddv integer default null,
    p_end_sep text default null
)
returns table (
    end_pul text,
    val_pul text,
    end_sit text,
    auditado boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_end_sep text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_coddv is null or p_coddv <= 0 then raise exception 'CODDV_OBRIGATORIO'; end if;
    v_end_sep := upper(nullif(trim(coalesce(p_end_sep, '')), ''));
    if v_end_sep is null then raise exception 'END_SEP_OBRIGATORIO'; end if;

    return query
    with base as (
        select distinct d.end_pul
        from app.db_pvps d
        where d.cd = v_cd
          and d.coddv = p_coddv
          and d.end_sep = v_end_sep
    )
    select
        b.end_pul,
        apu.val_pul,
        apu.end_sit,
        (apu.audit_pul_id is not null) as auditado
    from base b
    left join app.aud_pvps ap
      on ap.cd = v_cd and ap.coddv = p_coddv and ap.end_sep = v_end_sep
    left join app.aud_pvps_pul apu
      on apu.audit_id = ap.audit_id and apu.end_pul = b.end_pul
    order by b.end_pul;
end;
$$;

create or replace function public.rpc_pvps_submit_pul(
    p_audit_id uuid,
    p_end_pul text,
    p_val_pul text,
    p_end_sit text default null
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
    v_uid uuid;
    v_aud app.aud_pvps%rowtype;
    v_end_pul text;
    v_end_sit text;
    v_val_pul text;
    v_pul_total integer;
    v_pul_auditados integer;
    v_has_invalid boolean;
    v_conforme boolean;
    v_status text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    select * into v_aud from app.aud_pvps where audit_id = p_audit_id for update;
    if v_aud.audit_id is null then raise exception 'AUDITORIA_PVPS_NAO_ENCONTRADA'; end if;
    if v_aud.status = 'pendente_sep' then raise exception 'SEP_NAO_AUDITADA'; end if;
    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_aud.cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_end_pul := upper(nullif(trim(coalesce(p_end_pul, '')), ''));
    if v_end_pul is null then raise exception 'END_PUL_OBRIGATORIO'; end if;

    if not exists (
        select 1
        from app.db_pvps d
        where d.cd = v_aud.cd
          and d.coddv = v_aud.coddv
          and d.end_sep = v_aud.end_sep
          and d.end_pul = v_end_pul
    ) then
        raise exception 'END_PUL_FORA_DA_AUDITORIA';
    end if;

    v_end_sit := lower(trim(coalesce(p_end_sit, '')));
    if v_end_sit = '' then
        v_end_sit := null;
    elsif v_end_sit not in ('vazio', 'obstruido') then
        raise exception 'END_SIT_INVALIDO';
    end if;

    if v_end_sit is not null then
        v_val_pul := null;
    else
        v_val_pul := app.pvps_alocacao_normalize_validade(p_val_pul);
    end if;

    insert into app.aud_pvps_pul (audit_id, end_pul, val_pul, end_sit, dt_hr)
    values (v_aud.audit_id, v_end_pul, v_val_pul, v_end_sit, now())
    on conflict (audit_id, end_pul)
    do update set
        val_pul = excluded.val_pul,
        end_sit = excluded.end_sit,
        dt_hr = now();

    select count(*)::integer
    into v_pul_total
    from app.db_pvps d
    where d.cd = v_aud.cd and d.coddv = v_aud.coddv and d.end_sep = v_aud.end_sep;

    select count(*)::integer
    into v_pul_auditados
    from app.aud_pvps_pul apu
    where apu.audit_id = v_aud.audit_id;

    v_conforme := false;
    v_status := 'pendente_pul';

    if coalesce(v_pul_total, 0) > 0 and coalesce(v_pul_auditados, 0) >= coalesce(v_pul_total, 0) then
        select exists (
            select 1
            from app.aud_pvps_pul apu
            where apu.audit_id = v_aud.audit_id
              and apu.val_pul is not null
              and v_aud.val_sep is not null
              and app.pvps_alocacao_validade_rank(apu.val_pul) < app.pvps_alocacao_validade_rank(v_aud.val_sep)
        ) into v_has_invalid;

        v_conforme := not coalesce(v_has_invalid, false);
        v_status := case when v_conforme then 'concluido' else 'nao_conforme' end;

        update app.aud_pvps
        set status = v_status,
            dt_hr = now()
        where audit_id = v_aud.audit_id;

        update app.db_pvps
        set is_pending = false
        where cd = v_aud.cd and coddv = v_aud.coddv and end_sep = v_aud.end_sep;

        perform app.pvps_alocacao_replenish(v_aud.cd, 'pvps');
    end if;

    return query
    select v_aud.audit_id, v_status, coalesce(v_pul_total, 0), coalesce(v_pul_auditados, 0), v_conforme;
end;
$$;

create or replace function public.rpc_pvps_submit_pul(
    p_audit_id uuid,
    p_end_pul text,
    p_val_pul text
)
returns table (
    audit_id uuid,
    status text,
    pul_total integer,
    pul_auditados integer,
    conforme boolean
)
language sql
security definer
set search_path = app, authz, public
as $$
    select *
    from public.rpc_pvps_submit_pul(
        p_audit_id,
        p_end_pul,
        p_val_pul,
        null::text
    );
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
    from public.rpc_pvps_submit_pul(p_audit_id, p_end_pul, p_val_pul, null::text);
end;
$$;

drop function if exists public.rpc_pvps_submit_pul(integer, uuid, text, text, text);

create function public.rpc_pvps_submit_pul(
    p_cd integer default null,
    p_audit_id uuid default null,
    p_end_pul text default null,
    p_val_pul text default null,
    p_end_sit text default null
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
    from public.rpc_pvps_submit_pul(p_audit_id, p_end_pul, p_val_pul, p_end_sit);
end;
$$;

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
                  and apu_low.val_pul is not null
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
          and apu_low.val_pul is not null
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

grant execute on function public.rpc_pvps_pul_items(integer, integer, text) to authenticated;
grant execute on function public.rpc_pvps_submit_pul(uuid, text, text) to authenticated;
grant execute on function public.rpc_pvps_submit_pul(uuid, text, text, text) to authenticated;
grant execute on function public.rpc_pvps_submit_pul(integer, uuid, text, text) to authenticated;
grant execute on function public.rpc_pvps_submit_pul(integer, uuid, text, text, text) to authenticated;
grant execute on function public.rpc_pvps_completed_items_day(integer, date, integer, integer) to authenticated;
