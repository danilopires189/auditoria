create or replace function public.rpc_conf_inventario_manifest_meta(
    p_cd integer default null
)
returns table (
    cd integer,
    row_count bigint,
    zonas_count bigint,
    source_run_id uuid,
    manifest_hash text,
    generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_row_count bigint;
    v_zonas_count bigint;
    v_source_run_id uuid;
    v_updated_max timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);

    select
        count(*)::bigint,
        count(distinct app.conf_inventario_normalize_zone(i.rua, i.endereco))::bigint,
        max(i.updated_at)
    into
        v_row_count,
        v_zonas_count,
        v_updated_max
    from app.db_inventario i
    where i.cd = v_cd;

    select i.source_run_id
    into v_source_run_id
    from app.db_inventario i
    where i.cd = v_cd
      and i.source_run_id is not null
    order by i.updated_at desc nulls last, i.source_run_id::text desc
    limit 1;

    if coalesce(v_row_count, 0) = 0 then
        raise exception 'BASE_INVENTARIO_VAZIA';
    end if;

    return query
    select
        v_cd,
        v_row_count,
        v_zonas_count,
        v_source_run_id,
        md5(concat_ws(':', coalesce(v_source_run_id::text, ''), v_row_count::text, v_zonas_count::text, coalesce(v_updated_max::text, ''))),
        now();
end;
$$;

grant execute on function public.rpc_conf_inventario_manifest_meta(integer) to authenticated;
