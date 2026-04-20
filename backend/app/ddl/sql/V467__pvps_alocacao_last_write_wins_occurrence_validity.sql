update app.aud_pvps
set
    val_sep = null,
    status = 'concluido'
where end_sit is not null
  and val_sep is not null;

update app.aud_pvps_pul
set val_pul = null
where end_sit is not null
  and val_pul is not null;

update app.aud_alocacao
set
    val_conf = null,
    aud_sit = 'ocorrencia'
where end_sit is not null
  and (
      val_conf is not null
      or aud_sit is distinct from 'ocorrencia'
  );

alter table app.aud_pvps
    drop constraint if exists aud_pvps_end_sit_xor_val_sep_check;

alter table app.aud_pvps
    add constraint aud_pvps_end_sit_xor_val_sep_check
    check (end_sit is null or val_sep is null);

alter table app.aud_pvps_pul
    drop constraint if exists aud_pvps_pul_end_sit_xor_val_pul_check;

alter table app.aud_pvps_pul
    add constraint aud_pvps_pul_end_sit_xor_val_pul_check
    check (end_sit is null or val_pul is null);

alter table app.aud_alocacao
    drop constraint if exists aud_alocacao_end_sit_occurrence_consistency_check;

alter table app.aud_alocacao
    add constraint aud_alocacao_end_sit_occurrence_consistency_check
    check (end_sit is null or (val_conf is null and aud_sit = 'ocorrencia'));

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
        val_sep = case when excluded.end_sit is not null then null else excluded.val_sep end,
        auditor_id = excluded.auditor_id,
        auditor_mat = excluded.auditor_mat,
        auditor_nome = excluded.auditor_nome,
        status = case when excluded.end_sit is not null then 'concluido' else excluded.status end,
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
    v_profile record;
    v_mat text;
    v_nome text;
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

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    insert into app.aud_pvps_pul (audit_id, end_pul, val_pul, end_sit, dt_hr, auditor_id, auditor_mat, auditor_nome)
    values (v_aud.audit_id, v_end_pul, v_val_pul, v_end_sit, now(), v_uid, v_mat, v_nome)
    on conflict on constraint uq_aud_pvps_pul_item
    do update set
        val_pul = case when excluded.end_sit is not null then null else excluded.val_pul end,
        end_sit = excluded.end_sit,
        dt_hr = now(),
        auditor_id = excluded.auditor_id,
        auditor_mat = excluded.auditor_mat,
        auditor_nome = excluded.auditor_nome;

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
    v_month_ref date := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
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

    select app.pvps_alocacao_normalize_validade(e.validade)
    into v_val_sist
    from app.db_end e
    where e.cd = v_item.cd
      and e.coddv = v_item.coddv
      and upper(trim(coalesce(e.tipo, ''))) = 'PUL'
      and upper(trim(coalesce(e.endereco, ''))) = v_item.endereco
      and nullif(trim(coalesce(e.validade, '')), '') is not null
    order by
        app.pvps_alocacao_validade_rank(app.pvps_alocacao_normalize_validade(e.validade)),
        app.pvps_alocacao_normalize_validade(e.validade)
    limit 1;

    v_val_sist := coalesce(v_val_sist, app.pvps_alocacao_normalize_validade(v_item.val_sist));

    update app.db_alocacao
    set val_sist = v_val_sist
    where queue_id = v_item.queue_id;

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
        auditor_id, auditor_mat, auditor_nome, dt_hr, audit_month_ref
    )
    values (
        v_item.queue_id, v_item.cd, v_item.zona, v_item.coddv, v_item.descricao, v_item.endereco, v_item.nivel,
        v_end_sit, v_val_sist, v_val_conf, v_aud_sit,
        v_uid, v_mat, v_nome, now(), v_month_ref
    )
    on conflict on constraint uq_aud_alocacao_queue_month
    do update set
        end_sit = excluded.end_sit,
        val_sist = excluded.val_sist,
        val_conf = case when excluded.end_sit is not null then null else excluded.val_conf end,
        aud_sit = case when excluded.end_sit is not null then 'ocorrencia' else excluded.aud_sit end,
        auditor_id = excluded.auditor_id,
        auditor_mat = excluded.auditor_mat,
        auditor_nome = excluded.auditor_nome,
        dt_hr = now(),
        audit_month_ref = excluded.audit_month_ref
    returning app.aud_alocacao.audit_id into v_audit_id;

    update app.db_alocacao
    set is_pending = false
    where queue_id = v_item.queue_id;

    perform app.pvps_alocacao_replenish(v_item.cd, 'alocacao');

    return query
    select v_audit_id, v_aud_sit, v_val_sist, v_val_conf;
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

    select aa.*
    into v_row
    from app.aud_alocacao aa
    where aa.audit_id = p_audit_id
    for update;

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

    update app.aud_alocacao aa
    set
        end_sit = v_end_sit,
        val_conf = case when v_end_sit is not null then null else v_val_conf end,
        aud_sit = case when v_end_sit is not null then 'ocorrencia' else v_aud_sit end,
        dt_hr = now()
    where aa.audit_id = v_row.audit_id;

    return query
    select v_row.audit_id, v_aud_sit, v_val_sist, v_val_conf;
end;
$$;
