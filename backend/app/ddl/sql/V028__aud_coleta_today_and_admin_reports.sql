create or replace function public.rpc_aud_coleta_today(
    p_cd integer,
    p_limit integer default 1000
)
returns table (
    id uuid,
    etiqueta text,
    cd integer,
    barras text,
    coddv integer,
    descricao text,
    qtd integer,
    ocorrencia text,
    lote text,
    val_mmaa char(4),
    mat_aud text,
    nome_aud text,
    user_id uuid,
    data_hr timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language sql
stable
security invoker
set search_path = app, authz, public
as $$
    with bounds as (
        select
            (timezone('America/Sao_Paulo', now()))::date as today_br
    )
    select
        c.id,
        c.etiqueta,
        c.cd,
        c.barras,
        c.coddv,
        c.descricao,
        c.qtd,
        c.ocorrencia,
        c.lote,
        c.val_mmaa,
        c.mat_aud,
        c.nome_aud,
        c.user_id,
        c.data_hr,
        c.created_at,
        c.updated_at
    from app.aud_coleta c
    cross join bounds b
    where authz.session_is_recent(6)
      and p_cd is not null
      and c.cd = p_cd
      and c.data_hr >= (b.today_br::timestamp at time zone 'America/Sao_Paulo')
      and c.data_hr < ((b.today_br + 1)::timestamp at time zone 'America/Sao_Paulo')
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      )
    order by c.data_hr desc, c.id desc
    limit least(greatest(coalesce(p_limit, 1000), 1), 3000);
$$;

create or replace function public.rpc_aud_coleta_report_count(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null
)
returns bigint
language plpgsql
stable
security invoker
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
    from app.aud_coleta c
    where c.data_hr >= v_start_ts
      and c.data_hr < v_end_ts
      and (p_cd is null or c.cd = p_cd)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      );

    return v_count;
end;
$$;

create or replace function public.rpc_aud_coleta_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null,
    p_limit integer default 20000
)
returns table (
    id uuid,
    etiqueta text,
    cd integer,
    barras text,
    coddv integer,
    descricao text,
    qtd integer,
    ocorrencia text,
    lote text,
    val_mmaa char(4),
    mat_aud text,
    nome_aud text,
    user_id uuid,
    data_hr timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
stable
security invoker
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

    select count(*)
    into v_count
    from app.aud_coleta c
    where c.data_hr >= v_start_ts
      and c.data_hr < v_end_ts
      and (p_cd is null or c.cd = p_cd)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      );

    if v_count > v_limit then
        raise exception 'RELATORIO_MUITO_GRANDE_%', v_count;
    end if;

    return query
    select
        c.id,
        c.etiqueta,
        c.cd,
        c.barras,
        c.coddv,
        c.descricao,
        c.qtd,
        c.ocorrencia,
        c.lote,
        c.val_mmaa,
        c.mat_aud,
        c.nome_aud,
        c.user_id,
        c.data_hr,
        c.created_at,
        c.updated_at
    from app.aud_coleta c
    where c.data_hr >= v_start_ts
      and c.data_hr < v_end_ts
      and (p_cd is null or c.cd = p_cd)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      )
    order by c.data_hr desc, c.id desc
    limit v_limit;
end;
$$;

grant execute on function public.rpc_aud_coleta_today(integer, integer) to authenticated;
grant execute on function public.rpc_aud_coleta_report_count(date, date, integer) to authenticated;
grant execute on function public.rpc_aud_coleta_report_rows(date, date, integer, integer) to authenticated;
