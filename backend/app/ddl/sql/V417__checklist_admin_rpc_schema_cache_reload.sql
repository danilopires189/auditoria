drop function if exists public.rpc_checklist_dto_pvps_admin_list(date, date, integer, text, text, integer);
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

grant execute on function public.rpc_checklist_dto_pvps_admin_list(date, date, integer, text, text, text, integer) to authenticated;

notify pgrst, 'reload schema';
