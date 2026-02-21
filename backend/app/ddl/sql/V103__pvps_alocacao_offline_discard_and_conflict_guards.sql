create table if not exists app.pvps_alocacao_offline_discard (
    discard_id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    cd integer not null,
    modulo text not null check (modulo in ('pvps', 'alocacao')),
    event_kind text not null check (event_kind in ('sep', 'pul', 'alocacao')),
    local_event_id text not null,
    local_event_created_at timestamptz,
    local_payload jsonb not null default '{}'::jsonb,
    local_user_id uuid references auth.users(id) on delete set null,
    local_user_mat text,
    local_user_nome text,
    coddv integer,
    zona text,
    end_sep text,
    end_pul text,
    queue_id uuid,
    conflict_reason text,
    existing_audit_id uuid,
    existing_auditor_id uuid,
    existing_auditor_mat text,
    existing_auditor_nome text,
    existing_audit_dt_hr timestamptz,
    existing_status text,
    details_json jsonb not null default '{}'::jsonb
);

create index if not exists idx_pvps_alocacao_offline_discard_cd_created
    on app.pvps_alocacao_offline_discard (cd, created_at desc);

create index if not exists idx_pvps_alocacao_offline_discard_user_created
    on app.pvps_alocacao_offline_discard (local_user_id, created_at desc);

create or replace function public.rpc_pvps_alocacao_offline_discard_register(
    p_cd integer default null,
    p_modulo text default null,
    p_event_kind text default null,
    p_local_event_id text default null,
    p_local_event_created_at timestamptz default null,
    p_local_payload jsonb default '{}'::jsonb,
    p_coddv integer default null,
    p_zona text default null,
    p_end_sep text default null,
    p_end_pul text default null,
    p_queue_id uuid default null,
    p_conflict_reason text default null
)
returns table (
    discard_id uuid
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_modulo text;
    v_event_kind text;
    v_profile record;
    v_mat text;
    v_nome text;
    v_end_sep text;
    v_end_pul text;
    v_zona text;
    v_existing_audit_id uuid;
    v_existing_auditor_id uuid;
    v_existing_auditor_mat text;
    v_existing_auditor_nome text;
    v_existing_audit_dt_hr timestamptz;
    v_existing_status text;
    v_discard_id uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_modulo := lower(trim(coalesce(p_modulo, '')));
    if v_modulo not in ('pvps', 'alocacao') then
        raise exception 'MODULO_INVALIDO';
    end if;

    v_event_kind := lower(trim(coalesce(p_event_kind, '')));
    if v_event_kind not in ('sep', 'pul', 'alocacao') then
        raise exception 'EVENT_KIND_INVALIDO';
    end if;
    if coalesce(nullif(trim(coalesce(p_local_event_id, '')), ''), '') = '' then
        raise exception 'LOCAL_EVENT_ID_OBRIGATORIO';
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');
    v_zona := upper(nullif(trim(coalesce(p_zona, '')), ''));
    v_end_sep := upper(nullif(trim(coalesce(p_end_sep, '')), ''));
    v_end_pul := upper(nullif(trim(coalesce(p_end_pul, '')), ''));

    if v_modulo = 'pvps' then
        if p_coddv is null or p_coddv <= 0 or v_end_sep is null then
            raise exception 'DADOS_PVPS_OBRIGATORIOS';
        end if;
        select
            ap.audit_id,
            ap.auditor_id,
            ap.auditor_mat,
            ap.auditor_nome,
            ap.dt_hr,
            ap.status
        into
            v_existing_audit_id,
            v_existing_auditor_id,
            v_existing_auditor_mat,
            v_existing_auditor_nome,
            v_existing_audit_dt_hr,
            v_existing_status
        from app.aud_pvps ap
        where ap.cd = v_cd
          and ap.coddv = p_coddv
          and ap.end_sep = v_end_sep
        order by ap.dt_hr desc
        limit 1;
    else
        if p_queue_id is null then
            raise exception 'QUEUE_ID_OBRIGATORIO';
        end if;
        select
            aa.audit_id,
            aa.auditor_id,
            aa.auditor_mat,
            aa.auditor_nome,
            aa.dt_hr,
            aa.aud_sit
        into
            v_existing_audit_id,
            v_existing_auditor_id,
            v_existing_auditor_mat,
            v_existing_auditor_nome,
            v_existing_audit_dt_hr,
            v_existing_status
        from app.aud_alocacao aa
        where aa.queue_id = p_queue_id
        order by aa.dt_hr desc
        limit 1;
    end if;

    insert into app.pvps_alocacao_offline_discard (
        cd,
        modulo,
        event_kind,
        local_event_id,
        local_event_created_at,
        local_payload,
        local_user_id,
        local_user_mat,
        local_user_nome,
        coddv,
        zona,
        end_sep,
        end_pul,
        queue_id,
        conflict_reason,
        existing_audit_id,
        existing_auditor_id,
        existing_auditor_mat,
        existing_auditor_nome,
        existing_audit_dt_hr,
        existing_status,
        details_json
    )
    values (
        v_cd,
        v_modulo,
        v_event_kind,
        trim(p_local_event_id),
        p_local_event_created_at,
        coalesce(p_local_payload, '{}'::jsonb),
        v_uid,
        v_mat,
        v_nome,
        p_coddv,
        v_zona,
        v_end_sep,
        v_end_pul,
        p_queue_id,
        nullif(trim(coalesce(p_conflict_reason, '')), ''),
        v_existing_audit_id,
        v_existing_auditor_id,
        v_existing_auditor_mat,
        v_existing_auditor_nome,
        v_existing_audit_dt_hr,
        v_existing_status,
        jsonb_build_object(
            'registered_at', now(),
            'source', 'pvps_alocacao_offline_sync'
        )
    )
    returning app.pvps_alocacao_offline_discard.discard_id into v_discard_id;

    return query
    select v_discard_id;
end;
$$;

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
        auditor_id, auditor_mat, auditor_nome, status, dt_hr
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
        now()
    from app.db_pvps d
    where d.cd = v_cd and d.coddv = p_coddv and d.end_sep = v_end_sep
    order by d.dat_ult_compra desc
    limit 1
    on conflict (cd, coddv, end_sep)
    do update set
        end_sit = excluded.end_sit,
        val_sep = excluded.val_sep,
        auditor_id = excluded.auditor_id,
        auditor_mat = excluded.auditor_mat,
        auditor_nome = excluded.auditor_nome,
        status = excluded.status,
        dt_hr = now()
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
    v_item_pending boolean;
    v_existing_auditor_id uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    select ap.*
    into v_aud
    from app.aud_pvps ap
    where ap.audit_id = p_audit_id
    for update;

    if v_aud.audit_id is null then raise exception 'AUDITORIA_PVPS_NAO_ENCONTRADA'; end if;
    if v_aud.status = 'pendente_sep' then raise exception 'SEP_NAO_AUDITADA'; end if;
    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_aud.cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    if app.pvps_admin_is_item_blacklisted(v_aud.cd, 'pvps', v_aud.zona, v_aud.coddv, v_aud.coddv::text || '|' || v_aud.end_sep) then
        raise exception 'ITEM_BLOQUEADO_BLACKLIST';
    end if;

    select exists (
        select 1
        from app.db_pvps d
        where d.cd = v_aud.cd
          and d.coddv = v_aud.coddv
          and d.end_sep = v_aud.end_sep
          and d.is_pending
    ) into v_item_pending;

    if not coalesce(v_item_pending, false) then
        select ap.auditor_id
        into v_existing_auditor_id
        from app.aud_pvps ap
        where ap.cd = v_aud.cd
          and ap.coddv = v_aud.coddv
          and ap.end_sep = v_aud.end_sep
        order by ap.dt_hr desc
        limit 1;

        if v_existing_auditor_id = v_uid then
            raise exception 'ITEM_PVPS_AUDITADO_PELO_USUARIO';
        end if;
        raise exception 'ITEM_PVPS_AUDITADO_POR_OUTRO_USUARIO';
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
    on conflict on constraint uq_aud_pvps_pul_item
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

        update app.aud_pvps ap
        set status = v_status,
            dt_hr = now()
        where ap.audit_id = v_aud.audit_id;

        update app.db_pvps
        set is_pending = false
        where cd = v_aud.cd and coddv = v_aud.coddv and end_sep = v_aud.end_sep;

        perform app.pvps_alocacao_replenish(v_aud.cd, 'pvps');
    end if;

    return query
    select v_aud.audit_id, v_status, coalesce(v_pul_total, 0), coalesce(v_pul_auditados, 0), v_conforme;
end;
$$;

create or replace function public.rpc_alocacao_submit(
    p_queue_id uuid,
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
    v_profile record;
    v_mat text;
    v_nome text;
    v_item app.db_alocacao%rowtype;
    v_end_sit text;
    v_val_conf text;
    v_val_sist text;
    v_aud_sit text;
    v_audit_id uuid;
    v_existing_auditor_id uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    select * into v_item from app.db_alocacao where queue_id = p_queue_id for update;
    if v_item.queue_id is null then raise exception 'ITEM_ALOCACAO_NAO_ENCONTRADO'; end if;
    if not v_item.is_pending then
        select aa.auditor_id
        into v_existing_auditor_id
        from app.aud_alocacao aa
        where aa.queue_id = v_item.queue_id
        order by aa.dt_hr desc
        limit 1;

        if v_existing_auditor_id = v_uid then
            raise exception 'ITEM_ALOCACAO_AUDITADO_PELO_USUARIO';
        end if;
        raise exception 'ITEM_ALOCACAO_AUDITADO_POR_OUTRO_USUARIO';
    end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_item.cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    if app.pvps_admin_is_item_blacklisted(v_item.cd, 'alocacao', v_item.zona, v_item.coddv, v_item.queue_id::text) then
        raise exception 'ITEM_BLOQUEADO_BLACKLIST';
    end if;

    v_end_sit := lower(trim(coalesce(p_end_sit, '')));
    if v_end_sit = '' then
        v_end_sit := null;
    elsif v_end_sit not in ('vazio', 'obstruido') then
        raise exception 'END_SIT_INVALIDO';
    end if;

    v_val_sist := app.pvps_alocacao_normalize_validade(v_item.val_sist);
    if v_end_sit is not null then
        v_val_conf := null;
        v_aud_sit := 'ocorrencia';
    else
        v_val_conf := app.pvps_alocacao_normalize_validade(p_val_conf);
        v_aud_sit := case when v_val_conf = v_val_sist then 'conforme' else 'nao_conforme' end;
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    insert into app.aud_alocacao (
        queue_id, cd, zona, coddv, descricao, endereco, nivel,
        end_sit, val_sist, val_conf, aud_sit,
        auditor_id, auditor_mat, auditor_nome, dt_hr
    )
    values (
        v_item.queue_id, v_item.cd, v_item.zona, v_item.coddv, v_item.descricao, v_item.endereco, v_item.nivel,
        v_end_sit, v_val_sist, v_val_conf, v_aud_sit,
        v_uid, v_mat, v_nome, now()
    )
    on conflict (queue_id)
    do update set
        end_sit = excluded.end_sit,
        val_sist = excluded.val_sist,
        val_conf = excluded.val_conf,
        aud_sit = excluded.aud_sit,
        auditor_id = excluded.auditor_id,
        auditor_mat = excluded.auditor_mat,
        auditor_nome = excluded.auditor_nome,
        dt_hr = now()
    returning app.aud_alocacao.audit_id into v_audit_id;

    update app.db_alocacao
    set is_pending = false
    where queue_id = v_item.queue_id;

    perform app.pvps_alocacao_replenish(v_item.cd, 'alocacao');

    return query
    select v_audit_id, v_aud_sit, v_val_sist, v_val_conf;
end;
$$;

grant execute on function public.rpc_pvps_alocacao_offline_discard_register(integer, text, text, text, timestamptz, jsonb, integer, text, text, text, uuid, text) to authenticated;
grant execute on function public.rpc_pvps_submit_sep(integer, integer, text, text, text) to authenticated;
grant execute on function public.rpc_pvps_submit_pul(uuid, text, text, text) to authenticated;
grant execute on function public.rpc_alocacao_submit(uuid, text, text) to authenticated;
