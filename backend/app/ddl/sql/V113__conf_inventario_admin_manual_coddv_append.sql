create or replace function public.rpc_conf_inventario_admin_apply_manual_coddv(
    p_cd integer default null,
    p_manual_coddv_csv text default null,
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
    v_cycle_date date;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    if not authz.is_admin(v_uid) then
        raise exception 'APENAS_ADMIN';
    end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    v_manual := app.conf_inventario_parse_coddv_csv(p_manual_coddv_csv);
    v_cycle_date := app.conf_inventario_today();

    if coalesce(array_length(v_manual, 1), 0) = 0 then
        raise exception 'CODDV_MANUAL_OBRIGATORIO';
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
        incluir_pul,
        manual_coddv,
        updated_by
    )
    values (
        v_cd,
        coalesce(v_existing.zonas, '{}'::text[]),
        coalesce(v_existing.estoque_ini, 0),
        coalesce(v_existing.estoque_fim, 0),
        coalesce(v_existing.incluir_pul, false) or coalesce(p_incluir_pul, false),
        v_manual_merged,
        v_uid
    )
    on conflict (cd)
    do update set
        zonas = excluded.zonas,
        estoque_ini = excluded.estoque_ini,
        estoque_fim = excluded.estoque_fim,
        incluir_pul = excluded.incluir_pul,
        manual_coddv = excluded.manual_coddv,
        updated_by = excluded.updated_by,
        updated_at = now();

    perform app.conf_inventario_refresh_pending_from_seed(v_cd, v_cycle_date);

    return query
    with manual_scope as (
        select count(*)::integer as itens_scope
        from app.db_inventario i
        where i.cd = v_cd
          and i.coddv = any (v_manual)
    ),
    totals as (
        select
            count(*)::integer as total_geral,
            count(distinct app.conf_inventario_zone_from_sep_endereco(i.endereco))::integer as zonas_afetadas
        from app.db_inventario i
        where i.cd = v_cd
    )
    select
        m.itens_scope,
        t.zonas_afetadas,
        t.total_geral
    from manual_scope m
    cross join totals t;
end;
$$;

grant execute on function public.rpc_conf_inventario_admin_apply_manual_coddv(integer, text, boolean) to authenticated;
