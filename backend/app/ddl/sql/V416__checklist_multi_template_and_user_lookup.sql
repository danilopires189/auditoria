alter table app.checklist_dto_pvps_audits
    alter column checklist_key drop default,
    alter column checklist_title drop default;

alter table app.checklist_dto_pvps_audits
    drop constraint if exists ck_checklist_dto_pvps_total_items,
    drop constraint if exists ck_checklist_dto_pvps_non_conformities;

alter table app.checklist_dto_pvps_audits
    add constraint ck_checklist_dto_pvps_total_items check (total_items in (9, 17)),
    add constraint ck_checklist_dto_pvps_non_conformities check (non_conformities between 0 and total_items);

alter table app.checklist_dto_pvps_answers
    drop constraint if exists checklist_dto_pvps_answers_item_number_check,
    drop constraint if exists checklist_dto_pvps_answers_section_key_check,
    drop constraint if exists ck_checklist_dto_pvps_answers_item_number,
    drop constraint if exists ck_checklist_dto_pvps_answers_section_key;

alter table app.checklist_dto_pvps_answers
    add constraint ck_checklist_dto_pvps_answers_item_number check (item_number between 1 and 17),
    add constraint ck_checklist_dto_pvps_answers_section_key check (section_key in ('zona_separacao', 'pulmao', 'alocacao'));

create index if not exists idx_checklist_dto_pvps_audits_key_created
    on app.checklist_dto_pvps_audits(checklist_key, created_at desc);

drop function if exists public.rpc_checklist_dto_pvps_finalize(integer, text, text, text, boolean, jsonb);
drop function if exists public.rpc_checklist_dto_pvps_admin_list(date, date, integer, text, text, integer);
drop function if exists app.checklist_dto_pvps_item_catalog();

create or replace function app.checklist_dto_pvps_item_catalog(p_checklist_key text default 'dto_pvps')
returns table (
    checklist_key text,
    checklist_title text,
    checklist_version text,
    total_items integer,
    item_number integer,
    section_key text,
    section_title text,
    question text
)
language sql
immutable
as $$
    select *
    from (
        values
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 1, 'zona_separacao', 'Zona de Separação', 'O flow rack contém o produto?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 2, 'zona_separacao', 'Zona de Separação', 'O colaborador está informando a data de validade corretamente?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 3, 'zona_separacao', 'Zona de Separação', 'O colaborador verifica se o endereço está com várias validades?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 4, 'zona_separacao', 'Zona de Separação', 'O colaborador está informando a validade mais próxima?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 5, 'zona_separacao', 'Zona de Separação', 'Existem coletores disponíveis?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 6, 'zona_separacao', 'Zona de Separação', 'O colaborador identifica o produto corretamente? (Verificando a descrição do produto)'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 7, 'zona_separacao', 'Zona de Separação', 'O endereço está desobstruído e com acesso livre?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 8, 'zona_separacao', 'Zona de Separação', 'Todos os produtos estão dentro da política de envio e dentro do prazo de validade?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 9, 'zona_separacao', 'Zona de Separação', 'Todos os produtos no flow rack estão segregados por SKU e lote (sem mistura)?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 10, 'zona_separacao', 'Zona de Separação', 'Todos os produtos armazenados no flow rack estão íntegros (sem avarias)?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 11, 'pulmao', 'Pulmão', 'O produto está no endereço indicado?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 12, 'pulmao', 'Pulmão', 'O produto possui alguma identificação? (Etiqueta Pulmão)'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 13, 'pulmao', 'Pulmão', 'O endereço está desobstruído e com acesso livre?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 14, 'pulmao', 'Pulmão', 'O produto está de fácil acesso?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 15, 'pulmao', 'Pulmão', 'A validade sinalizada na caixa padrão do fornecedor pela Logística está correta?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 16, 'pulmao', 'Pulmão', 'Todos os produtos armazenados no pulmão estão dentro da política e dentro do prazo de validade?'),
            ('dto_pvps', 'DTO - Auditoria de PVPS', '1.0', 17, 17, 'pulmao', 'Pulmão', 'Os produtos armazenados no pulmão estão íntegros (sem avarias)?'),
            ('dto_alocacao', 'DTO - Auditoria de Alocação', '1.0', 9, 1, 'alocacao', 'Alocação', 'Existem coletores disponíveis?'),
            ('dto_alocacao', 'DTO - Auditoria de Alocação', '1.0', 9, 2, 'alocacao', 'Alocação', 'Os endereços estão visíveis?'),
            ('dto_alocacao', 'DTO - Auditoria de Alocação', '1.0', 9, 3, 'alocacao', 'Alocação', 'O endereço está desobstruído e com acesso livre?'),
            ('dto_alocacao', 'DTO - Auditoria de Alocação', '1.0', 9, 4, 'alocacao', 'Alocação', 'O colaborador confere a data de validade do produto?'),
            ('dto_alocacao', 'DTO - Auditoria de Alocação', '1.0', 9, 5, 'alocacao', 'Alocação', 'O colaborador retorna o volume para o endereço correto?'),
            ('dto_alocacao', 'DTO - Auditoria de Alocação', '1.0', 9, 6, 'alocacao', 'Alocação', 'O colaborador organizou o volume que conferiu?'),
            ('dto_alocacao', 'DTO - Auditoria de Alocação', '1.0', 9, 7, 'alocacao', 'Alocação', 'O colaborador sinaliza a não conformidade?'),
            ('dto_alocacao', 'DTO - Auditoria de Alocação', '1.0', 9, 8, 'alocacao', 'Alocação', 'O colaborador registra com foto a não conformidade?'),
            ('dto_alocacao', 'DTO - Auditoria de Alocação', '1.0', 9, 9, 'alocacao', 'Alocação', 'A supervisão de logística acompanha as anomalias apontadas na auditoria?')
    ) as catalog(
        checklist_key,
        checklist_title,
        checklist_version,
        total_items,
        item_number,
        section_key,
        section_title,
        question
    )
    where catalog.checklist_key = lower(trim(coalesce(p_checklist_key, 'dto_pvps')))
$$;

create or replace function public.rpc_checklist_dto_pvps_lookup_evaluated(
    p_cd integer default null,
    p_mat text default null
)
returns table (
    cd integer,
    mat text,
    nome text,
    cargo text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mat text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.checklist_dto_pvps_resolve_cd(p_cd);
    v_mat := authz.normalize_mat(p_mat);
    if v_mat = '' then
        raise exception 'AVALIADO_MATRICULA_OBRIGATORIA';
    end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    select
        u.cd,
        authz.normalize_mat(u.mat) as mat,
        coalesce(nullif(trim(u.nome), ''), 'USUARIO') as nome,
        nullif(trim(coalesce(u.cargo, '')), '') as cargo
    from app.db_usuario u
    where u.cd = v_cd
      and authz.normalize_mat(u.mat) = v_mat
    order by u.updated_at desc nulls last, u.nome
    limit 1;

    if not found then
        raise exception 'AVALIADO_NAO_ENCONTRADO';
    end if;
end;
$$;

create or replace function public.rpc_checklist_dto_pvps_finalize(
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
    v_evaluated_mat text;
    v_evaluated_nome text;
    v_observations text;
    v_total_count integer;
    v_distinct_count integer;
    v_invalid_count integer;
    v_missing_count integer;
    v_non_conformities integer;
    v_conformity_percent numeric;
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
        c.total_items
    into
        v_checklist_title,
        v_checklist_version,
        v_total_items
    from app.checklist_dto_pvps_item_catalog(v_checklist_key) c
    limit 1;

    if v_total_items is null then
        raise exception 'CHECKLIST_INVALIDO';
    end if;

    v_evaluated_mat := authz.normalize_mat(p_evaluated_mat);
    v_observations := nullif(trim(coalesce(p_observations, '')), '');

    if v_evaluated_mat = '' then
        raise exception 'AVALIADO_MATRICULA_OBRIGATORIA';
    end if;
    if not coalesce(p_signature_accepted, false) then
        raise exception 'ASSINATURA_ELETRONICA_OBRIGATORIA';
    end if;

    v_cd := app.checklist_dto_pvps_resolve_cd(p_cd);

    select row.nome
    into v_evaluated_nome
    from public.rpc_checklist_dto_pvps_lookup_evaluated(v_cd, v_evaluated_mat) row
    limit 1;

    if v_evaluated_nome is null then
        raise exception 'AVALIADO_NAO_ENCONTRADO';
    end if;

    v_answers := coalesce(p_answers, '[]'::jsonb);
    if jsonb_typeof(v_answers) <> 'array' then
        raise exception 'RESPOSTAS_INVALIDAS';
    end if;

    with answer_rows as (
        select
            case when (value ->> 'item_number') ~ '^\d+$' then (value ->> 'item_number')::integer else null end as item_number,
            trim(coalesce(value ->> 'answer', '')) as answer
        from jsonb_array_elements(v_answers)
    )
    select
        count(*)::integer,
        count(distinct item_number)::integer,
        count(*) filter (where item_number is null or answer not in ('Sim', 'Não', 'N.A.'))::integer,
        count(*) filter (where answer = 'Não')::integer
    into v_total_count, v_distinct_count, v_invalid_count, v_non_conformities
    from answer_rows;

    with answer_rows as (
        select
            case when (value ->> 'item_number') ~ '^\d+$' then (value ->> 'item_number')::integer else null end as item_number,
            trim(coalesce(value ->> 'answer', '')) as answer
        from jsonb_array_elements(v_answers)
    )
    select count(*)::integer
    into v_missing_count
    from app.checklist_dto_pvps_item_catalog(v_checklist_key) c
    left join answer_rows ar on ar.item_number = c.item_number
    where ar.item_number is null;

    if v_total_count <> v_total_items or v_distinct_count <> v_total_items or v_invalid_count > 0 or v_missing_count > 0 then
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

    v_conformity_percent := round(((1 - (v_non_conformities::numeric / v_total_items::numeric)) * 100)::numeric, 2);

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
        conformity_percent
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
        v_conformity_percent
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
        is_nonconformity
    )
    with answer_rows as (
        select
            (value ->> 'item_number')::integer as item_number,
            trim(value ->> 'answer') as answer
        from jsonb_array_elements(v_answers)
    )
    select
        v_audit_id,
        c.item_number,
        c.section_key,
        c.section_title,
        c.question,
        ar.answer,
        ar.answer = 'Não'
    from app.checklist_dto_pvps_item_catalog(v_checklist_key) c
    join answer_rows ar on ar.item_number = c.item_number
    order by c.item_number;

    return query
    select
        a.audit_id,
        a.checklist_key,
        a.checklist_title,
        a.checklist_version,
        a.cd,
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
        a.created_at
    from app.checklist_dto_pvps_audits a
    where a.audit_id = v_audit_id;
end;
$$;

create or replace function public.rpc_checklist_dto_pvps_admin_list(
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
    checklist_key text,
    checklist_title text,
    checklist_version text,
    evaluated_mat text,
    evaluated_nome text,
    auditor_mat text,
    auditor_nome text,
    non_conformities integer,
    conformity_percent numeric,
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
        a.checklist_key,
        a.checklist_title,
        a.checklist_version,
        a.evaluated_mat,
        a.evaluated_nome,
        a.auditor_mat,
        a.auditor_nome,
        a.non_conformities,
        a.conformity_percent,
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

create or replace function public.rpc_checklist_dto_pvps_detail(p_audit_id uuid)
returns table (
    audit_id uuid,
    checklist_key text,
    checklist_title text,
    checklist_version text,
    cd integer,
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
        a.created_at,
        coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'item_number', ans.item_number,
                    'section_key', ans.section_key,
                    'section_title', ans.section_title,
                    'question', ans.question,
                    'answer', ans.answer,
                    'is_nonconformity', ans.is_nonconformity
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

grant execute on function public.rpc_checklist_dto_pvps_lookup_evaluated(integer, text) to authenticated;
grant execute on function public.rpc_checklist_dto_pvps_finalize(text, integer, text, text, boolean, jsonb) to authenticated;
grant execute on function public.rpc_checklist_dto_pvps_admin_list(date, date, integer, text, text, text, integer) to authenticated;
grant execute on function public.rpc_checklist_dto_pvps_detail(uuid) to authenticated;
