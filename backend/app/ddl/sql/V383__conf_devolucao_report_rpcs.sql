drop function if exists public.rpc_conf_devolucao_report_count(date, date, integer);
create or replace function public.rpc_conf_devolucao_report_count(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer
)
returns table (
    total_conferencias bigint,
    total_itens bigint
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

    if p_dt_ini is null then
        raise exception 'DATA_INICIAL_OBRIGATORIA';
    end if;

    if p_dt_fim is null then
        raise exception 'DATA_FINAL_OBRIGATORIA';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    v_cd := authz.resolve_admin_report_cd(v_uid, p_cd);

    return query
    with filtered_conf as (
        select c.conf_id
        from app.conf_devolucao c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    filtered_items as (
        select i.item_id
        from app.conf_devolucao_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
    )
    select
        (select count(*)::bigint from filtered_conf) as total_conferencias,
        (select count(*)::bigint from filtered_items) as total_itens;
end;
$$;

drop function if exists public.rpc_conf_devolucao_report_rows(date, date, integer, integer, integer);
create or replace function public.rpc_conf_devolucao_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_limit integer default 1000,
    p_offset integer default 0
)
returns table (
    conf_date date,
    cd integer,
    conference_kind text,
    nfd bigint,
    chave text,
    ref text,
    source_motivo text,
    nfo text,
    motivo_sem_nfd text,
    status text,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    total_itens integer,
    itens_conferidos integer,
    itens_divergentes integer,
    falta_motivo text,
    has_item boolean,
    coddv integer,
    descricao text,
    tipo text,
    barras text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_manual_total integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    lotes text,
    validades text,
    item_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_limit integer;
    v_offset integer;
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

    if p_dt_ini is null then
        raise exception 'DATA_INICIAL_OBRIGATORIA';
    end if;

    if p_dt_fim is null then
        raise exception 'DATA_FINAL_OBRIGATORIA';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    v_limit := greatest(coalesce(p_limit, 1000), 1);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_cd := authz.resolve_admin_report_cd(v_uid, p_cd);

    return query
    with filtered_conf as (
        select
            c.conf_id,
            c.conf_date,
            c.cd,
            c.conference_kind,
            c.nfd,
            nullif(trim(coalesce(c.chave, '')), '') as chave,
            case
                when c.conference_kind = 'sem_nfd' then
                    coalesce(
                        nullif(trim(coalesce(c.nfo, '')), ''),
                        format('SEM-NFD-%s', upper(substr(c.conf_id::text, 1, 8)))
                    )
                else
                    coalesce(
                        nullif(trim(coalesce(c.chave, '')), ''),
                        c.nfd::text,
                        format('CONF-%s', upper(substr(c.conf_id::text, 1, 8)))
                    )
            end as ref,
            nullif(trim(coalesce(c.source_motivo, '')), '') as source_motivo,
            nullif(trim(coalesce(c.nfo, '')), '') as nfo,
            nullif(trim(coalesce(c.motivo_sem_nfd, '')), '') as motivo_sem_nfd,
            c.status,
            nullif(trim(coalesce(c.started_mat, '')), '') as started_mat,
            nullif(trim(coalesce(c.started_nome, '')), '') as started_nome,
            c.started_at,
            c.finalized_at,
            c.updated_at,
            nullif(trim(coalesce(c.falta_motivo, '')), '') as falta_motivo
        from app.conf_devolucao c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    conf_stats as (
        select
            i.conf_id,
            count(*)::integer as total_itens,
            count(*) filter (where coalesce(i.qtd_conferida, 0) > 0)::integer as itens_conferidos,
            count(*) filter (
                where coalesce(i.qtd_conferida, 0) <> coalesce(i.qtd_esperada, 0)
            )::integer as itens_divergentes
        from app.conf_devolucao_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
        group by i.conf_id
    )
    select
        c.conf_date,
        c.cd,
        c.conference_kind,
        c.nfd,
        c.chave,
        c.ref,
        c.source_motivo,
        c.nfo,
        c.motivo_sem_nfd,
        c.status,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        coalesce(s.total_itens, 0)::integer as total_itens,
        coalesce(s.itens_conferidos, 0)::integer as itens_conferidos,
        coalesce(s.itens_divergentes, 0)::integer as itens_divergentes,
        c.falta_motivo,
        (i.item_id is not null) as has_item,
        i.coddv,
        coalesce(
            nullif(trim(coalesce(i.descricao, '')), ''),
            case when i.coddv is not null then format('Produto %s', i.coddv) else null end
        ) as descricao,
        nullif(trim(coalesce(i.tipo, '')), '') as tipo,
        nullif(trim(coalesce(i.barras, '')), '') as barras,
        coalesce(i.qtd_esperada, 0)::integer as qtd_esperada,
        coalesce(i.qtd_conferida, 0)::integer as qtd_conferida,
        coalesce(i.qtd_manual_total, 0)::integer as qtd_manual_total,
        greatest(coalesce(i.qtd_esperada, 0) - coalesce(i.qtd_conferida, 0), 0)::integer as qtd_falta,
        greatest(coalesce(i.qtd_conferida, 0) - coalesce(i.qtd_esperada, 0), 0)::integer as qtd_sobra,
        case
            when i.item_id is null then 'correto'
            when coalesce(i.qtd_conferida, 0) < coalesce(i.qtd_esperada, 0) then 'falta'
            when coalesce(i.qtd_conferida, 0) > coalesce(i.qtd_esperada, 0) then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        nullif(trim(coalesce(i.lotes, '')), '') as lotes,
        nullif(trim(coalesce(i.validades, '')), '') as validades,
        i.updated_at as item_updated_at
    from filtered_conf c
    left join app.conf_devolucao_itens i
      on i.conf_id = c.conf_id
    left join conf_stats s
      on s.conf_id = c.conf_id
    order by
        c.conf_date,
        c.conference_kind,
        c.ref,
        coalesce(i.coddv, 0)
    limit v_limit
    offset v_offset;
end;
$$;

grant execute on function public.rpc_conf_devolucao_report_count(date, date, integer) to authenticated;
grant execute on function public.rpc_conf_devolucao_report_rows(date, date, integer, integer, integer) to authenticated;
