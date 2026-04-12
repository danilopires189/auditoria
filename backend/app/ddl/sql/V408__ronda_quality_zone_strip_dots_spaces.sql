create or replace function app.ronda_quality_normalize_zone(
    p_endereco text,
    p_zone_type text default null
)
returns text
language plpgsql
immutable
as $$
declare
    v_endereco text;
    v_zone_type text;
    v_zone text;
begin
    v_endereco := upper(trim(coalesce(p_endereco, '')));
    v_zone_type := upper(trim(coalesce(p_zone_type, '')));

    if v_endereco = '' then
        return null;
    end if;

    v_endereco := regexp_replace(v_endereco, '\s+', '', 'g');

    if v_zone_type = 'PUL' then
        v_zone := split_part(v_endereco, '.', 1);
    else
        v_zone := left(v_endereco, 4);
    end if;

    v_zone := regexp_replace(coalesce(v_zone, ''), '[\.\s]+', '', 'g');
    return nullif(trim(v_zone), '');
end;
$$;

update app.aud_ronda_quality_sessions
set zona = regexp_replace(upper(trim(coalesce(zona, ''))), '[\.\s]+', '', 'g')
where zona ~ '[\.\s]';

update app.aud_ronda_quality_occurrences
set zona = regexp_replace(upper(trim(coalesce(zona, ''))), '[\.\s]+', '', 'g')
where zona ~ '[\.\s]';

create or replace function public.rpc_ronda_quality_submit_audit(
    p_cd integer default null,
    p_zone_type text default null,
    p_zona text default null,
    p_audit_result text default null,
    p_occurrences jsonb default '[]'::jsonb
)
returns table (
    audit_id uuid,
    month_ref date,
    cd integer,
    zone_type text,
    zona text,
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
            if v_zone_type = 'PUL' and v_nivel is null then
                raise exception 'NIVEL_OBRIGATORIO_PUL';
            end if;
            if v_zone_type = 'SEP' and v_nivel is not null then
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
    audit_result := v_audit_result;
    occurrence_count := v_inserted;
    return next;
end;
$$;

grant execute on function public.rpc_ronda_quality_submit_audit(integer, text, text, text, jsonb) to authenticated;
