
create table if not exists app.conf_entrada_notas_avulsa_targets (
    avulsa_conf_id uuid not null references app.conf_entrada_notas_avulsa(conf_id) on delete cascade,
    target_conf_id uuid not null references app.conf_entrada_notas(conf_id) on delete cascade,
    cd integer not null,
    seq_entrada bigint not null,
    nf bigint not null,
    created_via_session boolean not null default true,
    first_scan_at timestamptz not null default now(),
    last_scan_at timestamptz not null default now(),
    constraint pk_conf_entrada_notas_avulsa_targets primary key (avulsa_conf_id, target_conf_id),
    constraint uq_conf_entrada_notas_avulsa_targets_seq_nf unique (avulsa_conf_id, seq_entrada, nf)
);

create index if not exists idx_conf_entrada_notas_avulsa_targets_conf
    on app.conf_entrada_notas_avulsa_targets(avulsa_conf_id);

create index if not exists idx_conf_entrada_notas_avulsa_targets_target
    on app.conf_entrada_notas_avulsa_targets(target_conf_id);

create index if not exists idx_conf_entrada_notas_avulsa_targets_cd_seq_nf
    on app.conf_entrada_notas_avulsa_targets(cd, seq_entrada, nf);

alter table app.conf_entrada_notas_avulsa_targets enable row level security;

revoke all on app.conf_entrada_notas_avulsa_targets from anon;
revoke all on app.conf_entrada_notas_avulsa_targets from authenticated;

drop policy if exists p_conf_entrada_notas_avulsa_targets_select on app.conf_entrada_notas_avulsa_targets;
drop policy if exists p_conf_entrada_notas_avulsa_targets_insert on app.conf_entrada_notas_avulsa_targets;
drop policy if exists p_conf_entrada_notas_avulsa_targets_update on app.conf_entrada_notas_avulsa_targets;
drop policy if exists p_conf_entrada_notas_avulsa_targets_delete on app.conf_entrada_notas_avulsa_targets;

create policy p_conf_entrada_notas_avulsa_targets_select
on app.conf_entrada_notas_avulsa_targets
for select
using (
    exists (
        select 1
        from app.conf_entrada_notas_avulsa c
        where c.conf_id = conf_entrada_notas_avulsa_targets.avulsa_conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_entrada_notas_avulsa_targets_insert
on app.conf_entrada_notas_avulsa_targets
for insert
with check (
    exists (
        select 1
        from app.conf_entrada_notas_avulsa c
        where c.conf_id = conf_entrada_notas_avulsa_targets.avulsa_conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_entrada_notas_avulsa_targets_update
on app.conf_entrada_notas_avulsa_targets
for update
using (
    exists (
        select 1
        from app.conf_entrada_notas_avulsa c
        where c.conf_id = conf_entrada_notas_avulsa_targets.avulsa_conf_id
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
        from app.conf_entrada_notas_avulsa c
        where c.conf_id = conf_entrada_notas_avulsa_targets.avulsa_conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

create policy p_conf_entrada_notas_avulsa_targets_delete
on app.conf_entrada_notas_avulsa_targets
for delete
using (
    exists (
        select 1
        from app.conf_entrada_notas_avulsa c
        where c.conf_id = conf_entrada_notas_avulsa_targets.avulsa_conf_id
          and c.started_by = auth.uid()
          and authz.session_is_recent(6)
          and (
              authz.is_admin(auth.uid())
              or authz.can_access_cd(auth.uid(), c.cd)
          )
    )
);

-- Encerra qualquer sessão avulsa legada aberta e limpa itens agregados antigos.
update app.conf_entrada_notas_avulsa c
set
    status = 'finalizado_divergencia',
    finalized_at = coalesce(c.finalized_at, now()),
    updated_at = now()
where c.status = 'em_conferencia';

delete from app.conf_entrada_notas_avulsa_itens_conferidos;
delete from app.conf_entrada_notas_avulsa_itens;

create or replace function app.conf_entrada_notas_avulsa_require_session(p_conf_id uuid)
returns app.conf_entrada_notas_avulsa
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_entrada_notas_avulsa%rowtype;
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
    from app.conf_entrada_notas_avulsa c
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

    return v_conf;
end;
$$;

create or replace function app.conf_entrada_notas_avulsa_upsert_target(
    p_avulsa_conf_id uuid,
    p_target_conf_id uuid,
    p_cd integer,
    p_seq_entrada bigint,
    p_nf bigint
)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
begin
    insert into app.conf_entrada_notas_avulsa_targets (
        avulsa_conf_id,
        target_conf_id,
        cd,
        seq_entrada,
        nf,
        created_via_session,
        first_scan_at,
        last_scan_at
    )
    values (
        p_avulsa_conf_id,
        p_target_conf_id,
        p_cd,
        p_seq_entrada,
        p_nf,
        true,
        now(),
        now()
    )
    on conflict (avulsa_conf_id, target_conf_id)
    do update set
        cd = excluded.cd,
        seq_entrada = excluded.seq_entrada,
        nf = excluded.nf,
        last_scan_at = now();
end;
$$;

create or replace function app.conf_entrada_notas_avulsa_touch_target(
    p_avulsa_conf_id uuid,
    p_target_conf_id uuid
)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
begin
    update app.conf_entrada_notas_avulsa_targets t
    set last_scan_at = now()
    where t.avulsa_conf_id = p_avulsa_conf_id
      and t.target_conf_id = p_target_conf_id;
end;
$$;
create or replace function public.rpc_conf_entrada_notas_avulsa_open(
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
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
    v_profile record;
    v_conf app.conf_entrada_notas_avulsa%rowtype;
    v_user_active app.conf_entrada_notas_avulsa%rowtype;
    v_read_only boolean;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_entrada_notas_avulsa_autoclose_stale();

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    select *
    into v_user_active
    from app.conf_entrada_notas_avulsa c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and v_user_active.cd <> v_cd then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_ENTRADA';
    end if;

    if not exists (
        select 1
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.coddv is not null
    ) then
        raise exception 'BASE_ENTRADA_NOTAS_VAZIA';
    end if;

    select *
    into v_conf
    from app.conf_entrada_notas_avulsa c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.kind = 'avulsa'
    limit 1;

    if found then
        if v_conf.started_by <> v_uid then
            if v_conf.status = 'em_conferencia' then
                raise exception 'CONFERENCIA_AVULSA_EM_USO';
            end if;
            raise exception 'CONFERENCIA_AVULSA_JA_FINALIZADA_OUTRO_USUARIO';
        end if;
        v_read_only := v_conf.status <> 'em_conferencia';
    else
        insert into app.conf_entrada_notas_avulsa (
            conf_date,
            cd,
            kind,
            transportadora,
            fornecedor,
            started_by,
            started_mat,
            started_nome,
            status,
            started_at,
            finalized_at,
            updated_at
        )
        values (
            v_today,
            v_cd,
            'avulsa',
            'CONFERENCIA AVULSA',
            'GERAL',
            v_uid,
            coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
            coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
            'em_conferencia',
            now(),
            null,
            now()
        )
        returning * into v_conf;

        v_read_only := false;
    end if;

    return query
    select
        c.conf_id,
        c.conf_date,
        c.cd,
        c.transportadora,
        c.fornecedor,
        c.status,
        c.started_by,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        v_read_only
    from app.conf_entrada_notas_avulsa c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;
drop function if exists public.rpc_conf_entrada_notas_avulsa_resolve_targets(uuid, text);
create or replace function public.rpc_conf_entrada_notas_avulsa_resolve_targets(
    p_conf_id uuid,
    p_barras text
)
returns table (
    coddv integer,
    descricao text,
    barras text,
    seq_entrada bigint,
    nf bigint,
    transportadora text,
    fornecedor text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_pendente integer,
    target_conf_id uuid,
    target_status text,
    started_by uuid,
    started_nome text,
    started_mat text,
    is_locked boolean,
    is_available boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_entrada_notas_avulsa%rowtype;
    v_today date;
    v_barras text;
    v_coddv integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_conf := app.conf_entrada_notas_avulsa_require_session(p_conf_id);

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_JA_FINALIZADA';
    end if;

    v_barras := regexp_replace(coalesce(p_barras, ''), '\\s+', '', 'g');
    if v_barras = '' then
        raise exception 'BARRAS_OBRIGATORIA';
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

    if not exists (
        select 1
        from app.db_entrada_notas t
        where t.cd = v_conf.cd
          and t.coddv = v_coddv
    ) then
        raise exception 'PRODUTO_NAO_PERTENCE_A_NENHUM_RECEBIMENTO';
    end if;

    v_today := (timezone('America/Sao_Paulo', now()))::date;

    return query
    with entrada as (
        select
            t.seq_entrada,
            t.nf,
            coalesce(min(nullif(trim(t.transportadora), '')), 'SEM TRANSPORTADORA') as transportadora,
            coalesce(min(nullif(trim(t.forn), '')), 'SEM FORNECEDOR') as fornecedor,
            coalesce(min(nullif(trim(t.descricao), '')), format('Produto %s', v_coddv)) as descricao,
            greatest(sum(greatest(coalesce(t.qtd_total, 0)::integer, 0))::integer, 1) as qtd_esperada
        from app.db_entrada_notas t
        where t.cd = v_conf.cd
          and t.coddv = v_coddv
          and t.seq_entrada is not null
          and t.nf is not null
        group by t.seq_entrada, t.nf
    ),
    conf as (
        select
            c.conf_id,
            c.seq_entrada,
            c.nf,
            c.status,
            c.started_by,
            c.started_nome,
            c.started_mat
        from app.conf_entrada_notas c
        where c.cd = v_conf.cd
          and c.conf_date = v_today
    ),
    conf_item as (
        select
            i.conf_id,
            i.coddv,
            i.qtd_conferida
        from app.conf_entrada_notas_itens i
        where i.coddv = v_coddv
    )
    select
        v_coddv,
        e.descricao,
        v_barras,
        e.seq_entrada,
        e.nf,
        e.transportadora,
        e.fornecedor,
        e.qtd_esperada,
        coalesce(ci.qtd_conferida, 0)::integer as qtd_conferida,
        greatest(e.qtd_esperada - coalesce(ci.qtd_conferida, 0)::integer, 0) as qtd_pendente,
        c.conf_id as target_conf_id,
        c.status as target_status,
        c.started_by,
        c.started_nome,
        c.started_mat,
        (
            c.status = 'em_conferencia'
            and c.started_by is not null
            and c.started_by <> v_uid
        ) as is_locked,
        (
            greatest(e.qtd_esperada - coalesce(ci.qtd_conferida, 0)::integer, 0) > 0
            and (c.conf_id is null or (c.status = 'em_conferencia' and c.started_by = v_uid))
        ) as is_available
    from entrada e
    left join conf c
      on c.seq_entrada = e.seq_entrada
     and c.nf = e.nf
    left join conf_item ci
      on ci.conf_id = c.conf_id
     and ci.coddv = v_coddv
    order by
        (
            greatest(e.qtd_esperada - coalesce(ci.qtd_conferida, 0)::integer, 0) > 0
            and (c.conf_id is null or (c.status = 'em_conferencia' and c.started_by = v_uid))
        ) desc,
        e.seq_entrada,
        e.nf;
end;
$$;
drop function if exists public.rpc_conf_entrada_notas_avulsa_apply_scan(uuid, text, integer, bigint, bigint);
create or replace function public.rpc_conf_entrada_notas_avulsa_apply_scan(
    p_conf_id uuid,
    p_barras text,
    p_qtd integer,
    p_seq_entrada bigint default null,
    p_nf bigint default null
)
returns table (
    avulsa_conf_id uuid,
    target_conf_id uuid,
    seq_entrada bigint,
    nf bigint,
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
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_entrada_notas_avulsa%rowtype;
    v_target record;
    v_target_count integer := 0;
    v_available_count integer := 0;
    v_target_conf app.conf_entrada_notas%rowtype;
    v_barras text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_conf := app.conf_entrada_notas_avulsa_require_session(p_conf_id);

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_JA_FINALIZADA';
    end if;

    if coalesce(p_qtd, 0) <= 0 then
        raise exception 'QTD_INVALIDA';
    end if;

    v_barras := regexp_replace(coalesce(p_barras, ''), '\\s+', '', 'g');
    if v_barras = '' then
        raise exception 'BARRAS_OBRIGATORIA';
    end if;

    if p_seq_entrada is not null and p_nf is not null then
        select *
        into v_target
        from public.rpc_conf_entrada_notas_avulsa_resolve_targets(p_conf_id, v_barras) r
        where r.seq_entrada = p_seq_entrada
          and r.nf = p_nf
          and r.is_available = true
        limit 1;

        if v_target.seq_entrada is null then
            if exists (
                select 1
                from public.rpc_conf_entrada_notas_avulsa_resolve_targets(p_conf_id, v_barras) r
                where r.seq_entrada = p_seq_entrada
                  and r.nf = p_nf
            ) then
                raise exception 'ALVO_SEQ_NF_NAO_PENDENTE';
            end if;
            raise exception 'ALVO_SEQ_NF_INVALIDO';
        end if;
    else
        select
            count(*)::integer,
            count(*) filter (where r.is_available = true)::integer
        into
            v_target_count,
            v_available_count
        from public.rpc_conf_entrada_notas_avulsa_resolve_targets(p_conf_id, v_barras) r;

        if v_target_count = 0 then
            raise exception 'PRODUTO_NAO_PERTENCE_A_NENHUM_RECEBIMENTO';
        end if;

        if v_available_count <= 0 then
            raise exception 'SEM_ALVO_PENDENTE';
        end if;

        if v_available_count > 1 then
            raise exception 'MULTIPLOS_SEQ_NF_PENDENTES';
        end if;

        select *
        into v_target
        from public.rpc_conf_entrada_notas_avulsa_resolve_targets(p_conf_id, v_barras) r
        where r.is_available = true
        order by r.seq_entrada, r.nf
        limit 1;
    end if;

    select *
    into v_target_conf
    from app.conf_entrada_notas c
    where c.cd = v_conf.cd
      and c.conf_date = v_conf.conf_date
      and c.seq_entrada = v_target.seq_entrada
      and c.nf = v_target.nf
    limit 1;

    if v_target_conf.conf_id is null then
        select *
        into v_target
        from public.rpc_conf_entrada_notas_open_conference(v_target.seq_entrada, v_target.nf, v_conf.cd)
        limit 1;

        if v_target.is_read_only then
            raise exception 'ALVO_SEQ_NF_NAO_PENDENTE';
        end if;

        select *
        into v_target_conf
        from app.conf_entrada_notas c
        where c.conf_id = v_target.conf_id
        limit 1;
    end if;

    if v_target_conf.status <> 'em_conferencia' then
        raise exception 'ALVO_SEQ_NF_NAO_PENDENTE';
    end if;

    if v_target_conf.started_by <> v_uid then
        raise exception 'CONFERENCIA_EM_USO';
    end if;

    perform app.conf_entrada_notas_avulsa_upsert_target(
        v_conf.conf_id,
        v_target_conf.conf_id,
        v_target_conf.cd,
        v_target_conf.seq_entrada,
        v_target_conf.nf
    );

    update app.conf_entrada_notas_itens i
    set
        qtd_conferida = i.qtd_conferida + p_qtd,
        barras = v_barras,
        updated_at = now()
    where i.conf_id = v_target_conf.conf_id
      and i.coddv = v_target.coddv;

    if not found then
        raise exception 'PRODUTO_FORA_DA_ENTRADA';
    end if;

    update app.conf_entrada_notas c
    set updated_at = now()
    where c.conf_id = v_target_conf.conf_id;

    perform app.conf_entrada_notas_avulsa_touch_target(v_conf.conf_id, v_target_conf.conf_id);

    return query
    select
        v_conf.conf_id,
        i.conf_id,
        i.seq_entrada,
        i.nf,
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
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_target_conf.conf_id
      and i.coddv = v_target.coddv
    limit 1;
end;
$$;
drop function if exists public.rpc_conf_entrada_notas_avulsa_get_targets(uuid);
create or replace function public.rpc_conf_entrada_notas_avulsa_get_targets(
    p_conf_id uuid
)
returns table (
    avulsa_conf_id uuid,
    target_conf_id uuid,
    seq_entrada bigint,
    nf bigint,
    transportadora text,
    fornecedor text,
    status text,
    total_itens integer,
    itens_conferidos integer,
    falta_count integer,
    sobra_count integer,
    correto_count integer,
    first_scan_at timestamptz,
    last_scan_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_conf app.conf_entrada_notas_avulsa%rowtype;
begin
    v_conf := app.conf_entrada_notas_avulsa_require_session(p_conf_id);

    return query
    with items as (
        select
            i.conf_id,
            count(*)::integer as total_itens,
            count(*) filter (where i.qtd_conferida > 0)::integer as itens_conferidos,
            count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer as falta_count,
            count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer as sobra_count,
            count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer as correto_count
        from app.conf_entrada_notas_itens i
        group by i.conf_id
    )
    select
        v_conf.conf_id,
        t.target_conf_id,
        t.seq_entrada,
        t.nf,
        c.transportadora,
        c.fornecedor,
        c.status,
        coalesce(it.total_itens, 0),
        coalesce(it.itens_conferidos, 0),
        coalesce(it.falta_count, 0),
        coalesce(it.sobra_count, 0),
        coalesce(it.correto_count, 0),
        t.first_scan_at,
        t.last_scan_at
    from app.conf_entrada_notas_avulsa_targets t
    join app.conf_entrada_notas c
      on c.conf_id = t.target_conf_id
    left join items it
      on it.conf_id = t.target_conf_id
    where t.avulsa_conf_id = v_conf.conf_id
    order by t.last_scan_at desc, t.seq_entrada, t.nf;
end;
$$;

drop function if exists public.rpc_conf_entrada_notas_avulsa_finalize_batch(uuid);
create or replace function public.rpc_conf_entrada_notas_avulsa_finalize_batch(
    p_conf_id uuid
)
returns table (
    avulsa_conf_id uuid,
    target_conf_id uuid,
    seq_entrada bigint,
    nf bigint,
    status text,
    falta_count integer,
    sobra_count integer,
    correto_count integer,
    finalized_at timestamptz,
    avulsa_status text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_conf app.conf_entrada_notas_avulsa%rowtype;
    v_target record;
    v_has_divergencia boolean := false;
    v_avulsa_status text;
begin
    v_conf := app.conf_entrada_notas_avulsa_require_session(p_conf_id);

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_JA_FINALIZADA';
    end if;

    if not exists (
        select 1
        from app.conf_entrada_notas_avulsa_targets t
        where t.avulsa_conf_id = v_conf.conf_id
    ) then
        raise exception 'SEM_ALVOS_CONFERENCIA_AVULSA';
    end if;

    for v_target in
        select t.target_conf_id
        from app.conf_entrada_notas_avulsa_targets t
        join app.conf_entrada_notas c
          on c.conf_id = t.target_conf_id
        where t.avulsa_conf_id = v_conf.conf_id
          and c.started_by = auth.uid()
          and c.status = 'em_conferencia'
    loop
        perform public.rpc_conf_entrada_notas_finalize(v_target.target_conf_id);
    end loop;

    if exists (
        select 1
        from app.conf_entrada_notas_avulsa_targets t
        join app.conf_entrada_notas_itens i
          on i.conf_id = t.target_conf_id
        where t.avulsa_conf_id = v_conf.conf_id
          and (i.qtd_conferida < i.qtd_esperada or i.qtd_conferida > i.qtd_esperada)
    ) then
        v_has_divergencia := true;
    end if;

    v_avulsa_status := case
        when v_has_divergencia then 'finalizado_divergencia'
        else 'finalizado_ok'
    end;

    update app.conf_entrada_notas_avulsa c
    set
        status = v_avulsa_status,
        finalized_at = now(),
        updated_at = now()
    where c.conf_id = v_conf.conf_id
    returning * into v_conf;

    return query
    with agg as (
        select
            i.conf_id,
            count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer as falta_count,
            count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer as sobra_count,
            count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer as correto_count
        from app.conf_entrada_notas_itens i
        group by i.conf_id
    )
    select
        v_conf.conf_id,
        t.target_conf_id,
        t.seq_entrada,
        t.nf,
        c.status,
        coalesce(a.falta_count, 0),
        coalesce(a.sobra_count, 0),
        coalesce(a.correto_count, 0),
        c.finalized_at,
        v_conf.status
    from app.conf_entrada_notas_avulsa_targets t
    join app.conf_entrada_notas c
      on c.conf_id = t.target_conf_id
    left join agg a
      on a.conf_id = t.target_conf_id
    where t.avulsa_conf_id = v_conf.conf_id
    order by t.seq_entrada, t.nf;
end;
$$;
drop function if exists public.rpc_conf_entrada_notas_avulsa_cancel_batch(uuid);
create or replace function public.rpc_conf_entrada_notas_avulsa_cancel_batch(
    p_conf_id uuid
)
returns table (
    conf_id uuid,
    cancelled boolean,
    deleted_targets integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_conf app.conf_entrada_notas_avulsa%rowtype;
    v_deleted integer := 0;
begin
    v_conf := app.conf_entrada_notas_avulsa_require_session(p_conf_id);

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA';
    end if;

    delete from app.conf_entrada_notas c
    using app.conf_entrada_notas_avulsa_targets t
    where t.avulsa_conf_id = v_conf.conf_id
      and c.conf_id = t.target_conf_id
      and c.started_by = auth.uid()
      and c.status = 'em_conferencia';

    get diagnostics v_deleted = row_count;

    delete from app.conf_entrada_notas_avulsa c
    where c.conf_id = v_conf.conf_id;

    return query
    select
        v_conf.conf_id,
        true,
        coalesce(v_deleted, 0);
end;
$$;

drop function if exists public.rpc_conf_entrada_notas_avulsa_check_conflict(uuid);
create or replace function public.rpc_conf_entrada_notas_avulsa_check_conflict(
    p_conf_id uuid
)
returns table (
    conf_id uuid,
    has_remote_data boolean,
    remote_targets integer,
    remote_items_conferidos integer,
    seq_nf_list text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_conf app.conf_entrada_notas_avulsa%rowtype;
begin
    v_conf := app.conf_entrada_notas_avulsa_require_session(p_conf_id);

    return query
    with targets as (
        select
            t.target_conf_id,
            t.seq_entrada,
            t.nf
        from app.conf_entrada_notas_avulsa_targets t
        where t.avulsa_conf_id = v_conf.conf_id
    ),
    counts as (
        select
            count(*)::integer as remote_targets,
            (
                select count(*)::integer
                from app.conf_entrada_notas_itens i
                join targets t
                  on t.target_conf_id = i.conf_id
                where i.qtd_conferida > 0
            ) as remote_items_conferidos,
            string_agg(format('%s/%s', t.seq_entrada, t.nf), ', ' order by t.seq_entrada, t.nf) as seq_nf_list
        from targets t
    )
    select
        v_conf.conf_id,
        (coalesce(c.remote_targets, 0) > 0 or coalesce(c.remote_items_conferidos, 0) > 0) as has_remote_data,
        coalesce(c.remote_targets, 0),
        coalesce(c.remote_items_conferidos, 0),
        coalesce(c.seq_nf_list, '')
    from counts c;
end;
$$;
create or replace function public.rpc_conf_entrada_notas_avulsa_get_items(p_conf_id uuid)
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
    v_conf app.conf_entrada_notas_avulsa%rowtype;
begin
    v_conf := app.conf_entrada_notas_avulsa_require_session(p_conf_id);

    return query
    select
        i.item_id,
        i.conf_id,
        i.coddv,
        format('Seq %s/NF %s - %s', i.seq_entrada, i.nf, i.descricao) as descricao,
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
    from app.conf_entrada_notas_itens i
    join app.conf_entrada_notas_avulsa_targets t
      on t.target_conf_id = i.conf_id
    where t.avulsa_conf_id = v_conf.conf_id
      and i.qtd_conferida > 0
    order by i.updated_at desc, i.seq_entrada, i.nf, i.coddv;
end;
$$;

drop function if exists public.rpc_conf_entrada_notas_avulsa_get_items_v2(uuid);
create or replace function public.rpc_conf_entrada_notas_avulsa_get_items_v2(p_conf_id uuid)
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
    seq_entrada bigint,
    nf bigint,
    target_conf_id uuid,
    item_key text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_conf app.conf_entrada_notas_avulsa%rowtype;
begin
    v_conf := app.conf_entrada_notas_avulsa_require_session(p_conf_id);

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
        i.seq_entrada,
        i.nf,
        i.conf_id as target_conf_id,
        format('%s/%s:%s', i.seq_entrada, i.nf, i.coddv) as item_key
    from app.conf_entrada_notas_itens i
    join app.conf_entrada_notas_avulsa_targets t
      on t.target_conf_id = i.conf_id
    where t.avulsa_conf_id = v_conf.conf_id
      and i.qtd_conferida > 0
    order by i.updated_at desc, i.seq_entrada, i.nf, i.coddv;
end;
$$;
create or replace function public.rpc_conf_entrada_notas_avulsa_scan_barcode(
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
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_row record;
begin
    select *
    into v_row
    from public.rpc_conf_entrada_notas_avulsa_apply_scan(
        p_conf_id,
        p_barras,
        p_qtd,
        null,
        null
    )
    limit 1;

    return query
    select
        v_row.target_conf_id::uuid as item_id,
        v_row.target_conf_id::uuid as conf_id,
        v_row.coddv::integer,
        v_row.barras::text,
        v_row.descricao::text,
        v_row.qtd_esperada::integer,
        v_row.qtd_conferida::integer,
        v_row.qtd_falta::integer,
        v_row.qtd_sobra::integer,
        v_row.divergencia_tipo::text,
        v_row.updated_at::timestamptz;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_avulsa_finalize(
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
    v_conf app.conf_entrada_notas_avulsa%rowtype;
begin
    perform public.rpc_conf_entrada_notas_avulsa_finalize_batch(p_conf_id);

    select *
    into v_conf
    from app.conf_entrada_notas_avulsa c
    where c.conf_id = p_conf_id
    limit 1;

    return query
    with agg as (
        select
            count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer as falta_count,
            count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer as sobra_count,
            count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer as correto_count
        from app.conf_entrada_notas_itens i
        join app.conf_entrada_notas_avulsa_targets t
          on t.target_conf_id = i.conf_id
        where t.avulsa_conf_id = p_conf_id
    )
    select
        v_conf.conf_id,
        v_conf.status,
        coalesce(a.falta_count, 0),
        coalesce(a.sobra_count, 0),
        coalesce(a.correto_count, 0),
        v_conf.finalized_at
    from agg a;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_avulsa_cancel(
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
    v_row record;
begin
    select *
    into v_row
    from public.rpc_conf_entrada_notas_avulsa_cancel_batch(p_conf_id)
    limit 1;

    return query
    select
        v_row.conf_id::uuid,
        v_row.cancelled::boolean;
end;
$$;

grant select, insert, update, delete on app.conf_entrada_notas_avulsa_targets to authenticated;

grant execute on function public.rpc_conf_entrada_notas_avulsa_resolve_targets(uuid, text) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_avulsa_apply_scan(uuid, text, integer, bigint, bigint) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_avulsa_get_targets(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_avulsa_finalize_batch(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_avulsa_cancel_batch(uuid) to authenticated;
grant execute on function public.rpc_conf_entrada_notas_avulsa_check_conflict(uuid) to authenticated;
