create table if not exists app.conf_entrada_notas (
    conf_id uuid primary key default gen_random_uuid(),
    conf_date date not null default (timezone('America/Sao_Paulo', now()))::date,
    cd integer not null,
    seq_entrada bigint not null,
    nf bigint not null,
    transportadora text,
    fornecedor text,
    started_by uuid not null references auth.users(id) on delete restrict,
    started_mat text not null,
    started_nome text not null,
    status text not null default 'em_conferencia'
        check (status in ('em_conferencia', 'finalizado_ok', 'finalizado_divergencia')),
    started_at timestamptz not null default now(),
    finalized_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint uq_conf_entrada_notas_daily unique (conf_date, cd, seq_entrada, nf)
);

create table if not exists app.conf_entrada_notas_itens (
    item_id uuid primary key default gen_random_uuid(),
    conf_id uuid not null references app.conf_entrada_notas(conf_id) on delete cascade,
    seq_entrada bigint,
    nf bigint,
    coddv integer not null,
    barras text,
    descricao text not null,
    qtd_esperada integer not null check (qtd_esperada > 0),
    qtd_conferida integer not null default 0 check (qtd_conferida >= 0),
    updated_at timestamptz not null default now(),
    constraint uq_conf_entrada_notas_itens unique (conf_id, coddv)
);

create table if not exists app.conf_entrada_notas_itens_conferidos (
    conf_id uuid not null references app.conf_entrada_notas(conf_id) on delete cascade,
    item_id uuid not null references app.conf_entrada_notas_itens(item_id) on delete cascade,
    seq_entrada bigint not null,
    nf bigint not null,
    coddv integer not null,
    barras text,
    descricao text not null,
    qtd_conferida integer not null check (qtd_conferida > 0),
    divergencia_tipo text not null check (divergencia_tipo in ('falta', 'sobra', 'correto')),
    updated_at timestamptz not null default now(),
    constraint pk_conf_entrada_notas_itens_conferidos primary key (conf_id, coddv),
    constraint uq_conf_entrada_notas_itens_conferidos_item unique (item_id)
);

alter table app.conf_entrada_notas_itens
    add column if not exists barras text;

alter table app.conf_entrada_notas_itens
    add column if not exists seq_entrada bigint;

alter table app.conf_entrada_notas_itens
    add column if not exists nf bigint;

update app.conf_entrada_notas_itens i
set
    seq_entrada = c.seq_entrada,
    nf = c.nf
from app.conf_entrada_notas c
where c.conf_id = i.conf_id
  and (
      i.seq_entrada is distinct from c.seq_entrada
      or i.nf is distinct from c.nf
  );

alter table app.conf_entrada_notas_itens
    alter column seq_entrada set not null;

alter table app.conf_entrada_notas_itens
    alter column nf set not null;

create index if not exists idx_conf_entrada_notas_cd_date_status
    on app.conf_entrada_notas(cd, conf_date, status);

create index if not exists idx_conf_entrada_notas_started_by_date
    on app.conf_entrada_notas(started_by, conf_date desc, updated_at desc);

create index if not exists idx_conf_entrada_notas_transportadora_fornecedor
    on app.conf_entrada_notas(cd, conf_date, transportadora, fornecedor);

create index if not exists idx_conf_entrada_notas_itens_conf
    on app.conf_entrada_notas_itens(conf_id);

create index if not exists idx_conf_entrada_notas_itens_conf_coddv
    on app.conf_entrada_notas_itens(conf_id, coddv);

create index if not exists idx_conf_entrada_notas_itens_seq_nf
    on app.conf_entrada_notas_itens(seq_entrada, nf);

create index if not exists idx_conf_entrada_notas_itens_conferidos_conf
    on app.conf_entrada_notas_itens_conferidos(conf_id);

create index if not exists idx_conf_entrada_notas_itens_conferidos_item
    on app.conf_entrada_notas_itens_conferidos(item_id);

create index if not exists idx_conf_entrada_notas_itens_conferidos_seq_nf
    on app.conf_entrada_notas_itens_conferidos(seq_entrada, nf);

create index if not exists idx_app_db_entrada_notas_cd_seq_nf
    on app.db_entrada_notas(cd, seq_entrada, nf);

create index if not exists idx_app_db_entrada_notas_cd_coddv
    on app.db_entrada_notas(cd, coddv);

create index if not exists idx_app_db_entrada_notas_cd_transp_forn
    on app.db_entrada_notas(cd, transportadora, forn);

create or replace function app.conf_entrada_notas_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create or replace function app.conf_entrada_notas_itens_fill_refs()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_seq bigint;
    v_nf bigint;
begin
    if new.conf_id is null then
        raise exception 'CONF_ID_OBRIGATORIO';
    end if;

    select c.seq_entrada, c.nf
    into v_seq, v_nf
    from app.conf_entrada_notas c
    where c.conf_id = new.conf_id
    limit 1;

    if v_seq is null or v_nf is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    new.seq_entrada := v_seq;
    new.nf := v_nf;
    return new;
end;
$$;

create or replace function app.conf_entrada_notas_itens_sync_conferidos()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_divergencia text;
begin
    if tg_op = 'DELETE' then
        delete from app.conf_entrada_notas_itens_conferidos c
        where c.conf_id = old.conf_id
          and c.coddv = old.coddv;
        return old;
    end if;

    if new.qtd_conferida > 0 then
        v_divergencia := case
            when new.qtd_conferida < new.qtd_esperada then 'falta'
            when new.qtd_conferida > new.qtd_esperada then 'sobra'
            else 'correto'
        end;

        insert into app.conf_entrada_notas_itens_conferidos (
            conf_id,
            item_id,
            seq_entrada,
            nf,
            coddv,
            barras,
            descricao,
            qtd_conferida,
            divergencia_tipo,
            updated_at
        )
        values (
            new.conf_id,
            new.item_id,
            new.seq_entrada,
            new.nf,
            new.coddv,
            new.barras,
            new.descricao,
            new.qtd_conferida,
            v_divergencia,
            now()
        )
        on conflict (conf_id, coddv)
        do update set
            item_id = excluded.item_id,
            seq_entrada = excluded.seq_entrada,
            nf = excluded.nf,
            barras = excluded.barras,
            descricao = excluded.descricao,
            qtd_conferida = excluded.qtd_conferida,
            divergencia_tipo = excluded.divergencia_tipo,
            updated_at = now();
    else
        delete from app.conf_entrada_notas_itens_conferidos c
        where c.conf_id = new.conf_id
          and c.coddv = new.coddv;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_conf_entrada_notas_touch_updated_at on app.conf_entrada_notas;
create trigger trg_conf_entrada_notas_touch_updated_at
before update on app.conf_entrada_notas
for each row
execute function app.conf_entrada_notas_touch_updated_at();

drop trigger if exists trg_conf_entrada_notas_itens_touch_updated_at on app.conf_entrada_notas_itens;
create trigger trg_conf_entrada_notas_itens_touch_updated_at
before update on app.conf_entrada_notas_itens
for each row
execute function app.conf_entrada_notas_touch_updated_at();

drop trigger if exists trg_conf_entrada_notas_itens_fill_refs on app.conf_entrada_notas_itens;
create trigger trg_conf_entrada_notas_itens_fill_refs
before insert or update of conf_id, seq_entrada, nf
on app.conf_entrada_notas_itens
for each row
execute function app.conf_entrada_notas_itens_fill_refs();

drop trigger if exists trg_conf_entrada_notas_itens_sync_conferidos on app.conf_entrada_notas_itens;
create trigger trg_conf_entrada_notas_itens_sync_conferidos
after insert or update of qtd_conferida, barras, descricao, updated_at or delete
on app.conf_entrada_notas_itens
for each row
execute function app.conf_entrada_notas_itens_sync_conferidos();

alter table app.conf_entrada_notas enable row level security;
alter table app.conf_entrada_notas_itens enable row level security;
alter table app.conf_entrada_notas_itens_conferidos enable row level security;

revoke all on app.conf_entrada_notas from anon;
revoke all on app.conf_entrada_notas from authenticated;
revoke all on app.conf_entrada_notas_itens from anon;
revoke all on app.conf_entrada_notas_itens from authenticated;
revoke all on app.conf_entrada_notas_itens_conferidos from anon;
revoke all on app.conf_entrada_notas_itens_conferidos from authenticated;

drop policy if exists p_conf_entrada_notas_select on app.conf_entrada_notas;
drop policy if exists p_conf_entrada_notas_insert on app.conf_entrada_notas;
drop policy if exists p_conf_entrada_notas_update on app.conf_entrada_notas;
drop policy if exists p_conf_entrada_notas_delete on app.conf_entrada_notas;

create policy p_conf_entrada_notas_select
on app.conf_entrada_notas
for select
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_conf_entrada_notas_insert
on app.conf_entrada_notas
for insert
with check (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_conf_entrada_notas_update
on app.conf_entrada_notas
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

create policy p_conf_entrada_notas_delete
on app.conf_entrada_notas
for delete
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_entrada_notas_itens_select on app.conf_entrada_notas_itens;
drop policy if exists p_conf_entrada_notas_itens_insert on app.conf_entrada_notas_itens;
drop policy if exists p_conf_entrada_notas_itens_update on app.conf_entrada_notas_itens;
drop policy if exists p_conf_entrada_notas_itens_delete on app.conf_entrada_notas_itens;

create policy p_conf_entrada_notas_itens_select
on app.conf_entrada_notas_itens
for select
using (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_entrada_notas_itens_insert
on app.conf_entrada_notas_itens
for insert
with check (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_entrada_notas_itens_update
on app.conf_entrada_notas_itens
for update
using (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_itens.conf_id
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
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_entrada_notas_itens_delete
on app.conf_entrada_notas_itens
for delete
using (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

drop policy if exists p_conf_entrada_notas_itens_conf_select on app.conf_entrada_notas_itens_conferidos;
drop policy if exists p_conf_entrada_notas_itens_conf_insert on app.conf_entrada_notas_itens_conferidos;
drop policy if exists p_conf_entrada_notas_itens_conf_update on app.conf_entrada_notas_itens_conferidos;
drop policy if exists p_conf_entrada_notas_itens_conf_delete on app.conf_entrada_notas_itens_conferidos;

create policy p_conf_entrada_notas_itens_conf_select
on app.conf_entrada_notas_itens_conferidos
for select
using (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_itens_conferidos.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_entrada_notas_itens_conf_insert
on app.conf_entrada_notas_itens_conferidos
for insert
with check (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_itens_conferidos.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_entrada_notas_itens_conf_update
on app.conf_entrada_notas_itens_conferidos
for update
using (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_itens_conferidos.conf_id
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
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_itens_conferidos.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_entrada_notas_itens_conf_delete
on app.conf_entrada_notas_itens_conferidos
for delete
using (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_itens_conferidos.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

drop function if exists public.rpc_conf_entrada_notas_manifest_meta(integer);
drop function if exists public.rpc_conf_entrada_notas_manifest_items_page(integer, integer, integer);
drop function if exists public.rpc_conf_entrada_notas_manifest_barras_page(integer, integer, integer);
drop function if exists public.rpc_conf_entrada_notas_route_overview(integer);
drop function if exists public.rpc_conf_entrada_notas_open_conference(bigint, bigint, integer);
drop function if exists public.rpc_conf_entrada_notas_get_active_conference();
drop function if exists public.rpc_conf_entrada_notas_get_items(uuid);
drop function if exists public.rpc_conf_entrada_notas_get_items_v2(uuid);
drop function if exists public.rpc_conf_entrada_notas_scan_barcode(uuid, text, integer);
drop function if exists public.rpc_conf_entrada_notas_set_item_qtd(uuid, integer, integer);
drop function if exists public.rpc_conf_entrada_notas_reset_item(uuid, integer);
drop function if exists public.rpc_conf_entrada_notas_sync_snapshot(uuid, jsonb);
drop function if exists public.rpc_conf_entrada_notas_finalize(uuid);
drop function if exists public.rpc_conf_entrada_notas_cancel(uuid);

create or replace function app.conf_entrada_notas_resolve_cd(p_cd integer default null)
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

    if not authz.can_access_cd(v_uid, v_cd) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return v_cd;
end;
$$;

create or replace function app.conf_entrada_notas_autoclose_stale()
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

    update app.conf_entrada_notas c
    set
        status = 'finalizado_divergencia',
        finalized_at = coalesce(c.finalized_at, now()),
        updated_at = now()
    where c.status = 'em_conferencia'
      and c.conf_date < v_today;

    get diagnostics v_closed = row_count;
    return coalesce(v_closed, 0);
end;
$$;

create or replace function public.rpc_conf_entrada_notas_manifest_meta(p_cd integer default null)
returns table (
    cd integer,
    row_count bigint,
    sequencias_count bigint,
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
    v_seq_count bigint;
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

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);

    select
        count(*)::bigint,
        count(distinct format('%s|%s', t.seq_entrada, t.nf))::bigint,
        max(t.updated_at)
    into
        v_row_count,
        v_seq_count,
        v_updated_at
    from app.db_entrada_notas t
    where t.cd = v_cd
      and t.seq_entrada is not null
      and t.nf is not null;

    if coalesce(v_row_count, 0) = 0 then
        raise exception 'BASE_ENTRADA_NOTAS_VAZIA';
    end if;

    select t.source_run_id
    into v_source_run_id
    from app.db_entrada_notas t
    where t.cd = v_cd
      and t.seq_entrada is not null
      and t.nf is not null
      and t.source_run_id is not null
    order by t.updated_at desc nulls last
    limit 1;

    return query
    select
        v_cd,
        v_row_count,
        v_seq_count,
        v_source_run_id,
        md5(
            concat_ws(
                ':',
                coalesce(v_source_run_id::text, ''),
                v_row_count::text,
                v_seq_count::text,
                coalesce(v_updated_at::text, '')
            )
        ),
        now();
end;
$$;

create or replace function public.rpc_conf_entrada_notas_manifest_items_page(
    p_cd integer default null,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    seq_entrada bigint,
    nf bigint,
    transportadora text,
    fornecedor text,
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

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 2500);

    return query
    select
        t.seq_entrada,
        t.nf,
        coalesce(nullif(trim(t.transportadora), ''), 'SEM TRANSPORTADORA') as transportadora,
        coalesce(nullif(trim(t.forn), ''), 'SEM FORNECEDOR') as fornecedor,
        t.coddv,
        coalesce(
            min(nullif(trim(t.descricao), '')),
            format('CODDV %s', t.coddv)
        ) as descricao,
        greatest(sum(greatest(coalesce(t.qtd_total, 0)::integer, 0))::integer, 1) as qtd_esperada
    from app.db_entrada_notas t
    where t.cd = v_cd
      and t.seq_entrada is not null
      and t.nf is not null
      and t.coddv is not null
    group by
        t.seq_entrada,
        t.nf,
        coalesce(nullif(trim(t.transportadora), ''), 'SEM TRANSPORTADORA'),
        coalesce(nullif(trim(t.forn), ''), 'SEM FORNECEDOR'),
        t.coddv
    order by t.seq_entrada, t.nf, t.coddv
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_manifest_barras_page(
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

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 3500);

    return query
    with needed as (
        select distinct t.coddv
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada is not null
          and t.nf is not null
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

create or replace function public.rpc_conf_entrada_notas_route_overview(p_cd integer default null)
returns table (
    transportadora text,
    fornecedor text,
    seq_entrada bigint,
    nf bigint,
    total_itens integer,
    itens_conferidos integer,
    itens_divergentes integer,
    status text,
    colaborador_nome text,
    colaborador_mat text,
    status_at timestamptz,
    produtos_multiplos_seq integer
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

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    return query
    with entrada_itens as (
        select
            t.seq_entrada,
            t.nf,
            coalesce(nullif(trim(t.transportadora), ''), 'SEM TRANSPORTADORA') as transportadora,
            coalesce(nullif(trim(t.forn), ''), 'SEM FORNECEDOR') as fornecedor,
            t.coddv
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada is not null
          and t.nf is not null
          and t.coddv is not null
        group by
            t.seq_entrada,
            t.nf,
            coalesce(nullif(trim(t.transportadora), ''), 'SEM TRANSPORTADORA'),
            coalesce(nullif(trim(t.forn), ''), 'SEM FORNECEDOR'),
            t.coddv
    ),
    coddv_seq_count as (
        select
            e.coddv,
            count(distinct format('%s|%s', e.seq_entrada, e.nf))::integer as seq_count
        from entrada_itens e
        group by e.coddv
    ),
    base as (
        select
            e.transportadora,
            e.fornecedor,
            e.seq_entrada,
            e.nf,
            count(*)::integer as total_itens,
            count(*) filter (where c.seq_count > 1)::integer as produtos_multiplos_seq
        from entrada_itens e
        join coddv_seq_count c
          on c.coddv = e.coddv
        group by
            e.transportadora,
            e.fornecedor,
            e.seq_entrada,
            e.nf
    ),
    conf as (
        select
            c.seq_entrada,
            c.nf,
            c.status,
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat,
            c.started_at,
            c.finalized_at,
            (
                select count(*)::integer
                from app.conf_entrada_notas_itens i
                where i.conf_id = c.conf_id
                  and i.qtd_conferida > 0
            ) as itens_conferidos,
            (
                select count(*)::integer
                from app.conf_entrada_notas_itens i
                where i.conf_id = c.conf_id
                  and i.qtd_conferida <> i.qtd_esperada
            ) as itens_divergentes
        from app.conf_entrada_notas c
        where c.cd = v_cd
          and c.conf_date = v_today
    )
    select
        b.transportadora,
        b.fornecedor,
        b.seq_entrada,
        b.nf,
        b.total_itens,
        coalesce(c.itens_conferidos, 0)::integer as itens_conferidos,
        coalesce(c.itens_divergentes, 0)::integer as itens_divergentes,
        case
            when c.status in ('finalizado_ok', 'finalizado_divergencia') then 'concluido'
            when c.status = 'em_conferencia' then 'em_andamento'
            else 'pendente'
        end as status,
        c.colaborador_nome,
        c.colaborador_mat,
        case
            when c.status in ('finalizado_ok', 'finalizado_divergencia') then c.finalized_at
            when c.status = 'em_conferencia' then c.started_at
            else null
        end as status_at,
        coalesce(b.produtos_multiplos_seq, 0)::integer as produtos_multiplos_seq
    from base b
    left join conf c
      on c.seq_entrada = b.seq_entrada
     and c.nf = b.nf
    order by b.transportadora, b.fornecedor, b.seq_entrada, b.nf;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_get_active_conference()
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    seq_entrada bigint,
    nf bigint,
    transportadora text,
    fornecedor text,
    status text,
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
    v_conf app.conf_entrada_notas%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_entrada_notas_autoclose_stale();
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    select *
    into v_conf
    from app.conf_entrada_notas c
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
        c.seq_entrada,
        c.nf,
        c.transportadora,
        c.fornecedor,
        c.status,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        false as is_read_only
    from app.conf_entrada_notas c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_open_conference(
    p_seq_entrada bigint,
    p_nf bigint,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    seq_entrada bigint,
    nf bigint,
    transportadora text,
    fornecedor text,
    status text,
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
    v_seq bigint;
    v_nf bigint;
    v_today date;
    v_profile record;
    v_conf app.conf_entrada_notas%rowtype;
    v_user_active app.conf_entrada_notas%rowtype;
    v_read_only boolean;
    v_transportadora text;
    v_fornecedor text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_entrada_notas_autoclose_stale();

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);
    v_seq := p_seq_entrada;
    v_nf := p_nf;
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_seq is null or v_nf is null then
        raise exception 'SEQ_OU_NF_OBRIGATORIO';
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
    from app.conf_entrada_notas c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and (
          v_user_active.cd <> v_cd
          or v_user_active.seq_entrada <> v_seq
          or v_user_active.nf <> v_nf
       ) then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_ENTRADA';
    end if;

    if not exists (
        select 1
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada = v_seq
          and t.nf = v_nf
    ) then
        raise exception 'ENTRADA_NAO_ENCONTRADA';
    end if;

    select *
    into v_conf
    from app.conf_entrada_notas c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.seq_entrada = v_seq
      and c.nf = v_nf
    limit 1;

    if found then
        if v_conf.started_by <> v_uid then
            if v_conf.status = 'em_conferencia' then
                raise exception 'CONFERENCIA_EM_USO';
            end if;
            raise exception 'CONFERENCIA_JA_FINALIZADA_OUTRO_USUARIO';
        end if;
        v_read_only := v_conf.status <> 'em_conferencia';
    else
        select
            coalesce(min(nullif(trim(t.transportadora), '')), 'SEM TRANSPORTADORA'),
            coalesce(min(nullif(trim(t.forn), '')), 'SEM FORNECEDOR')
        into
            v_transportadora,
            v_fornecedor
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada = v_seq
          and t.nf = v_nf;

        insert into app.conf_entrada_notas (
            conf_date,
            cd,
            seq_entrada,
            nf,
            transportadora,
            fornecedor,
            started_by,
            started_mat,
            started_nome,
            status,
            started_at,
            finalized_at,
            updated_at
        )
        values (
            v_today,
            v_cd,
            v_seq,
            v_nf,
            v_transportadora,
            v_fornecedor,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            now(),
            null,
            now()
        )
        returning * into v_conf;

        insert into app.conf_entrada_notas_itens (
            conf_id,
            seq_entrada,
            nf,
            coddv,
            barras,
            descricao,
            qtd_esperada,
            qtd_conferida,
            updated_at
        )
        select
            v_conf.conf_id,
            v_seq,
            v_nf,
            t.coddv,
            null,
            coalesce(
                min(nullif(trim(t.descricao), '')),
                format('CODDV %s', t.coddv)
            ),
            greatest(sum(greatest(coalesce(t.qtd_total, 0)::integer, 0))::integer, 1),
            0,
            now()
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada = v_seq
          and t.nf = v_nf
          and t.coddv is not null
        group by t.coddv
        on conflict on constraint uq_conf_entrada_notas_itens
        do update set
            seq_entrada = excluded.seq_entrada,
            nf = excluded.nf,
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
        c.seq_entrada,
        c.nf,
        c.transportadora,
        c.fornecedor,
        c.status,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_entrada_notas c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_get_items(p_conf_id uuid)
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
    v_conf app.conf_entrada_notas%rowtype;
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
    from app.conf_entrada_notas c
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
    from app.conf_entrada_notas_itens i
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

create or replace function public.rpc_conf_entrada_notas_get_items_v2(p_conf_id uuid)
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
    v_conf app.conf_entrada_notas%rowtype;
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
    from app.conf_entrada_notas c
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
    from app.conf_entrada_notas_itens i
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

create or replace function public.rpc_conf_entrada_notas_scan_barcode(
    p_conf_id uuid,
    p_barras text,
    p_qtd integer default 1
)
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
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_entrada_notas%rowtype;
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
    from app.conf_entrada_notas c
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

    if not exists (
        select 1
        from app.db_entrada_notas t
        where t.cd = v_conf.cd
          and t.coddv = v_coddv
    ) then
        raise exception 'PRODUTO_NAO_PERTENCE_A_NENHUM_RECEBIMENTO';
    end if;

    update app.conf_entrada_notas_itens i
    set
        qtd_conferida = i.qtd_conferida + p_qtd,
        barras = v_barras,
        updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv;

    if not found then
        raise exception 'PRODUTO_FORA_DA_ENTRADA';
    end if;

    update app.conf_entrada_notas c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

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
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv
    limit 1;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_set_item_qtd(
    p_conf_id uuid,
    p_coddv integer,
    p_qtd_conferida integer
)
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
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_entrada_notas%rowtype;
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
    from app.conf_entrada_notas c
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

    update app.conf_entrada_notas_itens i
    set
        qtd_conferida = p_qtd_conferida,
        updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = p_coddv;

    if not found then
        raise exception 'ITEM_NAO_ENCONTRADO';
    end if;

    update app.conf_entrada_notas c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

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
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_conf.conf_id
      and i.coddv = p_coddv
    limit 1;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_reset_item(
    p_conf_id uuid,
    p_coddv integer
)
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
language sql
security definer
set search_path = app, authz, public
as $$
    select *
    from public.rpc_conf_entrada_notas_set_item_qtd(p_conf_id, p_coddv, 0);
$$;

create or replace function public.rpc_conf_entrada_notas_sync_snapshot(
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
    v_conf app.conf_entrada_notas%rowtype;
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
    from app.conf_entrada_notas c
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
        update app.conf_entrada_notas_itens i
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
        raise exception 'PRODUTO_FORA_DA_ENTRADA';
    end if;

    update app.conf_entrada_notas c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

    return query
    with agg as (
        select
            count(*)::integer as total_items,
            count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer as falta_count,
            count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer as sobra_count,
            count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer as correto_count
        from app.conf_entrada_notas_itens i
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

create or replace function public.rpc_conf_entrada_notas_finalize(
    p_conf_id uuid
)
returns table (
    conf_id uuid,
    status text,
    falta_count integer,
    sobra_count integer,
    correto_count integer,
    finalized_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_entrada_notas%rowtype;
    v_falta_count integer;
    v_sobra_count integer;
    v_correto_count integer;
    v_status text;
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
    from app.conf_entrada_notas c
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
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_conf.conf_id;

    v_status := case
        when coalesce(v_falta_count, 0) > 0 or coalesce(v_sobra_count, 0) > 0 then 'finalizado_divergencia'
        else 'finalizado_ok'
    end;

    update app.conf_entrada_notas c
    set
        status = v_status,
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
        v_conf.finalized_at;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_cancel(
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
    v_conf app.conf_entrada_notas%rowtype;
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
    from app.conf_entrada_notas c
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

    delete from app.conf_entrada_notas c
    where c.conf_id = v_conf.conf_id;

    return query
    select
        v_conf.conf_id,
        true;
end;
$$;

grant execute on function public.rpc_conf_entrada_notas_manifest_meta(integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_manifest_items_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_manifest_barras_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_route_overview(integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_open_conference(bigint, bigint, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_get_active_conference() to authenticated;
grant execute on function public.rpc_conf_entrada_notas_get_items(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_get_items_v2(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_scan_barcode(uuid, text, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_set_item_qtd(uuid, integer, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_reset_item(uuid, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_sync_snapshot(uuid, jsonb) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_finalize(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_cancel(uuid) to authenticated;
