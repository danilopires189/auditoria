create or replace function public.rpc_vw_auditorias_report_count(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null
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
    p_limit integer default 20000
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
    v_count bigint;
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

    if p_cd is not null and not authz.can_access_cd(auth.uid(), p_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 20000), 1), 50000);
    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    select public.rpc_vw_auditorias_report_count(p_dt_ini, p_dt_fim, p_cd)
    into v_count;

    if v_count > v_limit then
        raise exception 'RELATORIO_MUITO_GRANDE_%', v_count;
    end if;

    return query
    select to_jsonb(v) as payload
    from vw_auditorias v
    where v.dt_hr >= v_start_ts
      and v.dt_hr < v_end_ts
      and (p_cd is null or v.cd = p_cd)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), v.cd)
      )
    order by v.dt_hr desc, v.cd asc
    limit v_limit;
end;
$$;

grant execute on function public.rpc_vw_auditorias_report_count(date, date, integer) to authenticated;
grant execute on function public.rpc_vw_auditorias_report_rows(date, date, integer, integer) to authenticated;
