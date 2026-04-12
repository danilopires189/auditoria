drop function if exists public.rpc_ronda_quality_zone_list(integer, text, date, text);

create or replace function public.rpc_ronda_quality_zone_list(
    p_cd integer default null,
    p_zone_type text default null,
    p_month_ref date default null,
    p_search text default null
)
returns table (
    cd integer,
    month_ref date,
    zone_type text,
    zona text,
    total_enderecos integer,
    produtos_unicos integer,
    enderecos_com_ocorrencia integer,
    percentual_conformidade numeric,
    audited_in_month boolean,
    total_auditorias integer,
    last_audit_at timestamptz,
    total_colunas integer,
    total_colunas_auditadas integer,
    total_niveis integer
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
    v_month_ref date;
    v_search text;
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

    v_cd := app.ronda_quality_resolve_cd(p_cd);
    v_month_ref := app.ronda_quality_resolve_month_ref(p_month_ref);
    v_search := upper(trim(coalesce(p_search, '')));
    if v_search = '' then
        v_search := null;
    end if;

    return query
    with base_rows as (
        select
            d.cd,
            app.ronda_quality_normalize_zone(d.endereco, v_zone_type) as zone_name,
            upper(trim(d.endereco)) as endereco,
            d.coddv,
            app.ronda_quality_normalize_column(d.endereco) as coluna,
            nullif(trim(coalesce(d.andar, '')), '') as nivel
        from app.db_end d
        where d.cd = v_cd
          and upper(trim(coalesce(d.tipo, ''))) = v_zone_type
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
    ),
    filtered_base as (
        select *
        from base_rows b
        where b.zone_name is not null
          and (v_search is null or b.zone_name like '%' || v_search || '%')
    ),
    zone_base as (
        select
            v_cd as cd,
            v_month_ref as month_ref,
            v_zone_type as zone_type,
            b.zone_name as zona,
            count(distinct b.endereco)::integer as total_enderecos,
            count(distinct b.coddv)::integer as produtos_unicos,
            (count(distinct b.coluna) filter (where b.coluna is not null))::integer as total_colunas,
            (count(distinct b.nivel) filter (where b.nivel is not null))::integer as total_niveis
        from filtered_base b
        group by b.zone_name
    ),
    occurrence_stats as (
        select
            o.zona,
            count(distinct upper(trim(o.endereco)))::integer as enderecos_com_ocorrencia
        from app.aud_ronda_quality_occurrences o
        where o.cd = v_cd
          and o.zone_type = v_zone_type
          and o.month_ref = v_month_ref
        group by o.zona
    ),
    session_stats as (
        select
            s.zona,
            count(*)::integer as total_auditorias,
            max(s.created_at) as last_audit_at
        from app.aud_ronda_quality_sessions s
        where s.cd = v_cd
          and s.zone_type = v_zone_type
          and s.month_ref = v_month_ref
        group by s.zona
    ),
    column_audit_stats as (
        select
            s.zona,
            count(distinct s.coluna)::integer as audited_colunas
        from app.aud_ronda_quality_sessions s
        where s.cd = v_cd
          and s.zone_type = 'PUL'
          and s.month_ref = v_month_ref
          and s.coluna is not null
        group by s.zona
    )
    select
        zb.cd,
        zb.month_ref,
        zb.zone_type,
        zb.zona,
        zb.total_enderecos,
        zb.produtos_unicos,
        coalesce(os.enderecos_com_ocorrencia, 0) as enderecos_com_ocorrencia,
        case
            when zb.total_enderecos <= 0 then 100::numeric
            else round((((zb.total_enderecos - coalesce(os.enderecos_com_ocorrencia, 0))::numeric / zb.total_enderecos::numeric) * 100)::numeric, 1)
        end as percentual_conformidade,
        case
            when v_zone_type = 'PUL' then coalesce(zb.total_colunas, 0) > 0 and coalesce(cas.audited_colunas, 0) >= coalesce(zb.total_colunas, 0)
            else coalesce(ss.total_auditorias, 0) > 0
        end as audited_in_month,
        coalesce(ss.total_auditorias, 0) as total_auditorias,
        ss.last_audit_at,
        coalesce(zb.total_colunas, 0) as total_colunas,
        coalesce(cas.audited_colunas, 0) as total_colunas_auditadas,
        coalesce(zb.total_niveis, 0) as total_niveis
    from zone_base zb
    left join occurrence_stats os on os.zona = zb.zona
    left join session_stats ss on ss.zona = zb.zona
    left join column_audit_stats cas on cas.zona = zb.zona
    order by
        (
            case
                when v_zone_type = 'PUL' then coalesce(zb.total_colunas, 0) > 0 and coalesce(cas.audited_colunas, 0) >= coalesce(zb.total_colunas, 0)
                else coalesce(ss.total_auditorias, 0) > 0
            end
        ),
        zb.zona;
end;
$$;

grant execute on function public.rpc_ronda_quality_zone_list(integer, text, date, text) to authenticated;
