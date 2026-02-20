alter table app.aud_pvps
    alter column val_sep drop not null;

alter table app.aud_alocacao
    alter column end_sit drop not null,
    alter column val_conf drop not null;

alter table app.aud_alocacao
    drop constraint if exists aud_alocacao_end_sit_check;

alter table app.aud_alocacao
    add constraint aud_alocacao_end_sit_check
    check (end_sit is null or end_sit in ('vazio', 'obstruido'));

alter table app.aud_alocacao
    drop constraint if exists aud_alocacao_aud_sit_check;

alter table app.aud_alocacao
    add constraint aud_alocacao_aud_sit_check
    check (aud_sit in ('conforme', 'nao_conforme', 'ocorrencia'));

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
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_coddv is null or p_coddv <= 0 then raise exception 'CODDV_OBRIGATORIO'; end if;
    v_end_sep := upper(nullif(trim(coalesce(p_end_sep, '')), ''));
    if v_end_sep is null then raise exception 'END_SEP_OBRIGATORIO'; end if;

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

    if not exists (
        select 1 from app.db_pvps d
        where d.cd = v_cd and d.coddv = p_coddv and d.end_sep = v_end_sep
    ) then
        raise exception 'ITEM_PVPS_NAO_ENCONTRADO';
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
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    select * into v_item from app.db_alocacao where queue_id = p_queue_id for update;
    if v_item.queue_id is null then raise exception 'ITEM_ALOCACAO_NAO_ENCONTRADO'; end if;
    if not v_item.is_pending then raise exception 'ITEM_ALOCACAO_JA_AUDITADO'; end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_item.cd)) then
        raise exception 'CD_SEM_ACESSO';
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
