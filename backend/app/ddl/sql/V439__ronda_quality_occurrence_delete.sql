create or replace function public.rpc_ronda_quality_occurrence_delete(
    p_occurrence_id uuid
)
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_role text;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;
    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;
    if p_occurrence_id is null then
        raise exception 'OCCURRENCE_ID_OBRIGATORIO';
    end if;

    v_role := coalesce(authz.user_role(v_uid), '');
    if v_role <> 'admin' then
        raise exception 'CD_SEM_ACESSO';
    end if;

    select o.cd
    into v_cd
    from app.aud_ronda_quality_occurrences o
    where o.occurrence_id = p_occurrence_id;

    if v_cd is null then
        raise exception 'OCCURRENCE_NAO_ENCONTRADA';
    end if;

    if not (authz.is_admin(v_uid) or authz.can_access_cd(v_uid, v_cd)) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    delete from app.aud_ronda_quality_occurrences o
    where o.occurrence_id = p_occurrence_id;
end;
$$;

grant execute on function public.rpc_ronda_quality_occurrence_delete(uuid) to authenticated;
