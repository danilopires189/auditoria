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
        select trim(ign.zona) as zona_key
        from app.ctrl_validade_indicadores_zonas_ignoradas ign
        where ign.cd = v_cd
    ),
    base_atual as (
        select
            de.cd,
            de.coddv,
            trim(app.pvps_alocacao_normalize_zone(de.endereco)) as zona_key
        from app.db_end de
        join app.db_estq_entr est
          on est.cd = de.cd
         and est.coddv = de.coddv
         and coalesce(est.qtd_est_disp, 0) > 0
        where de.cd = v_cd
          and de.coddv is not null
          and upper(trim(coalesce(de.tipo, ''))) = 'SEP'
          and nullif(trim(coalesce(de.endereco, '')), '') is not null
          and not exists (
              select 1
              from ignored_zones iz
              where left(trim(app.pvps_alocacao_normalize_zone(de.endereco)), length(iz.zona_key)) = iz.zona_key
          )
        group by de.cd, de.coddv, trim(app.pvps_alocacao_normalize_zone(de.endereco))
    ),
    coletados_mes as (
        select distinct
            col.cd,
            col.coddv,
            trim(app.pvps_alocacao_normalize_zone(col.endereco_sep)) as zona_key
        from app.ctrl_validade_linha_coletas col
        where col.cd = v_cd
          and col.coddv is not null
          and timezone('America/Sao_Paulo', col.data_coleta)::date >= v_month_start
          and timezone('America/Sao_Paulo', col.data_coleta)::date < v_month_end
          and nullif(trim(coalesce(col.endereco_sep, '')), '') is not null
    ),
    base_status as (
        select
            base.zona_key,
            exists (
                select 1
                from coletados_mes col
                where col.cd = base.cd
                  and col.coddv = base.coddv
                  and col.zona_key = base.zona_key
            ) as coletado
        from base_atual base
    )
    select
        status.zona_key,
        count(*) filter (where status.coletado)::integer,
        count(*) filter (where not status.coletado)::integer,
        count(*)::integer
    from base_status status
    group by status.zona_key
    order by status.zona_key;
end;
$$;

create or replace function public.rpc_ctrl_validade_indicadores_pendentes_zona(
    p_cd integer default null,
    p_zona text default null,
    p_month_start date default null,
    p_limit integer default 500
)
returns table (
    coddv integer,
    descricao text,
    estoque integer,
    enderecos text,
    endereco text,
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
        select trim(ign.zona) as zona_key
        from app.ctrl_validade_indicadores_zonas_ignoradas ign
        where ign.cd = v_cd
    ),
    endereco_base as (
        select distinct
            de.cd,
            de.coddv,
            trim(app.pvps_alocacao_normalize_zone(de.endereco)) as zona_key,
            upper(trim(de.endereco)) as endereco_key,
            coalesce(nullif(trim(coalesce(de.descricao, '')), ''), format('CODDV %s', de.coddv)) as descricao,
            coalesce(est.qtd_est_disp, 0)::integer as estoque,
            est.dat_ult_compra
        from app.db_end de
        join app.db_estq_entr est
          on est.cd = de.cd
         and est.coddv = de.coddv
         and coalesce(est.qtd_est_disp, 0) > 0
        where de.cd = v_cd
          and de.coddv is not null
          and upper(trim(coalesce(de.tipo, ''))) = 'SEP'
          and nullif(trim(coalesce(de.endereco, '')), '') is not null
          and trim(app.pvps_alocacao_normalize_zone(de.endereco)) = v_zona_key
          and not exists (
              select 1
              from ignored_zones iz
              where left(trim(app.pvps_alocacao_normalize_zone(de.endereco)), length(iz.zona_key)) = iz.zona_key
          )
    ),
    base_atual as (
        select
            eb.cd,
            eb.coddv,
            eb.zona_key,
            min(eb.descricao) as descricao,
            max(eb.estoque)::integer as estoque,
            string_agg(eb.endereco_key, ', ' order by eb.endereco_key) as enderecos,
            max(eb.dat_ult_compra) as dat_ult_compra
        from endereco_base eb
        group by eb.cd, eb.coddv, eb.zona_key
    ),
    coletados_mes as (
        select distinct
            col.cd,
            col.coddv,
            trim(app.pvps_alocacao_normalize_zone(col.endereco_sep)) as zona_key
        from app.ctrl_validade_linha_coletas col
        where col.cd = v_cd
          and col.coddv is not null
          and timezone('America/Sao_Paulo', col.data_coleta)::date >= v_month_start
          and timezone('America/Sao_Paulo', col.data_coleta)::date < v_month_end
          and trim(app.pvps_alocacao_normalize_zone(col.endereco_sep)) = v_zona_key
    )
    select
        base.coddv,
        base.descricao,
        base.estoque,
        base.enderecos,
        base.enderecos as endereco,
        base.dat_ult_compra
    from base_atual base
    where not exists (
        select 1
        from coletados_mes col
        where col.cd = base.cd
          and col.coddv = base.coddv
          and col.zona_key = base.zona_key
    )
    order by base.enderecos, base.descricao, base.coddv
    limit least(greatest(coalesce(p_limit, 500), 1), 2000);
end;
$$;

grant execute on function public.rpc_ctrl_validade_indicadores_zonas(integer, date) to authenticated;
grant execute on function public.rpc_ctrl_validade_indicadores_pendentes_zona(integer, text, date, integer) to authenticated;

notify pgrst, 'reload schema';
