drop policy if exists p_conf_inventario_admin_seed_config_select on app.conf_inventario_admin_seed_config;
create policy p_conf_inventario_admin_seed_config_select
on app.conf_inventario_admin_seed_config
for select
using (
    authz.session_is_recent(6)
    and coalesce(authz.user_role(auth.uid()), '') = 'admin'
    and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), cd))
);

drop policy if exists p_conf_inventario_admin_seed_config_insert on app.conf_inventario_admin_seed_config;
create policy p_conf_inventario_admin_seed_config_insert
on app.conf_inventario_admin_seed_config
for insert
with check (
    authz.session_is_recent(6)
    and coalesce(authz.user_role(auth.uid()), '') = 'admin'
    and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), cd))
);

drop policy if exists p_conf_inventario_admin_seed_config_update on app.conf_inventario_admin_seed_config;
create policy p_conf_inventario_admin_seed_config_update
on app.conf_inventario_admin_seed_config
for update
using (
    authz.session_is_recent(6)
    and coalesce(authz.user_role(auth.uid()), '') = 'admin'
    and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), cd))
)
with check (
    authz.session_is_recent(6)
    and coalesce(authz.user_role(auth.uid()), '') = 'admin'
    and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), cd))
);

drop policy if exists p_conf_inventario_admin_seed_config_delete on app.conf_inventario_admin_seed_config;
create policy p_conf_inventario_admin_seed_config_delete
on app.conf_inventario_admin_seed_config
for delete
using (
    authz.session_is_recent(6)
    and coalesce(authz.user_role(auth.uid()), '') = 'admin'
    and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), cd))
);

create or replace function public.rpc_conf_inventario_admin_zones(
    p_cd integer default null
)
returns table (
    zona text,
    itens integer
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
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

    return query
    select
        app.conf_inventario_zone_from_sep_endereco(e.endereco) as zona,
        count(distinct (upper(trim(e.endereco)) || '|' || e.coddv::text))::integer as itens
    from app.db_end e
    where e.cd = v_cd
      and upper(trim(coalesce(e.tipo, ''))) = 'SEP'
      and e.coddv is not null
    group by app.conf_inventario_zone_from_sep_endereco(e.endereco)
    order by app.conf_inventario_zone_from_sep_endereco(e.endereco);
end;
$$;

create or replace function public.rpc_conf_inventario_admin_preview_seed(
    p_cd integer default null,
    p_zonas text[] default null,
    p_estoque_ini integer default 0,
    p_estoque_fim integer default 0,
    p_incluir_pul boolean default false,
    p_manual_coddv_csv text default null
)
returns table (
    zona text,
    itens integer,
    total_geral integer
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zonas text[];
    v_estoque_ini integer;
    v_estoque_fim integer;
    v_manual integer[];
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
    v_zonas := app.conf_inventario_normalize_seed_zones(p_zonas);
    v_estoque_ini := greatest(coalesce(p_estoque_ini, 0), 0);
    v_estoque_fim := greatest(coalesce(p_estoque_fim, 0), 0);
    v_manual := app.conf_inventario_parse_coddv_csv(p_manual_coddv_csv);

    if v_estoque_fim < v_estoque_ini then
        raise exception 'ESTOQUE_FAIXA_INVALIDA';
    end if;

    if coalesce(array_length(v_zonas, 1), 0) = 0 and coalesce(array_length(v_manual, 1), 0) = 0 then
        raise exception 'ZONAS_OU_CODDV_OBRIGATORIO';
    end if;

    return query
    with grouped as (
        select
            t.zona,
            count(distinct (t.endereco || '|' || t.coddv::text))::integer as itens
        from app.conf_inventario_seed_target_rows(
            v_cd,
            v_zonas,
            v_estoque_ini,
            v_estoque_fim,
            coalesce(p_incluir_pul, false),
            v_manual
        ) t
        group by t.zona
    ),
    totals as (
        select coalesce(sum(g.itens), 0)::integer as total_geral
        from grouped g
    )
    select
        g.zona,
        g.itens,
        t.total_geral
    from grouped g
    cross join totals t
    order by g.zona;
end;
$$;

create or replace function public.rpc_conf_inventario_admin_apply_seed(
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
    total_geral integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
    v_zonas text[];
    v_manual integer[];
    v_estoque_ini integer;
    v_estoque_fim integer;
    v_cycle_date date;
    v_changed integer := 0;
    v_step integer := 0;
    v_started_coddv integer;
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
    v_mode := lower(trim(coalesce(p_mode, 'replace_cd')));
    v_zonas := app.conf_inventario_normalize_seed_zones(p_zonas);
    v_manual := app.conf_inventario_parse_coddv_csv(p_manual_coddv_csv);
    v_estoque_ini := greatest(coalesce(p_estoque_ini, 0), 0);
    v_estoque_fim := greatest(coalesce(p_estoque_fim, 0), 0);
    v_cycle_date := app.conf_inventario_today();

    if v_mode not in ('replace_cd', 'replace_zones') then
        raise exception 'MODE_INVALIDO';
    end if;

    if v_estoque_fim < v_estoque_ini then
        raise exception 'ESTOQUE_FAIXA_INVALIDA';
    end if;

    if coalesce(array_length(v_zonas, 1), 0) = 0 and coalesce(array_length(v_manual, 1), 0) = 0 then
        raise exception 'ZONAS_OU_CODDV_OBRIGATORIO';
    end if;

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
        v_zonas,
        v_estoque_ini,
        v_estoque_fim,
        coalesce(p_incluir_pul, false),
        v_manual,
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

    if v_mode = 'replace_cd' then
        perform app.conf_inventario_refresh_pending_from_seed(v_cd, v_cycle_date);

        select count(*)::integer
        into v_changed
        from app.conf_inventario_seed_target_rows(
            v_cd,
            v_zonas,
            v_estoque_ini,
            v_estoque_fim,
            coalesce(p_incluir_pul, false),
            v_manual
        );
    else
        if coalesce(array_length(v_zonas, 1), 0) = 0 then
            raise exception 'ZONAS_OBRIGATORIAS_REPLACE_ZONES';
        end if;

        delete from app.db_inventario i
        where i.cd = v_cd
          and app.conf_inventario_zone_from_sep_endereco(i.endereco) = any (v_zonas)
          and not exists (
            select 1
            from app.conf_inventario_counts c
            where c.cd = i.cd
              and c.cycle_date = v_cycle_date
              and c.coddv = i.coddv
              and c.endereco = upper(i.endereco)
          )
          and not exists (
            select 1
            from app.conf_inventario_reviews r
            where r.cd = i.cd
              and r.cycle_date = v_cycle_date
              and r.coddv = i.coddv
              and r.endereco = upper(i.endereco)
          );

        get diagnostics v_step = row_count;
        v_changed := v_changed + coalesce(v_step, 0);

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
            v_zonas,
            v_estoque_ini,
            v_estoque_fim,
            coalesce(p_incluir_pul, false),
            v_manual
        ) t
        on conflict (cd, endereco, coddv)
        do update set
            descricao = excluded.descricao,
            rua = excluded.rua,
            estoque = excluded.estoque,
            updated_at = now();

        get diagnostics v_step = row_count;
        v_changed := v_changed + coalesce(v_step, 0);

        for v_started_coddv in
            with started_coddv as (
                select distinct c.coddv
                from app.conf_inventario_counts c
                where c.cd = v_cd
                  and c.cycle_date = v_cycle_date
                  and c.coddv is not null
                union
                select distinct r.coddv
                from app.conf_inventario_reviews r
                where r.cd = v_cd
                  and r.cycle_date = v_cycle_date
                  and r.coddv is not null
            )
            select s.coddv
            from started_coddv s
        loop
            v_changed := v_changed + app.conf_inventario_cleanup_pending_started_coddv(v_cd, v_cycle_date, v_started_coddv);
        end loop;
    end if;

    return query
    with totals as (
        select
            count(*)::integer as total_geral,
            count(distinct app.conf_inventario_zone_from_sep_endereco(i.endereco))::integer as zonas_afetadas
        from app.db_inventario i
        where i.cd = v_cd
    )
    select
        v_changed,
        t.zonas_afetadas,
        t.total_geral
    from totals t;
end;
$$;

create or replace function public.rpc_conf_inventario_admin_clear_base(
    p_cd integer default null,
    p_scope text default 'all',
    p_zonas text[] default null,
    p_hard_reset boolean default false
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
    v_scope text;
    v_zonas text[];
    v_cycle_date date;
    v_affected integer := 0;
    v_step integer := 0;
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
    v_scope := lower(trim(coalesce(p_scope, 'all')));
    v_zonas := app.conf_inventario_normalize_seed_zones(p_zonas);
    v_cycle_date := app.conf_inventario_today();

    if v_scope not in ('all', 'zones') then
        raise exception 'SCOPE_INVALIDO';
    end if;

    if v_scope = 'all' then
        if coalesce(p_hard_reset, false) then
            delete from app.db_inventario i
            where i.cd = v_cd;
        else
            delete from app.db_inventario i
            where i.cd = v_cd
              and not exists (
                select 1
                from app.conf_inventario_counts c
                where c.cd = i.cd
                  and c.cycle_date = v_cycle_date
                  and c.coddv = i.coddv
                  and c.endereco = upper(i.endereco)
              )
              and not exists (
                select 1
                from app.conf_inventario_reviews r
                where r.cd = i.cd
                  and r.cycle_date = v_cycle_date
                  and r.coddv = i.coddv
                  and r.endereco = upper(i.endereco)
              );
        end if;

        get diagnostics v_affected = row_count;

        delete from app.conf_inventario_admin_seed_config c
        where c.cd = v_cd;
    else
        if coalesce(array_length(v_zonas, 1), 0) = 0 then
            raise exception 'ZONAS_OBRIGATORIAS';
        end if;

        if coalesce(p_hard_reset, false) then
            delete from app.db_inventario i
            where i.cd = v_cd
              and app.conf_inventario_zone_from_sep_endereco(i.endereco) = any (v_zonas);
        else
            delete from app.db_inventario i
            where i.cd = v_cd
              and app.conf_inventario_zone_from_sep_endereco(i.endereco) = any (v_zonas)
              and not exists (
                select 1
                from app.conf_inventario_counts c
                where c.cd = i.cd
                  and c.cycle_date = v_cycle_date
                  and c.coddv = i.coddv
                  and c.endereco = upper(i.endereco)
              )
              and not exists (
                select 1
                from app.conf_inventario_reviews r
                where r.cd = i.cd
                  and r.cycle_date = v_cycle_date
                  and r.coddv = i.coddv
                  and r.endereco = upper(i.endereco)
              );
        end if;

        get diagnostics v_affected = row_count;

        update app.conf_inventario_admin_seed_config cfg
        set zonas = coalesce(
            (
                select array_agg(z order by z)
                from (
                    select z
                    from unnest(coalesce(cfg.zonas, '{}'::text[])) as u(z)
                    where not (z = any (v_zonas))
                ) kept
            ),
            '{}'::text[]
        ),
        updated_by = v_uid,
        updated_at = now()
        where cfg.cd = v_cd;

        get diagnostics v_step = row_count;
        if v_step > 0 then
            delete from app.conf_inventario_admin_seed_config cfg
            where cfg.cd = v_cd
              and coalesce(array_length(cfg.zonas, 1), 0) = 0
              and coalesce(array_length(cfg.manual_coddv, 1), 0) = 0;
        end if;
    end if;

    return query
    with totals as (
        select
            count(*)::integer as total_geral,
            count(distinct app.conf_inventario_zone_from_sep_endereco(i.endereco))::integer as zonas_afetadas
        from app.db_inventario i
        where i.cd = v_cd
    )
    select
        coalesce(v_affected, 0),
        t.zonas_afetadas,
        t.total_geral
    from totals t;
end;
$$;

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

    if coalesce(authz.user_role(v_uid), '') <> 'admin' then
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

grant execute on function public.rpc_conf_inventario_admin_zones(integer) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_preview_seed(integer, text[], integer, integer, boolean, text) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_seed(integer, text[], integer, integer, boolean, text, text) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_clear_base(integer, text, text[], boolean) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_manual_coddv(integer, text, boolean) to authenticated;
