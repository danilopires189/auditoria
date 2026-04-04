create or replace function app.lookup_produto_payload(
    p_cd integer,
    p_barras text default null,
    p_coddv integer default null
)
returns table (
    cd integer,
    coddv integer,
    descricao text,
    barras text,
    barras_lista jsonb,
    qtd_est_disp integer,
    qtd_est_atual integer,
    estoque_updated_at timestamptz,
    dat_ult_compra date,
    enderecos_sep jsonb,
    enderecos_pul jsonb,
    enderecos_excluidos jsonb,
    custo_unitario numeric,
    endereco_sep_text text,
    endereco_pul_text text
)
language plpgsql
stable
security definer
set search_path = app, public
as $$
declare
    v_barras text;
    v_coddv integer;
begin
    v_barras := regexp_replace(coalesce(p_barras, ''), '\s+', '', 'g');
    v_coddv := coalesce(p_coddv, 0);

    if v_barras = '' and v_coddv <= 0 then
        raise exception 'PARAMS_BUSCA_OBRIGATORIOS';
    end if;

    if p_coddv is not null and p_coddv <= 0 then
        raise exception 'CODDV_INVALIDO';
    end if;

    if v_barras <> '' then
        select b.coddv
          into v_coddv
          from app.db_barras b
         where b.barras = v_barras
         order by b.updated_at desc nulls last, b.coddv
         limit 1;
    end if;

    if coalesce(v_coddv, 0) <= 0 then
        raise exception 'PRODUTO_NAO_ENCONTRADO';
    end if;

    if not exists (
        select 1
        from app.db_barras b
        where b.coddv = v_coddv
          and nullif(trim(coalesce(b.barras, '')), '') is not null
    ) then
        raise exception 'PRODUTO_NAO_ENCONTRADO';
    end if;

    return query
    with produto_ranked as (
        select
            b.coddv,
            coalesce(nullif(trim(coalesce(b.descricao, '')), ''), format('CODDV %s', b.coddv)) as descricao,
            b.barras,
            b.updated_at,
            case when v_barras <> '' and b.barras = v_barras then 0 else 1 end as priority,
            row_number() over (
                order by
                    case when v_barras <> '' and b.barras = v_barras then 0 else 1 end,
                    b.updated_at desc nulls last,
                    b.barras
            ) as rn
        from app.db_barras b
        where b.coddv = v_coddv
          and nullif(trim(coalesce(b.barras, '')), '') is not null
    ),
    produto as (
        select p.coddv, p.descricao, p.barras
        from produto_ranked p
        where p.rn = 1
    ),
    barras_all as (
        select jsonb_agg(to_jsonb(t.barras) order by t.priority, t.updated_at desc nulls last, t.barras) as rows
        from (
            select
                b.barras,
                max(b.updated_at) as updated_at,
                min(case when v_barras <> '' and b.barras = v_barras then 0 else 1 end) as priority
            from app.db_barras b
            where b.coddv = v_coddv
              and nullif(trim(coalesce(b.barras, '')), '') is not null
            group by b.barras
        ) t
    ),
    estq as (
        select
            e.cd,
            e.coddv,
            greatest(coalesce(e.qtd_est_disp, 0), 0)::integer as qtd_est_disp,
            greatest(coalesce(e.qtd_est_atual, 0), 0)::integer as qtd_est_atual,
            e.updated_at as estoque_updated_at,
            e.dat_ult_compra
        from app.db_estq_entr e
        where e.cd = p_cd
          and e.coddv = v_coddv
        order by e.updated_at desc nulls last
        limit 1
    ),
    sep_distinct as (
        select distinct upper(trim(d.endereco)) as endereco
        from app.db_end d
        where d.cd = p_cd
          and d.coddv = v_coddv
          and upper(trim(coalesce(d.tipo, ''))) = 'SEP'
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
    ),
    sep as (
        select
            jsonb_agg(jsonb_build_object('endereco', s.endereco) order by s.endereco) as rows,
            string_agg(s.endereco, ' | ' order by s.endereco) as text_rows
        from sep_distinct s
    ),
    pul_distinct as (
        select distinct
            upper(trim(d.endereco)) as endereco,
            nullif(trim(coalesce(d.andar, '')), '') as andar,
            nullif(trim(coalesce(d.validade, '')), '') as validade
        from app.db_end d
        where d.cd = p_cd
          and d.coddv = v_coddv
          and upper(trim(coalesce(d.tipo, ''))) = 'PUL'
          and nullif(trim(coalesce(d.endereco, '')), '') is not null
    ),
    pul as (
        select
            jsonb_agg(
                jsonb_build_object('endereco', p.endereco, 'andar', p.andar, 'validade', p.validade)
                order by p.endereco
            ) as rows,
            string_agg(p.endereco, ' | ' order by p.endereco) as text_rows
        from pul_distinct p
    ),
    excluidos as (
        select
            jsonb_agg(
                jsonb_build_object('endereco', upper(trim(l.endereco)), 'exclusao', l.exclusao)
                order by l.exclusao desc nulls last, upper(trim(l.endereco))
            ) as rows
        from app.db_log_end l
        where l.cd = p_cd
          and l.coddv = v_coddv
          and nullif(trim(coalesce(l.endereco, '')), '') is not null
    ),
    custo as (
        select c.custo
        from app.db_custo c
        where c.coddv = v_coddv
        order by c.updated_at desc nulls last
        limit 1
    )
    select
        p_cd as cd,
        p.coddv,
        p.descricao,
        coalesce(p.barras, '') as barras,
        coalesce(ba.rows, '[]'::jsonb) as barras_lista,
        coalesce(e.qtd_est_disp, 0)::integer as qtd_est_disp,
        coalesce(e.qtd_est_atual, 0)::integer as qtd_est_atual,
        e.estoque_updated_at,
        e.dat_ult_compra,
        coalesce(s.rows, '[]'::jsonb) as enderecos_sep,
        coalesce(pl.rows, '[]'::jsonb) as enderecos_pul,
        coalesce(x.rows, '[]'::jsonb) as enderecos_excluidos,
        c.custo as custo_unitario,
        s.text_rows as endereco_sep_text,
        pl.text_rows as endereco_pul_text
    from produto p
    left join barras_all ba on true
    left join estq e on true
    left join sep s on true
    left join pul pl on true
    left join excluidos x on true
    left join custo c on true;
end;
$$;
