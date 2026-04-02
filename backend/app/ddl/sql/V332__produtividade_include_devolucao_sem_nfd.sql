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
            format('Coddv %s | %s', c.coddv, left(coalesce(c.descricao, ''), 110)) as detail,
            c.id::text as source_ref,
            c.data_hr as event_at
        from app.aud_coleta c
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
            timezone('America/Sao_Paulo', p.dt_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('SEP %s | Coddv %s', p.end_sep, p.coddv) as detail,
            p.audit_id::text as source_ref,
            p.dt_hr as event_at
        from app.aud_pvps p
        where p.cd = p_cd
          and (p_dt_ini is null or timezone('America/Sao_Paulo', p.dt_hr)::date >= p_dt_ini)
          and (p_dt_fim is null or timezone('America/Sao_Paulo', p.dt_hr)::date <= p_dt_fim)

        union all

        select
            'pvps_endereco'::text as activity_key,
            'PVPS'::text as activity_label,
            'endereços'::text as unit_label,
            p.auditor_id as user_id,
            p.auditor_mat as mat,
            p.auditor_nome as nome,
            timezone('America/Sao_Paulo', apu.dt_hr)::date as event_date,
            1::numeric(18,3) as metric_value,
            format('PUL %s | SEP %s | Coddv %s', apu.end_pul, p.end_sep, p.coddv) as detail,
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
            format('Endereço %s | Coddv %s', a.endereco, a.coddv) as detail,
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
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
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
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
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
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
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
            format('Coddv %s | Qtd %s', i.coddv, i.qtd_conferida) as detail,
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
