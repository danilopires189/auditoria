create or replace function public.rpc_alocacao_submit_v2(
    p_cd integer default null,
    p_queue_id uuid default null,
    p_end_sit text default null,
    p_val_conf text default null
)
returns table (
    audit_id uuid,
    aud_sit text,
    val_sist text,
    val_conf text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_item_cd integer;
begin
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    if p_queue_id is null then raise exception 'QUEUE_ID_OBRIGATORIO'; end if;

    select d.cd into v_item_cd
    from app.db_alocacao d
    where d.queue_id = p_queue_id;

    if v_item_cd is null then
        raise exception 'ITEM_ALOCACAO_NAO_ENCONTRADO';
    end if;
    if v_item_cd <> v_cd then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return query
    select *
    from public.rpc_alocacao_submit(p_queue_id, p_end_sit, p_val_conf);
end;
$$;

grant execute on function public.rpc_alocacao_submit_v2(integer, uuid, text, text) to authenticated;
