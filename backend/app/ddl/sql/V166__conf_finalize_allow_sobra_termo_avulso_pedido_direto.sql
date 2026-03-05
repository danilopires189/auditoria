-- Permite finalizar conferencias com sobra nos modulos:
-- termo, volume avulso e pedido direto.
-- Mantem obrigatoriedade de motivo apenas quando houver falta.

create or replace function public.rpc_conf_termo_finalize(
    p_conf_id uuid,
    p_falta_motivo text default null
)
returns table (
    conf_id uuid,
    status text,
    falta_count integer,
    sobra_count integer,
    correto_count integer,
    falta_motivo text,
    finalized_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_termo%rowtype;
    v_falta_count integer;
    v_sobra_count integer;
    v_correto_count integer;
    v_status text;
    v_motivo text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_conf
    from app.conf_termo c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_JA_FINALIZADA';
    end if;

    select
        count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer
    into
        v_falta_count,
        v_sobra_count,
        v_correto_count
    from app.conf_termo_itens i
    where i.conf_id = v_conf.conf_id;

    v_motivo := nullif(trim(coalesce(p_falta_motivo, '')), '');
    if coalesce(v_falta_count, 0) > 0 and v_motivo is null then
        raise exception 'FALTA_MOTIVO_OBRIGATORIO';
    end if;

    v_status := case
        when coalesce(v_falta_count, 0) > 0 then 'finalizado_falta'
        else 'finalizado_ok'
    end;

    update app.conf_termo c
    set
        status = v_status,
        falta_motivo = case when v_status = 'finalizado_falta' then v_motivo else null end,
        finalized_at = now(),
        updated_at = now()
    where c.conf_id = v_conf.conf_id
    returning * into v_conf;

    return query
    select
        v_conf.conf_id,
        v_conf.status,
        coalesce(v_falta_count, 0),
        coalesce(v_sobra_count, 0),
        coalesce(v_correto_count, 0),
        v_conf.falta_motivo,
        v_conf.finalized_at;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_finalize(
    p_conf_id uuid,
    p_falta_motivo text default null
)
returns table (
    conf_id uuid,
    status text,
    falta_count integer,
    sobra_count integer,
    correto_count integer,
    falta_motivo text,
    finalized_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_pedido_direto%rowtype;
    v_falta_count integer;
    v_sobra_count integer;
    v_correto_count integer;
    v_status text;
    v_motivo text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_conf
    from app.conf_pedido_direto c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_JA_FINALIZADA';
    end if;

    select
        count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer
    into
        v_falta_count,
        v_sobra_count,
        v_correto_count
    from app.conf_pedido_direto_itens i
    where i.conf_id = v_conf.conf_id;

    v_motivo := nullif(trim(coalesce(p_falta_motivo, '')), '');
    if coalesce(v_falta_count, 0) > 0 and v_motivo is null then
        raise exception 'FALTA_MOTIVO_OBRIGATORIO';
    end if;

    v_status := case
        when coalesce(v_falta_count, 0) > 0 then 'finalizado_falta'
        else 'finalizado_ok'
    end;

    update app.conf_pedido_direto c
    set
        status = v_status,
        falta_motivo = case when v_status = 'finalizado_falta' then v_motivo else null end,
        finalized_at = now(),
        updated_at = now()
    where c.conf_id = v_conf.conf_id
    returning * into v_conf;

    return query
    select
        v_conf.conf_id,
        v_conf.status,
        coalesce(v_falta_count, 0),
        coalesce(v_sobra_count, 0),
        coalesce(v_correto_count, 0),
        v_conf.falta_motivo,
        v_conf.finalized_at;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_finalize(
    p_conf_id uuid,
    p_falta_motivo text default null
)
returns table (
    conf_id uuid,
    status text,
    falta_count integer,
    sobra_count integer,
    correto_count integer,
    falta_motivo text,
    finalized_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_volume_avulso%rowtype;
    v_falta_count integer;
    v_sobra_count integer;
    v_correto_count integer;
    v_status text;
    v_motivo text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_id = p_conf_id
      and c.started_by = v_uid
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if v_conf.status <> 'em_conferencia' then
        raise exception 'CONFERENCIA_JA_FINALIZADA';
    end if;

    select
        count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida = i.qtd_esperada)::integer
    into
        v_falta_count,
        v_sobra_count,
        v_correto_count
    from app.conf_volume_avulso_itens i
    where i.conf_id = v_conf.conf_id;

    v_motivo := nullif(trim(coalesce(p_falta_motivo, '')), '');
    if coalesce(v_falta_count, 0) > 0 and v_motivo is null then
        raise exception 'FALTA_MOTIVO_OBRIGATORIO';
    end if;

    v_status := case
        when coalesce(v_falta_count, 0) > 0 then 'finalizado_falta'
        else 'finalizado_ok'
    end;

    update app.conf_volume_avulso c
    set
        status = v_status,
        falta_motivo = case when v_status = 'finalizado_falta' then v_motivo else null end,
        finalized_at = now(),
        updated_at = now()
    where c.conf_id = v_conf.conf_id
    returning * into v_conf;

    return query
    select
        v_conf.conf_id,
        v_conf.status,
        coalesce(v_falta_count, 0),
        coalesce(v_sobra_count, 0),
        coalesce(v_correto_count, 0),
        v_conf.falta_motivo,
        v_conf.finalized_at;
end;
$$;

grant execute on function public.rpc_conf_termo_finalize(uuid, text) to authenticated;
grant execute on function public.rpc_conf_pedido_direto_finalize(uuid, text) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_finalize(uuid, text) to authenticated;
