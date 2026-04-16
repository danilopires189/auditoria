drop function if exists public.rpc_conf_pedido_direto_manifest_items_page(integer, integer, integer);

create or replace function public.rpc_conf_pedido_direto_manifest_items_page(
    p_cd integer default null,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    id_vol text,
    caixa text,
    pedido bigint,
    sq bigint,
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
            min(t.sq) as sq,
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
        m.sq,
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

drop function if exists public.rpc_conf_pedido_direto_open_volume(text, integer);
drop function if exists public.rpc_conf_pedido_direto_open_volume(text, integer, text);

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
        v_read_only := true;
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
            updated_at
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
            now()
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
        v_read_only
    from app.conf_pedido_direto c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

drop function if exists public.rpc_conf_pedido_direto_get_active_volume();
drop function if exists public.rpc_conf_pedido_direto_get_active_volume(text);

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
        false as is_read_only
    from app.conf_pedido_direto c
    where c.conf_id = v_conf.conf_id
    limit 1;
end;
$$;

grant execute on function public.rpc_conf_pedido_direto_manifest_items_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_open_volume(text, integer, text) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_get_active_volume(text) to authenticated;
