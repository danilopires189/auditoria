create index if not exists idx_caixa_termica_report_cursor_cd_data_hr_id
    on app.controle_caixa_termica_movs (cd, data_hr desc, id desc);

create index if not exists idx_caixa_termica_report_cursor_data_hr_id
    on app.controle_caixa_termica_movs (data_hr desc, id desc);

create or replace function public.rpc_caixa_termica_report_count(
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
    v_cd integer;
    v_start_ts timestamptz;
    v_end_ts timestamptz;
    v_count bigint;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
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

    v_cd := coalesce(
        p_cd,
        (select cd_default from authz.profiles where user_id = auth.uid() limit 1)
    );
    if v_cd is null then
        raise exception 'CD_NAO_DEFINIDO_USUARIO';
    end if;

    if not authz.can_access_cd(auth.uid(), v_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    select count(*)
    into v_count
    from app.controle_caixa_termica_movs m
    join app.controle_caixa_termica c on c.id = m.caixa_id
    where m.cd = v_cd
      and c.deleted_at is null
      and m.data_hr >= v_start_ts
      and m.data_hr < v_end_ts;

    return v_count;
end;
$$;

create or replace function public.rpc_caixa_termica_report_rows_cursor(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null,
    p_cursor_dt timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 1000
)
returns table (
    id uuid,
    caixa_id uuid,
    codigo_caixa text,
    descricao text,
    capacidade_litros integer,
    marca text,
    tipo text,
    cd integer,
    data_hr timestamptz,
    etiqueta_volume text,
    filial integer,
    filial_nome text,
    rota text,
    pedido bigint,
    data_pedido date,
    placa text,
    obs_recebimento text,
    mat_resp text,
    nome_resp text
)
language plpgsql
stable
security invoker
set search_path = app, authz, public
as $$
declare
    v_role text;
    v_cd integer;
    v_start_ts timestamptz;
    v_end_ts timestamptz;
    v_limit integer;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
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

    if (p_cursor_dt is null) <> (p_cursor_id is null) then
        raise exception 'CURSOR_INVALIDO';
    end if;

    v_cd := coalesce(
        p_cd,
        (select cd_default from authz.profiles where user_id = auth.uid() limit 1)
    );
    if v_cd is null then
        raise exception 'CD_NAO_DEFINIDO_USUARIO';
    end if;

    if not authz.can_access_cd(auth.uid(), v_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 1000);
    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    return query
    select
        m.id,
        m.caixa_id,
        c.codigo as codigo_caixa,
        c.descricao,
        c.capacidade_litros,
        c.marca,
        m.tipo,
        m.cd,
        m.data_hr,
        m.etiqueta_volume,
        m.filial,
        m.filial_nome,
        m.rota,
        m.pedido,
        m.data_pedido,
        m.placa,
        m.obs_recebimento,
        m.mat_resp,
        m.nome_resp
    from app.controle_caixa_termica_movs m
    join app.controle_caixa_termica c on c.id = m.caixa_id
    where m.cd = v_cd
      and c.deleted_at is null
      and m.data_hr >= v_start_ts
      and m.data_hr < v_end_ts
      and (
          p_cursor_dt is null
          or m.data_hr < p_cursor_dt
          or (m.data_hr = p_cursor_dt and m.id < p_cursor_id)
      )
    order by m.data_hr desc, m.id desc
    limit v_limit;
end;
$$;

grant execute on function public.rpc_caixa_termica_report_count(date, date, integer) to authenticated;
grant execute on function public.rpc_caixa_termica_report_rows_cursor(date, date, integer, timestamptz, uuid, integer) to authenticated;
