create table if not exists app.gestao_estoque_items (
    id uuid primary key default gen_random_uuid(),
    cd integer not null,
    movement_date date not null,
    movement_type text not null check (movement_type in ('baixa', 'entrada')),
    coddv integer not null,
    barras_informado text,
    quantidade integer not null check (quantidade > 0),
    descricao text not null default '',
    endereco_sep text,
    endereco_pul text,
    qtd_est_atual integer not null default 0,
    qtd_est_disp integer not null default 0,
    dat_ult_compra date,
    custo_unitario numeric,
    custo_total numeric not null default 0,
    resolved_refreshed_at timestamptz,
    is_frozen boolean not null default false,
    frozen_at timestamptz,
    created_by uuid not null references auth.users(id) on delete restrict,
    created_mat text not null,
    created_nome text not null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_by uuid not null references auth.users(id) on delete restrict,
    updated_mat text not null,
    updated_nome text not null,
    updated_at timestamptz not null default timezone('utc', now()),
    constraint uq_gestao_estoque_items unique (cd, movement_date, movement_type, coddv)
);

create table if not exists app.gestao_estoque_events (
    event_id uuid primary key default gen_random_uuid(),
    item_id uuid,
    cd integer not null,
    movement_date date not null,
    movement_type text not null check (movement_type in ('baixa', 'entrada')),
    coddv integer not null,
    event_type text not null check (event_type in ('add', 'update_quantity', 'delete')),
    actor_id uuid not null references auth.users(id) on delete restrict,
    actor_mat text not null,
    actor_nome text not null,
    event_at timestamptz not null default timezone('utc', now()),
    before_payload jsonb,
    after_payload jsonb
);

create index if not exists idx_gestao_estoque_items_cd_date_type
    on app.gestao_estoque_items (cd, movement_date desc, movement_type, updated_at desc);

create index if not exists idx_gestao_estoque_items_cd_date
    on app.gestao_estoque_items (cd, movement_date desc);

create index if not exists idx_gestao_estoque_events_cd_date
    on app.gestao_estoque_events (cd, movement_date desc, event_at desc);

alter table app.gestao_estoque_items enable row level security;
alter table app.gestao_estoque_events enable row level security;

revoke all on table app.gestao_estoque_items from anon;
revoke all on table app.gestao_estoque_items from authenticated;
revoke all on table app.gestao_estoque_events from anon;
revoke all on table app.gestao_estoque_events from authenticated;

create or replace function app.gestao_estoque_today_brasilia()
returns date
language sql
stable
as $$
    select timezone('America/Sao_Paulo', now())::date;
$$;

create or replace function app.gestao_estoque_normalize_type(p_type text)
returns text
language plpgsql
immutable
as $$
declare
    v_type text;
begin
    v_type := lower(trim(coalesce(p_type, '')));
    if v_type not in ('baixa', 'entrada') then
        raise exception 'TIPO_MOVIMENTO_INVALIDO';
    end if;
    return v_type;
end;
$$;

create or replace function app.gestao_estoque_freeze_past_items(p_cd integer)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
begin
    update app.gestao_estoque_items i
       set is_frozen = true,
           frozen_at = coalesce(i.frozen_at, timezone('utc', now()))
     where i.cd = p_cd
       and i.movement_date < app.gestao_estoque_today_brasilia()
       and not i.is_frozen;
end;
$$;

create or replace function app.gestao_estoque_refresh_current_items(
    p_cd integer,
    p_type text default null
)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_type text;
begin
    v_type := case
        when nullif(trim(coalesce(p_type, '')), '') is null then null
        else app.gestao_estoque_normalize_type(p_type)
    end;

    with resolved as (
        select
            i.id,
            live.descricao,
            live.endereco_sep_text,
            live.endereco_pul_text,
            live.qtd_est_atual,
            live.qtd_est_disp,
            live.dat_ult_compra,
            live.custo_unitario
        from app.gestao_estoque_items i
        cross join lateral app.lookup_produto_payload(i.cd, null, i.coddv) live
        where i.cd = p_cd
          and i.movement_date = app.gestao_estoque_today_brasilia()
          and not i.is_frozen
          and (v_type is null or i.movement_type = v_type)
    )
    update app.gestao_estoque_items i
       set descricao = r.descricao,
           endereco_sep = r.endereco_sep_text,
           endereco_pul = r.endereco_pul_text,
           qtd_est_atual = coalesce(r.qtd_est_atual, 0),
           qtd_est_disp = coalesce(r.qtd_est_disp, 0),
           dat_ult_compra = r.dat_ult_compra,
           custo_unitario = r.custo_unitario,
           custo_total = round(i.quantidade::numeric * coalesce(r.custo_unitario, 0), 2),
           resolved_refreshed_at = timezone('utc', now())
      from resolved r
     where i.id = r.id;
end;
$$;

drop function if exists public.rpc_gestao_estoque_available_days(integer);

create function public.rpc_gestao_estoque_available_days(
    p_cd integer default null
)
returns table (
    movement_date date,
    item_count integer,
    updated_at timestamptz,
    is_today boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_today date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_today := app.gestao_estoque_today_brasilia();

    perform app.gestao_estoque_freeze_past_items(v_cd);

    return query
    select
        i.movement_date,
        count(*)::integer as item_count,
        max(greatest(i.updated_at, coalesce(i.resolved_refreshed_at, i.updated_at))) as updated_at,
        i.movement_date = v_today as is_today
    from app.gestao_estoque_items i
    where i.cd = v_cd
    group by i.movement_date
    order by i.movement_date desc;
end;
$$;

drop function if exists public.rpc_gestao_estoque_list(integer, date, text);

create function public.rpc_gestao_estoque_list(
    p_cd integer default null,
    p_date date default null,
    p_type text default 'baixa'
)
returns table (
    id uuid,
    movement_date date,
    movement_type text,
    coddv integer,
    barras_informado text,
    quantidade integer,
    descricao text,
    endereco_sep text,
    endereco_pul text,
    qtd_est_atual integer,
    qtd_est_disp integer,
    dat_ult_compra date,
    custo_unitario numeric,
    custo_total numeric,
    created_nome text,
    created_mat text,
    created_at timestamptz,
    updated_nome text,
    updated_mat text,
    updated_at timestamptz,
    resolved_refreshed_at timestamptz,
    is_frozen boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_date date;
    v_type text;
    v_today date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_today := app.gestao_estoque_today_brasilia();
    v_date := coalesce(p_date, v_today);
    v_type := app.gestao_estoque_normalize_type(p_type);

    perform app.gestao_estoque_freeze_past_items(v_cd);
    if v_date = v_today then
        perform app.gestao_estoque_refresh_current_items(v_cd, v_type);
    end if;

    return query
    select
        i.id,
        i.movement_date,
        i.movement_type,
        i.coddv,
        i.barras_informado,
        i.quantidade,
        i.descricao,
        i.endereco_sep,
        i.endereco_pul,
        i.qtd_est_atual,
        i.qtd_est_disp,
        i.dat_ult_compra,
        i.custo_unitario,
        i.custo_total,
        i.created_nome,
        i.created_mat,
        i.created_at,
        i.updated_nome,
        i.updated_mat,
        i.updated_at,
        i.resolved_refreshed_at,
        i.is_frozen
    from app.gestao_estoque_items i
    where i.cd = v_cd
      and i.movement_date = v_date
      and i.movement_type = v_type
    order by i.updated_at desc, i.coddv;
end;
$$;

drop function if exists public.rpc_gestao_estoque_add_item(integer, date, text, text, integer, integer);

create function public.rpc_gestao_estoque_add_item(
    p_cd integer default null,
    p_date date default null,
    p_type text default null,
    p_barras text default null,
    p_coddv integer default null,
    p_quantidade integer default null
)
returns table (
    result_status text,
    result_message text,
    id uuid,
    movement_date date,
    movement_type text,
    coddv integer,
    barras_informado text,
    quantidade integer,
    descricao text,
    endereco_sep text,
    endereco_pul text,
    qtd_est_atual integer,
    qtd_est_disp integer,
    dat_ult_compra date,
    custo_unitario numeric,
    custo_total numeric,
    created_nome text,
    created_mat text,
    created_at timestamptz,
    updated_nome text,
    updated_mat text,
    updated_at timestamptz,
    resolved_refreshed_at timestamptz,
    is_frozen boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_date date;
    v_type text;
    v_today date;
    v_qtd integer;
    v_profile record;
    v_live record;
    v_existing app.gestao_estoque_items%rowtype;
    v_inserted app.gestao_estoque_items%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_today := app.gestao_estoque_today_brasilia();
    v_date := coalesce(p_date, v_today);
    v_type := app.gestao_estoque_normalize_type(p_type);
    v_qtd := coalesce(p_quantidade, 0);

    if v_date <> v_today then raise exception 'DIA_SOMENTE_LEITURA'; end if;
    if v_qtd <= 0 then raise exception 'QTD_INVALIDA'; end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    select * into v_live from app.lookup_produto_payload(v_cd, p_barras, p_coddv) limit 1;

    if coalesce(v_live.coddv, 0) <= 0 then raise exception 'PRODUTO_NAO_ENCONTRADO'; end if;
    if v_type = 'baixa' and v_qtd > coalesce(v_live.qtd_est_atual, 0) then
        raise exception 'QTD_BAIXA_EXCEDE_ESTOQUE';
    end if;

    perform app.gestao_estoque_freeze_past_items(v_cd);
    perform app.gestao_estoque_refresh_current_items(v_cd, v_type);

    select *
      into v_existing
      from app.gestao_estoque_items i
     where i.cd = v_cd
       and i.movement_date = v_date
       and i.movement_type = v_type
       and i.coddv = v_live.coddv
     limit 1;

    if v_existing.id is not null then
        return query
        select
            'already_exists'::text,
            'Item já está na lista atual. Ajuste a quantidade na linha existente.'::text,
            v_existing.id,
            v_existing.movement_date,
            v_existing.movement_type,
            v_existing.coddv,
            v_existing.barras_informado,
            v_existing.quantidade,
            v_existing.descricao,
            v_existing.endereco_sep,
            v_existing.endereco_pul,
            v_existing.qtd_est_atual,
            v_existing.qtd_est_disp,
            v_existing.dat_ult_compra,
            v_existing.custo_unitario,
            v_existing.custo_total,
            v_existing.created_nome,
            v_existing.created_mat,
            v_existing.created_at,
            v_existing.updated_nome,
            v_existing.updated_mat,
            v_existing.updated_at,
            v_existing.resolved_refreshed_at,
            v_existing.is_frozen;
        return;
    end if;

    begin
        insert into app.gestao_estoque_items (
            cd,
            movement_date,
            movement_type,
            coddv,
            barras_informado,
            quantidade,
            descricao,
            endereco_sep,
            endereco_pul,
            qtd_est_atual,
            qtd_est_disp,
            dat_ult_compra,
            custo_unitario,
            custo_total,
            resolved_refreshed_at,
            is_frozen,
            created_by,
            created_mat,
            created_nome,
            updated_by,
            updated_mat,
            updated_nome,
            updated_at
        )
        values (
            v_cd,
            v_date,
            v_type,
            v_live.coddv,
            coalesce(nullif(trim(coalesce(p_barras, '')), ''), nullif(trim(coalesce(v_live.barras, '')), '')),
            v_qtd,
            v_live.descricao,
            v_live.endereco_sep_text,
            v_live.endereco_pul_text,
            coalesce(v_live.qtd_est_atual, 0),
            coalesce(v_live.qtd_est_disp, 0),
            v_live.dat_ult_compra,
            v_live.custo_unitario,
            round(v_qtd::numeric * coalesce(v_live.custo_unitario, 0), 2),
            timezone('utc', now()),
            false,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            timezone('utc', now())
        )
        returning *
          into v_inserted;
    exception
        when unique_violation then
            select *
              into v_existing
              from app.gestao_estoque_items i
             where i.cd = v_cd
               and i.movement_date = v_date
               and i.movement_type = v_type
               and i.coddv = v_live.coddv
             limit 1;

            return query
            select
                'already_exists'::text,
                'Item já está na lista atual. Ajuste a quantidade na linha existente.'::text,
                v_existing.id,
                v_existing.movement_date,
                v_existing.movement_type,
                v_existing.coddv,
                v_existing.barras_informado,
                v_existing.quantidade,
                v_existing.descricao,
                v_existing.endereco_sep,
                v_existing.endereco_pul,
                v_existing.qtd_est_atual,
                v_existing.qtd_est_disp,
                v_existing.dat_ult_compra,
                v_existing.custo_unitario,
                v_existing.custo_total,
                v_existing.created_nome,
                v_existing.created_mat,
                v_existing.created_at,
                v_existing.updated_nome,
                v_existing.updated_mat,
                v_existing.updated_at,
                v_existing.resolved_refreshed_at,
                v_existing.is_frozen;
            return;
    end;

    insert into app.gestao_estoque_events (
        item_id,
        cd,
        movement_date,
        movement_type,
        coddv,
        event_type,
        actor_id,
        actor_mat,
        actor_nome,
        before_payload,
        after_payload
    )
    values (
        v_inserted.id,
        v_inserted.cd,
        v_inserted.movement_date,
        v_inserted.movement_type,
        v_inserted.coddv,
        'add',
        v_uid,
        v_inserted.updated_mat,
        v_inserted.updated_nome,
        null,
        to_jsonb(v_inserted)
    );

    return query
    select
        'added'::text,
        'Item adicionado com sucesso.'::text,
        v_inserted.id,
        v_inserted.movement_date,
        v_inserted.movement_type,
        v_inserted.coddv,
        v_inserted.barras_informado,
        v_inserted.quantidade,
        v_inserted.descricao,
        v_inserted.endereco_sep,
        v_inserted.endereco_pul,
        v_inserted.qtd_est_atual,
        v_inserted.qtd_est_disp,
        v_inserted.dat_ult_compra,
        v_inserted.custo_unitario,
        v_inserted.custo_total,
        v_inserted.created_nome,
        v_inserted.created_mat,
        v_inserted.created_at,
        v_inserted.updated_nome,
        v_inserted.updated_mat,
        v_inserted.updated_at,
        v_inserted.resolved_refreshed_at,
        v_inserted.is_frozen;
end;
$$;

drop function if exists public.rpc_gestao_estoque_update_quantity(uuid, integer, timestamptz);

create function public.rpc_gestao_estoque_update_quantity(
    p_item_id uuid,
    p_quantidade integer,
    p_expected_updated_at timestamptz default null
)
returns table (
    id uuid,
    movement_date date,
    movement_type text,
    coddv integer,
    barras_informado text,
    quantidade integer,
    descricao text,
    endereco_sep text,
    endereco_pul text,
    qtd_est_atual integer,
    qtd_est_disp integer,
    dat_ult_compra date,
    custo_unitario numeric,
    custo_total numeric,
    created_nome text,
    created_mat text,
    created_at timestamptz,
    updated_nome text,
    updated_mat text,
    updated_at timestamptz,
    resolved_refreshed_at timestamptz,
    is_frozen boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_now timestamptz;
    v_today date;
    v_profile record;
    v_live record;
    v_before app.gestao_estoque_items%rowtype;
    v_after app.gestao_estoque_items%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    v_now := timezone('utc', now());
    v_today := app.gestao_estoque_today_brasilia();

    if coalesce(p_quantidade, 0) <= 0 then raise exception 'QTD_INVALIDA'; end if;

    select *
      into v_before
      from app.gestao_estoque_items i
     where i.id = p_item_id
     limit 1;

    if v_before.id is null then raise exception 'ITEM_NAO_ENCONTRADO'; end if;
    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_before.cd)) then raise exception 'CD_SEM_ACESSO'; end if;
    if v_before.movement_date <> v_today or v_before.is_frozen then raise exception 'DIA_SOMENTE_LEITURA'; end if;
    if p_expected_updated_at is not null and v_before.updated_at <> p_expected_updated_at then
        raise exception 'CONFLITO_ATUALIZACAO';
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    select * into v_live from app.lookup_produto_payload(v_before.cd, null, v_before.coddv) limit 1;

    if v_before.movement_type = 'baixa' and p_quantidade > coalesce(v_live.qtd_est_atual, 0) then
        raise exception 'QTD_BAIXA_EXCEDE_ESTOQUE';
    end if;

    update app.gestao_estoque_items i
       set quantidade = p_quantidade,
           descricao = v_live.descricao,
           endereco_sep = v_live.endereco_sep_text,
           endereco_pul = v_live.endereco_pul_text,
           qtd_est_atual = coalesce(v_live.qtd_est_atual, 0),
           qtd_est_disp = coalesce(v_live.qtd_est_disp, 0),
           dat_ult_compra = v_live.dat_ult_compra,
           custo_unitario = v_live.custo_unitario,
           custo_total = round(p_quantidade::numeric * coalesce(v_live.custo_unitario, 0), 2),
           resolved_refreshed_at = v_now,
           updated_by = v_uid,
           updated_mat = coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
           updated_nome = coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
           updated_at = v_now
     where i.id = p_item_id
    returning *
      into v_after;

    insert into app.gestao_estoque_events (
        item_id,
        cd,
        movement_date,
        movement_type,
        coddv,
        event_type,
        actor_id,
        actor_mat,
        actor_nome,
        before_payload,
        after_payload
    )
    values (
        v_after.id,
        v_after.cd,
        v_after.movement_date,
        v_after.movement_type,
        v_after.coddv,
        'update_quantity',
        v_uid,
        v_after.updated_mat,
        v_after.updated_nome,
        to_jsonb(v_before),
        to_jsonb(v_after)
    );

    return query
    select
        v_after.id,
        v_after.movement_date,
        v_after.movement_type,
        v_after.coddv,
        v_after.barras_informado,
        v_after.quantidade,
        v_after.descricao,
        v_after.endereco_sep,
        v_after.endereco_pul,
        v_after.qtd_est_atual,
        v_after.qtd_est_disp,
        v_after.dat_ult_compra,
        v_after.custo_unitario,
        v_after.custo_total,
        v_after.created_nome,
        v_after.created_mat,
        v_after.created_at,
        v_after.updated_nome,
        v_after.updated_mat,
        v_after.updated_at,
        v_after.resolved_refreshed_at,
        v_after.is_frozen;
end;
$$;

drop function if exists public.rpc_gestao_estoque_delete_item(uuid, timestamptz);

create function public.rpc_gestao_estoque_delete_item(
    p_item_id uuid,
    p_expected_updated_at timestamptz default null
)
returns table (
    result_status text,
    deleted_id uuid
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_before app.gestao_estoque_items%rowtype;
    v_profile record;
    v_today date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    v_today := app.gestao_estoque_today_brasilia();

    select *
      into v_before
      from app.gestao_estoque_items i
     where i.id = p_item_id
     limit 1;

    if v_before.id is null then raise exception 'ITEM_NAO_ENCONTRADO'; end if;
    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_before.cd)) then raise exception 'CD_SEM_ACESSO'; end if;
    if v_before.movement_date <> v_today or v_before.is_frozen then raise exception 'DIA_SOMENTE_LEITURA'; end if;
    if p_expected_updated_at is not null and v_before.updated_at <> p_expected_updated_at then
        raise exception 'CONFLITO_ATUALIZACAO';
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;

    insert into app.gestao_estoque_events (
        item_id,
        cd,
        movement_date,
        movement_type,
        coddv,
        event_type,
        actor_id,
        actor_mat,
        actor_nome,
        before_payload,
        after_payload
    )
    values (
        v_before.id,
        v_before.cd,
        v_before.movement_date,
        v_before.movement_type,
        v_before.coddv,
        'delete',
        v_uid,
        coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
        to_jsonb(v_before),
        null
    );

    delete from app.gestao_estoque_items
     where id = v_before.id;

    return query
    select
        'deleted'::text,
        v_before.id;
end;
$$;

grant execute on function public.rpc_gestao_estoque_available_days(integer) to authenticated;
grant execute on function public.rpc_gestao_estoque_list(integer, date, text) to authenticated;
grant execute on function public.rpc_gestao_estoque_add_item(integer, date, text, text, integer, integer) to authenticated;
grant execute on function public.rpc_gestao_estoque_update_quantity(uuid, integer, timestamptz) to authenticated;
grant execute on function public.rpc_gestao_estoque_delete_item(uuid, timestamptz) to authenticated;
