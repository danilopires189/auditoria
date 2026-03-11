drop function if exists public.rpc_conf_entrada_notas_reopen_partial_conference(bigint, bigint, integer, boolean);
create function public.rpc_conf_entrada_notas_reopen_partial_conference(
    p_seq_entrada bigint,
    p_nf bigint,
    p_cd integer default null,
    p_restart boolean default false
)
returns table (
    conf_id uuid,
    conf_date date,
    cd integer,
    seq_entrada bigint,
    nf bigint,
    transportadora text,
    fornecedor text,
    status text,
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
    v_today date;
    v_conf app.conf_entrada_notas%rowtype;
    v_user_active app.conf_entrada_notas%rowtype;
    v_profile record;
    v_pending_items integer := 0;
    v_falta_items integer := 0;
    v_sobra_items integer := 0;
    v_restart boolean := coalesce(p_restart, false);
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    perform app.conf_entrada_notas_autoclose_stale();

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;

    select *
    into v_user_active
    from app.conf_entrada_notas c
    where c.started_by = v_uid
      and c.conf_date = v_today
      and c.status = 'em_conferencia'
    order by c.updated_at desc nulls last, c.started_at desc nulls last
    limit 1;

    if v_user_active.conf_id is not null
       and (
          v_user_active.cd <> v_cd
          or v_user_active.seq_entrada <> p_seq_entrada
          or v_user_active.nf <> p_nf
       ) then
        raise exception 'CONFERENCIA_EM_ABERTO_OUTRA_ENTRADA';
    end if;

    select *
    into v_conf
    from app.conf_entrada_notas c
    where c.conf_date = v_today
      and c.cd = v_cd
      and c.seq_entrada = p_seq_entrada
      and c.nf = p_nf
      and (
          authz.is_admin(v_uid)
          or authz.can_access_cd(v_uid, c.cd)
      )
    for update
    limit 1;

    if v_conf.conf_id is null then
        raise exception 'CONFERENCIA_NAO_ENCONTRADA';
    end if;

    if v_conf.status = 'em_conferencia' then
        if v_conf.started_by <> v_uid then
            raise exception 'CONFERENCIA_EM_USO';
        end if;

        return query
        select
            v_conf.conf_id,
            v_conf.conf_date,
            v_conf.cd,
            v_conf.seq_entrada,
            v_conf.nf,
            v_conf.transportadora,
            v_conf.fornecedor,
            v_conf.status,
            v_conf.started_by,
            v_conf.started_mat,
            v_conf.started_nome,
            v_conf.started_at,
            v_conf.finalized_at,
            v_conf.updated_at,
            false as is_read_only;
        return;
    end if;

    if v_conf.status not in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_falta', 'finalizado_parcial') then
        raise exception 'CONFERENCIA_FINALIZADA_SEM_PENDENCIA';
    end if;

    select
        count(*) filter (where i.qtd_conferida = 0)::integer,
        count(*) filter (where i.qtd_conferida > 0 and i.qtd_conferida < i.qtd_esperada)::integer,
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer
    into
        v_pending_items,
        v_falta_items,
        v_sobra_items
    from app.conf_entrada_notas_itens i
    where i.conf_id = v_conf.conf_id;

    if v_restart then
        raise exception 'CONFERENCIA_DIVERGENCIA_SEM_REINICIO_PERMITIDO';
    end if;

    if not (
        coalesce(v_pending_items, 0) > 0
        or (
            v_conf.started_by = v_uid
            and v_conf.status in ('finalizado_divergencia', 'finalizado_falta')
            and (coalesce(v_falta_items, 0) > 0 or coalesce(v_sobra_items, 0) > 0)
        )
    ) then
        raise exception 'CONFERENCIA_FINALIZADA_SEM_PENDENCIA';
    end if;

    select *
    into v_profile
    from authz.current_profile_context_v2()
    limit 1;

    update app.conf_entrada_notas c
    set
        status = 'em_conferencia',
        started_by = v_uid,
        started_mat = coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA'),
        started_nome = coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO'),
        started_at = now(),
        finalized_at = null,
        updated_at = now()
    where c.conf_id = v_conf.conf_id
    returning * into v_conf;

    perform app.conf_entrada_notas_touch_colaborador_from_session(v_conf.conf_id);

    return query
    select
        v_conf.conf_id,
        v_conf.conf_date,
        v_conf.cd,
        v_conf.seq_entrada,
        v_conf.nf,
        v_conf.transportadora,
        v_conf.fornecedor,
        v_conf.status,
        v_conf.started_by,
        v_conf.started_mat,
        v_conf.started_nome,
        v_conf.started_at,
        v_conf.finalized_at,
        v_conf.updated_at,
        false as is_read_only;
end;
$$;

grant execute on function public.rpc_conf_entrada_notas_reopen_partial_conference(bigint, bigint, integer, boolean) to authenticated;
