create or replace function public.rpc_pvps_report_pul_items(
    p_audit_ids uuid[]
)
returns table (
    audit_id uuid,
    end_pul text,
    val_pul text,
    end_sit text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if authz.user_role(v_uid) <> 'admin' then raise exception 'APENAS_ADMIN'; end if;

    return query
    select
        apu.audit_id,
        upper(trim(coalesce(apu.end_pul, ''))) as end_pul,
        apu.val_pul,
        apu.end_sit
    from app.aud_pvps_pul apu
    where apu.audit_id = any(coalesce(p_audit_ids, array[]::uuid[]))
    order by apu.audit_id, upper(trim(coalesce(apu.end_pul, '')));
end;
$$;

grant execute on function public.rpc_pvps_report_pul_items(uuid[]) to authenticated;
