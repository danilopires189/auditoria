alter table app.db_inventario
    add column if not exists base_updated_by uuid references auth.users(id) on delete set null,
    add column if not exists base_updated_mat text,
    add column if not exists base_updated_nome text,
    add column if not exists base_updated_at timestamptz;

create index if not exists idx_app_db_inventario_cd_base_updated_at
    on app.db_inventario(cd, base_updated_at desc);

create or replace function public.rpc_conf_inventario_manifest_meta_v2(
    p_cd integer default null
)
returns table (
    cd integer,
    row_count bigint,
    zonas_count bigint,
    source_run_id uuid,
    manifest_hash text,
    generated_at timestamptz,
    base_usuario_id uuid,
    base_usuario_mat text,
    base_usuario_nome text,
    base_atualizado_em timestamptz
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
    v_base_usuario_id uuid;
    v_base_usuario_mat text;
    v_base_usuario_nome text;
    v_base_atualizado_em timestamptz;
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

    select
        i.base_updated_by,
        nullif(trim(coalesce(i.base_updated_mat, '')), ''),
        nullif(trim(coalesce(i.base_updated_nome, '')), ''),
        i.base_updated_at
    into
        v_base_usuario_id,
        v_base_usuario_mat,
        v_base_usuario_nome,
        v_base_atualizado_em
    from app.db_inventario i
    where i.cd = v_cd
      and i.base_updated_at is not null
    order by i.base_updated_at desc nulls last, i.updated_at desc nulls last
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
        md5(concat_ws(':', coalesce(v_source_run_id::text, ''), v_row_count::text, v_zonas_count::text, coalesce(v_updated_max::text, ''), coalesce(v_base_atualizado_em::text, ''))),
        now(),
        v_base_usuario_id,
        v_base_usuario_mat,
        v_base_usuario_nome,
        v_base_atualizado_em;
end;
$$;

create or replace function public.rpc_conf_inventario_admin_apply_seed_v2(
    p_cd integer default null,
    p_zonas text[] default null,
    p_estoque_ini integer default 0,
    p_estoque_fim integer default 0,
    p_incluir_pul boolean default false,
    p_manual_coddv_csv text default null,
    p_mode text default 'replace_cd'
)
returns table (
    itens_afetados integer,
    zonas_afetadas integer,
    total_geral integer,
    usuario_id uuid,
    usuario_mat text,
    usuario_nome text,
    atualizado_em timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_summary record;
    v_zonas text[];
    v_manual integer[];
    v_estoque_ini integer;
    v_estoque_fim integer;
    v_actor_mat text;
    v_actor_nome text;
    v_actor_at timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    select *
    into v_summary
    from public.rpc_conf_inventario_admin_apply_seed(
        p_cd,
        p_zonas,
        p_estoque_ini,
        p_estoque_fim,
        p_incluir_pul,
        p_manual_coddv_csv,
        p_mode
    )
    limit 1;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    v_zonas := app.conf_inventario_normalize_seed_zones(p_zonas);
    v_manual := app.conf_inventario_parse_coddv_csv(p_manual_coddv_csv);
    v_estoque_ini := greatest(coalesce(p_estoque_ini, 0), 0);
    v_estoque_fim := greatest(coalesce(p_estoque_fim, 0), 0);
    v_actor_at := timezone('utc', now());

    select
        nullif(trim(coalesce(p.mat, '')), ''),
        nullif(trim(coalesce(p.nome, '')), '')
    into
        v_actor_mat,
        v_actor_nome
    from authz.profiles p
    where p.user_id = v_uid
    limit 1;

    update app.db_inventario i
    set
        base_updated_by = v_uid,
        base_updated_mat = v_actor_mat,
        base_updated_nome = v_actor_nome,
        base_updated_at = v_actor_at
    where i.cd = v_cd
      and exists (
          select 1
          from app.conf_inventario_seed_target_rows(
              v_cd,
              v_zonas,
              v_estoque_ini,
              v_estoque_fim,
              coalesce(p_incluir_pul, false),
              v_manual
          ) t
          where t.cd = i.cd
            and t.coddv = i.coddv
            and upper(t.endereco) = upper(i.endereco)
      );

    return query
    select
        coalesce(v_summary.itens_afetados, 0)::integer,
        coalesce(v_summary.zonas_afetadas, 0)::integer,
        coalesce(v_summary.total_geral, 0)::integer,
        v_uid,
        v_actor_mat,
        v_actor_nome,
        v_actor_at;
end;
$$;

create or replace function public.rpc_conf_inventario_admin_clear_base_v2(
    p_cd integer default null,
    p_scope text default 'all',
    p_zonas text[] default null,
    p_hard_reset boolean default false
)
returns table (
    itens_afetados integer,
    zonas_afetadas integer,
    total_geral integer,
    usuario_id uuid,
    usuario_mat text,
    usuario_nome text,
    atualizado_em timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_summary record;
    v_actor_mat text;
    v_actor_nome text;
    v_actor_at timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    select *
    into v_summary
    from public.rpc_conf_inventario_admin_clear_base(
        p_cd,
        p_scope,
        p_zonas,
        p_hard_reset
    )
    limit 1;

    v_actor_at := timezone('utc', now());

    select
        nullif(trim(coalesce(p.mat, '')), ''),
        nullif(trim(coalesce(p.nome, '')), '')
    into
        v_actor_mat,
        v_actor_nome
    from authz.profiles p
    where p.user_id = v_uid
    limit 1;

    return query
    select
        coalesce(v_summary.itens_afetados, 0)::integer,
        coalesce(v_summary.zonas_afetadas, 0)::integer,
        coalesce(v_summary.total_geral, 0)::integer,
        v_uid,
        v_actor_mat,
        v_actor_nome,
        v_actor_at;
end;
$$;

create or replace function public.rpc_conf_inventario_admin_apply_manual_coddv_v2(
    p_cd integer default null,
    p_manual_coddv_csv text default null,
    p_incluir_pul boolean default false
)
returns table (
    itens_afetados integer,
    zonas_afetadas integer,
    total_geral integer,
    usuario_id uuid,
    usuario_mat text,
    usuario_nome text,
    atualizado_em timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_summary record;
    v_manual integer[];
    v_actor_mat text;
    v_actor_nome text;
    v_actor_at timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    select *
    into v_summary
    from public.rpc_conf_inventario_admin_apply_manual_coddv(
        p_cd,
        p_manual_coddv_csv,
        p_incluir_pul
    )
    limit 1;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    v_manual := app.conf_inventario_parse_coddv_csv(p_manual_coddv_csv);
    v_actor_at := timezone('utc', now());

    select
        nullif(trim(coalesce(p.mat, '')), ''),
        nullif(trim(coalesce(p.nome, '')), '')
    into
        v_actor_mat,
        v_actor_nome
    from authz.profiles p
    where p.user_id = v_uid
    limit 1;

    update app.db_inventario i
    set
        base_updated_by = v_uid,
        base_updated_mat = v_actor_mat,
        base_updated_nome = v_actor_nome,
        base_updated_at = v_actor_at
    where i.cd = v_cd
      and i.coddv = any (v_manual);

    return query
    select
        coalesce(v_summary.itens_afetados, 0)::integer,
        coalesce(v_summary.zonas_afetadas, 0)::integer,
        coalesce(v_summary.total_geral, 0)::integer,
        v_uid,
        v_actor_mat,
        v_actor_nome,
        v_actor_at;
end;
$$;

grant execute on function public.rpc_conf_inventario_manifest_meta_v2(integer) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_seed_v2(integer, text[], integer, integer, boolean, text, text) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_clear_base_v2(integer, text, text[], boolean) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_manual_coddv_v2(integer, text, boolean) to authenticated;
