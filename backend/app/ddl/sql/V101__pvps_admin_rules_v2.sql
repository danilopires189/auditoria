create table if not exists app.pvps_admin_rules (
    rule_id uuid primary key default gen_random_uuid(),
    cd integer not null,
    modulo text not null check (modulo in ('pvps', 'alocacao', 'ambos')),
    rule_kind text not null check (rule_kind in ('blacklist', 'priority')),
    target_type text not null check (target_type in ('zona', 'coddv')),
    target_value text not null,
    priority_value integer,
    active boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    removed_by uuid references auth.users(id) on delete set null,
    removed_at timestamptz
);

create unique index if not exists uq_pvps_admin_rules_active
    on app.pvps_admin_rules(cd, modulo, rule_kind, target_type, target_value)
    where active;

create index if not exists idx_pvps_admin_rules_cd_active
    on app.pvps_admin_rules(cd, active, rule_kind, modulo);

create table if not exists app.pvps_admin_rule_history (
    history_id uuid primary key default gen_random_uuid(),
    rule_id uuid references app.pvps_admin_rules(rule_id) on delete set null,
    cd integer not null,
    modulo text not null check (modulo in ('pvps', 'alocacao', 'ambos')),
    rule_kind text not null check (rule_kind in ('blacklist', 'priority')),
    target_type text not null check (target_type in ('zona', 'coddv')),
    target_value text not null,
    priority_value integer,
    action_type text not null check (action_type in ('create', 'remove')),
    apply_mode text check (apply_mode in ('apply_now', 'next_inclusions')),
    affected_pvps integer not null default 0,
    affected_alocacao integer not null default 0,
    actor_user_id uuid references auth.users(id) on delete set null,
    details_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_pvps_admin_rule_history_cd_created
    on app.pvps_admin_rule_history(cd, created_at desc);

create table if not exists app.pvps_admin_rule_grace (
    grace_id uuid primary key default gen_random_uuid(),
    rule_id uuid not null references app.pvps_admin_rules(rule_id) on delete cascade,
    modulo text not null check (modulo in ('pvps', 'alocacao')),
    item_key text not null,
    created_at timestamptz not null default now(),
    constraint uq_pvps_admin_rule_grace unique (rule_id, modulo, item_key)
);

create index if not exists idx_pvps_admin_rule_grace_lookup
    on app.pvps_admin_rule_grace(rule_id, modulo, item_key);

truncate table app.pvps_alocacao_blacklist;
truncate table app.pvps_alocacao_priority_zones;

create or replace function app.pvps_admin_assert()
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
begin
    if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if not authz.is_admin(auth.uid()) then raise exception 'APENAS_ADMIN'; end if;
end;
$$;

create or replace function app.pvps_admin_normalize_modulo(p_modulo text)
returns text
language plpgsql
immutable
as $$
declare
    v_modulo text;
begin
    v_modulo := lower(trim(coalesce(p_modulo, 'ambos')));
    if v_modulo not in ('pvps', 'alocacao', 'ambos') then
        raise exception 'MODULO_INVALIDO';
    end if;
    return v_modulo;
end;
$$;

create or replace function app.pvps_admin_target_matches(
    p_target_type text,
    p_target_value text,
    p_zona text,
    p_coddv integer
)
returns boolean
language sql
immutable
as $$
    select case lower(coalesce(p_target_type, ''))
        when 'zona' then upper(trim(coalesce(p_target_value, ''))) = upper(trim(coalesce(p_zona, '')))
        when 'coddv' then trim(coalesce(p_target_value, '')) = coalesce(p_coddv, 0)::text
        else false
    end;
$$;

create or replace function app.pvps_admin_is_item_blacklisted(
    p_cd integer,
    p_modulo text,
    p_zona text,
    p_coddv integer,
    p_item_key text default null
)
returns boolean
language sql
stable
as $$
    with candidate_rules as (
        select r.rule_id
        from app.pvps_admin_rules r
        where r.active
          and r.cd = p_cd
          and r.rule_kind = 'blacklist'
          and (r.modulo = 'ambos' or r.modulo = lower(coalesce(p_modulo, '')))
          and app.pvps_admin_target_matches(r.target_type, r.target_value, p_zona, p_coddv)
    )
    select exists (
        select 1
        from candidate_rules cr
        where not exists (
            select 1
            from app.pvps_admin_rule_grace g
            where g.rule_id = cr.rule_id
              and g.modulo = lower(coalesce(p_modulo, ''))
              and g.item_key = coalesce(p_item_key, '')
        )
    );
$$;

create or replace function app.pvps_admin_priority_score(
    p_cd integer,
    p_modulo text,
    p_zona text,
    p_coddv integer,
    p_item_key text default null
)
returns integer
language sql
stable
as $$
    select coalesce(min(r.priority_value), 9999)::integer
    from app.pvps_admin_rules r
    where r.active
      and r.cd = p_cd
      and r.rule_kind = 'priority'
      and (r.modulo = 'ambos' or r.modulo = lower(coalesce(p_modulo, '')))
      and app.pvps_admin_target_matches(r.target_type, r.target_value, p_zona, p_coddv)
      and not exists (
          select 1
          from app.pvps_admin_rule_grace g
          where g.rule_id = r.rule_id
            and g.modulo = lower(coalesce(p_modulo, ''))
            and g.item_key = coalesce(p_item_key, '')
      );
$$;

create or replace function app.pvps_admin_cleanup_grace(p_cd integer)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
begin
    delete from app.pvps_admin_rule_grace g
    using app.pvps_admin_rules r
    where r.rule_id = g.rule_id
      and r.cd = p_cd
      and (
        not r.active
        or (
          g.modulo = 'pvps'
          and not exists (
              select 1
              from app.db_pvps d
              where d.cd = r.cd
                and d.is_pending
                and (d.coddv::text || '|' || d.end_sep) = g.item_key
          )
        )
        or (
          g.modulo = 'alocacao'
          and not exists (
              select 1
              from app.db_alocacao d
              where d.cd = r.cd
                and d.is_pending
                and d.queue_id::text = g.item_key
          )
        )
      );
end;
$$;

create or replace function public.rpc_pvps_admin_rule_preview(
    p_cd integer default null,
    p_modulo text default null,
    p_rule_kind text default null,
    p_target_type text default null,
    p_target_value text default null,
    p_priority_value integer default null
)
returns table (
    affected_pvps integer,
    affected_alocacao integer,
    affected_total integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_modulo text;
    v_rule_kind text;
    v_target_type text;
    v_target_value text;
    v_target_coddv integer;
    v_affected_pvps integer := 0;
    v_affected_aloc integer := 0;
begin
    perform app.pvps_admin_assert();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_modulo := app.pvps_admin_normalize_modulo(p_modulo);
    v_rule_kind := lower(trim(coalesce(p_rule_kind, '')));
    v_target_type := lower(trim(coalesce(p_target_type, '')));

    if v_rule_kind not in ('blacklist', 'priority') then
        raise exception 'RULE_KIND_INVALIDO';
    end if;
    if v_target_type not in ('zona', 'coddv') then
        raise exception 'TARGET_TYPE_INVALIDO';
    end if;

    if v_target_type = 'zona' then
        v_target_value := upper(trim(coalesce(p_target_value, '')));
        if v_target_value = '' then raise exception 'ZONA_OBRIGATORIA'; end if;
    else
        v_target_coddv := nullif(regexp_replace(coalesce(p_target_value, ''), '\D', '', 'g'), '')::integer;
        if v_target_coddv is null or v_target_coddv <= 0 then raise exception 'CODDV_OBRIGATORIO'; end if;
        v_target_value := v_target_coddv::text;
    end if;

    if v_rule_kind = 'priority' and coalesce(p_priority_value, 0) <= 0 then
        raise exception 'PRIORIDADE_OBRIGATORIA';
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

    return query
    select v_affected_pvps, v_affected_aloc, (v_affected_pvps + v_affected_aloc);
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

create or replace function public.rpc_pvps_admin_rule_remove(
    p_cd integer default null,
    p_rule_id uuid default null
)
returns table (
    rule_id uuid,
    removed boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_uid uuid;
    v_row app.pvps_admin_rules%rowtype;
begin
    perform app.pvps_admin_assert();
    v_uid := auth.uid();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_rule_id is null then raise exception 'RULE_ID_OBRIGATORIO'; end if;

    update app.pvps_admin_rules r
    set active = false,
        removed_by = v_uid,
        removed_at = now()
    where r.rule_id = p_rule_id
      and r.cd = v_cd
      and r.active
    returning * into v_row;

    if v_row.rule_id is null then
        return query select p_rule_id, false;
        return;
    end if;

    insert into app.pvps_admin_rule_history (
        rule_id, cd, modulo, rule_kind, target_type, target_value, priority_value,
        action_type, apply_mode, affected_pvps, affected_alocacao, actor_user_id, details_json
    )
    values (
        v_row.rule_id, v_row.cd, v_row.modulo, v_row.rule_kind, v_row.target_type, v_row.target_value, v_row.priority_value,
        'remove', null, 0, 0, v_uid, jsonb_build_object('source', 'rpc_pvps_admin_rule_remove')
    );

    perform app.pvps_admin_cleanup_grace(v_cd);

    return query select v_row.rule_id, true;
end;
$$;

create or replace function public.rpc_pvps_admin_rules_active_list(
    p_cd integer default null,
    p_modulo text default 'ambos'
)
returns table (
    rule_id uuid,
    cd integer,
    modulo text,
    rule_kind text,
    target_type text,
    target_value text,
    priority_value integer,
    created_by uuid,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_modulo text;
begin
    perform app.pvps_admin_assert();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_modulo := app.pvps_admin_normalize_modulo(p_modulo);

    return query
    select
        r.rule_id,
        r.cd,
        r.modulo,
        r.rule_kind,
        r.target_type,
        r.target_value,
        r.priority_value,
        r.created_by,
        r.created_at
    from app.pvps_admin_rules r
    where r.cd = v_cd
      and r.active
      and (v_modulo = 'ambos' or r.modulo = v_modulo)
    order by
      case r.rule_kind when 'blacklist' then 0 else 1 end,
      coalesce(r.priority_value, 9999),
      r.target_type,
      r.target_value,
      r.created_at desc;
end;
$$;

create or replace function public.rpc_pvps_admin_rules_history_list(
    p_cd integer default null,
    p_modulo text default 'ambos',
    p_limit integer default 250,
    p_offset integer default 0
)
returns table (
    history_id uuid,
    rule_id uuid,
    cd integer,
    modulo text,
    rule_kind text,
    target_type text,
    target_value text,
    priority_value integer,
    action_type text,
    apply_mode text,
    affected_pvps integer,
    affected_alocacao integer,
    actor_user_id uuid,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_modulo text;
    v_limit integer;
    v_offset integer;
begin
    perform app.pvps_admin_assert();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_modulo := app.pvps_admin_normalize_modulo(p_modulo);
    v_limit := least(greatest(coalesce(p_limit, 250), 1), 1000);
    v_offset := greatest(coalesce(p_offset, 0), 0);

    return query
    select
        h.history_id,
        h.rule_id,
        h.cd,
        h.modulo,
        h.rule_kind,
        h.target_type,
        h.target_value,
        h.priority_value,
        h.action_type,
        h.apply_mode,
        h.affected_pvps,
        h.affected_alocacao,
        h.actor_user_id,
        h.created_at
    from app.pvps_admin_rule_history h
    where h.cd = v_cd
      and (v_modulo = 'ambos' or h.modulo = v_modulo)
    order by h.created_at desc
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function app.pvps_reseed(p_cd integer)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
begin
    with candidates as (
        select
            e.cd,
            e.coddv,
            e.dat_ult_compra,
            greatest(coalesce(e.qtd_est_disp, 0), 0) as qtd_est_disp,
            coalesce(min(app.pvps_admin_priority_score(
                e.cd,
                'pvps',
                app.pvps_alocacao_normalize_zone(sep.endereco),
                e.coddv,
                null
            )), 9999) as priority_score
        from app.db_estq_entr e
        left join app.db_end sep
          on sep.cd = e.cd and sep.coddv = e.coddv and upper(trim(coalesce(sep.tipo, ''))) = 'SEP'
        where e.cd = p_cd
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
          and exists (
              select 1 from app.db_end d1
              where d1.cd = e.cd and d1.coddv = e.coddv and upper(trim(coalesce(d1.tipo, ''))) = 'SEP'
          )
          and exists (
              select 1 from app.db_end d2
              where d2.cd = e.cd and d2.coddv = e.coddv and upper(trim(coalesce(d2.tipo, ''))) = 'PUL'
          )
        group by e.cd, e.coddv, e.dat_ult_compra, e.qtd_est_disp
        order by priority_score, e.dat_ult_compra desc, e.coddv
        limit 250
    ),
    expanded as (
        select
            c.cd,
            c.coddv,
            coalesce(nullif(trim(coalesce(sep.descricao, '')), ''), nullif(trim(coalesce(pul.descricao, '')), ''), format('CODDV %s', c.coddv)) as descricao,
            upper(trim(sep.endereco)) as end_sep,
            upper(trim(pul.endereco)) as end_pul,
            app.pvps_alocacao_normalize_zone(sep.endereco) as zona,
            c.qtd_est_disp,
            c.dat_ult_compra
        from candidates c
        join app.db_end sep
          on sep.cd = c.cd and sep.coddv = c.coddv and upper(trim(coalesce(sep.tipo, ''))) = 'SEP'
        join app.db_end pul
          on pul.cd = c.cd and pul.coddv = c.coddv and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where not app.pvps_admin_is_item_blacklisted(
            c.cd,
            'pvps',
            app.pvps_alocacao_normalize_zone(sep.endereco),
            c.coddv,
            c.coddv::text || '|' || upper(trim(sep.endereco))
        )
          and not exists (
            select 1
            from app.aud_pvps ap
            where ap.cd = c.cd
              and ap.coddv = c.coddv
              and ap.end_sep = upper(trim(sep.endereco))
              and ap.status in ('concluido', 'nao_conforme')
        )
    )
    insert into app.db_pvps (
        cd, zona, coddv, descricao, end_sep, end_pul, qtd_est_disp, dat_ult_compra, is_pending
    )
    select
        e.cd, e.zona, e.coddv, e.descricao, e.end_sep, e.end_pul, e.qtd_est_disp, e.dat_ult_compra, true
    from expanded e
    on conflict (cd, coddv, end_sep, end_pul)
    do update set
        zona = excluded.zona,
        descricao = excluded.descricao,
        qtd_est_disp = excluded.qtd_est_disp,
        dat_ult_compra = excluded.dat_ult_compra,
        is_pending = case when app.db_pvps.is_pending then true else app.db_pvps.is_pending end;
end;
$$;

create or replace function app.alocacao_reseed(p_cd integer)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
begin
    with candidates as (
        select
            e.cd,
            e.coddv,
            e.dat_ult_compra,
            greatest(coalesce(e.qtd_est_disp, 0), 0) as qtd_est_disp,
            coalesce(min(app.pvps_admin_priority_score(
                e.cd,
                'alocacao',
                app.pvps_alocacao_normalize_zone(pul.endereco),
                e.coddv,
                null
            )), 9999) as priority_score
        from app.db_estq_entr e
        left join app.db_end pul
          on pul.cd = e.cd and pul.coddv = e.coddv and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where e.cd = p_cd
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
          and exists (
              select 1 from app.db_end d
              where d.cd = e.cd
                and d.coddv = e.coddv
                and upper(trim(coalesce(d.tipo, ''))) = 'PUL'
                and nullif(trim(coalesce(d.validade, '')), '') is not null
          )
        group by e.cd, e.coddv, e.dat_ult_compra, e.qtd_est_disp
        order by priority_score, e.dat_ult_compra desc, e.coddv
        limit 250
    ),
    expanded as (
        select
            c.cd,
            c.coddv,
            coalesce(nullif(trim(coalesce(pul.descricao, '')), ''), format('CODDV %s', c.coddv)) as descricao,
            upper(trim(pul.endereco)) as endereco,
            app.pvps_alocacao_normalize_zone(pul.endereco) as zona,
            nullif(trim(coalesce(pul.andar, '')), '') as nivel,
            app.pvps_alocacao_normalize_validade(pul.validade) as val_sist,
            c.qtd_est_disp,
            c.dat_ult_compra,
            existing.queue_id as existing_queue_id
        from candidates c
        join app.db_end pul
          on pul.cd = c.cd and pul.coddv = c.coddv and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        left join app.db_alocacao existing
          on existing.cd = c.cd
         and existing.coddv = c.coddv
         and existing.endereco = upper(trim(pul.endereco))
        where nullif(trim(coalesce(pul.validade, '')), '') is not null
          and not app.pvps_admin_is_item_blacklisted(
            c.cd,
            'alocacao',
            app.pvps_alocacao_normalize_zone(pul.endereco),
            c.coddv,
            coalesce(existing.queue_id::text, '')
          )
          and not exists (
            select 1
            from app.aud_alocacao aa
            where aa.cd = c.cd
              and aa.coddv = c.coddv
              and aa.endereco = upper(trim(pul.endereco))
        )
    )
    insert into app.db_alocacao (
        cd, zona, coddv, descricao, endereco, nivel, val_sist, qtd_est_disp, dat_ult_compra, is_pending
    )
    select
        e.cd, e.zona, e.coddv, e.descricao, e.endereco, e.nivel, e.val_sist, e.qtd_est_disp, e.dat_ult_compra, true
    from expanded e
    on conflict (cd, coddv, endereco)
    do update set
        zona = excluded.zona,
        descricao = excluded.descricao,
        nivel = excluded.nivel,
        val_sist = excluded.val_sist,
        qtd_est_disp = excluded.qtd_est_disp,
        dat_ult_compra = excluded.dat_ult_compra,
        is_pending = case when app.db_alocacao.is_pending then true else app.db_alocacao.is_pending end;
end;
$$;

create or replace function app.pvps_alocacao_replenish(p_cd integer, p_modulo text)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_modulo text;
begin
    v_modulo := lower(coalesce(p_modulo, 'ambos'));
    if v_modulo not in ('pvps', 'alocacao', 'ambos') then
        raise exception 'MODULO_INVALIDO';
    end if;

    perform app.pvps_admin_cleanup_grace(p_cd);

    if v_modulo in ('pvps', 'ambos') then
        perform app.pvps_reseed(p_cd);
    end if;
    if v_modulo in ('alocacao', 'ambos') then
        perform app.alocacao_reseed(p_cd);
    end if;
end;
$$;

drop function if exists public.rpc_pvps_manifest_items_page(integer, text, integer, integer);

create function public.rpc_pvps_manifest_items_page(
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

    perform app.pvps_alocacao_replenish(v_cd, 'pvps');

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

grant execute on function public.rpc_pvps_admin_rule_preview(integer, text, text, text, text, integer) to authenticated;
grant execute on function public.rpc_pvps_admin_rule_create(integer, text, text, text, text, integer, text) to authenticated;
grant execute on function public.rpc_pvps_admin_rule_remove(integer, uuid) to authenticated;
grant execute on function public.rpc_pvps_admin_rules_active_list(integer, text) to authenticated;
grant execute on function public.rpc_pvps_admin_rules_history_list(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_pvps_manifest_items_page(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_alocacao_manifest_items_page(integer, text, integer, integer) to authenticated;
grant execute on function public.rpc_pvps_submit_sep(integer, integer, text, text, text) to authenticated;
grant execute on function public.rpc_pvps_submit_pul(uuid, text, text, text) to authenticated;
grant execute on function public.rpc_alocacao_submit(uuid, text, text) to authenticated;
