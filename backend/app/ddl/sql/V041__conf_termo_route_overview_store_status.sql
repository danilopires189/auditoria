drop function if exists public.rpc_conf_termo_route_overview(integer);

create or replace function public.rpc_conf_termo_route_overview(p_cd integer default null)
returns table (
    rota text,
    filial bigint,
    filial_nome text,
    total_etiquetas integer,
    conferidas integer,
    pendentes integer,
    status text,
    colaborador_nome text,
    colaborador_mat text
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

    v_cd := app.conf_termo_resolve_cd(p_cd);
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
            count(distinct t.id_etiqueta)::integer as total_etiquetas
        from app.db_termo t
        left join app.db_rotas r
          on r.cd = t.cd
         and r.filial = t.filial
        where t.cd = v_cd
          and nullif(trim(coalesce(t.id_etiqueta, '')), '') is not null
        group by t.filial
    ),
    conf as (
        select
            c.filial,
            count(distinct c.id_etiqueta) filter (
                where c.status in ('finalizado_ok', 'finalizado_falta')
            )::integer as conferidas,
            count(distinct c.id_etiqueta) filter (
                where c.status = 'em_conferencia'
            )::integer as em_andamento
        from app.conf_termo c
        where c.cd = v_cd
          and c.conf_date = v_today
        group by c.filial
    ),
    em_andamento_actor as (
        select distinct on (c.filial)
            c.filial,
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat
        from app.conf_termo c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.status = 'em_conferencia'
        order by c.filial, c.updated_at desc nulls last, c.started_at desc nulls last
    ),
    concluido_actor as (
        select distinct on (c.filial)
            c.filial,
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat
        from app.conf_termo c
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
        end as colaborador_mat
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

grant execute on function public.rpc_conf_termo_route_overview(integer) to authenticated;
