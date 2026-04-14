create or replace function public.rpc_ronda_quality_submit_audit(
    p_cd integer default null,
    p_zone_type text default null,
    p_zona text default null,
    p_coluna integer default null,
    p_audit_result text default null,
    p_occurrences jsonb default '[]'::jsonb,
    p_started_at timestamptz default null
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
    started_at timestamptz,
    finished_at timestamptz,
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
    v_endereco_manual boolean;
    v_inserted integer := 0;
    v_started_at timestamptz;
    v_finished_at timestamptz;
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

    v_audit_result := lower(trim(coalesce(p_audit_result, '')));
    if v_audit_result not in ('sem_ocorrencia', 'com_ocorrencia') then
        raise exception 'AUDIT_RESULT_INVALIDO';
    end if;

    if p_occurrences is null then
        v_occurrences := '[]'::jsonb;
    elsif jsonb_typeof(p_occurrences) <> 'array' then
        raise exception 'OCCURRENCES_INVALIDAS';
    else
        v_occurrences := p_occurrences;
    end if;

    if v_audit_result = 'sem_ocorrencia' and jsonb_array_length(v_occurrences) > 0 then
        raise exception 'SEM_OCORRENCIA_NAO_ACEITA_ITENS';
    end if;
    if v_audit_result = 'com_ocorrencia' and jsonb_array_length(v_occurrences) = 0 then
        raise exception 'OCORRENCIA_OBRIGATORIA';
    end if;

    v_cd := app.ronda_quality_resolve_cd(p_cd);
    v_month_ref := app.ronda_quality_resolve_month_ref(null);
    v_profile := app.ronda_quality_current_user();

    if v_zone_type = 'PUL' then
        v_session_coluna := p_coluna;
        if v_session_coluna is null or v_session_coluna <= 0 then
            raise exception 'COLUNA_OBRIGATORIA_PUL';
        end if;

        if not exists (
            select 1
            from app.ronda_quality_eligible_rows(v_cd, v_zone_type) b
            where b.zona = v_zona
              and b.coluna = v_session_coluna
        ) then
            raise exception 'COLUNA_SEM_ESTOQUE_DISPONIVEL';
        end if;
    else
        v_session_coluna := null;

        if not exists (
            select 1
            from app.ronda_quality_eligible_rows(v_cd, v_zone_type) b
            where b.zona = v_zona
        ) then
            raise exception 'ZONA_SEM_ESTOQUE_DISPONIVEL';
        end if;
    end if;

    if v_audit_result = 'sem_ocorrencia' then
        if v_zone_type = 'PUL' and exists (
            select 1
            from app.aud_ronda_quality_sessions s
            where s.month_ref = v_month_ref
              and s.cd = v_cd
              and s.zone_type = v_zone_type
              and s.zona = v_zona
              and s.coluna = v_session_coluna
              and s.audit_result = 'sem_ocorrencia'
        ) then
            raise exception 'SEM_OCORRENCIA_DUPLICADA_COLUNA';
        end if;

        if v_zone_type = 'SEP' and exists (
            select 1
            from app.aud_ronda_quality_sessions s
            where s.month_ref = v_month_ref
              and s.cd = v_cd
              and s.zone_type = v_zone_type
              and s.zona = v_zona
              and s.audit_result = 'sem_ocorrencia'
        ) then
            raise exception 'SEM_OCORRENCIA_DUPLICADA_ZONA';
        end if;
    end if;

    v_started_at := case
        when p_started_at is null then timezone('utc', now())
        else p_started_at
    end;
    v_finished_at := timezone('utc', now());

    insert into app.aud_ronda_quality_sessions (
        month_ref,
        cd,
        zone_type,
        zona,
        coluna,
        audit_result,
        created_by,
        auditor_mat,
        auditor_nome,
        started_at,
        finished_at
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
        coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
        v_started_at,
        v_finished_at
    )
    returning
        app.aud_ronda_quality_sessions.audit_id,
        app.aud_ronda_quality_sessions.started_at,
        app.aud_ronda_quality_sessions.finished_at,
        app.aud_ronda_quality_sessions.created_at
    into v_audit_id, started_at, finished_at, created_at;

    if v_audit_result = 'com_ocorrencia' then
        for v_item in select value from jsonb_array_elements(v_occurrences)
        loop
            v_endereco := upper(trim(coalesce(v_item ->> 'endereco', '')));
            v_motivo := trim(coalesce(v_item ->> 'motivo', ''));
            v_observacao := nullif(trim(coalesce(v_item ->> 'observacao', '')), '');
            v_nivel := nullif(trim(coalesce(v_item ->> 'nivel', '')), '');
            v_endereco_manual := coalesce((v_item ->> 'endereco_manual')::boolean, false);

            if v_endereco = '' then
                raise exception 'ENDERECO_OBRIGATORIO';
            end if;
            if v_motivo = '' then
                raise exception 'MOTIVO_OBRIGATORIO';
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

            if v_endereco_manual then
                v_item_zona := v_zona;
                v_coluna := case when v_zone_type = 'PUL' then v_session_coluna else null end;
            else
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

grant execute on function public.rpc_ronda_quality_submit_audit(integer, text, text, integer, text, jsonb, timestamptz) to authenticated;
