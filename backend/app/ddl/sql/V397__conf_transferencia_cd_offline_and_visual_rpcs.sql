drop function if exists public.rpc_conf_transferencia_cd_manifest_meta(integer);
create or replace function public.rpc_conf_transferencia_cd_manifest_meta(p_cd integer default null)
returns table (
    cd integer,
    row_count integer,
    notas_count integer,
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
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);

    return query
    with base as (
        select
            t.dt_nf,
            t.nf_trf,
            t.sq_nf,
            t.cd_ori,
            t.cd_des,
            t.coddv,
            t.source_run_id,
            t.updated_at
        from app.db_transf_cd t
        where (t.cd_ori = v_cd or t.cd_des = v_cd)
          and t.dt_nf is not null
          and t.nf_trf is not null
          and t.sq_nf is not null
          and t.cd_ori is not null
          and t.cd_des is not null
          and t.coddv is not null
    ),
    notas as (
        select b.dt_nf, b.nf_trf, b.sq_nf, b.cd_ori, b.cd_des
        from base b
        group by b.dt_nf, b.nf_trf, b.sq_nf, b.cd_ori, b.cd_des
    )
    select
        v_cd,
        count(*)::integer,
        (select count(*)::integer from notas),
        (array_agg(distinct b.source_run_id) filter (where b.source_run_id is not null))[1],
        md5(coalesce(string_agg(
            concat_ws('|', b.dt_nf, b.nf_trf, b.sq_nf, b.cd_ori, b.cd_des, b.coddv, b.updated_at),
            '||'
            order by b.dt_nf, b.nf_trf, b.sq_nf, b.cd_ori, b.cd_des, b.coddv
        ), '')),
        coalesce(max(b.updated_at), now())
    from base b;
end;
$$;


drop function if exists public.rpc_conf_transferencia_cd_manifest_items_page(integer, integer, integer);
create or replace function public.rpc_conf_transferencia_cd_manifest_items_page(
    p_cd integer default null,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    dt_nf date,
    nf_trf bigint,
    sq_nf bigint,
    cd_ori integer,
    cd_des integer,
    cd_ori_nome text,
    cd_des_nome text,
    etapa text,
    coddv integer,
    descricao text,
    qtd_esperada integer,
    embcomp_cx integer,
    qtd_cxpad integer
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

    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_limit := greatest(coalesce(p_limit, 1000), 1);
    v_offset := greatest(coalesce(p_offset, 0), 0);

    return query
    select
        t.dt_nf,
        t.nf_trf,
        t.sq_nf,
        t.cd_ori,
        t.cd_des,
        app.conf_transferencia_cd_nome_cd(t.cd_ori) as cd_ori_nome,
        app.conf_transferencia_cd_nome_cd(t.cd_des) as cd_des_nome,
        app.conf_transferencia_cd_etapa_for_cd(v_cd, t.cd_ori, t.cd_des) as etapa,
        t.coddv,
        coalesce(nullif(trim(max(t.descricao)), ''), format('CODDV %s', t.coddv)) as descricao,
        greatest(sum(greatest(coalesce(t.qtd_atend, 0), 0))::integer, 0) as qtd_esperada,
        max(t.embcomp_cx)::integer as embcomp_cx,
        sum(greatest(coalesce(t.qtd_cxpad, 0), 0))::integer as qtd_cxpad
    from app.db_transf_cd t
    where (t.cd_ori = v_cd or t.cd_des = v_cd)
      and t.dt_nf is not null
      and t.nf_trf is not null
      and t.sq_nf is not null
      and t.cd_ori is not null
      and t.cd_des is not null
      and t.coddv is not null
    group by t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des, t.coddv
    order by t.dt_nf desc, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des, t.coddv
    limit v_limit
    offset v_offset;
end;
$$;


drop function if exists public.rpc_conf_transferencia_cd_manifest_barras_page(integer, integer, integer);
create or replace function public.rpc_conf_transferencia_cd_manifest_barras_page(
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

    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_limit := greatest(coalesce(p_limit, 1000), 1);
    v_offset := greatest(coalesce(p_offset, 0), 0);

    return query
    with coddvs as (
        select distinct t.coddv
        from app.db_transf_cd t
        where (t.cd_ori = v_cd or t.cd_des = v_cd)
          and t.coddv is not null
    )
    select
        nullif(trim(b.barras), '') as barras,
        b.coddv,
        coalesce(nullif(trim(max(b.descricao)), ''), format('CODDV %s', b.coddv)) as descricao,
        max(b.updated_at) as updated_at
    from app.db_barras b
    join coddvs c on c.coddv = b.coddv
    where nullif(trim(b.barras), '') is not null
    group by nullif(trim(b.barras), ''), b.coddv
    order by b.coddv, nullif(trim(b.barras), '')
    limit v_limit
    offset v_offset;
end;
$$;


drop function if exists public.rpc_conf_transferencia_cd_manifest_notes(integer);
create or replace function public.rpc_conf_transferencia_cd_manifest_notes(p_cd integer default null)
returns table (
    dt_nf date,
    nf_trf bigint,
    sq_nf bigint,
    cd_ori integer,
    cd_des integer,
    cd_ori_nome text,
    cd_des_nome text,
    etapa text,
    total_itens integer,
    qtd_esperada_total integer,
    saida_status text,
    saida_started_mat text,
    saida_started_nome text,
    saida_started_at timestamptz,
    saida_finalized_at timestamptz,
    entrada_status text,
    entrada_started_mat text,
    entrada_started_nome text,
    entrada_started_at timestamptz,
    entrada_finalized_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);

    return query
    with base as (
        select
            t.dt_nf,
            t.nf_trf,
            t.sq_nf,
            t.cd_ori,
            t.cd_des,
            count(distinct t.coddv)::integer as total_itens,
            sum(greatest(coalesce(t.qtd_atend, 0), 0))::integer as qtd_esperada_total
        from app.db_transf_cd t
        where (t.cd_ori = v_cd or t.cd_des = v_cd)
          and t.dt_nf is not null
          and t.nf_trf is not null
          and t.sq_nf is not null
          and t.cd_ori is not null
          and t.cd_des is not null
          and t.coddv is not null
        group by t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des
    )
    select
        b.dt_nf,
        b.nf_trf,
        b.sq_nf,
        b.cd_ori,
        b.cd_des,
        app.conf_transferencia_cd_nome_cd(b.cd_ori) as cd_ori_nome,
        app.conf_transferencia_cd_nome_cd(b.cd_des) as cd_des_nome,
        app.conf_transferencia_cd_etapa_for_cd(v_cd, b.cd_ori, b.cd_des) as etapa,
        b.total_itens,
        b.qtd_esperada_total,
        s.status as saida_status,
        nullif(trim(s.started_mat), '') as saida_started_mat,
        nullif(trim(s.started_nome), '') as saida_started_nome,
        s.started_at as saida_started_at,
        s.finalized_at as saida_finalized_at,
        e.status as entrada_status,
        nullif(trim(e.started_mat), '') as entrada_started_mat,
        nullif(trim(e.started_nome), '') as entrada_started_nome,
        e.started_at as entrada_started_at,
        e.finalized_at as entrada_finalized_at
    from base b
    left join app.conf_transferencia_cd s
      on s.dt_nf = b.dt_nf
     and s.nf_trf = b.nf_trf
     and s.sq_nf = b.sq_nf
     and s.cd_ori = b.cd_ori
     and s.cd_des = b.cd_des
     and s.etapa = 'saida'
    left join app.conf_transferencia_cd e
      on e.dt_nf = b.dt_nf
     and e.nf_trf = b.nf_trf
     and e.sq_nf = b.sq_nf
     and e.cd_ori = b.cd_ori
     and e.cd_des = b.cd_des
     and e.etapa = 'entrada'
    order by b.dt_nf desc, b.nf_trf, b.sq_nf, b.cd_ori, b.cd_des;
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

    with payload as (
        select
            (item->>'coddv')::integer as coddv,
            greatest(coalesce((item->>'qtd_conferida')::integer, 0), 0) as qtd_conferida,
            nullif(regexp_replace(coalesce(item->>'barras', ''), '\s+', '', 'g'), '') as barras
        from jsonb_array_elements(p_items) item
        where nullif(item->>'coddv', '') is not null
    )
    update app.conf_transferencia_cd_itens i
    set
        qtd_conferida = p.qtd_conferida,
        barras = p.barras,
        updated_at = now()
    from payload p
    where i.conf_id = v_conf.conf_id
      and i.coddv = p.coddv;

    update app.conf_transferencia_cd c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;
end;
$$;

grant execute on function public.rpc_conf_transferencia_cd_manifest_meta(integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_manifest_items_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_manifest_barras_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_manifest_notes(integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_sync_snapshot(uuid, jsonb) to authenticated;
