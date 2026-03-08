drop function if exists public.rpc_vw_auditorias_report_count(date, date, integer);
drop function if exists public.rpc_vw_auditorias_report_rows(date, date, integer, integer, integer);

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
    v_role text;
    v_start_ts timestamptz;
    v_end_ts timestamptz;
    v_count bigint;
    v_modulo text;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_role := authz.user_role(auth.uid());
    if v_role <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

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

    if p_cd is not null and not authz.can_access_cd(auth.uid(), p_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    select count(*)
    into v_count
    from vw_auditorias v
    where v.dt_hr >= v_start_ts
      and v.dt_hr < v_end_ts
      and (p_cd is null or v.cd = p_cd)
      and (v_modulo = 'ambos' or lower(coalesce(v.modulo, '')) = v_modulo)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), v.cd)
      );

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
    v_role text;
    v_start_ts timestamptz;
    v_end_ts timestamptz;
    v_limit integer;
    v_offset integer;
    v_modulo text;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_role := authz.user_role(auth.uid());
    if v_role <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

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

    if p_cd is not null and not authz.can_access_cd(auth.uid(), p_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 1000);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    return query
    select to_jsonb(v) as payload
    from vw_auditorias v
    where v.dt_hr >= v_start_ts
      and v.dt_hr < v_end_ts
      and (p_cd is null or v.cd = p_cd)
      and (v_modulo = 'ambos' or lower(coalesce(v.modulo, '')) = v_modulo)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), v.cd)
      )
    order by v.dt_hr desc, v.cd asc
    offset v_offset
    limit v_limit;
end;
$$;

grant execute on function public.rpc_vw_auditorias_report_count(date, date, integer, text) to authenticated;
grant execute on function public.rpc_vw_auditorias_report_rows(date, date, integer, text, integer, integer) to authenticated;
