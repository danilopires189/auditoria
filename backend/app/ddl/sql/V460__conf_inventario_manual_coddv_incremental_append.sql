create or replace function public.rpc_conf_inventario_admin_apply_manual_coddv(
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
    total_geral integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_manual integer[];
    v_existing app.conf_inventario_admin_seed_config%rowtype;
    v_manual_merged integer[];
    v_estoque_tipo text;
    v_ignorar_endereco_auditado boolean;
    v_auditoria_recente_dias integer;
    v_changed integer := 0;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    v_manual := app.conf_inventario_parse_coddv_csv(p_manual_coddv_csv);
    v_estoque_tipo := lower(trim(coalesce(p_estoque_tipo, '')));
    v_ignorar_endereco_auditado := coalesce(p_ignorar_endereco_auditado, false);
    v_auditoria_recente_dias := greatest(coalesce(p_auditoria_recente_dias, 0), 0);

    if coalesce(array_length(v_manual, 1), 0) = 0 then
        raise exception 'CODDV_MANUAL_OBRIGATORIO';
    end if;

    if v_estoque_tipo not in ('disponivel', 'atual') then
        raise exception 'TIPO_ESTOQUE_OBRIGATORIO';
    end if;

    if v_ignorar_endereco_auditado and v_auditoria_recente_dias <= 0 then
        raise exception 'AUDITORIA_RECORRENTE_DIAS_INVALIDO';
    end if;

    select *
    into v_existing
    from app.conf_inventario_admin_seed_config c
    where c.cd = v_cd
    limit 1;

    v_manual_merged := coalesce(
        (
            select array_agg(distinct c order by c)
            from unnest(
                coalesce(v_existing.manual_coddv, '{}'::integer[])
                || coalesce(v_manual, '{}'::integer[])
            ) as u(c)
            where c is not null
              and c > 0
        ),
        '{}'::integer[]
    );

    insert into app.conf_inventario_admin_seed_config (
        cd,
        zonas,
        estoque_ini,
        estoque_fim,
        estoque_tipo,
        ignorar_endereco_auditado,
        auditoria_recente_dias,
        incluir_pul,
        manual_coddv,
        updated_by
    )
    values (
        v_cd,
        coalesce(v_existing.zonas, '{}'::text[]),
        coalesce(v_existing.estoque_ini, 0),
        coalesce(v_existing.estoque_fim, 0),
        v_estoque_tipo,
        v_ignorar_endereco_auditado,
        case when v_ignorar_endereco_auditado then v_auditoria_recente_dias else 0 end,
        coalesce(p_incluir_pul, false),
        v_manual_merged,
        v_uid
    )
    on conflict (cd)
    do update set
        zonas = excluded.zonas,
        estoque_ini = excluded.estoque_ini,
        estoque_fim = excluded.estoque_fim,
        estoque_tipo = excluded.estoque_tipo,
        ignorar_endereco_auditado = excluded.ignorar_endereco_auditado,
        auditoria_recente_dias = excluded.auditoria_recente_dias,
        incluir_pul = excluded.incluir_pul,
        manual_coddv = excluded.manual_coddv,
        updated_by = excluded.updated_by,
        updated_at = now();

    insert into app.db_inventario (
        cd,
        endereco,
        descricao,
        rua,
        coddv,
        estoque,
        source_run_id,
        updated_at
    )
    select
        t.cd,
        t.endereco,
        t.descricao,
        t.rua,
        t.coddv,
        greatest(coalesce(t.estoque, 0), 0),
        null,
        now()
    from app.conf_inventario_seed_target_rows(
        v_cd,
        null,
        0,
        0,
        coalesce(p_incluir_pul, false),
        v_manual,
        v_estoque_tipo,
        v_ignorar_endereco_auditado,
        v_auditoria_recente_dias
    ) t
    on conflict (cd, endereco, coddv)
    do update set
        descricao = excluded.descricao,
        rua = excluded.rua,
        estoque = excluded.estoque,
        updated_at = now();

    get diagnostics v_changed = row_count;

    return query
    with totals as (
        select
            count(*)::integer as total_geral,
            count(distinct app.conf_inventario_zone_from_sep_endereco(i.endereco))::integer as zonas_afetadas
        from app.db_inventario i
        where i.cd = v_cd
    )
    select
        coalesce(v_changed, 0)::integer,
        t.zonas_afetadas,
        t.total_geral
    from totals t;
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
              null,
              0,
              0,
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

grant execute on function public.rpc_conf_inventario_admin_apply_manual_coddv(integer, text, text, boolean, integer, boolean) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_manual_coddv_v2(integer, text, text, boolean, integer, boolean) to authenticated;
