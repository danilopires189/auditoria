alter table app.gestao_estoque_items
    add column if not exists motivo text;

create or replace function app.gestao_estoque_normalize_motivo(
    p_type text,
    p_motivo text
)
returns text
language plpgsql
immutable
as $$
declare
    v_type text;
    v_motivo text;
begin
    v_type := app.gestao_estoque_normalize_type(p_type);
    v_motivo := nullif(trim(coalesce(p_motivo, '')), '');

    if v_type <> 'baixa' then
        return null;
    end if;

    if v_motivo is null then
        raise exception 'MOTIVO_BAIXA_OBRIGATORIO';
    end if;

    if v_motivo not in (
        'Ajuste por Entrada (EO, EA)',
        'Ajuste por Inventário (EA)',
        'Logística Reversa (ED)',
        'Produto Perdido'
    ) then
        raise exception 'MOTIVO_BAIXA_INVALIDO';
    end if;

    return v_motivo;
end;
$$;

drop function if exists public.rpc_gestao_estoque_list(integer, date, text);

create or replace function public.rpc_gestao_estoque_list(
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
     motivo text,
    estoque_updated_at timestamptz,
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
    is_frozen boolean,
    qtd_mov_dia integer,
    valor_mov_dia numeric,
    is_em_recebimento_previsto boolean
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
    v_type_codes text[];
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_today := app.gestao_estoque_today_brasilia();
    v_date := coalesce(p_date, v_today);
    v_type := app.gestao_estoque_normalize_type(p_type);
    v_type_codes := case
        when v_type = 'entrada' then array['EA', 'EO']
        else array['SA', 'SO']
    end;

    perform app.gestao_estoque_freeze_past_items(v_cd);
    if v_date = v_today then
        perform app.gestao_estoque_refresh_current_items(v_cd, v_type);
    end if;

    return query
    with gestao_aggregated as (
        select
            g.cd,
            g.data_mov,
            g.coddv,
            sum(greatest(coalesce(nullif(g.qtd_mov, 0), 1), 1))::integer as qtd_mov_dia,
            coalesce(sum(abs(coalesce(g.valor_mov, 0))), 0)::numeric as valor_mov_dia
        from app.db_gestao_estq g
        where g.cd = v_cd
          and g.data_mov = v_date
          and upper(trim(coalesce(g.tipo_movimentacao, ''))) = any(v_type_codes)
        group by g.cd, g.data_mov, g.coddv
    ),
    recebimento_previsto as (
        select distinct
            t.coddv
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.coddv is not null
          and t.dh_consistida is not null
    )
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
        i.motivo,
        i.estoque_updated_at,
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
        i.is_frozen,
        coalesce(g.qtd_mov_dia, 0)::integer as qtd_mov_dia,
        coalesce(g.valor_mov_dia, 0)::numeric as valor_mov_dia,
        (rp.coddv is not null) as is_em_recebimento_previsto
    from app.gestao_estoque_items i
    left join gestao_aggregated g
      on g.cd = i.cd
     and g.data_mov = i.movement_date
     and g.coddv = i.coddv
    left join recebimento_previsto rp
      on rp.coddv = i.coddv
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
    p_quantidade integer default null,
    p_motivo text default null
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
    motivo text,
    estoque_updated_at timestamptz,
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
    v_now timestamptz;
    v_motivo text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_today := app.gestao_estoque_today_brasilia();
    v_date := coalesce(p_date, v_today);
    v_type := app.gestao_estoque_normalize_type(p_type);
    v_qtd := coalesce(p_quantidade, 0);
    v_now := now();
    v_motivo := app.gestao_estoque_normalize_motivo(v_type, p_motivo);

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
            v_existing.motivo,
            v_existing.estoque_updated_at,
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
            motivo,
            estoque_updated_at,
            dat_ult_compra,
            custo_unitario,
            custo_total,
            resolved_refreshed_at,
            is_frozen,
            created_by,
            created_mat,
            created_nome,
            created_at,
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
            v_motivo,
            v_live.estoque_updated_at,
            v_live.dat_ult_compra,
            v_live.custo_unitario,
            round(v_qtd::numeric * coalesce(v_live.custo_unitario, 0), 2),
            v_now,
            false,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            v_now,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            v_now
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
                v_existing.motivo,
                v_existing.estoque_updated_at,
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
        event_at,
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
        v_now,
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
        v_inserted.motivo,
        v_inserted.estoque_updated_at,
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

create or replace function public.rpc_gestao_estoque_update_quantity(
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
    motivo text,
    estoque_updated_at timestamptz,
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
    v_now := now();
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
           estoque_updated_at = v_live.estoque_updated_at,
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
        event_at,
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
        v_now,
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
        v_after.motivo,
        v_after.estoque_updated_at,
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

drop function if exists public.rpc_gestao_estoque_deleted_list(integer, date, text);

create function public.rpc_gestao_estoque_deleted_list(
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
    motivo text,
    estoque_updated_at timestamptz,
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
    is_frozen boolean,
    qtd_mov_dia integer,
    valor_mov_dia numeric,
    is_em_recebimento_previsto boolean,
    deleted_at timestamptz,
    deleted_nome text,
    deleted_mat text
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
    v_type_codes text[];
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_today := app.gestao_estoque_today_brasilia();
    v_date := coalesce(p_date, v_today);
    v_type := app.gestao_estoque_normalize_type(p_type);
    v_type_codes := case
        when v_type = 'entrada' then array['EA', 'EO']
        else array['SA', 'SO']
    end;

    return query
    with gestao_aggregated as (
        select
            g.cd,
            g.data_mov,
            g.coddv,
            sum(greatest(coalesce(nullif(g.qtd_mov, 0), 1), 1))::integer as qtd_mov_dia,
            coalesce(sum(abs(coalesce(g.valor_mov, 0))), 0)::numeric as valor_mov_dia
        from app.db_gestao_estq g
        where g.cd = v_cd
          and g.data_mov = v_date
          and upper(trim(coalesce(g.tipo_movimentacao, ''))) = any(v_type_codes)
        group by g.cd, g.data_mov, g.coddv
    ),
    recebimento_previsto as (
        select distinct
            t.coddv
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.coddv is not null
          and t.dh_consistida is not null
    ),
    deleted_events as (
        select
            e.event_id,
            e.item_id,
            e.cd,
            e.movement_date,
            e.movement_type,
            e.coddv,
            e.actor_nome,
            e.actor_mat,
            e.event_at,
            e.before_payload
        from app.gestao_estoque_events e
        where e.cd = v_cd
          and e.movement_date = v_date
          and e.movement_type = v_type
          and e.event_type = 'delete'
          and e.before_payload is not null
    )
    select
        coalesce(d.item_id, d.event_id) as id,
        coalesce(nullif(d.before_payload ->> 'movement_date', '')::date, d.movement_date) as movement_date,
        coalesce(nullif(d.before_payload ->> 'movement_type', ''), d.movement_type) as movement_type,
        coalesce(nullif(d.before_payload ->> 'coddv', '')::integer, d.coddv) as coddv,
        nullif(d.before_payload ->> 'barras_informado', '') as barras_informado,
        greatest(coalesce(nullif(d.before_payload ->> 'quantidade', '')::integer, 0), 0) as quantidade,
        coalesce(nullif(d.before_payload ->> 'descricao', ''), format('CODDV %s', coalesce(d.before_payload ->> 'coddv', d.coddv::text))) as descricao,
        nullif(d.before_payload ->> 'endereco_sep', '') as endereco_sep,
        nullif(d.before_payload ->> 'endereco_pul', '') as endereco_pul,
        greatest(coalesce(nullif(d.before_payload ->> 'qtd_est_atual', '')::integer, 0), 0) as qtd_est_atual,
        greatest(coalesce(nullif(d.before_payload ->> 'qtd_est_disp', '')::integer, 0), 0) as qtd_est_disp,
        nullif(d.before_payload ->> 'motivo', '') as motivo,
        nullif(d.before_payload ->> 'estoque_updated_at', '')::timestamptz as estoque_updated_at,
        nullif(d.before_payload ->> 'dat_ult_compra', '')::date as dat_ult_compra,
        nullif(d.before_payload ->> 'custo_unitario', '')::numeric as custo_unitario,
        coalesce(nullif(d.before_payload ->> 'custo_total', '')::numeric, 0)::numeric as custo_total,
        coalesce(nullif(d.before_payload ->> 'created_nome', ''), 'Usuário') as created_nome,
        coalesce(nullif(d.before_payload ->> 'created_mat', ''), '-') as created_mat,
        nullif(d.before_payload ->> 'created_at', '')::timestamptz as created_at,
        coalesce(nullif(d.before_payload ->> 'updated_nome', ''), 'Usuário') as updated_nome,
        coalesce(nullif(d.before_payload ->> 'updated_mat', ''), '-') as updated_mat,
        nullif(d.before_payload ->> 'updated_at', '')::timestamptz as updated_at,
        nullif(d.before_payload ->> 'resolved_refreshed_at', '')::timestamptz as resolved_refreshed_at,
        coalesce(nullif(d.before_payload ->> 'is_frozen', '')::boolean, false) as is_frozen,
        coalesce(g.qtd_mov_dia, 0)::integer as qtd_mov_dia,
        coalesce(g.valor_mov_dia, 0)::numeric as valor_mov_dia,
        (rp.coddv is not null) as is_em_recebimento_previsto,
        d.event_at as deleted_at,
        d.actor_nome as deleted_nome,
        d.actor_mat as deleted_mat
    from deleted_events d
    left join gestao_aggregated g
      on g.cd = d.cd
     and g.data_mov = d.movement_date
     and g.coddv = d.coddv
    left join recebimento_previsto rp
      on rp.coddv = d.coddv
    order by d.event_at desc, d.coddv;
end;
$$;

grant execute on function public.rpc_gestao_estoque_list(integer, date, text) to authenticated;
grant execute on function public.rpc_gestao_estoque_add_item(integer, date, text, text, integer, integer, text) to authenticated;
grant execute on function public.rpc_gestao_estoque_update_quantity(uuid, integer, timestamptz) to authenticated;
grant execute on function public.rpc_gestao_estoque_deleted_list(integer, date, text) to authenticated;
