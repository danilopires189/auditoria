-- Regra DESACORDO:
-- - Em conferência com NFD, quando o motivo contém "DESACORDO", a coleta vira livre.
-- - Itens esperados da nota não são retornados na lista (somente itens bipados).
-- - Divergência fica neutra (sem falta/sobra) para esse modo.

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
    v_conf app.conf_devolucao%rowtype;
    v_is_desacordo boolean := false;
    v_coleta_livre boolean := false;
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

    v_is_desacordo := (
        v_conf.conference_kind = 'com_nfd'
        and coalesce(v_conf.source_motivo, '') ilike '%DESACORDO%'
    );
    v_coleta_livre := (v_conf.conference_kind = 'sem_nfd' or v_is_desacordo);

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
        case
            when v_coleta_livre then 0
            else greatest(i.qtd_esperada - i.qtd_conferida, 0)
        end as qtd_falta,
        case
            when v_coleta_livre then 0
            else greatest(i.qtd_conferida - i.qtd_esperada, 0)
        end as qtd_sobra,
        case
            when v_coleta_livre then 'correto'
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        nullif(trim(coalesce(i.lotes, '')), '') as lotes,
        nullif(trim(coalesce(i.validades, '')), '') as validades,
        i.updated_at
    from app.conf_devolucao_itens i
    where i.conf_id = v_conf.conf_id
      and (
          not v_is_desacordo
          or coalesce(i.qtd_conferida, 0) > 0
      )
    order by
        case
            when v_coleta_livre then 3
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
    v_conf app.conf_devolucao%rowtype;
    v_barras text;
    v_coddv integer;
    v_desc text;
    v_tipo text;
    v_qtd_manual integer;
    v_coleta_livre boolean := false;
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

    v_coleta_livre := (
        v_conf.conference_kind = 'sem_nfd'
        or coalesce(v_conf.source_motivo, '') ilike '%DESACORDO%'
    );

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

    if v_coleta_livre then
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
    v_lotes text;
    v_validades text;
    v_has_lotes boolean;
    v_has_validades boolean;
    v_coleta_livre boolean := false;
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

    v_coleta_livre := (
        v_conf.conference_kind = 'sem_nfd'
        or coalesce(v_conf.source_motivo, '') ilike '%DESACORDO%'
    );

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
        v_has_lotes := v_item ? 'lotes';
        v_has_validades := v_item ? 'validades';
        v_lotes := case when v_has_lotes then nullif(trim(coalesce(v_item->>'lotes', '')), '') else null end;
        v_validades := case when v_has_validades then nullif(trim(coalesce(v_item->>'validades', '')), '') else null end;

        if v_coddv is null then
            continue;
        end if;

        if v_coleta_livre then
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
                lotes,
                validades,
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
                v_lotes,
                v_validades,
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
            lotes = case when v_has_lotes then v_lotes else i.lotes end,
            validades = case when v_has_validades then v_validades else i.validades end,
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
    v_is_desacordo boolean := false;
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

    v_is_desacordo := (
        v_conf.conference_kind = 'com_nfd'
        and coalesce(v_conf.source_motivo, '') ilike '%DESACORDO%'
    );

    select
        count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer
    into
        v_falta,
        v_sobra
    from app.conf_devolucao_itens i
    where i.conf_id = v_conf.conf_id;

    -- Para devolução sem NFD e coleta livre por DESACORDO, sobra/esperada não bloqueiam.
    if v_conf.conference_kind <> 'sem_nfd'
       and not v_is_desacordo
       and coalesce(v_sobra, 0) > 0 then
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
        v_next_status := 'finalizado_ok';
    elsif v_is_desacordo then
        v_next_status := 'finalizado_ok';
    elsif coalesce(p_falta_total_sem_bipagem, false) then
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

grant execute on function public.rpc_conf_devolucao_get_items_v2(uuid) to authenticated;
grant execute on function public.rpc_conf_devolucao_scan_barcode(uuid, text, integer, integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_sync_snapshot(uuid, jsonb) to authenticated;
grant execute on function public.rpc_conf_devolucao_finalize(uuid, text, boolean, text, text) to authenticated;
