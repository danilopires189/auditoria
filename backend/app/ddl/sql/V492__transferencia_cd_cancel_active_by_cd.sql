create or replace function public.rpc_conf_transferencia_cd_cancel_active(
    p_cd integer,
    p_origem_link text default 'prevencaocd'
)
returns table (
    cancelled_count integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_origem text;
    v_count integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.conf_transferencia_cd_resolve_cd(p_cd);
    v_origem := app.conf_transferencia_cd_resolve_origem_link(p_origem_link);

    with deleted as (
        delete from app.conf_transferencia_cd c
        where c.started_by = v_uid
          and c.status = 'em_conferencia'
          and c.origem_link = v_origem
          and ((c.etapa = 'saida' and c.cd_ori = v_cd) or (c.etapa = 'entrada' and c.cd_des = v_cd))
          and (
              authz.is_admin(v_uid)
              or (c.etapa = 'saida' and authz.can_access_cd(v_uid, c.cd_ori))
              or (c.etapa = 'entrada' and authz.can_access_cd(v_uid, c.cd_des))
          )
        returning c.conf_id
    )
    select count(*)::integer into v_count from deleted;

    return query select coalesce(v_count, 0);
end;
$$;

grant execute on function public.rpc_conf_transferencia_cd_cancel_active(integer, text) to authenticated;
