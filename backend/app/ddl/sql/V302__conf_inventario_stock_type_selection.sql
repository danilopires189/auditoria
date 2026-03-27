alter table app.conf_inventario_admin_seed_config
    add column if not exists estoque_tipo text;

update app.conf_inventario_admin_seed_config
set estoque_tipo = 'disponivel'
where nullif(trim(coalesce(estoque_tipo, '')), '') is null;

alter table app.conf_inventario_admin_seed_config
    alter column estoque_tipo set default 'disponivel',
    alter column estoque_tipo set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'ck_conf_inventario_admin_seed_config_estoque_tipo'
    ) then
        alter table app.conf_inventario_admin_seed_config
            add constraint ck_conf_inventario_admin_seed_config_estoque_tipo
            check (estoque_tipo in ('disponivel', 'atual'));
    end if;
end;
$$;

create or replace function app.conf_inventario_seed_target_rows(
    p_cd integer,
    p_zonas text[],
    p_estoque_ini integer,
    p_estoque_fim integer,
    p_incluir_pul boolean,
    p_manual_coddv integer[],
    p_estoque_tipo text default 'disponivel'
)
returns table (
    cd integer,
    zona text,
    endereco text,
    coddv integer,
    descricao text,
    estoque integer,
    rua text
)
language sql
stable
set search_path = app, public
as $$
    with params as (
        select
            greatest(coalesce(p_estoque_ini, 0), 0) as estoque_ini,
            greatest(coalesce(p_estoque_fim, 0), greatest(coalesce(p_estoque_ini, 0), 0)) as estoque_fim,
            case
                when lower(trim(coalesce(p_estoque_tipo, ''))) = 'atual' then 'atual'
                else 'disponivel'
            end as estoque_tipo,
            app.conf_inventario_normalize_seed_zones(p_zonas) as zonas,
            coalesce(
                (
                    select array_agg(distinct c order by c)
                    from unnest(coalesce(p_manual_coddv, '{}'::integer[])) as u(c)
                    where c > 0
                ),
                '{}'::integer[]
            ) as manual_coddv,
            coalesce(p_incluir_pul, false) as incluir_pul
    ),
    sep_filtered as (
        select
            e.cd,
            app.conf_inventario_zone_from_sep_endereco(e.endereco) as zona,
            upper(trim(e.endereco)) as endereco,
            e.coddv,
            coalesce(
                nullif(trim(coalesce(e.descricao, '')), ''),
                format('CODDV %s', e.coddv)
            ) as descricao,
            case
                when p.estoque_tipo = 'atual' then greatest(coalesce(st.qtd_est_atual, 0), 0)
                else greatest(coalesce(st.qtd_est_disp, 0), 0)
            end as estoque
        from app.db_end e
        cross join params p
        left join app.db_estq_entr st
          on st.cd = e.cd
         and st.coddv = e.coddv
        where e.cd = p_cd
          and upper(trim(coalesce(e.tipo, ''))) = 'SEP'
          and e.coddv is not null
          and app.conf_inventario_zone_from_sep_endereco(e.endereco) = any (p.zonas)
          and (
                case
                    when p.estoque_tipo = 'atual' then greatest(coalesce(st.qtd_est_atual, 0), 0)
                    else greatest(coalesce(st.qtd_est_disp, 0), 0)
                end
              ) between p.estoque_ini and p.estoque_fim
    ),
    manual_sep as (
        select
            e.cd,
            app.conf_inventario_zone_from_sep_endereco(e.endereco) as zona,
            upper(trim(e.endereco)) as endereco,
            e.coddv,
            coalesce(
                nullif(trim(coalesce(e.descricao, '')), ''),
                format('CODDV %s', e.coddv)
            ) as descricao,
            case
                when p.estoque_tipo = 'atual' then greatest(coalesce(st.qtd_est_atual, 0), 0)
                else greatest(coalesce(st.qtd_est_disp, 0), 0)
            end as estoque
        from app.db_end e
        cross join params p
        left join app.db_estq_entr st
          on st.cd = e.cd
         and st.coddv = e.coddv
        where e.cd = p_cd
          and upper(trim(coalesce(e.tipo, ''))) = 'SEP'
          and e.coddv = any (p.manual_coddv)
    ),
    sep_base as (
        select * from sep_filtered
        union
        select * from manual_sep
    ),
    selected_coddv as (
        select distinct s.coddv
        from sep_base s
        union
        select distinct u.c
        from params p
        cross join unnest(p.manual_coddv) as u(c)
    ),
    pul_rows as (
        select
            e.cd,
            app.conf_inventario_zone_from_sep_endereco(e.endereco) as zona,
            upper(trim(e.endereco)) as endereco,
            e.coddv,
            coalesce(
                nullif(trim(coalesce(e.descricao, '')), ''),
                format('CODDV %s', e.coddv)
            ) as descricao,
            case
                when p.estoque_tipo = 'atual' then greatest(coalesce(st.qtd_est_atual, 0), 0)
                else greatest(coalesce(st.qtd_est_disp, 0), 0)
            end as estoque
        from app.db_end e
        cross join params p
        join selected_coddv s
          on s.coddv = e.coddv
        left join app.db_estq_entr st
          on st.cd = e.cd
         and st.coddv = e.coddv
        where e.cd = p_cd
          and p.incluir_pul
          and upper(trim(coalesce(e.tipo, ''))) = 'PUL'
    ),
    merged as (
        select * from sep_base
        union
        select * from pul_rows
    )
    select
        m.cd,
        m.zona,
        m.endereco,
        m.coddv,
        max(m.descricao) as descricao,
        max(m.estoque) as estoque,
        m.zona as rua
    from merged m
    where m.endereco is not null
      and m.coddv is not null
      and m.coddv > 0
    group by m.cd, m.zona, m.endereco, m.coddv;
$$;

create or replace function app.conf_inventario_refresh_pending_from_seed(
    p_cd integer,
    p_cycle_date date default null
)
returns void
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_cfg app.conf_inventario_admin_seed_config%rowtype;
    v_cycle_date date;
    v_started_coddv integer;
begin
    if p_cd is null then
        return;
    end if;

    v_cycle_date := coalesce(p_cycle_date, app.conf_inventario_today());

    select *
    into v_cfg
    from app.conf_inventario_admin_seed_config c
    where c.cd = p_cd
    limit 1;

    if v_cfg.cd is null then
        return;
    end if;

    with target as (
        select *
        from app.conf_inventario_seed_target_rows(
            p_cd,
            v_cfg.zonas,
            v_cfg.estoque_ini,
            v_cfg.estoque_fim,
            v_cfg.incluir_pul,
            v_cfg.manual_coddv,
            v_cfg.estoque_tipo
        )
    )
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
    from target t
    on conflict (cd, endereco, coddv)
    do update set
        descricao = excluded.descricao,
        rua = excluded.rua,
        estoque = excluded.estoque,
        updated_at = now();

    with target as (
        select *
        from app.conf_inventario_seed_target_rows(
            p_cd,
            v_cfg.zonas,
            v_cfg.estoque_ini,
            v_cfg.estoque_fim,
            v_cfg.incluir_pul,
            v_cfg.manual_coddv,
            v_cfg.estoque_tipo
        )
    )
    delete from app.db_inventario i
    where i.cd = p_cd
      and not exists (
        select 1
        from target t
        where t.cd = i.cd
          and t.coddv = i.coddv
          and t.endereco = upper(i.endereco)
      )
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

    for v_started_coddv in
        with started_coddv as (
            select distinct c.coddv
            from app.conf_inventario_counts c
            where c.cd = p_cd
              and c.cycle_date = v_cycle_date
              and c.coddv is not null
            union
            select distinct r.coddv
            from app.conf_inventario_reviews r
            where r.cd = p_cd
              and r.cycle_date = v_cycle_date
              and r.coddv is not null
        )
        select s.coddv
        from started_coddv s
    loop
        perform app.conf_inventario_cleanup_pending_started_coddv(p_cd, v_cycle_date, v_started_coddv);
    end loop;
end;
$$;

drop function if exists public.rpc_conf_inventario_admin_apply_seed_v2(integer, text[], integer, integer, boolean, text, text);
drop function if exists public.rpc_conf_inventario_admin_apply_manual_coddv_v2(integer, text, boolean);
drop function if exists public.rpc_conf_inventario_admin_preview_seed(integer, text[], integer, integer, boolean, text);
create function public.rpc_conf_inventario_admin_preview_seed(
    p_cd integer default null,
    p_zonas text[] default null,
    p_estoque_ini integer default 0,
    p_estoque_fim integer default 0,
    p_estoque_tipo text default null,
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
    v_estoque_tipo text;
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
    v_estoque_tipo := lower(trim(coalesce(p_estoque_tipo, '')));
    v_manual := app.conf_inventario_parse_coddv_csv(p_manual_coddv_csv);

    if v_estoque_fim < v_estoque_ini then
        raise exception 'ESTOQUE_FAIXA_INVALIDA';
    end if;

    if v_estoque_tipo not in ('disponivel', 'atual') then
        raise exception 'TIPO_ESTOQUE_OBRIGATORIO';
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
            v_manual,
            v_estoque_tipo
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

drop function if exists public.rpc_conf_inventario_admin_apply_seed(integer, text[], integer, integer, boolean, text, text);
create function public.rpc_conf_inventario_admin_apply_seed(
    p_cd integer default null,
    p_zonas text[] default null,
    p_estoque_ini integer default 0,
    p_estoque_fim integer default 0,
    p_estoque_tipo text default null,
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
    v_estoque_tipo text;
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
    v_estoque_tipo := lower(trim(coalesce(p_estoque_tipo, '')));
    v_cycle_date := app.conf_inventario_today();

    if v_mode not in ('replace_cd', 'replace_zones') then
        raise exception 'MODE_INVALIDO';
    end if;

    if v_estoque_fim < v_estoque_ini then
        raise exception 'ESTOQUE_FAIXA_INVALIDA';
    end if;

    if v_estoque_tipo not in ('disponivel', 'atual') then
        raise exception 'TIPO_ESTOQUE_OBRIGATORIO';
    end if;

    if coalesce(array_length(v_zonas, 1), 0) = 0 and coalesce(array_length(v_manual, 1), 0) = 0 then
        raise exception 'ZONAS_OU_CODDV_OBRIGATORIO';
    end if;

    insert into app.conf_inventario_admin_seed_config (
        cd,
        zonas,
        estoque_ini,
        estoque_fim,
        estoque_tipo,
        incluir_pul,
        manual_coddv,
        updated_by
    )
    values (
        v_cd,
        v_zonas,
        v_estoque_ini,
        v_estoque_fim,
        v_estoque_tipo,
        coalesce(p_incluir_pul, false),
        v_manual,
        v_uid
    )
    on conflict (cd)
    do update set
        zonas = excluded.zonas,
        estoque_ini = excluded.estoque_ini,
        estoque_fim = excluded.estoque_fim,
        estoque_tipo = excluded.estoque_tipo,
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
            v_manual,
            v_estoque_tipo
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
            v_manual,
            v_estoque_tipo
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

drop function if exists public.rpc_conf_inventario_admin_apply_manual_coddv(integer, text, boolean);
create function public.rpc_conf_inventario_admin_apply_manual_coddv(
    p_cd integer default null,
    p_manual_coddv_csv text default null,
    p_estoque_tipo text default null,
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
    v_estoque_tipo := lower(trim(coalesce(p_estoque_tipo, '')));
    v_cycle_date := app.conf_inventario_today();

    if coalesce(array_length(v_manual, 1), 0) = 0 then
        raise exception 'CODDV_MANUAL_OBRIGATORIO';
    end if;

    if v_estoque_tipo not in ('disponivel', 'atual') then
        raise exception 'TIPO_ESTOQUE_OBRIGATORIO';
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
        coalesce(v_existing.incluir_pul, false) or coalesce(p_incluir_pul, false),
        v_manual_merged,
        v_uid
    )
    on conflict (cd)
    do update set
        zonas = excluded.zonas,
        estoque_ini = excluded.estoque_ini,
        estoque_fim = excluded.estoque_fim,
        estoque_tipo = excluded.estoque_tipo,
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

drop function if exists public.rpc_conf_inventario_admin_apply_seed_v2(integer, text[], integer, integer, boolean, text, text);
create function public.rpc_conf_inventario_admin_apply_seed_v2(
    p_cd integer default null,
    p_zonas text[] default null,
    p_estoque_ini integer default 0,
    p_estoque_fim integer default 0,
    p_estoque_tipo text default null,
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
              v_manual,
              v_estoque_tipo
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

drop function if exists public.rpc_conf_inventario_admin_apply_manual_coddv_v2(integer, text, boolean);
create function public.rpc_conf_inventario_admin_apply_manual_coddv_v2(
    p_cd integer default null,
    p_manual_coddv_csv text default null,
    p_estoque_tipo text default null,
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

grant execute on function public.rpc_conf_inventario_admin_preview_seed(integer, text[], integer, integer, text, boolean, text) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_seed(integer, text[], integer, integer, text, boolean, text, text) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_manual_coddv(integer, text, text, boolean) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_seed_v2(integer, text[], integer, integer, text, boolean, text, text) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_manual_coddv_v2(integer, text, text, boolean) to authenticated;
