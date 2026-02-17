
create table if not exists app.conf_inventario_counts (
    count_id uuid primary key default gen_random_uuid(),
    cycle_date date not null,
    cd integer not null,
    zona text not null,
    endereco text not null,
    coddv integer not null,
    descricao text,
    estoque integer not null check (estoque >= 0),
    etapa smallint not null check (etapa in (1, 2)),
    qtd_contada integer not null check (qtd_contada >= 0),
    barras text,
    resultado text not null check (resultado in ('correto', 'falta', 'sobra', 'descartado')),
    counted_by uuid not null references auth.users(id) on delete restrict,
    counted_mat text not null,
    counted_nome text not null,
    client_event_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_conf_inventario_counts_item_etapa unique (cycle_date, cd, endereco, coddv, etapa),
    constraint uq_conf_inventario_counts_client_event unique (client_event_id)
);

create table if not exists app.conf_inventario_reviews (
    review_id uuid primary key default gen_random_uuid(),
    cycle_date date not null,
    cd integer not null,
    zona text not null,
    endereco text not null,
    coddv integer not null,
    descricao text,
    estoque integer not null check (estoque >= 0),
    reason_code text not null check (reason_code in ('sem_consenso', 'conflito_lock')),
    snapshot jsonb not null default '{}'::jsonb,
    status text not null default 'pendente' check (status in ('pendente', 'resolvido')),
    final_qtd integer,
    final_barras text,
    final_resultado text check (final_resultado in ('correto', 'falta', 'sobra', 'descartado')),
    resolved_by uuid references auth.users(id) on delete set null,
    resolved_mat text,
    resolved_nome text,
    resolved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_conf_inventario_reviews_item unique (cycle_date, cd, endereco, coddv),
    constraint ck_conf_inventario_reviews_final_qtd check (final_qtd is null or final_qtd >= 0)
);

create table if not exists app.conf_inventario_zone_locks (
    lock_id uuid primary key default gen_random_uuid(),
    cycle_date date not null,
    cd integer not null,
    zona text not null,
    etapa smallint not null check (etapa in (1, 2)),
    locked_by uuid not null references auth.users(id) on delete cascade,
    locked_mat text not null,
    locked_nome text not null,
    heartbeat_at timestamptz not null default now(),
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_conf_inventario_zone_locks unique (cycle_date, cd, zona, etapa)
);

create table if not exists app.conf_inventario_event_log (
    client_event_id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    event_type text not null,
    payload jsonb,
    status text not null,
    info text,
    processed_at timestamptz not null default now()
);

create index if not exists idx_conf_inventario_counts_cycle_cd_zona_etapa
    on app.conf_inventario_counts(cycle_date, cd, zona, etapa);

create index if not exists idx_conf_inventario_counts_cycle_cd_item
    on app.conf_inventario_counts(cycle_date, cd, endereco, coddv);

create index if not exists idx_conf_inventario_counts_counted_by
    on app.conf_inventario_counts(counted_by, cycle_date desc, updated_at desc);

create index if not exists idx_conf_inventario_reviews_cycle_cd_zona
    on app.conf_inventario_reviews(cycle_date, cd, zona, status);

create index if not exists idx_conf_inventario_reviews_reason_status
    on app.conf_inventario_reviews(reason_code, status);

create index if not exists idx_conf_inventario_locks_cycle_cd_zona_etapa
    on app.conf_inventario_zone_locks(cycle_date, cd, zona, etapa);

create index if not exists idx_conf_inventario_locks_expires
    on app.conf_inventario_zone_locks(expires_at);

create or replace function app.conf_inventario_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_conf_inventario_counts_touch_updated_at on app.conf_inventario_counts;
create trigger trg_conf_inventario_counts_touch_updated_at
before update on app.conf_inventario_counts
for each row
execute function app.conf_inventario_touch_updated_at();

drop trigger if exists trg_conf_inventario_reviews_touch_updated_at on app.conf_inventario_reviews;
create trigger trg_conf_inventario_reviews_touch_updated_at
before update on app.conf_inventario_reviews
for each row
execute function app.conf_inventario_touch_updated_at();

drop trigger if exists trg_conf_inventario_zone_locks_touch_updated_at on app.conf_inventario_zone_locks;
create trigger trg_conf_inventario_zone_locks_touch_updated_at
before update on app.conf_inventario_zone_locks
for each row
execute function app.conf_inventario_touch_updated_at();

create or replace function app.conf_inventario_today()
returns date
language sql
stable
as $$
    select (timezone('America/Sao_Paulo', now()))::date;
$$;

create or replace function app.conf_inventario_normalize_zone(
    p_rua text,
    p_endereco text
)
returns text
language plpgsql
immutable
as $$
declare
    v_rua text;
    v_endereco text;
    v_prefix text;
begin
    v_rua := nullif(trim(coalesce(p_rua, '')), '');
    if v_rua is not null then
        return upper(v_rua);
    end if;

    v_endereco := nullif(trim(coalesce(p_endereco, '')), '');
    if v_endereco is null then
        return 'SEM ZONA';
    end if;

    v_prefix := split_part(v_endereco, '.', 1);
    v_prefix := nullif(trim(v_prefix), '');
    if v_prefix is null then
        return 'SEM ZONA';
    end if;

    return upper(v_prefix);
end;
$$;

create or replace function app.conf_inventario_resolve_cd(p_cd integer default null)
returns integer
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if authz.is_admin(v_uid) then
        v_cd := p_cd;
    else
        v_cd := coalesce(
            v_profile.cd_default,
            p_cd,
            (
                select min(ud.cd)
                from authz.user_deposits ud
                where ud.user_id = v_uid
            )
        );
    end if;

    if v_cd is null then
        raise exception 'CD_NAO_DEFINIDO_USUARIO';
    end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return v_cd;
end;
$$;

create or replace function app.conf_inventario_compute_result(
    p_estoque integer,
    p_qtd integer,
    p_descartado boolean default false
)
returns text
language plpgsql
immutable
as $$
begin
    if coalesce(p_descartado, false) then
        return 'descartado';
    end if;
    if p_qtd > p_estoque then
        return 'sobra';
    end if;
    if p_qtd < p_estoque then
        return 'falta';
    end if;
    return 'correto';
end;
$$;

create or replace function app.conf_inventario_validate_barras_for_coddv(
    p_barras text,
    p_coddv integer
)
returns text
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
    v_barras text;
    v_exists boolean;
begin
    v_barras := regexp_replace(coalesce(p_barras, ''), '\\s+', '', 'g');
    if v_barras = '' then
        raise exception 'BARRAS_OBRIGATORIA';
    end if;

    select exists (
        select 1
        from app.db_barras b
        where b.barras = v_barras
          and b.coddv = p_coddv
    ) into v_exists;

    if not v_exists then
        raise exception 'BARRAS_INVALIDA_CODDV';
    end if;

    return v_barras;
end;
$$;
create or replace function app.conf_inventario_upsert_review_sem_consenso(
    p_cycle_date date,
    p_cd integer,
    p_zona text,
    p_endereco text,
    p_coddv integer,
    p_descricao text,
    p_estoque integer,
    p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
begin
    insert into app.conf_inventario_reviews (
        cycle_date,
        cd,
        zona,
        endereco,
        coddv,
        descricao,
        estoque,
        reason_code,
        snapshot,
        status,
        final_qtd,
        final_barras,
        final_resultado,
        resolved_by,
        resolved_mat,
        resolved_nome,
        resolved_at
    )
    values (
        p_cycle_date,
        p_cd,
        p_zona,
        p_endereco,
        p_coddv,
        p_descricao,
        p_estoque,
        'sem_consenso',
        coalesce(p_snapshot, '{}'::jsonb),
        'pendente',
        null,
        null,
        null,
        null,
        null,
        null,
        null
    )
    on conflict (cycle_date, cd, endereco, coddv)
    do update set
        zona = excluded.zona,
        descricao = excluded.descricao,
        estoque = excluded.estoque,
        reason_code = 'sem_consenso',
        snapshot = excluded.snapshot,
        status = 'pendente',
        final_qtd = null,
        final_barras = null,
        final_resultado = null,
        resolved_by = null,
        resolved_mat = null,
        resolved_nome = null,
        resolved_at = null,
        updated_at = now();
end;
$$;

create or replace function app.conf_inventario_refresh_review_state(
    p_cycle_date date,
    p_cd integer,
    p_zona text,
    p_endereco text,
    p_coddv integer
)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_c1 app.conf_inventario_counts%rowtype;
    v_c2 app.conf_inventario_counts%rowtype;
    v_snapshot jsonb;
begin
    select *
    into v_c1
    from app.conf_inventario_counts c
    where c.cycle_date = p_cycle_date
      and c.cd = p_cd
      and c.endereco = p_endereco
      and c.coddv = p_coddv
      and c.etapa = 1
    limit 1;

    select *
    into v_c2
    from app.conf_inventario_counts c
    where c.cycle_date = p_cycle_date
      and c.cd = p_cd
      and c.endereco = p_endereco
      and c.coddv = p_coddv
      and c.etapa = 2
    limit 1;

    if v_c1.count_id is not null and v_c1.resultado = 'descartado' then
        delete from app.conf_inventario_reviews r
        where r.cycle_date = p_cycle_date
          and r.cd = p_cd
          and r.endereco = p_endereco
          and r.coddv = p_coddv
          and r.reason_code = 'sem_consenso'
          and r.status = 'pendente';
        return;
    end if;

    if v_c2.count_id is not null and v_c2.resultado = 'descartado' then
        delete from app.conf_inventario_reviews r
        where r.cycle_date = p_cycle_date
          and r.cd = p_cd
          and r.endereco = p_endereco
          and r.coddv = p_coddv
          and r.reason_code = 'sem_consenso'
          and r.status = 'pendente';
        return;
    end if;

    if v_c1.count_id is not null and v_c2.count_id is not null then
        if coalesce(v_c1.qtd_contada, -1) = coalesce(v_c2.qtd_contada, -2) then
            delete from app.conf_inventario_reviews r
            where r.cycle_date = p_cycle_date
              and r.cd = p_cd
              and r.endereco = p_endereco
              and r.coddv = p_coddv
              and r.reason_code = 'sem_consenso'
              and r.status = 'pendente';
            return;
        end if;

        v_snapshot := jsonb_build_object(
            'primeira', jsonb_build_object(
                'qtd_contada', v_c1.qtd_contada,
                'barras', v_c1.barras,
                'resultado', v_c1.resultado,
                'counted_by', v_c1.counted_by,
                'counted_mat', v_c1.counted_mat,
                'counted_nome', v_c1.counted_nome,
                'updated_at', v_c1.updated_at
            ),
            'segunda', jsonb_build_object(
                'qtd_contada', v_c2.qtd_contada,
                'barras', v_c2.barras,
                'resultado', v_c2.resultado,
                'counted_by', v_c2.counted_by,
                'counted_mat', v_c2.counted_mat,
                'counted_nome', v_c2.counted_nome,
                'updated_at', v_c2.updated_at
            )
        );

        perform app.conf_inventario_upsert_review_sem_consenso(
            p_cycle_date,
            p_cd,
            p_zona,
            p_endereco,
            p_coddv,
            coalesce(v_c2.descricao, v_c1.descricao),
            coalesce(v_c2.estoque, v_c1.estoque),
            v_snapshot
        );
        return;
    end if;

    delete from app.conf_inventario_reviews r
    where r.cycle_date = p_cycle_date
      and r.cd = p_cd
      and r.endereco = p_endereco
      and r.coddv = p_coddv
      and r.reason_code = 'sem_consenso'
      and r.status = 'pendente';
end;
$$;

create or replace function app.conf_inventario_upsert_review_lock_conflict(
    p_cycle_date date,
    p_cd integer,
    p_zona text,
    p_endereco text,
    p_coddv integer,
    p_descricao text,
    p_estoque integer,
    p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
begin
    insert into app.conf_inventario_reviews (
        cycle_date,
        cd,
        zona,
        endereco,
        coddv,
        descricao,
        estoque,
        reason_code,
        snapshot,
        status,
        final_qtd,
        final_barras,
        final_resultado,
        resolved_by,
        resolved_mat,
        resolved_nome,
        resolved_at
    )
    values (
        p_cycle_date,
        p_cd,
        p_zona,
        p_endereco,
        p_coddv,
        p_descricao,
        p_estoque,
        'conflito_lock',
        coalesce(p_snapshot, '{}'::jsonb),
        'pendente',
        null,
        null,
        null,
        null,
        null,
        null,
        null
    )
    on conflict (cycle_date, cd, endereco, coddv)
    do update set
        zona = excluded.zona,
        descricao = excluded.descricao,
        estoque = excluded.estoque,
        reason_code = 'conflito_lock',
        snapshot = excluded.snapshot,
        status = 'pendente',
        final_qtd = null,
        final_barras = null,
        final_resultado = null,
        resolved_by = null,
        resolved_mat = null,
        resolved_nome = null,
        resolved_at = null,
        updated_at = now();
end;
$$;

create or replace function app.conf_inventario_cleanup_locks()
returns integer
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_deleted integer;
begin
    delete from app.conf_inventario_zone_locks
    where expires_at <= now();

    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$$;

alter table app.conf_inventario_counts enable row level security;
alter table app.conf_inventario_reviews enable row level security;
alter table app.conf_inventario_zone_locks enable row level security;
alter table app.conf_inventario_event_log enable row level security;

revoke all on app.conf_inventario_counts from anon;
revoke all on app.conf_inventario_reviews from anon;
revoke all on app.conf_inventario_zone_locks from anon;
revoke all on app.conf_inventario_event_log from anon;

revoke all on app.conf_inventario_counts from authenticated;
revoke all on app.conf_inventario_reviews from authenticated;
revoke all on app.conf_inventario_zone_locks from authenticated;
revoke all on app.conf_inventario_event_log from authenticated;

grant select, insert, update, delete on app.conf_inventario_counts to authenticated;
grant select, insert, update, delete on app.conf_inventario_reviews to authenticated;
grant select, insert, update, delete on app.conf_inventario_zone_locks to authenticated;
grant select on app.conf_inventario_event_log to authenticated;

drop policy if exists p_conf_inventario_counts_select on app.conf_inventario_counts;
create policy p_conf_inventario_counts_select
on app.conf_inventario_counts
for select
using (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_inventario_counts_insert on app.conf_inventario_counts;
create policy p_conf_inventario_counts_insert
on app.conf_inventario_counts
for insert
with check (
    authz.session_is_recent(6)
    and counted_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_inventario_counts_update on app.conf_inventario_counts;
create policy p_conf_inventario_counts_update
on app.conf_inventario_counts
for update
using (
    authz.session_is_recent(6)
    and (
        counted_by = auth.uid()
        or authz.is_admin(auth.uid())
    )
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
)
with check (
    authz.session_is_recent(6)
    and (
        counted_by = auth.uid()
        or authz.is_admin(auth.uid())
    )
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_inventario_counts_delete on app.conf_inventario_counts;
create policy p_conf_inventario_counts_delete
on app.conf_inventario_counts
for delete
using (
    authz.session_is_recent(6)
    and (
        counted_by = auth.uid()
        or authz.is_admin(auth.uid())
    )
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);
drop policy if exists p_conf_inventario_reviews_select on app.conf_inventario_reviews;
create policy p_conf_inventario_reviews_select
on app.conf_inventario_reviews
for select
using (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_inventario_reviews_insert on app.conf_inventario_reviews;
create policy p_conf_inventario_reviews_insert
on app.conf_inventario_reviews
for insert
with check (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_inventario_reviews_update on app.conf_inventario_reviews;
create policy p_conf_inventario_reviews_update
on app.conf_inventario_reviews
for update
using (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
)
with check (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_inventario_reviews_delete on app.conf_inventario_reviews;
create policy p_conf_inventario_reviews_delete
on app.conf_inventario_reviews
for delete
using (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_inventario_zone_locks_select on app.conf_inventario_zone_locks;
create policy p_conf_inventario_zone_locks_select
on app.conf_inventario_zone_locks
for select
using (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_inventario_zone_locks_insert on app.conf_inventario_zone_locks;
create policy p_conf_inventario_zone_locks_insert
on app.conf_inventario_zone_locks
for insert
with check (
    authz.session_is_recent(6)
    and locked_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_inventario_zone_locks_update on app.conf_inventario_zone_locks;
create policy p_conf_inventario_zone_locks_update
on app.conf_inventario_zone_locks
for update
using (
    authz.session_is_recent(6)
    and (
        locked_by = auth.uid()
        or authz.is_admin(auth.uid())
    )
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
)
with check (
    authz.session_is_recent(6)
    and (
        locked_by = auth.uid()
        or authz.is_admin(auth.uid())
    )
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_inventario_zone_locks_delete on app.conf_inventario_zone_locks;
create policy p_conf_inventario_zone_locks_delete
on app.conf_inventario_zone_locks
for delete
using (
    authz.session_is_recent(6)
    and (
        locked_by = auth.uid()
        or authz.is_admin(auth.uid())
    )
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_inventario_event_log_select on app.conf_inventario_event_log;
create policy p_conf_inventario_event_log_select
on app.conf_inventario_event_log
for select
using (
    authz.session_is_recent(6)
    and user_id = auth.uid()
);

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
        max(i.source_run_id),
        max(i.updated_at)
    into
        v_row_count,
        v_zonas_count,
        v_source_run_id,
        v_updated_max
    from app.db_inventario i
    where i.cd = v_cd;

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

create or replace function public.rpc_conf_inventario_manifest_items_page(
    p_cd integer default null,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    cd integer,
    zona text,
    endereco text,
    coddv integer,
    descricao text,
    estoque integer
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_offset integer;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 3000);

    return query
    select
        i.cd,
        app.conf_inventario_normalize_zone(i.rua, i.endereco) as zona,
        upper(i.endereco) as endereco,
        i.coddv,
        coalesce(nullif(trim(coalesce(i.descricao, '')), ''), format('CODDV %s', i.coddv)) as descricao,
        greatest(coalesce(i.estoque, 0), 0) as estoque
    from app.db_inventario i
    where i.cd = v_cd
    order by app.conf_inventario_normalize_zone(i.rua, i.endereco), i.endereco, i.coddv
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_conf_inventario_zone_overview(
    p_cd integer default null,
    p_cycle_date date default null
)
returns table (
    zona text,
    total_itens integer,
    pendentes_primeira integer,
    concluidos_primeira integer,
    pendentes_segunda integer,
    concluidos_segunda integer,
    revisao_pendente integer,
    concluidos_finais integer
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
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    v_cycle_date := coalesce(p_cycle_date, app.conf_inventario_today());

    return query
    with base as (
        select
            i.cd,
            app.conf_inventario_normalize_zone(i.rua, i.endereco) as zona,
            upper(i.endereco) as endereco,
            i.coddv
        from app.db_inventario i
        where i.cd = v_cd
    ),
    c1 as (
        select c.*
        from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date and c.cd = v_cd and c.etapa = 1
    ),
    c2 as (
        select c.*
        from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date and c.cd = v_cd and c.etapa = 2
    ),
    rv as (
        select r.*
        from app.conf_inventario_reviews r
        where r.cycle_date = v_cycle_date and r.cd = v_cd
    )
    select
        b.zona,
        count(*)::integer as total_itens,
        count(*) filter (where c1.count_id is null)::integer as pendentes_primeira,
        count(*) filter (where c1.count_id is not null)::integer as concluidos_primeira,
        count(*) filter (where c1.count_id is not null and c1.resultado = 'sobra' and c2.count_id is null and c1.resultado <> 'descartado')::integer as pendentes_segunda,
        count(*) filter (where c2.count_id is not null)::integer as concluidos_segunda,
        count(*) filter (where rv.status = 'pendente')::integer as revisao_pendente,
        count(*) filter (
            where c1.resultado = 'descartado'
               or c2.resultado = 'descartado'
               or rv.status = 'resolvido'
               or (c1.count_id is not null and c1.resultado <> 'sobra' and rv.review_id is null)
               or (c1.count_id is not null and c2.count_id is not null and c1.qtd_contada = c2.qtd_contada and rv.review_id is null)
        )::integer as concluidos_finais
    from base b
    left join c1 on c1.endereco = b.endereco and c1.coddv = b.coddv
    left join c2 on c2.endereco = b.endereco and c2.coddv = b.coddv
    left join rv on rv.endereco = b.endereco and rv.coddv = b.coddv
    group by b.zona
    order by b.zona;
end;
$$;
create or replace function public.rpc_conf_inventario_stage_items(
    p_cd integer default null,
    p_cycle_date date default null,
    p_zona text default null,
    p_etapa integer default 1,
    p_status text default 'pendente'
)
returns table (
    cd integer,
    zona text,
    endereco text,
    coddv integer,
    descricao text,
    estoque integer,
    etapa integer,
    qtd_primeira integer,
    barras_primeira text,
    resultado_primeira text,
    primeira_by uuid,
    primeira_nome text,
    qtd_segunda integer,
    barras_segunda text,
    resultado_segunda text,
    segunda_by uuid,
    segunda_nome text,
    review_status text,
    is_editable boolean,
    is_blocked_same_user boolean,
    status_item text
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
    v_etapa integer;
    v_status text;
    v_zona text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    v_cycle_date := coalesce(p_cycle_date, app.conf_inventario_today());
    v_etapa := case when p_etapa = 2 then 2 else 1 end;
    v_status := lower(coalesce(p_status, 'pendente'));
    v_zona := nullif(trim(coalesce(p_zona, '')), '');

    return query
    with base as (
        select
            i.cd,
            app.conf_inventario_normalize_zone(i.rua, i.endereco) as zona,
            upper(i.endereco) as endereco,
            i.coddv,
            coalesce(nullif(trim(coalesce(i.descricao, '')), ''), format('CODDV %s', i.coddv)) as descricao,
            greatest(coalesce(i.estoque, 0), 0) as estoque
        from app.db_inventario i
        where i.cd = v_cd
          and (v_zona is null or app.conf_inventario_normalize_zone(i.rua, i.endereco) = upper(v_zona))
    ),
    c1 as (
        select c.* from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date and c.cd = v_cd and c.etapa = 1
    ),
    c2 as (
        select c.* from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date and c.cd = v_cd and c.etapa = 2
    ),
    rv as (
        select r.* from app.conf_inventario_reviews r
        where r.cycle_date = v_cycle_date and r.cd = v_cd
    ),
    enriched as (
        select
            b.cd,
            b.zona,
            b.endereco,
            b.coddv,
            b.descricao,
            b.estoque,
            c1.qtd_contada as qtd_primeira,
            c1.barras as barras_primeira,
            c1.resultado as resultado_primeira,
            c1.counted_by as primeira_by,
            c1.counted_nome as primeira_nome,
            c2.qtd_contada as qtd_segunda,
            c2.barras as barras_segunda,
            c2.resultado as resultado_segunda,
            c2.counted_by as segunda_by,
            c2.counted_nome as segunda_nome,
            rv.status as review_status,
            case
                when v_etapa = 1 and c1.count_id is null then 'pendente'
                when v_etapa = 1 and c1.count_id is not null then 'concluido'
                when v_etapa = 2 and c1.count_id is not null and c1.resultado = 'sobra' and c2.count_id is null then 'pendente'
                when v_etapa = 2 and c2.count_id is not null then 'concluido'
                else 'ignorar'
            end as status_item,
            case
                when v_etapa = 1 and c1.count_id is null then true
                when v_etapa = 1 and c1.count_id is not null and c1.counted_by = v_uid and c2.count_id is null then true
                when v_etapa = 2 and c1.count_id is not null and c1.counted_by <> v_uid and c2.count_id is null and coalesce(rv.status, 'pendente') <> 'resolvido' then true
                when v_etapa = 2 and c2.count_id is not null and c2.counted_by = v_uid and coalesce(rv.status, 'pendente') <> 'resolvido' then true
                else false
            end as is_editable,
            (v_etapa = 2 and c1.count_id is not null and c1.counted_by = v_uid and c2.count_id is null) as is_blocked_same_user
        from base b
        left join c1 on c1.endereco = b.endereco and c1.coddv = b.coddv
        left join c2 on c2.endereco = b.endereco and c2.coddv = b.coddv
        left join rv on rv.endereco = b.endereco and rv.coddv = b.coddv
    )
    select
        e.cd,
        e.zona,
        e.endereco,
        e.coddv,
        e.descricao,
        e.estoque,
        v_etapa,
        case when v_etapa = 2 then null else e.qtd_primeira end,
        case when v_etapa = 2 then null else e.barras_primeira end,
        case when v_etapa = 2 then null else e.resultado_primeira end,
        case when v_etapa = 2 then null else e.primeira_by end,
        case when v_etapa = 2 then null else e.primeira_nome end,
        e.qtd_segunda,
        e.barras_segunda,
        e.resultado_segunda,
        e.segunda_by,
        e.segunda_nome,
        e.review_status,
        e.is_editable,
        e.is_blocked_same_user,
        e.status_item
    from enriched e
    where e.status_item <> 'ignorar'
      and (
          v_status = 'todos'
          or (v_status = 'pendente' and e.status_item = 'pendente')
          or (v_status = 'concluido' and e.status_item = 'concluido')
      )
    order by e.zona, e.endereco, e.coddv;
end;
$$;

create or replace function public.rpc_conf_inventario_review_items(
    p_cd integer default null,
    p_cycle_date date default null,
    p_zona text default null,
    p_status text default 'pendente'
)
returns table (
    cd integer,
    zona text,
    endereco text,
    coddv integer,
    descricao text,
    estoque integer,
    reason_code text,
    status text,
    qtd_primeira integer,
    barras_primeira text,
    primeira_nome text,
    primeira_mat text,
    qtd_segunda integer,
    barras_segunda text,
    segunda_nome text,
    segunda_mat text,
    final_qtd integer,
    final_barras text,
    final_resultado text,
    resolved_nome text,
    resolved_mat text,
    resolved_at timestamptz
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
    v_zona text;
    v_status text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    v_cycle_date := coalesce(p_cycle_date, app.conf_inventario_today());
    v_zona := nullif(trim(coalesce(p_zona, '')), '');
    v_status := lower(coalesce(p_status, 'pendente'));

    return query
    with c1 as (
        select c.* from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date and c.cd = v_cd and c.etapa = 1
    ),
    c2 as (
        select c.* from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date and c.cd = v_cd and c.etapa = 2
    )
    select
        r.cd,
        r.zona,
        r.endereco,
        r.coddv,
        r.descricao,
        r.estoque,
        r.reason_code,
        r.status,
        c1.qtd_contada,
        c1.barras,
        c1.counted_nome,
        c1.counted_mat,
        c2.qtd_contada,
        c2.barras,
        c2.counted_nome,
        c2.counted_mat,
        r.final_qtd,
        r.final_barras,
        r.final_resultado,
        r.resolved_nome,
        r.resolved_mat,
        r.resolved_at
    from app.conf_inventario_reviews r
    left join c1 on c1.endereco = r.endereco and c1.coddv = r.coddv
    left join c2 on c2.endereco = r.endereco and c2.coddv = r.coddv
    where r.cycle_date = v_cycle_date
      and r.cd = v_cd
      and (v_zona is null or r.zona = upper(v_zona))
      and (
          v_status = 'todos'
          or (v_status = 'pendente' and r.status = 'pendente')
          or (v_status = 'resolvido' and r.status = 'resolvido')
      )
    order by r.zona, r.endereco, r.coddv;
end;
$$;

create or replace function public.rpc_conf_inventario_lock_acquire(
    p_cd integer default null,
    p_cycle_date date default null,
    p_zona text default null,
    p_etapa integer default 1,
    p_ttl_seconds integer default 900
)
returns table (
    lock_id uuid,
    cycle_date date,
    cd integer,
    zona text,
    etapa integer,
    locked_by uuid,
    locked_mat text,
    locked_nome text,
    heartbeat_at timestamptz,
    expires_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_cycle_date date;
    v_zona text;
    v_etapa integer;
    v_ttl integer;
    v_profile record;
    v_mat text;
    v_nome text;
    v_lock app.conf_inventario_zone_locks%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    v_cycle_date := coalesce(p_cycle_date, app.conf_inventario_today());
    v_zona := upper(nullif(trim(coalesce(p_zona, '')), ''));
    if v_zona is null then raise exception 'ZONA_OBRIGATORIA'; end if;

    v_etapa := case when p_etapa = 2 then 2 else 1 end;
    v_ttl := greatest(coalesce(p_ttl_seconds, 900), 60);

    perform app.conf_inventario_cleanup_locks();

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    select * into v_lock
    from app.conf_inventario_zone_locks l
    where l.cycle_date = v_cycle_date and l.cd = v_cd and l.zona = v_zona and l.etapa = v_etapa
    for update;

    if v_lock.lock_id is not null and v_lock.expires_at > now() and v_lock.locked_by <> v_uid then
        raise exception 'ZONA_TRAVADA_OUTRO_USUARIO';
    end if;

    if v_lock.lock_id is null then
        insert into app.conf_inventario_zone_locks (
            cycle_date, cd, zona, etapa, locked_by, locked_mat, locked_nome, heartbeat_at, expires_at
        )
        values (
            v_cycle_date, v_cd, v_zona, v_etapa, v_uid, v_mat, v_nome, now(), now() + make_interval(secs => v_ttl)
        )
        returning * into v_lock;
    else
        update app.conf_inventario_zone_locks l
        set locked_by = v_uid,
            locked_mat = v_mat,
            locked_nome = v_nome,
            heartbeat_at = now(),
            expires_at = now() + make_interval(secs => v_ttl)
        where l.lock_id = v_lock.lock_id
        returning * into v_lock;
    end if;

    return query
    select v_lock.lock_id, v_lock.cycle_date, v_lock.cd, v_lock.zona, v_lock.etapa::integer,
           v_lock.locked_by, v_lock.locked_mat, v_lock.locked_nome, v_lock.heartbeat_at, v_lock.expires_at;
end;
$$;

create or replace function public.rpc_conf_inventario_lock_heartbeat(
    p_lock_id uuid,
    p_ttl_seconds integer default 900
)
returns table (
    lock_id uuid,
    cycle_date date,
    cd integer,
    zona text,
    etapa integer,
    locked_by uuid,
    locked_mat text,
    locked_nome text,
    heartbeat_at timestamptz,
    expires_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_ttl integer;
    v_lock app.conf_inventario_zone_locks%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_ttl := greatest(coalesce(p_ttl_seconds, 900), 60);

    select * into v_lock
    from app.conf_inventario_zone_locks l
    where l.lock_id = p_lock_id and l.locked_by = v_uid
    for update;

    if v_lock.lock_id is null then raise exception 'LOCK_NAO_ENCONTRADO'; end if;

    update app.conf_inventario_zone_locks l
    set heartbeat_at = now(), expires_at = now() + make_interval(secs => v_ttl)
    where l.lock_id = v_lock.lock_id
    returning * into v_lock;

    return query
    select v_lock.lock_id, v_lock.cycle_date, v_lock.cd, v_lock.zona, v_lock.etapa::integer,
           v_lock.locked_by, v_lock.locked_mat, v_lock.locked_nome, v_lock.heartbeat_at, v_lock.expires_at;
end;
$$;

create or replace function public.rpc_conf_inventario_lock_release(
    p_lock_id uuid
)
returns boolean
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

    delete from app.conf_inventario_zone_locks l
    where l.lock_id = p_lock_id
      and (l.locked_by = v_uid or authz.is_admin(v_uid));

    return found;
end;
$$;
create or replace function public.rpc_conf_inventario_apply_event(
    p_event_type text,
    p_payload jsonb,
    p_client_event_id uuid default null
)
returns table (
    accepted boolean,
    info text,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_event_type text;
    v_payload jsonb;
    v_profile record;
    v_mat text;
    v_nome text;

    v_cycle_date date;
    v_cd integer;
    v_zona text;
    v_endereco text;
    v_coddv integer;
    v_descricao text;
    v_estoque integer;
    v_etapa integer;
    v_qtd integer;
    v_barras text;
    v_discarded boolean;
    v_resultado text;

    v_c1 app.conf_inventario_counts%rowtype;
    v_c2 app.conf_inventario_counts%rowtype;
    v_review app.conf_inventario_reviews%rowtype;
    v_lock app.conf_inventario_zone_locks%rowtype;
    v_snapshot jsonb;
    v_base app.db_inventario%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_event_type := lower(trim(coalesce(p_event_type, '')));
    v_payload := coalesce(p_payload, '{}'::jsonb);

    if p_client_event_id is not null and exists (
        select 1 from app.conf_inventario_event_log e where e.client_event_id = p_client_event_id
    ) then
        return query select true, 'DUPLICATE_IGNORED', now();
        return;
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    if v_event_type = 'count_upsert' then
        v_cycle_date := coalesce((v_payload ->> 'cycle_date')::date, app.conf_inventario_today());
        v_cd := app.conf_inventario_resolve_cd(nullif(v_payload ->> 'cd', '')::integer);
        v_zona := upper(nullif(trim(coalesce(v_payload ->> 'zona', '')), ''));
        v_endereco := upper(nullif(trim(coalesce(v_payload ->> 'endereco', '')), ''));
        v_coddv := nullif(v_payload ->> 'coddv', '')::integer;
        v_descricao := nullif(trim(coalesce(v_payload ->> 'descricao', '')), '');
        v_estoque := greatest(coalesce(nullif(v_payload ->> 'estoque', '')::integer, 0), 0);
        v_etapa := case when coalesce(nullif(v_payload ->> 'etapa', '')::integer, 1) = 2 then 2 else 1 end;
        v_qtd := greatest(coalesce(nullif(v_payload ->> 'qtd_contada', '')::integer, 0), 0);
        v_discarded := coalesce((v_payload ->> 'discarded')::boolean, false);

        if v_zona is null or v_endereco is null or v_coddv is null then
            raise exception 'ITEM_INVALIDO';
        end if;

        select * into v_base
        from app.db_inventario b
        where b.cd = v_cd and upper(b.endereco) = v_endereco and b.coddv = v_coddv
        limit 1;

        if v_base.cd is null then
            raise exception 'ITEM_BASE_NAO_ENCONTRADO';
        end if;

        if v_descricao is null then
            v_descricao := coalesce(nullif(trim(coalesce(v_base.descricao, '')), ''), format('CODDV %s', v_coddv));
        end if;

        if v_estoque is null then
            v_estoque := greatest(coalesce(v_base.estoque, 0), 0);
        end if;

        select * into v_review
        from app.conf_inventario_reviews r
        where r.cycle_date = v_cycle_date and r.cd = v_cd and r.endereco = v_endereco and r.coddv = v_coddv and r.status = 'resolvido'
        limit 1;

        if v_review.review_id is not null then
            raise exception 'ITEM_JA_RESOLVIDO';
        end if;

        select * into v_lock
        from app.conf_inventario_zone_locks l
        where l.cycle_date = v_cycle_date and l.cd = v_cd and l.zona = v_zona and l.etapa = v_etapa
          and l.expires_at > now() and l.locked_by <> v_uid
        limit 1;

        if v_lock.lock_id is not null then
            v_snapshot := jsonb_build_object(
                'event_type', v_event_type,
                'event_payload', v_payload,
                'locked_by', v_lock.locked_by,
                'locked_mat', v_lock.locked_mat,
                'locked_nome', v_lock.locked_nome,
                'lock_expires_at', v_lock.expires_at
            );

            perform app.conf_inventario_upsert_review_lock_conflict(
                v_cycle_date, v_cd, v_zona, v_endereco, v_coddv, v_descricao, v_estoque, v_snapshot
            );

            if p_client_event_id is not null then
                insert into app.conf_inventario_event_log (client_event_id, user_id, event_type, payload, status, info)
                values (p_client_event_id, v_uid, v_event_type, v_payload, 'accepted', 'CONFLITO_LOCK_REVIEW');
            end if;

            return query select true, 'CONFLITO_LOCK_REVIEW', now();
            return;
        end if;

        select * into v_c1
        from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date and c.cd = v_cd and c.endereco = v_endereco and c.coddv = v_coddv and c.etapa = 1
        limit 1;

        select * into v_c2
        from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date and c.cd = v_cd and c.endereco = v_endereco and c.coddv = v_coddv and c.etapa = 2
        limit 1;

        if v_etapa = 1 and v_c2.count_id is not null then
            raise exception 'ETAPA1_BLOQUEADA_SEGUNDA_EXISTE';
        end if;

        if v_etapa = 1 and v_c1.count_id is not null and v_c1.counted_by <> v_uid then
            raise exception 'ETAPA1_APENAS_AUTOR';
        end if;

        if v_etapa = 2 then
            if v_c1.count_id is null then raise exception 'ETAPA1_OBRIGATORIA'; end if;
            if v_c1.resultado <> 'sobra' then raise exception 'ETAPA2_APENAS_QUANDO_SOBRA'; end if;
            if v_c2.count_id is null and v_c1.counted_by = v_uid then raise exception 'SEGUNDA_CONTAGEM_EXIGE_USUARIO_DIFERENTE'; end if;
            if v_c2.count_id is not null and v_c2.counted_by <> v_uid then raise exception 'ETAPA2_APENAS_AUTOR'; end if;
        end if;

        v_barras := null;
        if v_discarded then
            v_resultado := 'descartado';
            v_qtd := 0;
        else
            if v_qtd > v_estoque then
                v_barras := app.conf_inventario_validate_barras_for_coddv(v_payload ->> 'barras', v_coddv);
            end if;
            v_resultado := app.conf_inventario_compute_result(v_estoque, v_qtd, false);
        end if;

        insert into app.conf_inventario_counts (
            cycle_date, cd, zona, endereco, coddv, descricao, estoque, etapa,
            qtd_contada, barras, resultado, counted_by, counted_mat, counted_nome, client_event_id
        )
        values (
            v_cycle_date, v_cd, v_zona, v_endereco, v_coddv, v_descricao, v_estoque, v_etapa,
            v_qtd, v_barras, v_resultado, v_uid, v_mat, v_nome, p_client_event_id
        )
        on conflict (cycle_date, cd, endereco, coddv, etapa)
        do update set
            zona = excluded.zona,
            descricao = excluded.descricao,
            estoque = excluded.estoque,
            qtd_contada = excluded.qtd_contada,
            barras = excluded.barras,
            resultado = excluded.resultado,
            counted_by = excluded.counted_by,
            counted_mat = excluded.counted_mat,
            counted_nome = excluded.counted_nome,
            client_event_id = excluded.client_event_id,
            updated_at = now();

        perform app.conf_inventario_refresh_review_state(v_cycle_date, v_cd, v_zona, v_endereco, v_coddv);

        if p_client_event_id is not null then
            insert into app.conf_inventario_event_log (client_event_id, user_id, event_type, payload, status, info)
            values (p_client_event_id, v_uid, v_event_type, v_payload, 'accepted', 'COUNT_SAVED');
        end if;

        return query select true, 'COUNT_SAVED', now();
        return;
    elsif v_event_type = 'review_resolve' then
        v_cycle_date := coalesce((v_payload ->> 'cycle_date')::date, app.conf_inventario_today());
        v_cd := app.conf_inventario_resolve_cd(nullif(v_payload ->> 'cd', '')::integer);
        v_zona := upper(nullif(trim(coalesce(v_payload ->> 'zona', '')), ''));
        v_endereco := upper(nullif(trim(coalesce(v_payload ->> 'endereco', '')), ''));
        v_coddv := nullif(v_payload ->> 'coddv', '')::integer;
        v_qtd := greatest(coalesce(nullif(v_payload ->> 'final_qtd', '')::integer, 0), 0);

        if v_zona is null or v_endereco is null or v_coddv is null then
            raise exception 'ITEM_INVALIDO';
        end if;

        select * into v_review
        from app.conf_inventario_reviews r
        where r.cycle_date = v_cycle_date and r.cd = v_cd and r.endereco = v_endereco and r.coddv = v_coddv
        for update;

        if v_review.review_id is null then raise exception 'REVISAO_NAO_ENCONTRADA'; end if;
        if v_review.status = 'resolvido' then
            return query select true, 'REVIEW_ALREADY_RESOLVED', now();
            return;
        end if;

        v_estoque := greatest(coalesce(v_review.estoque, 0), 0);
        if v_qtd > v_estoque then
            v_barras := app.conf_inventario_validate_barras_for_coddv(v_payload ->> 'final_barras', v_coddv);
        else
            v_barras := null;
        end if;

        v_resultado := app.conf_inventario_compute_result(v_estoque, v_qtd, false);

        update app.conf_inventario_reviews r
        set status = 'resolvido',
            final_qtd = v_qtd,
            final_barras = v_barras,
            final_resultado = v_resultado,
            resolved_by = v_uid,
            resolved_mat = v_mat,
            resolved_nome = v_nome,
            resolved_at = now(),
            updated_at = now()
        where r.review_id = v_review.review_id;

        if p_client_event_id is not null then
            insert into app.conf_inventario_event_log (client_event_id, user_id, event_type, payload, status, info)
            values (p_client_event_id, v_uid, v_event_type, v_payload, 'accepted', 'REVIEW_RESOLVED');
        end if;

        return query select true, 'REVIEW_RESOLVED', now();
        return;
    end if;

    raise exception 'EVENTO_NAO_SUPORTADO';
exception
    when others then
        if p_client_event_id is not null and not exists (
            select 1 from app.conf_inventario_event_log e where e.client_event_id = p_client_event_id
        ) then
            insert into app.conf_inventario_event_log (client_event_id, user_id, event_type, payload, status, info)
            values (
                p_client_event_id,
                coalesce(v_uid, auth.uid()),
                coalesce(v_event_type, lower(trim(coalesce(p_event_type, '')))),
                coalesce(v_payload, coalesce(p_payload, '{}'::jsonb)),
                'error',
                sqlerrm
            );
        end if;
        raise;
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

    perform app.conf_inventario_cleanup_locks();

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

grant execute on function public.rpc_conf_inventario_manifest_meta(integer) to authenticated;
grant execute on function public.rpc_conf_inventario_manifest_items_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_inventario_zone_overview(integer, date) to authenticated;
grant execute on function public.rpc_conf_inventario_stage_items(integer, date, text, integer, text) to authenticated;
grant execute on function public.rpc_conf_inventario_review_items(integer, date, text, text) to authenticated;
grant execute on function public.rpc_conf_inventario_lock_acquire(integer, date, text, integer, integer) to authenticated;
grant execute on function public.rpc_conf_inventario_lock_heartbeat(uuid, integer) to authenticated;
grant execute on function public.rpc_conf_inventario_lock_release(uuid) to authenticated;
grant execute on function public.rpc_conf_inventario_apply_event(text, jsonb, uuid) to authenticated;
grant execute on function public.rpc_conf_inventario_sync_pull(integer, date, timestamptz) to authenticated;
