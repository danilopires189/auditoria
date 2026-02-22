create or replace function public.rpc_conf_pedido_direto_manifest_meta(p_cd integer default null)
returns table (
    cd integer,
    row_count bigint,
    volumes_count bigint,
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
    v_volumes bigint;
    v_source_run_id uuid;
    v_updated_at timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);

    with source as (
        select
            app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq) as id_vol,
            t.source_run_id,
            t.updated_at
        from app.db_pedido_direto t
        where t.cd = v_cd
    )
    select
        count(*)::bigint,
        count(distinct s.id_vol)::bigint,
        max(s.updated_at)
    into
        v_row_count,
        v_volumes,
        v_updated_at
    from source s
    where nullif(trim(coalesce(s.id_vol, '')), '') is not null;

    if coalesce(v_row_count, 0) = 0 then
        raise exception 'BASE_PEDIDO_DIRETO_VAZIA';
    end if;

    with source as (
        select
            app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq) as id_vol,
            t.source_run_id,
            t.updated_at
        from app.db_pedido_direto t
        where t.cd = v_cd
    )
    select s.source_run_id
    into v_source_run_id
    from source s
    where nullif(trim(coalesce(s.id_vol, '')), '') is not null
      and s.source_run_id is not null
    order by s.updated_at desc nulls last, s.source_run_id::text desc
    limit 1;

    return query
    select
        v_cd,
        v_row_count,
        v_volumes,
        v_source_run_id,
        md5(
            concat_ws(
                ':',
                coalesce(v_source_run_id::text, ''),
                v_row_count::text,
                v_volumes::text,
                coalesce(v_updated_at::text, '')
            )
        ),
        now();
end;
$$;

grant execute on function public.rpc_conf_pedido_direto_manifest_meta(integer) to authenticated;
