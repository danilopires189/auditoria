create table if not exists app.pvps_alocacao_replenish_state (
    cd integer not null,
    modulo text not null check (modulo in ('pvps', 'alocacao')),
    last_run_at timestamptz not null default now(),
    pending_before integer,
    reason text,
    updated_at timestamptz not null default now(),
    primary key (cd, modulo)
);

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

        if not v_should_run
           and v_cooldown_seconds > 0
           and v_last_run_at is not null
           and v_last_run_at > now() - make_interval(secs => v_cooldown_seconds) then
            continue;
        end if;

        if v_target = 'pvps' then
            select count(*)::integer
            into v_pending
            from app.db_pvps d
            where d.cd = p_cd
              and d.is_pending;
        else
            select count(*)::integer
            into v_pending
            from app.db_alocacao d
            where d.cd = p_cd
              and d.is_pending;
        end if;

        if v_should_run then
            v_reason := 'force';
        elsif v_pending < v_min_pending then
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

create or replace function app.pvps_alocacao_replenish(p_cd integer, p_modulo text)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
begin
    perform app.pvps_alocacao_replenish_if_needed(
        p_cd => p_cd,
        p_modulo => p_modulo,
        p_force => true,
        p_min_pending => 0,
        p_cooldown_seconds => 0
    );
end;
$$;

create or replace function public.rpc_pvps_manifest_items_page(
    p_cd integer default null,
    p_zona text default null,
    p_offset integer default 0,
    p_limit integer default 100
)
returns table (
    cd integer,
    zona text,
    coddv integer,
    descricao text,
    end_sep text,
    pul_total integer,
    pul_auditados integer,
    status text,
    end_sit text,
    val_sep text,
    audit_id uuid,
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
    v_limit := least(greatest(coalesce(p_limit, 100), 1), 1000);

    perform app.pvps_alocacao_replenish_if_needed(
        p_cd => v_cd,
        p_modulo => 'pvps',
        p_force => false,
        p_min_pending => 80,
        p_cooldown_seconds => 120
    );

    return query
    with base as (
        select
            d.cd,
            d.zona,
            d.coddv,
            max(d.descricao) as descricao,
            d.end_sep,
            max(d.dat_ult_compra) as dat_ult_compra,
            max(d.qtd_est_disp) as qtd_est_disp,
            count(*)::integer as pul_total,
            min(app.pvps_admin_priority_score(
                v_cd,
                'pvps',
                d.zona,
                d.coddv,
                d.coddv::text || '|' || d.end_sep
            ))::integer as priority_score
        from app.db_pvps d
        where d.cd = v_cd
          and d.is_pending
          and (v_zona is null or d.zona = v_zona)
          and not app.pvps_admin_is_item_blacklisted(
            v_cd,
            'pvps',
            d.zona,
            d.coddv,
            d.coddv::text || '|' || d.end_sep
          )
        group by d.cd, d.zona, d.coddv, d.end_sep
    ),
    pul_done as (
        select
            ap.cd,
            ap.coddv,
            ap.end_sep,
            count(*)::integer as pul_auditados
        from app.aud_pvps ap
        join app.aud_pvps_pul apu on apu.audit_id = ap.audit_id
        where ap.cd = v_cd
        group by ap.cd, ap.coddv, ap.end_sep
    )
    select
        b.cd,
        b.zona,
        b.coddv,
        b.descricao,
        b.end_sep,
        b.pul_total,
        coalesce(pd.pul_auditados, 0) as pul_auditados,
        coalesce(ap.status, 'pendente_sep') as status,
        ap.end_sit,
        ap.val_sep,
        ap.audit_id,
        b.dat_ult_compra,
        b.qtd_est_disp,
        b.priority_score
    from base b
    left join app.aud_pvps ap
      on ap.cd = b.cd and ap.coddv = b.coddv and ap.end_sep = b.end_sep
    left join pul_done pd
      on pd.cd = b.cd and pd.coddv = b.coddv and pd.end_sep = b.end_sep
    order by b.priority_score asc, b.dat_ult_compra desc, b.zona, b.end_sep, b.coddv
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_alocacao_manifest_items_page(
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

    perform app.pvps_alocacao_replenish_if_needed(
        p_cd => v_cd,
        p_modulo => 'alocacao',
        p_force => false,
        p_min_pending => 80,
        p_cooldown_seconds => 120
    );

    return query
    select
        d.queue_id,
        d.cd,
        d.zona,
        d.coddv,
        d.descricao,
        d.endereco,
        d.nivel,
        d.val_sist,
        d.dat_ult_compra,
        d.qtd_est_disp,
        app.pvps_admin_priority_score(v_cd, 'alocacao', d.zona, d.coddv, d.queue_id::text) as priority_score
    from app.db_alocacao d
    where d.cd = v_cd
      and d.is_pending
      and (v_zona is null or d.zona = v_zona)
      and not app.pvps_admin_is_item_blacklisted(v_cd, 'alocacao', d.zona, d.coddv, d.queue_id::text)
    order by priority_score asc, d.dat_ult_compra desc, d.zona, d.endereco, d.coddv
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function app.conf_inventario_refresh_pending_from_seed_all(
    p_cycle_date date default null,
    p_cd integer default null
)
returns integer
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_cycle_date date;
    v_cd integer;
    v_count integer := 0;
begin
    v_cycle_date := coalesce(p_cycle_date, app.conf_inventario_today());

    if p_cd is not null then
        perform app.conf_inventario_refresh_pending_from_seed(p_cd, v_cycle_date);
        return 1;
    end if;

    for v_cd in
        select c.cd
        from app.conf_inventario_admin_seed_config c
        order by c.cd
    loop
        perform app.conf_inventario_refresh_pending_from_seed(v_cd, v_cycle_date);
        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

create or replace function public.rpc_conf_inventario_manifest_meta(
    p_cd integer default null
)
returns table (
    cd integer,
    row_count bigint,
    zonas_count bigint,
    source_run_id uuid,
    manifest_hash text,
    generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_row_count bigint;
    v_zonas_count bigint;
    v_source_run_id uuid;
    v_updated_max timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);

    select
        count(*)::bigint,
        count(distinct app.conf_inventario_normalize_zone(i.rua, i.endereco))::bigint,
        max(i.updated_at)
    into
        v_row_count,
        v_zonas_count,
        v_updated_max
    from app.db_inventario i
    where i.cd = v_cd;

    select i.source_run_id
    into v_source_run_id
    from app.db_inventario i
    where i.cd = v_cd
      and i.source_run_id is not null
    order by i.updated_at desc nulls last, i.source_run_id::text desc
    limit 1;

    if coalesce(v_row_count, 0) = 0 then
        raise exception 'BASE_INVENTARIO_VAZIA';
    end if;

    return query
    select
        v_cd,
        v_row_count,
        v_zonas_count,
        v_source_run_id,
        md5(concat_ws(':', coalesce(v_source_run_id::text, ''), v_row_count::text, v_zonas_count::text, coalesce(v_updated_max::text, ''))),
        now();
end;
$$;

create or replace function public.rpc_conf_inventario_sync_pull(
    p_cd integer default null,
    p_cycle_date date default null,
    p_since timestamptz default null
)
returns table (
    counts jsonb,
    reviews jsonb,
    locks jsonb,
    server_time timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_cycle_date date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    v_cycle_date := coalesce(p_cycle_date, app.conf_inventario_today());

    return query
    with counts_data as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'cycle_date', c.cycle_date,
                    'cd', c.cd,
                    'zona', c.zona,
                    'endereco', c.endereco,
                    'coddv', c.coddv,
                    'descricao', c.descricao,
                    'estoque', c.estoque,
                    'etapa', c.etapa,
                    'qtd_contada', c.qtd_contada,
                    'barras', c.barras,
                    'resultado', c.resultado,
                    'counted_by', c.counted_by,
                    'counted_mat', c.counted_mat,
                    'counted_nome', c.counted_nome,
                    'updated_at', c.updated_at
                )
                order by c.zona, c.endereco, c.coddv, c.etapa
            ),
            '[]'::jsonb
        ) as payload
        from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date
          and c.cd = v_cd
          and (p_since is null or c.updated_at >= p_since)
    ),
    reviews_data as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'cycle_date', r.cycle_date,
                    'cd', r.cd,
                    'zona', r.zona,
                    'endereco', r.endereco,
                    'coddv', r.coddv,
                    'descricao', r.descricao,
                    'estoque', r.estoque,
                    'reason_code', r.reason_code,
                    'snapshot', r.snapshot,
                    'status', r.status,
                    'final_qtd', r.final_qtd,
                    'final_barras', r.final_barras,
                    'final_resultado', r.final_resultado,
                    'resolved_by', r.resolved_by,
                    'resolved_mat', r.resolved_mat,
                    'resolved_nome', r.resolved_nome,
                    'resolved_at', r.resolved_at,
                    'updated_at', r.updated_at
                )
                order by r.zona, r.endereco, r.coddv
            ),
            '[]'::jsonb
        ) as payload
        from app.conf_inventario_reviews r
        where r.cycle_date = v_cycle_date
          and r.cd = v_cd
          and (p_since is null or r.updated_at >= p_since)
    ),
    locks_data as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'lock_id', l.lock_id,
                    'cycle_date', l.cycle_date,
                    'cd', l.cd,
                    'zona', l.zona,
                    'etapa', l.etapa,
                    'locked_by', l.locked_by,
                    'locked_mat', l.locked_mat,
                    'locked_nome', l.locked_nome,
                    'heartbeat_at', l.heartbeat_at,
                    'expires_at', l.expires_at,
                    'updated_at', l.updated_at
                )
                order by l.zona, l.etapa
            ),
            '[]'::jsonb
        ) as payload
        from app.conf_inventario_zone_locks l
        where l.cycle_date = v_cycle_date
          and l.cd = v_cd
          and l.expires_at > now()
          and (p_since is null or l.updated_at >= p_since)
    )
    select counts_data.payload, reviews_data.payload, locks_data.payload, now()
    from counts_data, reviews_data, locks_data;
end;
$$;

alter function public.rpc_conf_inventario_manifest_meta(integer) stable;
alter function public.rpc_conf_inventario_sync_pull(integer, date, timestamptz) stable;

grant execute on function public.rpc_pvps_manifest_items_page(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_alocacao_manifest_items_page(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_conf_inventario_manifest_meta(integer) to authenticated;
grant execute on function public.rpc_conf_inventario_sync_pull(integer, date, timestamptz) to authenticated;

revoke all on function app.pvps_alocacao_replenish_if_needed(integer, text, boolean, integer, integer) from public;
revoke all on function app.pvps_alocacao_replenish_if_needed(integer, text, boolean, integer, integer) from anon;
revoke all on function app.pvps_alocacao_replenish_if_needed(integer, text, boolean, integer, integer) from authenticated;

revoke all on function app.conf_inventario_refresh_pending_from_seed_all(date, integer) from public;
revoke all on function app.conf_inventario_refresh_pending_from_seed_all(date, integer) from anon;
revoke all on function app.conf_inventario_refresh_pending_from_seed_all(date, integer) from authenticated;
