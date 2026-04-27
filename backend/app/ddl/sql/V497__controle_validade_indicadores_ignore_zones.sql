create table if not exists app.ctrl_validade_indicadores_zonas_ignoradas (
    cd integer not null,
    zona text not null,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default timezone('utc', now()),
    constraint pk_ctrl_validade_indicadores_zonas_ignoradas primary key (cd, zona)
);

alter table app.ctrl_validade_indicadores_zonas_ignoradas enable row level security;

drop policy if exists p_ctrl_validade_indicadores_zonas_ignoradas_select on app.ctrl_validade_indicadores_zonas_ignoradas;
create policy p_ctrl_validade_indicadores_zonas_ignoradas_select
on app.ctrl_validade_indicadores_zonas_ignoradas
for select
using (
    authz.session_is_recent(6)
    and (authz.is_admin(auth.uid()) or authz.can_access_cd(auth.uid(), cd))
);

revoke all on app.ctrl_validade_indicadores_zonas_ignoradas from anon;
revoke all on app.ctrl_validade_indicadores_zonas_ignoradas from authenticated;

drop function if exists public.rpc_ctrl_validade_indicadores_zonas(integer, date);
drop function if exists public.rpc_ctrl_validade_indicadores_pendentes_zona(integer, text, date, integer);
drop function if exists public.rpc_ctrl_validade_indicadores_zonas_ignoradas_list(integer);
drop function if exists public.rpc_ctrl_validade_indicadores_zona_ignorada_add(integer, text);
drop function if exists public.rpc_ctrl_validade_indicadores_zona_ignorada_delete(integer, text);

create or replace function app.ctrl_validade_indicadores_normalize_zona(p_zona text)
returns text
language sql
immutable
as $$
    select upper(left(trim(coalesce(p_zona, '')), 4));
$$;

create or replace function public.rpc_ctrl_validade_indicadores_zonas(
    p_cd integer default null,
    p_month_start date default null
)
returns table (
    zona text,
    coletado_total integer,
    pendente_total integer,
    total integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_month_start date;
    v_month_end date;
begin
    if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_month_start := coalesce(p_month_start, date_trunc('month', timezone('America/Sao_Paulo', now()))::date);
    v_month_start := date_trunc('month', v_month_start)::date;
    v_month_end := (v_month_start + interval '1 month')::date;

    return query
    with ignored as (
        select i.zona
        from app.ctrl_validade_indicadores_zonas_ignoradas i
        where i.cd = v_cd
    ),
    sep_base as (
        select distinct
            d.cd,
            d.coddv,
            upper(trim(d.endereco)) as endereco,
            app.pvps_alocacao_normalize_zone(d.endereco) as zona
        from app.db_end d
        join app.db_estq_entr e
          on e.cd = d.cd
         and e.coddv = d.coddv
         and coalesce(e.qtd_est_disp, 0) > 0
        where d.cd = v_cd
          and upper(trim(coalesce(d.tipo, ''))) = 'SEP'
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
          and not exists (
              select 1 from ignored i
              where i.zona = app.pvps_alocacao_normalize_zone(d.endereco)
          )
    ),
    coletados as (
        select distinct
            c.cd,
            c.coddv,
            upper(trim(c.endereco_sep)) as endereco,
            app.pvps_alocacao_normalize_zone(c.endereco_sep) as zona
        from app.ctrl_validade_linha_coletas c
        where c.cd = v_cd
          and timezone('America/Sao_Paulo', c.data_coleta)::date >= v_month_start
          and timezone('America/Sao_Paulo', c.data_coleta)::date < v_month_end
          and nullif(trim(coalesce(c.endereco_sep, '')), '') is not null
    ),
    pending_rows as (
        select b.*
        from sep_base b
        left join coletados c
          on c.cd = b.cd
         and c.coddv = b.coddv
         and c.endereco = b.endereco
        where c.cd is null
    ),
    coletado_por_zona as (
        select c.zona, count(*)::integer as coletado_total
        from coletados c
        group by c.zona
    ),
    pendente_por_zona as (
        select p.zona, count(*)::integer as pendente_total
        from pending_rows p
        group by p.zona
    ),
    zonas as (
        select c.zona from coletado_por_zona c
        union
        select p.zona from pendente_por_zona p
    )
    select
        z.zona,
        coalesce(c.coletado_total, 0)::integer as coletado_total,
        coalesce(p.pendente_total, 0)::integer as pendente_total,
        (coalesce(c.coletado_total, 0) + coalesce(p.pendente_total, 0))::integer as total
    from zonas z
    left join coletado_por_zona c on c.zona = z.zona
    left join pendente_por_zona p on p.zona = z.zona
    order by z.zona;
end;
$$;

create or replace function public.rpc_ctrl_validade_indicadores_pendentes_zona(
    p_cd integer default null,
    p_zona text default null,
    p_month_start date default null,
    p_limit integer default 500
)
returns table (
    endereco text,
    descricao text,
    estoque integer,
    dat_ult_compra date
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
    v_zona text;
    v_month_start date;
    v_month_end date;
begin
    if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_zona := app.ctrl_validade_indicadores_normalize_zona(p_zona);
    if nullif(v_zona, '') is null then raise exception 'ZONA_OBRIGATORIA'; end if;

    v_month_start := coalesce(p_month_start, date_trunc('month', timezone('America/Sao_Paulo', now()))::date);
    v_month_start := date_trunc('month', v_month_start)::date;
    v_month_end := (v_month_start + interval '1 month')::date;

    return query
    with ignored as (
        select i.zona
        from app.ctrl_validade_indicadores_zonas_ignoradas i
        where i.cd = v_cd
    ),
    sep_base as (
        select distinct on (upper(trim(d.endereco)), d.coddv)
            upper(trim(d.endereco)) as endereco,
            d.coddv,
            coalesce(nullif(trim(coalesce(d.descricao, '')), ''), format('CODDV %s', d.coddv)) as descricao,
            coalesce(e.qtd_est_disp, 0)::integer as estoque,
            e.dat_ult_compra
        from app.db_end d
        join app.db_estq_entr e
          on e.cd = d.cd
         and e.coddv = d.coddv
         and coalesce(e.qtd_est_disp, 0) > 0
        where d.cd = v_cd
          and upper(trim(coalesce(d.tipo, ''))) = 'SEP'
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
          and app.pvps_alocacao_normalize_zone(d.endereco) = v_zona
          and not exists (select 1 from ignored i where i.zona = v_zona)
        order by upper(trim(d.endereco)), d.coddv, e.dat_ult_compra desc nulls last
    ),
    coletados as (
        select distinct
            c.coddv,
            upper(trim(c.endereco_sep)) as endereco
        from app.ctrl_validade_linha_coletas c
        where c.cd = v_cd
          and timezone('America/Sao_Paulo', c.data_coleta)::date >= v_month_start
          and timezone('America/Sao_Paulo', c.data_coleta)::date < v_month_end
          and app.pvps_alocacao_normalize_zone(c.endereco_sep) = v_zona
    )
    select
        b.endereco,
        b.descricao,
        b.estoque,
        b.dat_ult_compra
    from sep_base b
    left join coletados c
      on c.coddv = b.coddv
     and c.endereco = b.endereco
    where c.coddv is null
    order by b.endereco, b.descricao
    limit least(greatest(coalesce(p_limit, 500), 1), 2000);
end;
$$;

create or replace function public.rpc_ctrl_validade_indicadores_zonas_ignoradas_list(
    p_cd integer default null
)
returns table (
    zona text,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_cd integer;
begin
    if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    v_cd := app.busca_produto_resolve_cd(p_cd);

    return query
    select i.zona, i.created_at
    from app.ctrl_validade_indicadores_zonas_ignoradas i
    where i.cd = v_cd
    order by i.zona;
end;
$$;

create or replace function public.rpc_ctrl_validade_indicadores_zona_ignorada_add(
    p_cd integer default null,
    p_zona text default null
)
returns table (
    zona text,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zona text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if not authz.is_admin(v_uid) then raise exception 'APENAS_ADMIN'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_zona := app.ctrl_validade_indicadores_normalize_zona(p_zona);
    if nullif(v_zona, '') is null then raise exception 'ZONA_OBRIGATORIA'; end if;

    insert into app.ctrl_validade_indicadores_zonas_ignoradas (cd, zona, created_by)
    values (v_cd, v_zona, v_uid)
    on conflict (cd, zona) do update
    set created_by = excluded.created_by,
        created_at = timezone('utc', now());

    return query
    select i.zona, i.created_at
    from app.ctrl_validade_indicadores_zonas_ignoradas i
    where i.cd = v_cd and i.zona = v_zona;
end;
$$;

create or replace function public.rpc_ctrl_validade_indicadores_zona_ignorada_delete(
    p_cd integer default null,
    p_zona text default null
)
returns boolean
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_zona text;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;
    if not authz.is_admin(v_uid) then raise exception 'APENAS_ADMIN'; end if;

    v_cd := app.busca_produto_resolve_cd(p_cd);
    v_zona := app.ctrl_validade_indicadores_normalize_zona(p_zona);
    if nullif(v_zona, '') is null then raise exception 'ZONA_OBRIGATORIA'; end if;

    delete from app.ctrl_validade_indicadores_zonas_ignoradas i
    where i.cd = v_cd and i.zona = v_zona;
    return true;
end;
$$;

grant execute on function public.rpc_ctrl_validade_indicadores_zonas(integer, date) to authenticated;
grant execute on function public.rpc_ctrl_validade_indicadores_pendentes_zona(integer, text, date, integer) to authenticated;
grant execute on function public.rpc_ctrl_validade_indicadores_zonas_ignoradas_list(integer) to authenticated;
grant execute on function public.rpc_ctrl_validade_indicadores_zona_ignorada_add(integer, text) to authenticated;
grant execute on function public.rpc_ctrl_validade_indicadores_zona_ignorada_delete(integer, text) to authenticated;
