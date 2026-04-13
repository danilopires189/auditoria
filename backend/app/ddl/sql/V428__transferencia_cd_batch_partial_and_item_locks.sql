alter table if exists app.conf_transferencia_cd
    drop constraint if exists conf_transferencia_cd_status_check;

alter table if exists app.conf_transferencia_cd
    add constraint conf_transferencia_cd_status_check
    check (status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta', 'finalizado_parcial'));

alter table if exists app.conf_transferencia_cd_itens
    add column if not exists locked_by uuid references auth.users(id) on delete set null,
    add column if not exists locked_mat text,
    add column if not exists locked_nome text,
    add column if not exists locked_at timestamptz;

create index if not exists idx_conf_transferencia_cd_itens_locked_by
    on app.conf_transferencia_cd_itens(locked_by)
    where locked_by is not null;

drop function if exists public.rpc_conf_transferencia_cd_open_nf(integer, bigint, bigint, date, integer, integer);
create or replace function public.rpc_conf_transferencia_cd_open_nf(
    p_cd integer,
    p_nf_trf bigint,
    p_sq_nf bigint,
    p_dt_nf date,
    p_cd_ori integer,
    p_cd_des integer
)
returns table (
    conf_id uuid,
    conf_date date,
    dt_nf date,
    nf_trf bigint,
    sq_nf bigint,
    cd_ori integer,
    cd_des integer,
    cd_ori_nome text,
    cd_des_nome text,
    etapa text,
    status text,
    falta_motivo text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean,
    origem_status text,
    origem_started_mat text,
    origem_started_nome text,
    origem_started_at timestamptz,
    origem_finalized_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_etapa text;
    v_conf app.conf_transferencia_cd%rowtype;
    v_profile record;
    v_cd_ori_nome text;
    v_cd_des_nome text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if p_nf_trf is null or p_sq_nf is null or p_dt_nf is null or p_cd_ori is null or p_cd_des is null then
        raise exception 'TRANSFERENCIA_IDENTIFICACAO_OBRIGATORIA';
    end if;

    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_etapa := app.conf_transferencia_cd_etapa_for_cd(v_cd, p_cd_ori, p_cd_des);

    if not exists (
        select 1
        from app.db_transf_cd t
        where t.dt_nf = p_dt_nf
          and t.nf_trf = p_nf_trf
          and t.sq_nf = p_sq_nf
          and t.cd_ori = p_cd_ori
          and t.cd_des = p_cd_des
          and t.coddv is not null
    ) then
        raise exception 'TRANSFERENCIA_NAO_ENCONTRADA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    select *
    into v_conf
    from app.conf_transferencia_cd c
    where c.dt_nf = p_dt_nf
      and c.nf_trf = p_nf_trf
      and c.sq_nf = p_sq_nf
      and c.cd_ori = p_cd_ori
      and c.cd_des = p_cd_des
      and c.etapa = v_etapa
    limit 1;

    if v_conf.conf_id is null then
        v_cd_ori_nome := app.conf_transferencia_cd_nome_cd(p_cd_ori);
        v_cd_des_nome := app.conf_transferencia_cd_nome_cd(p_cd_des);

        insert into app.conf_transferencia_cd (
            dt_nf,
            nf_trf,
            sq_nf,
            cd_ori,
            cd_des,
            cd_ori_nome,
            cd_des_nome,
            etapa,
            started_by,
            started_mat,
            started_nome
        )
        values (
            p_dt_nf,
            p_nf_trf,
            p_sq_nf,
            p_cd_ori,
            p_cd_des,
            v_cd_ori_nome,
            v_cd_des_nome,
            v_etapa,
            v_uid,
            coalesce(nullif(trim(v_profile.mat), ''), ''),
            coalesce(nullif(trim(v_profile.nome), ''), 'USUARIO')
        )
        returning * into v_conf;

        insert into app.conf_transferencia_cd_itens (
            conf_id,
            coddv,
            barras,
            descricao,
            qtd_esperada,
            qtd_conferida,
            embcomp_cx,
            qtd_cxpad,
            updated_at
        )
        select
            v_conf.conf_id,
            t.coddv,
            null,
            coalesce(nullif(trim(max(t.descricao)), ''), format('CODDV %s', t.coddv)),
            greatest(sum(greatest(coalesce(t.qtd_atend, 0), 0))::integer, 0),
            0,
            max(t.embcomp_cx)::integer,
            sum(greatest(coalesce(t.qtd_cxpad, 0), 0))::integer,
            now()
        from app.db_transf_cd t
        where t.dt_nf = p_dt_nf
          and t.nf_trf = p_nf_trf
          and t.sq_nf = p_sq_nf
          and t.cd_ori = p_cd_ori
          and t.cd_des = p_cd_des
          and t.coddv is not null
        group by t.coddv
        on conflict on constraint uq_conf_transferencia_cd_itens
        do update set
            descricao = excluded.descricao,
            qtd_esperada = excluded.qtd_esperada,
            embcomp_cx = excluded.embcomp_cx,
            qtd_cxpad = excluded.qtd_cxpad,
            updated_at = app.conf_transferencia_cd_itens.updated_at;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.dt_nf,
        c.nf_trf,
        c.sq_nf,
        c.cd_ori,
        c.cd_des,
        coalesce(c.cd_ori_nome, app.conf_transferencia_cd_nome_cd(c.cd_ori)) as cd_ori_nome,
        coalesce(c.cd_des_nome, app.conf_transferencia_cd_nome_cd(c.cd_des)) as cd_des_nome,
        c.etapa,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        (c.status <> 'em_conferencia' or c.started_by <> v_uid) as is_read_only,
        s.status as origem_status,
        nullif(trim(s.started_mat), '') as origem_started_mat,
        nullif(trim(s.started_nome), '') as origem_started_nome,
        s.started_at as origem_started_at,
        s.finalized_at as origem_finalized_at
    from app.conf_transferencia_cd c
    left join app.conf_transferencia_cd s
      on s.dt_nf = c.dt_nf
     and s.nf_trf = c.nf_trf
     and s.sq_nf = c.sq_nf
     and s.cd_ori = c.cd_ori
     and s.cd_des = c.cd_des
     and s.etapa = 'saida'
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

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
        case
            when i.qtd_conferida = 0 then 0
            else greatest(i.qtd_esperada - i.qtd_conferida, 0)
        end as qtd_falta,
        greatest(i.qtd_conferida - i.qtd_esperada, 0) as qtd_sobra,
        case
            when i.qtd_conferida = 0 then 'nao_conferido'
            when i.qtd_conferida < i.qtd_esperada then 'falta'
            when i.qtd_conferida > i.qtd_esperada then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.embcomp_cx,
        i.qtd_cxpad,
        case when v_conf.etapa = 'entrada' then coalesce(occ.ocorrencia_avariado_qtd, 0) else 0 end as ocorrencia_avariado_qtd,
        case when v_conf.etapa = 'entrada' then coalesce(occ.ocorrencia_vencido_qtd, 0) else 0 end as ocorrencia_vencido_qtd,
        i.updated_at,
        (i.locked_by is not null and i.qtd_conferida > 0) as is_locked,
        i.locked_by,
        i.locked_mat,
        i.locked_nome
    from app.conf_transferencia_cd_itens i
    left join occ
      on occ.conf_id = i.conf_id
     and occ.coddv = i.coddv
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

drop function if exists public.rpc_conf_transferencia_cd_set_item_qtd(uuid, integer, integer);
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
    updated_at timestamptz,
    is_locked boolean,
    locked_by uuid,
    locked_mat text,
    locked_nome text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_transferencia_cd%rowtype;
    v_locked_by uuid;
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

    select i.locked_by
    into v_locked_by
    from app.conf_transferencia_cd_itens i
    where i.conf_id = v_conf.conf_id
      and i.coddv = p_coddv
    limit 1;

    if v_locked_by is not null then
        raise exception 'ITEM_BLOQUEADO';
    end if;

    update app.conf_transferencia_cd_itens i
    set
        qtd_conferida = p_qtd_conferida,
        updated_at = now()
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

drop function if exists public.rpc_conf_transferencia_cd_reset_item(uuid, integer);
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
    updated_at timestamptz,
    is_locked boolean,
    locked_by uuid,
    locked_mat text,
    locked_nome text
)
language sql
security definer
set search_path = app, authz, public
as $$
    select *
    from public.rpc_conf_transferencia_cd_set_item_qtd(p_conf_id, p_coddv, 0);
$$;

drop function if exists public.rpc_conf_transferencia_cd_scan_barcode(uuid, text, integer, text);
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
    updated_at timestamptz,
    is_locked boolean,
    locked_by uuid,
    locked_mat text,
    locked_nome text
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
    v_locked_by uuid;
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

    select i.locked_by
    into v_locked_by
    from app.conf_transferencia_cd_itens i
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv
    limit 1;

    if v_locked_by is not null then
        raise exception 'ITEM_BLOQUEADO';
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

drop function if exists public.rpc_conf_transferencia_cd_sync_snapshot(uuid, jsonb);
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
          and i.coddv = v_item.coddv
          and i.locked_by is null;

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

drop function if exists public.rpc_conf_transferencia_cd_finalize(uuid, text);
create or replace function public.rpc_conf_transferencia_cd_finalize(
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
    v_conf app.conf_transferencia_cd%rowtype;
    v_falta_count integer;
    v_sobra_count integer;
    v_correto_count integer;
    v_nao_conferido_count integer;
    v_tocado_count integer;
    v_status text;
    v_profile record;
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

    select
        count(*) filter (where i.qtd_conferida = 0)::integer,
        count(*) filter (where i.qtd_conferida > 0 and i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida = i.qtd_esperada and i.qtd_esperada > 0)::integer,
        count(*) filter (where i.qtd_conferida > 0)::integer
    into
        v_nao_conferido_count,
        v_falta_count,
        v_sobra_count,
        v_correto_count,
        v_tocado_count
    from app.conf_transferencia_cd_itens i
    where i.conf_id = v_conf.conf_id;

    if coalesce(v_sobra_count, 0) > 0 then
        raise exception 'SOBRA_PENDENTE';
    end if;

    if coalesce(v_tocado_count, 0) <= 0 then
        raise exception 'NENHUM_ITEM_CONFERIDO';
    end if;

    v_status := case
        when coalesce(v_nao_conferido_count, 0) = 0 and coalesce(v_falta_count, 0) = 0 and coalesce(v_sobra_count, 0) = 0 then 'finalizado_ok'
        else 'finalizado_parcial'
    end;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    update app.conf_transferencia_cd_itens i
    set
        locked_by = case when i.qtd_conferida > 0 then v_uid else null end,
        locked_mat = case when i.qtd_conferida > 0 then coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA') else null end,
        locked_nome = case when i.qtd_conferida > 0 then coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO') else null end,
        locked_at = case when i.qtd_conferida > 0 then now() else null end,
        updated_at = now()
    where i.conf_id = v_conf.conf_id;

    update app.conf_transferencia_cd c
    set
        status = v_status,
        falta_motivo = null,
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

drop function if exists public.rpc_conf_transferencia_cd_get_partial_reopen_info(bigint, bigint, date, integer, integer, integer);
create or replace function public.rpc_conf_transferencia_cd_get_partial_reopen_info(
    p_nf_trf bigint,
    p_sq_nf bigint,
    p_dt_nf date,
    p_cd integer default null,
    p_cd_ori integer default null,
    p_cd_des integer default null
)
returns table (
    conf_id uuid,
    status text,
    previous_started_by uuid,
    previous_started_mat text,
    previous_started_nome text,
    locked_items integer,
    pending_items integer,
    can_reopen boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_transferencia_cd%rowtype;
    v_cd integer;
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

    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);

    select *
    into v_conf
    from app.conf_transferencia_cd c
    where c.dt_nf = p_dt_nf
      and c.nf_trf = p_nf_trf
      and c.sq_nf = p_sq_nf
      and (p_cd_ori is null or c.cd_ori = p_cd_ori)
      and (p_cd_des is null or c.cd_des = p_cd_des)
      and (
          (c.etapa = 'saida' and c.cd_ori = v_cd)
          or (c.etapa = 'entrada' and c.cd_des = v_cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    select
        count(*) filter (where i.locked_by is not null and i.qtd_conferida > 0)::integer,
        count(*) filter (where i.qtd_conferida = 0)::integer
    into
        v_locked_items,
        v_pending_items
    from app.conf_transferencia_cd_itens i
    where i.conf_id = v_conf.conf_id;

    return query
    select
        v_conf.conf_id,
        v_conf.status,
        v_conf.started_by,
        v_conf.started_mat,
        v_conf.started_nome,
        coalesce(v_locked_items, 0),
        coalesce(v_pending_items, 0),
        (v_conf.status = 'finalizado_parcial' and coalesce(v_pending_items, 0) > 0) as can_reopen;
end;
$$;

drop function if exists public.rpc_conf_transferencia_cd_reopen_partial_conference(bigint, bigint, date, integer, integer, integer);
create or replace function public.rpc_conf_transferencia_cd_reopen_partial_conference(
    p_nf_trf bigint,
    p_sq_nf bigint,
    p_dt_nf date,
    p_cd integer default null,
    p_cd_ori integer default null,
    p_cd_des integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    dt_nf date,
    nf_trf bigint,
    sq_nf bigint,
    cd_ori integer,
    cd_des integer,
    cd_ori_nome text,
    cd_des_nome text,
    etapa text,
    status text,
    falta_motivo text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean,
    origem_status text,
    origem_started_mat text,
    origem_started_nome text,
    origem_started_at timestamptz,
    origem_finalized_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_transferencia_cd%rowtype;
    v_cd integer;
    v_pending_items integer := 0;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);

    select *
    into v_conf
    from app.conf_transferencia_cd c
    where c.dt_nf = p_dt_nf
      and c.nf_trf = p_nf_trf
      and c.sq_nf = p_sq_nf
      and (p_cd_ori is null or c.cd_ori = p_cd_ori)
      and (p_cd_des is null or c.cd_des = p_cd_des)
      and (
          (c.etapa = 'saida' and c.cd_ori = v_cd)
          or (c.etapa = 'entrada' and c.cd_des = v_cd)
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
            c.conf_id,
            c.conf_date,
            c.dt_nf,
            c.nf_trf,
            c.sq_nf,
            c.cd_ori,
            c.cd_des,
            c.cd_ori_nome,
            c.cd_des_nome,
            c.etapa,
            c.status,
            c.falta_motivo,
            c.started_by,
            c.started_mat,
            c.started_nome,
            c.started_at,
            c.finalized_at,
            c.updated_at,
            false as is_read_only,
            s.status as origem_status,
            s.started_mat as origem_started_mat,
            s.started_nome as origem_started_nome,
            s.started_at as origem_started_at,
            s.finalized_at as origem_finalized_at
        from app.conf_transferencia_cd c
        left join app.conf_transferencia_cd s
          on s.dt_nf = c.dt_nf
         and s.nf_trf = c.nf_trf
         and s.sq_nf = c.sq_nf
         and s.cd_ori = c.cd_ori
         and s.cd_des = c.cd_des
         and s.etapa = 'saida'
        where c.conf_id = v_conf.conf_id
        limit 1;
        return;
    end if;

    if v_conf.status <> 'finalizado_parcial' then
        raise exception 'CONFERENCIA_FINALIZADA_SEM_PENDENCIA';
    end if;

    select count(*) filter (where i.qtd_conferida = 0)::integer
    into v_pending_items
    from app.conf_transferencia_cd_itens i
    where i.conf_id = v_conf.conf_id;

    if coalesce(v_pending_items, 0) <= 0 then
        raise exception 'CONFERENCIA_FINALIZADA_SEM_PENDENCIA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    update app.conf_transferencia_cd c
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

    return query
    select
        c.conf_id,
        c.conf_date,
        c.dt_nf,
        c.nf_trf,
        c.sq_nf,
        c.cd_ori,
        c.cd_des,
        c.cd_ori_nome,
        c.cd_des_nome,
        c.etapa,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        false as is_read_only,
        s.status as origem_status,
        s.started_mat as origem_started_mat,
        s.started_nome as origem_started_nome,
        s.started_at as origem_started_at,
        s.finalized_at as origem_finalized_at
    from app.conf_transferencia_cd c
    left join app.conf_transferencia_cd s
      on s.dt_nf = c.dt_nf
     and s.nf_trf = c.nf_trf
     and s.sq_nf = c.sq_nf
     and s.cd_ori = c.cd_ori
     and s.cd_des = c.cd_des
     and s.etapa = 'saida'
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

drop function if exists public.rpc_conf_transferencia_cd_open_nf_batch(jsonb, integer);
create or replace function public.rpc_conf_transferencia_cd_open_nf_batch(
    p_targets jsonb,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    dt_nf date,
    nf_trf bigint,
    sq_nf bigint,
    cd_ori integer,
    cd_des integer,
    cd_ori_nome text,
    cd_des_nome text,
    etapa text,
    status text,
    falta_motivo text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean,
    origem_status text,
    origem_started_mat text,
    origem_started_nome text,
    origem_started_at timestamptz,
    origem_finalized_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_target record;
    v_conf record;
    v_expected_etapa text := null;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if p_targets is null
       or jsonb_typeof(p_targets) <> 'array'
       or jsonb_array_length(p_targets) = 0 then
        raise exception 'TRANSFERENCIA_IDENTIFICACAO_OBRIGATORIA';
    end if;

    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);

    for v_target in
        select
            (item->>'nf_trf')::bigint as nf_trf,
            (item->>'sq_nf')::bigint as sq_nf,
            (item->>'dt_nf')::date as dt_nf,
            (item->>'cd_ori')::integer as cd_ori,
            (item->>'cd_des')::integer as cd_des
        from jsonb_array_elements(p_targets) item
    loop
        if v_target.nf_trf is null
           or v_target.sq_nf is null
           or v_target.dt_nf is null
           or v_target.cd_ori is null
           or v_target.cd_des is null then
            raise exception 'TRANSFERENCIA_IDENTIFICACAO_OBRIGATORIA';
        end if;

        if not exists (
            select 1
            from app.db_transf_cd t
            where t.dt_nf = v_target.dt_nf
              and t.nf_trf = v_target.nf_trf
              and t.sq_nf = v_target.sq_nf
              and t.cd_ori = v_target.cd_ori
              and t.cd_des = v_target.cd_des
              and t.coddv is not null
        ) then
            raise exception 'TRANSFERENCIA_NAO_ENCONTRADA';
        end if;

        if v_expected_etapa is null then
            v_expected_etapa := app.conf_transferencia_cd_etapa_for_cd(v_cd, v_target.cd_ori, v_target.cd_des);
        elsif v_expected_etapa <> app.conf_transferencia_cd_etapa_for_cd(v_cd, v_target.cd_ori, v_target.cd_des) then
            raise exception 'ETAPA_MISTA_NAO_PERMITIDA';
        end if;

        select
            c.conf_id,
            c.status,
            c.started_by
        into v_conf
        from app.conf_transferencia_cd c
        where c.dt_nf = v_target.dt_nf
          and c.nf_trf = v_target.nf_trf
          and c.sq_nf = v_target.sq_nf
          and c.cd_ori = v_target.cd_ori
          and c.cd_des = v_target.cd_des
          and c.etapa = v_expected_etapa
        limit 1;

        if v_conf.conf_id is not null and v_conf.status = 'em_conferencia' and v_conf.started_by <> v_uid then
            raise exception 'CONFERENCIA_EM_USO';
        end if;

        if v_conf.conf_id is not null and v_conf.status <> 'em_conferencia' then
            raise exception 'CONFERENCIA_JA_FINALIZADA';
        end if;
    end loop;

    for v_target in
        select
            (item->>'nf_trf')::bigint as nf_trf,
            (item->>'sq_nf')::bigint as sq_nf,
            (item->>'dt_nf')::date as dt_nf,
            (item->>'cd_ori')::integer as cd_ori,
            (item->>'cd_des')::integer as cd_des
        from jsonb_array_elements(p_targets) item
    loop
        return query
        select *
        from public.rpc_conf_transferencia_cd_open_nf(
            v_cd,
            v_target.nf_trf,
            v_target.sq_nf,
            v_target.dt_nf,
            v_target.cd_ori,
            v_target.cd_des
        );
    end loop;
end;
$$;

grant execute on function public.rpc_conf_transferencia_cd_open_nf(integer, bigint, bigint, date, integer, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_open_nf_batch(jsonb, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_get_items(uuid) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_set_item_qtd(uuid, integer, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_reset_item(uuid, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_scan_barcode(uuid, text, integer, text) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_sync_snapshot(uuid, jsonb) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_finalize(uuid, text) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_get_partial_reopen_info(bigint, bigint, date, integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_reopen_partial_conference(bigint, bigint, date, integer, integer, integer) to authenticated;
