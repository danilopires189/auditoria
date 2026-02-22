create table if not exists app.conf_devolucao (
    conf_id uuid primary key default gen_random_uuid(),
    conf_date date not null default (timezone('America/Sao_Paulo', now()))::date,
    cd integer not null,
    conference_kind text not null default 'com_nfd'
        check (conference_kind in ('com_nfd', 'sem_nfd')),
    nfd bigint,
    chave text,
    source_motivo text,
    nfo text,
    motivo_sem_nfd text,
    status text not null default 'em_conferencia'
        check (status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')),
    falta_motivo text,
    started_by uuid not null references auth.users(id) on delete restrict,
    started_mat text not null,
    started_nome text not null,
    started_at timestamptz not null default now(),
    finalized_at timestamptz,
    updated_at timestamptz not null default now()
);

create table if not exists app.conf_devolucao_itens (
    item_id uuid primary key default gen_random_uuid(),
    conf_id uuid not null references app.conf_devolucao(conf_id) on delete cascade,
    coddv integer not null,
    barras text,
    descricao text not null,
    tipo text not null default 'UN',
    qtd_esperada integer not null default 0 check (qtd_esperada >= 0),
    qtd_conferida integer not null default 0 check (qtd_conferida >= 0),
    qtd_manual_total integer not null default 0 check (qtd_manual_total >= 0),
    updated_at timestamptz not null default now(),
    constraint uq_conf_devolucao_itens unique (conf_id, coddv)
);

create unique index if not exists uq_conf_devolucao_daily_ref
    on app.conf_devolucao (
        conf_date,
        cd,
        conference_kind,
        coalesce(nfd, -1),
        coalesce(chave, '')
    )
    where conference_kind = 'com_nfd';

create index if not exists idx_conf_devolucao_cd_date_status
    on app.conf_devolucao(cd, conf_date, status);

create index if not exists idx_conf_devolucao_cd_nfd
    on app.conf_devolucao(cd, nfd)
    where nfd is not null;

create index if not exists idx_conf_devolucao_cd_chave
    on app.conf_devolucao(cd, chave)
    where nullif(trim(coalesce(chave, '')), '') is not null;

create index if not exists idx_conf_devolucao_started_by_date
    on app.conf_devolucao(started_by, conf_date desc, updated_at desc);

create index if not exists idx_conf_devolucao_itens_conf
    on app.conf_devolucao_itens(conf_id);

create index if not exists idx_conf_devolucao_itens_conf_coddv
    on app.conf_devolucao_itens(conf_id, coddv);

create index if not exists idx_app_db_devolucao_cd_chave
    on app.db_devolucao(cd, chave);

create index if not exists idx_app_db_devolucao_cd_nfd
    on app.db_devolucao(cd, nfd);

create index if not exists idx_app_db_devolucao_cd_coddv
    on app.db_devolucao(cd, coddv);

create index if not exists idx_app_db_barras_barras
    on app.db_barras(barras);

create or replace function app.conf_devolucao_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_conf_devolucao_touch_updated_at on app.conf_devolucao;
create trigger trg_conf_devolucao_touch_updated_at
before update on app.conf_devolucao
for each row
execute function app.conf_devolucao_touch_updated_at();

drop trigger if exists trg_conf_devolucao_itens_touch_updated_at on app.conf_devolucao_itens;
create trigger trg_conf_devolucao_itens_touch_updated_at
before update on app.conf_devolucao_itens
for each row
execute function app.conf_devolucao_touch_updated_at();

alter table app.conf_devolucao enable row level security;
alter table app.conf_devolucao_itens enable row level security;

revoke all on app.conf_devolucao from anon;
revoke all on app.conf_devolucao from authenticated;
revoke all on app.conf_devolucao_itens from anon;
revoke all on app.conf_devolucao_itens from authenticated;

drop policy if exists p_conf_devolucao_select on app.conf_devolucao;
drop policy if exists p_conf_devolucao_insert on app.conf_devolucao;
drop policy if exists p_conf_devolucao_update on app.conf_devolucao;
drop policy if exists p_conf_devolucao_delete on app.conf_devolucao;

create policy p_conf_devolucao_select
on app.conf_devolucao
for select
using (
    authz.session_is_recent(6)
    and (
        started_by = auth.uid()
        or (
            authz.is_admin(auth.uid())
            and authz.can_access_cd(auth.uid(), cd)
        )
    )
);

create policy p_conf_devolucao_insert
on app.conf_devolucao
for insert
with check (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_conf_devolucao_update
on app.conf_devolucao
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

create policy p_conf_devolucao_delete
on app.conf_devolucao
for delete
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_devolucao_itens_select on app.conf_devolucao_itens;
drop policy if exists p_conf_devolucao_itens_insert on app.conf_devolucao_itens;
drop policy if exists p_conf_devolucao_itens_update on app.conf_devolucao_itens;
drop policy if exists p_conf_devolucao_itens_delete on app.conf_devolucao_itens;

create policy p_conf_devolucao_itens_select
on app.conf_devolucao_itens
for select
using (
    exists (
        select 1
        from app.conf_devolucao c
        where c.conf_id = conf_devolucao_itens.conf_id
          and authz.session_is_recent(6)
          and (
              c.started_by = auth.uid()
              or (
                  authz.is_admin(auth.uid())
                  and authz.can_access_cd(auth.uid(), c.cd)
              )
          )
    )
);

create policy p_conf_devolucao_itens_insert
on app.conf_devolucao_itens
for insert
with check (
    exists (
        select 1
        from app.conf_devolucao c
        where c.conf_id = conf_devolucao_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_devolucao_itens_update
on app.conf_devolucao_itens
for update
using (
    exists (
        select 1
        from app.conf_devolucao c
        where c.conf_id = conf_devolucao_itens.conf_id
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
        from app.conf_devolucao c
        where c.conf_id = conf_devolucao_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_devolucao_itens_delete
on app.conf_devolucao_itens
for delete
using (
    exists (
        select 1
        from app.conf_devolucao c
        where c.conf_id = conf_devolucao_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

drop function if exists public.rpc_conf_devolucao_manifest_meta(integer);
drop function if exists public.rpc_conf_devolucao_manifest_items_page(integer, integer, integer);
drop function if exists public.rpc_conf_devolucao_manifest_barras_page(integer, integer, integer);
drop function if exists public.rpc_conf_devolucao_manifest_notas(integer);
drop function if exists public.rpc_conf_devolucao_open_conference(text, integer);
drop function if exists public.rpc_conf_devolucao_open_without_nfd(integer);
drop function if exists public.rpc_conf_devolucao_get_active_conference();
drop function if exists public.rpc_conf_devolucao_get_items_v2(uuid);
drop function if exists public.rpc_conf_devolucao_scan_barcode(uuid, text, integer, integer);
drop function if exists public.rpc_conf_devolucao_set_item_qtd(uuid, integer, integer, integer);
drop function if exists public.rpc_conf_devolucao_reset_item(uuid, integer);
drop function if exists public.rpc_conf_devolucao_sync_snapshot(uuid, jsonb);
drop function if exists public.rpc_conf_devolucao_finalize(uuid, text, boolean, text, text);
drop function if exists public.rpc_conf_devolucao_cancel(uuid);

create or replace function app.conf_devolucao_resolve_cd(p_cd integer default null)
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

create or replace function app.conf_devolucao_autoclose_stale()
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

    update app.conf_devolucao c
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

create or replace function public.rpc_conf_devolucao_manifest_meta(p_cd integer default null)
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
    v_refs bigint;
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

    v_cd := app.conf_devolucao_resolve_cd(p_cd);

    select
        count(*)::bigint,
        count(
            distinct coalesce(
                nullif(trim(coalesce(d.chave, '')), ''),
                d.nfd::text
            )
        )::bigint,
        max(d.updated_at)
    into
        v_row_count,
        v_refs,
        v_updated_at
    from app.db_devolucao d
    where d.cd = v_cd
      and d.coddv is not null;

    if coalesce(v_row_count, 0) = 0 then
        raise exception 'BASE_DEVOLUCAO_VAZIA';
    end if;

    select d.source_run_id
    into v_source_run_id
    from app.db_devolucao d
    where d.cd = v_cd
      and d.source_run_id is not null
    order by d.updated_at desc nulls last
    limit 1;

    return query
    select
        v_cd,
        v_row_count,
        v_refs,
        v_source_run_id,
        md5(
            concat_ws(
                ':',
                coalesce(v_source_run_id::text, ''),
                v_row_count::text,
                v_refs::text,
                coalesce(v_updated_at::text, '')
            )
        ),
        now();
end;
$$;

create or replace function public.rpc_conf_devolucao_manifest_items_page(
    p_cd integer default null,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    ref text,
    nfd bigint,
    chave text,
    motivo text,
    coddv integer,
    descricao text,
    tipo text,
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

    v_cd := app.conf_devolucao_resolve_cd(p_cd);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 3000);

    return query
    select
        coalesce(
            nullif(trim(coalesce(d.chave, '')), ''),
            d.nfd::text
        ) as ref,
        d.nfd,
        nullif(trim(coalesce(d.chave, '')), '') as chave,
        min(nullif(trim(coalesce(d.motivo, '')), '')) as motivo,
        d.coddv,
        coalesce(
            min(nullif(trim(coalesce(d.descricao, '')), '')),
            format('CODDV %s', d.coddv)
        ) as descricao,
        coalesce(
            min(nullif(upper(trim(coalesce(d.tipo, ''))), '')),
            'UN'
        ) as tipo,
        coalesce(sum(greatest(coalesce(d.qtd_dev, 0)::integer, 0)), 0)::integer as qtd_esperada
    from app.db_devolucao d
    where d.cd = v_cd
      and d.coddv is not null
      and coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text) is not null
    group by
        coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text),
        d.nfd,
        nullif(trim(coalesce(d.chave, '')), ''),
        d.coddv
    order by
        coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text),
        d.coddv
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_conf_devolucao_manifest_barras_page(
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

    v_cd := app.conf_devolucao_resolve_cd(p_cd);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 4000);

    return query
    with needed as (
        select distinct d.coddv
        from app.db_devolucao d
        where d.cd = v_cd
          and d.coddv is not null
    )
    select
        b.barras,
        b.coddv,
        coalesce(nullif(trim(coalesce(b.descricao, '')), ''), format('CODDV %s', b.coddv)) as descricao,
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

create or replace function public.rpc_conf_devolucao_manifest_notas(
    p_cd integer default null
)
returns table (
    ref text,
    nfd bigint,
    chave text,
    motivo text,
    itens_total integer,
    qtd_esperada_total integer,
    status text,
    colaborador_nome text,
    colaborador_mat text,
    status_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
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

    v_cd := app.conf_devolucao_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    return query
    with notas as (
        select
            coalesce(
                nullif(trim(coalesce(d.chave, '')), ''),
                d.nfd::text
            ) as ref,
            d.nfd,
            nullif(trim(coalesce(d.chave, '')), '') as chave,
            min(nullif(trim(coalesce(d.motivo, '')), '')) as motivo,
            count(distinct d.coddv)::integer as itens_total,
            coalesce(sum(greatest(coalesce(d.qtd_dev, 0)::integer, 0)), 0)::integer as qtd_esperada_total
        from app.db_devolucao d
        where d.cd = v_cd
          and d.coddv is not null
        group by
            coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text),
            d.nfd,
            nullif(trim(coalesce(d.chave, '')), '')
    ),
    conf as (
        select
            c.*,
            row_number() over (
                partition by c.cd, coalesce(c.chave, ''), coalesce(c.nfd, -1)
                order by c.updated_at desc nulls last, c.started_at desc nulls last
            ) as rn
        from app.conf_devolucao c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.conference_kind = 'com_nfd'
    )
    select
        n.ref,
        n.nfd,
        n.chave,
        n.motivo,
        n.itens_total,
        n.qtd_esperada_total,
        case
            when c.conf_id is null then 'pendente'
            when c.status = 'em_conferencia' then 'em_andamento'
            when c.status in ('finalizado_ok', 'finalizado_falta') then 'concluido'
            else 'pendente'
        end as status,
        nullif(trim(coalesce(c.started_nome, '')), '') as colaborador_nome,
        nullif(trim(coalesce(c.started_mat, '')), '') as colaborador_mat,
        case
            when c.status = 'em_conferencia' then c.started_at
            else c.finalized_at
        end as status_at
    from notas n
    left join conf c
      on c.rn = 1
     and coalesce(c.nfd, -1) = coalesce(n.nfd, -1)
     and coalesce(c.chave, '') = coalesce(n.chave, '')
    order by n.ref;
end;
$$;

create or replace function public.rpc_conf_devolucao_get_active_conference()
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    conference_kind text,
    nfd bigint,
    chave text,
    ref text,
    source_motivo text,
    nfo text,
    motivo_sem_nfd text,
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
    v_conf app.conf_devolucao%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_devolucao_autoclose_stale();
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    select *
    into v_conf
    from app.conf_devolucao c
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
        c.conference_kind,
        c.nfd,
        c.chave,
        coalesce(nullif(trim(coalesce(c.chave, '')), ''), c.nfd::text, format('SEM-NFD-%s', left(c.conf_id::text, 8))) as ref,
        c.source_motivo,
        c.nfo,
        c.motivo_sem_nfd,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        false as is_read_only
    from app.conf_devolucao c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_devolucao_open_conference(
    p_ref text,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    conference_kind text,
    nfd bigint,
    chave text,
    ref text,
    source_motivo text,
    nfo text,
    motivo_sem_nfd text,
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
    v_conf app.conf_devolucao%rowtype;
    v_user_active app.conf_devolucao%rowtype;
    v_read_only boolean := false;
    v_match_nfd bigint;
    v_match_chave text;
    v_match_motivo text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_devolucao_autoclose_stale();
    v_cd := app.conf_devolucao_resolve_cd(p_cd);
    v_tag := nullif(trim(coalesce(p_ref, '')), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'NFD_OU_CHAVE_OBRIGATORIO';
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
    from app.conf_devolucao c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null then
        if v_user_active.conference_kind = 'sem_nfd' then
            raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_DEVOLUCAO';
        end if;
        if coalesce(v_user_active.chave, '') <> coalesce(v_tag, '')
           and coalesce(v_user_active.nfd::text, '') <> coalesce(v_tag, '') then
            raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_DEVOLUCAO';
        end if;
    end if;

    select
        min(d.nfd),
        min(nullif(trim(coalesce(d.chave, '')), '')),
        min(nullif(trim(coalesce(d.motivo, '')), ''))
    into
        v_match_nfd,
        v_match_chave,
        v_match_motivo
    from app.db_devolucao d
    where d.cd = v_cd
      and nullif(trim(coalesce(d.chave, '')), '') = v_tag;

    if v_match_nfd is null and v_match_chave is null and v_tag ~ '^[0-9]+$' then
        select
            min(d.nfd),
            min(nullif(trim(coalesce(d.chave, '')), '')),
            min(nullif(trim(coalesce(d.motivo, '')), ''))
        into
            v_match_nfd,
            v_match_chave,
            v_match_motivo
        from app.db_devolucao d
        where d.cd = v_cd
          and d.nfd = v_tag::bigint;
    end if;

    if v_match_nfd is null and v_match_chave is null then
        raise exception 'NFD_OU_CHAVE_NAO_ENCONTRADA';
    end if;

    select *
    into v_conf
    from app.conf_devolucao c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.conference_kind = 'com_nfd'
      and coalesce(c.nfd, -1) = coalesce(v_match_nfd, -1)
      and coalesce(c.chave, '') = coalesce(v_match_chave, '')
    limit 1;

    if found then
        if v_conf.started_by <> v_uid then
            if v_conf.status = 'em_conferencia' then
                raise exception 'CONFERENCIA_EM_USO';
            end if;
            if authz.is_admin(v_uid) and authz.can_access_cd(v_uid, v_cd) then
                v_read_only := true;
            else
                raise exception 'CONFERENCIA_JA_CONCLUIDA_POR_OUTRO_USUARIO';
            end if;
        else
            v_read_only := v_conf.status <> 'em_conferencia';
        end if;
    else
        insert into app.conf_devolucao (
            conf_date,
            cd,
            conference_kind,
            nfd,
            chave,
            source_motivo,
            started_by,
            started_mat,
            started_nome,
            status,
            started_at,
            updated_at
        )
        values (
            v_today,
            v_cd,
            'com_nfd',
            v_match_nfd,
            v_match_chave,
            v_match_motivo,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            now(),
            now()
        )
        returning * into v_conf;

        insert into app.conf_devolucao_itens (
            conf_id,
            coddv,
            barras,
            descricao,
            tipo,
            qtd_esperada,
            qtd_conferida,
            qtd_manual_total,
            updated_at
        )
        select
            v_conf.conf_id,
            d.coddv,
            min(nullif(trim(coalesce(b.barras, '')), '')) as barras,
            coalesce(
                min(nullif(trim(coalesce(d.descricao, '')), '')),
                min(nullif(trim(coalesce(b.descricao, '')), '')),
                format('CODDV %s', d.coddv)
            ) as descricao,
            coalesce(min(nullif(upper(trim(coalesce(d.tipo, ''))), '')), 'UN') as tipo,
            coalesce(sum(greatest(coalesce(d.qtd_dev, 0)::integer, 0)), 0)::integer as qtd_esperada,
            0,
            0,
            now()
        from app.db_devolucao d
        left join app.db_barras b
          on b.coddv = d.coddv
        where d.cd = v_cd
          and (
              (v_match_chave is not null and nullif(trim(coalesce(d.chave, '')), '') = v_match_chave)
              or (v_match_chave is null and d.nfd = v_match_nfd)
          )
          and d.coddv is not null
        group by d.coddv
        on conflict on constraint uq_conf_devolucao_itens
        do update set
            barras = excluded.barras,
            descricao = excluded.descricao,
            tipo = excluded.tipo,
            qtd_esperada = excluded.qtd_esperada,
            updated_at = now();
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.conference_kind,
        c.nfd,
        c.chave,
        coalesce(nullif(trim(coalesce(c.chave, '')), ''), c.nfd::text, format('SEM-NFD-%s', left(c.conf_id::text, 8))) as ref,
        c.source_motivo,
        c.nfo,
        c.motivo_sem_nfd,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_devolucao c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_devolucao_open_without_nfd(
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    conference_kind text,
    nfd bigint,
    chave text,
    ref text,
    source_motivo text,
    nfo text,
    motivo_sem_nfd text,
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
    v_today date;
    v_profile record;
    v_conf app.conf_devolucao%rowtype;
    v_active app.conf_devolucao%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_devolucao_autoclose_stale();
    v_cd := app.conf_devolucao_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    select *
    into v_active
    from app.conf_devolucao c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_active.conf_id is not null then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_DEVOLUCAO';
    end if;

    insert into app.conf_devolucao (
        conf_date,
        cd,
        conference_kind,
        started_by,
        started_mat,
        started_nome,
        status,
        started_at,
        updated_at
    )
    values (
        v_today,
        v_cd,
        'sem_nfd',
        v_uid,
        coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
        'em_conferencia',
        now(),
        now()
    )
    returning * into v_conf;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.conference_kind,
        c.nfd,
        c.chave,
        format('SEM-NFD-%s', left(c.conf_id::text, 8)) as ref,
        c.source_motivo,
        c.nfo,
        c.motivo_sem_nfd,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        false
    from app.conf_devolucao c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_devolucao_get_items_v2(p_conf_id uuid)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    barras text,
    descricao text,
    tipo text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_manual_total integer,
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
    v_conf app.conf_devolucao%rowtype;
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
    from app.conf_devolucao c
    where c.conf_id = p_conf_id
      and (
          c.started_by = v_uid
          or (
              authz.is_admin(v_uid)
              and authz.can_access_cd(v_uid, c.cd)
          )
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
        i.tipo,
        i.qtd_esperada,
        i.qtd_conferida,
        i.qtd_manual_total,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at
    from app.conf_devolucao_itens i
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

create or replace function public.rpc_conf_devolucao_scan_barcode(
    p_conf_id uuid,
    p_barras text,
    p_qtd integer default 1,
    p_qtd_manual integer default null
)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    barras text,
    descricao text,
    tipo text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_manual_total integer,
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
    v_conf app.conf_devolucao%rowtype;
    v_barras text;
    v_coddv integer;
    v_desc text;
    v_tipo text;
    v_qtd_manual integer;
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
    from app.conf_devolucao c
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
        b.coddv,
        coalesce(nullif(trim(coalesce(b.descricao, '')), ''), format('CODDV %s', b.coddv))
    into
        v_coddv,
        v_desc
    from app.db_barras b
    where b.barras = v_barras
    order by b.updated_at desc nulls last, b.coddv
    limit 1;

    if v_coddv is null then
        raise exception 'BARRAS_NAO_ENCONTRADA';
    end if;

    if v_conf.conference_kind = 'sem_nfd' then
        insert into app.conf_devolucao_itens (
            conf_id,
            coddv,
            barras,
            descricao,
            tipo,
            qtd_esperada,
            qtd_conferida,
            qtd_manual_total,
            updated_at
        )
        values (
            v_conf.conf_id,
            v_coddv,
            v_barras,
            v_desc,
            'UN',
            0,
            0,
            0,
            now()
        )
        on conflict on constraint uq_conf_devolucao_itens
        do update set
            barras = excluded.barras,
            descricao = excluded.descricao,
            updated_at = now();
    end if;

    select upper(coalesce(nullif(trim(i.tipo), ''), 'UN'))
    into v_tipo
    from app.conf_devolucao_itens i
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv
    limit 1;

    if v_tipo is null then
        raise exception 'PRODUTO_FORA_DA_NFD';
    end if;

    v_qtd_manual := greatest(coalesce(p_qtd_manual, 0), 0);
    if v_tipo <> 'UN' and v_qtd_manual <= 0 then
        raise exception 'QTD_MANUAL_OBRIGATORIA';
    end if;

    update app.conf_devolucao_itens i
    set
        qtd_conferida = i.qtd_conferida + p_qtd,
        qtd_manual_total = i.qtd_manual_total + case when v_tipo <> 'UN' then v_qtd_manual else 0 end,
        barras = coalesce(i.barras, v_barras),
        updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv;

    if not found then
        raise exception 'PRODUTO_FORA_DA_NFD';
    end if;

    update app.conf_devolucao c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

    return query
    select *
    from public.rpc_conf_devolucao_get_items_v2(v_conf.conf_id)
    where rpc_conf_devolucao_get_items_v2.coddv = v_coddv
    limit 1;
end;
$$;

create or replace function public.rpc_conf_devolucao_set_item_qtd(
    p_conf_id uuid,
    p_coddv integer,
    p_qtd_conferida integer,
    p_qtd_manual_total integer default null
)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    barras text,
    descricao text,
    tipo text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_manual_total integer,
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
    v_conf app.conf_devolucao%rowtype;
    v_qtd_manual integer;
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

    if p_qtd_manual_total is not null and p_qtd_manual_total < 0 then
        raise exception 'QTD_MANUAL_INVALIDA';
    end if;

    select *
    into v_conf
    from app.conf_devolucao c
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

    v_qtd_manual := greatest(coalesce(p_qtd_manual_total, 0), 0);

    update app.conf_devolucao_itens i
    set
        qtd_conferida = p_qtd_conferida,
        qtd_manual_total = case
            when p_qtd_manual_total is null then i.qtd_manual_total
            else v_qtd_manual
        end,
        updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = p_coddv;

    if not found then
        raise exception 'ITEM_NAO_ENCONTRADO';
    end if;

    update app.conf_devolucao c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

    return query
    select *
    from public.rpc_conf_devolucao_get_items_v2(v_conf.conf_id)
    where rpc_conf_devolucao_get_items_v2.coddv = p_coddv
    limit 1;
end;
$$;

create or replace function public.rpc_conf_devolucao_reset_item(
    p_conf_id uuid,
    p_coddv integer
)
returns table (
    item_id uuid,
    conf_id uuid,
    coddv integer,
    barras text,
    descricao text,
    tipo text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_manual_total integer,
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
    from public.rpc_conf_devolucao_set_item_qtd(p_conf_id, p_coddv, 0, 0);
$$;

create or replace function public.rpc_conf_devolucao_sync_snapshot(
    p_conf_id uuid,
    p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_devolucao%rowtype;
    v_item jsonb;
    v_coddv integer;
    v_qtd integer;
    v_qtd_manual integer;
    v_barras text;
    v_desc text;
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
    from app.conf_devolucao c
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

    if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
        raise exception 'PAYLOAD_INVALIDO';
    end if;

    for v_item in
        select value
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    loop
        begin
            v_coddv := nullif(trim(coalesce(v_item->>'coddv', '')), '')::integer;
        exception
            when others then
                v_coddv := null;
        end;
        begin
            v_qtd := greatest(coalesce((v_item->>'qtd_conferida')::integer, 0), 0);
        exception
            when others then
                v_qtd := 0;
        end;
        begin
            v_qtd_manual := greatest(coalesce((v_item->>'qtd_manual_total')::integer, 0), 0);
        exception
            when others then
                v_qtd_manual := 0;
        end;
        v_barras := nullif(regexp_replace(coalesce(v_item->>'barras', ''), '\s+', '', 'g'), '');

        if v_coddv is null then
            continue;
        end if;

        if v_conf.conference_kind = 'sem_nfd' then
            select coalesce(nullif(trim(coalesce(b.descricao, '')), ''), format('CODDV %s', v_coddv))
            into v_desc
            from app.db_barras b
            where b.coddv = v_coddv
            order by b.updated_at desc nulls last
            limit 1;

            insert into app.conf_devolucao_itens (
                conf_id,
                coddv,
                barras,
                descricao,
                tipo,
                qtd_esperada,
                qtd_conferida,
                qtd_manual_total,
                updated_at
            )
            values (
                v_conf.conf_id,
                v_coddv,
                v_barras,
                coalesce(v_desc, format('CODDV %s', v_coddv)),
                'UN',
                0,
                0,
                0,
                now()
            )
            on conflict on constraint uq_conf_devolucao_itens
            do update set
                barras = coalesce(excluded.barras, conf_devolucao_itens.barras),
                descricao = coalesce(excluded.descricao, conf_devolucao_itens.descricao),
                updated_at = now();
        end if;

        update app.conf_devolucao_itens i
        set
            qtd_conferida = v_qtd,
            qtd_manual_total = v_qtd_manual,
            barras = coalesce(v_barras, i.barras),
            updated_at = now()
        where i.conf_id = v_conf.conf_id
          and i.coddv = v_coddv;
    end loop;

    update app.conf_devolucao c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;
end;
$$;

create or replace function public.rpc_conf_devolucao_finalize(
    p_conf_id uuid,
    p_falta_motivo text default null,
    p_falta_total_sem_bipagem boolean default false,
    p_nfo text default null,
    p_motivo_sem_nfd text default null
)
returns table (
    status text,
    falta_motivo text,
    finalized_at timestamptz,
    nfo text,
    motivo_sem_nfd text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_devolucao%rowtype;
    v_falta integer := 0;
    v_sobra integer := 0;
    v_falta_motivo text;
    v_nfo text;
    v_motivo_sem_nfd text;
    v_next_status text;
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
    from app.conf_devolucao c
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
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer
    into
        v_falta,
        v_sobra
    from app.conf_devolucao_itens i
    where i.conf_id = v_conf.conf_id;

    if coalesce(v_sobra, 0) > 0 then
        raise exception 'SOBRA_NAO_PERMITIDA';
    end if;

    v_falta_motivo := nullif(trim(coalesce(p_falta_motivo, '')), '');
    v_nfo := nullif(trim(coalesce(p_nfo, '')), '');
    v_motivo_sem_nfd := nullif(trim(coalesce(p_motivo_sem_nfd, '')), '');

    if v_conf.conference_kind = 'sem_nfd' then
        if v_nfo is null then
            raise exception 'NFO_OBRIGATORIO';
        end if;
        if v_motivo_sem_nfd is null then
            raise exception 'MOTIVO_SEM_NFD_OBRIGATORIO';
        end if;
    end if;

    if coalesce(p_falta_total_sem_bipagem, false) then
        if v_falta_motivo is null then
            raise exception 'FALTA_MOTIVO_OBRIGATORIO';
        end if;
        v_next_status := 'finalizado_falta';
    else
        if coalesce(v_falta, 0) > 0 and v_falta_motivo is null then
            raise exception 'FALTA_MOTIVO_OBRIGATORIO';
        end if;
        v_next_status := case when coalesce(v_falta, 0) > 0 then 'finalizado_falta' else 'finalizado_ok' end;
    end if;

    update app.conf_devolucao c
    set
        status = v_next_status,
        falta_motivo = case
            when v_next_status = 'finalizado_falta' then coalesce(v_falta_motivo, c.falta_motivo)
            else null
        end,
        nfo = case
            when c.conference_kind = 'sem_nfd' then v_nfo
            else c.nfo
        end,
        motivo_sem_nfd = case
            when c.conference_kind = 'sem_nfd' then v_motivo_sem_nfd
            else c.motivo_sem_nfd
        end,
        finalized_at = now(),
        updated_at = now()
    where c.conf_id = v_conf.conf_id
    returning * into v_conf;

    return query
    select
        v_conf.status,
        v_conf.falta_motivo,
        v_conf.finalized_at,
        v_conf.nfo,
        v_conf.motivo_sem_nfd;
end;
$$;

create or replace function public.rpc_conf_devolucao_cancel(
    p_conf_id uuid
)
returns table (
    cancelled boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_devolucao%rowtype;
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
    from app.conf_devolucao c
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
        raise exception 'CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA';
    end if;

    delete from app.conf_devolucao c
    where c.conf_id = v_conf.conf_id;

    return query select true;
end;
$$;

grant execute on function public.rpc_conf_devolucao_manifest_meta(integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_manifest_items_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_manifest_barras_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_manifest_notas(integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_open_conference(text, integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_open_without_nfd(integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_get_active_conference() to authenticated;
grant execute on function public.rpc_conf_devolucao_get_items_v2(uuid) to authenticated;
grant execute on function public.rpc_conf_devolucao_scan_barcode(uuid, text, integer, integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_set_item_qtd(uuid, integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_reset_item(uuid, integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_sync_snapshot(uuid, jsonb) to authenticated;
grant execute on function public.rpc_conf_devolucao_finalize(uuid, text, boolean, text, text) to authenticated;
grant execute on function public.rpc_conf_devolucao_cancel(uuid) to authenticated;
