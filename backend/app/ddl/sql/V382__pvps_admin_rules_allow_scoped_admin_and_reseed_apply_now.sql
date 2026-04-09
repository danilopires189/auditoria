create or replace function app.pvps_admin_assert()
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if coalesce(authz.user_role(v_uid), '') <> 'admin' then raise exception 'APENAS_ADMIN'; end if;
end;
$$;

create or replace function public.rpc_pvps_admin_rule_create(
    p_cd integer default null,
    p_modulo text default null,
    p_rule_kind text default null,
    p_target_type text default null,
    p_target_value text default null,
    p_priority_value integer default null,
    p_apply_mode text default 'apply_now'
)
returns table (
    rule_id uuid,
    cd integer,
    modulo text,
    rule_kind text,
    target_type text,
    target_value text,
    priority_value integer,
    apply_mode text,
    affected_pvps integer,
    affected_alocacao integer,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_uid uuid;
    v_modulo text;
    v_rule_kind text;
    v_target_type text;
    v_target_value text;
    v_target_coddv integer;
    v_priority_value integer;
    v_apply_mode text;
    v_affected_pvps integer := 0;
    v_affected_aloc integer := 0;
    v_row app.pvps_admin_rules%rowtype;
begin
    perform app.pvps_admin_assert();
    v_uid := auth.uid();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_modulo := app.pvps_admin_normalize_modulo(p_modulo);
    v_rule_kind := lower(trim(coalesce(p_rule_kind, '')));
    v_target_type := lower(trim(coalesce(p_target_type, '')));
    v_apply_mode := lower(trim(coalesce(p_apply_mode, 'apply_now')));

    if v_rule_kind not in ('blacklist', 'priority') then
        raise exception 'RULE_KIND_INVALIDO';
    end if;
    if v_target_type not in ('zona', 'coddv') then
        raise exception 'TARGET_TYPE_INVALIDO';
    end if;
    if v_apply_mode not in ('apply_now', 'next_inclusions') then
        raise exception 'APPLY_MODE_INVALIDO';
    end if;

    if v_target_type = 'zona' then
        v_target_value := upper(trim(coalesce(p_target_value, '')));
        if v_target_value = '' then raise exception 'ZONA_OBRIGATORIA'; end if;
    else
        v_target_coddv := nullif(regexp_replace(coalesce(p_target_value, ''), '\D', '', 'g'), '')::integer;
        if v_target_coddv is null or v_target_coddv <= 0 then raise exception 'CODDV_OBRIGATORIO'; end if;
        v_target_value := v_target_coddv::text;
    end if;

    if v_rule_kind = 'priority' then
        v_priority_value := greatest(coalesce(p_priority_value, 0), 1);
    else
        v_priority_value := null;
    end if;

    if v_modulo in ('pvps', 'ambos') then
        select count(distinct d.coddv::text || '|' || d.end_sep)::integer
        into v_affected_pvps
        from app.db_pvps d
        where d.cd = v_cd
          and d.is_pending
          and app.pvps_admin_target_matches(v_target_type, v_target_value, d.zona, d.coddv);
    end if;

    if v_modulo in ('alocacao', 'ambos') then
        select count(*)::integer
        into v_affected_aloc
        from app.db_alocacao d
        where d.cd = v_cd
          and d.is_pending
          and app.pvps_admin_target_matches(v_target_type, v_target_value, d.zona, d.coddv);
    end if;

    update app.pvps_admin_rules r
    set active = false,
        removed_by = v_uid,
        removed_at = now()
    where r.active
      and r.cd = v_cd
      and r.modulo = v_modulo
      and r.rule_kind = v_rule_kind
      and r.target_type = v_target_type
      and r.target_value = v_target_value;

    insert into app.pvps_admin_rules (
        cd, modulo, rule_kind, target_type, target_value, priority_value, active, created_by
    )
    values (
        v_cd, v_modulo, v_rule_kind, v_target_type, v_target_value, v_priority_value, true, v_uid
    )
    returning * into v_row;

    if v_apply_mode = 'next_inclusions' then
        if v_modulo in ('pvps', 'ambos') then
            insert into app.pvps_admin_rule_grace (rule_id, modulo, item_key)
            select distinct
                v_row.rule_id,
                'pvps',
                d.coddv::text || '|' || d.end_sep
            from app.db_pvps d
            where d.cd = v_cd
              and d.is_pending
              and app.pvps_admin_target_matches(v_target_type, v_target_value, d.zona, d.coddv)
            on conflict (rule_id, modulo, item_key) do nothing;
        end if;

        if v_modulo in ('alocacao', 'ambos') then
            insert into app.pvps_admin_rule_grace (rule_id, modulo, item_key)
            select
                v_row.rule_id,
                'alocacao',
                d.queue_id::text
            from app.db_alocacao d
            where d.cd = v_cd
              and d.is_pending
              and app.pvps_admin_target_matches(v_target_type, v_target_value, d.zona, d.coddv)
            on conflict (rule_id, modulo, item_key) do nothing;
        end if;
    elsif v_rule_kind = 'blacklist' then
        if v_modulo in ('pvps', 'ambos') then
            delete from app.db_pvps d
            where d.cd = v_cd
              and d.is_pending
              and app.pvps_admin_target_matches(v_target_type, v_target_value, d.zona, d.coddv);
            get diagnostics v_affected_pvps = row_count;
        end if;

        if v_modulo in ('alocacao', 'ambos') then
            delete from app.db_alocacao d
            where d.cd = v_cd
              and d.is_pending
              and app.pvps_admin_target_matches(v_target_type, v_target_value, d.zona, d.coddv);
            get diagnostics v_affected_aloc = row_count;
        end if;
    elsif v_rule_kind = 'priority' and v_apply_mode = 'apply_now' then
        if v_modulo in ('pvps', 'ambos') then
            perform app.pvps_reseed(v_cd);
        end if;
        if v_modulo in ('alocacao', 'ambos') then
            perform app.alocacao_reseed(v_cd);
        end if;
    end if;

    insert into app.pvps_admin_rule_history (
        rule_id, cd, modulo, rule_kind, target_type, target_value, priority_value,
        action_type, apply_mode, affected_pvps, affected_alocacao, actor_user_id, details_json
    )
    values (
        v_row.rule_id, v_cd, v_modulo, v_rule_kind, v_target_type, v_target_value, v_priority_value,
        'create', v_apply_mode, coalesce(v_affected_pvps, 0), coalesce(v_affected_aloc, 0), v_uid,
        jsonb_build_object('source', 'rpc_pvps_admin_rule_create')
    );

    perform app.pvps_admin_cleanup_grace(v_cd);

    return query
    select
        v_row.rule_id,
        v_row.cd,
        v_row.modulo,
        v_row.rule_kind,
        v_row.target_type,
        v_row.target_value,
        v_row.priority_value,
        v_apply_mode,
        coalesce(v_affected_pvps, 0),
        coalesce(v_affected_aloc, 0),
        v_row.created_at;
end;
$$;

grant execute on function public.rpc_pvps_admin_rule_create(integer, text, text, text, text, integer, text) to authenticated;
