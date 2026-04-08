drop function if exists public.rpc_gestao_estoque_em_recebimento_list(integer);

create function public.rpc_gestao_estoque_em_recebimento_list(
    p_cd integer default null
)
returns table (
    coddv integer,
    descricao text,
    qtd_cx integer,
    qtd_total integer,
    seq_entrada bigint,
    transportadora text,
    dh_consistida timestamptz,
    dh_liberacao timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_source_run_id uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);

    select t.source_run_id
    into v_source_run_id
    from app.db_entrada_notas t
    where t.cd = v_cd
      and t.coddv is not null
      and t.dh_consistida is not null
      and t.source_run_id is not null
    order by t.updated_at desc nulls last
    limit 1;

    return query
    select
        t.coddv,
        coalesce(nullif(trim(coalesce(t.descricao, '')), ''), format('CODDV %s', coalesce(t.coddv::text, 'sem código'))) as descricao,
        greatest(coalesce(t.qtd_cx, 0), 0)::integer as qtd_cx,
        greatest(coalesce(t.qtd_total, 0), 0)::integer as qtd_total,
        t.seq_entrada,
        coalesce(nullif(trim(coalesce(t.transportadora, '')), ''), 'SEM TRANSPORTADORA') as transportadora,
        t.dh_consistida,
        t.dh_liberacao
    from app.db_entrada_notas t
    where t.cd = v_cd
      and t.coddv is not null
      and t.dh_consistida is not null
      and (v_source_run_id is null or t.source_run_id = v_source_run_id)
    order by t.dh_consistida desc, t.seq_entrada desc nulls last, t.coddv;
end;
$$;

grant execute on function public.rpc_gestao_estoque_em_recebimento_list(integer) to authenticated;
