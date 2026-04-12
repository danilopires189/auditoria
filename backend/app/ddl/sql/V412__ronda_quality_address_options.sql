create or replace function public.rpc_ronda_quality_address_options(
    p_cd integer default null,
    p_zone_type text default null,
    p_zona text default null,
    p_coluna integer default null,
    p_search text default null,
    p_nivel text default null,
    p_limit integer default 500
)
returns table (
    endereco text,
    coluna integer,
    nivel text,
    produtos_unicos integer,
    produto_label text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zone_type text;
    v_zona text;
    v_search text;
    v_nivel text;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_zone_type := upper(trim(coalesce(p_zone_type, '')));
    if v_zone_type not in ('SEP', 'PUL') then
        raise exception 'ZONE_TYPE_INVALIDO';
    end if;

    v_zona := regexp_replace(upper(trim(coalesce(p_zona, ''))), '[\.\s]+', '', 'g');
    if v_zona = '' then
        raise exception 'ZONA_OBRIGATORIA';
    end if;

    if v_zone_type = 'PUL' and (p_coluna is null or p_coluna <= 0) then
        raise exception 'COLUNA_OBRIGATORIA_PUL';
    end if;

    v_cd := app.ronda_quality_resolve_cd(p_cd);
    v_search := upper(trim(coalesce(p_search, '')));
    if v_search = '' then
        v_search := null;
    end if;
    v_nivel := nullif(upper(trim(coalesce(p_nivel, ''))), '');
    v_limit := greatest(1, least(coalesce(p_limit, 500), 1000));

    return query
    with base_rows as (
        select
            upper(trim(d.endereco)) as endereco,
            case when v_zone_type = 'PUL' then app.ronda_quality_normalize_column(d.endereco) else null end as coluna,
            nullif(upper(trim(coalesce(d.andar, ''))), '') as nivel,
            d.coddv,
            nullif(trim(coalesce(d.descricao, '')), '') as descricao
        from app.db_end d
        where d.cd = v_cd
          and upper(trim(coalesce(d.tipo, ''))) = v_zone_type
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
          and app.ronda_quality_normalize_zone(d.endereco, v_zone_type) = v_zona
          and (
              v_zone_type = 'SEP'
              or app.ronda_quality_normalize_column(d.endereco) = p_coluna
          )
    ),
    filtered_rows as (
        select *
        from base_rows b
        where (v_nivel is null or b.nivel = v_nivel)
          and (
              v_search is null
              or b.endereco like '%' || v_search || '%'
              or b.nivel like '%' || v_search || '%'
              or b.coddv::text like '%' || v_search || '%'
              or upper(coalesce(b.descricao, '')) like '%' || v_search || '%'
          )
    )
    select
        fr.endereco,
        fr.coluna,
        fr.nivel,
        count(distinct fr.coddv)::integer as produtos_unicos,
        case
            when count(distinct fr.coddv) <= 1 then coalesce(max(fr.descricao), 'Produto')
            else format('%s produtos', count(distinct fr.coddv))
        end as produto_label
    from filtered_rows fr
    group by fr.endereco, fr.coluna, fr.nivel
    order by fr.endereco
    limit v_limit;
end;
$$;

grant execute on function public.rpc_ronda_quality_address_options(integer, text, text, integer, text, text, integer) to authenticated;
