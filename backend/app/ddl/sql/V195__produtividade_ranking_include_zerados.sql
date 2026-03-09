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
    pvps_pontos numeric(18,3),
    vol_pontos numeric(18,3),
    blitz_pontos numeric(18,3),
    zerados_qtd numeric(18,3),
    zerados_pontos numeric(18,3),
    alocacao_qtd numeric(18,3),
    devolucao_qtd numeric(18,3),
    conf_termo_qtd numeric(18,3),
    conf_avulso_qtd numeric(18,3),
    conf_entrada_qtd numeric(18,3),
    conf_lojas_qtd numeric(18,3),
    atividade_extra_pontos numeric(18,3),
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
    with basica as (
        select *
        from app.produtividade_events_base(v_cd, v_dt_ini, v_dt_fim)
    ),
    usuarios_metricas as (
        select
            b.user_id,
            min(b.mat) as mat,
            min(b.nome) as nome,
            b.activity_key,
            sum(b.metric_value) as total_val
        from basica b
        group by b.user_id, b.activity_key
    ),
    ranks_pvps as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'pvps_endereco'
    ),
    ranks_alocacao as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'alocacao_endereco'
    ),
    ranks_zerados as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'zerados_endereco'
    ),
    ranks_vol as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'prod_vol_mes'
    ),
    ranks_blitz as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'prod_blitz_un'
    ),
    ranks_devolucao as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'devolucao_nfd'
    ),
    ranks_termo as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'termo_sku'
    ),
    ranks_avulso as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'avulso_sku'
    ),
    ranks_entrada as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'entrada_notas_sku'
    ),
    ranks_lojas as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'registro_embarque_loja'
    ),
    usuarios_unicos as (
        select distinct
            um.user_id,
            um.mat,
            um.nome
        from usuarios_metricas um
    ),
    componentes as (
        select
            u.user_id,
            u.mat,
            u.nome,
            round(coalesce((select greatest(0.5, 3.5 - (rp.pos - 1) * 0.5) from ranks_pvps rp where rp.user_id = u.user_id), 0), 3)::numeric(18,3) as pvps_pontos,
            round(coalesce((select greatest(0.5, 10.0 - (rv.pos - 1) * 0.5) from ranks_vol rv where rv.user_id = u.user_id), 0), 3)::numeric(18,3) as vol_pontos,
            round(coalesce((select greatest(0.5, 10.0 - (rb.pos - 1) * 0.5) from ranks_blitz rb where rb.user_id = u.user_id), 0), 3)::numeric(18,3) as blitz_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (rz.pos - 1) * 0.5) from ranks_zerados rz where rz.user_id = u.user_id), 0), 3)::numeric(18,3) as zerados_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (ra.pos - 1) * 0.5) from ranks_alocacao ra where ra.user_id = u.user_id), 0), 3)::numeric(18,3) as alocacao_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (rd.pos - 1) * 0.5) from ranks_devolucao rd where rd.user_id = u.user_id), 0), 3)::numeric(18,3) as devolucao_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (rt.pos - 1) * 0.5) from ranks_termo rt where rt.user_id = u.user_id), 0), 3)::numeric(18,3) as conf_termo_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (ra.pos - 1) * 0.5) from ranks_avulso ra where ra.user_id = u.user_id), 0), 3)::numeric(18,3) as conf_avulso_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (re.pos - 1) * 0.5) from ranks_entrada re where re.user_id = u.user_id), 0), 3)::numeric(18,3) as conf_entrada_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (rl.pos - 1) * 0.5) from ranks_lojas rl where rl.user_id = u.user_id), 0), 3)::numeric(18,3) as conf_lojas_pontos,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'zerados_endereco'), 0), 3)::numeric(18,3) as zerados_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'alocacao_endereco'), 0), 3)::numeric(18,3) as alocacao_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'devolucao_nfd'), 0), 3)::numeric(18,3) as devolucao_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'termo_sku'), 0), 3)::numeric(18,3) as conf_termo_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'avulso_sku'), 0), 3)::numeric(18,3) as conf_avulso_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'entrada_notas_sku'), 0), 3)::numeric(18,3) as conf_entrada_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'registro_embarque_loja'), 0), 3)::numeric(18,3) as conf_lojas_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'atividade_extra_pontos'), 0), 3)::numeric(18,3) as atividade_extra_pontos
        from usuarios_unicos u
    ),
    pontuacao_geral as (
        select
            c.user_id,
            c.mat,
            c.nome,
            c.pvps_pontos,
            c.vol_pontos,
            c.blitz_pontos,
            c.zerados_qtd,
            c.zerados_pontos,
            c.alocacao_qtd,
            c.devolucao_qtd,
            c.conf_termo_qtd,
            c.conf_avulso_qtd,
            c.conf_entrada_qtd,
            c.conf_lojas_qtd,
            c.atividade_extra_pontos,
            round(
                c.pvps_pontos +
                c.vol_pontos +
                c.blitz_pontos +
                c.zerados_pontos +
                c.alocacao_pontos +
                c.devolucao_pontos +
                c.conf_termo_pontos +
                c.conf_avulso_pontos +
                c.conf_entrada_pontos +
                c.conf_lojas_pontos +
                c.atividade_extra_pontos,
                3
            )::numeric(18,3) as total_pontos
        from componentes c
    ),
    ranking_geral as (
        select
            pg.user_id,
            pg.mat,
            pg.nome,
            dense_rank() over(order by pg.total_pontos desc)::integer as posicao,
            pg.pvps_pontos,
            pg.vol_pontos,
            pg.blitz_pontos,
            pg.zerados_qtd,
            pg.zerados_pontos,
            pg.alocacao_qtd,
            pg.devolucao_qtd,
            pg.conf_termo_qtd,
            pg.conf_avulso_qtd,
            pg.conf_entrada_qtd,
            pg.conf_lojas_qtd,
            pg.atividade_extra_pontos,
            pg.total_pontos
        from pontuacao_geral pg
    )
    select
        rg.user_id,
        rg.mat,
        rg.nome,
        rg.posicao,
        rg.pvps_pontos,
        rg.vol_pontos,
        rg.blitz_pontos,
        rg.zerados_qtd,
        rg.zerados_pontos,
        rg.alocacao_qtd,
        rg.devolucao_qtd,
        rg.conf_termo_qtd,
        rg.conf_avulso_qtd,
        rg.conf_entrada_qtd,
        rg.conf_lojas_qtd,
        rg.atividade_extra_pontos,
        rg.total_pontos
    from ranking_geral rg
    where v_is_admin
       or v_mode = 'public_cd'
       or rg.user_id = v_uid
    order by rg.total_pontos desc, rg.nome asc;
end;
$$;

grant execute on function public.rpc_produtividade_ranking(integer, integer, integer) to authenticated;
