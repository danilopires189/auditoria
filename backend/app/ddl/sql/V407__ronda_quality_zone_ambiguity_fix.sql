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
        coalesce(ss.total_auditorias, 0) > 0 as audited_in_month,
        coalesce(ss.total_auditorias, 0) as total_auditorias,
        ss.last_audit_at,
        coalesce(zb.total_colunas, 0) as total_colunas,
        coalesce(zb.total_niveis, 0) as total_niveis
    from zone_base zb
    left join occurrence_stats os on os.zona = zb.zona
    left join session_stats ss on ss.zona = zb.zona
    order by
        (coalesce(ss.total_auditorias, 0) > 0),
        zb.zona;
end;
$$;

create or replace function public.rpc_ronda_quality_zone_detail(
    p_cd integer default null,
    p_zone_type text default null,
    p_zona text default null,
    p_month_ref date default null
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
    total_niveis integer,
    column_stats jsonb,
    level_stats jsonb,
    history_rows jsonb
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
    v_month_ref date;
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

    v_zona := upper(trim(coalesce(p_zona, '')));
    if v_zona = '' then
        raise exception 'ZONA_OBRIGATORIA';
    end if;

    v_cd := app.ronda_quality_resolve_cd(p_cd);
    v_month_ref := app.ronda_quality_resolve_month_ref(p_month_ref);

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
    zone_rows as (
        select *
        from base_rows b
        where b.zone_name = v_zona
    ),
    zone_summary as (
        select
            count(distinct zr.endereco)::integer as total_enderecos,
            count(distinct zr.coddv)::integer as produtos_unicos,
            (count(distinct zr.coluna) filter (where zr.coluna is not null))::integer as total_colunas,
            (count(distinct zr.nivel) filter (where zr.nivel is not null))::integer as total_niveis
        from zone_rows zr
    ),
    occurrence_stats as (
        select
            count(distinct upper(trim(o.endereco)))::integer as enderecos_com_ocorrencia
        from app.aud_ronda_quality_occurrences o
        where o.cd = v_cd
          and o.zone_type = v_zone_type
          and o.month_ref = v_month_ref
          and o.zona = v_zona
    ),
    session_stats as (
        select
            count(*)::integer as total_auditorias,
            max(s.created_at) as last_audit_at
        from app.aud_ronda_quality_sessions s
        where s.cd = v_cd
          and s.zone_type = v_zone_type
          and s.month_ref = v_month_ref
          and s.zona = v_zona
    ),
    column_stats_rows as (
        select
            zr.coluna,
            count(distinct zr.endereco)::integer as total_enderecos,
            count(distinct zr.coddv)::integer as produtos_unicos
        from zone_rows zr
        where zr.coluna is not null
        group by zr.coluna
        order by zr.coluna
    ),
    level_stats_rows as (
        select
            zr.nivel,
            count(distinct zr.endereco)::integer as total_enderecos,
            count(distinct zr.coddv)::integer as produtos_unicos
        from zone_rows zr
        where zr.nivel is not null
        group by zr.nivel
        order by zr.nivel
    ),
    occurrence_payload as (
        select
            o.audit_id,
            jsonb_agg(
                jsonb_build_object(
                    'occurrence_id', o.occurrence_id,
                    'motivo', o.motivo,
                    'endereco', o.endereco,
                    'nivel', o.nivel,
                    'coluna', o.coluna,
                    'observacao', o.observacao,
                    'correction_status', o.correction_status,
                    'correction_updated_at', o.correction_updated_at,
                    'correction_updated_mat', o.correction_updated_mat,
                    'correction_updated_nome', o.correction_updated_nome,
                    'created_at', o.created_at
                )
                order by o.created_at, o.endereco, o.occurrence_id
            ) as occurrences
        from app.aud_ronda_quality_occurrences o
        where o.cd = v_cd
          and o.zone_type = v_zone_type
          and o.month_ref = v_month_ref
          and o.zona = v_zona
        group by o.audit_id
    ),
    history_payload as (
        select
            coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'audit_id', s.audit_id,
                        'audit_result', s.audit_result,
                        'auditor_nome', s.auditor_nome,
                        'auditor_mat', s.auditor_mat,
                        'created_at', s.created_at,
                        'occurrence_count', jsonb_array_length(coalesce(op.occurrences, '[]'::jsonb)),
                        'occurrences', coalesce(op.occurrences, '[]'::jsonb)
                    )
                    order by s.created_at asc, s.audit_id asc
                ),
                '[]'::jsonb
            ) as rows
        from app.aud_ronda_quality_sessions s
        left join occurrence_payload op on op.audit_id = s.audit_id
        where s.cd = v_cd
          and s.zone_type = v_zone_type
          and s.month_ref = v_month_ref
          and s.zona = v_zona
    )
    select
        v_cd as cd,
        v_month_ref as month_ref,
        v_zone_type as zone_type,
        v_zona as zona,
        coalesce(zs.total_enderecos, 0) as total_enderecos,
        coalesce(zs.produtos_unicos, 0) as produtos_unicos,
        coalesce(os.enderecos_com_ocorrencia, 0) as enderecos_com_ocorrencia,
        case
            when coalesce(zs.total_enderecos, 0) <= 0 then 100::numeric
            else round((((zs.total_enderecos - coalesce(os.enderecos_com_ocorrencia, 0))::numeric / zs.total_enderecos::numeric) * 100)::numeric, 1)
        end as percentual_conformidade,
        coalesce(ss.total_auditorias, 0) > 0 as audited_in_month,
        coalesce(ss.total_auditorias, 0) as total_auditorias,
        ss.last_audit_at,
        coalesce(zs.total_colunas, 0) as total_colunas,
        coalesce(zs.total_niveis, 0) as total_niveis,
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'coluna', csr.coluna,
                        'total_enderecos', csr.total_enderecos,
                        'produtos_unicos', csr.produtos_unicos
                    )
                    order by csr.coluna
                )
                from column_stats_rows csr
            ),
            '[]'::jsonb
        ) as column_stats,
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'nivel', lsr.nivel,
                        'total_enderecos', lsr.total_enderecos,
                        'produtos_unicos', lsr.produtos_unicos
                    )
                    order by lsr.nivel
                )
                from level_stats_rows lsr
            ),
            '[]'::jsonb
        ) as level_stats,
        hp.rows as history_rows
    from zone_summary zs
    cross join occurrence_stats os
    cross join session_stats ss
    cross join history_payload hp;
end;
$$;

grant execute on function public.rpc_ronda_quality_zone_list(integer, text, date, text) to authenticated;
grant execute on function public.rpc_ronda_quality_zone_detail(integer, text, text, date) to authenticated;
