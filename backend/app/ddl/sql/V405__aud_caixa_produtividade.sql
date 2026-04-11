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
    with profiles_cd as (
        select
            p.user_id,
            coalesce(nullif(trim(p.mat), ''), '-') as mat,
            coalesce(nullif(trim(p.nome), ''), 'Usuário') as nome,
            app.produtividade_norm_digits(p.mat) as mat_norm,
            app.produtividade_norm_text(p.nome) as nome_norm
        from authz.profiles p
        join authz.user_deposits ud
          on ud.user_id = p.user_id
         and ud.cd = p_cd
    ),
    inventario_enderecos as (
        select
            c.cd,
            c.counted_by as user_id,
            min(c.counted_mat) as mat,
            min(c.counted_nome) as nome,
            c.cycle_date as event_date,
            c.zona,
            upper(c.endereco) as endereco,
            c.etapa::integer as etapa,
            count(*)::integer as total_itens,
            min(c.count_id::text) as source_ref,
            max(c.updated_at) as event_at
        from app.conf_inventario_counts c
        where c.cd = p_cd
        group by
            c.cd,
            c.counted_by,
            c.cycle_date,
            c.zona,
            upper(c.endereco),
            c.etapa
    ),
    prod_vol_src as (
        select
            v.cd,
            coalesce(v.aud, v.usuario, '') as aud,
            coalesce(v.seq_ped, '') as seq_ped,
            v.filial,
            coalesce(v.placa, '') as placa,
            v.rota,
            coalesce(v.vol_conf, 0) as vol_conf,
            app.produtividade_norm_digits(coalesce(v.aud, v.usuario, '')) as aud_digits,
            app.produtividade_norm_text(coalesce(v.aud, v.usuario, '')) as aud_norm,
            coalesce(
                timezone('America/Sao_Paulo', v.encerramento)::date,
                timezone('America/Sao_Paulo', v.dt_lib)::date,
                timezone('America/Sao_Paulo', v.dt_ped)::date,
                timezone('America/Sao_Paulo', v.updated_at)::date
            ) as event_date,
            coalesce(v.encerramento, v.dt_lib, v.dt_ped, v.updated_at) as event_at
        from app.db_prod_vol v
        where v.cd = p_cd
          and coalesce(v.vol_conf, 0) > 0
    ),
    prod_blitz_src as (
        select
            b.cd,
            b.filial,
            b.nr_pedido,
            coalesce(b.auditor, '') as auditor,
            coalesce(b.qtd_un, 0) as qtd_un,
            app.produtividade_norm_digits(b.auditor) as aud_digits,
            app.produtividade_norm_text(b.auditor) as aud_norm,
            coalesce(
                timezone('America/Sao_Paulo', b.dt_conf)::date,
                timezone('America/Sao_Paulo', b.updated_at)::date
            ) as event_date,
            coalesce(b.dt_conf, b.updated_at) as event_at
        from app.db_prod_blitz b
        where b.cd = p_cd
          and coalesce(b.qtd_un, 0) > 0
    )
    select
        e.activity_key,
        e.activity_label,
        e.unit_label,
        e.user_id,
        e.mat,
        e.nome,
        e.event_date,
        e.metric_value,
        e.detail,
        e.source_ref,
        e.event_at
    from (
        select
            'coleta_sku'::text as activity_key,
            'Coleta de Mercadoria'::text as activity_label,
            'sku'::text as unit_label,
            c.user_id,
            c.mat_aud as mat,
            c.nome_aud as nome,
            timezone('America/Sao_Paulo', c.data_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('CODDV %s | %s', c.coddv, left(coalesce(c.descricao, ''), 110)) as detail,
            c.id::text as source_ref,
            c.data_hr as event_at
        from app.aud_coleta c
        where c.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', c.data_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', c.data_hr)::date <= p_dt_fim)

        union all

        select
            'auditoria_caixa_volume'::text as activity_key,
            'Auditoria de Caixa'::text as activity_label,
            'volumes'::text as unit_label,
            c.user_id,
            c.mat_aud as mat,
            c.nome_aud as nome,
            timezone('America/Sao_Paulo', c.data_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            concat_ws(
                ' | ',
                format('Pedido %s', c.pedido::text),
                format('Filial %s', c.filial::text),
                case
                    when nullif(trim(coalesce(c.rota, '')), '') is not null
                        then format('Rota %s', trim(c.rota))
                    else null
                end,
                case
                    when nullif(trim(coalesce(c.id_knapp, '')), '') is not null
                        then format('Knapp %s', trim(c.id_knapp))
                    when nullif(trim(coalesce(c.volume, '')), '') is not null
                        then format('Volume %s', trim(c.volume))
                    else null
                end,
                case
                    when nullif(trim(coalesce(c.ocorrencia, '')), '') is not null
                        then format('Ocorrência %s', left(trim(c.ocorrencia), 60))
                    else null
                end
            ) as detail,
            c.id::text as source_ref,
            c.data_hr as event_at
        from app.aud_caixa c
        where c.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', c.data_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', c.data_hr)::date <= p_dt_fim)

        union all

        select
            'pvps_endereco'::text as activity_key,
            'PVPS'::text as activity_label,
            'endereços'::text as unit_label,
            p.auditor_id as user_id,
            p.auditor_mat as mat,
            p.auditor_nome as nome,
            timezone('America/Sao_Paulo', coalesce(p.dt_hr_sep, p.dt_hr))::date as event_date,
            1::numeric(18,3) as metric_value,
            format('SEP %s | CODDV %s', p.end_sep, p.coddv) as detail,
            p.audit_id::text as source_ref,
            coalesce(p.dt_hr_sep, p.dt_hr) as event_at
        from app.aud_pvps p
        where p.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', coalesce(p.dt_hr_sep, p.dt_hr))::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', coalesce(p.dt_hr_sep, p.dt_hr))::date <= p_dt_fim)

        union all

        select
            'pvps_endereco'::text as activity_key,
            'PVPS'::text as activity_label,
            'endereços'::text as unit_label,
            coalesce(apu.auditor_id, p.auditor_id) as user_id,
            coalesce(apu.auditor_mat, p.auditor_mat) as mat,
            coalesce(apu.auditor_nome, p.auditor_nome) as nome,
            timezone('America/Sao_Paulo', apu.dt_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('PUL %s | SEP %s | CODDV %s', apu.end_pul, p.end_sep, p.coddv) as detail,
            apu.audit_pul_id::text as source_ref,
            apu.dt_hr as event_at
        from app.aud_pvps_pul apu
        join app.aud_pvps p
          on p.audit_id = apu.audit_id
        where p.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', apu.dt_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', apu.dt_hr)::date <= p_dt_fim)

        union all

        select
            'atividade_extra_pontos'::text as activity_key,
            'Atividade Extra'::text as activity_label,
            'pontos'::text as unit_label,
            a.user_id,
            a.mat,
            a.nome,
            a.data_inicio as event_date,
            round(coalesce(a.pontos, 0), 3)::numeric(18,3) as metric_value,
            left(coalesce(a.descricao, ''), 160) as detail,
            a.id::text as source_ref,
            a.created_at as event_at
        from app.atividade_extra a
        where a.cd = p_cd
          and coalesce(a.approval_status, 'approved') = 'approved'
          and (p_dt_ini is null or a.data_inicio >= p_dt_ini)
          and (p_dt_fim is null or a.data_inicio <= p_dt_fim)

        union all

        select
            'alocacao_endereco'::text as activity_key,
            'Alocação'::text as activity_label,
            'endereços'::text as unit_label,
            a.auditor_id as user_id,
            a.auditor_mat as mat,
            a.auditor_nome as nome,
            timezone('America/Sao_Paulo', a.dt_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('Endereço %s | CODDV %s', a.endereco, a.coddv) as detail,
            a.audit_id::text as source_ref,
            a.dt_hr as event_at
        from app.aud_alocacao a
        where a.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', a.dt_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', a.dt_hr)::date <= p_dt_fim)

        union all

        select
            'entrada_notas_sku'::text as activity_key,
            'Entrada de Notas'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('CODDV %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_entrada_notas_itens i
        join app.conf_entrada_notas c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'termo_sku'::text as activity_key,
            'Conferência de Termo'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('CODDV %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_termo_itens i
        join app.conf_termo c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'avulso_sku'::text as activity_key,
            'Conferência Volume Avulso'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('CODDV %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_volume_avulso_itens i
        join app.conf_volume_avulso c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'pedido_direto_sku'::text as activity_key,
            'Conferência Pedido Direto'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('CODDV %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_pedido_direto_itens i
        join app.conf_pedido_direto c
          on c.conf_id = i.conf_id
        where c.cd = p_cd
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'transferencia_cd_sku'::text as activity_key,
            'Transferência CD'::text as activity_label,
            'sku'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            timezone('America/Sao_Paulo', i.updated_at)::date as event_date,
            1::numeric(18,3) as metric_value,
            format(
                'CODDV %s | Qtd %s | %s',
                i.coddv,
                i.qtd_conferida,
                case when c.etapa = 'saida' then 'Saída' else 'Entrada' end
            ) as detail,
            i.item_id::text as source_ref,
            i.updated_at as event_at
        from app.conf_transferencia_cd_itens i
        join app.conf_transferencia_cd c
          on c.conf_id = i.conf_id
        where (
                (c.etapa = 'saida' and c.cd_ori = p_cd)
             or (c.etapa = 'entrada' and c.cd_des = p_cd)
        )
          and i.qtd_conferida > 0
          and (p_dt_ini is null or timezone('America/Sao_Paulo', i.updated_at)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', i.updated_at)::date <= p_dt_fim)

        union all

        select
            'zerados_endereco'::text as activity_key,
            'Inventário (Zerados)'::text as activity_label,
            'endereços'::text as unit_label,
            z.user_id,
            z.mat,
            z.nome,
            z.event_date,
            z.total_itens::numeric(18,3) as metric_value,
            format('Zona %s | Endereço %s | Etapa %s | Itens %s', z.zona, z.endereco, z.etapa, z.total_itens) as detail,
            z.source_ref,
            z.event_at
        from inventario_enderecos z
        where (p_dt_ini is null or z.event_date >= p_dt_ini)
          and (p_dt_fim is null or z.event_date <= p_dt_fim)

        union all

        select
            'devolucao_nfd'::text as activity_key,
            'Devolução de Mercadoria'::text as activity_label,
            'devolução'::text as unit_label,
            c.started_by as user_id,
            c.started_mat as mat,
            c.started_nome as nome,
            coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) as event_date,
            1::numeric(18,3) as metric_value,
            case
                when c.conference_kind = 'sem_nfd' then
                    concat_ws(
                        ' | ',
                        'Sem NFD',
                        case
                            when nullif(trim(coalesce(c.nfo, '')), '') is not null
                                then format('NFO %s', nullif(trim(coalesce(c.nfo, '')), ''))
                            else null
                        end,
                        case
                            when nullif(trim(coalesce(c.motivo_sem_nfd, '')), '') is not null
                                then format('Motivo %s', nullif(trim(coalesce(c.motivo_sem_nfd, '')), ''))
                            else null
                        end,
                        format('Ref %s', left(c.conf_id::text, 8))
                    )
                else
                    coalesce(
                        format('NFD %s', c.nfd::text),
                        format('Chave %s', nullif(trim(coalesce(c.chave, '')), '')),
                        format('Ref %s', left(c.conf_id::text, 8))
                    )
            end as detail,
            c.conf_id::text as source_ref,
            coalesce(c.finalized_at, c.updated_at) as event_at
        from app.conf_devolucao c
        where c.cd = p_cd
          and c.status in ('finalizado_ok', 'finalizado_falta')
          and (
              p_dt_ini is null
              or coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) >= p_dt_ini
          )
          and (
              p_dt_fim is null
              or coalesce(timezone('America/Sao_Paulo', c.finalized_at)::date, c.conf_date) <= p_dt_fim
          )

        union all

        select
            'prod_vol_mes'::text as activity_key,
            'Produtividade Volume (base externa)'::text as activity_label,
            'volume'::text as unit_label,
            pr.user_id,
            pr.mat,
            pr.nome,
            v.event_date,
            v.vol_conf::numeric(18,3) as metric_value,
            format(
                'Pedido %s | Filial %s | Rota %s | Placa %s',
                coalesce(nullif(trim(v.seq_ped), ''), '-'),
                coalesce(v.filial::text, '-'),
                coalesce(v.rota::text, '-'),
                coalesce(nullif(trim(v.placa), ''), '-')
            ) as detail,
            format(
                'prod_vol:%s:%s:%s',
                coalesce(nullif(trim(v.seq_ped), ''), '-'),
                coalesce(v.filial::text, '-'),
                to_char(timezone('America/Sao_Paulo', v.event_at), 'YYYYMMDDHH24MISS')
            ) as source_ref,
            v.event_at
        from prod_vol_src v
        join lateral (
            select
                p.user_id,
                p.mat,
                p.nome
            from profiles_cd p
            where (
                v.aud_digits <> ''
                and p.mat_norm = v.aud_digits
            ) or (
                v.aud_norm <> ''
                and p.nome_norm = v.aud_norm
            )
            order by
                case when v.aud_digits <> '' and p.mat_norm = v.aud_digits then 0 else 1 end,
                p.user_id
            limit 1
        ) pr on true
        where (p_dt_ini is null or v.event_date >= p_dt_ini)
          and (p_dt_fim is null or v.event_date <= p_dt_fim)

        union all

        select
            'prod_blitz_un'::text as activity_key,
            'Produtividade Blitz (base externa)'::text as activity_label,
            'unidades'::text as unit_label,
            pr.user_id,
            pr.mat,
            pr.nome,
            b.event_date,
            b.qtd_un::numeric(18,3) as metric_value,
            format('Filial %s | Pedido %s', b.filial::text, b.nr_pedido::text) as detail,
            format('prod_blitz:%s:%s', b.filial::text, b.nr_pedido::text) as source_ref,
            b.event_at
        from prod_blitz_src b
        join lateral (
            select
                p.user_id,
                p.mat,
                p.nome
            from profiles_cd p
            where (
                b.aud_digits <> ''
                and p.mat_norm = b.aud_digits
            ) or (
                b.aud_norm <> ''
                and p.nome_norm = b.aud_norm
            )
            order by
                case when b.aud_digits <> '' and p.mat_norm = b.aud_digits then 0 else 1 end,
                p.user_id
            limit 1
        ) pr on true
        where (p_dt_ini is null or b.event_date >= p_dt_ini)
          and (p_dt_fim is null or b.event_date <= p_dt_fim)
    ) e;
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
        select * from (
            values
                (1, 'coleta_sku', 'Coleta de Mercadoria', 'sku'),
                (2, 'pvps_endereco', 'PVPS', 'endereços'),
                (3, 'atividade_extra_pontos', 'Atividade Extra', 'pontos'),
                (4, 'alocacao_endereco', 'Alocação', 'endereços'),
                (5, 'entrada_notas_sku', 'Entrada de Notas', 'sku'),
                (6, 'termo_sku', 'Conferência de Termo', 'sku'),
                (7, 'avulso_sku', 'Conferência Volume Avulso', 'sku'),
                (8, 'pedido_direto_sku', 'Conferência Pedido Direto', 'sku'),
                (9, 'transferencia_cd_sku', 'Transferência CD', 'sku'),
                (10, 'zerados_endereco', 'Inventário (Zerados)', 'endereços'),
                (11, 'devolucao_nfd', 'Devolução de Mercadoria', 'nfd'),
                (12, 'prod_blitz_un', 'Produtividade Blitz', 'unidades'),
                (13, 'prod_vol_mes', 'Volume Expedido', 'volume'),
                (14, 'registro_embarque_loja', 'Registro de Embarque', 'lojas'),
                (15, 'auditoria_caixa_volume', 'Auditoria de Caixa', 'volumes')
        ) as t(sort_order, activity_key, activity_label, unit_label)
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

    if v_activity_key is not null and v_activity_key not in (
        'coleta_sku',
        'pvps_endereco',
        'atividade_extra_pontos',
        'alocacao_endereco',
        'entrada_notas_sku',
        'termo_sku',
        'avulso_sku',
        'pedido_direto_sku',
        'transferencia_cd_sku',
        'zerados_endereco',
        'devolucao_nfd',
        'prod_blitz_un',
        'prod_vol_mes',
        'registro_embarque_loja',
        'auditoria_caixa_volume'
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
    with basica as (
        select *
        from app.produtividade_events_base(v_cd, v_dt_ini, v_dt_fim)
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
    usuarios_unicos as (
        select distinct
            um.user_id,
            um.mat,
            um.nome
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
            round(coalesce((select um.total_val from usuarios_metricas um where um.user_id = u.user_id and um.activity_key = 'atividade_extra_pontos'), 0), 3)::numeric(18,3) as atividade_extra_pontos
        from usuarios_unicos u
    ),
    pontuacao_geral as (
        select
            c.user_id,
            c.mat,
            c.nome,
            c.pvps_pontos,
            c.pvps_qtd,
            c.vol_pontos,
            c.vol_qtd,
            c.blitz_pontos,
            c.blitz_qtd,
            c.zerados_pontos,
            c.zerados_qtd,
            c.atividade_extra_pontos,
            c.atividade_extra_qtd,
            c.alocacao_pontos,
            c.alocacao_qtd,
            c.devolucao_pontos,
            c.devolucao_qtd,
            c.conf_termo_pontos,
            c.conf_termo_qtd,
            c.conf_avulso_pontos,
            c.conf_avulso_qtd,
            c.conf_entrada_pontos,
            c.conf_entrada_qtd,
            c.conf_transferencia_cd_pontos,
            c.conf_transferencia_cd_qtd,
            c.conf_lojas_pontos,
            c.conf_lojas_qtd,
            c.aud_caixa_pontos,
            c.aud_caixa_qtd,
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
                c.aud_caixa_pontos,
                3
            )::numeric(18,3) as total_pontos
        from componentes c
    ),
    ranking_geral as (
        select
            pg.user_id,
            pg.mat,
            pg.nome,
            dense_rank() over(order by pg.total_pontos desc)::integer as posicao,
            pg.pvps_pontos,
            pg.pvps_qtd,
            pg.vol_pontos,
            pg.vol_qtd,
            pg.blitz_pontos,
            pg.blitz_qtd,
            pg.zerados_pontos,
            pg.zerados_qtd,
            pg.atividade_extra_pontos,
            pg.atividade_extra_qtd,
            pg.alocacao_pontos,
            pg.alocacao_qtd,
            pg.devolucao_pontos,
            pg.devolucao_qtd,
            pg.conf_termo_pontos,
            pg.conf_termo_qtd,
            pg.conf_avulso_pontos,
            pg.conf_avulso_qtd,
            pg.conf_entrada_pontos,
            pg.conf_entrada_qtd,
            pg.conf_transferencia_cd_pontos,
            pg.conf_transferencia_cd_qtd,
            pg.conf_lojas_pontos,
            pg.conf_lojas_qtd,
            pg.aud_caixa_pontos,
            pg.aud_caixa_qtd,
            pg.total_pontos
        from pontuacao_geral pg
    )
    select
        rg.user_id,
        rg.mat,
        rg.nome,
        rg.posicao,
        rg.pvps_pontos,
        rg.pvps_qtd,
        rg.vol_pontos,
        rg.vol_qtd,
        rg.blitz_pontos,
        rg.blitz_qtd,
        rg.zerados_pontos,
        rg.zerados_qtd,
        rg.atividade_extra_pontos,
        rg.atividade_extra_qtd,
        rg.alocacao_pontos,
        rg.alocacao_qtd,
        rg.devolucao_pontos,
        rg.devolucao_qtd,
        rg.conf_termo_pontos,
        rg.conf_termo_qtd,
        rg.conf_avulso_pontos,
        rg.conf_avulso_qtd,
        rg.conf_entrada_pontos,
        rg.conf_entrada_qtd,
        rg.conf_transferencia_cd_pontos,
        rg.conf_transferencia_cd_qtd,
        rg.conf_lojas_pontos,
        rg.conf_lojas_qtd,
        rg.aud_caixa_pontos,
        rg.aud_caixa_qtd,
        rg.total_pontos
    from ranking_geral rg
    where v_is_admin
       or v_mode = 'public_cd'
       or rg.user_id = v_uid
    order by rg.total_pontos desc, rg.nome asc;
end;
$$;


grant execute on function public.rpc_conf_transferencia_cd_get_active_conference() to authenticated;
grant execute on function public.rpc_produtividade_ranking(integer, integer, integer) to authenticated;
grant execute on function public.rpc_produtividade_activity_totals(integer, uuid, date, date) to authenticated;
grant execute on function public.rpc_produtividade_entries(integer, uuid, date, date, text, integer) to authenticated;
