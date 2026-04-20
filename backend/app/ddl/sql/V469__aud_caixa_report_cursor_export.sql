create index if not exists idx_aud_caixa_report_cursor_cd_data_hr_id
    on app.aud_caixa (cd, data_hr desc, id desc);

create index if not exists idx_aud_caixa_report_cursor_data_hr_id
    on app.aud_caixa (data_hr desc, id desc);

create or replace function public.rpc_aud_caixa_report_rows_cursor(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer default null,
    p_cursor_dt timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 1000
)
returns table (
    id uuid,
    etiqueta text,
    id_knapp text,
    cd integer,
    pedido bigint,
    data_pedido date,
    dv text,
    filial bigint,
    filial_nome text,
    uf text,
    rota text,
    volume text,
    ocorrencia text,
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

    if (p_cursor_dt is null) <> (p_cursor_id is null) then
        raise exception 'CURSOR_INVALIDO';
    end if;

    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 1000);
    v_start_ts := (p_dt_ini::timestamp at time zone 'America/Sao_Paulo');
    v_end_ts := ((p_dt_fim + 1)::timestamp at time zone 'America/Sao_Paulo');

    return query
    select
        c.id,
        c.etiqueta,
        c.id_knapp,
        c.cd,
        c.pedido,
        c.data_pedido,
        c.dv,
        c.filial,
        c.filial_nome,
        c.uf,
        c.rota,
        c.volume,
        c.ocorrencia,
        c.mat_aud,
        c.nome_aud,
        c.user_id,
        c.data_hr,
        c.created_at,
        c.updated_at
    from app.aud_caixa c
    where c.data_hr >= v_start_ts
      and c.data_hr < v_end_ts
      and (p_cd is null or c.cd = p_cd)
      and (
          authz.is_admin(auth.uid())
          or authz.can_access_cd(auth.uid(), c.cd)
      )
      and (
          p_cursor_dt is null
          or c.data_hr < p_cursor_dt
          or (c.data_hr = p_cursor_dt and c.id < p_cursor_id)
      )
    order by c.data_hr desc, c.id desc
    limit v_limit;
end;
$$;

grant execute on function public.rpc_aud_caixa_report_rows_cursor(date, date, integer, timestamptz, uuid, integer) to authenticated;
