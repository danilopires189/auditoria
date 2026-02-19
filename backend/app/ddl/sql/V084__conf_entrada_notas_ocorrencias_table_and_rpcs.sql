create table if not exists app.conf_entrada_notas_ocorrencias (
    ocorrencia_id uuid primary key default gen_random_uuid(),
    conf_id uuid not null references app.conf_entrada_notas(conf_id) on delete cascade,
    item_id uuid not null references app.conf_entrada_notas_itens(item_id) on delete cascade,
    coddv integer not null,
    tipo text not null check (tipo in ('Avariado', 'Vencido')),
    qtd integer not null default 0 check (qtd >= 0),
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_conf_entrada_notas_ocorrencias unique (conf_id, coddv, tipo)
);

create index if not exists idx_conf_entrada_notas_ocorrencias_conf_coddv
    on app.conf_entrada_notas_ocorrencias(conf_id, coddv);

create index if not exists idx_conf_entrada_notas_ocorrencias_item
    on app.conf_entrada_notas_ocorrencias(item_id);

drop trigger if exists trg_conf_entrada_notas_ocorrencias_touch_updated_at on app.conf_entrada_notas_ocorrencias;
create trigger trg_conf_entrada_notas_ocorrencias_touch_updated_at
before update on app.conf_entrada_notas_ocorrencias
for each row
execute function app.conf_entrada_notas_touch_updated_at();

alter table app.conf_entrada_notas_ocorrencias enable row level security;
revoke all on app.conf_entrada_notas_ocorrencias from anon;
revoke all on app.conf_entrada_notas_ocorrencias from authenticated;

drop policy if exists p_conf_entrada_notas_ocorrencias_select on app.conf_entrada_notas_ocorrencias;
drop policy if exists p_conf_entrada_notas_ocorrencias_insert on app.conf_entrada_notas_ocorrencias;
drop policy if exists p_conf_entrada_notas_ocorrencias_update on app.conf_entrada_notas_ocorrencias;
drop policy if exists p_conf_entrada_notas_ocorrencias_delete on app.conf_entrada_notas_ocorrencias;

create policy p_conf_entrada_notas_ocorrencias_select
on app.conf_entrada_notas_ocorrencias
for select
to authenticated
using (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_ocorrencias.conf_id
          and (
              c.started_by = auth.uid()
              or (
                  authz.is_admin(auth.uid())
                  and authz.can_access_cd(auth.uid(), c.cd)
              )
          )
    )
);

create policy p_conf_entrada_notas_ocorrencias_insert
on app.conf_entrada_notas_ocorrencias
for insert
to authenticated
with check (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_ocorrencias.conf_id
          and c.started_by = auth.uid()
    )
);

create policy p_conf_entrada_notas_ocorrencias_update
on app.conf_entrada_notas_ocorrencias
for update
to authenticated
using (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_ocorrencias.conf_id
          and c.started_by = auth.uid()
    )
)
with check (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_ocorrencias.conf_id
          and c.started_by = auth.uid()
    )
);

create policy p_conf_entrada_notas_ocorrencias_delete
on app.conf_entrada_notas_ocorrencias
for delete
to authenticated
using (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_ocorrencias.conf_id
          and c.started_by = auth.uid()
    )
);

create or replace function app.conf_entrada_notas_occ_reconcile(
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
        delete from app.conf_entrada_notas_ocorrencias o
        where o.conf_id = p_conf_id
          and o.coddv = p_coddv;
        return;
    end if;

    select
        coalesce(sum(o.qtd) filter (where o.tipo = 'Avariado'), 0)::integer,
        coalesce(sum(o.qtd) filter (where o.tipo = 'Vencido'), 0)::integer
    into
        v_avariado,
        v_vencido
    from app.conf_entrada_notas_ocorrencias o
    where o.conf_id = p_conf_id
      and o.coddv = p_coddv;

    v_overflow := (v_avariado + v_vencido) - v_qtd;
    if v_overflow <= 0 then
        return;
    end if;

    v_reduce := least(v_vencido, v_overflow);
    if v_reduce > 0 then
        update app.conf_entrada_notas_ocorrencias o
        set
            qtd = greatest(o.qtd - v_reduce, 0),
            updated_at = now()
        where o.conf_id = p_conf_id
          and o.coddv = p_coddv
          and o.tipo = 'Vencido';
        delete from app.conf_entrada_notas_ocorrencias o
        where o.conf_id = p_conf_id
          and o.coddv = p_coddv
          and o.tipo = 'Vencido'
          and o.qtd <= 0;
        v_overflow := v_overflow - v_reduce;
    end if;

    if v_overflow > 0 then
        v_reduce := least(v_avariado, v_overflow);
        if v_reduce > 0 then
            update app.conf_entrada_notas_ocorrencias o
            set
                qtd = greatest(o.qtd - v_reduce, 0),
                updated_at = now()
            where o.conf_id = p_conf_id
              and o.coddv = p_coddv
              and o.tipo = 'Avariado';
            delete from app.conf_entrada_notas_ocorrencias o
            where o.conf_id = p_conf_id
              and o.coddv = p_coddv
              and o.tipo = 'Avariado'
              and o.qtd <= 0;
        end if;
    end if;
end;
$$;

create or replace function app.conf_entrada_notas_occ_set_absolute(
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
    v_item_id uuid;
    v_qtd_conferida integer;
    v_avariado integer;
    v_vencido integer;
begin
    v_avariado := greatest(coalesce(p_avariado, 0), 0);
    v_vencido := greatest(coalesce(p_vencido, 0), 0);

    select i.item_id, i.qtd_conferida
    into v_item_id, v_qtd_conferida
    from app.conf_entrada_notas_itens i
    where i.conf_id = p_conf_id
      and i.coddv = p_coddv
    limit 1;

    if v_item_id is null then
        return;
    end if;

    if v_avariado > 0 then
        insert into app.conf_entrada_notas_ocorrencias (
            conf_id,
            item_id,
            coddv,
            tipo,
            qtd,
            updated_by,
            created_at,
            updated_at
        )
        values (
            p_conf_id,
            v_item_id,
            p_coddv,
            'Avariado',
            v_avariado,
            p_updated_by,
            now(),
            now()
        )
        on conflict on constraint uq_conf_entrada_notas_ocorrencias
        do update set
            item_id = excluded.item_id,
            qtd = excluded.qtd,
            updated_by = excluded.updated_by,
            updated_at = now();
    else
        delete from app.conf_entrada_notas_ocorrencias o
        where o.conf_id = p_conf_id
          and o.coddv = p_coddv
          and o.tipo = 'Avariado';
    end if;

    if v_vencido > 0 then
        insert into app.conf_entrada_notas_ocorrencias (
            conf_id,
            item_id,
            coddv,
            tipo,
            qtd,
            updated_by,
            created_at,
            updated_at
        )
        values (
            p_conf_id,
            v_item_id,
            p_coddv,
            'Vencido',
            v_vencido,
            p_updated_by,
            now(),
            now()
        )
        on conflict on constraint uq_conf_entrada_notas_ocorrencias
        do update set
            item_id = excluded.item_id,
            qtd = excluded.qtd,
            updated_by = excluded.updated_by,
            updated_at = now();
    else
        delete from app.conf_entrada_notas_ocorrencias o
        where o.conf_id = p_conf_id
          and o.coddv = p_coddv
          and o.tipo = 'Vencido';
    end if;

    perform app.conf_entrada_notas_occ_reconcile(p_conf_id, p_coddv, v_qtd_conferida);
end;
$$;

create or replace function app.conf_entrada_notas_occ_add_delta(
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
    v_item_id uuid;
    v_qtd_conferida integer;
begin
    v_tipo := nullif(trim(coalesce(p_tipo, '')), '');
    v_delta := greatest(coalesce(p_delta, 0), 0);
    if v_delta <= 0 then
        return;
    end if;
    if v_tipo not in ('Avariado', 'Vencido') then
        return;
    end if;

    select i.item_id, i.qtd_conferida
    into v_item_id, v_qtd_conferida
    from app.conf_entrada_notas_itens i
    where i.conf_id = p_conf_id
      and i.coddv = p_coddv
    limit 1;

    if v_item_id is null then
        return;
    end if;

    insert into app.conf_entrada_notas_ocorrencias (
        conf_id,
        item_id,
        coddv,
        tipo,
        qtd,
        updated_by,
        created_at,
        updated_at
    )
    values (
        p_conf_id,
        v_item_id,
        p_coddv,
        v_tipo,
        v_delta,
        p_updated_by,
        now(),
        now()
    )
    on conflict on constraint uq_conf_entrada_notas_ocorrencias
    do update set
        item_id = excluded.item_id,
        qtd = app.conf_entrada_notas_ocorrencias.qtd + excluded.qtd,
        updated_by = excluded.updated_by,
        updated_at = now();

    perform app.conf_entrada_notas_occ_reconcile(p_conf_id, p_coddv, v_qtd_conferida);
end;
$$;

drop function if exists public.rpc_conf_entrada_notas_get_items_v2(uuid);
drop function if exists public.rpc_conf_entrada_notas_set_item_qtd(uuid, integer, integer);
drop function if exists public.rpc_conf_entrada_notas_apply_occurrence(uuid, integer, text, integer);
create or replace function public.rpc_conf_entrada_notas_apply_occurrence(
    p_conf_id uuid,
    p_coddv integer,
    p_tipo text,
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

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_JA_FINALIZADA';
    end if;

    perform app.conf_entrada_notas_occ_add_delta(
        v_conf.conf_id,
        p_coddv,
        p_tipo,
        p_qtd,
        v_uid
    );

    update app.conf_entrada_notas c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

    return query
    with occ as (
        select
            o.conf_id,
            o.coddv,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Avariado'), 0)::integer as ocorrencia_avariado_qtd,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Vencido'), 0)::integer as ocorrencia_vencido_qtd
        from app.conf_entrada_notas_ocorrencias o
        where o.conf_id = v_conf.conf_id
          and o.coddv = p_coddv
        group by o.conf_id, o.coddv
    )
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
        coalesce(occ.ocorrencia_avariado_qtd, 0) as ocorrencia_avariado_qtd,
        coalesce(occ.ocorrencia_vencido_qtd, 0) as ocorrencia_vencido_qtd,
        i.updated_at
    from app.conf_entrada_notas_itens i
    left join occ
      on occ.conf_id = i.conf_id
     and occ.coddv = i.coddv
    where i.conf_id = v_conf.conf_id
      and i.coddv = p_coddv
    limit 1;
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
    updated_at timestamptz,
    is_locked boolean,
    locked_by uuid,
    locked_mat text,
    locked_nome text,
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
    v_profile record;
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
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    select *
    into v_conf
    from app.conf_entrada_notas c
    where c.conf_id = p_conf_id
      and (
          c.started_by = v_uid
          or (
              coalesce(v_profile.role, '') = 'admin'
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
        i.qtd_esperada,
        i.qtd_conferida,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at,
        (
            i.qtd_conferida > 0
            and i.locked_by is not null
            and i.locked_by <> v_uid
        ) as is_locked,
        i.locked_by,
        i.locked_mat,
        i.locked_nome,
        coalesce(occ.ocorrencia_avariado_qtd, 0) as ocorrencia_avariado_qtd,
        coalesce(occ.ocorrencia_vencido_qtd, 0) as ocorrencia_vencido_qtd
    from app.conf_entrada_notas_itens i
    left join lateral (
        select
            coalesce(sum(o.qtd) filter (where o.tipo = 'Avariado'), 0)::integer as ocorrencia_avariado_qtd,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Vencido'), 0)::integer as ocorrencia_vencido_qtd
        from app.conf_entrada_notas_ocorrencias o
        where o.conf_id = i.conf_id
          and o.coddv = i.coddv
    ) occ on true
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
    updated_at timestamptz,
    ocorrencia_avariado_qtd integer,
    ocorrencia_vencido_qtd integer
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

    perform app.conf_entrada_notas_occ_reconcile(v_conf.conf_id, p_coddv, p_qtd_conferida);

    update app.conf_entrada_notas c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

    return query
    with occ as (
        select
            o.conf_id,
            o.coddv,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Avariado'), 0)::integer as ocorrencia_avariado_qtd,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Vencido'), 0)::integer as ocorrencia_vencido_qtd
        from app.conf_entrada_notas_ocorrencias o
        where o.conf_id = v_conf.conf_id
          and o.coddv = p_coddv
        group by o.conf_id, o.coddv
    )
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
        i.updated_at,
        coalesce(occ.ocorrencia_avariado_qtd, 0) as ocorrencia_avariado_qtd,
        coalesce(occ.ocorrencia_vencido_qtd, 0) as ocorrencia_vencido_qtd
    from app.conf_entrada_notas_itens i
    left join occ
      on occ.conf_id = i.conf_id
     and occ.coddv = i.coddv
    where i.conf_id = v_conf.conf_id
      and i.coddv = p_coddv
    limit 1;
end;
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
    v_occ_row record;
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

    for v_occ_row in
        with raw as (
            select
                case
                    when (elem ->> 'coddv') ~ '^[0-9]+$' then (elem ->> 'coddv')::integer
                    else null
                end as coddv,
                case
                    when elem ? 'ocorrencia_avariado_qtd'
                         and (elem ->> 'ocorrencia_avariado_qtd') ~ '^-?[0-9]+$'
                        then greatest((elem ->> 'ocorrencia_avariado_qtd')::integer, 0)
                    else null
                end as ocorrencia_avariado_qtd,
                case
                    when elem ? 'ocorrencia_vencido_qtd'
                         and (elem ->> 'ocorrencia_vencido_qtd') ~ '^-?[0-9]+$'
                        then greatest((elem ->> 'ocorrencia_vencido_qtd')::integer, 0)
                    else null
                end as ocorrencia_vencido_qtd
            from jsonb_array_elements(v_payload) elem
        ),
        payload as (
            select
                r.coddv,
                max(r.ocorrencia_avariado_qtd)::integer as ocorrencia_avariado_qtd,
                max(r.ocorrencia_vencido_qtd)::integer as ocorrencia_vencido_qtd,
                bool_or(r.ocorrencia_avariado_qtd is not null or r.ocorrencia_vencido_qtd is not null) as has_occ
            from raw r
            where r.coddv is not null
            group by r.coddv
        )
        select *
        from payload
        where has_occ
    loop
        perform app.conf_entrada_notas_occ_set_absolute(
            v_conf.conf_id,
            v_occ_row.coddv,
            coalesce(v_occ_row.ocorrencia_avariado_qtd, 0),
            coalesce(v_occ_row.ocorrencia_vencido_qtd, 0),
            v_uid
        );
    end loop;

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

grant execute on function public.rpc_conf_entrada_notas_apply_occurrence(uuid, integer, text, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_get_items_v2(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_set_item_qtd(uuid, integer, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_sync_snapshot(uuid, jsonb) to authenticated;
