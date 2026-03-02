drop function if exists public.rpc_alocacao_manifest_items_page(integer, text, integer, integer);

create function public.rpc_alocacao_manifest_items_page(
    p_cd integer default null,
    p_zona text default null,
    p_offset integer default 0,
    p_limit integer default 200
)
returns table (
    queue_id uuid,
    cd integer,
    zona text,
    coddv integer,
    descricao text,
    endereco text,
    nivel text,
    val_sist text,
    dat_ult_compra date,
    qtd_est_disp integer,
    priority_score integer
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
    v_limit := least(greatest(coalesce(p_limit, 200), 1), 1000);

    perform app.pvps_alocacao_replenish(v_cd, 'alocacao');

    return query
    select
        d.queue_id,
        d.cd,
        d.zona,
        d.coddv,
        d.descricao,
        d.endereco,
        d.nivel,
        coalesce(curr.val_sist, d.val_sist) as val_sist,
        d.dat_ult_compra,
        d.qtd_est_disp,
        app.pvps_admin_priority_score(v_cd, 'alocacao', d.zona, d.coddv, d.queue_id::text) as priority_score
    from app.db_alocacao d
    left join lateral (
        select app.pvps_alocacao_normalize_validade(e.validade) as val_sist
        from app.db_end e
        where e.cd = d.cd
          and e.coddv = d.coddv
          and upper(trim(coalesce(e.tipo, ''))) = 'PUL'
          and upper(trim(coalesce(e.endereco, ''))) = d.endereco
          and nullif(trim(coalesce(e.validade, '')), '') is not null
        order by
            app.pvps_alocacao_validade_rank(app.pvps_alocacao_normalize_validade(e.validade)),
            app.pvps_alocacao_normalize_validade(e.validade)
        limit 1
    ) curr on true
    where d.cd = v_cd
      and d.is_pending
      and (v_zona is null or d.zona = v_zona)
      and not app.pvps_admin_is_item_blacklisted(v_cd, 'alocacao', d.zona, d.coddv, d.queue_id::text)
    order by priority_score asc, d.dat_ult_compra desc, d.zona, d.endereco, d.coddv
    offset v_offset
    limit v_limit;
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

grant execute on function public.rpc_alocacao_manifest_items_page(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_alocacao_submit(uuid, text, text) to authenticated;
