drop function if exists public.rpc_conf_volume_avulso_manifest_items_page(integer, integer, integer);
drop function if exists public.rpc_conf_volume_avulso_get_items(uuid);
drop function if exists public.rpc_conf_volume_avulso_scan_barcode(uuid, text, integer);
drop function if exists public.rpc_conf_volume_avulso_set_item_qtd(uuid, integer, integer);
drop function if exists public.rpc_conf_volume_avulso_reset_item(uuid, integer);
drop function if exists public.rpc_conf_volume_avulso_get_items_v2(uuid);

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
    qtd_esperada integer,
    lotes text,
    validades text
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
        greatest(sum(greatest(coalesce(t.qtd_mov, 0)::integer, 0))::integer, 1) as qtd_esperada,
        nullif(
            string_agg(
                distinct nullif(trim(t.lote), ''),
                ', ' order by nullif(trim(t.lote), '')
            ),
            ''
        ) as lotes,
        nullif(
            string_agg(
                distinct nullif(trim(t.val), ''),
                ', ' order by nullif(trim(t.val), '')
            ),
            ''
        ) as validades
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
    lotes text,
    validades text,
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
        lv.lotes,
        lv.validades,
        i.updated_at
    from app.conf_volume_avulso_itens i
    left join lateral (
        select
            nullif(
                string_agg(
                    distinct nullif(trim(t.lote), ''),
                    ', ' order by nullif(trim(t.lote), '')
                ),
                ''
            ) as lotes,
            nullif(
                string_agg(
                    distinct nullif(trim(t.val), ''),
                    ', ' order by nullif(trim(t.val), '')
                ),
                ''
            ) as validades
        from app.db_avulso t
        where t.cd = v_conf.cd
          and t.nr_volume = v_conf.nr_volume
          and t.coddv = i.coddv
    ) lv on true
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
    lotes text,
    validades text,
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
        lv.lotes,
        lv.validades,
        i.updated_at
    from app.conf_volume_avulso_itens i
    left join lateral (
        select
            nullif(
                string_agg(
                    distinct nullif(trim(t.lote), ''),
                    ', ' order by nullif(trim(t.lote), '')
                ),
                ''
            ) as lotes,
            nullif(
                string_agg(
                    distinct nullif(trim(t.val), ''),
                    ', ' order by nullif(trim(t.val), '')
                ),
                ''
            ) as validades
        from app.db_avulso t
        where t.cd = v_conf.cd
          and t.nr_volume = v_conf.nr_volume
          and t.coddv = i.coddv
    ) lv on true
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
    lotes text,
    validades text,
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
        lv.lotes,
        lv.validades,
        i.updated_at
    from app.conf_volume_avulso_itens i
    left join lateral (
        select
            nullif(
                string_agg(
                    distinct nullif(trim(t.lote), ''),
                    ', ' order by nullif(trim(t.lote), '')
                ),
                ''
            ) as lotes,
            nullif(
                string_agg(
                    distinct nullif(trim(t.val), ''),
                    ', ' order by nullif(trim(t.val), '')
                ),
                ''
            ) as validades
        from app.db_avulso t
        where t.cd = v_conf.cd
          and t.nr_volume = v_conf.nr_volume
          and t.coddv = i.coddv
    ) lv on true
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
    lotes text,
    validades text,
    updated_at timestamptz
)
language sql
security definer
set search_path = app, authz, public
as $$
    select *
    from public.rpc_conf_volume_avulso_set_item_qtd(p_conf_id, p_coddv, 0);
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
    lotes text,
    validades text,
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
        lv.lotes,
        lv.validades,
        i.updated_at
    from app.conf_volume_avulso_itens i
    left join lateral (
        select
            nullif(
                string_agg(
                    distinct nullif(trim(t.lote), ''),
                    ', ' order by nullif(trim(t.lote), '')
                ),
                ''
            ) as lotes,
            nullif(
                string_agg(
                    distinct nullif(trim(t.val), ''),
                    ', ' order by nullif(trim(t.val), '')
                ),
                ''
            ) as validades
        from app.db_avulso t
        where t.cd = v_conf.cd
          and t.nr_volume = v_conf.nr_volume
          and t.coddv = i.coddv
    ) lv on true
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

grant execute on function public.rpc_conf_volume_avulso_manifest_items_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_get_items(uuid) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_get_items_v2(uuid) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_scan_barcode(uuid, text, integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_set_item_qtd(uuid, integer, integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_reset_item(uuid, integer) to authenticated;
