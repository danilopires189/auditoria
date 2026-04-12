create or replace function app.checklist_dto_pvps_cd_nome(p_cd integer)
returns text
language sql
stable
security definer
set search_path = app, authz, public
as $$
    select
        case
            when p_cd is null then 'CD não definido'
            else coalesce(
                (
                    select
                        case
                            when s.raw_nome ~* '^cd\s*0*\d+' then s.raw_nome
                            else format('CD %s - %s', lpad(p_cd::text, 2, '0'), s.raw_nome)
                        end
                    from (
                        select min(nullif(trim(u.cd_nome), '')) as raw_nome
                        from app.db_usuario u
                        where u.cd = p_cd
                    ) s
                    where s.raw_nome is not null
                ),
                format('CD %s', lpad(p_cd::text, 2, '0'))
            )
        end
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

grant execute on function public.rpc_checklist_dto_pvps_admin_list(date, date, integer, text, text, text, integer) to authenticated;
grant execute on function public.rpc_checklist_dto_pvps_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
