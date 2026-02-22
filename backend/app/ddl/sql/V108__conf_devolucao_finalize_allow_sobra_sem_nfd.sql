create or replace function public.rpc_conf_devolucao_finalize(
    p_conf_id uuid,
    p_falta_motivo text default null,
    p_falta_total_sem_bipagem boolean default false,
    p_nfo text default null,
    p_motivo_sem_nfd text default null
)
returns table (
    status text,
    falta_motivo text,
    finalized_at timestamptz,
    nfo text,
    motivo_sem_nfd text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_conf app.conf_devolucao%rowtype;
    v_falta integer := 0;
    v_sobra integer := 0;
    v_falta_motivo text;
    v_nfo text;
    v_motivo_sem_nfd text;
    v_next_status text;
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
    from app.conf_devolucao c
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
        count(*) filter (where i.qtd_conferida > i.qtd_esperada)::integer
    into
        v_falta,
        v_sobra
    from app.conf_devolucao_itens i
    where i.conf_id = v_conf.conf_id;

    -- Para devolucao sem NFD, sobra e esperada nao sao criticas de bloqueio.
    if v_conf.conference_kind <> 'sem_nfd' and coalesce(v_sobra, 0) > 0 then
        raise exception 'SOBRA_NAO_PERMITIDA';
    end if;

    v_falta_motivo := nullif(trim(coalesce(p_falta_motivo, '')), '');
    v_nfo := nullif(trim(coalesce(p_nfo, '')), '');
    v_motivo_sem_nfd := nullif(trim(coalesce(p_motivo_sem_nfd, '')), '');

    if v_conf.conference_kind = 'sem_nfd' then
        if v_nfo is null then
            raise exception 'NFO_OBRIGATORIO';
        end if;
        if v_motivo_sem_nfd is null then
            raise exception 'MOTIVO_SEM_NFD_OBRIGATORIO';
        end if;
        v_next_status := 'finalizado_ok';
    elsif coalesce(p_falta_total_sem_bipagem, false) then
        if v_falta_motivo is null then
            raise exception 'FALTA_MOTIVO_OBRIGATORIO';
        end if;
        v_next_status := 'finalizado_falta';
    else
        if coalesce(v_falta, 0) > 0 and v_falta_motivo is null then
            raise exception 'FALTA_MOTIVO_OBRIGATORIO';
        end if;
        v_next_status := case when coalesce(v_falta, 0) > 0 then 'finalizado_falta' else 'finalizado_ok' end;
    end if;

    update app.conf_devolucao c
    set
        status = v_next_status,
        falta_motivo = case
            when v_next_status = 'finalizado_falta' then coalesce(v_falta_motivo, c.falta_motivo)
            else null
        end,
        nfo = case
            when c.conference_kind = 'sem_nfd' then v_nfo
            else c.nfo
        end,
        motivo_sem_nfd = case
            when c.conference_kind = 'sem_nfd' then v_motivo_sem_nfd
            else c.motivo_sem_nfd
        end,
        finalized_at = now(),
        updated_at = now()
    where c.conf_id = v_conf.conf_id
    returning * into v_conf;

    return query
    select
        v_conf.status,
        v_conf.falta_motivo,
        v_conf.finalized_at,
        v_conf.nfo,
        v_conf.motivo_sem_nfd;
end;
$$;

grant execute on function public.rpc_conf_devolucao_finalize(uuid, text, boolean, text, text) to authenticated;
