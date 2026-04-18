alter table app.conf_pedido_direto
    add column if not exists reopened_from_finalized boolean not null default false;

alter table app.conf_pedido_direto_itens
    add column if not exists locked_by uuid references auth.users(id) on delete set null,
    add column if not exists locked_mat text,
    add column if not exists locked_nome text,
    add column if not exists locked_at timestamptz;

create index if not exists idx_conf_pedido_direto_itens_locked_by
    on app.conf_pedido_direto_itens(locked_by)
    where locked_by is not null;

drop function if exists public.rpc_conf_pedido_direto_open_volume(text, integer);
drop function if exists public.rpc_conf_pedido_direto_open_volume(text, integer, text);
drop function if exists public.rpc_conf_pedido_direto_get_active_volume();
drop function if exists public.rpc_conf_pedido_direto_get_active_volume(text);
drop function if exists public.rpc_conf_pedido_direto_get_items_v2(uuid);
drop function if exists public.rpc_conf_pedido_direto_get_partial_reopen_info(text, integer, text);
drop function if exists public.rpc_conf_pedido_direto_reopen_partial_conference(text, integer, text);

create or replace function public.rpc_conf_pedido_direto_open_volume(
    p_id_vol text,
    p_cd integer default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    id_vol text,
    origem_link text,
    caixa text,
    pedido bigint,
    sq bigint,
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
    is_read_only boolean,
    reopened_from_finalized boolean
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
    v_source_count integer := 0;
    v_origem_link text;
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
    v_origem_link := app.conf_pedido_direto_resolve_origem_link(p_origem_link);
    v_tag := nullif(regexp_replace(coalesce(p_id_vol, ''), '\s+', '', 'g'), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'ID_VOL_OBRIGATORIO';
    end if;

    if v_tag ~ '^[0-9]+&[0-9]+$' then
        begin
            v_tag := (split_part(v_tag, '&', 1)::bigint)::text || (split_part(v_tag, '&', 2)::bigint)::text;
        exception
            when numeric_value_out_of_range then
                raise exception 'ID_VOL_INVALIDO';
        end;
    elsif v_tag ~ '^[0-9]+$' then
        v_tag := ltrim(v_tag, '0');
        if v_tag = '' then
            v_tag := '0';
        end if;
    else
        raise exception 'ID_VOL_INVALIDO';
    end if;

    with source as (
        select
            app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq) as id_vol,
            t.pedido,
            t.sq
        from app.db_pedido_direto t
        where t.cd = v_cd
    )
    select count(*)
    into v_source_count
    from (
        select distinct s.pedido, s.sq
        from source s
        where s.id_vol = v_tag
    ) src;

    if coalesce(v_source_count, 0) = 0 then
        raise exception 'ID_VOL_NAO_ENCONTRADO';
    end if;

    if v_source_count > 1 then
        raise exception 'ID_VOL_AMBIGUO';
    end if;

    select *
    into v_conf
    from app.conf_pedido_direto c
    where c.cd = v_cd
      and c.id_vol = v_tag
      and c.origem_link = v_origem_link
      and c.status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')
    order by c.updated_at desc nulls last, c.conf_date desc, c.started_at desc nulls last
    limit 1;

    if found then
        v_read_only := not (v_conf.status = 'em_conferencia' and v_conf.started_by = v_uid);
    else
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
          and c.origem_link = v_origem_link
          and c.status = 'em_conferencia'
        order by c.updated_at desc nulls last, c.started_at desc nulls last
        limit 1;

        if v_user_active.conf_id is not null
           and (v_user_active.cd <> v_cd or v_user_active.id_vol <> v_tag) then
            raise exception 'CONFERENCIA_EM_ABERTO_OUTRO_ID_VOL';
        end if;

        with source as (
            select
                app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq) as id_vol,
                null::text as caixa,
                t.pedido,
                t.sq,
                t.filial,
                t.coddv,
                t.descricao,
                t.qtd_fat as qtd_separada,
                null::text as num_rota
            from app.db_pedido_direto t
            where t.cd = v_cd
        ),
        src as (
            select
                min(nullif(trim(s.caixa), '')) as caixa,
                min(s.pedido) as pedido,
                min(s.sq) as sq,
                min(s.filial) as filial,
                coalesce(
                    min(nullif(trim(r.nome), '')),
                    format('FILIAL %s', min(s.filial))
                ) as filial_nome,
                coalesce(
                    min(nullif(trim(r.rota), '')),
                    min(nullif(trim(s.num_rota), '')),
                    'SEM ROTA'
                ) as rota
            from source s
            left join app.db_rotas r
              on r.cd = v_cd
             and r.filial = s.filial
            where s.id_vol = v_tag
        )
        insert into app.conf_pedido_direto (
            conf_date,
            cd,
            id_vol,
            origem_link,
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
            updated_at,
            reopened_from_finalized
        )
        select
            v_today,
            v_cd,
            v_tag,
            v_origem_link,
            src.caixa,
            src.pedido,
            src.sq,
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
            now(),
            false
        from src
        returning * into v_conf;

        with source as (
            select
                app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq) as id_vol,
                t.coddv,
                t.descricao,
                t.qtd_fat as qtd_separada
            from app.db_pedido_direto t
            where t.cd = v_cd
        )
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
            s.coddv,
            coalesce(
                min(nullif(trim(s.descricao), '')),
                format('CODDV %s', s.coddv)
            ),
            sum(greatest(coalesce(s.qtd_separada, 0)::integer, 0))::integer,
            0,
            now()
        from source s
        where s.id_vol = v_tag
        group by s.coddv
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
        c.origem_link,
        c.caixa,
        c.pedido,
        c.sq,
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
        v_read_only,
        c.reopened_from_finalized
    from app.conf_pedido_direto c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_get_active_volume(
    p_origem_link text default 'prevencaocd'
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    id_vol text,
    origem_link text,
    caixa text,
    pedido bigint,
    sq bigint,
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
    is_read_only boolean,
    reopened_from_finalized boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_today date;
    v_conf app.conf_pedido_direto%rowtype;
    v_origem_link text;
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
    v_origem_link := app.conf_pedido_direto_resolve_origem_link(p_origem_link);

    select *
    into v_conf
    from app.conf_pedido_direto c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.origem_link = v_origem_link
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
        c.origem_link,
        c.caixa,
        c.pedido,
        c.sq,
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
        false as is_read_only,
        c.reopened_from_finalized
    from app.conf_pedido_direto c
    where c.conf_id = v_conf.conf_id
    limit 1;
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
    is_locked boolean,
    locked_mat text,
    locked_nome text,
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
        (i.locked_by is not null) as is_locked,
        i.locked_mat,
        i.locked_nome,
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

create or replace function public.rpc_conf_pedido_direto_get_partial_reopen_info(
    p_id_vol text,
    p_cd integer default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    id_vol text,
    origem_link text,
    status text,
    previous_started_by uuid,
    previous_started_mat text,
    previous_started_nome text,
    locked_items integer,
    falta_items integer,
    sobra_items integer,
    can_reopen boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_tag text;
    v_origem_link text;
    v_conf app.conf_pedido_direto%rowtype;
    v_locked_items integer := 0;
    v_falta_items integer := 0;
    v_sobra_items integer := 0;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);
    v_origem_link := app.conf_pedido_direto_resolve_origem_link(p_origem_link);
    v_tag := nullif(regexp_replace(coalesce(p_id_vol, ''), '\s+', '', 'g'), '');

    if v_tag is null then
        raise exception 'ID_VOL_OBRIGATORIO';
    end if;

    if v_tag ~ '^[0-9]+&[0-9]+$' then
        begin
            v_tag := (split_part(v_tag, '&', 1)::bigint)::text || (split_part(v_tag, '&', 2)::bigint)::text;
        exception
            when numeric_value_out_of_range then
                raise exception 'ID_VOL_INVALIDO';
        end;
    elsif v_tag ~ '^[0-9]+$' then
        v_tag := ltrim(v_tag, '0');
        if v_tag = '' then
            v_tag := '0';
        end if;
    else
        raise exception 'ID_VOL_INVALIDO';
    end if;

    select *
    into v_conf
    from app.conf_pedido_direto c
    where c.cd = v_cd
      and c.id_vol = v_tag
      and c.origem_link = v_origem_link
      and c.status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    order by c.updated_at desc nulls last, c.conf_date desc, c.started_at desc nulls last
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    select
        count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer
    into
        v_locked_items,
        v_falta_items,
        v_sobra_items
    from app.conf_pedido_direto_itens i
    where i.conf_id = v_conf.conf_id;

    return query
    select
        v_conf.conf_id,
        v_conf.conf_date,
        v_conf.cd,
        v_conf.id_vol,
        v_conf.origem_link,
        v_conf.status,
        v_conf.started_by,
        v_conf.started_mat,
        v_conf.started_nome,
        coalesce(v_locked_items, 0),
        coalesce(v_falta_items, 0),
        coalesce(v_sobra_items, 0),
        (
            v_conf.status in ('finalizado_ok', 'finalizado_falta')
            and (
                coalesce(v_falta_items, 0) > 0
                or coalesce(v_sobra_items, 0) > 0
            )
        );
end;
$$;

create or replace function public.rpc_conf_pedido_direto_reopen_partial_conference(
    p_id_vol text,
    p_cd integer default null,
    p_origem_link text default 'prevencaocd'
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    id_vol text,
    origem_link text,
    caixa text,
    pedido bigint,
    sq bigint,
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
    is_read_only boolean,
    reopened_from_finalized boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_tag text;
    v_origem_link text;
    v_today date;
    v_conf app.conf_pedido_direto%rowtype;
    v_user_active app.conf_pedido_direto%rowtype;
    v_profile record;
    v_falta_items integer := 0;
    v_sobra_items integer := 0;
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
    v_origem_link := app.conf_pedido_direto_resolve_origem_link(p_origem_link);
    v_tag := nullif(regexp_replace(coalesce(p_id_vol, ''), '\s+', '', 'g'), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'ID_VOL_OBRIGATORIO';
    end if;

    if v_tag ~ '^[0-9]+&[0-9]+$' then
        begin
            v_tag := (split_part(v_tag, '&', 1)::bigint)::text || (split_part(v_tag, '&', 2)::bigint)::text;
        exception
            when numeric_value_out_of_range then
                raise exception 'ID_VOL_INVALIDO';
        end;
    elsif v_tag ~ '^[0-9]+$' then
        v_tag := ltrim(v_tag, '0');
        if v_tag = '' then
            v_tag := '0';
        end if;
    else
        raise exception 'ID_VOL_INVALIDO';
    end if;

    select *
    into v_user_active
    from app.conf_pedido_direto c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.origem_link = v_origem_link
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and (v_user_active.cd <> v_cd or v_user_active.id_vol <> v_tag) then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRO_ID_VOL';
    end if;

    select *
    into v_conf
    from app.conf_pedido_direto c
    where c.cd = v_cd
      and c.id_vol = v_tag
      and c.origem_link = v_origem_link
      and c.status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    order by c.updated_at desc nulls last, c.conf_date desc, c.started_at desc nulls last
    limit 1
    for update;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if v_conf.status = 'em_conferencia' then
        raise exception 'CONFERENCIA_EM_USO';
    end if;

    select
        count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer
    into
        v_falta_items,
        v_sobra_items
    from app.conf_pedido_direto_itens i
    where i.conf_id = v_conf.conf_id;

    if coalesce(v_falta_items, 0) <= 0 and coalesce(v_sobra_items, 0) <= 0 then
        raise exception 'CONFERENCIA_FINALIZADA_SEM_PENDENCIA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    update app.conf_pedido_direto_itens i
    set
        locked_by = case when i.qtd_conferida = i.qtd_esperada then v_conf.started_by else null end,
        locked_mat = case when i.qtd_conferida = i.qtd_esperada then v_conf.started_mat else null end,
        locked_nome = case when i.qtd_conferida = i.qtd_esperada then v_conf.started_nome else null end,
        locked_at = case when i.qtd_conferida = i.qtd_esperada then now() else null end,
        updated_at = case when i.qtd_conferida = i.qtd_esperada then now() else i.updated_at end
    where i.conf_id = v_conf.conf_id;

    update app.conf_pedido_direto c
    set
        status = 'em_conferencia',
        started_by = v_uid,
        started_mat = coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        started_nome = coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
        started_at = now(),
        finalized_at = null,
        falta_motivo = null,
        updated_at = now(),
        reopened_from_finalized = true
    where c.conf_id = v_conf.conf_id
    returning * into v_conf;

    return query
    select
        v_conf.conf_id,
        v_conf.conf_date,
        v_conf.cd,
        v_conf.id_vol,
        v_conf.origem_link,
        v_conf.caixa,
        v_conf.pedido,
        v_conf.sq,
        v_conf.filial,
        v_conf.filial_nome,
        v_conf.rota,
        v_conf.status,
        v_conf.falta_motivo,
        v_conf.started_by,
        v_conf.started_mat,
        v_conf.started_nome,
        v_conf.started_at,
        v_conf.finalized_at,
        v_conf.updated_at,
        false as is_read_only,
        v_conf.reopened_from_finalized;
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

    if exists (
        select 1
        from app.conf_pedido_direto_itens i
        where i.conf_id = v_conf.conf_id
          and i.coddv = v_coddv
          and i.locked_by is not null
    ) then
        raise exception 'ITEM_BLOQUEADO';
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

    if exists (
        select 1
        from app.conf_pedido_direto_itens i
        where i.conf_id = v_conf.conf_id
          and i.coddv = p_coddv
          and i.locked_by is not null
    ) then
        raise exception 'ITEM_BLOQUEADO';
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
    v_found_count integer := 0;
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

    if exists (
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
        )
        select 1
        from payload p
        join app.conf_pedido_direto_itens i
          on i.conf_id = v_conf.conf_id
         and i.coddv = p.coddv
        where i.locked_by is not null
          and (
              i.qtd_conferida <> p.qtd_conferida
              or coalesce(i.barras, '') <> coalesce(p.barras, coalesce(i.barras, ''))
          )
    ) then
        raise exception 'ITEM_BLOQUEADO';
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
          and i.locked_by is null
        returning i.coddv
    )
    select
        (select count(*)::integer from payload),
        (
            select count(*)::integer
            from payload p
            join app.conf_pedido_direto_itens i
              on i.conf_id = v_conf.conf_id
             and i.coddv = p.coddv
        ),
        (
            select count(*)::integer
            from updated
        )
    into
        v_payload_count,
        v_found_count,
        v_updated_count;

    if v_payload_count <> v_found_count then
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

grant execute on function public.rpc_conf_pedido_direto_open_volume(text, integer, text) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_get_active_volume(text) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_get_items_v2(uuid) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_get_partial_reopen_info(text, integer, text) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_reopen_partial_conference(text, integer, text) to authenticated;
