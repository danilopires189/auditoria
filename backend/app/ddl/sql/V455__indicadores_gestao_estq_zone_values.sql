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
    rows_with_zone as (
        select
            coalesce(
                app.pvps_alocacao_normalize_zone(i.endereco_sep),
                'SEM ZONA'
            ) as zona,
            r.movement_group,
            r.abs_valor
        from rows_base r
        left join lateral (
            select gi.endereco_sep
            from app.gestao_estoque_items gi
            where gi.cd = v_cd
              and gi.coddv = r.coddv
              and gi.movement_date = r.data_mov
              and gi.movement_type = case when r.movement_group = 'entrada' then 'entrada' else 'baixa' end
            order by gi.updated_at desc, gi.id desc
            limit 1
        ) i on true
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
