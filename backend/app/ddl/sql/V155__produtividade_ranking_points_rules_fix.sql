create or replace function public.rpc_produtividade_ranking(
    p_cd integer default null,
    p_mes integer default null,
    p_ano integer default null
)
returns table (
    user_id uuid,
    mat text,
    nome text,
    pvps_pontos numeric(18,3),
    vol_pontos numeric(18,3),
    blitz_pontos numeric(18,3),
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
        where v_is_admin
           or v_mode = 'public_cd'
           or b.user_id = v_uid
        group by b.user_id, b.activity_key
    ),
    ranks_pvps as (
        select
            um.user_id,
            um.total_val,
            dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'pvps_endereco'
    ),
    ranks_alocacao as (
        select
            um.user_id,
            um.total_val,
            dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'alocacao_endereco'
    ),
    ranks_vol as (
        select
            um.user_id,
            um.total_val,
            dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'prod_vol_mes'
    ),
    ranks_blitz as (
        select
            um.user_id,
            um.total_val,
            dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'prod_blitz_un'
    ),
    usuarios_unicos as (
        select distinct
            um.user_id,
            um.mat,
            um.nome
        from usuarios_metricas um
    )
    select
        u.user_id,
        u.mat,
        u.nome,
        round(
            coalesce(
                (
                    select greatest(0.5, 3.5 - (rp.pos - 1) * 0.5)
                    from ranks_pvps rp
                    where rp.user_id = u.user_id
                ),
                0
            ),
            3
        )::numeric(18,3) as pvps_pontos,
        round(
            coalesce(
                (
                    select greatest(0.5, 10.0 - (rv.pos - 1) * 0.5)
                    from ranks_vol rv
                    where rv.user_id = u.user_id
                ),
                0
            ),
            3
        )::numeric(18,3) as vol_pontos,
        round(
            coalesce(
                (
                    select greatest(0.5, 10.0 - (rb.pos - 1) * 0.5)
                    from ranks_blitz rb
                    where rb.user_id = u.user_id
                ),
                0
            ),
            3
        )::numeric(18,3) as blitz_pontos,
        round(
            coalesce(
                (
                    select um.total_val
                    from usuarios_metricas um
                    where um.user_id = u.user_id
                      and um.activity_key = 'alocacao_endereco'
                ),
                0
            ),
            3
        )::numeric(18,3) as alocacao_qtd,
        round(
            coalesce(
                (
                    select um.total_val
                    from usuarios_metricas um
                    where um.user_id = u.user_id
                      and um.activity_key = 'devolucao_nfd'
                ),
                0
            ),
            3
        )::numeric(18,3) as devolucao_qtd,
        round(
            coalesce(
                (
                    select um.total_val
                    from usuarios_metricas um
                    where um.user_id = u.user_id
                      and um.activity_key = 'termo_sku'
                ),
                0
            ),
            3
        )::numeric(18,3) as conf_termo_qtd,
        round(
            coalesce(
                (
                    select um.total_val
                    from usuarios_metricas um
                    where um.user_id = u.user_id
                      and um.activity_key = 'coleta_sku'
                ),
                0
            ),
            3
        )::numeric(18,3) as conf_avulso_qtd,
        round(
            coalesce(
                (
                    select um.total_val
                    from usuarios_metricas um
                    where um.user_id = u.user_id
                      and um.activity_key = 'entrada_notas_sku'
                ),
                0
            ),
            3
        )::numeric(18,3) as conf_entrada_qtd,
        round(
            coalesce(
                (
                    select um.total_val
                    from usuarios_metricas um
                    where um.user_id = u.user_id
                      and um.activity_key = 'registro_embarque_loja'
                ),
                0
            ),
            3
        )::numeric(18,3) as conf_lojas_qtd,
        round(
            coalesce(
                (
                    select um.total_val
                    from usuarios_metricas um
                    where um.user_id = u.user_id
                      and um.activity_key = 'atividade_extra_pontos'
                ),
                0
            ),
            3
        )::numeric(18,3) as atividade_extra_pontos,
        (
            round(
                coalesce(
                    (
                        select greatest(0.5, 3.5 - (rp.pos - 1) * 0.5)
                        from ranks_pvps rp
                        where rp.user_id = u.user_id
                    ),
                    0
                ),
                3
            ) +
            round(
                coalesce(
                    (
                        select greatest(0.5, 10.0 - (rv.pos - 1) * 0.5)
                        from ranks_vol rv
                        where rv.user_id = u.user_id
                    ),
                    0
                ),
                3
            ) +
            round(
                coalesce(
                    (
                        select greatest(0.5, 10.0 - (rb.pos - 1) * 0.5)
                        from ranks_blitz rb
                        where rb.user_id = u.user_id
                    ),
                    0
                ),
                3
            ) +
            round(
                coalesce(
                    (
                        select greatest(0.5, 3.5 - (ra.pos - 1) * 0.5)
                        from ranks_alocacao ra
                        where ra.user_id = u.user_id
                    ),
                    0
                ),
                3
            ) +
            round(
                coalesce(
                    (
                        select um.total_val
                        from usuarios_metricas um
                        where um.user_id = u.user_id
                          and um.activity_key = 'devolucao_nfd'
                    ),
                    0
                ),
                3
            ) +
            round(
                coalesce(
                    (
                        select um.total_val
                        from usuarios_metricas um
                        where um.user_id = u.user_id
                          and um.activity_key = 'termo_sku'
                    ),
                    0
                ),
                3
            ) +
            round(
                coalesce(
                    (
                        select um.total_val
                        from usuarios_metricas um
                        where um.user_id = u.user_id
                          and um.activity_key = 'coleta_sku'
                    ),
                    0
                ),
                3
            ) +
            round(
                coalesce(
                    (
                        select um.total_val
                        from usuarios_metricas um
                        where um.user_id = u.user_id
                          and um.activity_key = 'entrada_notas_sku'
                    ),
                    0
                ),
                3
            ) +
            round(
                coalesce(
                    (
                        select um.total_val
                        from usuarios_metricas um
                        where um.user_id = u.user_id
                          and um.activity_key = 'registro_embarque_loja'
                    ),
                    0
                ),
                3
            ) +
            round(
                coalesce(
                    (
                        select um.total_val
                        from usuarios_metricas um
                        where um.user_id = u.user_id
                          and um.activity_key = 'atividade_extra_pontos'
                    ),
                    0
                ),
                3
            )
        )::numeric(18,3) as total_pontos
    from usuarios_unicos u
    order by 14 desc, u.nome asc;
end;
$$;

grant execute on function public.rpc_produtividade_ranking(integer, integer, integer) to authenticated;
