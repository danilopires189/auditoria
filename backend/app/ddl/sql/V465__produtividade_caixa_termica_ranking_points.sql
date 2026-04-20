do $$
begin
    if to_regprocedure('public.rpc_produtividade_ranking_legacy_v465(integer,integer,integer)') is null then
        alter function public.rpc_produtividade_ranking(integer, integer, integer)
        rename to rpc_produtividade_ranking_legacy_v465;
    end if;
end;
$$;

create or replace function public.rpc_produtividade_ranking(
    p_cd integer default null,
    p_mes integer default null,
    p_ano integer default null
)
returns table (
    user_id uuid,
    mat text,
    nome text,
    posicao integer,
    pvps_pontos numeric(18,3),
    pvps_qtd numeric(18,3),
    vol_pontos numeric(18,3),
    vol_qtd numeric(18,3),
    blitz_pontos numeric(18,3),
    blitz_qtd numeric(18,3),
    zerados_pontos numeric(18,3),
    zerados_qtd numeric(18,3),
    atividade_extra_pontos numeric(18,3),
    atividade_extra_qtd numeric(18,3),
    alocacao_pontos numeric(18,3),
    alocacao_qtd numeric(18,3),
    devolucao_pontos numeric(18,3),
    devolucao_qtd numeric(18,3),
    conf_termo_pontos numeric(18,3),
    conf_termo_qtd numeric(18,3),
    conf_avulso_pontos numeric(18,3),
    conf_avulso_qtd numeric(18,3),
    conf_entrada_pontos numeric(18,3),
    conf_entrada_qtd numeric(18,3),
    conf_transferencia_cd_pontos numeric(18,3),
    conf_transferencia_cd_qtd numeric(18,3),
    conf_lojas_pontos numeric(18,3),
    conf_lojas_qtd numeric(18,3),
    aud_caixa_pontos numeric(18,3),
    aud_caixa_qtd numeric(18,3),
    caixa_termica_pontos numeric(18,3),
    caixa_termica_qtd numeric(18,3),
    ronda_quality_pontos numeric(18,3),
    ronda_quality_qtd numeric(18,3),
    checklist_pontos numeric(18,3),
    checklist_qtd numeric(18,3),
    total_pontos numeric(18,3)
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $function$
    with base as (
        select *
        from public.rpc_produtividade_ranking_legacy_v465(p_cd, p_mes, p_ano)
    ),
    ranks_caixa_termica as (
        select
            b.user_id,
            dense_rank() over (order by b.caixa_termica_qtd desc)::integer as pos
        from base b
        where coalesce(b.caixa_termica_qtd, 0) > 0
    ),
    ajustado as (
        select
            b.user_id,
            b.mat,
            b.nome,
            b.pvps_pontos,
            b.pvps_qtd,
            b.vol_pontos,
            b.vol_qtd,
            b.blitz_pontos,
            b.blitz_qtd,
            b.zerados_pontos,
            b.zerados_qtd,
            b.atividade_extra_pontos,
            b.atividade_extra_qtd,
            b.alocacao_pontos,
            b.alocacao_qtd,
            b.devolucao_pontos,
            b.devolucao_qtd,
            b.conf_termo_pontos,
            b.conf_termo_qtd,
            b.conf_avulso_pontos,
            b.conf_avulso_qtd,
            b.conf_entrada_pontos,
            b.conf_entrada_qtd,
            b.conf_transferencia_cd_pontos,
            b.conf_transferencia_cd_qtd,
            b.conf_lojas_pontos,
            b.conf_lojas_qtd,
            b.aud_caixa_pontos,
            b.aud_caixa_qtd,
            round(
                coalesce(
                    (
                        select greatest(0.5, 3.5 - ((rct.pos - 1) * 0.5))
                        from ranks_caixa_termica rct
                        where rct.user_id = b.user_id
                    ),
                    0
                ),
                3
            )::numeric(18,3) as caixa_termica_pontos,
            b.caixa_termica_qtd,
            b.ronda_quality_pontos,
            b.ronda_quality_qtd,
            b.checklist_pontos,
            b.checklist_qtd,
            round(
                b.total_pontos
                - coalesce(b.caixa_termica_pontos, 0)
                + coalesce(
                    (
                        select greatest(0.5, 3.5 - ((rct.pos - 1) * 0.5))
                        from ranks_caixa_termica rct
                        where rct.user_id = b.user_id
                    ),
                    0
                ),
                3
            )::numeric(18,3) as total_pontos
        from base b
    ),
    ranking_final as (
        select
            a.user_id,
            a.mat,
            a.nome,
            dense_rank() over(order by a.total_pontos desc)::integer as posicao,
            a.pvps_pontos,
            a.pvps_qtd,
            a.vol_pontos,
            a.vol_qtd,
            a.blitz_pontos,
            a.blitz_qtd,
            a.zerados_pontos,
            a.zerados_qtd,
            a.atividade_extra_pontos,
            a.atividade_extra_qtd,
            a.alocacao_pontos,
            a.alocacao_qtd,
            a.devolucao_pontos,
            a.devolucao_qtd,
            a.conf_termo_pontos,
            a.conf_termo_qtd,
            a.conf_avulso_pontos,
            a.conf_avulso_qtd,
            a.conf_entrada_pontos,
            a.conf_entrada_qtd,
            a.conf_transferencia_cd_pontos,
            a.conf_transferencia_cd_qtd,
            a.conf_lojas_pontos,
            a.conf_lojas_qtd,
            a.aud_caixa_pontos,
            a.aud_caixa_qtd,
            a.caixa_termica_pontos,
            a.caixa_termica_qtd,
            a.ronda_quality_pontos,
            a.ronda_quality_qtd,
            a.checklist_pontos,
            a.checklist_qtd,
            a.total_pontos
        from ajustado a
    )
    select
        rf.user_id,
        rf.mat,
        rf.nome,
        rf.posicao,
        rf.pvps_pontos,
        rf.pvps_qtd,
        rf.vol_pontos,
        rf.vol_qtd,
        rf.blitz_pontos,
        rf.blitz_qtd,
        rf.zerados_pontos,
        rf.zerados_qtd,
        rf.atividade_extra_pontos,
        rf.atividade_extra_qtd,
        rf.alocacao_pontos,
        rf.alocacao_qtd,
        rf.devolucao_pontos,
        rf.devolucao_qtd,
        rf.conf_termo_pontos,
        rf.conf_termo_qtd,
        rf.conf_avulso_pontos,
        rf.conf_avulso_qtd,
        rf.conf_entrada_pontos,
        rf.conf_entrada_qtd,
        rf.conf_transferencia_cd_pontos,
        rf.conf_transferencia_cd_qtd,
        rf.conf_lojas_pontos,
        rf.conf_lojas_qtd,
        rf.aud_caixa_pontos,
        rf.aud_caixa_qtd,
        rf.caixa_termica_pontos,
        rf.caixa_termica_qtd,
        rf.ronda_quality_pontos,
        rf.ronda_quality_qtd,
        rf.checklist_pontos,
        rf.checklist_qtd,
        rf.total_pontos
    from ranking_final rf
    order by rf.total_pontos desc, rf.nome asc;
$function$;

grant execute on function public.rpc_produtividade_ranking(integer, integer, integer) to authenticated;

notify pgrst, 'reload schema';
