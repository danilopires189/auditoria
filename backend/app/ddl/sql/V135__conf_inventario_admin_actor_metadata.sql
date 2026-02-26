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
    v_updated_by uuid;
    v_updated_at timestamptz;
    v_updated_mat text;
    v_updated_nome text;
    v_summary record;
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

    select
        c.updated_by,
        c.updated_at
    into
        v_updated_by,
        v_updated_at
    from app.conf_inventario_admin_seed_config c
    where c.cd = v_cd
    limit 1;

    if v_updated_by is null then
        v_updated_by := v_uid;
        v_updated_at := coalesce(v_updated_at, timezone('utc', now()));
    end if;

    select
        nullif(trim(coalesce(p.mat, '')), ''),
        nullif(trim(coalesce(p.nome, '')), '')
    into
        v_updated_mat,
        v_updated_nome
    from authz.profiles p
    where p.user_id = v_updated_by
    limit 1;

    return query
    select
        coalesce(v_summary.itens_afetados, 0)::integer,
        coalesce(v_summary.zonas_afetadas, 0)::integer,
        coalesce(v_summary.total_geral, 0)::integer,
        v_updated_by,
        v_updated_mat,
        v_updated_nome,
        v_updated_at;
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
    v_cd integer;
    v_updated_by uuid;
    v_updated_at timestamptz;
    v_updated_mat text;
    v_updated_nome text;
    v_summary record;
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

    v_cd := app.conf_inventario_resolve_cd(p_cd);

    select
        c.updated_by,
        c.updated_at
    into
        v_updated_by,
        v_updated_at
    from app.conf_inventario_admin_seed_config c
    where c.cd = v_cd
    limit 1;

    if v_updated_by is null then
        v_updated_by := v_uid;
        v_updated_at := coalesce(v_updated_at, timezone('utc', now()));
    end if;

    select
        nullif(trim(coalesce(p.mat, '')), ''),
        nullif(trim(coalesce(p.nome, '')), '')
    into
        v_updated_mat,
        v_updated_nome
    from authz.profiles p
    where p.user_id = v_updated_by
    limit 1;

    return query
    select
        coalesce(v_summary.itens_afetados, 0)::integer,
        coalesce(v_summary.zonas_afetadas, 0)::integer,
        coalesce(v_summary.total_geral, 0)::integer,
        v_updated_by,
        v_updated_mat,
        v_updated_nome,
        v_updated_at;
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
    v_updated_by uuid;
    v_updated_at timestamptz;
    v_updated_mat text;
    v_updated_nome text;
    v_summary record;
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

    select
        c.updated_by,
        c.updated_at
    into
        v_updated_by,
        v_updated_at
    from app.conf_inventario_admin_seed_config c
    where c.cd = v_cd
    limit 1;

    if v_updated_by is null then
        v_updated_by := v_uid;
        v_updated_at := coalesce(v_updated_at, timezone('utc', now()));
    end if;

    select
        nullif(trim(coalesce(p.mat, '')), ''),
        nullif(trim(coalesce(p.nome, '')), '')
    into
        v_updated_mat,
        v_updated_nome
    from authz.profiles p
    where p.user_id = v_updated_by
    limit 1;

    return query
    select
        coalesce(v_summary.itens_afetados, 0)::integer,
        coalesce(v_summary.zonas_afetadas, 0)::integer,
        coalesce(v_summary.total_geral, 0)::integer,
        v_updated_by,
        v_updated_mat,
        v_updated_nome,
        v_updated_at;
end;
$$;

grant execute on function public.rpc_conf_inventario_admin_apply_seed_v2(integer, text[], integer, integer, boolean, text, text) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_clear_base_v2(integer, text, text[], boolean) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_manual_coddv_v2(integer, text, boolean) to authenticated;
