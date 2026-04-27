drop function if exists public.rpc_ctrl_validade_indicadores_zonas(integer, date);
drop function if exists public.rpc_ctrl_validade_indicadores_pendentes_zona(integer, text, date, integer);

create or replace function public.rpc_ctrl_validade_indicadores_zonas(
    p_cd integer default null,
    p_month_start date default null
)
returns table (
    zona text,
    coletado_total integer,
    pendente_total integer,
    total integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_month_start date;
    v_month_end date;
begin
    if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_month_start := coalesce(p_month_start, date_trunc('month', timezone('America/Sao_Paulo', now()))::date);
    v_month_start := date_trunc('month', v_month_start)::date;
    v_month_end := (v_month_start + interval '1 month')::date;

    return query
    with ignored_zones as (
        select ign.zona as zona_key
        from app.ctrl_validade_indicadores_zonas_ignoradas ign
        where ign.cd = v_cd
    ),
    sep_base as (
        select distinct on (upper(trim(de.endereco)), de.coddv)
            de.cd,
            de.coddv,
            upper(trim(de.endereco)) as endereco_key,
            app.pvps_alocacao_normalize_zone(de.endereco) as zona_key
        from app.db_end de
        join app.db_estq_entr est
          on est.cd = de.cd
         and est.coddv = de.coddv
         and coalesce(est.qtd_est_disp, 0) > 0
        where de.cd = v_cd
          and upper(trim(coalesce(de.tipo, ''))) = 'SEP'
          and nullif(trim(coalesce(de.endereco, '')), '') is not null
          and not exists (
              select 1
              from ignored_zones iz
              where left(app.pvps_alocacao_normalize_zone(de.endereco), length(iz.zona_key)) = iz.zona_key
          )
        order by upper(trim(de.endereco)), de.coddv, est.dat_ult_compra desc nulls last
    ),
    collected_rows as (
        select distinct
            col.cd,
            col.coddv,
            upper(trim(col.endereco_sep)) as endereco_key,
            app.pvps_alocacao_normalize_zone(col.endereco_sep) as zona_key
        from app.ctrl_validade_linha_coletas col
        where col.cd = v_cd
          and timezone('America/Sao_Paulo', col.data_coleta)::date >= v_month_start
          and timezone('America/Sao_Paulo', col.data_coleta)::date < v_month_end
          and nullif(trim(coalesce(col.endereco_sep, '')), '') is not null
          and not exists (
              select 1
              from ignored_zones iz
              where left(app.pvps_alocacao_normalize_zone(col.endereco_sep), length(iz.zona_key)) = iz.zona_key
          )
    ),
    pending_rows as (
        select base.*
        from sep_base base
        left join collected_rows col
          on col.cd = base.cd
         and col.coddv = base.coddv
         and col.endereco_key = base.endereco_key
        where col.cd is null
    ),
    collected_by_zone as (
        select col.zona_key, count(*)::integer as collected_count
        from collected_rows col
        group by col.zona_key
    ),
    pending_by_zone as (
        select pend.zona_key, count(*)::integer as pending_count
        from pending_rows pend
        group by pend.zona_key
    ),
    all_zones as (
        select cbz.zona_key from collected_by_zone cbz
        union
        select pbz.zona_key from pending_by_zone pbz
    )
    select
        az.zona_key,
        coalesce(cbz.collected_count, 0)::integer,
        coalesce(pbz.pending_count, 0)::integer,
        (coalesce(cbz.collected_count, 0) + coalesce(pbz.pending_count, 0))::integer
    from all_zones az
    left join collected_by_zone cbz on cbz.zona_key = az.zona_key
    left join pending_by_zone pbz on pbz.zona_key = az.zona_key
    order by az.zona_key;
end;
$$;

create or replace function public.rpc_ctrl_validade_indicadores_pendentes_zona(
    p_cd integer default null,
    p_zona text default null,
    p_month_start date default null,
    p_limit integer default 500
)
returns table (
    endereco text,
    descricao text,
    estoque integer,
    dat_ult_compra date
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_zona_key text;
    v_month_start date;
    v_month_end date;
begin
    if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_zona_key := app.ctrl_validade_indicadores_normalize_zona(p_zona);
    if nullif(v_zona_key, '') is null then raise exception 'ZONA_OBRIGATORIA'; end if;

    v_month_start := coalesce(p_month_start, date_trunc('month', timezone('America/Sao_Paulo', now()))::date);
    v_month_start := date_trunc('month', v_month_start)::date;
    v_month_end := (v_month_start + interval '1 month')::date;

    return query
    with ignored_zones as (
        select ign.zona as zona_key
        from app.ctrl_validade_indicadores_zonas_ignoradas ign
        where ign.cd = v_cd
    ),
    sep_base as (
        select distinct on (upper(trim(de.endereco)), de.coddv)
            de.cd,
            de.coddv,
            upper(trim(de.endereco)) as endereco_key,
            app.pvps_alocacao_normalize_zone(de.endereco) as zona_key,
            coalesce(nullif(trim(coalesce(de.descricao, '')), ''), format('CODDV %s', de.coddv)) as descricao,
            coalesce(est.qtd_est_disp, 0)::integer as estoque,
            est.dat_ult_compra
        from app.db_end de
        join app.db_estq_entr est
          on est.cd = de.cd
         and est.coddv = de.coddv
         and coalesce(est.qtd_est_disp, 0) > 0
        where de.cd = v_cd
          and upper(trim(coalesce(de.tipo, ''))) = 'SEP'
          and nullif(trim(coalesce(de.endereco, '')), '') is not null
          and app.pvps_alocacao_normalize_zone(de.endereco) = v_zona_key
          and not exists (
              select 1
              from ignored_zones iz
              where left(app.pvps_alocacao_normalize_zone(de.endereco), length(iz.zona_key)) = iz.zona_key
          )
        order by upper(trim(de.endereco)), de.coddv, est.dat_ult_compra desc nulls last
    ),
    collected_rows as (
        select distinct
            col.cd,
            col.coddv,
            upper(trim(col.endereco_sep)) as endereco_key
        from app.ctrl_validade_linha_coletas col
        where col.cd = v_cd
          and timezone('America/Sao_Paulo', col.data_coleta)::date >= v_month_start
          and timezone('America/Sao_Paulo', col.data_coleta)::date < v_month_end
          and app.pvps_alocacao_normalize_zone(col.endereco_sep) = v_zona_key
    ),
    pending_rows as (
        select base.*
        from sep_base base
        left join collected_rows col
          on col.cd = base.cd
         and col.coddv = base.coddv
         and col.endereco_key = base.endereco_key
        where col.cd is null
    )
    select
        pend.endereco_key,
        pend.descricao,
        pend.estoque,
        pend.dat_ult_compra
    from pending_rows pend
    order by pend.endereco_key, pend.descricao
    limit least(greatest(coalesce(p_limit, 500), 1), 2000);
end;
$$;

grant execute on function public.rpc_ctrl_validade_indicadores_zonas(integer, date) to authenticated;
grant execute on function public.rpc_ctrl_validade_indicadores_pendentes_zona(integer, text, date, integer) to authenticated;
