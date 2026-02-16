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
            )::integer as em_andamento,
            bool_or(c.status = 'finalizado_falta') as tem_falta
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

grant execute on function public.rpc_conf_pedido_direto_route_overview(integer) to authenticated;
