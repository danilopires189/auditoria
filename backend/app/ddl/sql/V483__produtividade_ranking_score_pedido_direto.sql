drop function if exists public.rpc_produtividade_ranking(integer, integer, integer);

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
    coleta_pontos numeric(18,3),
    coleta_qtd numeric(18,3),
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
    pedido_direto_pontos numeric(18,3),
    pedido_direto_qtd numeric(18,3),
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
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
    v_is_admin boolean;
    v_dt_ini date;
    v_dt_fim date;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.produtividade_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';
    v_mode := app.produtividade_visibility_mode(v_cd);

    if p_mes is not null and p_ano is not null then
        v_dt_ini := make_date(p_ano, p_mes, 1);
        v_dt_fim := (v_dt_ini + interval '1 month' - interval '1 day')::date;
    else
        v_dt_ini := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
        v_dt_fim := (v_dt_ini + interval '1 month' - interval '1 day')::date;
    end if;

    return query
    with base as materialized (
        select
            e.user_id,
            e.mat,
            e.nome,
            e.activity_key,
            e.metric_value
        from app.produtividade_events_base(v_cd, v_dt_ini, v_dt_fim) e
        where (
            v_is_admin
            or v_mode = 'public_cd'
            or e.user_id = v_uid
        )
          and e.activity_key in (
            'coleta_sku',
            'pvps_endereco',
            'prod_vol_mes',
            'prod_blitz_un',
            'zerados_endereco',
            'atividade_extra_pontos',
            'alocacao_endereco',
            'devolucao_nfd',
            'termo_sku',
            'avulso_sku',
            'pedido_direto_sku',
            'entrada_notas_sku',
            'transferencia_cd_sku',
            'registro_embarque_loja',
            'auditoria_caixa_volume',
            'caixa_termica_mov',
            'ronda_quality_auditoria',
            'checklist_auditoria'
          )
    ),
    por_atividade as materialized (
        select
            b.user_id,
            min(b.mat) as mat,
            min(b.nome) as nome,
            sum(case when b.activity_key = 'coleta_sku' then b.metric_value else 0 end)::numeric(18,3) as coleta_qtd,
            sum(case when b.activity_key = 'pvps_endereco' then b.metric_value else 0 end)::numeric(18,3) as pvps_qtd,
            sum(case when b.activity_key = 'prod_vol_mes' then b.metric_value else 0 end)::numeric(18,3) as vol_qtd,
            sum(case when b.activity_key = 'prod_blitz_un' then b.metric_value else 0 end)::numeric(18,3) as blitz_qtd,
            sum(case when b.activity_key = 'zerados_endereco' then b.metric_value else 0 end)::numeric(18,3) as zerados_qtd,
            count(*) filter (where b.activity_key = 'atividade_extra_pontos')::numeric(18,3) as atividade_extra_qtd,
            sum(case when b.activity_key = 'atividade_extra_pontos' then b.metric_value else 0 end)::numeric(18,3) as atividade_extra_pontos,
            sum(case when b.activity_key = 'alocacao_endereco' then b.metric_value else 0 end)::numeric(18,3) as alocacao_qtd,
            sum(case when b.activity_key = 'devolucao_nfd' then b.metric_value else 0 end)::numeric(18,3) as devolucao_qtd,
            sum(case when b.activity_key = 'termo_sku' then b.metric_value else 0 end)::numeric(18,3) as conf_termo_qtd,
            sum(case when b.activity_key = 'avulso_sku' then b.metric_value else 0 end)::numeric(18,3) as conf_avulso_qtd,
            sum(case when b.activity_key = 'pedido_direto_sku' then b.metric_value else 0 end)::numeric(18,3) as pedido_direto_qtd,
            sum(case when b.activity_key = 'entrada_notas_sku' then b.metric_value else 0 end)::numeric(18,3) as conf_entrada_qtd,
            sum(case when b.activity_key = 'transferencia_cd_sku' then b.metric_value else 0 end)::numeric(18,3) as conf_transferencia_cd_qtd,
            sum(case when b.activity_key = 'registro_embarque_loja' then b.metric_value else 0 end)::numeric(18,3) as conf_lojas_qtd,
            sum(case when b.activity_key = 'auditoria_caixa_volume' then b.metric_value else 0 end)::numeric(18,3) as aud_caixa_qtd,
            count(*) filter (where b.activity_key = 'caixa_termica_mov')::numeric(18,3) as caixa_termica_qtd,
            sum(case when b.activity_key = 'ronda_quality_auditoria' then b.metric_value else 0 end)::numeric(18,3) as ronda_quality_qtd,
            sum(case when b.activity_key = 'checklist_auditoria' then b.metric_value else 0 end)::numeric(18,3) as checklist_qtd
        from base b
        group by b.user_id
    ),
    ranks as materialized (
        select
            a.*,
            dense_rank() over (order by a.pvps_qtd desc) as pvps_rank,
            dense_rank() over (order by a.vol_qtd desc) as vol_rank,
            dense_rank() over (order by a.blitz_qtd desc) as blitz_rank,
            dense_rank() over (order by a.zerados_qtd desc) as zerados_rank,
            dense_rank() over (order by a.alocacao_qtd desc) as alocacao_rank,
            dense_rank() over (order by a.devolucao_qtd desc) as devolucao_rank,
            dense_rank() over (order by a.conf_termo_qtd desc) as conf_termo_rank,
            dense_rank() over (order by a.conf_avulso_qtd desc) as conf_avulso_rank,
            dense_rank() over (order by a.pedido_direto_qtd desc) as pedido_direto_rank,
            dense_rank() over (order by a.conf_entrada_qtd desc) as conf_entrada_rank,
            dense_rank() over (order by a.conf_transferencia_cd_qtd desc) as conf_transferencia_cd_rank,
            dense_rank() over (order by a.conf_lojas_qtd desc) as conf_lojas_rank,
            dense_rank() over (order by a.aud_caixa_qtd desc) as aud_caixa_rank,
            dense_rank() over (order by a.caixa_termica_qtd desc) as caixa_termica_rank,
            dense_rank() over (order by a.ronda_quality_qtd desc) as ronda_quality_rank,
            dense_rank() over (order by a.checklist_qtd desc) as checklist_rank
        from por_atividade a
    ),
    pontuado as (
        select
            r.user_id,
            r.mat,
            r.nome,
            0::numeric(18,3) as coleta_pontos,
            round(r.coleta_qtd, 3)::numeric(18,3) as coleta_qtd,
            round(case when r.pvps_qtd > 0 then greatest(0.5, 3.5 - (r.pvps_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as pvps_pontos,
            round(r.pvps_qtd, 3)::numeric(18,3) as pvps_qtd,
            round(case when r.vol_qtd > 0 then greatest(0.5, 10.0 - (r.vol_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as vol_pontos,
            round(r.vol_qtd, 3)::numeric(18,3) as vol_qtd,
            round(case when r.blitz_qtd > 0 then greatest(0.5, 10.0 - (r.blitz_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as blitz_pontos,
            round(r.blitz_qtd, 3)::numeric(18,3) as blitz_qtd,
            round(case when r.zerados_qtd > 0 then greatest(0.5, 3.5 - (r.zerados_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as zerados_pontos,
            round(r.zerados_qtd, 3)::numeric(18,3) as zerados_qtd,
            round(r.atividade_extra_pontos, 3)::numeric(18,3) as atividade_extra_pontos,
            round(r.atividade_extra_qtd, 3)::numeric(18,3) as atividade_extra_qtd,
            round(case when r.alocacao_qtd > 0 then greatest(0.5, 3.5 - (r.alocacao_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as alocacao_pontos,
            round(r.alocacao_qtd, 3)::numeric(18,3) as alocacao_qtd,
            round(case when r.devolucao_qtd > 0 then greatest(0.5, 3.5 - (r.devolucao_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as devolucao_pontos,
            round(r.devolucao_qtd, 3)::numeric(18,3) as devolucao_qtd,
            round(case when r.conf_termo_qtd > 0 then greatest(0.5, 3.5 - (r.conf_termo_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as conf_termo_pontos,
            round(r.conf_termo_qtd, 3)::numeric(18,3) as conf_termo_qtd,
            round(case when r.conf_avulso_qtd > 0 then greatest(0.5, 3.5 - (r.conf_avulso_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as conf_avulso_pontos,
            round(r.conf_avulso_qtd, 3)::numeric(18,3) as conf_avulso_qtd,
            round(case when r.pedido_direto_qtd > 0 then greatest(0.5, 3.5 - (r.pedido_direto_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as pedido_direto_pontos,
            round(r.pedido_direto_qtd, 3)::numeric(18,3) as pedido_direto_qtd,
            round(case when r.conf_entrada_qtd > 0 then greatest(0.5, 3.5 - (r.conf_entrada_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as conf_entrada_pontos,
            round(r.conf_entrada_qtd, 3)::numeric(18,3) as conf_entrada_qtd,
            round(case when r.conf_transferencia_cd_qtd > 0 then greatest(0.5, 3.5 - (r.conf_transferencia_cd_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as conf_transferencia_cd_pontos,
            round(r.conf_transferencia_cd_qtd, 3)::numeric(18,3) as conf_transferencia_cd_qtd,
            round(case when r.conf_lojas_qtd > 0 then greatest(0.5, 3.5 - (r.conf_lojas_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as conf_lojas_pontos,
            round(r.conf_lojas_qtd, 3)::numeric(18,3) as conf_lojas_qtd,
            round(case when r.aud_caixa_qtd > 0 then greatest(0.5, 3.5 - (r.aud_caixa_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as aud_caixa_pontos,
            round(r.aud_caixa_qtd, 3)::numeric(18,3) as aud_caixa_qtd,
            round(case when r.caixa_termica_qtd > 0 then greatest(0.5, 3.5 - (r.caixa_termica_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as caixa_termica_pontos,
            round(r.caixa_termica_qtd, 3)::numeric(18,3) as caixa_termica_qtd,
            round(case when r.ronda_quality_qtd > 0 then greatest(0.5, 3.5 - (r.ronda_quality_rank - 1) * 0.5) else 0 end, 3)::numeric(18,3) as ronda_quality_pontos,
            round(r.ronda_quality_qtd, 3)::numeric(18,3) as ronda_quality_qtd,
            round(case when r.checklist_qtd > 0 then greatest(0.2, 2.0 - (r.checklist_rank - 1) * 0.2) else 0 end, 3)::numeric(18,3) as checklist_pontos,
            round(r.checklist_qtd, 3)::numeric(18,3) as checklist_qtd
        from ranks r
    ),
    ranking as (
        select
            p.*,
            round(
                p.pvps_pontos +
                p.vol_pontos +
                p.blitz_pontos +
                p.zerados_pontos +
                p.atividade_extra_pontos +
                p.alocacao_pontos +
                p.devolucao_pontos +
                p.conf_termo_pontos +
                p.conf_avulso_pontos +
                p.pedido_direto_pontos +
                p.conf_entrada_pontos +
                p.conf_transferencia_cd_pontos +
                p.conf_lojas_pontos +
                p.aud_caixa_pontos +
                p.caixa_termica_pontos +
                p.ronda_quality_pontos +
                p.checklist_pontos,
                3
            )::numeric(18,3) as total_pontos
        from pontuado p
    )
    select
        r.user_id,
        r.mat,
        r.nome,
        dense_rank() over (order by r.total_pontos desc)::integer as posicao,
        r.coleta_pontos,
        r.coleta_qtd,
        r.pvps_pontos,
        r.pvps_qtd,
        r.vol_pontos,
        r.vol_qtd,
        r.blitz_pontos,
        r.blitz_qtd,
        r.zerados_pontos,
        r.zerados_qtd,
        r.atividade_extra_pontos,
        r.atividade_extra_qtd,
        r.alocacao_pontos,
        r.alocacao_qtd,
        r.devolucao_pontos,
        r.devolucao_qtd,
        r.conf_termo_pontos,
        r.conf_termo_qtd,
        r.conf_avulso_pontos,
        r.conf_avulso_qtd,
        r.pedido_direto_pontos,
        r.pedido_direto_qtd,
        r.conf_entrada_pontos,
        r.conf_entrada_qtd,
        r.conf_transferencia_cd_pontos,
        r.conf_transferencia_cd_qtd,
        r.conf_lojas_pontos,
        r.conf_lojas_qtd,
        r.aud_caixa_pontos,
        r.aud_caixa_qtd,
        r.caixa_termica_pontos,
        r.caixa_termica_qtd,
        r.ronda_quality_pontos,
        r.ronda_quality_qtd,
        r.checklist_pontos,
        r.checklist_qtd,
        r.total_pontos
    from ranking r
    order by r.total_pontos desc, r.nome asc;
end;
$$;

grant execute on function public.rpc_produtividade_ranking(integer, integer, integer) to authenticated;

notify pgrst, 'reload schema';
