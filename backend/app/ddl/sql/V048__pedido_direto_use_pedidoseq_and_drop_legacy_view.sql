alter table staging.db_pedido_direto
    add column if not exists pedidoseq text;

alter table app.db_pedido_direto
    add column if not exists pedidoseq text;

create or replace function app.conf_pedido_direto_source_id_vol(
    p_pedidoseq text,
    p_pedido bigint,
    p_sq bigint
)
returns text
language plpgsql
immutable
as $$
declare
    v_seq text;
begin
    v_seq := nullif(regexp_replace(coalesce(p_pedidoseq, ''), '\s+', '', 'g'), '');

    if v_seq is not null then
        if v_seq ~ '^[0-9]+$' then
            v_seq := ltrim(v_seq, '0');
            if v_seq = '' then
                v_seq := '0';
            end if;
        end if;
        return v_seq;
    end if;

    if p_pedido is not null and p_sq is not null then
        return p_pedido::text || p_sq::text;
    end if;

    return null;
end;
$$;

update app.db_pedido_direto t
set pedidoseq = app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq)
where t.pedidoseq is distinct from app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq);

create index if not exists idx_app_db_pedido_direto_cd_pedidoseq
    on app.db_pedido_direto(cd, pedidoseq);

update app.conf_pedido_direto c
set id_vol = src.id_vol
from (
    select
        t.cd,
        t.pedido,
        t.sq,
        app.conf_pedido_direto_source_id_vol(max(t.pedidoseq), t.pedido, t.sq) as id_vol
    from app.db_pedido_direto t
    group by t.cd, t.pedido, t.sq
) src
where c.cd = src.cd
  and c.pedido is not distinct from src.pedido
  and c.sq is not distinct from src.sq
  and src.id_vol is not null
  and c.id_vol is distinct from src.id_vol;

update app.conf_pedido_direto_itens i
set id_vol = c.id_vol
from app.conf_pedido_direto c
where c.conf_id = i.conf_id
  and i.id_vol is distinct from c.id_vol;

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
    v_volumes bigint;
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

    with source as (
        select
            app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq) as id_vol,
            t.source_run_id,
            t.updated_at
        from app.db_pedido_direto t
        where t.cd = v_cd
    )
    select
        count(*)::bigint,
        count(distinct s.id_vol)::bigint,
        max(s.source_run_id),
        max(s.updated_at)
    into
        v_row_count,
        v_volumes,
        v_source_run_id,
        v_updated_at
    from source s
    where nullif(trim(coalesce(s.id_vol, '')), '') is not null;

    if coalesce(v_row_count, 0) = 0 then
        raise exception 'BASE_PEDIDO_DIRETO_VAZIA';
    end if;

    return query
    select
        v_cd,
        v_row_count,
        v_volumes,
        v_source_run_id,
        md5(
            concat_ws(
                ':',
                coalesce(v_source_run_id::text, ''),
                v_row_count::text,
                v_volumes::text,
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
    manifest as (
        select
            s.id_vol,
            min(nullif(trim(s.caixa), '')) as caixa,
            min(s.pedido) as pedido,
            min(s.filial) as filial,
            coalesce(
                min(nullif(trim(r.nome), '')),
                format('FILIAL %s', min(s.filial))
            ) as filial_nome,
            coalesce(
                min(nullif(trim(r.rota), '')),
                min(nullif(trim(s.num_rota), '')),
                'SEM ROTA'
            ) as rota,
            s.coddv,
            coalesce(
                min(nullif(trim(s.descricao), '')),
                format('CODDV %s', s.coddv)
            ) as descricao,
            sum(greatest(coalesce(s.qtd_separada, 0)::integer, 0))::integer as qtd_esperada
        from source s
        left join app.db_rotas r
          on r.cd = v_cd
         and r.filial = s.filial
        where nullif(trim(coalesce(s.id_vol, '')), '') is not null
        group by s.id_vol, s.coddv
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
    with source as (
        select
            app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq) as id_vol,
            t.coddv
        from app.db_pedido_direto t
        where t.cd = v_cd
    ),
    needed as (
        select distinct s.coddv
        from source s
        where nullif(trim(coalesce(s.id_vol, '')), '') is not null
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
        from source s
        left join app.db_rotas r
          on r.cd = v_cd
         and r.filial = s.filial
        where nullif(trim(coalesce(s.id_vol, '')), '') is not null
        group by s.filial
    ),
    pedido_seq_distinct as (
        select distinct
            s.filial,
            case
                when s.pedido is not null and s.sq is not null then format('%s/%s', s.pedido, s.sq)
                else s.id_vol
            end as pedido_seq
        from source s
        where s.filial is not null
          and nullif(trim(coalesce(s.id_vol, '')), '') is not null
    ),
    pedido_seq as (
        select
            d.filial,
            string_agg(d.pedido_seq, ', ' order by d.pedido_seq) as pedidos_seq
        from pedido_seq_distinct d
        group by d.filial
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
        p.pedidos_seq,
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

drop view if exists app.db_pedido_direto_conf;

grant execute on function public.rpc_conf_pedido_direto_manifest_meta(integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_manifest_items_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_manifest_barras_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_open_volume(text, integer) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_route_overview(integer) to authenticated;
