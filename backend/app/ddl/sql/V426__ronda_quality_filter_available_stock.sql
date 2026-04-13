create or replace function app.ronda_quality_eligible_rows(
    p_cd integer,
    p_zone_type text
)
returns table (
    cd integer,
    zone_type text,
    zona text,
    endereco text,
    coddv integer,
    coluna integer,
    nivel text,
    descricao text,
    qtd_est_disp integer
)
language sql
stable
security definer
set search_path = app, authz, public
as $$
    select
        d.cd,
        upper(trim(coalesce(d.tipo, ''))) as zone_type,
        app.ronda_quality_normalize_zone(d.endereco, p_zone_type) as zona,
        upper(trim(d.endereco)) as endereco,
        d.coddv,
        app.ronda_quality_normalize_column(d.endereco) as coluna,
        nullif(upper(trim(coalesce(d.andar, ''))), '') as nivel,
        coalesce(
            nullif(trim(coalesce(d.descricao, '')), ''),
            format('CODDV %s', d.coddv)
        ) as descricao,
        greatest(coalesce(st.qtd_est_disp, 0), 0) as qtd_est_disp
    from app.db_end d
    join app.db_estq_entr st
      on st.cd = d.cd
     and st.coddv = d.coddv
    where d.cd = p_cd
      and upper(trim(coalesce(d.tipo, ''))) = upper(trim(coalesce(p_zone_type, '')))
      and d.coddv is not null
      and d.coddv > 0
      and nullif(trim(coalesce(d.endereco, '')), '') is not null
      and greatest(coalesce(st.qtd_est_disp, 0), 0) > 0;
$$;

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
    with filtered_base as (
        select *
        from app.ronda_quality_eligible_rows(v_cd, v_zone_type) b
        where b.zona is not null
          and (v_search is null or b.zona like '%' || v_search || '%')
    ),
    zone_base as (
        select
            v_cd as cd,
            v_month_ref as month_ref,
            v_zone_type as zone_type,
            b.zona,
            count(distinct b.endereco)::integer as total_enderecos,
            count(distinct b.coddv)::integer as produtos_unicos,
            (count(distinct b.coluna) filter (where b.coluna is not null))::integer as total_colunas,
            (count(distinct b.nivel) filter (where b.nivel is not null))::integer as total_niveis
        from filtered_base b
        group by b.zona
    ),
    occurrence_stats as (
        select
            b.zona,
            count(distinct b.endereco)::integer as enderecos_com_ocorrencia
        from filtered_base b
        where exists (
            select 1
            from app.aud_ronda_quality_occurrences o
            where o.cd = v_cd
              and o.zone_type = v_zone_type
              and o.month_ref = v_month_ref
              and o.zona = b.zona
              and upper(trim(o.endereco)) = b.endereco
        )
        group by b.zona
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
    eligible_columns as (
        select distinct b.zona, b.coluna
        from filtered_base b
        where b.coluna is not null
    ),
    column_audit_stats as (
        select
            ec.zona,
            count(distinct ec.coluna)::integer as audited_colunas
        from eligible_columns ec
        where exists (
            select 1
            from app.aud_ronda_quality_sessions s
            where s.cd = v_cd
              and s.zone_type = 'PUL'
              and s.month_ref = v_month_ref
              and s.zona = ec.zona
              and s.coluna = ec.coluna
        )
        group by ec.zona
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

    v_zona := regexp_replace(upper(trim(coalesce(p_zona, ''))), '[\.\s]+', '', 'g');
    if v_zona = '' then
        raise exception 'ZONA_OBRIGATORIA';
    end if;

    v_cd := app.ronda_quality_resolve_cd(p_cd);
    v_month_ref := app.ronda_quality_resolve_month_ref(p_month_ref);

    return query
    with zone_rows as (
        select *
        from app.ronda_quality_eligible_rows(v_cd, v_zone_type) b
        where b.zona = v_zona
    ),
    zone_exists as (
        select 1 as keep_row
        from zone_rows zr
        limit 1
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
            count(distinct zr.endereco)::integer as enderecos_com_ocorrencia
        from zone_rows zr
        where exists (
            select 1
            from app.aud_ronda_quality_occurrences o
            where o.cd = v_cd
              and o.zone_type = v_zone_type
              and o.month_ref = v_month_ref
              and o.zona = v_zona
              and upper(trim(o.endereco)) = zr.endereco
        )
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
    column_base as (
        select
            zr.coluna,
            count(distinct zr.endereco)::integer as total_enderecos,
            count(distinct zr.coddv)::integer as produtos_unicos
        from zone_rows zr
        where zr.coluna is not null
        group by zr.coluna
    ),
    column_occurrence_stats as (
        select
            cb.coluna,
            count(distinct zr.endereco)::integer as enderecos_com_ocorrencia
        from column_base cb
        join zone_rows zr
          on zr.coluna = cb.coluna
        where exists (
            select 1
            from app.aud_ronda_quality_occurrences o
            where o.cd = v_cd
              and o.zone_type = 'PUL'
              and o.month_ref = v_month_ref
              and o.zona = v_zona
              and o.coluna = cb.coluna
              and upper(trim(o.endereco)) = zr.endereco
        )
        group by cb.coluna
    ),
    column_session_stats as (
        select
            cb.coluna,
            count(*)::integer as total_auditorias,
            max(s.created_at) as last_audit_at
        from column_base cb
        join app.aud_ronda_quality_sessions s
          on s.coluna = cb.coluna
        where s.cd = v_cd
          and s.zone_type = 'PUL'
          and s.month_ref = v_month_ref
          and s.zona = v_zona
        group by cb.coluna
    ),
    column_stats_rows as (
        select
            cb.coluna,
            cb.total_enderecos,
            cb.produtos_unicos,
            coalesce(cos.enderecos_com_ocorrencia, 0) as enderecos_com_ocorrencia,
            case
                when cb.total_enderecos <= 0 then 100::numeric
                else round((((cb.total_enderecos - coalesce(cos.enderecos_com_ocorrencia, 0))::numeric / cb.total_enderecos::numeric) * 100)::numeric, 1)
            end as percentual_conformidade,
            coalesce(css.total_auditorias, 0) > 0 as audited_in_month,
            coalesce(css.total_auditorias, 0) as total_auditorias,
            css.last_audit_at
        from column_base cb
        left join column_occurrence_stats cos on cos.coluna = cb.coluna
        left join column_session_stats css on css.coluna = cb.coluna
        order by cb.coluna
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
                        'coluna', s.coluna,
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
        case
            when v_zone_type = 'PUL' then coalesce(zs.total_colunas, 0) > 0 and (
                select count(*)
                from column_stats_rows csr
                where csr.audited_in_month
            ) >= coalesce(zs.total_colunas, 0)
            else coalesce(ss.total_auditorias, 0) > 0
        end as audited_in_month,
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
                        'produtos_unicos', csr.produtos_unicos,
                        'enderecos_com_ocorrencia', csr.enderecos_com_ocorrencia,
                        'percentual_conformidade', csr.percentual_conformidade,
                        'audited_in_month', csr.audited_in_month,
                        'total_auditorias', csr.total_auditorias,
                        'last_audit_at', csr.last_audit_at
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
    cross join zone_exists ze
    cross join occurrence_stats os
    cross join session_stats ss
    cross join history_payload hp;
end;
$$;

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
    with filtered_rows as (
        select *
        from app.ronda_quality_eligible_rows(v_cd, v_zone_type) b
        where b.zona = v_zona
          and (
              v_zone_type = 'SEP'
              or b.coluna = p_coluna
          )
          and (v_nivel is null or b.nivel = v_nivel)
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

create or replace function public.rpc_ronda_quality_submit_audit(
    p_cd integer default null,
    p_zone_type text default null,
    p_zona text default null,
    p_coluna integer default null,
    p_audit_result text default null,
    p_occurrences jsonb default '[]'::jsonb
)
returns table (
    audit_id uuid,
    month_ref date,
    cd integer,
    zone_type text,
    zona text,
    coluna integer,
    audit_result text,
    occurrence_count integer,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zone_type text;
    v_zona text;
    v_session_coluna integer;
    v_audit_result text;
    v_month_ref date;
    v_profile record;
    v_audit_id uuid;
    v_occurrences jsonb;
    v_item jsonb;
    v_endereco text;
    v_motivo text;
    v_observacao text;
    v_nivel text;
    v_coluna integer;
    v_item_zona text;
    v_inserted integer := 0;
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

    v_session_coluna := case when v_zone_type = 'PUL' then p_coluna else null end;
    if v_zone_type = 'PUL' and (v_session_coluna is null or v_session_coluna <= 0) then
        raise exception 'COLUNA_OBRIGATORIA_PUL';
    end if;

    v_audit_result := lower(trim(coalesce(p_audit_result, '')));
    if v_audit_result not in ('sem_ocorrencia', 'com_ocorrencia') then
        raise exception 'AUDIT_RESULT_INVALIDO';
    end if;

    v_occurrences := coalesce(p_occurrences, '[]'::jsonb);
    if jsonb_typeof(v_occurrences) <> 'array' then
        raise exception 'OCCURRENCES_INVALIDAS';
    end if;
    if v_audit_result = 'sem_ocorrencia' and jsonb_array_length(v_occurrences) > 0 then
        raise exception 'SEM_OCORRENCIA_NAO_ACEITA_ITENS';
    end if;
    if v_audit_result = 'com_ocorrencia' and jsonb_array_length(v_occurrences) <= 0 then
        raise exception 'OCORRENCIA_OBRIGATORIA';
    end if;

    v_cd := app.ronda_quality_resolve_cd(p_cd);
    v_month_ref := app.ronda_quality_current_month();

    if not exists (
        select 1
        from app.ronda_quality_eligible_rows(v_cd, v_zone_type) b
        where b.zona = v_zona
    ) then
        raise exception 'ZONA_SEM_ESTOQUE_DISPONIVEL';
    end if;

    if v_zone_type = 'PUL' and not exists (
        select 1
        from app.ronda_quality_eligible_rows(v_cd, v_zone_type) b
        where b.zona = v_zona
          and b.coluna = v_session_coluna
    ) then
        raise exception 'COLUNA_SEM_ESTOQUE_DISPONIVEL';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    insert into app.aud_ronda_quality_sessions (
        month_ref,
        cd,
        zone_type,
        zona,
        coluna,
        audit_result,
        auditor_id,
        auditor_mat,
        auditor_nome
    )
    values (
        v_month_ref,
        v_cd,
        v_zone_type,
        v_zona,
        v_session_coluna,
        v_audit_result,
        v_uid,
        coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO')
    )
    returning app.aud_ronda_quality_sessions.audit_id, app.aud_ronda_quality_sessions.created_at
    into v_audit_id, created_at;

    if v_audit_result = 'com_ocorrencia' then
        for v_item in select value from jsonb_array_elements(v_occurrences)
        loop
            v_endereco := upper(trim(coalesce(v_item ->> 'endereco', '')));
            v_motivo := trim(coalesce(v_item ->> 'motivo', ''));
            v_observacao := trim(coalesce(v_item ->> 'observacao', ''));
            v_nivel := nullif(trim(coalesce(v_item ->> 'nivel', '')), '');

            if v_endereco = '' then
                raise exception 'ENDERECO_OBRIGATORIO';
            end if;
            if v_motivo = '' then
                raise exception 'MOTIVO_OBRIGATORIO';
            end if;
            if v_observacao = '' then
                raise exception 'OBSERVACAO_OBRIGATORIA';
            end if;
            if v_zone_type = 'SEP' then
                v_nivel := null;
            end if;

            if v_zone_type = 'SEP' and v_motivo not in (
                'Produto misturado no mesmo bin',
                'Bin com excesso',
                'Bin virado com produto dentro',
                'Produto líquido deitado',
                'Bin sem etiqueta ou sem identificação',
                'Produto sem bin',
                'Envelopado sem sinalização de etiqueta vermelha',
                'Remanejamento sem troca da etiqueta de endereço',
                'Produto não envelopado ou desmembrado no bin'
            ) then
                raise exception 'MOTIVO_INVALIDO_SEP';
            end if;

            if v_zone_type = 'PUL' and v_motivo not in (
                'Produto com escadinha',
                'Produto misturado',
                'Produto com validade misturada',
                'Produto mal armazenado',
                'Produto avariado',
                'Produto vencido',
                'Sem etiqueta de validade',
                'Sem etiqueta de endereço',
                'Sem etiqueta de endereço e validade',
                'Produto sem identificação',
                'Etiqueta manual ilegível',
                'Duas ou mais avarias na mesma caixa'
            ) then
                raise exception 'MOTIVO_INVALIDO_PUL';
            end if;

            v_item_zona := app.ronda_quality_normalize_zone(v_endereco, v_zone_type);
            if v_item_zona is distinct from v_zona then
                raise exception 'ENDERECO_FORA_DA_ZONA';
            end if;

            v_coluna := case when v_zone_type = 'PUL' then app.ronda_quality_normalize_column(v_endereco) else null end;
            if v_zone_type = 'PUL' and v_coluna is distinct from v_session_coluna then
                raise exception 'ENDERECO_FORA_DA_COLUNA';
            end if;

            if not exists (
                select 1
                from app.ronda_quality_eligible_rows(v_cd, v_zone_type) b
                where b.zona = v_zona
                  and b.endereco = v_endereco
                  and (
                      v_zone_type = 'SEP'
                      or b.coluna = v_session_coluna
                  )
            ) then
                raise exception 'ENDERECO_SEM_ESTOQUE_DISPONIVEL';
            end if;

            insert into app.aud_ronda_quality_occurrences (
                audit_id,
                month_ref,
                cd,
                zone_type,
                zona,
                coluna,
                endereco,
                nivel,
                motivo,
                observacao,
                correction_status,
                created_by
            )
            values (
                v_audit_id,
                v_month_ref,
                v_cd,
                v_zone_type,
                v_zona,
                v_coluna,
                v_endereco,
                v_nivel,
                v_motivo,
                v_observacao,
                'nao_corrigido',
                v_uid
            );

            v_inserted := v_inserted + 1;
        end loop;
    end if;

    audit_id := v_audit_id;
    month_ref := v_month_ref;
    cd := v_cd;
    zone_type := v_zone_type;
    zona := v_zona;
    coluna := v_session_coluna;
    audit_result := v_audit_result;
    occurrence_count := v_inserted;
    return next;
end;
$$;

grant execute on function public.rpc_ronda_quality_zone_list(integer, text, date, text) to authenticated;
grant execute on function public.rpc_ronda_quality_zone_detail(integer, text, text, date) to authenticated;
grant execute on function public.rpc_ronda_quality_address_options(integer, text, text, integer, text, text, integer) to authenticated;
grant execute on function public.rpc_ronda_quality_submit_audit(integer, text, text, integer, text, jsonb) to authenticated;
