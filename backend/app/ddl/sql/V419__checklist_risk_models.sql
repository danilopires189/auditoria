alter table app.checklist_dto_pvps_audits
    drop constraint if exists ck_checklist_dto_pvps_total_items,
    drop constraint if exists ck_checklist_dto_pvps_non_conformities;

alter table app.checklist_dto_pvps_audits
    add column if not exists scoring_mode text not null default 'simple',
    add column if not exists risk_score_percent numeric(6, 2),
    add column if not exists risk_level text,
    add column if not exists score_points numeric(10, 3),
    add column if not exists score_max_points numeric(10, 3);

alter table app.checklist_dto_pvps_audits
    add constraint ck_checklist_dto_pvps_total_items check (total_items between 1 and 200),
    add constraint ck_checklist_dto_pvps_non_conformities check (non_conformities between 0 and total_items);

alter table app.checklist_dto_pvps_answers
    drop constraint if exists checklist_dto_pvps_answers_item_number_check,
    drop constraint if exists checklist_dto_pvps_answers_section_key_check,
    drop constraint if exists ck_checklist_dto_pvps_answers_item_number,
    drop constraint if exists ck_checklist_dto_pvps_answers_section_key;

alter table app.checklist_dto_pvps_answers
    add column if not exists item_weight numeric(10, 4),
    add column if not exists max_points numeric(10, 3),
    add column if not exists criticality text,
    add column if not exists is_critical boolean not null default false,
    add column if not exists earned_points numeric(10, 3),
    add column if not exists risk_points numeric(10, 4);

alter table app.checklist_dto_pvps_answers
    add constraint ck_checklist_dto_pvps_answers_item_number check (item_number between 1 and 200),
    add constraint ck_checklist_dto_pvps_answers_section_key check (nullif(trim(coalesce(section_key, '')), '') is not null);

create or replace function app.checklist_dto_pvps_template_catalog(p_checklist_key text default 'dto_pvps')
returns table (
    checklist_key text,
    checklist_title text,
    checklist_version text,
    total_items integer,
    scoring_mode text,
    requires_evaluated_user boolean
)
language sql
immutable
as $$
    select *
    from (
        values
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 'simple', true),
            ('dto_alocacao', 'DTO - Auditoria de Alocação', '1.0', 9, 'simple', true),
            ('dto_blitz_separacao', 'DTO - Blitz de Separação', '1.0', 12, 'simple', true),
            ('auditoria_prevencao_perdas', 'Auditoria de Prevenção de Perdas', '1.0', 26, 'simple', true),
            ('prevencao_riscos_geral', 'Prevenção de Perdas e Gestão de Riscos - Geral', '1.0', 50, 'risk_weighted', false),
            ('prevencao_riscos_expedicao', 'Prevenção de Perdas e Gestão de Riscos - Expedição', '1.0', 18, 'score_points', false),
            ('prevencao_riscos_avaria', 'Prevenção de Perdas e Gestão de Riscos - Avaria', '1.0', 7, 'score_points', false)
    ) as catalog(checklist_key, checklist_title, checklist_version, total_items, scoring_mode, requires_evaluated_user)
    where catalog.checklist_key = lower(trim(coalesce(p_checklist_key, 'dto_pvps')))
$$;

drop function if exists public.rpc_checklist_dto_pvps_finalize(text, integer, text, text, boolean, jsonb);

create function public.rpc_checklist_dto_pvps_finalize(
    p_checklist_key text default 'dto_pvps',
    p_cd integer default null,
    p_evaluated_mat text default null,
    p_observations text default null,
    p_signature_accepted boolean default false,
    p_answers jsonb default '[]'::jsonb
)
returns table (
    audit_id uuid,
    checklist_key text,
    checklist_title text,
    checklist_version text,
    cd integer,
    cd_nome text,
    evaluated_mat text,
    evaluated_nome text,
    auditor_mat text,
    auditor_nome text,
    observations text,
    signature_accepted boolean,
    signed_at timestamptz,
    total_items integer,
    non_conformities integer,
    conformity_percent numeric,
    scoring_mode text,
    risk_score_percent numeric,
    risk_level text,
    score_points numeric,
    score_max_points numeric,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_profile record;
    v_answers jsonb;
    v_checklist_key text;
    v_checklist_title text;
    v_checklist_version text;
    v_total_items integer;
    v_scoring_mode text;
    v_requires_evaluated_user boolean;
    v_evaluated_mat text;
    v_evaluated_nome text;
    v_observations text;
    v_total_count integer;
    v_distinct_count integer;
    v_invalid_count integer;
    v_non_conformities integer;
    v_denominator numeric;
    v_risk_points numeric;
    v_critical_fail_count integer;
    v_conformity_percent numeric;
    v_risk_score_percent numeric;
    v_risk_level text;
    v_score_points numeric;
    v_score_max_points numeric;
    v_audit_id uuid;
    v_created_at timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_checklist_key := lower(trim(coalesce(p_checklist_key, 'dto_pvps')));
    select
        c.checklist_title,
        c.checklist_version,
        c.total_items,
        c.scoring_mode,
        c.requires_evaluated_user
    into
        v_checklist_title,
        v_checklist_version,
        v_total_items,
        v_scoring_mode,
        v_requires_evaluated_user
    from app.checklist_dto_pvps_template_catalog(v_checklist_key) c
    limit 1;

    if v_total_items is null then
        raise exception 'CHECKLIST_INVALIDO';
    end if;
    if not coalesce(p_signature_accepted, false) then
        raise exception 'ASSINATURA_ELETRONICA_OBRIGATORIA';
    end if;

    v_cd := app.checklist_dto_pvps_resolve_cd(p_cd);
    v_observations := nullif(trim(coalesce(p_observations, '')), '');

    if v_requires_evaluated_user then
        v_evaluated_mat := authz.normalize_mat(p_evaluated_mat);
        if v_evaluated_mat = '' then
            raise exception 'AVALIADO_MATRICULA_OBRIGATORIA';
        end if;

        select row.nome
        into v_evaluated_nome
        from public.rpc_checklist_dto_pvps_lookup_evaluated(v_cd, v_evaluated_mat) row
        limit 1;

        if v_evaluated_nome is null then
            raise exception 'AVALIADO_NAO_ENCONTRADO';
        end if;
    else
        if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
            raise exception 'CD_SEM_ACESSO';
        end if;
        v_evaluated_mat := 'AUDITORIA_CD';
        v_evaluated_nome := 'Auditoria por CD';
    end if;

    v_answers := coalesce(p_answers, '[]'::jsonb);
    if jsonb_typeof(v_answers) <> 'array' then
        raise exception 'RESPOSTAS_INVALIDAS';
    end if;

    with answer_rows as (
        select
            case when (value ->> 'item_number') ~ '^\d+$' then (value ->> 'item_number')::integer else null end as item_number,
            trim(coalesce(value ->> 'answer', '')) as answer,
            nullif(trim(coalesce(value ->> 'section_key', '')), '') as section_key,
            nullif(trim(coalesce(value ->> 'section_title', '')), '') as section_title,
            nullif(trim(coalesce(value ->> 'question', '')), '') as question,
            case when trim(coalesce(value ->> 'item_weight', '')) ~ '^\d+(\.\d+)?$' then (value ->> 'item_weight')::numeric else null end as item_weight,
            case when trim(coalesce(value ->> 'max_points', '')) ~ '^\d+(\.\d+)?$' then (value ->> 'max_points')::numeric else null end as max_points,
            coalesce((value ->> 'is_critical')::boolean, false) as is_critical
        from jsonb_array_elements(v_answers)
    )
    select
        count(*)::integer,
        count(distinct item_number)::integer,
        count(*) filter (
            where item_number is null
               or item_number < 1
               or item_number > v_total_items
               or answer not in ('Sim', 'Não', 'N.A.')
               or section_key is null
               or section_title is null
               or question is null
               or (v_scoring_mode = 'risk_weighted' and coalesce(item_weight, 0) <= 0)
               or (v_scoring_mode = 'score_points' and coalesce(max_points, 0) <= 0)
        )::integer,
        count(*) filter (where answer = 'Não')::integer
    into v_total_count, v_distinct_count, v_invalid_count, v_non_conformities
    from answer_rows;

    if v_total_count <> v_total_items or v_distinct_count <> v_total_items or v_invalid_count > 0 then
        raise exception 'RESPOSTAS_OBRIGATORIAS';
    end if;
    if v_non_conformities > 0 and v_observations is null then
        raise exception 'OBSERVACAO_OBRIGATORIA_NC';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    if v_profile.user_id is null then
        raise exception 'PROFILE_NAO_ENCONTRADO';
    end if;

    with answer_rows as (
        select
            trim(value ->> 'answer') as answer,
            case when trim(coalesce(value ->> 'item_weight', '')) ~ '^\d+(\.\d+)?$' then (value ->> 'item_weight')::numeric else null end as item_weight,
            case when trim(coalesce(value ->> 'max_points', '')) ~ '^\d+(\.\d+)?$' then (value ->> 'max_points')::numeric else null end as max_points,
            coalesce((value ->> 'is_critical')::boolean, false) as is_critical
        from jsonb_array_elements(v_answers)
    )
    select
        coalesce(sum(case when answer <> 'N.A.' then item_weight else 0 end), 0),
        coalesce(sum(case when answer = 'Não' then item_weight else 0 end), 0),
        coalesce(sum(case when answer <> 'N.A.' then max_points else 0 end), 0),
        coalesce(sum(case when answer = 'Sim' then max_points else 0 end), 0),
        count(*) filter (where answer = 'Não' and is_critical)::integer
    into v_denominator, v_risk_points, v_score_max_points, v_score_points, v_critical_fail_count
    from answer_rows;

    if v_scoring_mode = 'risk_weighted' then
        v_risk_score_percent := case when v_denominator > 0 then round(((v_risk_points / v_denominator) * 100)::numeric, 2) else 0 end;
        v_conformity_percent := round((100 - v_risk_score_percent)::numeric, 2);
        v_score_points := null;
        v_score_max_points := null;
        v_risk_level := case
            when v_risk_score_percent <= 20 then 'CONTROLADO'
            when v_risk_score_percent <= 40 then 'ATENÇÃO'
            when v_risk_score_percent <= 60 then 'ALTO'
            else 'CRÍTICO'
        end;
    elsif v_scoring_mode = 'score_points' then
        v_conformity_percent := case when v_score_max_points > 0 then round(((v_score_points / v_score_max_points) * 100)::numeric, 2) else 100 end;
        v_risk_score_percent := round((100 - v_conformity_percent)::numeric, 2);
        v_risk_level := case
            when v_critical_fail_count > 0 then 'ALTO'
            when v_conformity_percent >= 90 then 'BAIXO'
            when v_conformity_percent >= 70 then 'MÉDIO'
            else 'ALTO'
        end;
    else
        v_conformity_percent := round(((1 - (v_non_conformities::numeric / v_total_items::numeric)) * 100)::numeric, 2);
        v_risk_score_percent := null;
        v_risk_level := null;
        v_score_points := null;
        v_score_max_points := null;
    end if;

    insert into app.checklist_dto_pvps_audits (
        checklist_key,
        checklist_title,
        checklist_version,
        cd,
        evaluated_mat,
        evaluated_nome,
        auditor_id,
        auditor_mat,
        auditor_nome,
        observations,
        signature_accepted,
        signed_at,
        total_items,
        non_conformities,
        conformity_percent,
        scoring_mode,
        risk_score_percent,
        risk_level,
        score_points,
        score_max_points
    )
    values (
        v_checklist_key,
        v_checklist_title,
        v_checklist_version,
        v_cd,
        v_evaluated_mat,
        v_evaluated_nome,
        v_uid,
        coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
        v_observations,
        true,
        now(),
        v_total_items,
        v_non_conformities,
        v_conformity_percent,
        v_scoring_mode,
        v_risk_score_percent,
        v_risk_level,
        v_score_points,
        v_score_max_points
    )
    returning app.checklist_dto_pvps_audits.audit_id, app.checklist_dto_pvps_audits.created_at
    into v_audit_id, v_created_at;

    insert into app.checklist_dto_pvps_answers (
        audit_id,
        item_number,
        section_key,
        section_title,
        question,
        answer,
        is_nonconformity,
        item_weight,
        max_points,
        criticality,
        is_critical,
        earned_points,
        risk_points
    )
    select
        v_audit_id,
        ar.item_number,
        ar.section_key,
        ar.section_title,
        ar.question,
        ar.answer,
        ar.answer = 'Não',
        ar.item_weight,
        ar.max_points,
        ar.criticality,
        ar.is_critical,
        case when v_scoring_mode = 'score_points' and ar.answer = 'Sim' then ar.max_points else 0 end,
        case when v_scoring_mode = 'risk_weighted' and ar.answer = 'Não' then ar.item_weight else 0 end
    from (
        select
            (value ->> 'item_number')::integer as item_number,
            trim(value ->> 'answer') as answer,
            trim(value ->> 'section_key') as section_key,
            trim(value ->> 'section_title') as section_title,
            trim(value ->> 'question') as question,
            case when trim(coalesce(value ->> 'item_weight', '')) ~ '^\d+(\.\d+)?$' then (value ->> 'item_weight')::numeric else null end as item_weight,
            case when trim(coalesce(value ->> 'max_points', '')) ~ '^\d+(\.\d+)?$' then (value ->> 'max_points')::numeric else null end as max_points,
            nullif(trim(coalesce(value ->> 'criticality', '')), '') as criticality,
            coalesce((value ->> 'is_critical')::boolean, false) as is_critical
        from jsonb_array_elements(v_answers)
    ) ar
    order by ar.item_number;

    return query
    select
        a.audit_id,
        a.checklist_key,
        a.checklist_title,
        a.checklist_version,
        a.cd,
        app.checklist_dto_pvps_cd_nome(a.cd) as cd_nome,
        a.evaluated_mat,
        a.evaluated_nome,
        a.auditor_mat,
        a.auditor_nome,
        a.observations,
        a.signature_accepted,
        a.signed_at,
        a.total_items,
        a.non_conformities,
        a.conformity_percent,
        a.scoring_mode,
        a.risk_score_percent,
        a.risk_level,
        a.score_points,
        a.score_max_points,
        a.created_at
    from app.checklist_dto_pvps_audits a
    where a.audit_id = v_audit_id;
end;
$$;

drop function if exists public.rpc_checklist_dto_pvps_admin_list(date, date, integer, text, text, text, integer);

create function public.rpc_checklist_dto_pvps_admin_list(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null,
    p_auditor text default null,
    p_evaluated text default null,
    p_checklist_key text default null,
    p_limit integer default 200
)
returns table (
    audit_id uuid,
    cd integer,
    cd_nome text,
    checklist_key text,
    checklist_title text,
    checklist_version text,
    evaluated_mat text,
    evaluated_nome text,
    auditor_mat text,
    auditor_nome text,
    non_conformities integer,
    conformity_percent numeric,
    scoring_mode text,
    risk_score_percent numeric,
    risk_level text,
    score_points numeric,
    score_max_points numeric,
    created_at timestamptz,
    signed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_role text;
    v_start_ts timestamptz;
    v_end_ts timestamptz;
    v_auditor text;
    v_evaluated text;
    v_checklist_key text;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_role := authz.user_role(v_uid);
    if v_role <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;
    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;
    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;
    if p_dt_fim - p_dt_ini > 90 then
        raise exception 'JANELA_MAX_90_DIAS';
    end if;
    if p_cd is not null and not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, p_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_start_ts := p_dt_ini::timestamp at time zone 'America/Sao_Paulo';
    v_end_ts := (p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo';
    v_auditor := upper(trim(coalesce(p_auditor, '')));
    v_evaluated := upper(trim(coalesce(p_evaluated, '')));
    v_checklist_key := lower(trim(coalesce(p_checklist_key, '')));
    v_limit := least(greatest(coalesce(p_limit, 200), 1), 1000);

    return query
    select
        a.audit_id,
        a.cd,
        app.checklist_dto_pvps_cd_nome(a.cd) as cd_nome,
        a.checklist_key,
        a.checklist_title,
        a.checklist_version,
        a.evaluated_mat,
        a.evaluated_nome,
        a.auditor_mat,
        a.auditor_nome,
        a.non_conformities,
        a.conformity_percent,
        a.scoring_mode,
        a.risk_score_percent,
        a.risk_level,
        a.score_points,
        a.score_max_points,
        a.created_at,
        a.signed_at
    from app.checklist_dto_pvps_audits a
    where a.created_at >= v_start_ts
      and a.created_at < v_end_ts
      and (p_cd is null or a.cd = p_cd)
      and (v_checklist_key = '' or a.checklist_key = v_checklist_key)
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, a.cd)
      )
      and (
          v_auditor = ''
          or upper(trim(a.auditor_mat)) like '%' || v_auditor || '%'
          or upper(trim(a.auditor_nome)) like '%' || v_auditor || '%'
      )
      and (
          v_evaluated = ''
          or upper(trim(a.evaluated_mat)) like '%' || v_evaluated || '%'
          or upper(trim(a.evaluated_nome)) like '%' || v_evaluated || '%'
      )
    order by a.created_at desc, a.audit_id desc
    limit v_limit;
end;
$$;

drop function if exists public.rpc_checklist_dto_pvps_detail(uuid);

create function public.rpc_checklist_dto_pvps_detail(p_audit_id uuid)
returns table (
    audit_id uuid,
    checklist_key text,
    checklist_title text,
    checklist_version text,
    cd integer,
    cd_nome text,
    evaluated_mat text,
    evaluated_nome text,
    auditor_mat text,
    auditor_nome text,
    observations text,
    signature_accepted boolean,
    signed_at timestamptz,
    total_items integer,
    non_conformities integer,
    conformity_percent numeric,
    scoring_mode text,
    risk_score_percent numeric,
    risk_level text,
    score_points numeric,
    score_max_points numeric,
    created_at timestamptz,
    answers jsonb
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;
    if p_audit_id is null then
        raise exception 'AUDITORIA_OBRIGATORIA';
    end if;

    select a.cd
    into v_cd
    from app.checklist_dto_pvps_audits a
    where a.audit_id = p_audit_id;

    if v_cd is null then
        raise exception 'AUDITORIA_NAO_ENCONTRADA';
    end if;
    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    select
        a.audit_id,
        a.checklist_key,
        a.checklist_title,
        a.checklist_version,
        a.cd,
        app.checklist_dto_pvps_cd_nome(a.cd) as cd_nome,
        a.evaluated_mat,
        a.evaluated_nome,
        a.auditor_mat,
        a.auditor_nome,
        a.observations,
        a.signature_accepted,
        a.signed_at,
        a.total_items,
        a.non_conformities,
        a.conformity_percent,
        a.scoring_mode,
        a.risk_score_percent,
        a.risk_level,
        a.score_points,
        a.score_max_points,
        a.created_at,
        coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'item_number', ans.item_number,
                    'section_key', ans.section_key,
                    'section_title', ans.section_title,
                    'question', ans.question,
                    'answer', ans.answer,
                    'is_nonconformity', ans.is_nonconformity,
                    'item_weight', ans.item_weight,
                    'max_points', ans.max_points,
                    'criticality', ans.criticality,
                    'is_critical', ans.is_critical,
                    'earned_points', ans.earned_points,
                    'risk_points', ans.risk_points
                )
                order by ans.item_number
            ) filter (where ans.answer_id is not null),
            '[]'::jsonb
        ) as answers
    from app.checklist_dto_pvps_audits a
    left join app.checklist_dto_pvps_answers ans on ans.audit_id = a.audit_id
    where a.audit_id = p_audit_id
    group by a.audit_id;
end;
$$;

grant execute on function app.checklist_dto_pvps_template_catalog(text) to authenticated;
grant execute on function public.rpc_checklist_dto_pvps_finalize(text, integer, text, text, boolean, jsonb) to authenticated;
grant execute on function public.rpc_checklist_dto_pvps_admin_list(date, date, integer, text, text, text, integer) to authenticated;
grant execute on function public.rpc_checklist_dto_pvps_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
