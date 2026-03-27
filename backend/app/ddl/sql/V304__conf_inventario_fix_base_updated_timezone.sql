-- Corrige o carimbo base_updated_at do módulo de inventário (zerados).
-- O uso anterior de timezone('utc', now()) em coluna timestamptz deslocava o valor
-- em relação ao updated_at, fazendo o frontend interpretar a base como de outro dia.

update app.db_inventario
set base_updated_at = updated_at
where base_updated_at is not null
  and updated_at is not null
  and base_updated_by is not null
  and base_updated_at - updated_at between interval '2 hours 59 minutes' and interval '3 hours 1 minute';

create or replace function public.rpc_conf_inventario_admin_apply_seed_v2(
    p_cd integer default null,
    p_zonas text[] default null,
    p_estoque_ini integer default 0,
    p_estoque_fim integer default 0,
    p_estoque_tipo text default null,
    p_ignorar_endereco_auditado boolean default false,
    p_auditoria_recente_dias integer default 0,
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
    v_estoque_tipo text;
    v_ignorar_endereco_auditado boolean;
    v_auditoria_recente_dias integer;
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
        p_estoque_tipo,
        p_ignorar_endereco_auditado,
        p_auditoria_recente_dias,
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
    v_estoque_tipo := lower(trim(coalesce(p_estoque_tipo, 'disponivel')));
    v_ignorar_endereco_auditado := coalesce(p_ignorar_endereco_auditado, false);
    v_auditoria_recente_dias := greatest(coalesce(p_auditoria_recente_dias, 0), 0);
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
              v_manual,
              v_estoque_tipo,
              v_ignorar_endereco_auditado,
              v_auditoria_recente_dias
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

create or replace function public.rpc_conf_inventario_admin_apply_manual_coddv_v2(
    p_cd integer default null,
    p_manual_coddv_csv text default null,
    p_estoque_tipo text default null,
    p_ignorar_endereco_auditado boolean default false,
    p_auditoria_recente_dias integer default 0,
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
        p_estoque_tipo,
        p_ignorar_endereco_auditado,
        p_auditoria_recente_dias,
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

grant execute on function public.rpc_conf_inventario_admin_apply_seed_v2(integer, text[], integer, integer, text, boolean, integer, boolean, text, text) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_manual_coddv_v2(integer, text, text, boolean, integer, boolean) to authenticated;
