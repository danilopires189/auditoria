create or replace function public.rpc_indicadores_gestao_estq_report_zone_values(
    p_cd integer default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_movement_filter text default null
)
returns table (
    zona text,
    entrada_total numeric,
    saida_total numeric,
    valor_total numeric
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
begin
    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;
    if p_dt_ini > p_dt_fim then
        raise exception 'INTERVALO_INVALIDO';
    end if;

    v_cd := app.indicadores_resolve_cd(p_cd);

    return query
    with rows_base as (
        select *
        from app.indicadores_gestao_estq_report_rows(v_cd, p_dt_ini, p_dt_fim, p_movement_filter)
    ),
    sep_enderecos as (
        select
            d.coddv,
            app.pvps_alocacao_normalize_zone(d.endereco_normalizado) as zona
        from (
            select distinct on (de.coddv)
                de.coddv,
                upper(trim(de.endereco)) as endereco_normalizado
            from app.db_end de
            where de.cd = v_cd
              and upper(trim(coalesce(de.tipo, ''))) = 'SEP'
              and nullif(trim(coalesce(de.endereco, '')), '') is not null
            order by
                de.coddv,
                upper(trim(de.endereco)) asc
        ) d
    ),
    rows_with_zone as (
        select
            coalesce(sep.zona, 'SEM ZONA') as zona,
            r.movement_group,
            r.abs_valor
        from rows_base r
        left join sep_enderecos sep
          on sep.coddv = r.coddv
    )
    select
        rwz.zona,
        coalesce(sum(case when rwz.movement_group = 'entrada' then rwz.abs_valor else 0 end), 0)::numeric as entrada_total,
        coalesce(sum(case when rwz.movement_group = 'saida' then rwz.abs_valor else 0 end), 0)::numeric as saida_total,
        coalesce(sum(rwz.abs_valor), 0)::numeric as valor_total
    from rows_with_zone rwz
    group by rwz.zona
    order by valor_total desc, rwz.zona asc;
end;
$$;

grant execute on function public.rpc_indicadores_gestao_estq_report_zone_values(integer, date, date, text) to authenticated;
