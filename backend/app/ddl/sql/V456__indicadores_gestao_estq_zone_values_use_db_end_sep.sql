create or replace function public.rpc_indicadores_gestao_estq_zone_values(
    p_cd integer default null,
    p_month_start date default null,
    p_day date default null,
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
    v_filter text;
begin
    v_cd := app.indicadores_resolve_cd(p_cd);
    v_filter := lower(trim(coalesce(p_movement_filter, '')));
    if v_filter not in ('entrada', 'saida') then
        v_filter := 'todas';
    end if;

    return query
    with bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    rows_base as (
        select r.*
        from bounds b
        cross join lateral app.indicadores_gestao_estq_rows(v_cd, b.month_start, b.month_end) r
        where r.movement_group in ('entrada', 'saida')
          and (v_filter = 'todas' or r.movement_group = v_filter)
          and (p_day is null or r.data_mov = p_day)
    ),
    sep_enderecos as (
        select
            d.coddv,
            app.pvps_alocacao_normalize_zone(d.endereco) as zona
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

grant execute on function public.rpc_indicadores_gestao_estq_zone_values(integer, date, date, text) to authenticated;
