-- Allow both scoped admins and global admins to run conference reports.
-- Report CD selection must still stay within the CDs available to the current admin.

create or replace function authz.resolve_admin_report_cd(
    p_user_id uuid,
    p_cd integer
)
returns integer
language plpgsql
stable
security definer
set search_path = authz, public
as $$
begin
    if p_user_id is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if coalesce(authz.user_role(p_user_id), '') <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    if not authz.can_access_cd(p_user_id, p_cd) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    return p_cd;
end;
$$;

grant execute on function authz.resolve_admin_report_cd(uuid, integer) to authenticated;

create or replace function public.rpc_conf_entrada_notas_report_count(
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
        from app.conf_entrada_notas c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    filtered_items as (
        select i.item_id
        from app.conf_entrada_notas_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
    )
    select
        (select count(*)::bigint from filtered_conf) as total_conferencias,
        (select count(*)::bigint from filtered_items) as total_itens;
end;
$$;

create or replace function public.rpc_conf_entrada_notas_report_contributors(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer
)
returns table (
    conf_date date,
    cd integer,
    seq_entrada bigint,
    nf bigint,
    transportadora text,
    fornecedor text,
    status text,
    colaborador_mat text,
    colaborador_nome text,
    first_action_at timestamptz,
    last_action_at timestamptz
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
    select
        c.conf_date,
        c.cd,
        c.seq_entrada,
        c.nf,
        coalesce(nullif(trim(c.transportadora), ''), 'SEM TRANSPORTADORA') as transportadora,
        coalesce(nullif(trim(c.fornecedor), ''), 'SEM FORNECEDOR') as fornecedor,
        c.status,
        nullif(trim(col.mat), '') as colaborador_mat,
        nullif(trim(col.nome), '') as colaborador_nome,
        col.first_action_at,
        col.last_action_at
    from app.conf_entrada_notas c
    join app.conf_entrada_notas_colaboradores col
      on col.conf_id = c.conf_id
    where c.cd = v_cd
      and c.conf_date >= p_dt_ini
      and c.conf_date <= p_dt_fim
    order by
        c.conf_date,
        coalesce(nullif(trim(c.transportadora), ''), 'SEM TRANSPORTADORA'),
        coalesce(nullif(trim(c.fornecedor), ''), 'SEM FORNECEDOR'),
        c.seq_entrada,
        c.nf,
        nullif(trim(col.nome), ''),
        nullif(trim(col.mat), '');
end;
$$;

create or replace function public.rpc_conf_entrada_notas_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_limit integer default 1000,
    p_offset integer default 0
)
returns table (
    conf_date date,
    cd integer,
    seq_entrada bigint,
    nf bigint,
    transportadora text,
    fornecedor text,
    status text,
    started_mat text,
    started_nome text,
    started_at timestamptz,
    finalized_at timestamptz,
    updated_at timestamptz,
    total_itens integer,
    itens_conferidos integer,
    itens_divergentes integer,
    valor_total numeric(18, 2),
    valor_conferido numeric(18, 2),
    coddv integer,
    descricao text,
    barras text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
    ocorrencia_avariado_qtd integer,
    ocorrencia_vencido_qtd integer,
    ocorrencia_avariado_updated_at timestamptz,
    ocorrencia_vencido_updated_at timestamptz,
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
            c.seq_entrada,
            c.nf,
            coalesce(nullif(trim(c.transportadora), ''), 'SEM TRANSPORTADORA') as transportadora,
            coalesce(nullif(trim(c.fornecedor), ''), 'SEM FORNECEDOR') as fornecedor,
            c.status,
            nullif(trim(c.started_mat), '') as started_mat,
            nullif(trim(c.started_nome), '') as started_nome,
            c.started_at,
            c.finalized_at,
            c.updated_at
        from app.conf_entrada_notas c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    entrada_itens as (
        select
            t.cd,
            t.seq_entrada,
            t.nf,
            t.coddv,
            coalesce(nullif(trim(t.transportadora), ''), 'SEM TRANSPORTADORA') as transportadora,
            coalesce(nullif(trim(t.forn), ''), 'SEM FORNECEDOR') as fornecedor,
            coalesce(nullif(trim(t.descricao), ''), format('Produto %s', t.coddv)) as descricao,
            greatest(coalesce(max(t.vl_tt), 0), 0)::numeric(18, 2) as vl_tt
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.seq_entrada is not null
          and t.nf is not null
          and t.coddv is not null
        group by
            t.cd,
            t.seq_entrada,
            t.nf,
            t.coddv,
            coalesce(nullif(trim(t.transportadora), ''), 'SEM TRANSPORTADORA'),
            coalesce(nullif(trim(t.forn), ''), 'SEM FORNECEDOR'),
            coalesce(nullif(trim(t.descricao), ''), format('Produto %s', t.coddv))
    ),
    occ as (
        select
            o.conf_id,
            o.coddv,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Avariado'), 0)::integer as ocorrencia_avariado_qtd,
            coalesce(sum(o.qtd) filter (where o.tipo = 'Vencido'), 0)::integer as ocorrencia_vencido_qtd,
            max(o.updated_at) filter (where o.tipo = 'Avariado' and o.qtd > 0) as ocorrencia_avariado_updated_at,
            max(o.updated_at) filter (where o.tipo = 'Vencido' and o.qtd > 0) as ocorrencia_vencido_updated_at
        from app.conf_entrada_notas_ocorrencias o
        join filtered_conf c
          on c.conf_id = o.conf_id
        group by o.conf_id, o.coddv
    ),
    conf_stats as (
        select
            i.conf_id,
            count(*)::integer as total_itens,
            count(*) filter (where coalesce(i.qtd_conferida, 0) > 0)::integer as itens_conferidos,
            count(*) filter (
                where coalesce(i.qtd_conferida, 0) = 0
                   or coalesce(i.qtd_conferida, 0) <> coalesce(i.qtd_esperada, 0)
                   or coalesce(o.ocorrencia_avariado_qtd, 0) > 0
                   or coalesce(o.ocorrencia_vencido_qtd, 0) > 0
            )::integer as itens_divergentes
        from app.conf_entrada_notas_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
        left join occ o
          on o.conf_id = i.conf_id
         and o.coddv = i.coddv
        group by i.conf_id
    ),
    conf_values as (
        select
            i.conf_id,
            coalesce(sum(coalesce(e.vl_tt, 0::numeric)), 0::numeric)::numeric(18, 2) as valor_total,
            coalesce(sum(
                case
                    when greatest(coalesce(i.qtd_esperada, 0), 0) <= 0 then 0::numeric
                    else (
                        least(
                            greatest(coalesce(i.qtd_conferida, 0)::numeric, 0::numeric),
                            greatest(coalesce(i.qtd_esperada, 0)::numeric, 0::numeric)
                        )
                        / nullif(greatest(coalesce(i.qtd_esperada, 0)::numeric, 0::numeric), 0::numeric)
                    ) * coalesce(e.vl_tt, 0::numeric)
                end
            ), 0::numeric)::numeric(18, 2) as valor_conferido
        from app.conf_entrada_notas_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
        left join entrada_itens e
          on e.cd = c.cd
         and e.seq_entrada = c.seq_entrada
         and e.nf = c.nf
         and e.coddv = i.coddv
        group by i.conf_id
    )
    select
        c.conf_date,
        c.cd,
        c.seq_entrada,
        c.nf,
        c.transportadora,
        c.fornecedor,
        c.status,
        c.started_mat,
        c.started_nome,
        c.started_at,
        c.finalized_at,
        c.updated_at,
        coalesce(s.total_itens, 0)::integer as total_itens,
        coalesce(s.itens_conferidos, 0)::integer as itens_conferidos,
        coalesce(s.itens_divergentes, 0)::integer as itens_divergentes,
        coalesce(v.valor_total, 0)::numeric(18, 2) as valor_total,
        least(coalesce(v.valor_conferido, 0), coalesce(v.valor_total, 0))::numeric(18, 2) as valor_conferido,
        i.coddv,
        coalesce(nullif(trim(i.descricao), ''), ei.descricao, format('Produto %s', i.coddv)) as descricao,
        nullif(trim(i.barras), '') as barras,
        coalesce(i.qtd_esperada, 0)::integer as qtd_esperada,
        coalesce(i.qtd_conferida, 0)::integer as qtd_conferida,
        greatest(coalesce(i.qtd_esperada, 0) - coalesce(i.qtd_conferida, 0), 0)::integer as qtd_falta,
        greatest(coalesce(i.qtd_conferida, 0) - coalesce(i.qtd_esperada, 0), 0)::integer as qtd_sobra,
        case
            when coalesce(i.qtd_conferida, 0) = 0 then 'nao_conferido'
            when coalesce(i.qtd_conferida, 0) < coalesce(i.qtd_esperada, 0) then 'falta'
            when coalesce(i.qtd_conferida, 0) > coalesce(i.qtd_esperada, 0) then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        coalesce(o.ocorrencia_avariado_qtd, 0)::integer as ocorrencia_avariado_qtd,
        coalesce(o.ocorrencia_vencido_qtd, 0)::integer as ocorrencia_vencido_qtd,
        o.ocorrencia_avariado_updated_at,
        o.ocorrencia_vencido_updated_at,
        i.updated_at as item_updated_at
    from filtered_conf c
    join app.conf_entrada_notas_itens i
      on i.conf_id = c.conf_id
    left join entrada_itens ei
      on ei.cd = c.cd
     and ei.seq_entrada = c.seq_entrada
     and ei.nf = c.nf
     and ei.coddv = i.coddv
    left join occ o
      on o.conf_id = i.conf_id
     and o.coddv = i.coddv
    left join conf_stats s
      on s.conf_id = c.conf_id
    left join conf_values v
      on v.conf_id = c.conf_id
    order by
        c.conf_date,
        c.transportadora,
        c.fornecedor,
        c.seq_entrada,
        c.nf,
        i.coddv
    limit v_limit
    offset v_offset;
end;
$$;

create or replace function public.rpc_conf_termo_report_count(
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
        from app.conf_termo c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    filtered_items as (
        select i.item_id
        from app.conf_termo_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
    )
    select
        (select count(*)::bigint from filtered_conf) as total_conferencias,
        (select count(*)::bigint from filtered_items) as total_itens;
end;
$$;

create or replace function public.rpc_conf_termo_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_limit integer default 1000,
    p_offset integer default 0
)
returns table (
    conf_date date,
    cd integer,
    id_etiqueta text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
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
    coddv integer,
    descricao text,
    barras text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
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
            c.id_etiqueta,
            nullif(trim(coalesce(c.caixa, '')), '') as caixa,
            c.pedido,
            c.filial,
            coalesce(nullif(trim(c.filial_nome), ''), 'SEM FILIAL') as filial_nome,
            coalesce(nullif(trim(c.rota), ''), 'SEM ROTA') as rota,
            c.status,
            nullif(trim(c.started_mat), '') as started_mat,
            nullif(trim(c.started_nome), '') as started_nome,
            c.started_at,
            c.finalized_at,
            c.updated_at,
            nullif(trim(coalesce(c.falta_motivo, '')), '') as falta_motivo
        from app.conf_termo c
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
        from app.conf_termo_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
        group by i.conf_id
    )
    select
        c.conf_date,
        c.cd,
        c.id_etiqueta,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
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
        i.coddv,
        coalesce(nullif(trim(i.descricao), ''), format('Produto %s', i.coddv)) as descricao,
        nullif(trim(i.barras), '') as barras,
        coalesce(i.qtd_esperada, 0)::integer as qtd_esperada,
        coalesce(i.qtd_conferida, 0)::integer as qtd_conferida,
        greatest(coalesce(i.qtd_esperada, 0) - coalesce(i.qtd_conferida, 0), 0)::integer as qtd_falta,
        greatest(coalesce(i.qtd_conferida, 0) - coalesce(i.qtd_esperada, 0), 0)::integer as qtd_sobra,
        case
            when coalesce(i.qtd_conferida, 0) < coalesce(i.qtd_esperada, 0) then 'falta'
            when coalesce(i.qtd_conferida, 0) > coalesce(i.qtd_esperada, 0) then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at as item_updated_at
    from filtered_conf c
    join app.conf_termo_itens i
      on i.conf_id = c.conf_id
    left join conf_stats s
      on s.conf_id = c.conf_id
    order by
        c.conf_date,
        c.rota,
        c.filial_nome,
        c.id_etiqueta,
        i.coddv
    limit v_limit
    offset v_offset;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_report_count(
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
        from app.conf_pedido_direto c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    filtered_items as (
        select i.item_id
        from app.conf_pedido_direto_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
    )
    select
        (select count(*)::bigint from filtered_conf) as total_conferencias,
        (select count(*)::bigint from filtered_items) as total_itens;
end;
$$;

create or replace function public.rpc_conf_pedido_direto_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_limit integer default 1000,
    p_offset integer default 0
)
returns table (
    conf_date date,
    cd integer,
    id_vol text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
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
    coddv integer,
    descricao text,
    barras text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_falta integer,
    qtd_sobra integer,
    divergencia_tipo text,
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
            c.id_vol,
            nullif(trim(coalesce(c.caixa, '')), '') as caixa,
            c.pedido,
            c.filial,
            coalesce(nullif(trim(c.filial_nome), ''), 'SEM FILIAL') as filial_nome,
            coalesce(nullif(trim(c.rota), ''), 'SEM ROTA') as rota,
            c.status,
            nullif(trim(c.started_mat), '') as started_mat,
            nullif(trim(c.started_nome), '') as started_nome,
            c.started_at,
            c.finalized_at,
            c.updated_at,
            nullif(trim(coalesce(c.falta_motivo, '')), '') as falta_motivo
        from app.conf_pedido_direto c
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
        from app.conf_pedido_direto_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
        group by i.conf_id
    )
    select
        c.conf_date,
        c.cd,
        c.id_vol,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
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
        i.coddv,
        coalesce(nullif(trim(i.descricao), ''), format('Produto %s', i.coddv)) as descricao,
        nullif(trim(i.barras), '') as barras,
        coalesce(i.qtd_esperada, 0)::integer as qtd_esperada,
        coalesce(i.qtd_conferida, 0)::integer as qtd_conferida,
        greatest(coalesce(i.qtd_esperada, 0) - coalesce(i.qtd_conferida, 0), 0)::integer as qtd_falta,
        greatest(coalesce(i.qtd_conferida, 0) - coalesce(i.qtd_esperada, 0), 0)::integer as qtd_sobra,
        case
            when coalesce(i.qtd_conferida, 0) < coalesce(i.qtd_esperada, 0) then 'falta'
            when coalesce(i.qtd_conferida, 0) > coalesce(i.qtd_esperada, 0) then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        i.updated_at as item_updated_at
    from filtered_conf c
    join app.conf_pedido_direto_itens i
      on i.conf_id = c.conf_id
    left join conf_stats s
      on s.conf_id = c.conf_id
    order by
        c.conf_date,
        c.rota,
        c.filial_nome,
        c.id_vol,
        i.coddv
    limit v_limit
    offset v_offset;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_report_count(
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
        from app.conf_volume_avulso c
        where c.cd = v_cd
          and c.conf_date >= p_dt_ini
          and c.conf_date <= p_dt_fim
    ),
    filtered_items as (
        select i.item_id
        from app.conf_volume_avulso_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
    )
    select
        (select count(*)::bigint from filtered_conf) as total_conferencias,
        (select count(*)::bigint from filtered_items) as total_itens;
end;
$$;

create or replace function public.rpc_conf_volume_avulso_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_limit integer default 1000,
    p_offset integer default 0
)
returns table (
    conf_date date,
    cd integer,
    nr_volume text,
    caixa text,
    pedido bigint,
    filial bigint,
    filial_nome text,
    rota text,
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
    coddv integer,
    descricao text,
    barras text,
    qtd_esperada integer,
    qtd_conferida integer,
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
            c.nr_volume,
            nullif(trim(coalesce(c.caixa, '')), '') as caixa,
            c.pedido,
            c.filial,
            coalesce(nullif(trim(c.filial_nome), ''), 'SEM FILIAL') as filial_nome,
            coalesce(nullif(trim(c.rota), ''), 'SEM ROTA') as rota,
            c.status,
            nullif(trim(c.started_mat), '') as started_mat,
            nullif(trim(c.started_nome), '') as started_nome,
            c.started_at,
            c.finalized_at,
            c.updated_at,
            nullif(trim(coalesce(c.falta_motivo, '')), '') as falta_motivo
        from app.conf_volume_avulso c
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
        from app.conf_volume_avulso_itens i
        join filtered_conf c
          on c.conf_id = i.conf_id
        group by i.conf_id
    )
    select
        c.conf_date,
        c.cd,
        c.nr_volume,
        c.caixa,
        c.pedido,
        c.filial,
        c.filial_nome,
        c.rota,
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
        i.coddv,
        coalesce(nullif(trim(i.descricao), ''), format('Produto %s', i.coddv)) as descricao,
        nullif(trim(i.barras), '') as barras,
        coalesce(i.qtd_esperada, 0)::integer as qtd_esperada,
        coalesce(i.qtd_conferida, 0)::integer as qtd_conferida,
        greatest(coalesce(i.qtd_esperada, 0) - coalesce(i.qtd_conferida, 0), 0)::integer as qtd_falta,
        greatest(coalesce(i.qtd_conferida, 0) - coalesce(i.qtd_esperada, 0), 0)::integer as qtd_sobra,
        case
            when coalesce(i.qtd_conferida, 0) < coalesce(i.qtd_esperada, 0) then 'falta'
            when coalesce(i.qtd_conferida, 0) > coalesce(i.qtd_esperada, 0) then 'sobra'
            else 'correto'
        end as divergencia_tipo,
        lv.lotes,
        lv.validades,
        i.updated_at as item_updated_at
    from filtered_conf c
    join app.conf_volume_avulso_itens i
      on i.conf_id = c.conf_id
    left join conf_stats s
      on s.conf_id = c.conf_id
    left join lateral (
        select
            nullif(
                string_agg(
                    distinct nullif(trim(t.lote), ''),
                    ', ' order by nullif(trim(t.lote), '')
                ),
                ''
            ) as lotes,
            nullif(
                string_agg(
                    distinct nullif(trim(t.val), ''),
                    ', ' order by nullif(trim(t.val), '')
                ),
                ''
            ) as validades
        from app.db_avulso t
        where t.cd = c.cd
          and t.nr_volume = c.nr_volume
          and t.coddv = i.coddv
    ) lv on true
    order by
        c.conf_date,
        c.rota,
        c.filial_nome,
        c.nr_volume,
        i.coddv
    limit v_limit
    offset v_offset;
end;
$$;
