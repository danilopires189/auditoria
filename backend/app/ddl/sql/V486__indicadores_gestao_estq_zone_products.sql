create or replace function public.rpc_indicadores_gestao_estq_zone_products(
    p_cd integer default null,
    p_month_start date default null,
    p_day date default null,
    p_movement_filter text default null,
    p_zona text default null,
    p_limit integer default 200
)
returns table (
    zona text,
    data_mov date,
    coddv integer,
    descricao text,
    tipo_movimentacao text,
    movement_group text,
    natureza text,
    valor_total numeric,
    responsavel text,
    cargo text,
    ocorrencias bigint,
    quantidade bigint
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
    v_zona text;
    v_limit integer;
    v_type_codes text[];
begin
    v_cd := app.indicadores_resolve_cd(p_cd);
    v_filter := lower(trim(coalesce(p_movement_filter, '')));
    if v_filter not in ('entrada', 'saida') then
        v_filter := 'todas';
    end if;

    v_zona := upper(trim(coalesce(p_zona, '')));
    if v_zona = '' then
        v_zona := 'SEM ZONA';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 200), 1), 500);
    v_type_codes := case
        when v_filter = 'entrada' then array['EA', 'EO']
        when v_filter = 'saida' then array['SO', 'SA']
        else array['EA', 'EO', 'SO', 'SA']
    end;

    return query
    with bounds as (
        select
            date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date))::date as month_start,
            (date_trunc('month', coalesce(p_month_start, timezone('America/Sao_Paulo', now())::date)) + interval '1 month - 1 day')::date as month_end
    ),
    user_lookup as materialized (
        select
            authz.normalize_mat(u.mat) as mat_norm,
            max(nullif(trim(u.mat), '')) as mat,
            max(nullif(trim(u.nome), '')) as nome,
            max(nullif(trim(u.cargo), '')) as cargo
        from app.db_usuario u
        where u.cd = v_cd
          and authz.normalize_mat(u.mat) <> ''
        group by authz.normalize_mat(u.mat)
    ),
    sep_enderecos as materialized (
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
    rows_base as materialized (
        select
            coalesce(sep.zona, 'SEM ZONA') as zona,
            g.data_mov,
            g.coddv,
            coalesce(nullif(trim(g.descricao), ''), format('CODDV %s', coalesce(g.coddv::text, 'sem código'))) as descricao,
            norm.tipo_norm as tipo_movimentacao,
            case
                when norm.tipo_norm in ('EA', 'EO') then 'entrada'
                else 'saida'
            end as movement_group,
            case
                when norm.tipo_norm in ('EA', 'EO') then 'sobra'
                else 'falta'
            end as natureza,
            abs(coalesce(g.valor_mov, 0))::numeric as abs_valor,
            greatest(coalesce(nullif(g.qtd_mov, 0), 1), 1)::bigint as quantidade_item,
            nullif(trim(coalesce(g.usuario, '')), '') as usuario_raw,
            authz.normalize_mat(g.usuario) as usuario_norm
        from app.db_gestao_estq g
        cross join bounds b
        cross join lateral (
            select upper(trim(coalesce(g.tipo_movimentacao, ''))) as tipo_norm
        ) norm
        left join sep_enderecos sep
          on sep.coddv = g.coddv
        where g.cd = v_cd
          and g.data_mov is not null
          and g.data_mov >= b.month_start
          and g.data_mov <= b.month_end
          and (p_day is null or g.data_mov = p_day)
          and norm.tipo_norm = any(v_type_codes)
          and coalesce(sep.zona, 'SEM ZONA') = v_zona
    ),
    rows_enriched as materialized (
        select
            r.zona,
            r.data_mov,
            r.coddv,
            r.descricao,
            r.tipo_movimentacao,
            r.movement_group,
            r.natureza,
            r.abs_valor,
            r.quantidade_item,
            case
                when ul.mat is not null and ul.nome is not null then ul.mat || ' - ' || ul.nome
                when ul.mat is not null then ul.mat
                when r.usuario_raw is not null then r.usuario_raw
                else 'Não informado'
            end as responsavel,
            coalesce(ul.cargo, '-') as cargo
        from rows_base r
        left join user_lookup ul
          on ul.mat_norm = r.usuario_norm
    ),
    aggregated as (
        select
            r.zona,
            r.data_mov,
            r.coddv,
            max(r.descricao) as descricao,
            r.tipo_movimentacao,
            r.movement_group,
            r.natureza,
            r.responsavel,
            r.cargo,
            coalesce(sum(r.abs_valor), 0)::numeric as valor_total,
            count(*)::bigint as ocorrencias,
            coalesce(sum(r.quantidade_item), 0)::bigint as quantidade
        from rows_enriched r
        group by
            r.zona,
            r.data_mov,
            r.coddv,
            r.tipo_movimentacao,
            r.movement_group,
            r.natureza,
            r.responsavel,
            r.cargo
    )
    select
        a.zona,
        a.data_mov,
        a.coddv,
        a.descricao,
        a.tipo_movimentacao,
        a.movement_group,
        a.natureza,
        a.valor_total,
        a.responsavel,
        a.cargo,
        a.ocorrencias,
        a.quantidade
    from aggregated a
    order by a.valor_total desc, a.data_mov desc, a.coddv asc, a.responsavel asc
    limit v_limit;
end;
$$;

grant execute on function public.rpc_indicadores_gestao_estq_zone_products(integer, date, date, text, text, integer) to authenticated;
