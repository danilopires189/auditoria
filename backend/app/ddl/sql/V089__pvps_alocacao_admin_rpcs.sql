create or replace function app.pvps_admin_assert()
returns void
language plpgsql
security definer
set search_path = app, authz, public
as $$
begin
    if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if not authz.is_admin(auth.uid()) then raise exception 'APENAS_ADMIN'; end if;
end;
$$;

create or replace function public.rpc_pvps_admin_blacklist_list(
    p_cd integer default null,
    p_modulo text default 'ambos'
)
returns table (
    blacklist_id uuid,
    cd integer,
    modulo text,
    zona text,
    coddv integer,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_modulo text;
begin
    perform app.pvps_admin_assert();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_modulo := lower(coalesce(p_modulo, 'ambos'));

    return query
    select b.blacklist_id, b.cd, b.modulo, b.zona, b.coddv, b.created_at
    from app.pvps_alocacao_blacklist b
    where b.cd = v_cd
      and (v_modulo = 'ambos' or b.modulo = v_modulo)
    order by b.created_at desc;
end;
$$;

create or replace function public.rpc_pvps_admin_blacklist_upsert(
    p_cd integer default null,
    p_modulo text default null,
    p_zona text default null,
    p_coddv integer default null
)
returns table (
    blacklist_id uuid,
    cd integer,
    modulo text,
    zona text,
    coddv integer,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_modulo text;
    v_zona text;
    v_row app.pvps_alocacao_blacklist%rowtype;
begin
    perform app.pvps_admin_assert();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_modulo := lower(trim(coalesce(p_modulo, '')));
    v_zona := upper(trim(coalesce(p_zona, '')));

    if v_modulo not in ('pvps', 'alocacao', 'ambos') then raise exception 'MODULO_INVALIDO'; end if;
    if v_zona = '' then raise exception 'ZONA_OBRIGATORIA'; end if;
    if p_coddv is null or p_coddv <= 0 then raise exception 'CODDV_OBRIGATORIO'; end if;

    insert into app.pvps_alocacao_blacklist (cd, modulo, zona, coddv, created_by)
    values (v_cd, v_modulo, v_zona, p_coddv, auth.uid())
    on conflict (cd, modulo, zona, coddv)
    do update set created_by = excluded.created_by
    returning * into v_row;

    return query
    select v_row.blacklist_id, v_row.cd, v_row.modulo, v_row.zona, v_row.coddv, v_row.created_at;
end;
$$;

create or replace function public.rpc_pvps_admin_blacklist_delete(
    p_blacklist_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = app, authz, public
as $$
begin
    perform app.pvps_admin_assert();
    if p_blacklist_id is null then raise exception 'BLACKLIST_ID_OBRIGATORIO'; end if;

    delete from app.pvps_alocacao_blacklist b
    where b.blacklist_id = p_blacklist_id;

    return found;
end;
$$;

create or replace function public.rpc_pvps_admin_priority_zone_list(
    p_cd integer default null,
    p_modulo text default 'ambos'
)
returns table (
    priority_id uuid,
    cd integer,
    modulo text,
    zona text,
    prioridade integer,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_modulo text;
begin
    perform app.pvps_admin_assert();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_modulo := lower(coalesce(p_modulo, 'ambos'));

    return query
    select p.priority_id, p.cd, p.modulo, p.zona, p.prioridade, p.updated_at
    from app.pvps_alocacao_priority_zones p
    where p.cd = v_cd
      and (v_modulo = 'ambos' or p.modulo = v_modulo)
    order by p.prioridade, p.updated_at desc;
end;
$$;

create or replace function public.rpc_pvps_admin_priority_zone_upsert(
    p_cd integer default null,
    p_modulo text default null,
    p_zona text default null,
    p_prioridade integer default 100
)
returns table (
    priority_id uuid,
    cd integer,
    modulo text,
    zona text,
    prioridade integer,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_modulo text;
    v_zona text;
    v_row app.pvps_alocacao_priority_zones%rowtype;
begin
    perform app.pvps_admin_assert();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_modulo := lower(trim(coalesce(p_modulo, '')));
    v_zona := upper(trim(coalesce(p_zona, '')));

    if v_modulo not in ('pvps', 'alocacao', 'ambos') then raise exception 'MODULO_INVALIDO'; end if;
    if v_zona = '' then raise exception 'ZONA_OBRIGATORIA'; end if;

    insert into app.pvps_alocacao_priority_zones (cd, modulo, zona, prioridade)
    values (v_cd, v_modulo, v_zona, greatest(coalesce(p_prioridade, 100), 1))
    on conflict (cd, modulo, zona)
    do update set prioridade = excluded.prioridade
    returning * into v_row;

    return query
    select v_row.priority_id, v_row.cd, v_row.modulo, v_row.zona, v_row.prioridade, v_row.updated_at;
end;
$$;

create or replace function public.rpc_pvps_admin_priority_zone_delete(
    p_priority_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = app, authz, public
as $$
begin
    perform app.pvps_admin_assert();
    if p_priority_id is null then raise exception 'PRIORITY_ID_OBRIGATORIO'; end if;

    delete from app.pvps_alocacao_priority_zones p
    where p.priority_id = p_priority_id;

    return found;
end;
$$;

create or replace function public.rpc_pvps_admin_clear_zone(
    p_cd integer default null,
    p_modulo text default 'ambos',
    p_zona text default null,
    p_repor_automatico boolean default true
)
returns table (
    cleared_pvps integer,
    cleared_alocacao integer,
    reposto_pvps integer,
    reposto_alocacao integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_modulo text;
    v_zona text;
    v_cleared_pvps integer := 0;
    v_cleared_aloc integer := 0;
    v_reposto_pvps integer := 0;
    v_reposto_aloc integer := 0;
begin
    perform app.pvps_admin_assert();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_modulo := lower(coalesce(p_modulo, 'ambos'));
    v_zona := upper(trim(coalesce(p_zona, '')));

    if v_modulo not in ('pvps', 'alocacao', 'ambos') then raise exception 'MODULO_INVALIDO'; end if;
    if v_zona = '' then raise exception 'ZONA_OBRIGATORIA'; end if;

    if v_modulo in ('pvps', 'ambos') then
        delete from app.db_pvps d where d.cd = v_cd and d.is_pending and d.zona = v_zona;
        get diagnostics v_cleared_pvps = row_count;
    end if;

    if v_modulo in ('alocacao', 'ambos') then
        delete from app.db_alocacao d where d.cd = v_cd and d.is_pending and d.zona = v_zona;
        get diagnostics v_cleared_aloc = row_count;
    end if;

    if coalesce(p_repor_automatico, true) then
        perform app.pvps_alocacao_replenish(v_cd, v_modulo);

        if v_modulo in ('pvps', 'ambos') then
            select count(*)::integer into v_reposto_pvps
            from app.db_pvps d
            where d.cd = v_cd and d.is_pending and d.zona = v_zona;
        end if;

        if v_modulo in ('alocacao', 'ambos') then
            select count(*)::integer into v_reposto_aloc
            from app.db_alocacao d
            where d.cd = v_cd and d.is_pending and d.zona = v_zona;
        end if;
    end if;

    return query
    select v_cleared_pvps, v_cleared_aloc, v_reposto_pvps, v_reposto_aloc;
end;
$$;

create or replace function public.rpc_pvps_admin_reseed_zone(
    p_cd integer default null,
    p_modulo text default 'ambos',
    p_zona text default null
)
returns table (
    reposto_pvps integer,
    reposto_alocacao integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_modulo text;
    v_zona text;
    v_reposto_pvps integer := 0;
    v_reposto_aloc integer := 0;
begin
    perform app.pvps_admin_assert();
    v_cd := app.pvps_alocacao_resolve_cd(p_cd);
    v_modulo := lower(coalesce(p_modulo, 'ambos'));
    v_zona := upper(trim(coalesce(p_zona, '')));

    if v_modulo not in ('pvps', 'alocacao', 'ambos') then raise exception 'MODULO_INVALIDO'; end if;
    if v_zona = '' then raise exception 'ZONA_OBRIGATORIA'; end if;

    if v_modulo in ('pvps', 'ambos') then
        insert into app.db_pvps (cd, zona, coddv, descricao, end_sep, end_pul, qtd_est_disp, dat_ult_compra, is_pending)
        select
            e.cd,
            app.pvps_alocacao_normalize_zone(sep.endereco) as zona,
            e.coddv,
            coalesce(nullif(trim(coalesce(sep.descricao, '')), ''), nullif(trim(coalesce(pul.descricao, '')), ''), format('CODDV %s', e.coddv)) as descricao,
            upper(trim(sep.endereco)) as end_sep,
            upper(trim(pul.endereco)) as end_pul,
            greatest(coalesce(e.qtd_est_disp, 0), 0),
            e.dat_ult_compra,
            true
        from app.db_estq_entr e
        join app.db_end sep on sep.cd = e.cd and sep.coddv = e.coddv and upper(trim(coalesce(sep.tipo, ''))) = 'SEP'
        join app.db_end pul on pul.cd = e.cd and pul.coddv = e.coddv and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where e.cd = v_cd
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
          and app.pvps_alocacao_normalize_zone(sep.endereco) = v_zona
          and not exists (
              select 1 from app.pvps_alocacao_blacklist bl
              where bl.cd = e.cd and bl.coddv = e.coddv and bl.zona = v_zona and bl.modulo in ('pvps', 'ambos')
          )
          and not exists (
              select 1 from app.aud_pvps ap
              where ap.cd = e.cd and ap.coddv = e.coddv and ap.end_sep = upper(trim(sep.endereco))
                and ap.status in ('concluido', 'nao_conforme')
          )
        on conflict (cd, coddv, end_sep, end_pul)
        do update set is_pending = true;

        get diagnostics v_reposto_pvps = row_count;
    end if;

    if v_modulo in ('alocacao', 'ambos') then
        insert into app.db_alocacao (cd, zona, coddv, descricao, endereco, nivel, val_sist, qtd_est_disp, dat_ult_compra, is_pending)
        select
            e.cd,
            app.pvps_alocacao_normalize_zone(pul.endereco) as zona,
            e.coddv,
            coalesce(nullif(trim(coalesce(pul.descricao, '')), ''), format('CODDV %s', e.coddv)) as descricao,
            upper(trim(pul.endereco)) as endereco,
            nullif(trim(coalesce(pul.andar, '')), '') as nivel,
            app.pvps_alocacao_normalize_validade(pul.validade),
            greatest(coalesce(e.qtd_est_disp, 0), 0),
            e.dat_ult_compra,
            true
        from app.db_estq_entr e
        join app.db_end pul on pul.cd = e.cd and pul.coddv = e.coddv and upper(trim(coalesce(pul.tipo, ''))) = 'PUL'
        where e.cd = v_cd
          and coalesce(e.qtd_est_disp, 0) > 100
          and e.dat_ult_compra is not null
          and app.pvps_alocacao_normalize_zone(pul.endereco) = v_zona
          and nullif(trim(coalesce(pul.validade, '')), '') is not null
          and not exists (
              select 1 from app.pvps_alocacao_blacklist bl
              where bl.cd = e.cd and bl.coddv = e.coddv and bl.zona = v_zona and bl.modulo in ('alocacao', 'ambos')
          )
          and not exists (
              select 1 from app.aud_alocacao aa
              where aa.cd = e.cd and aa.coddv = e.coddv and aa.endereco = upper(trim(pul.endereco))
          )
        on conflict (cd, coddv, endereco)
        do update set is_pending = true;

        get diagnostics v_reposto_aloc = row_count;
    end if;

    return query
    select v_reposto_pvps, v_reposto_aloc;
end;
$$;

grant execute on function public.rpc_pvps_admin_blacklist_list(integer, text) to authenticated;
grant execute on function public.rpc_pvps_admin_blacklist_upsert(integer, text, text, integer) to authenticated;
grant execute on function public.rpc_pvps_admin_blacklist_delete(uuid) to authenticated;
grant execute on function public.rpc_pvps_admin_priority_zone_list(integer, text) to authenticated;
grant execute on function public.rpc_pvps_admin_priority_zone_upsert(integer, text, text, integer) to authenticated;
grant execute on function public.rpc_pvps_admin_priority_zone_delete(uuid) to authenticated;
grant execute on function public.rpc_pvps_admin_clear_zone(integer, text, text, boolean) to authenticated;
grant execute on function public.rpc_pvps_admin_reseed_zone(integer, text, text) to authenticated;
