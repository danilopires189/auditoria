create table if not exists app.conf_inventario_admin_seed_config (
    cd integer primary key,
    zonas text[] not null default '{}'::text[],
    estoque_ini integer not null default 0 check (estoque_ini >= 0),
    estoque_fim integer not null default 0 check (estoque_fim >= 0),
    incluir_pul boolean not null default false,
    manual_coddv integer[] not null default '{}'::integer[],
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now(),
    constraint ck_conf_inventario_admin_seed_config_faixa check (estoque_ini <= estoque_fim)
);

create or replace function app.conf_inventario_admin_seed_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_conf_inventario_admin_seed_touch_updated_at on app.conf_inventario_admin_seed_config;
create trigger trg_conf_inventario_admin_seed_touch_updated_at
before update on app.conf_inventario_admin_seed_config
for each row
execute function app.conf_inventario_admin_seed_touch_updated_at();

create or replace function app.conf_inventario_zone_from_sep_endereco(p_endereco text)
returns text
language plpgsql
immutable
as $$
declare
    v_endereco text;
begin
    v_endereco := upper(nullif(trim(coalesce(p_endereco, '')), ''));
    if v_endereco is null then
        return 'SEM ZONA';
    end if;

    if char_length(v_endereco) <= 4 then
        return v_endereco;
    end if;

    return substring(v_endereco from 1 for 4);
end;
$$;

create or replace function app.conf_inventario_normalize_seed_zones(p_zonas text[])
returns text[]
language sql
immutable
as $$
    select coalesce(
        array_agg(z order by z),
        '{}'::text[]
    )
    from (
        select distinct nullif(substring(upper(trim(v)) from 1 for 4), '') as z
        from unnest(coalesce(p_zonas, '{}'::text[])) as u(v)
    ) s
    where s.z is not null;
$$;

create or replace function app.conf_inventario_parse_coddv_csv(p_csv text)
returns integer[]
language sql
immutable
as $$
    with parsed as (
        select nullif(regexp_replace(trim(v), '\D', '', 'g'), '')::integer as coddv
        from unnest(regexp_split_to_array(coalesce(p_csv, ''), ',')) as t(v)
    )
    select coalesce(
        array_agg(p.coddv order by p.coddv),
        '{}'::integer[]
    )
    from (
        select distinct coddv
        from parsed
        where coddv is not null
          and coddv > 0
    ) p;
$$;

create or replace function app.conf_inventario_seed_target_rows(
    p_cd integer,
    p_zonas text[],
    p_estoque_ini integer,
    p_estoque_fim integer,
    p_incluir_pul boolean,
    p_manual_coddv integer[]
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
            greatest(coalesce(st.qtd_est_disp, 0), 0) as estoque
        from app.db_end e
        cross join params p
        left join app.db_estq_entr st
          on st.cd = e.cd
         and st.coddv = e.coddv
        where e.cd = p_cd
          and upper(trim(coalesce(e.tipo, ''))) = 'SEP'
          and e.coddv is not null
          and app.conf_inventario_zone_from_sep_endereco(e.endereco) = any (p.zonas)
          and greatest(coalesce(st.qtd_est_disp, 0), 0) between p.estoque_ini and p.estoque_fim
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
            greatest(coalesce(st.qtd_est_disp, 0), 0) as estoque
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
            greatest(coalesce(st.qtd_est_disp, 0), 0) as estoque
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

create or replace function app.conf_inventario_cleanup_pending_started_coddv(
    p_cd integer,
    p_cycle_date date,
    p_coddv integer
)
returns integer
language plpgsql
security definer
set search_path = app, public
as $$
declare
    v_cycle_date date;
    v_removed integer := 0;
begin
    if p_cd is null or p_coddv is null or p_coddv <= 0 then
        return 0;
    end if;

    v_cycle_date := coalesce(p_cycle_date, app.conf_inventario_today());

    with started as (
        select distinct upper(c.endereco) as endereco, c.coddv
        from app.conf_inventario_counts c
        where c.cd = p_cd
          and c.cycle_date = v_cycle_date
          and c.coddv = p_coddv
        union
        select distinct upper(r.endereco) as endereco, r.coddv
        from app.conf_inventario_reviews r
        where r.cd = p_cd
          and r.cycle_date = v_cycle_date
          and r.coddv = p_coddv
    )
    delete from app.db_inventario i
    where i.cd = p_cd
      and i.coddv = p_coddv
      and not exists (
        select 1
        from started s
        where s.coddv = i.coddv
          and s.endereco = upper(i.endereco)
      );

    get diagnostics v_removed = row_count;
    return coalesce(v_removed, 0);
end;
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
            v_cfg.manual_coddv
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
            v_cfg.manual_coddv
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

alter table app.conf_inventario_admin_seed_config enable row level security;

revoke all on app.conf_inventario_admin_seed_config from anon;
revoke all on app.conf_inventario_admin_seed_config from authenticated;

grant select, insert, update, delete on app.conf_inventario_admin_seed_config to authenticated;

drop policy if exists p_conf_inventario_admin_seed_config_select on app.conf_inventario_admin_seed_config;
create policy p_conf_inventario_admin_seed_config_select
on app.conf_inventario_admin_seed_config
for select
using (
    authz.session_is_recent(6)
    and authz.is_admin(auth.uid())
);

drop policy if exists p_conf_inventario_admin_seed_config_insert on app.conf_inventario_admin_seed_config;
create policy p_conf_inventario_admin_seed_config_insert
on app.conf_inventario_admin_seed_config
for insert
with check (
    authz.session_is_recent(6)
    and authz.is_admin(auth.uid())
);

drop policy if exists p_conf_inventario_admin_seed_config_update on app.conf_inventario_admin_seed_config;
create policy p_conf_inventario_admin_seed_config_update
on app.conf_inventario_admin_seed_config
for update
using (
    authz.session_is_recent(6)
    and authz.is_admin(auth.uid())
)
with check (
    authz.session_is_recent(6)
    and authz.is_admin(auth.uid())
);

drop policy if exists p_conf_inventario_admin_seed_config_delete on app.conf_inventario_admin_seed_config;
create policy p_conf_inventario_admin_seed_config_delete
on app.conf_inventario_admin_seed_config
for delete
using (
    authz.session_is_recent(6)
    and authz.is_admin(auth.uid())
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

    if not authz.is_admin(v_uid) then
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

    if not authz.is_admin(v_uid) then
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

    if not authz.is_admin(v_uid) then
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

    if not authz.is_admin(v_uid) then
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

create or replace function public.rpc_conf_inventario_manifest_meta(
    p_cd integer default null
)
returns table (
    cd integer,
    row_count bigint,
    zonas_count bigint,
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
    v_zonas_count bigint;
    v_source_run_id uuid;
    v_updated_max timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    perform app.conf_inventario_refresh_pending_from_seed(v_cd, app.conf_inventario_today());

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

    if coalesce(v_row_count, 0) = 0 then
        raise exception 'BASE_INVENTARIO_VAZIA';
    end if;

    return query
    select
        v_cd,
        v_row_count,
        v_zonas_count,
        v_source_run_id,
        md5(concat_ws(':', coalesce(v_source_run_id::text, ''), v_row_count::text, v_zonas_count::text, coalesce(v_updated_max::text, ''))),
        now();
end;
$$;

create or replace function public.rpc_conf_inventario_sync_pull(
    p_cd integer default null,
    p_cycle_date date default null,
    p_since timestamptz default null
)
returns table (
    counts jsonb,
    reviews jsonb,
    locks jsonb,
    server_time timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_cycle_date date;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.conf_inventario_resolve_cd(p_cd);
    v_cycle_date := coalesce(p_cycle_date, app.conf_inventario_today());
    perform app.conf_inventario_refresh_pending_from_seed(v_cd, v_cycle_date);

    return query
    with counts_data as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'cycle_date', c.cycle_date,
                    'cd', c.cd,
                    'zona', c.zona,
                    'endereco', c.endereco,
                    'coddv', c.coddv,
                    'descricao', c.descricao,
                    'estoque', c.estoque,
                    'etapa', c.etapa,
                    'qtd_contada', c.qtd_contada,
                    'barras', c.barras,
                    'resultado', c.resultado,
                    'counted_by', c.counted_by,
                    'counted_mat', c.counted_mat,
                    'counted_nome', c.counted_nome,
                    'updated_at', c.updated_at
                )
                order by c.zona, c.endereco, c.coddv, c.etapa
            ),
            '[]'::jsonb
        ) as payload
        from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date
          and c.cd = v_cd
          and (p_since is null or c.updated_at >= p_since)
    ),
    reviews_data as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'cycle_date', r.cycle_date,
                    'cd', r.cd,
                    'zona', r.zona,
                    'endereco', r.endereco,
                    'coddv', r.coddv,
                    'descricao', r.descricao,
                    'estoque', r.estoque,
                    'reason_code', r.reason_code,
                    'snapshot', r.snapshot,
                    'status', r.status,
                    'final_qtd', r.final_qtd,
                    'final_barras', r.final_barras,
                    'final_resultado', r.final_resultado,
                    'resolved_by', r.resolved_by,
                    'resolved_mat', r.resolved_mat,
                    'resolved_nome', r.resolved_nome,
                    'resolved_at', r.resolved_at,
                    'updated_at', r.updated_at
                )
                order by r.zona, r.endereco, r.coddv
            ),
            '[]'::jsonb
        ) as payload
        from app.conf_inventario_reviews r
        where r.cycle_date = v_cycle_date
          and r.cd = v_cd
          and (p_since is null or r.updated_at >= p_since)
    ),
    locks_data as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'lock_id', l.lock_id,
                    'cycle_date', l.cycle_date,
                    'cd', l.cd,
                    'zona', l.zona,
                    'etapa', l.etapa,
                    'locked_by', l.locked_by,
                    'locked_mat', l.locked_mat,
                    'locked_nome', l.locked_nome,
                    'heartbeat_at', l.heartbeat_at,
                    'expires_at', l.expires_at,
                    'updated_at', l.updated_at
                )
                order by l.zona, l.etapa
            ),
            '[]'::jsonb
        ) as payload
        from app.conf_inventario_zone_locks l
        where l.cycle_date = v_cycle_date
          and l.cd = v_cd
          and l.expires_at > now()
          and (p_since is null or l.updated_at >= p_since)
    )
    select counts_data.payload, reviews_data.payload, locks_data.payload, now()
    from counts_data, reviews_data, locks_data;
end;
$$;

create or replace function public.rpc_conf_inventario_apply_event(
    p_event_type text,
    p_payload jsonb,
    p_client_event_id uuid default null
)
returns table (
    accepted boolean,
    info text,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_event_type text;
    v_payload jsonb;
    v_profile record;
    v_mat text;
    v_nome text;

    v_cycle_date date;
    v_cd integer;
    v_zona text;
    v_endereco text;
    v_coddv integer;
    v_descricao text;
    v_estoque integer;
    v_etapa integer;
    v_qtd integer;
    v_barras text;
    v_discarded boolean;
    v_resultado text;

    v_c1 app.conf_inventario_counts%rowtype;
    v_c2 app.conf_inventario_counts%rowtype;
    v_review app.conf_inventario_reviews%rowtype;
    v_lock app.conf_inventario_zone_locks%rowtype;
    v_snapshot jsonb;
    v_base app.db_inventario%rowtype;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_event_type := lower(trim(coalesce(p_event_type, '')));
    v_payload := coalesce(p_payload, '{}'::jsonb);

    if p_client_event_id is not null and exists (
        select 1 from app.conf_inventario_event_log e where e.client_event_id = p_client_event_id
    ) then
        return query select true, 'DUPLICATE_IGNORED', now();
        return;
    end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    v_mat := coalesce(nullif(trim(coalesce(v_profile.mat, '')), ''), 'SEM_MATRICULA');
    v_nome := coalesce(nullif(trim(coalesce(v_profile.nome, '')), ''), 'USUARIO');

    if v_event_type = 'count_upsert' then
        v_cycle_date := coalesce((v_payload ->> 'cycle_date')::date, app.conf_inventario_today());
        v_cd := app.conf_inventario_resolve_cd(nullif(v_payload ->> 'cd', '')::integer);
        v_zona := upper(nullif(trim(coalesce(v_payload ->> 'zona', '')), ''));
        v_endereco := upper(nullif(trim(coalesce(v_payload ->> 'endereco', '')), ''));
        v_coddv := nullif(v_payload ->> 'coddv', '')::integer;
        v_descricao := nullif(trim(coalesce(v_payload ->> 'descricao', '')), '');
        v_estoque := nullif(v_payload ->> 'estoque', '')::integer;
        v_etapa := case when coalesce(nullif(v_payload ->> 'etapa', '')::integer, 1) = 2 then 2 else 1 end;
        v_qtd := greatest(coalesce(nullif(v_payload ->> 'qtd_contada', '')::integer, 0), 0);
        v_discarded := coalesce((v_payload ->> 'discarded')::boolean, false);

        if v_zona is null or v_endereco is null or v_coddv is null then
            raise exception 'ITEM_INVALIDO';
        end if;

        select * into v_base
        from app.db_inventario b
        where b.cd = v_cd and upper(b.endereco) = v_endereco and b.coddv = v_coddv
        limit 1;

        if v_base.cd is null then
            raise exception 'ITEM_BASE_NAO_ENCONTRADO';
        end if;

        if v_descricao is null then
            v_descricao := coalesce(nullif(trim(coalesce(v_base.descricao, '')), ''), format('CODDV %s', v_coddv));
        end if;

        if v_estoque is null then
            v_estoque := greatest(coalesce(v_base.estoque, 0), 0);
        else
            v_estoque := greatest(v_estoque, 0);
        end if;

        select * into v_review
        from app.conf_inventario_reviews r
        where r.cycle_date = v_cycle_date and r.cd = v_cd and r.endereco = v_endereco and r.coddv = v_coddv and r.status = 'resolvido'
        limit 1;

        if v_review.review_id is not null then
            raise exception 'ITEM_JA_RESOLVIDO';
        end if;

        select * into v_c1
        from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date and c.cd = v_cd and c.endereco = v_endereco and c.coddv = v_coddv and c.etapa = 1
        limit 1;

        select * into v_c2
        from app.conf_inventario_counts c
        where c.cycle_date = v_cycle_date and c.cd = v_cd and c.endereco = v_endereco and c.coddv = v_coddv and c.etapa = 2
        limit 1;

        if v_etapa = 1 and v_c2.count_id is not null then
            raise exception 'ETAPA1_BLOQUEADA_SEGUNDA_EXISTE';
        end if;

        if v_etapa = 1 and v_c1.count_id is not null and v_c1.counted_by <> v_uid then
            raise exception 'ETAPA1_APENAS_AUTOR';
        end if;

        if v_etapa = 2 then
            if v_c1.count_id is null then raise exception 'ETAPA1_OBRIGATORIA'; end if;
            if v_c1.resultado <> 'sobra' then raise exception 'ETAPA2_APENAS_QUANDO_SOBRA'; end if;
            if v_c2.count_id is null and v_c1.counted_by = v_uid then raise exception 'SEGUNDA_CONTAGEM_EXIGE_USUARIO_DIFERENTE'; end if;
            if v_c2.count_id is not null and v_c2.counted_by <> v_uid then raise exception 'ETAPA2_APENAS_AUTOR'; end if;
        end if;

        select * into v_lock
        from app.conf_inventario_zone_locks l
        where l.cycle_date = v_cycle_date and l.cd = v_cd and l.zona = v_zona and l.etapa = v_etapa
          and l.expires_at > now() and l.locked_by <> v_uid
        limit 1;

        if v_lock.lock_id is not null then
            if v_etapa = 2 then
                v_snapshot := jsonb_build_object(
                    'event_type', v_event_type,
                    'event_payload', v_payload,
                    'locked_by', v_lock.locked_by,
                    'locked_mat', v_lock.locked_mat,
                    'locked_nome', v_lock.locked_nome,
                    'lock_expires_at', v_lock.expires_at
                );

                perform app.conf_inventario_upsert_review_lock_conflict(
                    v_cycle_date, v_cd, v_zona, v_endereco, v_coddv, v_descricao, v_estoque, v_snapshot
                );

                if p_client_event_id is not null then
                    insert into app.conf_inventario_event_log (client_event_id, user_id, event_type, payload, status, info)
                    values (p_client_event_id, v_uid, v_event_type, v_payload, 'accepted', 'CONFLITO_LOCK_REVIEW');
                end if;

                return query select true, 'CONFLITO_LOCK_REVIEW', now();
                return;
            end if;

            raise exception 'ZONA_TRAVADA_OUTRO_USUARIO';
        end if;

        v_barras := null;
        if v_discarded then
            v_resultado := 'descartado';
            v_qtd := 0;
        else
            if v_qtd > v_estoque then
                v_barras := app.conf_inventario_validate_barras_for_coddv(v_payload ->> 'barras', v_coddv);
            end if;
            v_resultado := app.conf_inventario_compute_result(v_estoque, v_qtd, false);
        end if;

        insert into app.conf_inventario_counts (
            cycle_date, cd, zona, endereco, coddv, descricao, estoque, etapa,
            qtd_contada, barras, resultado, counted_by, counted_mat, counted_nome, client_event_id
        )
        values (
            v_cycle_date, v_cd, v_zona, v_endereco, v_coddv, v_descricao, v_estoque, v_etapa,
            v_qtd, v_barras, v_resultado, v_uid, v_mat, v_nome, p_client_event_id
        )
        on conflict (cycle_date, cd, endereco, coddv, etapa)
        do update set
            zona = excluded.zona,
            descricao = excluded.descricao,
            estoque = excluded.estoque,
            qtd_contada = excluded.qtd_contada,
            barras = excluded.barras,
            resultado = excluded.resultado,
            counted_by = excluded.counted_by,
            counted_mat = excluded.counted_mat,
            counted_nome = excluded.counted_nome,
            client_event_id = excluded.client_event_id,
            updated_at = now();

        perform app.conf_inventario_refresh_review_state(v_cycle_date, v_cd, v_zona, v_endereco, v_coddv);
        perform app.conf_inventario_cleanup_pending_started_coddv(v_cd, v_cycle_date, v_coddv);

        if p_client_event_id is not null then
            insert into app.conf_inventario_event_log (client_event_id, user_id, event_type, payload, status, info)
            values (p_client_event_id, v_uid, v_event_type, v_payload, 'accepted', 'COUNT_SAVED');
        end if;

        return query select true, 'COUNT_SAVED', now();
        return;
    elsif v_event_type = 'review_resolve' then
        v_cycle_date := coalesce((v_payload ->> 'cycle_date')::date, app.conf_inventario_today());
        v_cd := app.conf_inventario_resolve_cd(nullif(v_payload ->> 'cd', '')::integer);
        v_zona := upper(nullif(trim(coalesce(v_payload ->> 'zona', '')), ''));
        v_endereco := upper(nullif(trim(coalesce(v_payload ->> 'endereco', '')), ''));
        v_coddv := nullif(v_payload ->> 'coddv', '')::integer;
        v_qtd := greatest(coalesce(nullif(v_payload ->> 'final_qtd', '')::integer, 0), 0);

        if v_zona is null or v_endereco is null or v_coddv is null then
            raise exception 'ITEM_INVALIDO';
        end if;

        select * into v_review
        from app.conf_inventario_reviews r
        where r.cycle_date = v_cycle_date and r.cd = v_cd and r.endereco = v_endereco and r.coddv = v_coddv
        for update;

        if v_review.review_id is null then raise exception 'REVISAO_NAO_ENCONTRADA'; end if;
        if v_review.status = 'resolvido' then
            return query select true, 'REVIEW_ALREADY_RESOLVED', now();
            return;
        end if;

        v_estoque := greatest(coalesce(v_review.estoque, 0), 0);
        if v_qtd > v_estoque then
            v_barras := app.conf_inventario_validate_barras_for_coddv(v_payload ->> 'final_barras', v_coddv);
        else
            v_barras := null;
        end if;

        v_resultado := app.conf_inventario_compute_result(v_estoque, v_qtd, false);

        update app.conf_inventario_reviews r
        set status = 'resolvido',
            final_qtd = v_qtd,
            final_barras = v_barras,
            final_resultado = v_resultado,
            resolved_by = v_uid,
            resolved_mat = v_mat,
            resolved_nome = v_nome,
            resolved_at = now(),
            updated_at = now()
        where r.review_id = v_review.review_id;

        if p_client_event_id is not null then
            insert into app.conf_inventario_event_log (client_event_id, user_id, event_type, payload, status, info)
            values (p_client_event_id, v_uid, v_event_type, v_payload, 'accepted', 'REVIEW_RESOLVED');
        end if;

        return query select true, 'REVIEW_RESOLVED', now();
        return;
    end if;

    raise exception 'EVENTO_NAO_SUPORTADO';
exception
    when others then
        if p_client_event_id is not null and not exists (
            select 1 from app.conf_inventario_event_log e where e.client_event_id = p_client_event_id
        ) then
            insert into app.conf_inventario_event_log (client_event_id, user_id, event_type, payload, status, info)
            values (
                p_client_event_id,
                coalesce(v_uid, auth.uid()),
                coalesce(v_event_type, lower(trim(coalesce(p_event_type, '')))),
                coalesce(v_payload, coalesce(p_payload, '{}'::jsonb)),
                'error',
                sqlerrm
            );
        end if;
        raise;
end;
$$;

grant execute on function public.rpc_conf_inventario_admin_zones(integer) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_preview_seed(integer, text[], integer, integer, boolean, text) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_apply_seed(integer, text[], integer, integer, boolean, text, text) to authenticated;
grant execute on function public.rpc_conf_inventario_admin_clear_base(integer, text, text[], boolean) to authenticated;
grant execute on function public.rpc_conf_inventario_manifest_meta(integer) to authenticated;
grant execute on function public.rpc_conf_inventario_sync_pull(integer, date, timestamptz) to authenticated;
grant execute on function public.rpc_conf_inventario_apply_event(text, jsonb, uuid) to authenticated;
