alter table app.conf_entrada_notas
    drop constraint if exists conf_entrada_notas_status_check;

alter table app.conf_entrada_notas
    add constraint conf_entrada_notas_status_check
    check (status in (
        'em_conferencia',
        'finalizado_ok',
        'finalizado_divergencia',
        'finalizado_parcial',
        'finalizado_falta'
    ));

alter table app.conf_entrada_notas_itens_conferidos
    drop constraint if exists conf_entrada_notas_itens_conferidos_divergencia_tipo_check;

alter table app.conf_entrada_notas_itens_conferidos
    add constraint conf_entrada_notas_itens_conferidos_divergencia_tipo_check
    check (divergencia_tipo in ('nao_conferido', 'falta', 'sobra', 'correto'));

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
    updated_at timestamptz,
    is_locked boolean,
    locked_by uuid,
    locked_mat text,
    locked_nome text
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
        i.descricao,
        i.qtd_esperada,
        i.qtd_conferida,
        greatest(i.qtd_esperada - i.qtd_conferida, 0) as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida = 0 then 'nao_conferido'
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
        i.locked_nome
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_conf.conf_id
    order by
        case
            when i.qtd_conferida = 0 then 0
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
            when i.qtd_conferida = 0 then 'nao_conferido'
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
            when i.qtd_conferida = 0 then 0
            when i.qtd_conferida < i.qtd_esperada then 1
            when i.qtd_conferida > i.qtd_esperada then 2
            else 3
        end,
        i.coddv;
end;
$$;

drop function if exists public.rpc_conf_entrada_notas_set_item_qtd(uuid, integer, integer);
create function public.rpc_conf_entrada_notas_set_item_qtd(
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
    is_locked boolean,
    locked_by uuid,
    locked_mat text,
    locked_nome text,
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
            when i.qtd_conferida = 0 then 'nao_conferido'
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
            count(*) filter (where i.qtd_conferida > 0 and i.qtd_conferida < i.qtd_esperada)::integer as falta_count,
            count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer as sobra_count,
            count(*) filter (where i.qtd_conferida > 0 and i.qtd_conferida = i.qtd_esperada)::integer as correto_count
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
    v_pending_count integer;
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

    perform app.conf_entrada_notas_touch_colaborador_from_session(v_conf.conf_id);

    select
        count(*) filter (where i.qtd_conferida = 0)::integer,
        count(*) filter (where i.qtd_conferida > 0 and i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > 0 and i.qtd_conferida = i.qtd_esperada)::integer
    into
        v_pending_count,
        v_falta_count,
        v_sobra_count,
        v_correto_count
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_conf.conf_id;

    v_status := case
        when coalesce(v_pending_count, 0) > 0 then 'finalizado_parcial'
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

create or replace function public.rpc_conf_entrada_notas_get_partial_reopen_info(
    p_seq_entrada bigint,
    p_nf bigint,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    seq_entrada bigint,
    nf bigint,
    status text,
    previous_started_by uuid,
    previous_started_mat text,
    previous_started_nome text,
    locked_items integer,
    pending_items integer,
    can_reopen boolean
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
    v_conf app.conf_entrada_notas%rowtype;
    v_locked_items integer := 0;
    v_pending_items integer := 0;
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

    select *
    into v_conf
    from app.conf_entrada_notas c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.seq_entrada = p_seq_entrada
      and c.nf = p_nf
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    select
        count(*) filter (where i.qtd_conferida > 0)::integer,
        count(*) filter (where i.qtd_conferida = 0)::integer
    into
        v_locked_items,
        v_pending_items
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_conf.conf_id;

    return query
    select
        v_conf.conf_id,
        v_conf.seq_entrada,
        v_conf.nf,
        v_conf.status,
        v_conf.started_by,
        v_conf.started_mat,
        v_conf.started_nome,
        coalesce(v_locked_items, 0),
        coalesce(v_pending_items, 0),
        (
            v_conf.status in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_falta', 'finalizado_parcial')
            and coalesce(v_pending_items, 0) > 0
        );
end;
$$;

drop function if exists public.rpc_conf_entrada_notas_reopen_partial_conference(bigint, bigint, integer);
create function public.rpc_conf_entrada_notas_reopen_partial_conference(
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
    v_today date;
    v_conf app.conf_entrada_notas%rowtype;
    v_user_active app.conf_entrada_notas%rowtype;
    v_profile record;
    v_pending_items integer := 0;
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
    v_today := (timezone('America/Sao_Paulo', now()))::date;

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
          or v_user_active.seq_entrada <> p_seq_entrada
          or v_user_active.nf <> p_nf
       ) then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_ENTRADA';
    end if;

    select *
    into v_conf
    from app.conf_entrada_notas c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.seq_entrada = p_seq_entrada
      and c.nf = p_nf
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    for update
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if v_conf.status = 'em_conferencia' then
        if v_conf.started_by <> v_uid then
            raise exception 'CONFERENCIA_EM_USO';
        end if;

        return query
        select
            v_conf.conf_id,
            v_conf.conf_date,
            v_conf.cd,
            v_conf.seq_entrada,
            v_conf.nf,
            v_conf.transportadora,
            v_conf.fornecedor,
            v_conf.status,
            v_conf.started_by,
            v_conf.started_mat,
            v_conf.started_nome,
            v_conf.started_at,
            v_conf.finalized_at,
            v_conf.updated_at,
            false as is_read_only;
        return;
    end if;

    if v_conf.status not in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_falta', 'finalizado_parcial') then
        raise exception 'CONFERENCIA_FINALIZADA_SEM_PENDENCIA';
    end if;

    select count(*)::integer
    into v_pending_items
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_conf.conf_id
      and i.qtd_conferida = 0;

    if coalesce(v_pending_items, 0) <= 0 then
        raise exception 'CONFERENCIA_FINALIZADA_SEM_PENDENCIA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    update app.conf_entrada_notas c
    set
        status = 'em_conferencia',
        started_by = v_uid,
        started_mat = coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        started_nome = coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
        started_at = now(),
        finalized_at = null,
        updated_at = now()
    where c.conf_id = v_conf.conf_id
    returning * into v_conf;

    perform app.conf_entrada_notas_touch_colaborador_from_session(v_conf.conf_id);

    return query
    select
        v_conf.conf_id,
        v_conf.conf_date,
        v_conf.cd,
        v_conf.seq_entrada,
        v_conf.nf,
        v_conf.transportadora,
        v_conf.fornecedor,
        v_conf.status,
        v_conf.started_by,
        v_conf.started_mat,
        v_conf.started_nome,
        v_conf.started_at,
        v_conf.finalized_at,
        v_conf.updated_at,
        false as is_read_only;
end;
$$;

drop function if exists public.rpc_conf_entrada_notas_route_overview(integer);
create function public.rpc_conf_entrada_notas_route_overview(p_cd integer default null)
returns table (
    transportadora text,
    fornecedor text,
    seq_entrada bigint,
    nf bigint,
    total_itens integer,
    itens_conferidos integer,
    itens_divergentes integer,
    valor_total numeric(18, 2),
    valor_conferido numeric(18, 2),
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
            t.coddv,
            greatest(coalesce(max(t.vl_tt), 0), 0)::numeric(18, 2) as vl_tt
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
            count(*) filter (where c.seq_count > 1)::integer as produtos_multiplos_seq,
            coalesce(sum(e.vl_tt), 0)::numeric(18, 2) as valor_total
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
                  and (
                      i.qtd_conferida = 0
                      or i.qtd_conferida > i.qtd_esperada
                      or (i.qtd_conferida > 0 and i.qtd_conferida < i.qtd_esperada)
                  )
            ) as itens_divergentes,
            (
                select coalesce(sum(
                    case
                        when coalesce(i.qtd_esperada, 0) <= 0 then 0::numeric
                        else (
                            least(
                                greatest(coalesce(i.qtd_conferida, 0)::numeric, 0::numeric),
                                greatest(coalesce(i.qtd_esperada, 0)::numeric, 0::numeric)
                            )
                            / nullif(greatest(coalesce(i.qtd_esperada, 0)::numeric, 0::numeric), 0::numeric)
                        ) * coalesce(ei.vl_tt, 0::numeric)
                    end
                ), 0::numeric)::numeric(18, 2)
                from app.conf_entrada_notas_itens i
                join entrada_itens ei
                  on ei.seq_entrada = c.seq_entrada
                 and ei.nf = c.nf
                 and ei.coddv = i.coddv
                where i.conf_id = c.conf_id
            ) as valor_conferido
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
        coalesce(b.valor_total, 0)::numeric(18, 2) as valor_total,
        least(coalesce(c.valor_conferido, 0), coalesce(b.valor_total, 0))::numeric(18, 2) as valor_conferido,
        case
            when c.status = 'finalizado_parcial' then 'conferido_parcialmente'
            when c.status in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_falta') then 'concluido'
            when c.status = 'em_conferencia' then 'em_andamento'
            else 'pendente'
        end as status,
        c.colaborador_nome,
        c.colaborador_mat,
        case
            when c.status = 'finalizado_parcial' then c.finalized_at
            when c.status in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_falta') then c.finalized_at
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

grant execute on function public.rpc_conf_entrada_notas_get_items(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_get_items_v2(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_set_item_qtd(uuid, integer, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_sync_snapshot(uuid, jsonb) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_finalize(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_get_partial_reopen_info(bigint, bigint, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_reopen_partial_conference(bigint, bigint, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_route_overview(integer) to authenticated;
