create index if not exists idx_app_db_end_cd_updated_coddv_tipo_endereco
    on app.db_end (cd, updated_at, coddv, tipo, endereco);

create index if not exists idx_app_db_end_cd_coddv_tipo_endereco
    on app.db_end (cd, coddv, tipo, endereco);

create or replace function public.rpc_db_end_meta(
    p_cd integer default null
)
returns table (
    row_count bigint,
    updated_max timestamptz
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

    v_cd := app.busca_produto_resolve_cd(p_cd);

    return query
    select
        count(*)::bigint as row_count,
        max(d.updated_at) as updated_max
    from app.db_end d
    where d.cd = v_cd
      and nullif(trim(coalesce(d.endereco, '')), '') is not null;
end;
$$;

create or replace function public.rpc_db_end_page(
    p_cd integer default null,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    cd integer,
    coddv integer,
    descricao text,
    endereco text,
    tipo text,
    andar text,
    validade text,
    updated_at timestamptz
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

    v_cd := app.busca_produto_resolve_cd(p_cd);

    return query
    select
        d.cd,
        d.coddv,
        coalesce(nullif(trim(coalesce(d.descricao, '')), ''), format('CODDV %s', d.coddv)) as descricao,
        upper(trim(d.endereco)) as endereco,
        upper(trim(coalesce(d.tipo, ''))) as tipo,
        nullif(trim(coalesce(d.andar, '')), '') as andar,
        nullif(trim(coalesce(d.validade, '')), '') as validade,
        d.updated_at
    from app.db_end d
    where d.cd = v_cd
      and nullif(trim(coalesce(d.endereco, '')), '') is not null
    order by
        d.coddv,
        upper(trim(coalesce(d.tipo, ''))),
        upper(trim(d.endereco)),
        d.updated_at nulls last
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 1000), 1), 2000);
end;
$$;

create or replace function public.rpc_db_end_delta_count(
    p_cd integer default null,
    p_updated_after timestamptz default null
)
returns table (
    row_count bigint
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

    v_cd := app.busca_produto_resolve_cd(p_cd);

    return query
    select
        count(*)::bigint as row_count
    from app.db_end d
    where d.cd = v_cd
      and nullif(trim(coalesce(d.endereco, '')), '') is not null
      and (
          p_updated_after is null
          or d.updated_at > p_updated_after
      );
end;
$$;

create or replace function public.rpc_db_end_delta(
    p_cd integer default null,
    p_updated_after timestamptz default null,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    cd integer,
    coddv integer,
    descricao text,
    endereco text,
    tipo text,
    andar text,
    validade text,
    updated_at timestamptz
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

    v_cd := app.busca_produto_resolve_cd(p_cd);

    return query
    select
        d.cd,
        d.coddv,
        coalesce(nullif(trim(coalesce(d.descricao, '')), ''), format('CODDV %s', d.coddv)) as descricao,
        upper(trim(d.endereco)) as endereco,
        upper(trim(coalesce(d.tipo, ''))) as tipo,
        nullif(trim(coalesce(d.andar, '')), '') as andar,
        nullif(trim(coalesce(d.validade, '')), '') as validade,
        d.updated_at
    from app.db_end d
    where d.cd = v_cd
      and nullif(trim(coalesce(d.endereco, '')), '') is not null
      and (
          p_updated_after is null
          or d.updated_at > p_updated_after
      )
    order by
        d.updated_at nulls last,
        d.coddv,
        upper(trim(coalesce(d.tipo, ''))),
        upper(trim(d.endereco))
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 1000), 1), 2000);
end;
$$;

grant execute on function public.rpc_db_end_meta(integer) to authenticated;
grant execute on function public.rpc_db_end_page(integer, integer, integer) to authenticated;
grant execute on function public.rpc_db_end_delta_count(integer, timestamptz) to authenticated;
grant execute on function public.rpc_db_end_delta(integer, timestamptz, integer, integer) to authenticated;
