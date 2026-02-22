drop function if exists public.rpc_conf_devolucao_route_overview(integer);

create or replace function public.rpc_conf_devolucao_route_overview(
    p_cd integer default null
)
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
    with base as (
        select
            count(distinct coalesce(
                nullif(trim(coalesce(d.chave, '')), ''),
                d.nfd::text
            ))::integer as total_etiquetas
        from app.db_devolucao d
        where d.cd = v_cd
          and d.coddv is not null
          and coalesce(
                nullif(trim(coalesce(d.chave, '')), ''),
                d.nfd::text
              ) is not null
    ),
    conf as (
        select
            count(distinct coalesce(
                nullif(trim(coalesce(c.chave, '')), ''),
                c.nfd::text
            )) filter (
                where c.status in ('finalizado_ok', 'finalizado_falta')
            )::integer as conferidas,
            count(distinct coalesce(
                nullif(trim(coalesce(c.chave, '')), ''),
                c.nfd::text
            )) filter (
                where c.status = 'em_conferencia'
            )::integer as em_andamento,
            bool_or(c.status = 'finalizado_falta') as tem_falta
        from app.conf_devolucao c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.conference_kind = 'com_nfd'
    ),
    em_andamento_actor as (
        select
            nullif(trim(coalesce(c.started_nome, '')), '') as colaborador_nome,
            nullif(trim(coalesce(c.started_mat, '')), '') as colaborador_mat,
            c.started_at
        from app.conf_devolucao c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.conference_kind = 'com_nfd'
          and c.status = 'em_conferencia'
        order by c.updated_at desc nulls last, c.started_at desc nulls last
        limit 1
    ),
    concluido_actor as (
        select
            nullif(trim(coalesce(c.started_nome, '')), '') as colaborador_nome,
            nullif(trim(coalesce(c.started_mat, '')), '') as colaborador_mat,
            c.finalized_at
        from app.conf_devolucao c
        where c.cd = v_cd
          and c.conf_date = v_today
          and c.conference_kind = 'com_nfd'
          and c.status in ('finalizado_ok', 'finalizado_falta')
        order by c.finalized_at desc nulls last, c.updated_at desc nulls last
        limit 1
    )
    select
        'SEM ROTA'::text as rota,
        null::bigint as filial,
        'DEVOLUCAO'::text as filial_nome,
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

grant execute on function public.rpc_conf_devolucao_route_overview(integer) to authenticated;
