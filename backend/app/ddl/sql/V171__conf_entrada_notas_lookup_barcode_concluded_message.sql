drop function if exists public.rpc_conf_entrada_notas_lookup_seq_nf_by_barcode(text, integer);
create or replace function public.rpc_conf_entrada_notas_lookup_seq_nf_by_barcode(
    p_barras text,
    p_cd integer default null
)
returns table (
    coddv integer,
    descricao text,
    barras text,
    seq_entrada bigint,
    nf bigint,
    transportadora text,
    fornecedor text,
    qtd_esperada integer,
    qtd_conferida integer,
    qtd_pendente integer
)
language plpgsql
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_today date;
    v_barras text;
    v_coddv integer;
    v_descricao text;
    v_concluded_message text;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_entrada_notas_resolve_cd(p_cd);
    v_today := (timezone('America/Sao_Paulo', now()))::date;
    v_barras := regexp_replace(coalesce(p_barras, ''), '\s+', '', 'g');

    if v_barras = '' then
        raise exception 'BARRAS_OBRIGATORIA';
    end if;

    select
        b.coddv,
        coalesce(nullif(trim(b.descricao), ''), format('CODDV %s', b.coddv))
    into
        v_coddv,
        v_descricao
    from app.db_barras b
    where b.barras = v_barras
    order by b.updated_at desc nulls last, b.coddv
    limit 1;

    if v_coddv is null then
        raise exception 'BARRAS_NAO_ENCONTRADA';
    end if;

    if not exists (
        select 1
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.coddv = v_coddv
          and t.seq_entrada is not null
          and t.nf is not null
    ) then
        raise exception 'PRODUTO_NAO_PERTENCE_A_NENHUM_RECEBIMENTO';
    end if;

    return query
    with base as (
        select
            t.seq_entrada::bigint as seq_entrada,
            t.nf::bigint as nf,
            coalesce(min(nullif(trim(t.transportadora), '')), 'SEM TRANSPORTADORA') as transportadora,
            coalesce(min(nullif(trim(t.forn), '')), 'SEM FORNECEDOR') as fornecedor,
            greatest(sum(greatest(coalesce(t.qtd_total, 0)::integer, 0))::integer, 1) as qtd_esperada
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.coddv = v_coddv
          and t.seq_entrada is not null
          and t.nf is not null
        group by t.seq_entrada, t.nf
    ),
    conf_today as (
        select
            c.conf_id,
            c.seq_entrada,
            c.nf,
            c.status,
            c.started_by
        from app.conf_entrada_notas c
        where c.cd = v_cd
          and c.conf_date = v_today
    ),
    merged as (
        select
            b.seq_entrada,
            b.nf,
            b.transportadora,
            b.fornecedor,
            b.qtd_esperada,
            c.conf_id,
            c.status,
            c.started_by,
            coalesce(i.qtd_conferida, 0)::integer as qtd_conferida
        from base b
        left join conf_today c
          on c.seq_entrada = b.seq_entrada
         and c.nf = b.nf
        left join app.conf_entrada_notas_itens i
          on i.conf_id = c.conf_id
         and i.coddv = v_coddv
    ),
    with_pending as (
        select
            m.*,
            greatest(m.qtd_esperada - m.qtd_conferida, 0)::integer as qtd_pendente,
            case
                when m.conf_id is null then true
                when m.status = 'em_conferencia' and m.started_by = v_uid then true
                when m.status in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_parcial', 'finalizado_falta')
                     and greatest(m.qtd_esperada - m.qtd_conferida, 0) > 0 then true
                else false
            end as is_editable
        from merged m
    )
    select
        v_coddv as coddv,
        v_descricao as descricao,
        v_barras as barras,
        w.seq_entrada,
        w.nf,
        w.transportadora,
        w.fornecedor,
        w.qtd_esperada,
        w.qtd_conferida,
        w.qtd_pendente
    from with_pending w
    where w.is_editable
      and w.qtd_pendente > 0
    order by w.seq_entrada, w.nf;

    if found then
        return;
    end if;

    with base as (
        select
            t.seq_entrada::bigint as seq_entrada,
            t.nf::bigint as nf,
            greatest(sum(greatest(coalesce(t.qtd_total, 0)::integer, 0))::integer, 1) as qtd_esperada
        from app.db_entrada_notas t
        where t.cd = v_cd
          and t.coddv = v_coddv
          and t.seq_entrada is not null
          and t.nf is not null
        group by t.seq_entrada, t.nf
    ),
    conf_today as (
        select
            c.conf_id,
            c.seq_entrada,
            c.nf,
            c.status,
            c.started_nome,
            c.started_mat,
            coalesce(c.finalized_at, c.updated_at) as status_at
        from app.conf_entrada_notas c
        where c.cd = v_cd
          and c.conf_date = v_today
    ),
    merged as (
        select
            b.seq_entrada,
            b.nf,
            b.qtd_esperada,
            c.conf_id,
            c.status,
            c.started_nome,
            c.started_mat,
            c.status_at,
            coalesce(i.qtd_conferida, 0)::integer as qtd_conferida
        from base b
        left join conf_today c
          on c.seq_entrada = b.seq_entrada
         and c.nf = b.nf
        left join app.conf_entrada_notas_itens i
          on i.conf_id = c.conf_id
         and i.coddv = v_coddv
    ),
    concluded as (
        select
            m.seq_entrada,
            m.nf,
            coalesce(nullif(trim(m.started_nome), ''), nullif(trim(m.started_mat), ''), 'usuario nao identificado') as actor,
            m.status_at,
            row_number() over (order by m.seq_entrada, m.nf) as rn
        from merged m
        where m.conf_id is not null
          and m.status in ('finalizado_ok', 'finalizado_divergencia', 'finalizado_parcial', 'finalizado_falta')
          and greatest(m.qtd_esperada - m.qtd_conferida, 0)::integer = 0
    ),
    totals as (
        select count(*)::integer as total_rows from concluded
    )
    select
        format(
            'PRODUTO_JA_CONFERIDO|Produto ja conferido neste CD. %s%s.',
            string_agg(
                format(
                    'Seq/NF %s/%s conferida por %s em %s',
                    c.seq_entrada,
                    c.nf,
                    c.actor,
                    to_char(c.status_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS')
                ),
                '. '
                order by c.seq_entrada, c.nf
            ),
            case
                when t.total_rows > 3 then format('. mais %s Seq/NF concluidas', t.total_rows - 3)
                else ''
            end
        )
    into v_concluded_message
    from concluded c
    cross join totals t
    where c.rn <= 3;

    if v_concluded_message is not null then
        raise exception '%', v_concluded_message;
    end if;

    raise exception 'SEM_SEQ_NF_DISPONIVEL';
end;
$$;

grant execute on function public.rpc_conf_entrada_notas_lookup_seq_nf_by_barcode(text, integer) to authenticated;
