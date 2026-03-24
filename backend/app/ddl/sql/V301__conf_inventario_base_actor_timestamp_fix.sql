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
    v_actor_at := now();

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

    v_actor_at := now();

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
    v_actor_at := now();

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

grant execute on function public.rpc_conf_inventario_admin_apply_seed_v2(integer, text[], integer, integer, boolean, text, text) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_clear_base_v2(integer, text, text[], boolean) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_manual_coddv_v2(integer, text, boolean) to authenticated;
