drop function if exists public.rpc_conf_entrada_notas_route_overview(integer);

create or replace function public.rpc_conf_entrada_notas_route_overview(p_cd integer default null)
returns table (
    transportadora text,
    fornecedor text,
    seq_entrada bigint,
    nf bigint,
    total_itens integer,
    itens_conferidos integer,
    itens_divergentes integer,
    valor_total numeric(18, 2),
    valor_conferido numeric(18, 2),
    status text,
    colaborador_nome text,
    colaborador_mat text,
    status_at timestamptz,
    produtos_multiplos_seq integer
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

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    return query
    with entrada_itens as (
        select
            t.seq_entrada,
            t.nf,
            coalesce(nullif(trim(t.transportadora), ''), 'SEM TRANSPORTADORA') as transportadora,
            coalesce(nullif(trim(t.forn), ''), 'SEM FORNECEDOR') as fornecedor,
            t.coddv,
            greatest(coalesce(max(t.vl_tt), 0), 0)::numeric(18, 2) as vl_tt
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada is not null
          and t.nf is not null
          and t.coddv is not null
        group by
            t.seq_entrada,
            t.nf,
            coalesce(nullif(trim(t.transportadora), ''), 'SEM TRANSPORTADORA'),
            coalesce(nullif(trim(t.forn), ''), 'SEM FORNECEDOR'),
            t.coddv
    ),
    coddv_seq_count as (
        select
            e.coddv,
            count(distinct format('%s|%s', e.seq_entrada, e.nf))::integer as seq_count
        from entrada_itens e
        group by e.coddv
    ),
    base as (
        select
            e.transportadora,
            e.fornecedor,
            e.seq_entrada,
            e.nf,
            count(*)::integer as total_itens,
            count(*) filter (where c.seq_count > 1)::integer as produtos_multiplos_seq,
            coalesce(sum(e.vl_tt), 0)::numeric(18, 2) as valor_total
        from entrada_itens e
        join coddv_seq_count c
          on c.coddv = e.coddv
        group by
            e.transportadora,
            e.fornecedor,
            e.seq_entrada,
            e.nf
    ),
    conf as (
        select
            c.seq_entrada,
            c.nf,
            c.status,
            nullif(trim(c.started_nome), '') as colaborador_nome,
            nullif(trim(c.started_mat), '') as colaborador_mat,
            c.started_at,
            c.finalized_at,
            (
                select count(*)::integer
                from app.conf_entrada_notas_itens i
                where i.conf_id = c.conf_id
                  and i.qtd_conferida > 0
            ) as itens_conferidos,
            (
                select count(*)::integer
                from app.conf_entrada_notas_itens i
                where i.conf_id = c.conf_id
                  and i.qtd_conferida <> i.qtd_esperada
            ) as itens_divergentes,
            (
                select coalesce(sum(
                    case
                        when coalesce(i.qtd_esperada, 0) <= 0 then 0::numeric
                        else (
                            least(
                                greatest(coalesce(i.qtd_conferida, 0)::numeric, 0::numeric),
                                greatest(coalesce(i.qtd_esperada, 0)::numeric, 0::numeric)
                            )
                            / nullif(greatest(coalesce(i.qtd_esperada, 0)::numeric, 0::numeric), 0::numeric)
                        ) * coalesce(ei.vl_tt, 0::numeric)
                    end
                ), 0::numeric)::numeric(18, 2)
                from app.conf_entrada_notas_itens i
                join entrada_itens ei
                  on ei.seq_entrada = c.seq_entrada
                 and ei.nf = c.nf
                 and ei.coddv = i.coddv
                where i.conf_id = c.conf_id
            ) as valor_conferido
        from app.conf_entrada_notas c
        where c.cd = v_cd
          and c.conf_date = v_today
    )
    select
        b.transportadora,
        b.fornecedor,
        b.seq_entrada,
        b.nf,
        b.total_itens,
        coalesce(c.itens_conferidos, 0)::integer as itens_conferidos,
        coalesce(c.itens_divergentes, 0)::integer as itens_divergentes,
        coalesce(b.valor_total, 0)::numeric(18, 2) as valor_total,
        least(coalesce(c.valor_conferido, 0), coalesce(b.valor_total, 0))::numeric(18, 2) as valor_conferido,
        case
            when c.status in ('finalizado_ok', 'finalizado_divergencia') then 'concluido'
            when c.status = 'em_conferencia' then 'em_andamento'
            else 'pendente'
        end as status,
        c.colaborador_nome,
        c.colaborador_mat,
        case
            when c.status in ('finalizado_ok', 'finalizado_divergencia') then c.finalized_at
            when c.status = 'em_conferencia' then c.started_at
            else null
        end as status_at,
        coalesce(b.produtos_multiplos_seq, 0)::integer as produtos_multiplos_seq
    from base b
    left join conf c
      on c.seq_entrada = b.seq_entrada
     and c.nf = b.nf
    order by b.transportadora, b.fornecedor, b.seq_entrada, b.nf;
end;
$$;

grant execute on function public.rpc_conf_entrada_notas_route_overview(integer) to authenticated;
