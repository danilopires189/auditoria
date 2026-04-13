create index if not exists idx_aud_pvps_report_dt_cd
    on app.aud_pvps (dt_hr desc, cd);

create index if not exists idx_aud_alocacao_report_dt_cd
    on app.aud_alocacao (dt_hr desc, cd);

create or replace function public.rpc_vw_auditorias_report_count(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null,
    p_modulo text default 'ambos'
)
returns bigint
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
    v_count bigint := 0;
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

    v_modulo := lower(coalesce(nullif(trim(p_modulo), ''), 'ambos'));
    if v_modulo not in ('pvps', 'alocacao', 'ambos') then
        raise exception 'MODULO_INVALIDO';
    end if;

    if p_cd is not null and not v_is_global_admin and not authz.can_access_cd(v_uid, p_cd) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    if v_modulo in ('pvps', 'ambos') then
        select v_count + count(*)
        into v_count
        from app.aud_pvps ap
        where ap.dt_hr >= v_start_ts
          and ap.dt_hr < v_end_ts
          and (p_cd is null or ap.cd = p_cd)
          and (v_is_global_admin or authz.can_access_cd(v_uid, ap.cd));
    end if;

    if v_modulo in ('alocacao', 'ambos') then
        select v_count + count(*)
        into v_count
        from app.aud_alocacao aa
        where aa.dt_hr >= v_start_ts
          and aa.dt_hr < v_end_ts
          and (p_cd is null or aa.cd = p_cd)
          and (v_is_global_admin or authz.can_access_cd(v_uid, aa.cd));
    end if;

    return coalesce(v_count, 0);
end;
$$;

create or replace function public.rpc_vw_auditorias_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null,
    p_modulo text default 'ambos',
    p_offset integer default 0,
    p_limit integer default 1000
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
    v_offset integer;
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

    v_modulo := lower(coalesce(nullif(trim(p_modulo), ''), 'ambos'));
    if v_modulo not in ('pvps', 'alocacao', 'ambos') then
        raise exception 'MODULO_INVALIDO';
    end if;

    if p_cd is not null and not v_is_global_admin and not authz.can_access_cd(v_uid, p_cd) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 1000);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    return query
    with report_rows as (
        select
            ap.dt_hr,
            ap.cd,
            jsonb_build_object(
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
        where v_modulo in ('pvps', 'ambos')
          and ap.dt_hr >= v_start_ts
          and ap.dt_hr < v_end_ts
          and (p_cd is null or ap.cd = p_cd)
          and (v_is_global_admin or authz.can_access_cd(v_uid, ap.cd))

        union all

        select
            aa.dt_hr,
            aa.cd,
            jsonb_build_object(
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
        where v_modulo in ('alocacao', 'ambos')
          and aa.dt_hr >= v_start_ts
          and aa.dt_hr < v_end_ts
          and (p_cd is null or aa.cd = p_cd)
          and (v_is_global_admin or authz.can_access_cd(v_uid, aa.cd))
    )
    select r.payload
    from report_rows r
    order by r.dt_hr desc, r.cd asc
    offset v_offset
    limit v_limit;
end;
$$;

grant execute on function public.rpc_vw_auditorias_report_count(date, date, integer, text) to authenticated;
grant execute on function public.rpc_vw_auditorias_report_rows(date, date, integer, text, integer, integer) to authenticated;
