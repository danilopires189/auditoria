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
    v_source_count integer := 0;
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

    -- Se ja existe conferencia para o volume (em andamento ou concluida), abre somente leitura.
    select *
    into v_conf
    from app.conf_pedido_direto c
    where c.cd = v_cd
      and c.id_vol = v_tag
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

drop function if exists public.rpc_conf_pedido_direto_route_overview(integer);

create or replace function public.rpc_conf_pedido_direto_route_overview(p_cd integer default null)
returns table (
    rota text,
    filial bigint,
    filial_nome text,
    pedidos_seq text,
    total_etiquetas integer,
    conferidas integer,
    pendentes integer,
    status text,
    tem_falta boolean,
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
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);

    return query
    with source as (
        select
            t.cd,
            t.filial,
            t.pedido,
            t.sq,
            app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq) as id_vol,
            null::text as num_rota
        from app.db_pedido_direto t
        where t.cd = v_cd
    ),
    source_valid as (
        select s.*
        from source s
        where nullif(trim(coalesce(s.id_vol, '')), '') is not null
    ),
    base as (
        select
            coalesce(
                min(nullif(trim(r.rota), '')),
                min(nullif(trim(s.num_rota), '')),
                'SEM ROTA'
            ) as rota,
            min(s.filial) as filial,
            coalesce(
                min(nullif(trim(r.nome), '')),
                format('FILIAL %s', min(s.filial))
            ) as filial_nome,
            count(distinct s.id_vol)::integer as total_etiquetas
        from source_valid s
        left join app.db_rotas r
          on r.cd = v_cd
         and r.filial = s.filial
        group by s.filial
    ),
    pedido_seq_distinct as (
        select distinct
            s.filial,
            case
                when s.pedido is not null and s.sq is not null then format('%s/%s', s.pedido, s.sq)
                else s.id_vol
            end as pedido_seq
        from source_valid s
        where s.filial is not null
    ),
    pedido_seq as (
        select
            d.filial,
            string_agg(d.pedido_seq, ', ' order by d.pedido_seq) as pedidos_seq
        from pedido_seq_distinct d
        group by d.filial
    ),
    base_id_vol as (
        select distinct
            s.id_vol,
            s.filial
        from source_valid s
    ),
    conf_ranked as (
        select
            c.id_vol,
            c.status,
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat,
            c.started_at,
            c.finalized_at,
            c.updated_at,
            row_number() over (
                partition by c.id_vol
                order by c.updated_at desc nulls last, c.conf_date desc, c.started_at desc nulls last
            ) as rn
        from app.conf_pedido_direto c
        join base_id_vol b
          on b.id_vol = c.id_vol
        where c.cd = v_cd
          and c.status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')
    ),
    conf_latest as (
        select
            c.id_vol,
            c.status,
            c.colaborador_nome,
            c.colaborador_mat,
            c.started_at,
            c.finalized_at,
            c.updated_at
        from conf_ranked c
        where c.rn = 1
    ),
    conf as (
        select
            b.filial,
            count(*) filter (
                where c.status in ('finalizado_ok', 'finalizado_falta')
            )::integer as conferidas,
            count(*) filter (
                where c.status = 'em_conferencia'
            )::integer as em_andamento,
            bool_or(c.status = 'finalizado_falta') as tem_falta
        from base_id_vol b
        left join conf_latest c
          on c.id_vol = b.id_vol
        group by b.filial
    ),
    em_andamento_actor as (
        select distinct on (b.filial)
            b.filial,
            c.colaborador_nome,
            c.colaborador_mat,
            c.started_at
        from base_id_vol b
        join conf_latest c
          on c.id_vol = b.id_vol
        where c.status = 'em_conferencia'
        order by b.filial, c.updated_at desc nulls last, c.started_at desc nulls last
    ),
    concluido_actor as (
        select distinct on (b.filial)
            b.filial,
            c.colaborador_nome,
            c.colaborador_mat,
            c.finalized_at
        from base_id_vol b
        join conf_latest c
          on c.id_vol = b.id_vol
        where c.status in ('finalizado_ok', 'finalizado_falta')
        order by b.filial, c.finalized_at desc nulls last, c.updated_at desc nulls last
    )
    select
        b.rota,
        b.filial,
        b.filial_nome,
        p.pedidos_seq,
        b.total_etiquetas,
        coalesce(c.conferidas, 0)::integer as conferidas,
        greatest(b.total_etiquetas - coalesce(c.conferidas, 0), 0)::integer as pendentes,
        case
            when coalesce(c.em_andamento, 0) > 0 then 'em_andamento'
            when coalesce(c.conferidas, 0) > 0 then 'concluido'
            else 'pendente'
        end as status,
        coalesce(c.tem_falta, false) as tem_falta,
        case
            when coalesce(c.em_andamento, 0) > 0 then ea.colaborador_nome
            when coalesce(c.conferidas, 0) > 0 then ca.colaborador_nome
            else null
        end as colaborador_nome,
        case
            when coalesce(c.em_andamento, 0) > 0 then ea.colaborador_mat
            when coalesce(c.conferidas, 0) > 0 then ca.colaborador_mat
            else null
        end as colaborador_mat,
        case
            when coalesce(c.em_andamento, 0) > 0 then ea.started_at
            when coalesce(c.conferidas, 0) > 0 then ca.finalized_at
            else null
        end as status_at
    from base b
    left join pedido_seq p
      on p.filial = b.filial
    left join conf c
      on c.filial = b.filial
    left join em_andamento_actor ea
      on ea.filial = b.filial
    left join concluido_actor ca
      on ca.filial = b.filial
    order by b.rota, b.filial;
end;
$$;

drop function if exists public.rpc_conf_volume_avulso_manifest_volumes(integer);

create or replace function public.rpc_conf_volume_avulso_manifest_volumes(
    p_cd integer default null
)
returns table (
    nr_volume text,
    itens_total integer,
    qtd_esperada_total integer,
    status text,
    tem_falta boolean,
    colaborador_nome text,
    colaborador_mat text,
    status_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
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

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);

    return query
    with itens as (
        select
            nullif(trim(coalesce(t.nr_volume, '')), '') as nr_volume,
            t.coddv,
            greatest(sum(greatest(coalesce(t.qtd_mov, 0)::integer, 0))::integer, 1) as qtd_esperada_item
        from app.db_avulso t
        where t.cd = v_cd
          and nullif(trim(coalesce(t.nr_volume, '')), '') is not null
          and t.coddv is not null
        group by
            nullif(trim(coalesce(t.nr_volume, '')), ''),
            t.coddv
    ),
    volumes_base as (
        select distinct i.nr_volume
        from itens i
    ),
    status_conf_ranked as (
        select
            c.nr_volume,
            case
                when c.status in ('finalizado_ok', 'finalizado_falta') then 'concluido'
                when c.status = 'em_conferencia' then 'em_andamento'
                else 'pendente'
            end as status,
            (c.status = 'finalizado_falta') as tem_falta,
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat,
            case
                when c.status = 'em_conferencia' then c.started_at
                else c.finalized_at
            end as status_at,
            row_number() over (
                partition by c.nr_volume
                order by c.updated_at desc nulls last, c.conf_date desc, c.started_at desc nulls last
            ) as rn
        from app.conf_volume_avulso c
        join volumes_base v
          on v.nr_volume = c.nr_volume
        where c.cd = v_cd
          and c.status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')
    ),
    status_conf as (
        select
            s.nr_volume,
            s.status,
            s.tem_falta,
            s.colaborador_nome,
            s.colaborador_mat,
            s.status_at
        from status_conf_ranked s
        where s.rn = 1
    )
    select
        i.nr_volume,
        count(*)::integer as itens_total,
        coalesce(sum(i.qtd_esperada_item), 0)::integer as qtd_esperada_total,
        coalesce(s.status, 'pendente')::text as status,
        coalesce(s.tem_falta, false) as tem_falta,
        s.colaborador_nome,
        s.colaborador_mat,
        s.status_at
    from itens i
    left join status_conf s
      on s.nr_volume = i.nr_volume
    group by
        i.nr_volume,
        s.status,
        s.tem_falta,
        s.colaborador_nome,
        s.colaborador_mat,
        s.status_at
    order by i.nr_volume;
end;
$$;

create or replace function public.rpc_conf_devolucao_manifest_notas(
    p_cd integer default null
)
returns table (
    ref text,
    nfd bigint,
    chave text,
    motivo text,
    itens_total integer,
    qtd_esperada_total integer,
    status text,
    tem_falta boolean,
    colaborador_nome text,
    colaborador_mat text,
    status_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
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

    v_cd := app.conf_devolucao_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    return query
    with notas as (
        select
            coalesce(
                nullif(trim(coalesce(d.chave, '')), ''),
                d.nfd::text
            ) as ref,
            d.nfd,
            nullif(trim(coalesce(d.chave, '')), '') as chave,
            min(nullif(trim(coalesce(d.motivo, '')), '')) as motivo,
            count(distinct d.coddv)::integer as itens_total,
            coalesce(sum(greatest(coalesce(d.qtd_dev, 0)::integer, 0)), 0)::integer as qtd_esperada_total
        from app.db_devolucao d
        where d.cd = v_cd
          and d.coddv is not null
        group by
            coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text),
            d.nfd,
            nullif(trim(coalesce(d.chave, '')), '')
    ),
    conf as (
        select
            c.*,
            row_number() over (
                partition by c.cd, coalesce(c.chave, ''), coalesce(c.nfd, -1)
                order by c.updated_at desc nulls last, c.started_at desc nulls last
            ) as rn
        from app.conf_devolucao c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.conference_kind = 'com_nfd'
    )
    select
        n.ref,
        n.nfd,
        n.chave,
        n.motivo,
        n.itens_total,
        n.qtd_esperada_total,
        case
            when c.conf_id is null then 'pendente'
            when c.status = 'em_conferencia' then 'em_andamento'
            when c.status in ('finalizado_ok', 'finalizado_falta') then 'concluido'
            else 'pendente'
        end as status,
        coalesce(c.status = 'finalizado_falta', false) as tem_falta,
        nullif(trim(coalesce(c.started_nome, '')), '') as colaborador_nome,
        nullif(trim(coalesce(c.started_mat, '')), '') as colaborador_mat,
        case
            when c.status = 'em_conferencia' then c.started_at
            else c.finalized_at
        end as status_at
    from notas n
    left join conf c
      on c.rn = 1
     and coalesce(c.nfd, -1) = coalesce(n.nfd, -1)
     and coalesce(c.chave, '') = coalesce(n.chave, '')
    order by n.ref;
end;
$$;

create index if not exists idx_conf_pedido_direto_cd_id_vol_updated_at
    on app.conf_pedido_direto(cd, id_vol, updated_at desc, conf_date desc);

grant execute on function public.rpc_conf_pedido_direto_open_volume(text, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_route_overview(integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_manifest_volumes(integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_manifest_notas(integer) to authenticated;
