create table if not exists app.conf_transferencia_cd (
    conf_id uuid primary key default gen_random_uuid(),
    conf_date date not null default (timezone('America/Sao_Paulo', now()))::date,
    dt_nf date not null,
    nf_trf bigint not null,
    sq_nf bigint not null,
    cd_ori integer not null,
    cd_des integer not null,
    cd_ori_nome text,
    cd_des_nome text,
    etapa text not null check (etapa in ('saida', 'entrada')),
    started_by uuid not null references auth.users(id) on delete restrict,
    started_mat text not null,
    started_nome text not null,
    status text not null default 'em_conferencia'
        check (status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')),
    falta_motivo text,
    started_at timestamptz not null default now(),
    finalized_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint uq_conf_transferencia_cd_nf_etapa unique (dt_nf, nf_trf, sq_nf, cd_ori, cd_des, etapa)
);

create table if not exists app.conf_transferencia_cd_itens (
    item_id uuid primary key default gen_random_uuid(),
    conf_id uuid not null references app.conf_transferencia_cd(conf_id) on delete cascade,
    coddv integer not null,
    barras text,
    descricao text not null,
    qtd_esperada integer not null check (qtd_esperada >= 0),
    qtd_conferida integer not null default 0 check (qtd_conferida >= 0),
    embcomp_cx integer,
    qtd_cxpad integer,
    updated_at timestamptz not null default now(),
    constraint uq_conf_transferencia_cd_itens unique (conf_id, coddv)
);

create index if not exists idx_conf_transferencia_cd_cd_ori_date
    on app.conf_transferencia_cd(cd_ori, dt_nf, nf_trf);

create index if not exists idx_conf_transferencia_cd_cd_des_date
    on app.conf_transferencia_cd(cd_des, dt_nf, nf_trf);

create index if not exists idx_conf_transferencia_cd_etapa_status
    on app.conf_transferencia_cd(etapa, status, conf_date);

create index if not exists idx_conf_transferencia_cd_started_by
    on app.conf_transferencia_cd(started_by, conf_date desc, updated_at desc);

create index if not exists idx_conf_transferencia_cd_itens_conf
    on app.conf_transferencia_cd_itens(conf_id);

create index if not exists idx_conf_transferencia_cd_itens_conf_coddv
    on app.conf_transferencia_cd_itens(conf_id, coddv);

create index if not exists idx_app_db_transf_cd_nf_lookup
    on app.db_transf_cd(nf_trf, sq_nf, dt_nf, cd_ori, cd_des);

create index if not exists idx_app_db_transf_cd_cd_ori_nf
    on app.db_transf_cd(cd_ori, nf_trf);

create index if not exists idx_app_db_transf_cd_cd_des_nf
    on app.db_transf_cd(cd_des, nf_trf);

create or replace function app.conf_transferencia_cd_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

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
    on conflict on constraint uq_conf_transferencia_cd_nf_etapa
    do update set
        cd_ori_nome = coalesce(app.conf_transferencia_cd.cd_ori_nome, excluded.cd_ori_nome),
        cd_des_nome = coalesce(app.conf_transferencia_cd.cd_des_nome, excluded.cd_des_nome),
        updated_at = app.conf_transferencia_cd.updated_at
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


drop trigger if exists trg_conf_transferencia_cd_touch_updated_at on app.conf_transferencia_cd;
create trigger trg_conf_transferencia_cd_touch_updated_at
before update on app.conf_transferencia_cd
for each row
execute function app.conf_transferencia_cd_touch_updated_at();

drop trigger if exists trg_conf_transferencia_cd_itens_touch_updated_at on app.conf_transferencia_cd_itens;
create trigger trg_conf_transferencia_cd_itens_touch_updated_at
before update on app.conf_transferencia_cd_itens
for each row
execute function app.conf_transferencia_cd_touch_updated_at();

alter table app.conf_transferencia_cd enable row level security;
alter table app.conf_transferencia_cd_itens enable row level security;

revoke all on app.conf_transferencia_cd from anon;
revoke all on app.conf_transferencia_cd from authenticated;
revoke all on app.conf_transferencia_cd_itens from anon;
revoke all on app.conf_transferencia_cd_itens from authenticated;

drop policy if exists p_conf_transferencia_cd_select on app.conf_transferencia_cd;
drop policy if exists p_conf_transferencia_cd_insert on app.conf_transferencia_cd;
drop policy if exists p_conf_transferencia_cd_update on app.conf_transferencia_cd;
drop policy if exists p_conf_transferencia_cd_delete on app.conf_transferencia_cd;

create policy p_conf_transferencia_cd_select
on app.conf_transferencia_cd
for select
using (
    authz.session_is_recent(6)
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd_ori)
        or authz.can_access_cd(auth.uid(), cd_des)
    )
);

create policy p_conf_transferencia_cd_insert
on app.conf_transferencia_cd
for insert
with check (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or (etapa = 'saida' and authz.can_access_cd(auth.uid(), cd_ori))
        or (etapa = 'entrada' and authz.can_access_cd(auth.uid(), cd_des))
    )
);

create policy p_conf_transferencia_cd_update
on app.conf_transferencia_cd
for update
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or (etapa = 'saida' and authz.can_access_cd(auth.uid(), cd_ori))
        or (etapa = 'entrada' and authz.can_access_cd(auth.uid(), cd_des))
    )
)
with check (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or (etapa = 'saida' and authz.can_access_cd(auth.uid(), cd_ori))
        or (etapa = 'entrada' and authz.can_access_cd(auth.uid(), cd_des))
    )
);

create policy p_conf_transferencia_cd_delete
on app.conf_transferencia_cd
for delete
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or (etapa = 'saida' and authz.can_access_cd(auth.uid(), cd_ori))
        or (etapa = 'entrada' and authz.can_access_cd(auth.uid(), cd_des))
    )
);

drop policy if exists p_conf_transferencia_cd_itens_select on app.conf_transferencia_cd_itens;
drop policy if exists p_conf_transferencia_cd_itens_insert on app.conf_transferencia_cd_itens;
drop policy if exists p_conf_transferencia_cd_itens_update on app.conf_transferencia_cd_itens;
drop policy if exists p_conf_transferencia_cd_itens_delete on app.conf_transferencia_cd_itens;

create policy p_conf_transferencia_cd_itens_select
on app.conf_transferencia_cd_itens
for select
using (
    exists (
        select 1
        from app.conf_transferencia_cd c
        where c.conf_id = conf_transferencia_cd_itens.conf_id
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd_ori)
              or authz.can_access_cd(auth.uid(), c.cd_des)
          )
    )
);

create policy p_conf_transferencia_cd_itens_insert
on app.conf_transferencia_cd_itens
for insert
with check (
    exists (
        select 1
        from app.conf_transferencia_cd c
        where c.conf_id = conf_transferencia_cd_itens.conf_id
          and c.started_by = auth.uid()
          and c.status = 'em_conferencia'
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or (c.etapa = 'saida' and authz.can_access_cd(auth.uid(), c.cd_ori))
              or (c.etapa = 'entrada' and authz.can_access_cd(auth.uid(), c.cd_des))
          )
    )
);

create policy p_conf_transferencia_cd_itens_update
on app.conf_transferencia_cd_itens
for update
using (
    exists (
        select 1
        from app.conf_transferencia_cd c
        where c.conf_id = conf_transferencia_cd_itens.conf_id
          and c.started_by = auth.uid()
          and c.status = 'em_conferencia'
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or (c.etapa = 'saida' and authz.can_access_cd(auth.uid(), c.cd_ori))
              or (c.etapa = 'entrada' and authz.can_access_cd(auth.uid(), c.cd_des))
          )
    )
)
with check (
    exists (
        select 1
        from app.conf_transferencia_cd c
        where c.conf_id = conf_transferencia_cd_itens.conf_id
          and c.started_by = auth.uid()
          and c.status = 'em_conferencia'
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or (c.etapa = 'saida' and authz.can_access_cd(auth.uid(), c.cd_ori))
              or (c.etapa = 'entrada' and authz.can_access_cd(auth.uid(), c.cd_des))
          )
    )
);

create policy p_conf_transferencia_cd_itens_delete
on app.conf_transferencia_cd_itens
for delete
using (
    exists (
        select 1
        from app.conf_transferencia_cd c
        where c.conf_id = conf_transferencia_cd_itens.conf_id
          and c.started_by = auth.uid()
          and c.status = 'em_conferencia'
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or (c.etapa = 'saida' and authz.can_access_cd(auth.uid(), c.cd_ori))
              or (c.etapa = 'entrada' and authz.can_access_cd(auth.uid(), c.cd_des))
          )
    )
);

create or replace function app.conf_transferencia_cd_nome_cd(p_cd integer)
returns text
language sql
stable
security definer
set search_path = app, public
as $$
    select coalesce(
        (
            select min(nullif(trim(u.cd_nome), ''))
            from app.db_usuario u
            where u.cd = p_cd
        ),
        format('CD %s', p_cd)
    );
$$;

create or replace function app.conf_transferencia_cd_resolve_cd(p_cd integer)
returns integer
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if authz.is_admin(v_uid) then
        v_cd := coalesce(p_cd, v_profile.cd_default);
    else
        v_cd := coalesce(
            v_profile.cd_default,
            p_cd,
            (
                select min(ud.cd)
                from authz.user_deposits ud
                where ud.user_id = v_uid
            )
        );
    end if;

    if v_cd is null then
        raise exception 'CD_NAO_DEFINIDO_USUARIO';
    end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return v_cd;
end;
$$;

create or replace function app.conf_transferencia_cd_etapa_for_cd(
    p_cd integer,
    p_cd_ori integer,
    p_cd_des integer
)
returns text
language plpgsql
immutable
as $$
begin
    if p_cd = p_cd_ori then
        return 'saida';
    end if;

    if p_cd = p_cd_des then
        return 'entrada';
    end if;

    raise exception 'CD_FORA_DA_TRANSFERENCIA';
end;
$$;

drop function if exists public.rpc_conf_transferencia_cd_note_search(integer, bigint);
create or replace function public.rpc_conf_transferencia_cd_note_search(
    p_cd integer,
    p_nf_trf bigint
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
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if p_nf_trf is null then
        raise exception 'NF_OBRIGATORIA';
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
        where t.nf_trf = p_nf_trf
          and t.dt_nf is not null
          and t.sq_nf is not null
          and t.cd_ori is not null
          and t.cd_des is not null
          and t.coddv is not null
          and (t.cd_ori = v_cd or t.cd_des = v_cd)
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
    order by b.dt_nf desc, b.sq_nf desc, b.cd_ori, b.cd_des;
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
        i.updated_at
    from app.conf_transferencia_cd_itens i
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
    set
        qtd_conferida = p_qtd_conferida,
        updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = p_coddv;

    if not found then
        raise exception 'ITEM_NAO_ENCONTRADO';
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
    updated_at timestamptz
)
language sql
security definer
set search_path = app, authz, public
as $$
    select *
    from public.rpc_conf_transferencia_cd_set_item_qtd(p_conf_id, p_coddv, 0);
$$;

drop function if exists public.rpc_conf_transferencia_cd_scan_barcode(uuid, text, integer);
create or replace function public.rpc_conf_transferencia_cd_scan_barcode(
    p_conf_id uuid,
    p_barras text,
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
    embcomp_cx integer,
    qtd_cxpad integer,
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
    set
        qtd_conferida = i.qtd_conferida + p_qtd,
        barras = v_barras,
        updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv;

    if not found then
        raise exception 'PRODUTO_FORA_DA_TRANSFERENCIA';
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
    v_status text;
    v_motivo text;
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
        count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer
    into
        v_falta_count,
        v_sobra_count,
        v_correto_count
    from app.conf_transferencia_cd_itens i
    where i.conf_id = v_conf.conf_id;

    if coalesce(v_sobra_count, 0) > 0 then
        raise exception 'SOBRA_PENDENTE';
    end if;

    v_motivo := nullif(trim(coalesce(p_falta_motivo, '')), '');
    if coalesce(v_falta_count, 0) > 0 and v_motivo is null then
        raise exception 'FALTA_MOTIVO_OBRIGATORIO';
    end if;

    v_status := case
        when coalesce(v_falta_count, 0) > 0 then 'finalizado_falta'
        else 'finalizado_ok'
    end;

    update app.conf_transferencia_cd c
    set
        status = v_status,
        falta_motivo = case when v_status = 'finalizado_falta' then v_motivo else null end,
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

drop function if exists public.rpc_conf_transferencia_cd_cancel(uuid);
create or replace function public.rpc_conf_transferencia_cd_cancel(p_conf_id uuid)
returns table (
    conf_id uuid,
    cancelled boolean
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

    delete from app.conf_transferencia_cd c
    where c.conf_id = v_conf.conf_id;

    return query
    select v_conf.conf_id, true;
end;
$$;

drop function if exists public.rpc_conf_transferencia_cd_conciliacao_count(date, date, integer);
create or replace function public.rpc_conf_transferencia_cd_conciliacao_count(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer
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

    return query
    with notas as (
        select t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des
        from app.db_transf_cd t
        where t.dt_nf >= p_dt_ini
          and t.dt_nf <= p_dt_fim
          and (t.cd_ori = v_cd or t.cd_des = v_cd)
          and t.dt_nf is not null
          and t.nf_trf is not null
          and t.sq_nf is not null
          and t.coddv is not null
        group by t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des
    ),
    itens as (
        select t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des, t.coddv
        from app.db_transf_cd t
        join notas n
          on n.dt_nf = t.dt_nf
         and n.nf_trf = t.nf_trf
         and n.sq_nf = t.sq_nf
         and n.cd_ori = t.cd_ori
         and n.cd_des = t.cd_des
        where t.coddv is not null
        group by t.dt_nf, t.nf_trf, t.sq_nf, t.cd_ori, t.cd_des, t.coddv
    )
    select
        (select count(*)::bigint from notas),
        (select count(*)::bigint from itens);
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
        b.qtd_cxpad
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
    order by b.dt_nf, b.nf_trf, b.sq_nf, b.cd_ori, b.cd_des, b.coddv
    limit v_limit
    offset v_offset;
end;
$$;

grant execute on function public.rpc_conf_transferencia_cd_note_search(integer, bigint) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_open_nf(integer, bigint, bigint, date, integer, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_get_items(uuid) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_scan_barcode(uuid, text, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_set_item_qtd(uuid, integer, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_reset_item(uuid, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_finalize(uuid, text) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_cancel(uuid) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_conciliacao_count(date, date, integer) to authenticated;
grant execute on function public.rpc_conf_transferencia_cd_conciliacao_rows(date, date, integer, integer, integer) to authenticated;
