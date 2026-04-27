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
    with sep_base as (
        select distinct
            d.cd,
            d.coddv,
            upper(trim(d.endereco)) as endereco,
            app.pvps_alocacao_normalize_zone(d.endereco) as zona
        from app.db_end d
        join app.db_estq_entr e
          on e.cd = d.cd
         and e.coddv = d.coddv
         and coalesce(e.qtd_est_disp, 0) > 0
        where d.cd = v_cd
          and upper(trim(coalesce(d.tipo, ''))) = 'SEP'
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
    ),
    coletados as (
        select distinct
            c.cd,
            c.coddv,
            upper(trim(c.endereco_sep)) as endereco,
            app.pvps_alocacao_normalize_zone(c.endereco_sep) as zona
        from app.ctrl_validade_linha_coletas c
        where c.cd = v_cd
          and timezone('America/Sao_Paulo', c.data_coleta)::date >= v_month_start
          and timezone('America/Sao_Paulo', c.data_coleta)::date < v_month_end
          and nullif(trim(coalesce(c.endereco_sep, '')), '') is not null
    ),
    coletado_por_zona as (
        select
            c.zona,
            count(*)::integer as coletado_total
        from coletados c
        group by c.zona
    ),
    pendente_por_zona as (
        select
            b.zona,
            count(*)::integer as pendente_total
        from sep_base b
        left join coletados c
          on c.cd = b.cd
         and c.coddv = b.coddv
         and c.endereco = b.endereco
        where c.cd is null
        group by b.zona
    ),
    zonas as (
        select c.zona from coletado_por_zona c
        union
        select p.zona from pendente_por_zona p
    )
    select
        z.zona,
        coalesce(c.coletado_total, 0)::integer as coletado_total,
        coalesce(p.pendente_total, 0)::integer as pendente_total,
        (coalesce(c.coletado_total, 0) + coalesce(p.pendente_total, 0))::integer as total
    from zonas z
    left join coletado_por_zona c on c.zona = z.zona
    left join pendente_por_zona p on p.zona = z.zona
    order by z.zona;
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
    v_zona text;
    v_month_start date;
    v_month_end date;
begin
    if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_zona := upper(nullif(trim(coalesce(p_zona, '')), ''));
    if v_zona is null then raise exception 'ZONA_OBRIGATORIA'; end if;

    v_month_start := coalesce(p_month_start, date_trunc('month', timezone('America/Sao_Paulo', now()))::date);
    v_month_start := date_trunc('month', v_month_start)::date;
    v_month_end := (v_month_start + interval '1 month')::date;

    return query
    with sep_base as (
        select distinct on (upper(trim(d.endereco)), d.coddv)
            upper(trim(d.endereco)) as endereco,
            d.coddv,
            coalesce(nullif(trim(coalesce(d.descricao, '')), ''), format('CODDV %s', d.coddv)) as descricao,
            coalesce(e.qtd_est_disp, 0)::integer as estoque,
            e.dat_ult_compra
        from app.db_end d
        join app.db_estq_entr e
          on e.cd = d.cd
         and e.coddv = d.coddv
         and coalesce(e.qtd_est_disp, 0) > 0
        where d.cd = v_cd
          and upper(trim(coalesce(d.tipo, ''))) = 'SEP'
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
          and app.pvps_alocacao_normalize_zone(d.endereco) = v_zona
        order by upper(trim(d.endereco)), d.coddv, e.dat_ult_compra desc nulls last
    ),
    coletados as (
        select distinct
            c.coddv,
            upper(trim(c.endereco_sep)) as endereco
        from app.ctrl_validade_linha_coletas c
        where c.cd = v_cd
          and timezone('America/Sao_Paulo', c.data_coleta)::date >= v_month_start
          and timezone('America/Sao_Paulo', c.data_coleta)::date < v_month_end
          and app.pvps_alocacao_normalize_zone(c.endereco_sep) = v_zona
    )
    select
        b.endereco,
        b.descricao,
        b.estoque,
        b.dat_ult_compra
    from sep_base b
    left join coletados c
      on c.coddv = b.coddv
     and c.endereco = b.endereco
    where c.coddv is null
    order by b.endereco, b.descricao
    limit least(greatest(coalesce(p_limit, 500), 1), 2000);
end;
$$;

grant execute on function public.rpc_ctrl_validade_indicadores_zonas(integer, date) to authenticated;
grant execute on function public.rpc_ctrl_validade_indicadores_pendentes_zona(integer, text, date, integer) to authenticated;
