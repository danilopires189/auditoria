create table if not exists app.conf_pedido_direto (
    conf_id uuid primary key default gen_random_uuid(),
    conf_date date not null default (timezone('America/Sao_Paulo', now()))::date,
    cd integer not null,
    id_vol text not null,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    started_by uuid not null references auth.users(id) on delete restrict,
    started_mat text not null,
    started_nome text not null,
    status text not null default 'em_conferencia'
        check (status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')),
    falta_motivo text,
    started_at timestamptz not null default now(),
    finalized_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint uq_conf_pedido_direto_daily unique (conf_date, cd, id_vol)
);

alter table app.conf_pedido_direto
    add column if not exists sq bigint;

create table if not exists app.conf_pedido_direto_itens (
    item_id uuid primary key default gen_random_uuid(),
    conf_id uuid not null references app.conf_pedido_direto(conf_id) on delete cascade,
    coddv integer not null,
    descricao text not null,
    qtd_esperada integer not null check (qtd_esperada > 0),
    qtd_conferida integer not null default 0 check (qtd_conferida >= 0),
    updated_at timestamptz not null default now(),
    constraint uq_conf_pedido_direto_itens unique (conf_id, coddv)
);

create index if not exists idx_conf_pedido_direto_cd_date_status
    on app.conf_pedido_direto(cd, conf_date, status);
create index if not exists idx_conf_pedido_direto_cd_date_rota_filial
    on app.conf_pedido_direto(cd, conf_date, rota, filial);
create index if not exists idx_conf_pedido_direto_started_by_date
    on app.conf_pedido_direto(started_by, conf_date desc, updated_at desc);
create index if not exists idx_conf_pedido_direto_itens_conf
    on app.conf_pedido_direto_itens(conf_id);
create index if not exists idx_conf_pedido_direto_itens_conf_coddv
    on app.conf_pedido_direto_itens(conf_id, coddv);

create or replace view app.db_pedido_direto_conf as
select
    t.*,
    null::text as caixa,
    (t.pedido::text || '&' || t.sq::text) as id_vol,
    t.qtd_fat as qtd_separada,
    null::text as num_rota
from app.db_pedido_direto t;

create index if not exists idx_app_db_pedido_direto_cd_pedido_sq
    on app.db_pedido_direto(cd, pedido, sq);
create index if not exists idx_app_db_pedido_direto_cd_filial
    on app.db_pedido_direto(cd, filial);

create or replace function app.conf_pedido_direto_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_conf_pedido_direto_touch_updated_at on app.conf_pedido_direto;
create trigger trg_conf_pedido_direto_touch_updated_at
before update on app.conf_pedido_direto
for each row
execute function app.conf_pedido_direto_touch_updated_at();

drop trigger if exists trg_conf_pedido_direto_itens_touch_updated_at on app.conf_pedido_direto_itens;
create trigger trg_conf_pedido_direto_itens_touch_updated_at
before update on app.conf_pedido_direto_itens
for each row
execute function app.conf_pedido_direto_touch_updated_at();

alter table app.conf_pedido_direto enable row level security;
alter table app.conf_pedido_direto_itens enable row level security;

revoke all on app.conf_pedido_direto from anon;
revoke all on app.conf_pedido_direto from authenticated;
revoke all on app.conf_pedido_direto_itens from anon;
revoke all on app.conf_pedido_direto_itens from authenticated;

drop policy if exists p_conf_pedido_direto_select on app.conf_pedido_direto;
drop policy if exists p_conf_pedido_direto_insert on app.conf_pedido_direto;
drop policy if exists p_conf_pedido_direto_update on app.conf_pedido_direto;
drop policy if exists p_conf_pedido_direto_delete on app.conf_pedido_direto;

create policy p_conf_pedido_direto_select
on app.conf_pedido_direto
for select
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_conf_pedido_direto_insert
on app.conf_pedido_direto
for insert
with check (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_conf_pedido_direto_update
on app.conf_pedido_direto
for update
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
)
with check (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

create policy p_conf_pedido_direto_delete
on app.conf_pedido_direto
for delete
using (
    authz.session_is_recent(6)
    and started_by = auth.uid()
    and (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd)
    )
);

drop policy if exists p_conf_pedido_direto_itens_select on app.conf_pedido_direto_itens;
drop policy if exists p_conf_pedido_direto_itens_insert on app.conf_pedido_direto_itens;
drop policy if exists p_conf_pedido_direto_itens_update on app.conf_pedido_direto_itens;
drop policy if exists p_conf_pedido_direto_itens_delete on app.conf_pedido_direto_itens;

create policy p_conf_pedido_direto_itens_select
on app.conf_pedido_direto_itens
for select
using (
    exists (
        select 1
        from app.conf_pedido_direto c
        where c.conf_id = conf_pedido_direto_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_pedido_direto_itens_insert
on app.conf_pedido_direto_itens
for insert
with check (
    exists (
        select 1
        from app.conf_pedido_direto c
        where c.conf_id = conf_pedido_direto_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_pedido_direto_itens_update
on app.conf_pedido_direto_itens
for update
using (
    exists (
        select 1
        from app.conf_pedido_direto c
        where c.conf_id = conf_pedido_direto_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
)
with check (
    exists (
        select 1
        from app.conf_pedido_direto c
        where c.conf_id = conf_pedido_direto_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_pedido_direto_itens_delete
on app.conf_pedido_direto_itens
for delete
using (
    exists (
        select 1
        from app.conf_pedido_direto c
        where c.conf_id = conf_pedido_direto_itens.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create or replace function app.conf_pedido_direto_resolve_cd(p_cd integer default null)
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
        v_cd := p_cd;
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

create or replace function public.rpc_conf_pedido_direto_manifest_meta(p_cd integer default null)
returns table (
    cd integer,
    row_count bigint,
    volumes_count bigint,
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
    v_row_count bigint;
    v_etiquetas bigint;
    v_source_run_id uuid;
    v_updated_at timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);

    select
        count(*)::bigint,
        count(distinct t.id_vol)::bigint,
        max(t.source_run_id),
        max(t.updated_at)
    into
        v_row_count,
        v_etiquetas,
        v_source_run_id,
        v_updated_at
    from app.db_pedido_direto_conf t
    where t.cd = v_cd
      and nullif(trim(coalesce(t.id_vol, '')), '') is not null;

    if coalesce(v_row_count, 0) = 0 then
        raise exception 'BASE_PEDIDO_DIRETO_VAZIA';
    end if;

    return query
    select
        v_cd,
        v_row_count,
        v_etiquetas,
        v_source_run_id,
        md5(
            concat_ws(
                ':',
                coalesce(v_source_run_id::text, ''),
                v_row_count::text,
                v_etiquetas::text,
                coalesce(v_updated_at::text, '')
            )
        ),
        now();
end;
$$;

create or replace function public.rpc_conf_pedido_direto_manifest_items_page(
    p_cd integer default null,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    id_vol text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    coddv integer,
    descricao text,
    qtd_esperada integer
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

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 2000);

    return query
    with manifest as (
        select
            t.id_vol,
            min(nullif(trim(t.caixa::text), '')) as caixa,
            min(t.pedido) as pedido,
            min(t.filial) as filial,
            coalesce(
                min(nullif(trim(r.nome), '')),
                format('FILIAL %s', min(t.filial))
            ) as filial_nome,
            coalesce(
                min(nullif(trim(r.rota), '')),
                min(nullif(trim(t.num_rota), '')),
                'SEM ROTA'
            ) as rota,
            t.coddv,
            coalesce(
                min(nullif(trim(t.descricao), '')),
                format('CODDV %s', t.coddv)
            ) as descricao,
            sum(greatest(coalesce(t.qtd_separada, 0)::integer, 0))::integer as qtd_esperada
        from app.db_pedido_direto_conf t
        left join app.db_rotas r
          on r.cd = t.cd
         and r.filial = t.filial
        where t.cd = v_cd
          and nullif(trim(coalesce(t.id_vol, '')), '') is not null
        group by t.id_vol, t.coddv
    )
    select
        m.id_vol,
        m.caixa,
        m.pedido,
        m.filial,
        m.filial_nome,
        m.rota,
        m.coddv,
        m.descricao,
        greatest(m.qtd_esperada, 1) as qtd_esperada
    from manifest m
    order by m.id_vol, m.coddv
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_manifest_barras_page(
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

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 3000);

    return query
    with needed as (
        select distinct t.coddv
        from app.db_pedido_direto_conf t
        where t.cd = v_cd
          and nullif(trim(coalesce(t.id_vol, '')), '') is not null
    )
    select
        b.barras,
        b.coddv,
        b.descricao,
        b.updated_at
    from app.db_barras b
    join needed n
      on n.coddv = b.coddv
    where nullif(trim(coalesce(b.barras, '')), '') is not null
    order by b.barras, b.updated_at desc nulls last
    offset v_offset
    limit v_limit;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_route_overview(p_cd integer default null)
returns table (
    rota text,
    filial bigint,
    filial_nome text,
    total_etiquetas integer,
    conferidas integer,
    pendentes integer,
    status text
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

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    return query
    with base as (
        select
            coalesce(
                min(nullif(trim(r.rota), '')),
                min(nullif(trim(t.num_rota), '')),
                'SEM ROTA'
            ) as rota,
            min(t.filial) as filial,
            coalesce(
                min(nullif(trim(r.nome), '')),
                format('FILIAL %s', min(t.filial))
            ) as filial_nome,
            count(distinct t.id_vol)::integer as total_etiquetas
        from app.db_pedido_direto_conf t
        left join app.db_rotas r
          on r.cd = t.cd
         and r.filial = t.filial
        where t.cd = v_cd
          and nullif(trim(coalesce(t.id_vol, '')), '') is not null
        group by t.filial
    ),
    conf as (
        select
            c.filial,
            count(distinct c.id_vol)::integer as conferidas
        from app.conf_pedido_direto c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.status in ('finalizado_ok', 'finalizado_falta')
        group by c.filial
    )
    select
        b.rota,
        b.filial,
        b.filial_nome,
        b.total_etiquetas,
        coalesce(c.conferidas, 0)::integer as conferidas,
        greatest(b.total_etiquetas - coalesce(c.conferidas, 0), 0)::integer as pendentes,
        case
            when greatest(b.total_etiquetas - coalesce(c.conferidas, 0), 0) = 0 then 'conferido'
            else 'pendente'
        end as status
    from base b
    left join conf c
      on c.filial = b.filial
    order by b.rota, b.filial;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_open_volume(
    p_id_vol text,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    id_vol text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    status text,
    falta_motivo text,
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
    v_tag text;
    v_today date;
    v_profile record;
    v_conf app.conf_pedido_direto%rowtype;
    v_read_only boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);
    v_tag := nullif(trim(coalesce(p_id_vol, '')), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'ID_VOL_OBRIGATORIO';
    end if;

    if v_tag !~ '^[0-9]+&[0-9]+$' then
        raise exception 'ID_VOL_INVALIDO';
    end if;

    begin
        v_tag := (split_part(v_tag, '&', 1)::bigint)::text || '&' || (split_part(v_tag, '&', 2)::bigint)::text;
    exception
        when numeric_value_out_of_range then
            raise exception 'ID_VOL_INVALIDO';
    end;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    if not exists (
        select 1
        from app.db_pedido_direto_conf t
        where t.cd = v_cd
          and t.id_vol = v_tag
    ) then
        raise exception 'ID_VOL_NAO_ENCONTRADO';
    end if;

    select *
    into v_conf
    from app.conf_pedido_direto c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.id_vol = v_tag
    limit 1;

    if found then
        if v_conf.started_by <> v_uid then
            if v_conf.status = 'em_conferencia' then
                raise exception 'VOLUME_EM_USO';
            end if;
            raise exception 'VOLUME_JA_CONFERIDO_OUTRO_USUARIO';
        end if;
        v_read_only := v_conf.status <> 'em_conferencia';
    else
        with src as (
            select
                min(nullif(trim(t.caixa::text), '')) as caixa,
                min(t.pedido) as pedido,
                min(t.filial) as filial,
                coalesce(
                    min(nullif(trim(r.nome), '')),
                    format('FILIAL %s', min(t.filial))
                ) as filial_nome,
                coalesce(
                    min(nullif(trim(r.rota), '')),
                    min(nullif(trim(t.num_rota), '')),
                    'SEM ROTA'
                ) as rota
            from app.db_pedido_direto_conf t
            left join app.db_rotas r
              on r.cd = t.cd
             and r.filial = t.filial
            where t.cd = v_cd
              and t.id_vol = v_tag
        )
        insert into app.conf_pedido_direto (
            conf_date,
            cd,
            id_vol,
            caixa,
            pedido,
            filial,
            filial_nome,
            rota,
            started_by,
            started_mat,
            started_nome,
            status,
            falta_motivo,
            started_at,
            finalized_at,
            updated_at
        )
        select
            v_today,
            v_cd,
            v_tag,
            src.caixa,
            src.pedido,
            src.filial,
            src.filial_nome,
            src.rota,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            null,
            now(),
            null,
            now()
        from src
        returning * into v_conf;

        insert into app.conf_pedido_direto_itens (
            conf_id,
            coddv,
            descricao,
            qtd_esperada,
            qtd_conferida,
            updated_at
        )
        select
            v_conf.conf_id,
            t.coddv,
            coalesce(
                min(nullif(trim(t.descricao), '')),
                format('CODDV %s', t.coddv)
            ),
            sum(greatest(coalesce(t.qtd_separada, 0)::integer, 0))::integer,
            0,
            now()
        from app.db_pedido_direto_conf t
        where t.cd = v_cd
          and t.id_vol = v_tag
        group by t.coddv
        on conflict (conf_id, coddv)
        do update set
            descricao = excluded.descricao,
            qtd_esperada = excluded.qtd_esperada,
            updated_at = now();

        v_read_only := false;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.id_vol,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_pedido_direto c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_get_items(p_conf_id uuid)
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
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_pedido_direto%rowtype;
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
    from app.conf_pedido_direto c
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
        i.updated_at
    from app.conf_pedido_direto_itens i
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

create or replace function public.rpc_conf_pedido_direto_scan_barcode(
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
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_pedido_direto%rowtype;
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
    from app.conf_pedido_direto c
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

    update app.conf_pedido_direto_itens i
    set
        qtd_conferida = i.qtd_conferida + p_qtd,
        updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv;

    if not found then
        raise exception 'PRODUTO_FORA_DO_VOLUME';
    end if;

    update app.conf_pedido_direto c
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
        i.updated_at
    from app.conf_pedido_direto_itens i
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv
    limit 1;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_set_item_qtd(
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
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_pedido_direto%rowtype;
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
    from app.conf_pedido_direto c
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

    update app.conf_pedido_direto_itens i
    set
        qtd_conferida = p_qtd_conferida,
        updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = p_coddv;

    if not found then
        raise exception 'ITEM_NAO_ENCONTRADO';
    end if;

    update app.conf_pedido_direto c
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
        i.updated_at
    from app.conf_pedido_direto_itens i
    where i.conf_id = v_conf.conf_id
      and i.coddv = p_coddv
    limit 1;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_reset_item(
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
    updated_at timestamptz
)
language sql
security definer
set search_path = app, authz, public
as $$
    select *
    from public.rpc_conf_pedido_direto_set_item_qtd(p_conf_id, p_coddv, 0);
$$;

create or replace function public.rpc_conf_pedido_direto_sync_snapshot(
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
    v_conf app.conf_pedido_direto%rowtype;
    v_payload jsonb;
    v_payload_count integer := 0;
    v_updated_count integer := 0;
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
    from app.conf_pedido_direto c
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
            end as qtd_conferida
        from jsonb_array_elements(v_payload) elem
    ),
    payload as (
        select
            r.coddv,
            max(r.qtd_conferida)::integer as qtd_conferida
        from raw r
        where r.coddv is not null
          and r.qtd_conferida is not null
        group by r.coddv
    ),
    updated as (
        update app.conf_pedido_direto_itens i
        set
            qtd_conferida = p.qtd_conferida,
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
        raise exception 'PRODUTO_FORA_DO_VOLUME';
    end if;

    update app.conf_pedido_direto c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

    return query
    with agg as (
        select
            count(*)::integer as total_items,
            count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer as falta_count,
            count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer as sobra_count,
            count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer as correto_count
        from app.conf_pedido_direto_itens i
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

create or replace function public.rpc_conf_pedido_direto_finalize(
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
    v_conf app.conf_pedido_direto%rowtype;
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
    from app.conf_pedido_direto c
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

    select
        count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer
    into
        v_falta_count,
        v_sobra_count,
        v_correto_count
    from app.conf_pedido_direto_itens i
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

    update app.conf_pedido_direto c
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

grant execute on function public.rpc_conf_pedido_direto_manifest_meta(integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_manifest_items_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_manifest_barras_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_route_overview(integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_open_volume(text, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_get_items(uuid) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_scan_barcode(uuid, text, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_set_item_qtd(uuid, integer, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_reset_item(uuid, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_sync_snapshot(uuid, jsonb) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_finalize(uuid, text) to authenticated;

create or replace function public.rpc_conf_pedido_direto_manifest_meta(p_cd integer default null)
returns table (
    cd integer,
    row_count bigint,
    volumes_count bigint,
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
    v_row_count bigint;
    v_etiquetas bigint;
    v_source_run_id uuid;
    v_updated_at timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);

    select
        count(*)::bigint,
        count(distinct t.id_vol)::bigint,
        max(t.updated_at)
    into
        v_row_count,
        v_etiquetas,
        v_updated_at
    from app.db_pedido_direto_conf t
    where t.cd = v_cd
      and nullif(trim(coalesce(t.id_vol, '')), '') is not null;

    if coalesce(v_row_count, 0) = 0 then
        raise exception 'BASE_PEDIDO_DIRETO_VAZIA';
    end if;

    select t.source_run_id
    into v_source_run_id
    from app.db_pedido_direto_conf t
    where t.cd = v_cd
      and nullif(trim(coalesce(t.id_vol, '')), '') is not null
      and t.source_run_id is not null
    order by t.updated_at desc nulls last
    limit 1;

    return query
    select
        v_cd,
        v_row_count,
        v_etiquetas,
        v_source_run_id,
        md5(
            concat_ws(
                ':',
                coalesce(v_source_run_id::text, ''),
                v_row_count::text,
                v_etiquetas::text,
                coalesce(v_updated_at::text, '')
            )
        ),
        now();
end;
$$;

alter table app.conf_pedido_direto_itens
    add column if not exists barras text;

create or replace function public.rpc_conf_pedido_direto_scan_barcode(
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
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_pedido_direto%rowtype;
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
    from app.conf_pedido_direto c
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

    update app.conf_pedido_direto_itens i
    set
        qtd_conferida = i.qtd_conferida + p_qtd,
        barras = v_barras,
        updated_at = now()
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv;

    if not found then
        raise exception 'PRODUTO_FORA_DO_VOLUME';
    end if;

    update app.conf_pedido_direto c
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
        i.updated_at
    from app.conf_pedido_direto_itens i
    where i.conf_id = v_conf.conf_id
      and i.coddv = v_coddv
    limit 1;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_sync_snapshot(
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
    v_conf app.conf_pedido_direto%rowtype;
    v_payload jsonb;
    v_payload_count integer := 0;
    v_updated_count integer := 0;
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
    from app.conf_pedido_direto c
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
        update app.conf_pedido_direto_itens i
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
        raise exception 'PRODUTO_FORA_DO_VOLUME';
    end if;

    update app.conf_pedido_direto c
    set updated_at = now()
    where c.conf_id = v_conf.conf_id;

    return query
    with agg as (
        select
            count(*)::integer as total_items,
            count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer as falta_count,
            count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer as sobra_count,
            count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer as correto_count
        from app.conf_pedido_direto_itens i
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

create or replace function public.rpc_conf_pedido_direto_get_items_v2(p_conf_id uuid)
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
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_pedido_direto%rowtype;
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
    from app.conf_pedido_direto c
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
        i.updated_at
    from app.conf_pedido_direto_itens i
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

grant execute on function public.rpc_conf_pedido_direto_get_items_v2(uuid) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_scan_barcode(uuid, text, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_sync_snapshot(uuid, jsonb) to authenticated;

create or replace function app.conf_pedido_direto_autoclose_stale()
returns integer
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_today date;
    v_closed integer := 0;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_today := (timezone('America/Sao_Paulo', now()))::date;

    update app.conf_pedido_direto c
    set
        status = 'finalizado_falta',
        falta_motivo = coalesce(
            nullif(trim(coalesce(c.falta_motivo, '')), ''),
            'Encerrado automaticamente por virada de dia.'
        ),
        finalized_at = coalesce(c.finalized_at, now()),
        updated_at = now()
    where c.status = 'em_conferencia'
      and c.conf_date < v_today;

    get diagnostics v_closed = row_count;
    return coalesce(v_closed, 0);
end;
$$;

create or replace function public.rpc_conf_pedido_direto_get_active_volume()
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    id_vol text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    status text,
    falta_motivo text,
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
    v_today date;
    v_conf app.conf_pedido_direto%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_pedido_direto_autoclose_stale();
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    select *
    into v_conf
    from app.conf_pedido_direto c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_conf.conf_id is null then
        return;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.id_vol,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        false as is_read_only
    from app.conf_pedido_direto c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_open_volume(
    p_id_vol text,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    id_vol text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    status text,
    falta_motivo text,
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
    v_tag text;
    v_today date;
    v_profile record;
    v_conf app.conf_pedido_direto%rowtype;
    v_user_active app.conf_pedido_direto%rowtype;
    v_read_only boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_pedido_direto_autoclose_stale();

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);
    v_tag := nullif(trim(coalesce(p_id_vol, '')), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'ID_VOL_OBRIGATORIO';
    end if;

    if v_tag !~ '^[0-9]+&[0-9]+$' then
        raise exception 'ID_VOL_INVALIDO';
    end if;

    begin
        v_tag := (split_part(v_tag, '&', 1)::bigint)::text || '&' || (split_part(v_tag, '&', 2)::bigint)::text;
    exception
        when numeric_value_out_of_range then
            raise exception 'ID_VOL_INVALIDO';
    end;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    select *
    into v_user_active
    from app.conf_pedido_direto c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and (v_user_active.cd <> v_cd or v_user_active.id_vol <> v_tag) then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRO_ID_VOL';
    end if;

    if not exists (
        select 1
        from app.db_pedido_direto_conf t
        where t.cd = v_cd
          and t.id_vol = v_tag
    ) then
        raise exception 'ID_VOL_NAO_ENCONTRADO';
    end if;

    select *
    into v_conf
    from app.conf_pedido_direto c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.id_vol = v_tag
    limit 1;

    if found then
        if v_conf.started_by <> v_uid then
            if v_conf.status = 'em_conferencia' then
                raise exception 'VOLUME_EM_USO';
            end if;
            raise exception 'VOLUME_JA_CONFERIDO_OUTRO_USUARIO';
        end if;
        v_read_only := v_conf.status <> 'em_conferencia';
    else
        with src as (
            select
                min(nullif(trim(t.caixa::text), '')) as caixa,
                min(t.pedido) as pedido,
                min(t.filial) as filial,
                coalesce(
                    min(nullif(trim(r.nome), '')),
                    format('FILIAL %s', min(t.filial))
                ) as filial_nome,
                coalesce(
                    min(nullif(trim(r.rota), '')),
                    min(nullif(trim(t.num_rota), '')),
                    'SEM ROTA'
                ) as rota
            from app.db_pedido_direto_conf t
            left join app.db_rotas r
              on r.cd = t.cd
             and r.filial = t.filial
            where t.cd = v_cd
              and t.id_vol = v_tag
        )
        insert into app.conf_pedido_direto (
            conf_date,
            cd,
            id_vol,
            caixa,
            pedido,
            sq,
            filial,
            filial_nome,
            rota,
            started_by,
            started_mat,
            started_nome,
            status,
            falta_motivo,
            started_at,
            finalized_at,
            updated_at
        )
        select
            v_today,
            v_cd,
            v_tag,
            src.caixa,
            src.pedido,
            split_part(v_tag, '&', 2)::bigint,
            src.filial,
            src.filial_nome,
            src.rota,
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            null,
            now(),
            null,
            now()
        from src
        returning * into v_conf;

        insert into app.conf_pedido_direto_itens (
            conf_id,
            coddv,
            descricao,
            qtd_esperada,
            qtd_conferida,
            updated_at
        )
        select
            v_conf.conf_id,
            t.coddv,
            coalesce(
                min(nullif(trim(t.descricao), '')),
                format('CODDV %s', t.coddv)
            ),
            sum(greatest(coalesce(t.qtd_separada, 0)::integer, 0))::integer,
            0,
            now()
        from app.db_pedido_direto_conf t
        where t.cd = v_cd
          and t.id_vol = v_tag
        group by t.coddv
        on conflict on constraint uq_conf_pedido_direto_itens
        do update set
            descricao = excluded.descricao,
            qtd_esperada = excluded.qtd_esperada,
            updated_at = now();

        v_read_only := false;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.id_vol,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
        c.status,
        c.falta_motivo,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_pedido_direto c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

grant execute on function public.rpc_conf_pedido_direto_get_active_volume() to authenticated;
grant execute on function public.rpc_conf_pedido_direto_open_volume(text, integer) to authenticated;

alter table app.conf_pedido_direto_itens
    add column if not exists id_vol text;

update app.conf_pedido_direto_itens i
set id_vol = c.id_vol
from app.conf_pedido_direto c
where c.conf_id = i.conf_id
  and (i.id_vol is null or i.id_vol <> c.id_vol);

create or replace function app.conf_pedido_direto_itens_fill_id_vol()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_id_vol text;
begin
    if new.conf_id is null then
        raise exception 'CONF_ID_OBRIGATORIO';
    end if;

    select c.id_vol
    into v_id_vol
    from app.conf_pedido_direto c
    where c.conf_id = new.conf_id
    limit 1;

    if nullif(trim(coalesce(v_id_vol, '')), '') is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    new.id_vol := v_id_vol;
    return new;
end;
$$;

drop trigger if exists trg_conf_pedido_direto_itens_fill_id_vol on app.conf_pedido_direto_itens;
create trigger trg_conf_pedido_direto_itens_fill_id_vol
before insert or update of conf_id, id_vol
on app.conf_pedido_direto_itens
for each row
execute function app.conf_pedido_direto_itens_fill_id_vol();

alter table app.conf_pedido_direto_itens
    alter column id_vol set not null;

create index if not exists idx_conf_pedido_direto_itens_id_vol
    on app.conf_pedido_direto_itens(id_vol);

create index if not exists idx_conf_pedido_direto_itens_conf_etiqueta
    on app.conf_pedido_direto_itens(conf_id, id_vol);

create or replace function public.rpc_conf_pedido_direto_cancel(
    p_conf_id uuid
)
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
    v_conf app.conf_pedido_direto%rowtype;
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
    from app.conf_pedido_direto c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and c.status = 'em_conferencia'
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA';
    end if;

    delete from app.conf_pedido_direto c
    where c.conf_id = v_conf.conf_id;

    return query
    select
        v_conf.conf_id,
        true;
end;
$$;

grant execute on function public.rpc_conf_pedido_direto_cancel(uuid) to authenticated;

drop function if exists public.rpc_conf_pedido_direto_route_overview(integer);

create or replace function public.rpc_conf_pedido_direto_route_overview(p_cd integer default null)
returns table (
    rota text,
    filial bigint,
    filial_nome text,
    total_etiquetas integer,
    conferidas integer,
    pendentes integer,
    status text,
    colaborador_nome text,
    colaborador_mat text,
    status_at timestamptz
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

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    return query
    with base as (
        select
            coalesce(
                min(nullif(trim(r.rota), '')),
                min(nullif(trim(t.num_rota), '')),
                'SEM ROTA'
            ) as rota,
            min(t.filial) as filial,
            coalesce(
                min(nullif(trim(r.nome), '')),
                format('FILIAL %s', min(t.filial))
            ) as filial_nome,
            count(distinct t.id_vol)::integer as total_etiquetas
        from app.db_pedido_direto_conf t
        left join app.db_rotas r
          on r.cd = t.cd
         and r.filial = t.filial
        where t.cd = v_cd
          and nullif(trim(coalesce(t.id_vol, '')), '') is not null
        group by t.filial
    ),
    conf as (
        select
            c.filial,
            count(distinct c.id_vol) filter (
                where c.status in ('finalizado_ok', 'finalizado_falta')
            )::integer as conferidas,
            count(distinct c.id_vol) filter (
                where c.status = 'em_conferencia'
            )::integer as em_andamento
        from app.conf_pedido_direto c
        where c.cd = v_cd
          and c.conf_date = v_today
        group by c.filial
    ),
    em_andamento_actor as (
        select distinct on (c.filial)
            c.filial,
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat,
            c.started_at
        from app.conf_pedido_direto c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.status = 'em_conferencia'
        order by c.filial, c.updated_at desc nulls last, c.started_at desc nulls last
    ),
    concluido_actor as (
        select distinct on (c.filial)
            c.filial,
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat,
            c.finalized_at
        from app.conf_pedido_direto c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.status in ('finalizado_ok', 'finalizado_falta')
        order by c.filial, c.finalized_at desc nulls last, c.updated_at desc nulls last
    )
    select
        b.rota,
        b.filial,
        b.filial_nome,
        b.total_etiquetas,
        coalesce(c.conferidas, 0)::integer as conferidas,
        greatest(b.total_etiquetas - coalesce(c.conferidas, 0), 0)::integer as pendentes,
        case
            when b.total_etiquetas > 0 and coalesce(c.conferidas, 0) >= b.total_etiquetas then 'concluido'
            when coalesce(c.em_andamento, 0) > 0 then 'em_andamento'
            when coalesce(c.conferidas, 0) > 0 then 'em_andamento'
            else 'pendente'
        end as status,
        case
            when b.total_etiquetas > 0 and coalesce(c.conferidas, 0) >= b.total_etiquetas then ca.colaborador_nome
            when coalesce(c.em_andamento, 0) > 0 then ea.colaborador_nome
            when coalesce(c.conferidas, 0) > 0 then ca.colaborador_nome
            else null
        end as colaborador_nome,
        case
            when b.total_etiquetas > 0 and coalesce(c.conferidas, 0) >= b.total_etiquetas then ca.colaborador_mat
            when coalesce(c.em_andamento, 0) > 0 then ea.colaborador_mat
            when coalesce(c.conferidas, 0) > 0 then ca.colaborador_mat
            else null
        end as colaborador_mat,
        case
            when b.total_etiquetas > 0 and coalesce(c.conferidas, 0) >= b.total_etiquetas then ca.finalized_at
            when coalesce(c.em_andamento, 0) > 0 then ea.started_at
            when coalesce(c.conferidas, 0) > 0 then ca.finalized_at
            else null
        end as status_at
    from base b
    left join conf c
      on c.filial = b.filial
    left join em_andamento_actor ea
      on ea.filial = b.filial
    left join concluido_actor ca
      on ca.filial = b.filial
    order by b.rota, b.filial;
end;
$$;

grant execute on function public.rpc_conf_pedido_direto_route_overview(integer) to authenticated;



