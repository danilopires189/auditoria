alter table app.conf_transferencia_cd
    add column if not exists origem_link text;

update app.conf_transferencia_cd
set origem_link = 'prevencaocd'
where nullif(trim(coalesce(origem_link, '')), '') is null;

alter table app.conf_transferencia_cd
    alter column origem_link set default 'prevencaocd';

alter table app.conf_transferencia_cd
    alter column origem_link set not null;

alter table app.conf_transferencia_cd
    drop constraint if exists uq_conf_transferencia_cd_nf_etapa;

alter table app.conf_transferencia_cd
    add constraint uq_conf_transferencia_cd_nf_etapa
    unique (dt_nf, nf_trf, sq_nf, cd_ori, cd_des, etapa, origem_link);

create index if not exists idx_conf_transferencia_cd_origem_cd_date_status
    on app.conf_transferencia_cd(origem_link, conf_date, cd_ori, cd_des, status);

create or replace function app.conf_transferencia_cd_resolve_origem_link(p_origem_link text default null)
returns text
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
    v_origem text;
begin
    v_origem := lower(nullif(trim(coalesce(p_origem_link, '')), ''));
    if v_origem is null then
        return 'prevencaocd';
    end if;
    if v_origem in ('prevencaocd', 'prevencaocds') then
        return 'prevencaocd';
    end if;
    if v_origem = 'logisticacd' then
        return 'logisticacd';
    end if;
    return v_origem;
end;
$$;

drop function if exists public.rpc_conf_transferencia_cd_get_active_conference();
drop function if exists public.rpc_conf_transferencia_cd_get_active_conference(text);
drop function if exists public.rpc_conf_transferencia_cd_open_nf(integer, bigint, bigint, date, integer, integer);
drop function if exists public.rpc_conf_transferencia_cd_open_nf(integer, bigint, bigint, date, integer, integer, text);
drop function if exists public.rpc_conf_transferencia_cd_note_search(integer, bigint);
drop function if exists public.rpc_conf_transferencia_cd_note_search(integer, bigint, text);
drop function if exists public.rpc_conf_transferencia_cd_manifest_notes(integer);
drop function if exists public.rpc_conf_transferencia_cd_manifest_notes(integer, text);
drop function if exists public.rpc_conf_transferencia_cd_open_nf_batch(jsonb, integer);
drop function if exists public.rpc_conf_transferencia_cd_open_nf_batch(jsonb, integer, text);
drop function if exists public.rpc_conf_transferencia_cd_get_partial_reopen_info(bigint, bigint, date, integer, integer, integer);
drop function if exists public.rpc_conf_transferencia_cd_get_partial_reopen_info(bigint, bigint, date, integer, integer, integer, text);
drop function if exists public.rpc_conf_transferencia_cd_reopen_partial_conference(bigint, bigint, date, integer, integer, integer);
drop function if exists public.rpc_conf_transferencia_cd_reopen_partial_conference(bigint, bigint, date, integer, integer, integer, text);
drop function if exists public.rpc_conf_transferencia_cd_conciliacao_count(date, date, integer);
drop function if exists public.rpc_conf_transferencia_cd_conciliacao_count(date, date, integer, text);
drop function if exists public.rpc_conf_transferencia_cd_conciliacao_rows(date, date, integer, integer, integer);
drop function if exists public.rpc_conf_transferencia_cd_conciliacao_rows(date, date, integer, integer, integer, text);
drop function if exists public.rpc_apoio_gestor_daily_summary(integer, date);
drop function if exists public.rpc_apoio_gestor_daily_summary(integer, date, text);

create or replace function public.rpc_conf_transferencia_cd_get_active_conference(
    p_origem_link text default 'prevencaocd'
)
returns table (
    conf_id uuid,
    conf_date date,
    origem_link text,
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
    v_origem text;
    v_conf app.conf_transferencia_cd%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    v_origem := app.conf_transferencia_cd_resolve_origem_link(p_origem_link);

    select *
    into v_conf
    from app.conf_transferencia_cd c
    where c.started_by = v_uid
      and c.status = 'em_conferencia'
      and c.origem_link = v_origem
      and (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, c.cd_ori) or authz.can_access_cd(v_uid, c.cd_des))
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_conf.conf_id is null then return; end if;

    return query
    select
        c.conf_id, c.conf_date, c.origem_link, c.dt_nf, c.nf_trf, c.sq_nf, c.cd_ori, c.cd_des,
        coalesce(c.cd_ori_nome, app.conf_transferencia_cd_nome_cd(c.cd_ori)),
        coalesce(c.cd_des_nome, app.conf_transferencia_cd_nome_cd(c.cd_des)),
        c.etapa, c.status, c.falta_motivo, c.started_by, c.started_mat, c.started_nome,
        c.started_at, c.finalized_at, c.updated_at, false,
        s.status, nullif(trim(s.started_mat), ''), nullif(trim(s.started_nome), ''), s.started_at, s.finalized_at
    from app.conf_transferencia_cd c
    left join app.conf_transferencia_cd s
      on s.dt_nf = c.dt_nf
     and s.nf_trf = c.nf_trf
     and s.sq_nf = c.sq_nf
     and s.cd_ori = c.cd_ori
     and s.cd_des = c.cd_des
     and s.etapa = 'saida'
     and s.origem_link = c.origem_link
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_transferencia_cd_open_nf(
    p_cd integer,
    p_nf_trf bigint,
    p_sq_nf bigint,
    p_dt_nf date,
    p_cd_ori integer,
    p_cd_des integer,
    p_origem_link text default 'prevencaocd'
)
returns table (
    conf_id uuid,
    conf_date date,
    origem_link text,
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
    v_origem text;
    v_conf app.conf_transferencia_cd%rowtype;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_nf_trf is null or p_sq_nf is null or p_dt_nf is null or p_cd_ori is null or p_cd_des is null then
        raise exception 'TRANSFERENCIA_IDENTIFICACAO_OBRIGATORIA';
    end if;

    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_etapa := app.conf_transferencia_cd_etapa_for_cd(v_cd, p_cd_ori, p_cd_des);
    v_origem := app.conf_transferencia_cd_resolve_origem_link(p_origem_link);

    if not exists (
        select 1
        from app.db_transf_cd t
        where t.dt_nf = p_dt_nf and t.nf_trf = p_nf_trf and t.sq_nf = p_sq_nf
          and t.cd_ori = p_cd_ori and t.cd_des = p_cd_des and t.coddv is not null
    ) then
        raise exception 'TRANSFERENCIA_NAO_ENCONTRADA';
    end if;

    select *
    into v_conf
    from app.conf_transferencia_cd c
    where c.dt_nf = p_dt_nf
      and c.nf_trf = p_nf_trf
      and c.sq_nf = p_sq_nf
      and c.cd_ori = p_cd_ori
      and c.cd_des = p_cd_des
      and c.etapa = v_etapa
      and c.origem_link = v_origem
    limit 1;

    if v_conf.conf_id is null then
        select * into v_profile from authz.current_profile_context_v2() limit 1;

        insert into app.conf_transferencia_cd (
            dt_nf, nf_trf, sq_nf, cd_ori, cd_des, cd_ori_nome, cd_des_nome, etapa,
            origem_link, started_by, started_mat, started_nome
        )
        values (
            p_dt_nf, p_nf_trf, p_sq_nf, p_cd_ori, p_cd_des,
            app.conf_transferencia_cd_nome_cd(p_cd_ori),
            app.conf_transferencia_cd_nome_cd(p_cd_des),
            v_etapa, v_origem, v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
        )
        returning * into v_conf;

        insert into app.conf_transferencia_cd_itens (
            conf_id, coddv, barras, descricao, qtd_esperada, qtd_conferida, embcomp_cx, qtd_cxpad, updated_at
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
        where t.dt_nf = p_dt_nf and t.nf_trf = p_nf_trf and t.sq_nf = p_sq_nf
          and t.cd_ori = p_cd_ori and t.cd_des = p_cd_des and t.coddv is not null
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
        c.conf_id, c.conf_date, c.origem_link, c.dt_nf, c.nf_trf, c.sq_nf, c.cd_ori, c.cd_des,
        coalesce(c.cd_ori_nome, app.conf_transferencia_cd_nome_cd(c.cd_ori)),
        coalesce(c.cd_des_nome, app.conf_transferencia_cd_nome_cd(c.cd_des)),
        c.etapa, c.status, c.falta_motivo, c.started_by, c.started_mat, c.started_nome,
        c.started_at, c.finalized_at, c.updated_at,
        (c.status <> 'em_conferencia' or c.started_by <> v_uid),
        s.status, nullif(trim(s.started_mat), ''), nullif(trim(s.started_nome), ''), s.started_at, s.finalized_at
    from app.conf_transferencia_cd c
    left join app.conf_transferencia_cd s
      on s.dt_nf = c.dt_nf and s.nf_trf = c.nf_trf and s.sq_nf = c.sq_nf
     and s.cd_ori = c.cd_ori and s.cd_des = c.cd_des and s.etapa = 'saida'
     and s.origem_link = c.origem_link
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_transferencia_cd_note_search(
    p_cd integer,
    p_nf_trf bigint,
    p_origem_link text default 'prevencaocd'
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
    v_origem text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_nf_trf is null then raise exception 'NF_OBRIGATORIA'; end if;
    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_origem := app.conf_transferencia_cd_resolve_origem_link(p_origem_link);

    return query
    with base as (
        select t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des,
               count(distinct t.coddv)::integer as total_itens,
               sum(greatest(coalesce(t.qtd_atend, 0), 0))::integer as qtd_esperada_total
        from app.db_transf_cd t
        where t.nf_trf = p_nf_trf
          and (t.cd_ori = v_cd or t.cd_des = v_cd)
          and t.dt_nf is not null and t.sq_nf is not null and t.cd_ori is not null
          and t.cd_des is not null and t.coddv is not null
        group by t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des
    )
    select
        b.dt_nf, b.nf_trf, b.sq_nf, b.cd_ori, b.cd_des,
        app.conf_transferencia_cd_nome_cd(b.cd_ori),
        app.conf_transferencia_cd_nome_cd(b.cd_des),
        app.conf_transferencia_cd_etapa_for_cd(v_cd, b.cd_ori, b.cd_des),
        b.total_itens, b.qtd_esperada_total,
        s.status, nullif(trim(s.started_mat), ''), nullif(trim(s.started_nome), ''), s.started_at, s.finalized_at,
        e.status, nullif(trim(e.started_mat), ''), nullif(trim(e.started_nome), ''), e.started_at, e.finalized_at
    from base b
    left join app.conf_transferencia_cd s
      on s.dt_nf = b.dt_nf and s.nf_trf = b.nf_trf and s.sq_nf = b.sq_nf
     and s.cd_ori = b.cd_ori and s.cd_des = b.cd_des and s.etapa = 'saida'
     and s.origem_link = v_origem
    left join app.conf_transferencia_cd e
      on e.dt_nf = b.dt_nf and e.nf_trf = b.nf_trf and e.sq_nf = b.sq_nf
     and e.cd_ori = b.cd_ori and e.cd_des = b.cd_des and e.etapa = 'entrada'
     and e.origem_link = v_origem
    order by b.dt_nf desc, b.sq_nf desc, b.cd_ori, b.cd_des;
end;
$$;

create or replace function public.rpc_conf_transferencia_cd_manifest_notes(
    p_cd integer default null,
    p_origem_link text default 'prevencaocd'
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
    v_origem text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_origem := app.conf_transferencia_cd_resolve_origem_link(p_origem_link);

    return query
    with base as (
        select t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des,
               count(distinct t.coddv)::integer as total_itens,
               sum(greatest(coalesce(t.qtd_atend, 0), 0))::integer as qtd_esperada_total
        from app.db_transf_cd t
        where (t.cd_ori = v_cd or t.cd_des = v_cd)
          and t.dt_nf is not null and t.nf_trf is not null and t.sq_nf is not null
          and t.cd_ori is not null and t.cd_des is not null and t.coddv is not null
        group by t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des
    )
    select
        b.dt_nf, b.nf_trf, b.sq_nf, b.cd_ori, b.cd_des,
        app.conf_transferencia_cd_nome_cd(b.cd_ori),
        app.conf_transferencia_cd_nome_cd(b.cd_des),
        app.conf_transferencia_cd_etapa_for_cd(v_cd, b.cd_ori, b.cd_des),
        b.total_itens, b.qtd_esperada_total,
        s.status, nullif(trim(s.started_mat), ''), nullif(trim(s.started_nome), ''), s.started_at, s.finalized_at,
        e.status, nullif(trim(e.started_mat), ''), nullif(trim(e.started_nome), ''), e.started_at, e.finalized_at
    from base b
    left join app.conf_transferencia_cd s
      on s.dt_nf = b.dt_nf and s.nf_trf = b.nf_trf and s.sq_nf = b.sq_nf
     and s.cd_ori = b.cd_ori and s.cd_des = b.cd_des and s.etapa = 'saida'
     and s.origem_link = v_origem
    left join app.conf_transferencia_cd e
      on e.dt_nf = b.dt_nf and e.nf_trf = b.nf_trf and e.sq_nf = b.sq_nf
     and e.cd_ori = b.cd_ori and e.cd_des = b.cd_des and e.etapa = 'entrada'
     and e.origem_link = v_origem
    order by b.dt_nf desc, b.nf_trf, b.sq_nf, b.cd_ori, b.cd_des;
end;
$$;

create or replace function public.rpc_conf_transferencia_cd_open_nf_batch(
    p_targets jsonb,
    p_cd integer default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    conf_id uuid,
    conf_date date,
    origem_link text,
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
    v_origem text;
    v_target record;
    v_expected_etapa text := null;
    v_conf record;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if p_targets is null or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then
        raise exception 'TRANSFERENCIA_IDENTIFICACAO_OBRIGATORIA';
    end if;

    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_origem := app.conf_transferencia_cd_resolve_origem_link(p_origem_link);

    for v_target in
        select (item->>'nf_trf')::bigint as nf_trf, (item->>'sq_nf')::bigint as sq_nf,
               (item->>'dt_nf')::date as dt_nf, (item->>'cd_ori')::integer as cd_ori,
               (item->>'cd_des')::integer as cd_des
        from jsonb_array_elements(p_targets) item
    loop
        if v_expected_etapa is null then
            v_expected_etapa := app.conf_transferencia_cd_etapa_for_cd(v_cd, v_target.cd_ori, v_target.cd_des);
        elsif v_expected_etapa <> app.conf_transferencia_cd_etapa_for_cd(v_cd, v_target.cd_ori, v_target.cd_des) then
            raise exception 'ETAPA_MISTA_NAO_PERMITIDA';
        end if;

        select c.conf_id, c.status, c.started_by
        into v_conf
        from app.conf_transferencia_cd c
        where c.dt_nf = v_target.dt_nf and c.nf_trf = v_target.nf_trf and c.sq_nf = v_target.sq_nf
          and c.cd_ori = v_target.cd_ori and c.cd_des = v_target.cd_des
          and c.etapa = v_expected_etapa and c.origem_link = v_origem
        limit 1;

        if v_conf.conf_id is not null and v_conf.status = 'em_conferencia' and v_conf.started_by <> v_uid then
            raise exception 'CONFERENCIA_EM_USO';
        end if;
        if v_conf.conf_id is not null and v_conf.status <> 'em_conferencia' then
            raise exception 'CONFERENCIA_JA_FINALIZADA';
        end if;
    end loop;

    for v_target in
        select (item->>'nf_trf')::bigint as nf_trf, (item->>'sq_nf')::bigint as sq_nf,
               (item->>'dt_nf')::date as dt_nf, (item->>'cd_ori')::integer as cd_ori,
               (item->>'cd_des')::integer as cd_des
        from jsonb_array_elements(p_targets) item
    loop
        return query
        select *
        from public.rpc_conf_transferencia_cd_open_nf(
            v_cd, v_target.nf_trf, v_target.sq_nf, v_target.dt_nf,
            v_target.cd_ori, v_target.cd_des, v_origem
        );
    end loop;
end;
$$;

create or replace function public.rpc_conf_transferencia_cd_get_partial_reopen_info(
    p_nf_trf bigint,
    p_sq_nf bigint,
    p_dt_nf date,
    p_cd integer default null,
    p_cd_ori integer default null,
    p_cd_des integer default null,
    p_origem_link text default 'prevencaocd'
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
    v_cd integer;
    v_origem text;
    v_conf app.conf_transferencia_cd%rowtype;
    v_locked_items integer := 0;
    v_pending_items integer := 0;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_origem := app.conf_transferencia_cd_resolve_origem_link(p_origem_link);

    select *
    into v_conf
    from app.conf_transferencia_cd c
    where c.dt_nf = p_dt_nf and c.nf_trf = p_nf_trf and c.sq_nf = p_sq_nf
      and (p_cd_ori is null or c.cd_ori = p_cd_ori)
      and (p_cd_des is null or c.cd_des = p_cd_des)
      and c.origem_link = v_origem
      and ((c.etapa = 'saida' and c.cd_ori = v_cd) or (c.etapa = 'entrada' and c.cd_des = v_cd))
    limit 1;

    if v_conf.conf_id is null then raise exception 'CONFERENCIA_NAO_ENCONTRADA'; end if;

    select
        count(*) filter (where i.locked_by is not null and i.qtd_conferida > 0)::integer,
        count(*) filter (where i.qtd_conferida = 0)::integer
    into v_locked_items, v_pending_items
    from app.conf_transferencia_cd_itens i
    where i.conf_id = v_conf.conf_id;

    return query
    select v_conf.conf_id, v_conf.status, v_conf.started_by, v_conf.started_mat, v_conf.started_nome,
           coalesce(v_locked_items, 0), coalesce(v_pending_items, 0),
           (v_conf.status = 'finalizado_parcial' and coalesce(v_pending_items, 0) > 0);
end;
$$;

create or replace function public.rpc_conf_transferencia_cd_reopen_partial_conference(
    p_nf_trf bigint,
    p_sq_nf bigint,
    p_dt_nf date,
    p_cd integer default null,
    p_cd_ori integer default null,
    p_cd_des integer default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    conf_id uuid,
    conf_date date,
    origem_link text,
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
    v_origem text;
    v_conf app.conf_transferencia_cd%rowtype;
    v_pending_items integer := 0;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_origem := app.conf_transferencia_cd_resolve_origem_link(p_origem_link);

    select *
    into v_conf
    from app.conf_transferencia_cd c
    where c.dt_nf = p_dt_nf and c.nf_trf = p_nf_trf and c.sq_nf = p_sq_nf
      and (p_cd_ori is null or c.cd_ori = p_cd_ori)
      and (p_cd_des is null or c.cd_des = p_cd_des)
      and c.origem_link = v_origem
      and ((c.etapa = 'saida' and c.cd_ori = v_cd) or (c.etapa = 'entrada' and c.cd_des = v_cd))
    for update
    limit 1;

    if v_conf.conf_id is null then raise exception 'CONFERENCIA_NAO_ENCONTRADA'; end if;
    if v_conf.status = 'em_conferencia' and v_conf.started_by <> v_uid then raise exception 'CONFERENCIA_EM_USO'; end if;
    if v_conf.status <> 'em_conferencia' and v_conf.status <> 'finalizado_parcial' then
        raise exception 'CONFERENCIA_FINALIZADA_SEM_PENDENCIA';
    end if;

    if v_conf.status = 'finalizado_parcial' then
        select count(*) filter (where i.qtd_conferida = 0)::integer
        into v_pending_items
        from app.conf_transferencia_cd_itens i
        where i.conf_id = v_conf.conf_id;
        if coalesce(v_pending_items, 0) <= 0 then raise exception 'CONFERENCIA_FINALIZADA_SEM_PENDENCIA'; end if;

        select * into v_profile from authz.current_profile_context_v2() limit 1;
        update app.conf_transferencia_cd c
        set status = 'em_conferencia',
            started_by = v_uid,
            started_mat = coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            started_nome = coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            started_at = now(),
            finalized_at = null,
            updated_at = now()
        where c.conf_id = v_conf.conf_id
        returning * into v_conf;
    end if;

    return query
    select
        c.conf_id, c.conf_date, c.origem_link, c.dt_nf, c.nf_trf, c.sq_nf, c.cd_ori, c.cd_des,
        c.cd_ori_nome, c.cd_des_nome, c.etapa, c.status, c.falta_motivo, c.started_by,
        c.started_mat, c.started_nome, c.started_at, c.finalized_at, c.updated_at, false,
        s.status, s.started_mat, s.started_nome, s.started_at, s.finalized_at
    from app.conf_transferencia_cd c
    left join app.conf_transferencia_cd s
      on s.dt_nf = c.dt_nf and s.nf_trf = c.nf_trf and s.sq_nf = c.sq_nf
     and s.cd_ori = c.cd_ori and s.cd_des = c.cd_des and s.etapa = 'saida'
     and s.origem_link = c.origem_link
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_transferencia_cd_conciliacao_count(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_origem_link text default 'prevencaocd'
)
returns table (
    total_notas bigint,
    total_itens bigint
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
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if not authz.is_admin(v_uid) then raise exception 'APENAS_ADMIN'; end if;
    if p_dt_ini is null or p_dt_fim is null then raise exception 'PERIODO_OBRIGATORIO'; end if;
    if p_dt_fim < p_dt_ini then raise exception 'PERIODO_INVALIDO'; end if;
    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);

    return query
    with notas as (
        select t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des
        from app.db_transf_cd t
        where t.dt_nf >= p_dt_ini and t.dt_nf <= p_dt_fim
          and (t.cd_ori = v_cd or t.cd_des = v_cd)
          and t.dt_nf is not null and t.nf_trf is not null and t.sq_nf is not null and t.coddv is not null
        group by t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des
    ),
    itens as (
        select t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des, t.coddv
        from app.db_transf_cd t
        join notas n on n.dt_nf = t.dt_nf and n.nf_trf = t.nf_trf and n.sq_nf = t.sq_nf
                    and n.cd_ori = t.cd_ori and n.cd_des = t.cd_des
        where t.coddv is not null
        group by t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des, t.coddv
    )
    select (select count(*)::bigint from notas), (select count(*)::bigint from itens);
end;
$$;

create or replace function public.rpc_conf_transferencia_cd_conciliacao_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_limit integer default 1000,
    p_offset integer default 0,
    p_origem_link text default 'prevencaocd'
)
returns table (
    dt_nf date,
    origem_link text,
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
    v_origem text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if not authz.is_admin(v_uid) then raise exception 'APENAS_ADMIN'; end if;
    if p_dt_ini is null or p_dt_fim is null then raise exception 'PERIODO_OBRIGATORIO'; end if;
    if p_dt_fim < p_dt_ini then raise exception 'PERIODO_INVALIDO'; end if;
    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_limit := greatest(coalesce(p_limit, 1000), 1);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_origem := app.conf_transferencia_cd_resolve_origem_link(p_origem_link);

    return query
    with base_items as (
        select t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des, t.coddv,
               coalesce(nullif(trim(max(t.descricao)), ''), format('CODDV %s', t.coddv)) as descricao,
               sum(greatest(coalesce(t.qtd_atend, 0), 0))::integer as qtd_atend,
               max(t.embcomp_cx)::integer as embcomp_cx,
               sum(greatest(coalesce(t.qtd_cxpad, 0), 0))::integer as qtd_cxpad
        from app.db_transf_cd t
        where t.dt_nf >= p_dt_ini and t.dt_nf <= p_dt_fim
          and (t.cd_ori = v_cd or t.cd_des = v_cd)
          and t.dt_nf is not null and t.nf_trf is not null and t.sq_nf is not null
          and t.cd_ori is not null and t.cd_des is not null and t.coddv is not null
        group by t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des, t.coddv
    ),
    saida as (
        select * from app.conf_transferencia_cd c where c.etapa = 'saida' and c.origem_link = v_origem
    ),
    entrada as (
        select * from app.conf_transferencia_cd c where c.etapa = 'entrada' and c.origem_link = v_origem
    ),
    entrada_occ as (
        select o.conf_id, o.coddv,
               coalesce(sum(o.qtd) filter (where o.tipo = 'Avariado'), 0)::integer as ocorrencia_avariado_qtd,
               coalesce(sum(o.qtd) filter (where o.tipo = 'Vencido'), 0)::integer as ocorrencia_vencido_qtd
        from app.conf_transferencia_cd_ocorrencias o
        group by o.conf_id, o.coddv
    )
    select
        b.dt_nf,
        v_origem,
        b.nf_trf, b.sq_nf, b.cd_ori, b.cd_des,
        coalesce(s.cd_ori_nome, e.cd_ori_nome, app.conf_transferencia_cd_nome_cd(b.cd_ori)),
        coalesce(s.cd_des_nome, e.cd_des_nome, app.conf_transferencia_cd_nome_cd(b.cd_des)),
        s.status, nullif(trim(s.started_mat), ''), nullif(trim(s.started_nome), ''), s.started_at, s.finalized_at,
        e.status, nullif(trim(e.started_mat), ''), nullif(trim(e.started_nome), ''), e.started_at, e.finalized_at,
        case
            when s.status in ('finalizado_ok', 'finalizado_falta') and e.status in ('finalizado_ok', 'finalizado_falta') and coalesce(si.qtd_conferida, 0) = coalesce(ei.qtd_conferida, 0) then 'conciliado'
            when s.status in ('finalizado_ok', 'finalizado_falta') and e.status in ('finalizado_ok', 'finalizado_falta') then 'divergente'
            when s.status in ('finalizado_ok', 'finalizado_falta') then 'pendente_destino'
            when e.status in ('finalizado_ok', 'finalizado_falta') then 'pendente_origem'
            else 'pendente'
        end,
        b.coddv, b.descricao, b.qtd_atend,
        coalesce(si.qtd_conferida, 0)::integer,
        coalesce(ei.qtd_conferida, 0)::integer,
        (coalesce(si.qtd_conferida, 0) - coalesce(ei.qtd_conferida, 0))::integer,
        b.embcomp_cx, b.qtd_cxpad,
        coalesce(eo.ocorrencia_avariado_qtd, 0)::integer,
        coalesce(eo.ocorrencia_vencido_qtd, 0)::integer
    from base_items b
    left join saida s on s.dt_nf = b.dt_nf and s.nf_trf = b.nf_trf and s.sq_nf = b.sq_nf and s.cd_ori = b.cd_ori and s.cd_des = b.cd_des
    left join entrada e on e.dt_nf = b.dt_nf and e.nf_trf = b.nf_trf and e.sq_nf = b.sq_nf and e.cd_ori = b.cd_ori and e.cd_des = b.cd_des
    left join app.conf_transferencia_cd_itens si on si.conf_id = s.conf_id and si.coddv = b.coddv
    left join app.conf_transferencia_cd_itens ei on ei.conf_id = e.conf_id and ei.coddv = b.coddv
    left join entrada_occ eo on eo.conf_id = e.conf_id and eo.coddv = b.coddv
    order by b.dt_nf, b.nf_trf, b.sq_nf, b.cd_ori, b.cd_des, b.coddv
    limit v_limit
    offset v_offset;
end;
$$;

create or replace function app.produtividade_events_base_origem(
    p_cd integer,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    activity_key text,
    activity_label text,
    unit_label text,
    user_id uuid,
    mat text,
    nome text,
    event_date date,
    metric_value numeric(18,3),
    detail text,
    source_ref text,
    event_at timestamptz
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
    with resolved_origem as (
        select app.conf_pedido_direto_resolve_origem_link(p_origem_link) as origem_link
    )
    select b.activity_key, b.activity_label, b.unit_label, b.user_id, b.mat, b.nome,
           b.event_date, b.metric_value, b.detail, b.source_ref, b.event_at
    from app.produtividade_events_base(p_cd, p_dt_ini, p_dt_fim) b
    left join app.conf_pedido_direto_itens pdi
      on b.activity_key = 'pedido_direto_sku'
     and b.source_ref = pdi.item_id::text
    left join app.conf_pedido_direto pd
      on pd.conf_id = pdi.conf_id
    left join app.conf_transferencia_cd_itens tci
      on b.activity_key = 'transferencia_cd_sku'
     and b.source_ref = tci.item_id::text
    left join app.conf_transferencia_cd tc
      on tc.conf_id = tci.conf_id
    where (b.activity_key <> 'pedido_direto_sku' or pd.origem_link = (select origem_link from resolved_origem))
      and (b.activity_key <> 'transferencia_cd_sku' or tc.origem_link = 'prevencaocd');
$$;

create or replace function public.rpc_apoio_gestor_daily_summary(
    p_cd integer,
    p_date date default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    activity_key text,
    activity_label text,
    unit_label text,
    actual_today numeric,
    target_today numeric,
    achievement_pct numeric,
    has_meta boolean,
    sort_order integer
)
language sql
stable
security definer
set search_path = app, public
as $$
    with resolved_date as (
        select coalesce(p_date, timezone('America/Sao_Paulo', now())::date) as d
    ),
    meta_rows as (
        select
            c.activity_key,
            c.activity_label,
            c.unit_label,
            coalesce(day_row.actual_value, 0)::numeric,
            case when day_row.target_kind = 'meta' then day_row.target_value::numeric else null::numeric end,
            case when day_row.target_kind = 'meta' and coalesce(day_row.target_value, 0) > 0 then round(day_row.percent_achievement, 1) else null::numeric end,
            (day_row.target_kind = 'meta'),
            c.sort_order::integer
        from app.meta_mes_activity_catalog() c
        left join lateral (
            select d.target_kind, d.target_value, d.actual_value, d.percent_achievement
            from app.meta_mes_daily_activity(p_cd, c.activity_key, (select d from resolved_date), p_origem_link) d
            where d.date_ref = (select d from resolved_date)
            limit 1
        ) day_row on true
    ),
    conf_transferencia as (
        select 'conf_transferencia_cd'::text, 'Conf. Transferência CD'::text, 'conferências'::text,
               count(*)::numeric, null::numeric, null::numeric, false, 100::integer
        from app.conf_transferencia_cd
        where (cd_ori = p_cd or cd_des = p_cd)
          and conf_date = (select d from resolved_date)
          and status in ('finalizado_ok', 'finalizado_falta')
          and origem_link = 'prevencaocd'
    ),
    ativ_extra as (
        select 'atividade_extra'::text, 'Atividade Extra'::text, 'pontos'::text,
               coalesce(sum(pontos), 0)::numeric, null::numeric, null::numeric, false, 110::integer
        from app.atividade_extra
        where cd = p_cd and data_inicio = (select d from resolved_date)
    ),
    coleta as (
        select 'coleta_mercadoria'::text, 'Coleta de Mercadorias'::text, 'itens'::text,
               count(*)::numeric, null::numeric, null::numeric, false, 120::integer
        from app.aud_coleta
        where cd = p_cd and timezone('America/Sao_Paulo', data_hr)::date = (select d from resolved_date)
    ),
    embarque as (
        select 'embarque_caixa_termica'::text, 'Embarque Caixa Térmica'::text, 'embarques'::text,
               count(*)::numeric, null::numeric, null::numeric, false, 140::integer
        from app.controle_caixa_termica_movs mov
        join app.controle_caixa_termica cxt on cxt.id = mov.caixa_id
        where cxt.cd = p_cd and mov.tipo = 'expedicao' and timezone('America/Sao_Paulo', mov.data_hr)::date = (select d from resolved_date)
    ),
    recebimento as (
        select 'recebimento_caixa_termica'::text, 'Recebimento Caixa Térmica'::text, 'recebimentos'::text,
               count(*)::numeric, null::numeric, null::numeric, false, 145::integer
        from app.controle_caixa_termica_movs mov
        join app.controle_caixa_termica cxt on cxt.id = mov.caixa_id
        where cxt.cd = p_cd and mov.tipo = 'recebimento' and timezone('America/Sao_Paulo', mov.data_hr)::date = (select d from resolved_date)
    ),
    controle_avarias as (
        select 'controle_avarias'::text, 'Controle de Avarias'::text, 'avarias'::text,
               count(*)::numeric, null::numeric, null::numeric, false, 150::integer
        from app.controle_avarias c
        where c.cd = p_cd and timezone('America/Sao_Paulo', c.data_hr)::date = (select d from resolved_date)
    )
    select * from meta_rows
    union all select * from conf_transferencia
    union all select * from ativ_extra
    union all select * from coleta
    union all select * from embarque
    union all select * from recebimento
    union all select * from controle_avarias
    order by 8;
$$;

grant execute on function public.rpc_conf_transferencia_cd_get_active_conference(text) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_open_nf(integer, bigint, bigint, date, integer, integer, text) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_open_nf_batch(jsonb, integer, text) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_note_search(integer, bigint, text) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_manifest_notes(integer, text) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_get_partial_reopen_info(bigint, bigint, date, integer, integer, integer, text) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_reopen_partial_conference(bigint, bigint, date, integer, integer, integer, text) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_conciliacao_count(date, date, integer, text) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_conciliacao_rows(date, date, integer, integer, integer, text) to authenticated;
grant execute on function public.rpc_apoio_gestor_daily_summary(integer, date, text) to authenticated;
