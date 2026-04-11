create table if not exists app.conf_transferencia_cd_ocorrencias (
    ocorrencia_id uuid primary key default gen_random_uuid(),
    conf_id uuid not null references app.conf_transferencia_cd(conf_id) on delete cascade,
    item_id uuid not null references app.conf_transferencia_cd_itens(item_id) on delete cascade,
    coddv integer not null,
    tipo text not null check (tipo in ('Avariado', 'Vencido')),
    qtd integer not null default 0 check (qtd >= 0),
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_conf_transferencia_cd_ocorrencias unique (conf_id, coddv, tipo)
);

create index if not exists idx_conf_transferencia_cd_ocorrencias_conf_coddv
    on app.conf_transferencia_cd_ocorrencias(conf_id, coddv);

create index if not exists idx_conf_transferencia_cd_ocorrencias_item
    on app.conf_transferencia_cd_ocorrencias(item_id);

drop trigger if exists trg_conf_transferencia_cd_ocorrencias_touch_updated_at on app.conf_transferencia_cd_ocorrencias;
create trigger trg_conf_transferencia_cd_ocorrencias_touch_updated_at
before update on app.conf_transferencia_cd_ocorrencias
for each row
execute function app.conf_transferencia_cd_touch_updated_at();

alter table app.conf_transferencia_cd_ocorrencias enable row level security;
revoke all on app.conf_transferencia_cd_ocorrencias from anon;
revoke all on app.conf_transferencia_cd_ocorrencias from authenticated;

drop policy if exists p_conf_transferencia_cd_ocorrencias_select on app.conf_transferencia_cd_ocorrencias;
drop policy if exists p_conf_transferencia_cd_ocorrencias_insert on app.conf_transferencia_cd_ocorrencias;
drop policy if exists p_conf_transferencia_cd_ocorrencias_update on app.conf_transferencia_cd_ocorrencias;
drop policy if exists p_conf_transferencia_cd_ocorrencias_delete on app.conf_transferencia_cd_ocorrencias;

create policy p_conf_transferencia_cd_ocorrencias_select
on app.conf_transferencia_cd_ocorrencias
for select
to authenticated
using (
    exists (
        select 1
        from app.conf_transferencia_cd c
        where c.conf_id = conf_transferencia_cd_ocorrencias.conf_id
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd_ori)
              or authz.can_access_cd(auth.uid(), c.cd_des)
          )
    )
);

create policy p_conf_transferencia_cd_ocorrencias_insert
on app.conf_transferencia_cd_ocorrencias
for insert
to authenticated
with check (
    exists (
        select 1
        from app.conf_transferencia_cd c
        where c.conf_id = conf_transferencia_cd_ocorrencias.conf_id
          and c.etapa = 'entrada'
          and c.started_by = auth.uid()
          and c.status = 'em_conferencia'
          and authz.session_is_recent(6)
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), c.cd_des))
    )
);

create policy p_conf_transferencia_cd_ocorrencias_update
on app.conf_transferencia_cd_ocorrencias
for update
to authenticated
using (
    exists (
        select 1
        from app.conf_transferencia_cd c
        where c.conf_id = conf_transferencia_cd_ocorrencias.conf_id
          and c.etapa = 'entrada'
          and c.started_by = auth.uid()
          and c.status = 'em_conferencia'
          and authz.session_is_recent(6)
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), c.cd_des))
    )
)
with check (
    exists (
        select 1
        from app.conf_transferencia_cd c
        where c.conf_id = conf_transferencia_cd_ocorrencias.conf_id
          and c.etapa = 'entrada'
          and c.started_by = auth.uid()
          and c.status = 'em_conferencia'
          and authz.session_is_recent(6)
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), c.cd_des))
    )
);

create policy p_conf_transferencia_cd_ocorrencias_delete
on app.conf_transferencia_cd_ocorrencias
for delete
to authenticated
using (
    exists (
        select 1
        from app.conf_transferencia_cd c
        where c.conf_id = conf_transferencia_cd_ocorrencias.conf_id
          and c.etapa = 'entrada'
          and c.started_by = auth.uid()
          and c.status = 'em_conferencia'
          and authz.session_is_recent(6)
          and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), c.cd_des))
    )
);

create or replace function app.conf_transferencia_cd_occ_reconcile(
    p_conf_id uuid,
    p_coddv integer,
    p_qtd_conferida integer
)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_qtd integer;
    v_avariado integer;
    v_vencido integer;
    v_overflow integer;
    v_reduce integer;
begin
    v_qtd := greatest(coalesce(p_qtd_conferida, 0), 0);
    if v_qtd = 0 then
        delete from app.conf_transferencia_cd_ocorrencias o
        where o.conf_id = p_conf_id
          and o.coddv = p_coddv;
        return;
    end if;

    select
        coalesce(sum(o.qtd) filter (where o.tipo = 'Avariado'), 0)::integer,
        coalesce(sum(o.qtd) filter (where o.tipo = 'Vencido'), 0)::integer
    into v_avariado, v_vencido
    from app.conf_transferencia_cd_ocorrencias o
    where o.conf_id = p_conf_id
      and o.coddv = p_coddv;

    v_overflow := (v_avariado + v_vencido) - v_qtd;
    if v_overflow <= 0 then
        return;
    end if;

    v_reduce := least(v_vencido, v_overflow);
    if v_reduce > 0 then
        update app.conf_transferencia_cd_ocorrencias o
        set qtd = greatest(o.qtd - v_reduce, 0), updated_at = now()
        where o.conf_id = p_conf_id
          and o.coddv = p_coddv
          and o.tipo = 'Vencido';
        delete from app.conf_transferencia_cd_ocorrencias o
        where o.conf_id = p_conf_id
          and o.coddv = p_coddv
          and o.tipo = 'Vencido'
          and o.qtd <= 0;
        v_overflow := v_overflow - v_reduce;
    end if;

    if v_overflow > 0 then
        v_reduce := least(v_avariado, v_overflow);
        if v_reduce > 0 then
            update app.conf_transferencia_cd_ocorrencias o
            set qtd = greatest(o.qtd - v_reduce, 0), updated_at = now()
            where o.conf_id = p_conf_id
              and o.coddv = p_coddv
              and o.tipo = 'Avariado';
            delete from app.conf_transferencia_cd_ocorrencias o
            where o.conf_id = p_conf_id
              and o.coddv = p_coddv
              and o.tipo = 'Avariado'
              and o.qtd <= 0;
        end if;
    end if;
end;
$$;

create or replace function app.conf_transferencia_cd_occ_set_absolute(
    p_conf_id uuid,
    p_coddv integer,
    p_avariado integer,
    p_vencido integer,
    p_updated_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_conf_etapa text;
    v_item_id uuid;
    v_qtd_conferida integer;
    v_avariado integer;
    v_vencido integer;
begin
    select c.etapa
    into v_conf_etapa
    from app.conf_transferencia_cd c
    where c.conf_id = p_conf_id;

    if coalesce(v_conf_etapa, '') <> 'entrada' then
        return;
    end if;

    v_avariado := greatest(coalesce(p_avariado, 0), 0);
    v_vencido := greatest(coalesce(p_vencido, 0), 0);

    select i.item_id, i.qtd_conferida
    into v_item_id, v_qtd_conferida
    from app.conf_transferencia_cd_itens i
    where i.conf_id = p_conf_id
      and i.coddv = p_coddv
    limit 1;

    if v_item_id is null then
        return;
    end if;

    if v_avariado > 0 then
        insert into app.conf_transferencia_cd_ocorrencias (conf_id, item_id, coddv, tipo, qtd, updated_by)
        values (p_conf_id, v_item_id, p_coddv, 'Avariado', v_avariado, p_updated_by)
        on conflict on constraint uq_conf_transferencia_cd_ocorrencias
        do update set item_id = excluded.item_id, qtd = excluded.qtd, updated_by = excluded.updated_by, updated_at = now();
    else
        delete from app.conf_transferencia_cd_ocorrencias o
        where o.conf_id = p_conf_id
          and o.coddv = p_coddv
          and o.tipo = 'Avariado';
    end if;

    if v_vencido > 0 then
        insert into app.conf_transferencia_cd_ocorrencias (conf_id, item_id, coddv, tipo, qtd, updated_by)
        values (p_conf_id, v_item_id, p_coddv, 'Vencido', v_vencido, p_updated_by)
        on conflict on constraint uq_conf_transferencia_cd_ocorrencias
        do update set item_id = excluded.item_id, qtd = excluded.qtd, updated_by = excluded.updated_by, updated_at = now();
    else
        delete from app.conf_transferencia_cd_ocorrencias o
        where o.conf_id = p_conf_id
          and o.coddv = p_coddv
          and o.tipo = 'Vencido';
    end if;

    perform app.conf_transferencia_cd_occ_reconcile(p_conf_id, p_coddv, v_qtd_conferida);
end;
$$;

create or replace function app.conf_transferencia_cd_occ_add_delta(
    p_conf_id uuid,
    p_coddv integer,
    p_tipo text,
    p_delta integer,
    p_updated_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_tipo text;
    v_delta integer;
    v_conf_etapa text;
    v_item_id uuid;
    v_qtd_conferida integer;
begin
    v_tipo := nullif(trim(coalesce(p_tipo, '')), '');
    v_delta := greatest(coalesce(p_delta, 0), 0);

    if v_delta <= 0 or v_tipo not in ('Avariado', 'Vencido') then
        return;
    end if;

    select c.etapa
    into v_conf_etapa
    from app.conf_transferencia_cd c
    where c.conf_id = p_conf_id;

    if coalesce(v_conf_etapa, '') <> 'entrada' then
        return;
    end if;

    select i.item_id, i.qtd_conferida
    into v_item_id, v_qtd_conferida
    from app.conf_transferencia_cd_itens i
    where i.conf_id = p_conf_id
      and i.coddv = p_coddv
    limit 1;

    if v_item_id is null then
        return;
    end if;

    insert into app.conf_transferencia_cd_ocorrencias (conf_id, item_id, coddv, tipo, qtd, updated_by)
    values (p_conf_id, v_item_id, p_coddv, v_tipo, v_delta, p_updated_by)
    on conflict on constraint uq_conf_transferencia_cd_ocorrencias
    do update set
        item_id = excluded.item_id,
        qtd = app.conf_transferencia_cd_ocorrencias.qtd + excluded.qtd,
        updated_by = excluded.updated_by,
        updated_at = now();

    perform app.conf_transferencia_cd_occ_reconcile(p_conf_id, p_coddv, v_qtd_conferida);
end;
$$;

drop function if exists public.rpc_conf_transferencia_cd_scan_barcode(uuid, text, integer);
drop function if exists public.rpc_conf_transferencia_cd_scan_barcode(uuid, text, integer, text);
drop function if exists public.rpc_conf_transferencia_cd_reset_item(uuid, integer);
drop function if exists public.rpc_conf_transferencia_cd_set_item_qtd(uuid, integer, integer);
drop function if exists public.rpc_conf_transferencia_cd_get_items(uuid);

create or replace function public.rpc_conf_transferencia_cd_get_items(p_conf_id uuid)
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
    embcomp_cx integer,
    qtd_cxpad integer,
    ocorrencia_avariado_qtd integer,
    ocorrencia_vencido_qtd integer,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_transferencia_cd%rowtype;
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
    from app.conf_transferencia_cd c
    where c.conf_id = p_conf_id
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd_ori)
          or authz.can_access_cd(v_uid, c.cd_des)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    return query
    with occ as (
        select
            o.conf_id,
            o.coddv,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Avariado'), 0)::integer as ocorrencia_avariado_qtd,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Vencido'), 0)::integer as ocorrencia_vencido_qtd
        from app.conf_transferencia_cd_ocorrencias o
        where o.conf_id = v_conf.conf_id
        group by o.conf_id, o.coddv
    )
    select
        i.item_id,
        i.conf_id,
        i.coddv,
        nullif(trim(i.barras), '') as barras,
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
        i.embcomp_cx,
        i.qtd_cxpad,
        case when v_conf.etapa = 'entrada' then coalesce(occ.ocorrencia_avariado_qtd, 0) else 0 end as ocorrencia_avariado_qtd,
        case when v_conf.etapa = 'entrada' then coalesce(occ.ocorrencia_vencido_qtd, 0) else 0 end as ocorrencia_vencido_qtd,
        i.updated_at
    from app.conf_transferencia_cd_itens i
    left join occ
      on occ.conf_id = i.conf_id
     and occ.coddv = i.coddv
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

create or replace function public.rpc_conf_transferencia_cd_set_item_qtd(
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
    embcomp_cx integer,
    qtd_cxpad integer,
    ocorrencia_avariado_qtd integer,
    ocorrencia_vencido_qtd integer,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_transferencia_cd%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if p_coddv is null or p_qtd_conferida is null or p_qtd_conferida < 0 then
        raise exception 'QTD_INVALIDA';
    end if;

    select *
    into v_conf
    from app.conf_transferencia_cd c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and c.status = 'em_conferencia'
      and (
          authz.is_admin(v_uid)
          or (c.etapa = 'saida' and authz.can_access_cd(v_uid, c.cd_ori))
          or (c.etapa = 'entrada' and authz.can_access_cd(v_uid, c.cd_des))
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA';
    end if;

    update app.conf_transferencia_cd_itens i
    set qtd_conferida = p_qtd_conferida, updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = p_coddv;

    if not found then
        raise exception 'ITEM_NAO_ENCONTRADO';
    end if;

    if v_conf.etapa = 'entrada' then
        perform app.conf_transferencia_cd_occ_reconcile(v_conf.conf_id, p_coddv, p_qtd_conferida);
    end if;

    update app.conf_transferencia_cd c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

    return query
    select *
    from public.rpc_conf_transferencia_cd_get_items(v_conf.conf_id) r
    where r.coddv = p_coddv
    limit 1;
end;
$$;

create or replace function public.rpc_conf_transferencia_cd_reset_item(
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
    embcomp_cx integer,
    qtd_cxpad integer,
    ocorrencia_avariado_qtd integer,
    ocorrencia_vencido_qtd integer,
    updated_at timestamptz
)
language sql
security definer
set search_path = app, authz, public
as $$
    select *
    from public.rpc_conf_transferencia_cd_set_item_qtd(p_conf_id, p_coddv, 0);
$$;

create or replace function public.rpc_conf_transferencia_cd_scan_barcode(
    p_conf_id uuid,
    p_barras text,
    p_qtd integer default 1,
    p_ocorrencia_tipo text default null
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
    embcomp_cx integer,
    qtd_cxpad integer,
    ocorrencia_avariado_qtd integer,
    ocorrencia_vencido_qtd integer,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_transferencia_cd%rowtype;
    v_barras text;
    v_coddv integer;
    v_ocorrencia_tipo text;
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

    v_ocorrencia_tipo := nullif(trim(coalesce(p_ocorrencia_tipo, '')), '');
    if v_ocorrencia_tipo is not null and v_ocorrencia_tipo not in ('Avariado', 'Vencido') then
        raise exception 'OCORRENCIA_INVALIDA';
    end if;

    select *
    into v_conf
    from app.conf_transferencia_cd c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and c.status = 'em_conferencia'
      and (
          authz.is_admin(v_uid)
          or (c.etapa = 'saida' and authz.can_access_cd(v_uid, c.cd_ori))
          or (c.etapa = 'entrada' and authz.can_access_cd(v_uid, c.cd_des))
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA';
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

    update app.conf_transferencia_cd_itens i
    set qtd_conferida = i.qtd_conferida + p_qtd, barras = v_barras, updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv;

    if not found then
        raise exception 'PRODUTO_FORA_DA_TRANSFERENCIA';
    end if;

    if v_conf.etapa = 'entrada' and v_ocorrencia_tipo is not null then
        perform app.conf_transferencia_cd_occ_add_delta(v_conf.conf_id, v_coddv, v_ocorrencia_tipo, p_qtd, v_uid);
    end if;

    update app.conf_transferencia_cd c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

    return query
    select *
    from public.rpc_conf_transferencia_cd_get_items(v_conf.conf_id) r
    where r.coddv = v_coddv
    limit 1;
end;
$$;

create or replace function public.rpc_conf_transferencia_cd_sync_snapshot(
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
    v_conf app.conf_transferencia_cd%rowtype;
    v_item record;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'ITEMS_INVALIDOS';
    end if;

    select *
    into v_conf
    from app.conf_transferencia_cd c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and c.status = 'em_conferencia'
      and (
          authz.is_admin(v_uid)
          or (c.etapa = 'saida' and authz.can_access_cd(v_uid, c.cd_ori))
          or (c.etapa = 'entrada' and authz.can_access_cd(v_uid, c.cd_des))
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA';
    end if;

    for v_item in
        select
            (item->>'coddv')::integer as coddv,
            greatest(coalesce((item->>'qtd_conferida')::integer, 0), 0) as qtd_conferida,
            nullif(regexp_replace(coalesce(item->>'barras', ''), '\s+', '', 'g'), '') as barras,
            greatest(coalesce((item->>'ocorrencia_avariado_qtd')::integer, 0), 0) as ocorrencia_avariado_qtd,
            greatest(coalesce((item->>'ocorrencia_vencido_qtd')::integer, 0), 0) as ocorrencia_vencido_qtd
        from jsonb_array_elements(p_items) item
        where nullif(item->>'coddv', '') is not null
    loop
        update app.conf_transferencia_cd_itens i
        set qtd_conferida = v_item.qtd_conferida, barras = v_item.barras, updated_at = now()
        where i.conf_id = v_conf.conf_id
          and i.coddv = v_item.coddv;

        if v_conf.etapa = 'entrada' then
            perform app.conf_transferencia_cd_occ_set_absolute(
                v_conf.conf_id,
                v_item.coddv,
                v_item.ocorrencia_avariado_qtd,
                v_item.ocorrencia_vencido_qtd,
                v_uid
            );
        end if;
    end loop;

    update app.conf_transferencia_cd c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;
end;
$$;

drop function if exists public.rpc_conf_transferencia_cd_conciliacao_rows(date, date, integer, integer, integer);
create or replace function public.rpc_conf_transferencia_cd_conciliacao_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_limit integer default 1000,
    p_offset integer default 0
)
returns table (
    dt_nf date,
    nf_trf bigint,
    sq_nf bigint,
    cd_ori integer,
    cd_des integer,
    cd_ori_nome text,
    cd_des_nome text,
    saida_status text,
    saida_started_mat text,
    saida_started_nome text,
    saida_started_at timestamptz,
    saida_finalized_at timestamptz,
    entrada_status text,
    entrada_started_mat text,
    entrada_started_nome text,
    entrada_started_at timestamptz,
    entrada_finalized_at timestamptz,
    conciliacao_status text,
    coddv integer,
    descricao text,
    qtd_atend integer,
    qtd_conferida_saida integer,
    qtd_conferida_entrada integer,
    diferenca_saida_destino integer,
    embcomp_cx integer,
    qtd_cxpad integer,
    ocorrencia_avariado_qtd integer,
    ocorrencia_vencido_qtd integer
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_limit integer;
    v_offset integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if not authz.is_admin(v_uid) then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_limit := greatest(coalesce(p_limit, 1000), 1);
    v_offset := greatest(coalesce(p_offset, 0), 0);

    return query
    with base_items as (
        select
            t.dt_nf,
            t.nf_trf,
            t.sq_nf,
            t.cd_ori,
            t.cd_des,
            t.coddv,
            coalesce(nullif(trim(max(t.descricao)), ''), format('CODDV %s', t.coddv)) as descricao,
            sum(greatest(coalesce(t.qtd_atend, 0), 0))::integer as qtd_atend,
            max(t.embcomp_cx)::integer as embcomp_cx,
            sum(greatest(coalesce(t.qtd_cxpad, 0), 0))::integer as qtd_cxpad
        from app.db_transf_cd t
        where t.dt_nf >= p_dt_ini
          and t.dt_nf <= p_dt_fim
          and (t.cd_ori = v_cd or t.cd_des = v_cd)
          and t.dt_nf is not null
          and t.nf_trf is not null
          and t.sq_nf is not null
          and t.cd_ori is not null
          and t.cd_des is not null
          and t.coddv is not null
        group by t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des, t.coddv
    ),
    saida as (
        select *
        from app.conf_transferencia_cd c
        where c.etapa = 'saida'
    ),
    entrada as (
        select *
        from app.conf_transferencia_cd c
        where c.etapa = 'entrada'
    ),
    entrada_occ as (
        select
            o.conf_id,
            o.coddv,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Avariado'), 0)::integer as ocorrencia_avariado_qtd,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Vencido'), 0)::integer as ocorrencia_vencido_qtd
        from app.conf_transferencia_cd_ocorrencias o
        group by o.conf_id, o.coddv
    )
    select
        b.dt_nf,
        b.nf_trf,
        b.sq_nf,
        b.cd_ori,
        b.cd_des,
        coalesce(s.cd_ori_nome, e.cd_ori_nome, app.conf_transferencia_cd_nome_cd(b.cd_ori)) as cd_ori_nome,
        coalesce(s.cd_des_nome, e.cd_des_nome, app.conf_transferencia_cd_nome_cd(b.cd_des)) as cd_des_nome,
        s.status as saida_status,
        nullif(trim(s.started_mat), '') as saida_started_mat,
        nullif(trim(s.started_nome), '') as saida_started_nome,
        s.started_at as saida_started_at,
        s.finalized_at as saida_finalized_at,
        e.status as entrada_status,
        nullif(trim(e.started_mat), '') as entrada_started_mat,
        nullif(trim(e.started_nome), '') as entrada_started_nome,
        e.started_at as entrada_started_at,
        e.finalized_at as entrada_finalized_at,
        case
            when s.status in ('finalizado_ok', 'finalizado_falta')
             and e.status in ('finalizado_ok', 'finalizado_falta')
             and coalesce(si.qtd_conferida, 0) = coalesce(ei.qtd_conferida, 0)
                then 'conciliado'
            when s.status in ('finalizado_ok', 'finalizado_falta')
             and e.status in ('finalizado_ok', 'finalizado_falta')
                then 'divergente'
            when s.status in ('finalizado_ok', 'finalizado_falta')
                then 'pendente_destino'
            when e.status in ('finalizado_ok', 'finalizado_falta')
                then 'pendente_origem'
            else 'pendente'
        end as conciliacao_status,
        b.coddv,
        b.descricao,
        b.qtd_atend,
        coalesce(si.qtd_conferida, 0)::integer as qtd_conferida_saida,
        coalesce(ei.qtd_conferida, 0)::integer as qtd_conferida_entrada,
        (coalesce(si.qtd_conferida, 0) - coalesce(ei.qtd_conferida, 0))::integer as diferenca_saida_destino,
        b.embcomp_cx,
        b.qtd_cxpad,
        coalesce(eo.ocorrencia_avariado_qtd, 0)::integer as ocorrencia_avariado_qtd,
        coalesce(eo.ocorrencia_vencido_qtd, 0)::integer as ocorrencia_vencido_qtd
    from base_items b
    left join saida s
      on s.dt_nf = b.dt_nf
     and s.nf_trf = b.nf_trf
     and s.sq_nf = b.sq_nf
     and s.cd_ori = b.cd_ori
     and s.cd_des = b.cd_des
    left join entrada e
      on e.dt_nf = b.dt_nf
     and e.nf_trf = b.nf_trf
     and e.sq_nf = b.sq_nf
     and e.cd_ori = b.cd_ori
     and e.cd_des = b.cd_des
    left join app.conf_transferencia_cd_itens si
      on si.conf_id = s.conf_id
     and si.coddv = b.coddv
    left join app.conf_transferencia_cd_itens ei
      on ei.conf_id = e.conf_id
     and ei.coddv = b.coddv
    left join entrada_occ eo
      on eo.conf_id = e.conf_id
     and eo.coddv = b.coddv
    order by b.dt_nf, b.nf_trf, b.sq_nf, b.cd_ori, b.cd_des, b.coddv
    limit v_limit
    offset v_offset;
end;
$$;

grant execute on function public.rpc_conf_transferencia_cd_get_items(uuid) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_scan_barcode(uuid, text, integer, text) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_set_item_qtd(uuid, integer, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_reset_item(uuid, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_sync_snapshot(uuid, jsonb) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_conciliacao_rows(date, date, integer, integer, integer) to authenticated;
