create index if not exists idx_aud_pvps_report_cursor_cd_dt_id
    on app.aud_pvps (cd, dt_hr desc, audit_id desc);

create index if not exists idx_aud_pvps_report_cursor_dt_id
    on app.aud_pvps (dt_hr desc, audit_id desc);

create index if not exists idx_aud_alocacao_report_cursor_cd_dt_id
    on app.aud_alocacao (cd, dt_hr desc, audit_id desc);

create index if not exists idx_aud_alocacao_report_cursor_dt_id
    on app.aud_alocacao (dt_hr desc, audit_id desc);

create or replace function public.rpc_pvps_alocacao_report_rows_cursor(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null,
    p_modulo text default 'alocacao',
    p_cursor_dt timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 500
)
returns table (
    payload jsonb
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_is_global_admin boolean;
    v_start_ts timestamptz;
    v_end_ts timestamptz;
    v_limit integer;
    v_modulo text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    v_is_global_admin := authz.is_admin(v_uid);

    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if p_dt_fim - p_dt_ini > 31 then
        raise exception 'JANELA_MAX_31_DIAS';
    end if;

    v_modulo := lower(coalesce(nullif(trim(p_modulo), ''), 'alocacao'));
    if v_modulo not in ('pvps', 'alocacao') then
        raise exception 'MODULO_INVALIDO';
    end if;

    if p_cd is not null and not v_is_global_admin and not authz.can_access_cd(v_uid, p_cd) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    if (p_cursor_dt is null) <> (p_cursor_id is null) then
        raise exception 'CURSOR_INVALIDO';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 500), 1), 1000);
    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    if v_modulo = 'alocacao' then
        return query
        select jsonb_build_object(
            'audit_id', aa.audit_id,
            'auditor_id', aa.auditor_id,
            'queue_id', aa.queue_id,
            'dt_hr', aa.dt_hr,
            'cd', aa.cd,
            'modulo', 'alocacao',
            'coddv', aa.coddv,
            'descricao', aa.descricao,
            'zona', aa.zona,
            'endereco', aa.endereco,
            'nivel', aa.nivel,
            'end_sit', aa.end_sit,
            'val_sist', aa.val_sist,
            'val_conf', aa.val_conf,
            'aud_sit', aa.aud_sit,
            'auditor_mat', aa.auditor_mat,
            'auditor_nome', aa.auditor_nome
        ) as payload
        from app.aud_alocacao aa
        where aa.dt_hr >= v_start_ts
          and aa.dt_hr < v_end_ts
          and (p_cd is null or aa.cd = p_cd)
          and (v_is_global_admin or authz.can_access_cd(v_uid, aa.cd))
          and (
              p_cursor_dt is null
              or aa.dt_hr < p_cursor_dt
              or (aa.dt_hr = p_cursor_dt and aa.audit_id < p_cursor_id)
          )
        order by aa.dt_hr desc, aa.audit_id desc
        limit v_limit;
        return;
    end if;

    return query
    select jsonb_build_object(
        'audit_id', ap.audit_id,
        'auditor_id', ap.auditor_id,
        'dt_hr', ap.dt_hr,
        'dt_hr_sep', coalesce(ap.dt_hr_sep, ap.dt_hr),
        'cd', ap.cd,
        'modulo', 'pvps',
        'coddv', ap.coddv,
        'descricao', ap.descricao,
        'zona', ap.zona,
        'endereco', ap.end_sep,
        'end_sep', ap.end_sep,
        'status', ap.status,
        'end_sit', ap.end_sit,
        'val_sep', ap.val_sep,
        'auditor_mat', ap.auditor_mat,
        'auditor_nome', ap.auditor_nome
    ) as payload
    from app.aud_pvps ap
    where ap.dt_hr >= v_start_ts
      and ap.dt_hr < v_end_ts
      and (p_cd is null or ap.cd = p_cd)
      and (v_is_global_admin or authz.can_access_cd(v_uid, ap.cd))
      and (
          p_cursor_dt is null
          or ap.dt_hr < p_cursor_dt
          or (ap.dt_hr = p_cursor_dt and ap.audit_id < p_cursor_id)
      )
    order by ap.dt_hr desc, ap.audit_id desc
    limit v_limit;
end;
$$;

grant execute on function public.rpc_pvps_alocacao_report_rows_cursor(date, date, integer, text, timestamptz, uuid, integer) to authenticated;
