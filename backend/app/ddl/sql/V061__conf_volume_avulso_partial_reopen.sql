drop function if exists public.rpc_conf_volume_avulso_get_partial_reopen_info(text, integer);
drop function if exists public.rpc_conf_volume_avulso_reopen_partial_conference(text, integer);

create or replace function public.rpc_conf_volume_avulso_get_partial_reopen_info(
    p_nr_volume text,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    nr_volume text,
    status text,
    previous_started_by uuid,
    previous_started_mat text,
    previous_started_nome text,
    locked_items integer,
    pending_items integer,
    can_reopen boolean
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_tag text;
    v_today date;
    v_conf app.conf_volume_avulso%rowtype;
    v_locked_items integer := 0;
    v_pending_items integer := 0;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);
    v_tag := nullif(trim(coalesce(p_nr_volume, '')), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'VOLUME_OBRIGATORIO';
    end if;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.nr_volume = v_tag
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if v_conf.started_by <> v_uid then
        if v_conf.status = 'em_conferencia' then
            raise exception 'VOLUME_EM_USO';
        end if;
        raise exception 'VOLUME_JA_CONFERIDO_OUTRO_USUARIO';
    end if;

    select
        count(*) filter (where i.qtd_conferida >= i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida < i.qtd_esperada)::integer
    into
        v_locked_items,
        v_pending_items
    from app.conf_volume_avulso_itens i
    where i.conf_id = v_conf.conf_id;

    return query
    select
        v_conf.conf_id,
        v_conf.nr_volume,
        v_conf.status,
        v_conf.started_by,
        v_conf.started_mat,
        v_conf.started_nome,
        coalesce(v_locked_items, 0),
        coalesce(v_pending_items, 0),
        (
            v_conf.status = 'finalizado_falta'
            and coalesce(v_pending_items, 0) > 0
        );
end;
$$;

create or replace function public.rpc_conf_volume_avulso_reopen_partial_conference(
    p_nr_volume text,
    p_cd integer default null
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    nr_volume text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
    status text,
    falta_motivo text,
    started_by uuid,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    is_read_only boolean
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_tag text;
    v_today date;
    v_conf app.conf_volume_avulso%rowtype;
    v_user_active app.conf_volume_avulso%rowtype;
    v_profile record;
    v_pending_items integer := 0;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_volume_avulso_autoclose_stale();

    v_cd := app.conf_volume_avulso_resolve_cd(p_cd);
    v_tag := nullif(trim(coalesce(p_nr_volume, '')), '');
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    if v_tag is null then
        raise exception 'VOLUME_OBRIGATORIO';
    end if;

    select *
    into v_user_active
    from app.conf_volume_avulso c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and (v_user_active.cd <> v_cd or v_user_active.nr_volume <> v_tag) then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRO_VOLUME';
    end if;

    select *
    into v_conf
    from app.conf_volume_avulso c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.nr_volume = v_tag
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    for update
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if v_conf.started_by <> v_uid then
        if v_conf.status = 'em_conferencia' then
            raise exception 'VOLUME_EM_USO';
        end if;
        raise exception 'VOLUME_JA_CONFERIDO_OUTRO_USUARIO';
    end if;

    if v_conf.status = 'em_conferencia' then
        return query
        select
            v_conf.conf_id,
            v_conf.conf_date,
            v_conf.cd,
            v_conf.nr_volume,
            v_conf.caixa,
            v_conf.pedido,
            v_conf.filial,
            v_conf.filial_nome,
            v_conf.rota,
            v_conf.status,
            v_conf.falta_motivo,
            v_conf.started_by,
            v_conf.started_mat,
            v_conf.started_nome,
            v_conf.started_at,
            v_conf.finalized_at,
            v_conf.updated_at,
            false as is_read_only;
        return;
    end if;

    if v_conf.status <> 'finalizado_falta' then
        raise exception 'CONFERENCIA_FINALIZADA_SEM_PENDENCIA';
    end if;

    select count(*)::integer
    into v_pending_items
    from app.conf_volume_avulso_itens i
    where i.conf_id = v_conf.conf_id
      and i.qtd_conferida < i.qtd_esperada;

    if coalesce(v_pending_items, 0) <= 0 then
        raise exception 'CONFERENCIA_FINALIZADA_SEM_PENDENCIA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    update app.conf_volume_avulso c
    set
        status = 'em_conferencia',
        started_by = v_uid,
        started_mat = coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        started_nome = coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
        started_at = now(),
        falta_motivo = null,
        finalized_at = null,
        updated_at = now()
    where c.conf_id = v_conf.conf_id
    returning * into v_conf;

    return query
    select
        v_conf.conf_id,
        v_conf.conf_date,
        v_conf.cd,
        v_conf.nr_volume,
        v_conf.caixa,
        v_conf.pedido,
        v_conf.filial,
        v_conf.filial_nome,
        v_conf.rota,
        v_conf.status,
        v_conf.falta_motivo,
        v_conf.started_by,
        v_conf.started_mat,
        v_conf.started_nome,
        v_conf.started_at,
        v_conf.finalized_at,
        v_conf.updated_at,
        false as is_read_only;
end;
$$;

grant execute on function public.rpc_conf_volume_avulso_get_partial_reopen_info(text, integer) to authenticated;
grant execute on function public.rpc_conf_volume_avulso_reopen_partial_conference(text, integer) to authenticated;
