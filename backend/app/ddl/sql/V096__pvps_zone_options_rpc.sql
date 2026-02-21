create or replace function public.rpc_pvps_zone_options(
    p_cd integer default null
)
returns table (
    zona text
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.pvps_alocacao_resolve_cd(p_cd);

    return query
    with zone_base as (
        select distinct d.zona
        from app.db_pvps d
        where d.cd = v_cd
          and d.is_pending
        union
        select distinct app.pvps_alocacao_normalize_zone(d.end_pul) as zona
        from app.db_pvps d
        where d.cd = v_cd
          and d.is_pending
    )
    select zb.zona
    from zone_base zb
    where nullif(trim(coalesce(zb.zona, '')), '') is not null
    order by zb.zona;
end;
$$;

grant execute on function public.rpc_pvps_zone_options(integer) to authenticated;
