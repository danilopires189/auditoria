create or replace function public.rpc_conf_termo_manifest_meta(p_cd integer default null)
returns table (
    cd integer,
    row_count bigint,
    etiquetas_count bigint,
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
    v_etiquetas bigint;
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

    v_cd := app.conf_termo_resolve_cd(p_cd);

    select
        count(*)::bigint,
        count(distinct t.id_etiqueta)::bigint,
        max(t.updated_at)
    into
        v_row_count,
        v_etiquetas,
        v_updated_at
    from app.db_termo t
    where t.cd = v_cd
      and nullif(trim(coalesce(t.id_etiqueta, '')), '') is not null;

    if coalesce(v_row_count, 0) = 0 then
        raise exception 'BASE_TERMO_VAZIA';
    end if;

    select t.source_run_id
    into v_source_run_id
    from app.db_termo t
    where t.cd = v_cd
      and nullif(trim(coalesce(t.id_etiqueta, '')), '') is not null
      and t.source_run_id is not null
    order by t.updated_at desc nulls last
    limit 1;

    return query
    select
        v_cd,
        v_row_count,
        v_etiquetas,
        v_source_run_id,
        md5(
            concat_ws(
                ':',
                coalesce(v_source_run_id::text, ''),
                v_row_count::text,
                v_etiquetas::text,
                coalesce(v_updated_at::text, '')
            )
        ),
        now();
end;
$$;
