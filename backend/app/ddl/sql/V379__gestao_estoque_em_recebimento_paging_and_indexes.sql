create index if not exists idx_app_db_entrada_notas_cd_recebimento_latest
    on app.db_entrada_notas(cd, updated_at desc)
    where dh_consistida is not null
      and source_run_id is not null;

create index if not exists idx_app_db_entrada_notas_cd_source_run_recebimento
    on app.db_entrada_notas(cd, source_run_id, dh_consistida desc, seq_entrada desc, coddv)
    where dh_consistida is not null;

drop function if exists public.rpc_gestao_estoque_em_recebimento_list(integer);
drop function if exists public.rpc_gestao_estoque_em_recebimento_list(integer, integer, integer);

create function public.rpc_gestao_estoque_em_recebimento_list(
    p_cd integer default null,
    p_offset integer default 0,
    p_limit integer default 1000
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
    v_offset integer;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 1000);

    return query
    with latest_run as (
        select t.source_run_id
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.coddv is not null
          and t.dh_consistida is not null
          and t.source_run_id is not null
        order by t.updated_at desc nulls last
        limit 1
    )
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
    left join latest_run lr
      on true
    where t.cd = v_cd
      and t.coddv is not null
      and t.dh_consistida is not null
      and (lr.source_run_id is null or t.source_run_id = lr.source_run_id)
    order by t.dh_consistida desc, t.seq_entrada desc nulls last, t.coddv
    offset v_offset
    limit v_limit;
end;
$$;

grant execute on function public.rpc_gestao_estoque_em_recebimento_list(integer, integer, integer) to authenticated;
