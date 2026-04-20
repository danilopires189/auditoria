create or replace function app.produtividade_indicator_catalog()
returns table (
    sort_order integer,
    activity_key text,
    activity_label text,
    unit_label text,
    include_in_ranking boolean
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $function$
    select *
    from (
        values
            (1, 'coleta_sku'::text, 'Coleta de Mercadoria'::text, 'sku'::text, false),
            (2, 'pvps_endereco'::text, 'PVPS'::text, 'endereços'::text, true),
            (3, 'atividade_extra_pontos'::text, 'Atividade Extra'::text, 'pontos'::text, true),
            (4, 'alocacao_endereco'::text, 'Alocação'::text, 'endereços'::text, true),
            (5, 'entrada_notas_sku'::text, 'Entrada de Notas'::text, 'sku'::text, true),
            (6, 'termo_sku'::text, 'Conferência de Termo'::text, 'sku'::text, true),
            (7, 'avulso_sku'::text, 'Conferência Volume Avulso'::text, 'sku'::text, true),
            (8, 'pedido_direto_sku'::text, 'Conferência Pedido Direto'::text, 'sku'::text, false),
            (9, 'transferencia_cd_sku'::text, 'Transferência CD'::text, 'sku'::text, true),
            (10, 'zerados_endereco'::text, 'Inventário (Zerados)'::text, 'endereços'::text, true),
            (11, 'devolucao_nfd'::text, 'Devolução de Mercadoria'::text, 'nfd'::text, true),
            (12, 'prod_blitz_un'::text, 'Produtividade Blitz'::text, 'unidades'::text, true),
            (13, 'prod_vol_mes'::text, 'Volume Expedido'::text, 'volume'::text, true),
            (14, 'registro_embarque_loja'::text, 'Registro de Embarque'::text, 'lojas'::text, true),
            (15, 'auditoria_caixa_volume'::text, 'Auditoria de Caixa'::text, 'volumes'::text, true),
            (16, 'ronda_quality_auditoria'::text, 'Ronda de Qualidade'::text, 'auditorias'::text, true),
            (17, 'checklist_auditoria'::text, 'Check List'::text, 'checklists'::text, true),
            (18, 'caixa_termica_mov'::text, 'Caixa Térmica'::text, 'pontos'::text, true)
    ) as t(sort_order, activity_key, activity_label, unit_label, include_in_ranking);
$function$;

do $$
begin
    if to_regprocedure('app.produtividade_events_base_legacy_v461(integer,date,date)') is null then
        alter function app.produtividade_events_base(integer, date, date)
        rename to produtividade_events_base_legacy_v461;
    end if;
end;
$$;

create or replace function app.produtividade_events_base(
    p_cd integer,
    p_dt_ini date default null,
    p_dt_fim date default null
)
returns table (
    activity_key text,
    activity_label text,
    unit_label text,
    user_id uuid,
    mat text,
    nome text,
    event_date date,
    metric_value numeric(18,3),
    detail text,
    source_ref text,
    event_at timestamptz
)
language sql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $function$
    select
        b.activity_key,
        b.activity_label,
        b.unit_label,
        b.user_id,
        b.mat,
        b.nome,
        b.event_date,
        b.metric_value,
        b.detail,
        b.source_ref,
        b.event_at
    from app.produtividade_events_base_legacy_v461(p_cd, p_dt_ini, p_dt_fim) b

    union all

    select
        'ronda_quality_auditoria'::text as activity_key,
        'Ronda de Qualidade'::text as activity_label,
        'auditorias'::text as unit_label,
        s.auditor_id as user_id,
        s.auditor_mat as mat,
        s.auditor_nome as nome,
        timezone('America/Sao_Paulo', s.created_at)::date as event_date,
        1::numeric(18,3) as metric_value,
        concat_ws(
            ' | ',
            case when s.zone_type = 'PUL' then 'Pulmão' else 'Separação' end,
            format('Zona %s', s.zona),
            case when s.zone_type = 'PUL' then format('Coluna %s', s.coluna) else null end,
            case when s.audit_result = 'sem_ocorrencia' then 'Sem ocorrência' else 'Com ocorrência' end
        ) as detail,
        s.audit_id::text as source_ref,
        s.created_at as event_at
    from (
        select ranked.*
        from (
            select
                r.*,
                row_number() over (
                    partition by
                        r.auditor_id,
                        r.cd,
                        r.month_ref,
                        r.zone_type,
                        r.zona,
                        coalesce(r.coluna, -1)
                    order by r.created_at, r.audit_id
                ) as row_num
            from app.aud_ronda_quality_sessions r
            where r.cd = p_cd
              and (p_dt_ini is null or timezone('America/Sao_Paulo', r.created_at)::date >= p_dt_ini)
              and (p_dt_fim is null or timezone('America/Sao_Paulo', r.created_at)::date <= p_dt_fim)
        ) ranked
        where ranked.row_num = 1
    ) s

    union all

    select
        'checklist_auditoria'::text as activity_key,
        'Check List'::text as activity_label,
        'checklists'::text as unit_label,
        a.auditor_id as user_id,
        coalesce(nullif(trim(a.auditor_mat), ''), 'SEM_MATRICULA') as mat,
        coalesce(nullif(trim(a.auditor_nome), ''), 'USUARIO') as nome,
        timezone('America/Sao_Paulo', coalesce(a.signed_at, a.created_at))::date as event_date,
        1::numeric(18,3) as metric_value,
        concat_ws(
            ' | ',
            a.checklist_title,
            format('%s itens', a.total_items),
            format('%s NC', a.non_conformities),
            case when a.risk_level is not null then format('Risco %s', a.risk_level) else null end,
            case when a.conformity_percent is not null then format('Conformidade %s%%', a.conformity_percent) else null end
        ) as detail,
        a.audit_id::text as source_ref,
        coalesce(a.signed_at, a.created_at) as event_at
    from app.checklist_dto_pvps_audits a
    where a.cd = p_cd
      and (p_dt_ini is null or timezone('America/Sao_Paulo', coalesce(a.signed_at, a.created_at))::date >= p_dt_ini)
      and (p_dt_fim is null or timezone('America/Sao_Paulo', coalesce(a.signed_at, a.created_at))::date <= p_dt_fim);
$function$;

create or replace function public.rpc_produtividade_activity_totals(
    p_cd integer default null,
    p_target_user_id uuid default null,
    p_dt_ini date default null,
    p_dt_fim date default null
)
returns table (
    sort_order integer,
    activity_key text,
    activity_label text,
    unit_label text,
    registros_count bigint,
    valor_total numeric(18,3),
    last_event_date date
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
    v_is_admin boolean;
    v_target_user_id uuid;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.produtividade_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';
    v_mode := app.produtividade_visibility_mode(v_cd);
    v_target_user_id := coalesce(p_target_user_id, v_uid);

    if v_target_user_id <> v_uid
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    return query
    with catalog as (
        select c.sort_order, c.activity_key, c.activity_label, c.unit_label
        from app.produtividade_indicator_catalog() c
    ),
    agg as (
        select
            e.activity_key,
            count(*)::bigint as registros_count,
            round(coalesce(sum(e.metric_value), 0), 3)::numeric(18,3) as valor_total,
            max(e.event_date) as last_event_date
        from app.produtividade_events_base(v_cd, p_dt_ini, p_dt_fim) e
        where e.user_id = v_target_user_id
          and (
              v_is_admin
              or v_mode = 'public_cd'
              or e.user_id = v_uid
          )
        group by e.activity_key
    )
    select
        c.sort_order,
        c.activity_key,
        c.activity_label,
        c.unit_label,
        coalesce(a.registros_count, 0)::bigint as registros_count,
        coalesce(a.valor_total, 0)::numeric(18,3) as valor_total,
        a.last_event_date
    from catalog c
    left join agg a
      on a.activity_key = c.activity_key
    order by c.sort_order;
end;
$$;

create or replace function public.rpc_produtividade_entries(
    p_cd integer default null,
    p_target_user_id uuid default null,
    p_dt_ini date default null,
    p_dt_fim date default null,
    p_activity_key text default null,
    p_limit integer default 400
)
returns table (
    entry_id text,
    event_at timestamptz,
    event_date date,
    activity_key text,
    activity_label text,
    unit_label text,
    metric_value numeric(18,3),
    detail text,
    source_ref text
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
    v_is_admin boolean;
    v_target_user_id uuid;
    v_activity_key text;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.produtividade_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';
    v_mode := app.produtividade_visibility_mode(v_cd);
    v_target_user_id := coalesce(p_target_user_id, v_uid);
    v_activity_key := nullif(lower(trim(coalesce(p_activity_key, ''))), '');
    v_limit := greatest(1, least(coalesce(p_limit, 400), 2000));

    if v_target_user_id <> v_uid
       and not (v_is_admin or v_mode = 'public_cd') then
        raise exception 'SEM_PERMISSAO_VISUALIZAR_COLABORADOR';
    end if;

    if v_activity_key is not null and not exists (
        select 1
        from app.produtividade_indicator_catalog() c
        where c.activity_key = v_activity_key
    ) then
        raise exception 'ATIVIDADE_INVALIDA';
    end if;

    return query
    select
        concat_ws(
            ':',
            e.activity_key,
            to_char(e.event_date, 'YYYYMMDD'),
            coalesce(e.source_ref, left(md5(coalesce(e.detail, '')), 12))
        ) as entry_id,
        e.event_at,
        e.event_date,
        e.activity_key,
        case
            when e.activity_key = 'prod_blitz_un' then 'Produtividade Blitz'::text
            when e.activity_key = 'prod_vol_mes' then 'Volume Expedido'::text
            else e.activity_label
        end as activity_label,
        e.unit_label,
        e.metric_value,
        e.detail,
        e.source_ref
    from app.produtividade_events_base(v_cd, p_dt_ini, p_dt_fim) e
    where e.user_id = v_target_user_id
      and (
          v_is_admin
          or v_mode = 'public_cd'
          or e.user_id = v_uid
      )
      and (v_activity_key is null or e.activity_key = v_activity_key)
    order by
        e.event_date desc,
        e.event_at desc nulls last,
        e.activity_label,
        e.source_ref
    limit v_limit;
end;
$$;

drop function if exists public.rpc_produtividade_ranking(integer, integer, integer);
create or replace function public.rpc_produtividade_ranking(
    p_cd integer default null,
    p_mes integer default null,
    p_ano integer default null
)
returns table (
    user_id uuid,
    mat text,
    nome text,
    posicao integer,
    pvps_pontos numeric(18,3),
    pvps_qtd numeric(18,3),
    vol_pontos numeric(18,3),
    vol_qtd numeric(18,3),
    blitz_pontos numeric(18,3),
    blitz_qtd numeric(18,3),
    zerados_pontos numeric(18,3),
    zerados_qtd numeric(18,3),
    atividade_extra_pontos numeric(18,3),
    atividade_extra_qtd numeric(18,3),
    alocacao_pontos numeric(18,3),
    alocacao_qtd numeric(18,3),
    devolucao_pontos numeric(18,3),
    devolucao_qtd numeric(18,3),
    conf_termo_pontos numeric(18,3),
    conf_termo_qtd numeric(18,3),
    conf_avulso_pontos numeric(18,3),
    conf_avulso_qtd numeric(18,3),
    conf_entrada_pontos numeric(18,3),
    conf_entrada_qtd numeric(18,3),
    conf_transferencia_cd_pontos numeric(18,3),
    conf_transferencia_cd_qtd numeric(18,3),
    conf_lojas_pontos numeric(18,3),
    conf_lojas_qtd numeric(18,3),
    aud_caixa_pontos numeric(18,3),
    aud_caixa_qtd numeric(18,3),
    caixa_termica_pontos numeric(18,3),
    caixa_termica_qtd numeric(18,3),
    ronda_quality_pontos numeric(18,3),
    ronda_quality_qtd numeric(18,3),
    checklist_pontos numeric(18,3),
    checklist_qtd numeric(18,3),
    total_pontos numeric(18,3)
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_mode text;
    v_is_admin boolean;
    v_dt_ini date;
    v_dt_fim date;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.produtividade_resolve_cd(p_cd);
    v_is_admin := authz.user_role(v_uid) = 'admin';
    v_mode := app.produtividade_visibility_mode(v_cd);

    if p_mes is not null and p_ano is not null then
        v_dt_ini := make_date(p_ano, p_mes, 1);
        v_dt_fim := (v_dt_ini + interval '1 month' - interval '1 day')::date;
    else
        v_dt_ini := date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
        v_dt_fim := (v_dt_ini + interval '1 month' - interval '1 day')::date;
    end if;

    return query
    with ranking_catalog as (
        select c.activity_key
        from app.produtividade_indicator_catalog() c
        where c.include_in_ranking
    ),
    basica as (
        select e.*
        from app.produtividade_events_base(v_cd, v_dt_ini, v_dt_fim) e
        join ranking_catalog c
          on c.activity_key = e.activity_key
    ),
    usuarios_metricas as (
        select
            b.user_id,
            min(b.mat) as mat,
            min(b.nome) as nome,
            b.activity_key,
            count(*)::numeric(18,3) as total_registros,
            sum(b.metric_value)::numeric(18,3) as total_val
        from basica b
        group by b.user_id, b.activity_key
    ),
    ranks_pvps as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'pvps_endereco'
    ),
    ranks_alocacao as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'alocacao_endereco'
    ),
    ranks_zerados as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'zerados_endereco'
    ),
    ranks_vol as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'prod_vol_mes'
    ),
    ranks_blitz as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'prod_blitz_un'
    ),
    ranks_devolucao as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'devolucao_nfd'
    ),
    ranks_termo as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'termo_sku'
    ),
    ranks_avulso as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'avulso_sku'
    ),
    ranks_entrada as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'entrada_notas_sku'
    ),
    ranks_transferencia_cd as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'transferencia_cd_sku'
    ),
    ranks_lojas as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'registro_embarque_loja'
    ),
    ranks_aud_caixa as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'auditoria_caixa_volume'
    ),
    ranks_ronda_quality as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'ronda_quality_auditoria'
    ),
    ranks_checklist as (
        select um.user_id, dense_rank() over(order by um.total_val desc) as pos
        from usuarios_metricas um
        where um.activity_key = 'checklist_auditoria'
    ),
    usuarios_unicos as (
        select distinct um.user_id, um.mat, um.nome
        from usuarios_metricas um
    ),
    componentes as (
        select
            u.user_id,
            u.mat,
            u.nome,
            round(coalesce((select greatest(0.5, 3.5 - (rp.pos - 1) * 0.5) from ranks_pvps rp where rp.user_id = u.user_id), 0), 3)::numeric(18,3) as pvps_pontos,
            round(coalesce((select greatest(0.5, 10.0 - (rv.pos - 1) * 0.5) from ranks_vol rv where rv.user_id = u.user_id), 0), 3)::numeric(18,3) as vol_pontos,
            round(coalesce((select greatest(0.5, 10.0 - (rb.pos - 1) * 0.5) from ranks_blitz rb where rb.user_id = u.user_id), 0), 3)::numeric(18,3) as blitz_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (rz.pos - 1) * 0.5) from ranks_zerados rz where rz.user_id = u.user_id), 0), 3)::numeric(18,3) as zerados_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (ra.pos - 1) * 0.5) from ranks_alocacao ra where ra.user_id = u.user_id), 0), 3)::numeric(18,3) as alocacao_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (rd.pos - 1) * 0.5) from ranks_devolucao rd where rd.user_id = u.user_id), 0), 3)::numeric(18,3) as devolucao_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (rt.pos - 1) * 0.5) from ranks_termo rt where rt.user_id = u.user_id), 0), 3)::numeric(18,3) as conf_termo_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (rav.pos - 1) * 0.5) from ranks_avulso rav where rav.user_id = u.user_id), 0), 3)::numeric(18,3) as conf_avulso_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (re.pos - 1) * 0.5) from ranks_entrada re where re.user_id = u.user_id), 0), 3)::numeric(18,3) as conf_entrada_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (rtc.pos - 1) * 0.5) from ranks_transferencia_cd rtc where rtc.user_id = u.user_id), 0), 3)::numeric(18,3) as conf_transferencia_cd_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (rl.pos - 1) * 0.5) from ranks_lojas rl where rl.user_id = u.user_id), 0), 3)::numeric(18,3) as conf_lojas_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (rac.pos - 1) * 0.5) from ranks_aud_caixa rac where rac.user_id = u.user_id), 0), 3)::numeric(18,3) as aud_caixa_pontos,
            round(coalesce((select greatest(0.5, 3.5 - (rrq.pos - 1) * 0.5) from ranks_ronda_quality rrq where rrq.user_id = u.user_id), 0), 3)::numeric(18,3) as ronda_quality_pontos,
            round(coalesce((select greatest(0.2, 2.0 - ((rc.pos - 1) * 0.2)) from ranks_checklist rc where rc.user_id = u.user_id), 0), 3)::numeric(18,3) as checklist_pontos,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'pvps_endereco'), 0), 3)::numeric(18,3) as pvps_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'prod_vol_mes'), 0), 3)::numeric(18,3) as vol_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'prod_blitz_un'), 0), 3)::numeric(18,3) as blitz_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'zerados_endereco'), 0), 3)::numeric(18,3) as zerados_qtd,
            round(coalesce((select um.total_registros from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'atividade_extra_pontos'), 0), 3)::numeric(18,3) as atividade_extra_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'alocacao_endereco'), 0), 3)::numeric(18,3) as alocacao_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'devolucao_nfd'), 0), 3)::numeric(18,3) as devolucao_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'termo_sku'), 0), 3)::numeric(18,3) as conf_termo_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'avulso_sku'), 0), 3)::numeric(18,3) as conf_avulso_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'entrada_notas_sku'), 0), 3)::numeric(18,3) as conf_entrada_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'transferencia_cd_sku'), 0), 3)::numeric(18,3) as conf_transferencia_cd_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'registro_embarque_loja'), 0), 3)::numeric(18,3) as conf_lojas_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'auditoria_caixa_volume'), 0), 3)::numeric(18,3) as aud_caixa_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'caixa_termica_mov'), 0), 3)::numeric(18,3) as caixa_termica_pontos,
            round(coalesce((select um.total_registros from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'caixa_termica_mov'), 0), 3)::numeric(18,3) as caixa_termica_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'ronda_quality_auditoria'), 0), 3)::numeric(18,3) as ronda_quality_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'checklist_auditoria'), 0), 3)::numeric(18,3) as checklist_qtd,
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'atividade_extra_pontos'), 0), 3)::numeric(18,3) as atividade_extra_pontos
        from usuarios_unicos u
    ),
    pontuacao_geral as (
        select
            c.user_id,
            c.mat,
            c.nome,
            c.pvps_pontos, c.pvps_qtd,
            c.vol_pontos, c.vol_qtd,
            c.blitz_pontos, c.blitz_qtd,
            c.zerados_pontos, c.zerados_qtd,
            c.atividade_extra_pontos, c.atividade_extra_qtd,
            c.alocacao_pontos, c.alocacao_qtd,
            c.devolucao_pontos, c.devolucao_qtd,
            c.conf_termo_pontos, c.conf_termo_qtd,
            c.conf_avulso_pontos, c.conf_avulso_qtd,
            c.conf_entrada_pontos, c.conf_entrada_qtd,
            c.conf_transferencia_cd_pontos, c.conf_transferencia_cd_qtd,
            c.conf_lojas_pontos, c.conf_lojas_qtd,
            c.aud_caixa_pontos, c.aud_caixa_qtd,
            c.caixa_termica_pontos, c.caixa_termica_qtd,
            c.ronda_quality_pontos, c.ronda_quality_qtd,
            c.checklist_pontos, c.checklist_qtd,
            round(
                c.pvps_pontos +
                c.vol_pontos +
                c.blitz_pontos +
                c.zerados_pontos +
                c.atividade_extra_pontos +
                c.alocacao_pontos +
                c.devolucao_pontos +
                c.conf_termo_pontos +
                c.conf_avulso_pontos +
                c.conf_entrada_pontos +
                c.conf_transferencia_cd_pontos +
                c.conf_lojas_pontos +
                c.aud_caixa_pontos +
                c.caixa_termica_pontos +
                c.ronda_quality_pontos +
                c.checklist_pontos,
                3
            )::numeric(18,3) as total_pontos
        from componentes c
    ),
    ranking_geral as (
        select
            pg.user_id, pg.mat, pg.nome,
            dense_rank() over(order by pg.total_pontos desc)::integer as posicao,
            pg.pvps_pontos, pg.pvps_qtd,
            pg.vol_pontos, pg.vol_qtd,
            pg.blitz_pontos, pg.blitz_qtd,
            pg.zerados_pontos, pg.zerados_qtd,
            pg.atividade_extra_pontos, pg.atividade_extra_qtd,
            pg.alocacao_pontos, pg.alocacao_qtd,
            pg.devolucao_pontos, pg.devolucao_qtd,
            pg.conf_termo_pontos, pg.conf_termo_qtd,
            pg.conf_avulso_pontos, pg.conf_avulso_qtd,
            pg.conf_entrada_pontos, pg.conf_entrada_qtd,
            pg.conf_transferencia_cd_pontos, pg.conf_transferencia_cd_qtd,
            pg.conf_lojas_pontos, pg.conf_lojas_qtd,
            pg.aud_caixa_pontos, pg.aud_caixa_qtd,
            pg.caixa_termica_pontos, pg.caixa_termica_qtd,
            pg.ronda_quality_pontos, pg.ronda_quality_qtd,
            pg.checklist_pontos, pg.checklist_qtd,
            pg.total_pontos
        from pontuacao_geral pg
    )
    select
        rg.user_id, rg.mat, rg.nome, rg.posicao,
        rg.pvps_pontos, rg.pvps_qtd,
        rg.vol_pontos, rg.vol_qtd,
        rg.blitz_pontos, rg.blitz_qtd,
        rg.zerados_pontos, rg.zerados_qtd,
        rg.atividade_extra_pontos, rg.atividade_extra_qtd,
        rg.alocacao_pontos, rg.alocacao_qtd,
        rg.devolucao_pontos, rg.devolucao_qtd,
        rg.conf_termo_pontos, rg.conf_termo_qtd,
        rg.conf_avulso_pontos, rg.conf_avulso_qtd,
        rg.conf_entrada_pontos, rg.conf_entrada_qtd,
        rg.conf_transferencia_cd_pontos, rg.conf_transferencia_cd_qtd,
        rg.conf_lojas_pontos, rg.conf_lojas_qtd,
        rg.aud_caixa_pontos, rg.aud_caixa_qtd,
        rg.caixa_termica_pontos, rg.caixa_termica_qtd,
        rg.ronda_quality_pontos, rg.ronda_quality_qtd,
        rg.checklist_pontos, rg.checklist_qtd,
        rg.total_pontos
    from ranking_geral rg
    where v_is_admin
       or v_mode = 'public_cd'
       or rg.user_id = v_uid
    order by rg.total_pontos desc, rg.nome asc;
end;
$$;

grant execute on function public.rpc_produtividade_activity_totals(integer, uuid, date, date) to authenticated;
grant execute on function public.rpc_produtividade_entries(integer, uuid, date, date, text, integer) to authenticated;
grant execute on function public.rpc_produtividade_ranking(integer, integer, integer) to authenticated;

notify pgrst, 'reload schema';
