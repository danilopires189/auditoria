create or replace function app.pvps_alocacao_replenish_if_needed(
    p_cd integer,
    p_modulo text,
    p_force boolean default false,
    p_min_pending integer default 80,
    p_cooldown_seconds integer default 120
)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_modulo text;
    v_targets text[];
    v_target text;
    v_pending integer;
    v_active_pending integer;
    v_last_run_at timestamptz;
    v_min_pending integer;
    v_cooldown_seconds integer;
    v_should_run boolean;
    v_reason text;
begin
    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    v_modulo := lower(coalesce(p_modulo, 'ambos'));
    if v_modulo not in ('pvps', 'alocacao', 'ambos') then
        raise exception 'MODULO_INVALIDO';
    end if;

    v_targets := case
        when v_modulo = 'ambos' then array['pvps', 'alocacao']
        else array[v_modulo]
    end;

    v_min_pending := greatest(coalesce(p_min_pending, 0), 0);
    v_cooldown_seconds := greatest(coalesce(p_cooldown_seconds, 0), 0);

    perform app.pvps_admin_cleanup_grace(p_cd);

    foreach v_target in array v_targets loop
        if not pg_try_advisory_xact_lock(hashtext(format('pvps_replenish:%s:%s', p_cd, v_target))::bigint) then
            continue;
        end if;

        v_should_run := coalesce(p_force, false);
        v_reason := null;

        select s.last_run_at
        into v_last_run_at
        from app.pvps_alocacao_replenish_state s
        where s.cd = p_cd
          and s.modulo = v_target
        limit 1;

        if v_target = 'pvps' then
            select
                count(*)::integer,
                count(*) filter (where d.is_window_active)::integer
            into v_pending, v_active_pending
            from app.db_pvps d
            where d.cd = p_cd
              and d.is_pending;
        else
            select
                count(*)::integer,
                count(*) filter (where d.is_window_active)::integer
            into v_pending, v_active_pending
            from app.db_alocacao d
            where d.cd = p_cd
              and d.is_pending;
        end if;

        if not v_should_run
           and v_cooldown_seconds > 0
           and v_last_run_at is not null
           and v_last_run_at > now() - make_interval(secs => v_cooldown_seconds)
           and not (coalesce(v_pending, 0) > 0 and coalesce(v_active_pending, 0) = 0) then
            continue;
        end if;

        if v_should_run then
            v_reason := 'force';
        elsif coalesce(v_pending, 0) > 0 and coalesce(v_active_pending, 0) = 0 then
            v_should_run := true;
            v_reason := 'empty_active_window';
        elsif coalesce(v_pending, 0) < v_min_pending then
            v_should_run := true;
            v_reason := 'below_threshold';
        else
            continue;
        end if;

        if v_target = 'pvps' then
            perform app.pvps_reseed(p_cd);
        else
            perform app.alocacao_reseed(p_cd);
        end if;

        insert into app.pvps_alocacao_replenish_state (
            cd,
            modulo,
            last_run_at,
            pending_before,
            reason,
            updated_at
        )
        values (
            p_cd,
            v_target,
            now(),
            v_pending,
            v_reason,
            now()
        )
        on conflict (cd, modulo)
        do update set
            last_run_at = excluded.last_run_at,
            pending_before = excluded.pending_before,
            reason = excluded.reason,
            updated_at = now();
    end loop;
end;
$$;
