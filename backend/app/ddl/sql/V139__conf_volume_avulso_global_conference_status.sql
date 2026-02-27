drop function if exists public.rpc_conf_volume_avulso_manifest_volumes(integer);

create or replace function public.rpc_conf_volume_avulso_manifest_volumes(
    p_cd integer default null
)
returns table (
    nr_volume text,
    itens_total integer,
    qtd_esperada_total integer,
    status text,
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
        s.colaborador_nome,
        s.colaborador_mat,
        s.status_at
    from itens i
    left join status_conf s
      on s.nr_volume = i.nr_volume
    group by
        i.nr_volume,
        s.status,
        s.colaborador_nome,
        s.colaborador_mat,
        s.status_at
    order by i.nr_volume;
end;
$$;

drop function if exists public.rpc_conf_volume_avulso_route_overview(integer);

create or replace function public.rpc_conf_volume_avulso_route_overview(p_cd integer default null)
returns table (
    rota text,
    filial bigint,
    filial_nome text,
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

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);

    return query
    with base_volumes as (
        select distinct
            nullif(trim(coalesce(t.nr_volume, '')), '') as nr_volume
        from app.db_avulso t
        where t.cd = v_cd
          and nullif(trim(coalesce(t.nr_volume, '')), '') is not null
    ),
    base as (
        select
            count(*)::integer as total_etiquetas
        from base_volumes b
    ),
    conf_ranked as (
        select
            c.nr_volume,
            c.status,
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat,
            c.started_at,
            c.finalized_at,
            c.updated_at,
            row_number() over (
                partition by c.nr_volume
                order by c.updated_at desc nulls last, c.conf_date desc, c.started_at desc nulls last
            ) as rn
        from app.conf_volume_avulso c
        join base_volumes b
          on b.nr_volume = c.nr_volume
        where c.cd = v_cd
          and c.status in ('em_conferencia', 'finalizado_ok', 'finalizado_falta')
    ),
    conf_latest as (
        select
            c.nr_volume,
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
            count(*) filter (
                where c.status in ('finalizado_ok', 'finalizado_falta')
            )::integer as conferidas,
            count(*) filter (
                where c.status = 'em_conferencia'
            )::integer as em_andamento,
            bool_or(c.status = 'finalizado_falta') as tem_falta
        from conf_latest c
    ),
    em_andamento_actor as (
        select
            c.colaborador_nome,
            c.colaborador_mat,
            c.started_at
        from conf_latest c
        where c.status = 'em_conferencia'
        order by c.updated_at desc nulls last, c.started_at desc nulls last
        limit 1
    ),
    concluido_actor as (
        select
            c.colaborador_nome,
            c.colaborador_mat,
            c.finalized_at
        from conf_latest c
        where c.status in ('finalizado_ok', 'finalizado_falta')
        order by c.finalized_at desc nulls last, c.updated_at desc nulls last
        limit 1
    )
    select
        'SEM ROTA'::text as rota,
        null::bigint as filial,
        'SEM FILIAL'::text as filial_nome,
        coalesce(b.total_etiquetas, 0)::integer as total_etiquetas,
        coalesce(c.conferidas, 0)::integer as conferidas,
        greatest(coalesce(b.total_etiquetas, 0) - coalesce(c.conferidas, 0), 0)::integer as pendentes,
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
    cross join conf c
    left join em_andamento_actor ea
      on true
    left join concluido_actor ca
      on true;
end;
$$;

create index if not exists idx_conf_volume_avulso_cd_nr_volume_updated_at
    on app.conf_volume_avulso(cd, nr_volume, updated_at desc, conf_date desc);

grant execute on function public.rpc_conf_volume_avulso_manifest_volumes(integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_route_overview(integer) to authenticated;
