alter table app.conf_entrada_notas_itens
    add column if not exists locked_by uuid references auth.users(id) on delete restrict;

alter table app.conf_entrada_notas_itens
    add column if not exists locked_mat text;

alter table app.conf_entrada_notas_itens
    add column if not exists locked_nome text;

update app.conf_entrada_notas_itens i
set
    locked_by = c.started_by,
    locked_mat = c.started_mat,
    locked_nome = c.started_nome
from app.conf_entrada_notas c
where c.conf_id = i.conf_id
  and i.qtd_conferida > 0
  and i.locked_by is null;

alter table app.conf_entrada_notas_itens_conferidos
    drop constraint if exists conf_entrada_notas_itens_conferidos_qtd_conferida_check;

alter table app.conf_entrada_notas_itens_conferidos
    add constraint conf_entrada_notas_itens_conferidos_qtd_conferida_check
    check (qtd_conferida >= 0);

create table if not exists app.conf_entrada_notas_colaboradores (
    conf_id uuid not null references app.conf_entrada_notas(conf_id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete restrict,
    mat text not null,
    nome text not null,
    first_action_at timestamptz not null default now(),
    last_action_at timestamptz not null default now(),
    constraint pk_conf_entrada_notas_colaboradores primary key (conf_id, user_id)
);

create index if not exists idx_conf_entrada_notas_colaboradores_conf
    on app.conf_entrada_notas_colaboradores(conf_id);

create index if not exists idx_conf_entrada_notas_colaboradores_user
    on app.conf_entrada_notas_colaboradores(user_id);

insert into app.conf_entrada_notas_colaboradores (
    conf_id,
    user_id,
    mat,
    nome,
    first_action_at,
    last_action_at
)
select
    c.conf_id,
    c.started_by,
    coalesce(nullif(trim(coalesce(c.started_mat, '')), ''), 'SEM_MATRICULA'),
    coalesce(nullif(trim(coalesce(c.started_nome, '')), ''), 'USUARIO'),
    coalesce(c.started_at, now()),
    coalesce(c.finalized_at, c.updated_at, c.started_at, now())
from app.conf_entrada_notas c
on conflict (conf_id, user_id)
do update set
    mat = excluded.mat,
    nome = excluded.nome,
    first_action_at = least(
        app.conf_entrada_notas_colaboradores.first_action_at,
        excluded.first_action_at
    ),
    last_action_at = greatest(
        app.conf_entrada_notas_colaboradores.last_action_at,
        excluded.last_action_at
    );

alter table app.conf_entrada_notas_colaboradores enable row level security;

revoke all on app.conf_entrada_notas_colaboradores from anon;
revoke all on app.conf_entrada_notas_colaboradores from authenticated;

drop policy if exists p_conf_entrada_notas_colaboradores_select on app.conf_entrada_notas_colaboradores;
drop policy if exists p_conf_entrada_notas_colaboradores_insert on app.conf_entrada_notas_colaboradores;
drop policy if exists p_conf_entrada_notas_colaboradores_update on app.conf_entrada_notas_colaboradores;
drop policy if exists p_conf_entrada_notas_colaboradores_delete on app.conf_entrada_notas_colaboradores;

create policy p_conf_entrada_notas_colaboradores_select
on app.conf_entrada_notas_colaboradores
for select
using (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_colaboradores.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_entrada_notas_colaboradores_insert
on app.conf_entrada_notas_colaboradores
for insert
with check (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_colaboradores.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_entrada_notas_colaboradores_update
on app.conf_entrada_notas_colaboradores
for update
using (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_colaboradores.conf_id
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
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_colaboradores.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_entrada_notas_colaboradores_delete
on app.conf_entrada_notas_colaboradores
for delete
using (
    exists (
        select 1
        from app.conf_entrada_notas c
        where c.conf_id = conf_entrada_notas_colaboradores.conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

grant select, insert, update, delete on app.conf_entrada_notas_colaboradores to authenticated;

create or replace function app.conf_entrada_notas_touch_colaborador_from_session(
    p_conf_id uuid
)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_entrada_notas%rowtype;
    v_profile record;
    v_mat text;
    v_nome text;
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
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    v_mat := coalesce(
        nullif(trim(coalesce(v_profile.mat, '')), ''),
        nullif(trim(coalesce(v_conf.started_mat, '')), ''),
        'SEM_MATRICULA'
    );
    v_nome := coalesce(
        nullif(trim(coalesce(v_profile.nome, '')), ''),
        nullif(trim(coalesce(v_conf.started_nome, '')), ''),
        'USUARIO'
    );

    insert into app.conf_entrada_notas_colaboradores (
        conf_id,
        user_id,
        mat,
        nome,
        first_action_at,
        last_action_at
    )
    values (
        v_conf.conf_id,
        v_uid,
        v_mat,
        v_nome,
        now(),
        now()
    )
    on conflict (conf_id, user_id)
    do update set
        mat = excluded.mat,
        nome = excluded.nome,
        last_action_at = now();
end;
$$;

create or replace function app.conf_entrada_notas_seed_colaborador_on_insert()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
begin
    insert into app.conf_entrada_notas_colaboradores (
        conf_id,
        user_id,
        mat,
        nome,
        first_action_at,
        last_action_at
    )
    values (
        new.conf_id,
        new.started_by,
        coalesce(nullif(trim(coalesce(new.started_mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(new.started_nome, '')), ''), 'USUARIO'),
        coalesce(new.started_at, now()),
        coalesce(new.updated_at, new.started_at, now())
    )
    on conflict (conf_id, user_id)
    do update set
        mat = excluded.mat,
        nome = excluded.nome,
        first_action_at = least(
            app.conf_entrada_notas_colaboradores.first_action_at,
            excluded.first_action_at
        ),
        last_action_at = greatest(
            app.conf_entrada_notas_colaboradores.last_action_at,
            excluded.last_action_at
        );

    return new;
end;
$$;

create or replace function app.conf_entrada_notas_seed_colaborador_on_started_update()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
begin
    insert into app.conf_entrada_notas_colaboradores (
        conf_id,
        user_id,
        mat,
        nome,
        first_action_at,
        last_action_at
    )
    values (
        new.conf_id,
        new.started_by,
        coalesce(nullif(trim(coalesce(new.started_mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(new.started_nome, '')), ''), 'USUARIO'),
        now(),
        now()
    )
    on conflict (conf_id, user_id)
    do update set
        mat = excluded.mat,
        nome = excluded.nome,
        last_action_at = now();

    return new;
end;
$$;

drop trigger if exists trg_conf_entrada_notas_seed_colaborador_insert on app.conf_entrada_notas;
create trigger trg_conf_entrada_notas_seed_colaborador_insert
after insert on app.conf_entrada_notas
for each row
execute function app.conf_entrada_notas_seed_colaborador_on_insert();

drop trigger if exists trg_conf_entrada_notas_seed_colaborador_started_update on app.conf_entrada_notas;
create trigger trg_conf_entrada_notas_seed_colaborador_started_update
after update of started_by, started_mat, started_nome on app.conf_entrada_notas
for each row
when (old.started_by is distinct from new.started_by)
execute function app.conf_entrada_notas_seed_colaborador_on_started_update();

create or replace function app.conf_entrada_notas_itens_sync_conferidos()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_divergencia text;
begin
    if tg_op = 'DELETE' then
        delete from app.conf_entrada_notas_itens_conferidos c
        where c.conf_id = old.conf_id
          and c.coddv = old.coddv;
        return old;
    end if;

    v_divergencia := case
        when new.qtd_conferida < new.qtd_esperada then 'falta'
        when new.qtd_conferida > new.qtd_esperada then 'sobra'
        else 'correto'
    end;

    insert into app.conf_entrada_notas_itens_conferidos (
        conf_id,
        item_id,
        seq_entrada,
        nf,
        coddv,
        barras,
        descricao,
        qtd_conferida,
        divergencia_tipo,
        updated_at
    )
    values (
        new.conf_id,
        new.item_id,
        new.seq_entrada,
        new.nf,
        new.coddv,
        new.barras,
        new.descricao,
        new.qtd_conferida,
        v_divergencia,
        now()
    )
    on conflict (conf_id, coddv)
    do update set
        item_id = excluded.item_id,
        seq_entrada = excluded.seq_entrada,
        nf = excluded.nf,
        barras = excluded.barras,
        descricao = excluded.descricao,
        qtd_conferida = excluded.qtd_conferida,
        divergencia_tipo = excluded.divergencia_tipo,
        updated_at = now();

    return new;
end;
$$;

create or replace function app.conf_entrada_notas_itens_apply_lock()
returns trigger
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_entrada_notas%rowtype;
    v_profile record;
    v_mat text;
    v_nome text;
begin
    if tg_op <> 'UPDATE' then
        return new;
    end if;

    if not (new.qtd_conferida is distinct from old.qtd_conferida) then
        return new;
    end if;

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
    where c.conf_id = new.conf_id
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if not (
        authz.is_admin(v_uid)
        or authz.can_access_cd(v_uid, v_conf.cd)
    ) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_JA_FINALIZADA';
    end if;

    if old.locked_by is not null and old.locked_by <> v_uid then
        raise exception 'ITEM_BLOQUEADO_OUTRO_USUARIO';
    end if;

    if coalesce(old.qtd_conferida, 0) > 0 and old.locked_by is distinct from v_uid then
        raise exception 'ITEM_BLOQUEADO_OUTRO_USUARIO';
    end if;

    if new.qtd_conferida > 0 then
        select *
        into v_profile
        from authz.current_profile_context_v2()
        limit 1;

        v_mat := coalesce(
            nullif(trim(coalesce(v_profile.mat, '')), ''),
            nullif(trim(coalesce(v_conf.started_mat, '')), ''),
            'SEM_MATRICULA'
        );
        v_nome := coalesce(
            nullif(trim(coalesce(v_profile.nome, '')), ''),
            nullif(trim(coalesce(v_conf.started_nome, '')), ''),
            'USUARIO'
        );

        new.locked_by := v_uid;
        new.locked_mat := v_mat;
        new.locked_nome := v_nome;
    else
        new.locked_by := null;
        new.locked_mat := null;
        new.locked_nome := null;
    end if;

    return new;
end;
$$;

create or replace function app.conf_entrada_notas_touch_colaborador_on_item_update()
returns trigger
language plpgsql
security definer
set search_path = app, authz, public
as $$
begin
    if tg_op = 'UPDATE' and new.qtd_conferida is distinct from old.qtd_conferida then
        perform app.conf_entrada_notas_touch_colaborador_from_session(new.conf_id);
    end if;
    return new;
end;
$$;

drop trigger if exists trg_conf_entrada_notas_itens_apply_lock on app.conf_entrada_notas_itens;
create trigger trg_conf_entrada_notas_itens_apply_lock
before update of qtd_conferida on app.conf_entrada_notas_itens
for each row
execute function app.conf_entrada_notas_itens_apply_lock();

drop trigger if exists trg_conf_entrada_notas_itens_touch_colaborador on app.conf_entrada_notas_itens;
create trigger trg_conf_entrada_notas_itens_touch_colaborador
after update of qtd_conferida on app.conf_entrada_notas_itens
for each row
execute function app.conf_entrada_notas_touch_colaborador_on_item_update();

drop function if exists public.rpc_conf_entrada_notas_get_items(uuid);
drop function if exists public.rpc_conf_entrada_notas_get_items_v2(uuid);

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
            when i.qtd_conferida < i.qtd_esperada then 1
            when i.qtd_conferida > i.qtd_esperada then 2
            else 3
        end,
        i.coddv;
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
        count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer
    into
        v_falta_count,
        v_sobra_count,
        v_correto_count
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_conf.conf_id;

    v_status := case
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

drop function if exists public.rpc_conf_entrada_notas_get_partial_reopen_info(bigint, bigint, integer);
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
            v_conf.status in ('finalizado_ok', 'finalizado_divergencia')
            and coalesce(v_pending_items, 0) > 0
        );
end;
$$;

drop function if exists public.rpc_conf_entrada_notas_reopen_partial_conference(bigint, bigint, integer);
create or replace function public.rpc_conf_entrada_notas_reopen_partial_conference(
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

    if v_conf.status not in ('finalizado_ok', 'finalizado_divergencia') then
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

drop function if exists public.rpc_conf_entrada_notas_get_contributors(uuid);
create or replace function public.rpc_conf_entrada_notas_get_contributors(
    p_conf_id uuid
)
returns table (
    user_id uuid,
    mat text,
    nome text,
    first_action_at timestamptz,
    last_action_at timestamptz
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
        col.user_id,
        col.mat,
        col.nome,
        col.first_action_at,
        col.last_action_at
    from app.conf_entrada_notas_colaboradores col
    where col.conf_id = v_conf.conf_id
    order by col.first_action_at, col.nome;
end;
$$;

grant execute on function public.rpc_conf_entrada_notas_get_items(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_get_items_v2(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_get_partial_reopen_info(bigint, bigint, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_reopen_partial_conference(bigint, bigint, integer) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_get_contributors(uuid) to authenticated;
