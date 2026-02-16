create table if not exists app.conf_volume_avulso (
    conf_id uuid primary key default gen_random_uuid(),
    conf_date date not null default (timezone('America/Sao_Paulo', now()))::date,
    cd integer not null,
    nr_volume text not null,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    started_by uuid not null references auth.users(id) on delete restrict,
    started_mat text not null,
    started_nome text not null,
    status text not null default 'em_conferencia'
        check (status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')),
    falta_motivo text,
    started_at timestamptz not null default now(),
    finalized_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint uq_conf_volume_avulso_daily unique (conf_date, cd, nr_volume)
);

create table if not exists app.conf_volume_avulso_itens (
    item_id uuid primary key default gen_random_uuid(),
    conf_id uuid not null references app.conf_volume_avulso(conf_id) on delete cascade,
    nr_volume text,
    coddv integer not null,
    barras text,
    descricao text not null,
    qtd_esperada integer not null check (qtd_esperada > 0),
    qtd_conferida integer not null default 0 check (qtd_conferida >= 0),
    updated_at timestamptz not null default now(),
    constraint uq_conf_volume_avulso_itens unique (conf_id, coddv)
);

alter table app.conf_volume_avulso_itens
    add column if not exists barras text;

alter table app.conf_volume_avulso_itens
    add column if not exists nr_volume text;

update app.conf_volume_avulso_itens i
set nr_volume = c.nr_volume
from app.conf_volume_avulso c
where c.conf_id = i.conf_id
  and (i.nr_volume is null or i.nr_volume <> c.nr_volume);

create index if not exists idx_conf_volume_avulso_cd_date_status
    on app.conf_volume_avulso(cd, conf_date, status);

create index if not exists idx_conf_volume_avulso_cd_date_rota_filial
    on app.conf_volume_avulso(cd, conf_date, rota, filial);

create index if not exists idx_conf_volume_avulso_started_by_date
    on app.conf_volume_avulso(started_by, conf_date desc, updated_at desc);

create index if not exists idx_conf_volume_avulso_itens_conf
    on app.conf_volume_avulso_itens(conf_id);

create index if not exists idx_conf_volume_avulso_itens_conf_coddv
    on app.conf_volume_avulso_itens(conf_id, coddv);

create index if not exists idx_conf_volume_avulso_itens_nr_volume
    on app.conf_volume_avulso_itens(nr_volume);

create index if not exists idx_conf_volume_avulso_itens_conf_nr_volume
    on app.conf_volume_avulso_itens(conf_id, nr_volume);

create index if not exists idx_app_db_avulso_cd_nr_volume
    on app.db_avulso(cd, nr_volume);

create index if not exists idx_app_db_avulso_cd_id_mov_nr_volume
    on app.db_avulso(cd, id_mov, nr_volume);

create or replace function app.conf_volume_avulso_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create or replace function app.conf_volume_avulso_itens_fill_nr_volume()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_nr_volume text;
begin
    if new.conf_id is null then
        raise exception 'CONF_ID_OBRIGATORIO';
    end if;

    select c.nr_volume
    into v_nr_volume
    from app.conf_volume_avulso c
    where c.conf_id = new.conf_id
    limit 1;

    if nullif(trim(coalesce(v_nr_volume, '')), '') is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    new.nr_volume := v_nr_volume;
    return new;
end;
$$;

drop trigger if exists trg_conf_volume_avulso_touch_updated_at on app.conf_volume_avulso;
create trigger trg_conf_volume_avulso_touch_updated_at
before update on app.conf_volume_avulso
for each row
execute function app.conf_volume_avulso_touch_updated_at();

drop trigger if exists trg_conf_volume_avulso_itens_touch_updated_at on app.conf_volume_avulso_itens;
create trigger trg_conf_volume_avulso_itens_touch_updated_at
before update on app.conf_volume_avulso_itens
for each row
execute function app.conf_volume_avulso_touch_updated_at();

drop trigger if exists trg_conf_volume_avulso_itens_fill_nr_volume on app.conf_volume_avulso_itens;
create trigger trg_conf_volume_avulso_itens_fill_nr_volume
before insert or update of conf_id, nr_volume
on app.conf_volume_avulso_itens
for each row
execute function app.conf_volume_avulso_itens_fill_nr_volume();

alter table app.conf_volume_avulso_itens
    alter column nr_volume set not null;

alter table app.conf_volume_avulso enable row level security;
alter table app.conf_volume_avulso_itens enable row level security;

revoke all on app.conf_volume_avulso from anon;
revoke all on app.conf_volume_avulso from authenticated;
revoke all on app.conf_volume_avulso_itens from anon;
revoke all on app.conf_volume_avulso_itens from authenticated;

drop policy if exists p_conf_volume_avulso_select on app.conf_volume_avulso;
drop policy if exists p_conf_volume_avulso_insert on app.conf_volume_avulso;
drop policy if exists p_conf_volume_avulso_update on app.conf_volume_avulso;
drop policy if exists p_conf_volume_avulso_delete on app.conf_volume_avulso;

create policy p_conf_volume_avulso_select
on app.conf_volume_avulso
for select
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_conf_volume_avulso_insert
on app.conf_volume_avulso
for insert
with check (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_conf_volume_avulso_update
on app.conf_volume_avulso
for update
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
)
with check (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_conf_volume_avulso_delete
on app.conf_volume_avulso
for delete
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_volume_avulso_itens_select on app.conf_volume_avulso_itens;
drop policy if exists p_conf_volume_avulso_itens_insert on app.conf_volume_avulso_itens;
drop policy if exists p_conf_volume_avulso_itens_update on app.conf_volume_avulso_itens;
drop policy if exists p_conf_volume_avulso_itens_delete on app.conf_volume_avulso_itens;

create policy p_conf_volume_avulso_itens_select
on app.conf_volume_avulso_itens
for select
using (
    exists (
        select 1
        from app.conf_volume_avulso c
        where c.conf_id = conf_volume_avulso_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_volume_avulso_itens_insert
on app.conf_volume_avulso_itens
for insert
with check (
    exists (
        select 1
        from app.conf_volume_avulso c
        where c.conf_id = conf_volume_avulso_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_volume_avulso_itens_update
on app.conf_volume_avulso_itens
for update
using (
    exists (
        select 1
        from app.conf_volume_avulso c
        where c.conf_id = conf_volume_avulso_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
)
with check (
    exists (
        select 1
        from app.conf_volume_avulso c
        where c.conf_id = conf_volume_avulso_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_volume_avulso_itens_delete
on app.conf_volume_avulso_itens
for delete
using (
    exists (
        select 1
        from app.conf_volume_avulso c
        where c.conf_id = conf_volume_avulso_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

drop function if exists public.rpc_conf_volume_avulso_manifest_meta(integer);
drop function if exists public.rpc_conf_volume_avulso_manifest_items_page(integer, integer, integer);
drop function if exists public.rpc_conf_volume_avulso_manifest_barras_page(integer, integer, integer);
drop function if exists public.rpc_conf_volume_avulso_route_overview(integer);
drop function if exists public.rpc_conf_volume_avulso_open_volume(text, integer);
drop function if exists public.rpc_conf_volume_avulso_get_active_volume();
drop function if exists public.rpc_conf_volume_avulso_get_items(uuid);
drop function if exists public.rpc_conf_volume_avulso_get_items_v2(uuid);
drop function if exists public.rpc_conf_volume_avulso_scan_barcode(uuid, text, integer);
drop function if exists public.rpc_conf_volume_avulso_set_item_qtd(uuid, integer, integer);
drop function if exists public.rpc_conf_volume_avulso_reset_item(uuid, integer);
drop function if exists public.rpc_conf_volume_avulso_sync_snapshot(uuid, jsonb);
drop function if exists public.rpc_conf_volume_avulso_finalize(uuid, text);
drop function if exists public.rpc_conf_volume_avulso_cancel(uuid);

create or replace function app.conf_volume_avulso_resolve_cd(p_cd integer default null)
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

create or replace function app.conf_volume_avulso_autoclose_stale()
returns integer
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_today date;
    v_closed integer := 0;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_today := (timezone('America/Sao_Paulo', now()))::date;

    update app.conf_volume_avulso c
    set
        status = 'finalizado_falta',
        falta_motivo = coalesce(
            nullif(trim(coalesce(c.falta_motivo, '')), ''),
            'Encerrado automaticamente por virada de dia.'
        ),
        finalized_at = coalesce(c.finalized_at, now()),
        updated_at = now()
    where c.status = 'em_conferencia'
      and c.conf_date < v_today;

    get diagnostics v_closed = row_count;
    return coalesce(v_closed, 0);
end;
$$;
create or replace function public.rpc_conf_volume_avulso_manifest_meta(p_cd integer default null)
returns table (
    cd integer,
    row_count bigint,
    etiquetas_count bigint,
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
    v_etiquetas bigint;
    v_source_run_id uuid;
    v_updated_at timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);

    select
        count(*)::bigint,
        count(distinct t.nr_volume)::bigint,
        max(t.updated_at)
    into
        v_row_count,
        v_etiquetas,
        v_updated_at
    from app.db_avulso t
    where t.cd = v_cd
      and nullif(trim(coalesce(t.nr_volume, '')), '') is not null;

    if coalesce(v_row_count, 0) = 0 then
        raise exception 'BASE_AVULSO_VAZIA';
    end if;

    select t.source_run_id
    into v_source_run_id
    from app.db_avulso t
    where t.cd = v_cd
      and nullif(trim(coalesce(t.nr_volume, '')), '') is not null
      and t.source_run_id is not null
    order by t.updated_at desc nulls last
    limit 1;

    return query
    select
        v_cd,
        v_row_count,
        v_etiquetas,
        v_source_run_id,
        md5(
            concat_ws(
                ':',
                coalesce(v_source_run_id::text, ''),
                v_row_count::text,
                v_etiquetas::text,
                coalesce(v_updated_at::text, '')
            )
        ),
        now();
end;
$$;

create or replace function public.rpc_conf_volume_avulso_manifest_items_page(
    p_cd integer default null,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    nr_volume text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    coddv integer,
    descricao text,
    qtd_esperada integer
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

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 2000);

    return query
    select
        t.nr_volume,
        null::text as caixa,
        null::bigint as pedido,
        null::bigint as filial,
        null::text as filial_nome,
        null::text as rota,
        t.coddv,
        coalesce(
            min(nullif(trim(t.descricao), '')),
            format('CODDV %s', t.coddv)
        ) as descricao,
        greatest(sum(greatest(coalesce(t.qtd_mov, 0)::integer, 0))::integer, 1) as qtd_esperada
    from app.db_avulso t
    where t.cd = v_cd
      and nullif(trim(coalesce(t.nr_volume, '')), '') is not null
      and t.coddv is not null
    group by t.nr_volume, t.coddv
    order by t.nr_volume, t.coddv
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_manifest_barras_page(
    p_cd integer default null,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    barras text,
    coddv integer,
    descricao text,
    updated_at timestamptz
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

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 3000);

    return query
    with needed as (
        select distinct t.coddv
        from app.db_avulso t
        where t.cd = v_cd
          and nullif(trim(coalesce(t.nr_volume, '')), '') is not null
          and t.coddv is not null
    )
    select
        b.barras,
        b.coddv,
        b.descricao,
        b.updated_at
    from app.db_barras b
    join needed n
      on n.coddv = b.coddv
    where nullif(trim(coalesce(b.barras, '')), '') is not null
    order by b.barras, b.updated_at desc nulls last
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_route_overview(p_cd integer default null)
returns table (
    rota text,
    filial bigint,
    filial_nome text,
    total_etiquetas integer,
    conferidas integer,
    pendentes integer,
    status text,
    colaborador_nome text,
    colaborador_mat text,
    status_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_today date;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    return query
    with base as (
        select
            count(distinct t.nr_volume)::integer as total_etiquetas
        from app.db_avulso t
        where t.cd = v_cd
          and nullif(trim(coalesce(t.nr_volume, '')), '') is not null
    ),
    conf as (
        select
            count(distinct c.nr_volume) filter (
                where c.status in ('finalizado_ok', 'finalizado_falta')
            )::integer as conferidas,
            count(distinct c.nr_volume) filter (
                where c.status = 'em_conferencia'
            )::integer as em_andamento
        from app.conf_volume_avulso c
        where c.cd = v_cd
          and c.conf_date = v_today
    ),
    em_andamento_actor as (
        select
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat,
            c.started_at
        from app.conf_volume_avulso c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.status = 'em_conferencia'
        order by c.updated_at desc nulls last, c.started_at desc nulls last
        limit 1
    ),
    concluido_actor as (
        select
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat,
            c.finalized_at
        from app.conf_volume_avulso c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.status in ('finalizado_ok', 'finalizado_falta')
        order by c.finalized_at desc nulls last, c.updated_at desc nulls last
        limit 1
    )
    select
        'SEM ROTA'::text as rota,
        null::bigint as filial,
        'SEM FILIAL'::text as filial_nome,
        coalesce(b.total_etiquetas, 0)::integer as total_etiquetas,
        coalesce(c.conferidas, 0)::integer as conferidas,
        greatest(coalesce(b.total_etiquetas, 0) - coalesce(c.conferidas, 0), 0)::integer as pendentes,
        case
            when coalesce(b.total_etiquetas, 0) > 0 and coalesce(c.conferidas, 0) >= coalesce(b.total_etiquetas, 0) then 'concluido'
            when coalesce(c.em_andamento, 0) > 0 then 'em_andamento'
            when coalesce(c.conferidas, 0) > 0 then 'em_andamento'
            else 'pendente'
        end as status,
        case
            when coalesce(b.total_etiquetas, 0) > 0 and coalesce(c.conferidas, 0) >= coalesce(b.total_etiquetas, 0) then ca.colaborador_nome
            when coalesce(c.em_andamento, 0) > 0 then ea.colaborador_nome
            when coalesce(c.conferidas, 0) > 0 then ca.colaborador_nome
            else null
        end as colaborador_nome,
        case
            when coalesce(b.total_etiquetas, 0) > 0 and coalesce(c.conferidas, 0) >= coalesce(b.total_etiquetas, 0) then ca.colaborador_mat
            when coalesce(c.em_andamento, 0) > 0 then ea.colaborador_mat
            when coalesce(c.conferidas, 0) > 0 then ca.colaborador_mat
            else null
        end as colaborador_mat,
        case
            when coalesce(b.total_etiquetas, 0) > 0 and coalesce(c.conferidas, 0) >= coalesce(b.total_etiquetas, 0) then ca.finalized_at
            when coalesce(c.em_andamento, 0) > 0 then ea.started_at
            when coalesce(c.conferidas, 0) > 0 then ca.finalized_at
            else null
        end as status_at
    from base b
    cross join conf c
    left join em_andamento_actor ea
      on true
    left join concluido_actor ca
      on true;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_get_active_volume()
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    nr_volume text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    status text,
    falta_motivo text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_today date;
    v_conf app.conf_volume_avulso%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_volume_avulso_autoclose_stale();
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_conf.conf_id is null then
        return;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.nr_volume,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        false as is_read_only
    from app.conf_volume_avulso c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;
create or replace function public.rpc_conf_volume_avulso_open_volume(
    p_nr_volume text,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    nr_volume text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    status text,
    falta_motivo text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_tag text;
    v_today date;
    v_profile record;
    v_conf app.conf_volume_avulso%rowtype;
    v_user_active app.conf_volume_avulso%rowtype;
    v_read_only boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_volume_avulso_autoclose_stale();

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);
    v_tag := nullif(trim(coalesce(p_nr_volume, '')), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'VOLUME_OBRIGATORIO';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    select *
    into v_user_active
    from app.conf_volume_avulso c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and (v_user_active.cd <> v_cd or v_user_active.nr_volume <> v_tag) then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRO_VOLUME';
    end if;

    if not exists (
        select 1
        from app.db_avulso t
        where t.cd = v_cd
          and t.nr_volume = v_tag
    ) then
        raise exception 'VOLUME_NAO_ENCONTRADO';
    end if;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.nr_volume = v_tag
    limit 1;

    if found then
        if v_conf.started_by <> v_uid then
            if v_conf.status = 'em_conferencia' then
                raise exception 'VOLUME_EM_USO';
            end if;
            raise exception 'VOLUME_JA_CONFERIDO_OUTRO_USUARIO';
        end if;
        v_read_only := v_conf.status <> 'em_conferencia';
    else
        insert into app.conf_volume_avulso (
            conf_date,
            cd,
            nr_volume,
            caixa,
            pedido,
            filial,
            filial_nome,
            rota,
            started_by,
            started_mat,
            started_nome,
            status,
            falta_motivo,
            started_at,
            finalized_at,
            updated_at
        )
        values (
            v_today,
            v_cd,
            v_tag,
            null,
            null,
            null,
            null,
            null,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            null,
            now(),
            null,
            now()
        )
        returning * into v_conf;

        insert into app.conf_volume_avulso_itens (
            conf_id,
            nr_volume,
            coddv,
            barras,
            descricao,
            qtd_esperada,
            qtd_conferida,
            updated_at
        )
        select
            v_conf.conf_id,
            v_tag,
            t.coddv,
            null,
            coalesce(
                min(nullif(trim(t.descricao), '')),
                format('CODDV %s', t.coddv)
            ),
            greatest(sum(greatest(coalesce(t.qtd_mov, 0)::integer, 0))::integer, 1),
            0,
            now()
        from app.db_avulso t
        where t.cd = v_cd
          and t.nr_volume = v_tag
          and t.coddv is not null
        group by t.coddv
        on conflict on constraint uq_conf_volume_avulso_itens
        do update set
            nr_volume = excluded.nr_volume,
            descricao = excluded.descricao,
            qtd_esperada = excluded.qtd_esperada,
            updated_at = now();

        v_read_only := false;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.nr_volume,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_volume_avulso c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_get_items(p_conf_id uuid)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    descricao text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_volume_avulso%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    return query
    select
        i.item_id,
        i.conf_id,
        i.coddv,
        i.descricao,
        i.qtd_esperada,
        i.qtd_conferida,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at
    from app.conf_volume_avulso_itens i
    where i.conf_id = v_conf.conf_id
    order by
        case
            when i.qtd_conferida < i.qtd_esperada then 1
            when i.qtd_conferida > i.qtd_esperada then 2
            else 3
        end,
        i.coddv;
end;
$$;
create or replace function public.rpc_conf_volume_avulso_scan_barcode(
    p_conf_id uuid,
    p_barras text,
    p_qtd integer default 1
)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    descricao text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_volume_avulso%rowtype;
    v_barras text;
    v_coddv integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if coalesce(p_qtd, 0) <= 0 then
        raise exception 'QTD_INVALIDA';
    end if;

    v_barras := regexp_replace(coalesce(p_barras, ''), '\s+', '', 'g');
    if v_barras = '' then
        raise exception 'BARRAS_OBRIGATORIA';
    end if;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_JA_FINALIZADA';
    end if;

    select b.coddv
    into v_coddv
    from app.db_barras b
    where b.barras = v_barras
    order by b.updated_at desc nulls last, b.coddv
    limit 1;

    if v_coddv is null then
        raise exception 'BARRAS_NAO_ENCONTRADA';
    end if;

    update app.conf_volume_avulso_itens i
    set
        qtd_conferida = i.qtd_conferida + p_qtd,
        barras = v_barras,
        updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv;

    if not found then
        raise exception 'PRODUTO_FORA_DO_VOLUME';
    end if;

    update app.conf_volume_avulso c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

    return query
    select
        i.item_id,
        i.conf_id,
        i.coddv,
        i.descricao,
        i.qtd_esperada,
        i.qtd_conferida,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at
    from app.conf_volume_avulso_itens i
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv
    limit 1;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_set_item_qtd(
    p_conf_id uuid,
    p_coddv integer,
    p_qtd_conferida integer
)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    descricao text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_volume_avulso%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if p_qtd_conferida is null or p_qtd_conferida < 0 then
        raise exception 'QTD_INVALIDA';
    end if;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_JA_FINALIZADA';
    end if;

    update app.conf_volume_avulso_itens i
    set
        qtd_conferida = p_qtd_conferida,
        updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = p_coddv;

    if not found then
        raise exception 'ITEM_NAO_ENCONTRADO';
    end if;

    update app.conf_volume_avulso c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

    return query
    select
        i.item_id,
        i.conf_id,
        i.coddv,
        i.descricao,
        i.qtd_esperada,
        i.qtd_conferida,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at
    from app.conf_volume_avulso_itens i
    where i.conf_id = v_conf.conf_id
      and i.coddv = p_coddv
    limit 1;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_reset_item(
    p_conf_id uuid,
    p_coddv integer
)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    descricao text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    updated_at timestamptz
)
language sql
security definer
set search_path = app, authz, public
as $$
    select *
    from public.rpc_conf_volume_avulso_set_item_qtd(p_conf_id, p_coddv, 0);
$$;

create or replace function public.rpc_conf_volume_avulso_sync_snapshot(
    p_conf_id uuid,
    p_items jsonb
)
returns table (
    conf_id uuid,
    total_items integer,
    updated_items integer,
    falta_count integer,
    sobra_count integer,
    correto_count integer,
    status text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_volume_avulso%rowtype;
    v_payload jsonb;
    v_payload_count integer := 0;
    v_updated_count integer := 0;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_JA_FINALIZADA';
    end if;

    v_payload := coalesce(p_items, '[]'::jsonb);
    if jsonb_typeof(v_payload) <> 'array' then
        raise exception 'PAYLOAD_INVALIDO';
    end if;

    with raw as (
        select
            case
                when (elem ->> 'coddv') ~ '^[0-9]+$' then (elem ->> 'coddv')::integer
                else null
            end as coddv,
            case
                when (elem ->> 'qtd_conferida') ~ '^-?[0-9]+$' then greatest((elem ->> 'qtd_conferida')::integer, 0)
                else null
            end as qtd_conferida,
            nullif(regexp_replace(coalesce(elem ->> 'barras', ''), '\s+', '', 'g'), '') as barras
        from jsonb_array_elements(v_payload) elem
    ),
    payload as (
        select
            r.coddv,
            max(r.qtd_conferida)::integer as qtd_conferida,
            max(r.barras) as barras
        from raw r
        where r.coddv is not null
          and r.qtd_conferida is not null
        group by r.coddv
    ),
    updated as (
        update app.conf_volume_avulso_itens i
        set
            qtd_conferida = p.qtd_conferida,
            barras = coalesce(p.barras, i.barras),
            updated_at = now()
        from payload p
        where i.conf_id = v_conf.conf_id
          and i.coddv = p.coddv
        returning i.coddv
    )
    select
        (select count(*)::integer from payload),
        (select count(*)::integer from updated)
    into
        v_payload_count,
        v_updated_count;

    if v_payload_count <> v_updated_count then
        raise exception 'PRODUTO_FORA_DO_VOLUME';
    end if;

    update app.conf_volume_avulso c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

    return query
    with agg as (
        select
            count(*)::integer as total_items,
            count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer as falta_count,
            count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer as sobra_count,
            count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer as correto_count
        from app.conf_volume_avulso_itens i
        where i.conf_id = v_conf.conf_id
    )
    select
        v_conf.conf_id,
        a.total_items,
        v_updated_count,
        a.falta_count,
        a.sobra_count,
        a.correto_count,
        v_conf.status
    from agg a;
end;
$$;
create or replace function public.rpc_conf_volume_avulso_finalize(
    p_conf_id uuid,
    p_falta_motivo text default null
)
returns table (
    conf_id uuid,
    status text,
    falta_count integer,
    sobra_count integer,
    correto_count integer,
    falta_motivo text,
    finalized_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_volume_avulso%rowtype;
    v_falta_count integer;
    v_sobra_count integer;
    v_correto_count integer;
    v_status text;
    v_motivo text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_JA_FINALIZADA';
    end if;

    select
        count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer
    into
        v_falta_count,
        v_sobra_count,
        v_correto_count
    from app.conf_volume_avulso_itens i
    where i.conf_id = v_conf.conf_id;

    if coalesce(v_sobra_count, 0) > 0 then
        raise exception 'SOBRA_PENDENTE';
    end if;

    v_motivo := nullif(trim(coalesce(p_falta_motivo, '')), '');
    if coalesce(v_falta_count, 0) > 0 and v_motivo is null then
        raise exception 'FALTA_MOTIVO_OBRIGATORIO';
    end if;

    v_status := case
        when coalesce(v_falta_count, 0) > 0 then 'finalizado_falta'
        else 'finalizado_ok'
    end;

    update app.conf_volume_avulso c
    set
        status = v_status,
        falta_motivo = case when v_status = 'finalizado_falta' then v_motivo else null end,
        finalized_at = now(),
        updated_at = now()
    where c.conf_id = v_conf.conf_id
    returning * into v_conf;

    return query
    select
        v_conf.conf_id,
        v_conf.status,
        coalesce(v_falta_count, 0),
        coalesce(v_sobra_count, 0),
        coalesce(v_correto_count, 0),
        v_conf.falta_motivo,
        v_conf.finalized_at;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_cancel(
    p_conf_id uuid
)
returns table (
    conf_id uuid,
    cancelled boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_volume_avulso%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and c.status = 'em_conferencia'
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA';
    end if;

    delete from app.conf_volume_avulso c
    where c.conf_id = v_conf.conf_id;

    return query
    select
        v_conf.conf_id,
        true;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_get_items_v2(p_conf_id uuid)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    barras text,
    descricao text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_volume_avulso%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    return query
    select
        i.item_id,
        i.conf_id,
        i.coddv,
        i.barras,
        i.descricao,
        i.qtd_esperada,
        i.qtd_conferida,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at
    from app.conf_volume_avulso_itens i
    where i.conf_id = v_conf.conf_id
    order by
        case
            when i.qtd_conferida < i.qtd_esperada then 1
            when i.qtd_conferida > i.qtd_esperada then 2
            else 3
        end,
        i.coddv;
end;
$$;

grant execute on function public.rpc_conf_volume_avulso_manifest_meta(integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_manifest_items_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_manifest_barras_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_route_overview(integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_open_volume(text, integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_get_active_volume() to authenticated;
grant execute on function public.rpc_conf_volume_avulso_get_items(uuid) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_get_items_v2(uuid) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_scan_barcode(uuid, text, integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_set_item_qtd(uuid, integer, integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_reset_item(uuid, integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_sync_snapshot(uuid, jsonb) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_finalize(uuid, text) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_cancel(uuid) to authenticated;
