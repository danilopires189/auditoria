create index if not exists idx_conf_inventario_counts_report_page
    on app.conf_inventario_counts(cd, cycle_date desc, zona, endereco, coddv, etapa);

create index if not exists idx_conf_inventario_reviews_report_page
    on app.conf_inventario_reviews(cd, cycle_date desc, zona, endereco, coddv);

create or replace function public.rpc_conf_inventario_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_offset integer default 0,
    p_limit integer default 5000
)
returns table (
    cycle_date date,
    cd integer,
    zona text,
    endereco text,
    coddv integer,
    descricao text,
    estoque integer,
    qtd_primeira integer,
    barras_primeira text,
    resultado_primeira text,
    primeira_mat text,
    primeira_nome text,
    primeira_at timestamptz,
    qtd_segunda integer,
    barras_segunda text,
    resultado_segunda text,
    segunda_mat text,
    segunda_nome text,
    segunda_at timestamptz,
    review_reason text,
    review_status text,
    review_final_qtd integer,
    review_final_barras text,
    review_final_resultado text,
    review_resolved_mat text,
    review_resolved_nome text,
    review_resolved_at timestamptz,
    contado_final integer,
    barras_final text,
    divergencia_final text,
    valor_divergencia integer,
    origem_final text,
    status_final text
)
language plpgsql
stable
security invoker
set search_path = app, authz, public
as $$
declare
    v_role text;
    v_limit integer;
    v_offset integer;
begin
    if auth.uid() is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    v_role := authz.user_role(auth.uid());
    if v_role <> 'admin' then
        raise exception 'APENAS_ADMIN';
    end if;

    if p_dt_ini is null or p_dt_fim is null then
        raise exception 'PERIODO_OBRIGATORIO';
    end if;

    if p_dt_fim < p_dt_ini then
        raise exception 'PERIODO_INVALIDO';
    end if;

    if p_dt_fim - p_dt_ini > 31 then
        raise exception 'JANELA_MAX_31_DIAS';
    end if;

    if p_cd is null then
        raise exception 'CD_OBRIGATORIO';
    end if;

    if not authz.can_access_cd(auth.uid(), p_cd) and not authz.is_admin(auth.uid()) then
        raise exception 'CD_SEM_ACESSO';
    end if;

    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 5000), 1), 50000);

    return query
    with counts_filtered as materialized (
        select
            c.cycle_date,
            c.cd,
            c.zona,
            c.endereco,
            c.coddv,
            c.descricao,
            c.estoque,
            c.etapa,
            c.qtd_contada,
            c.barras,
            c.resultado,
            c.counted_mat,
            c.counted_nome,
            c.updated_at,
            c.count_id
        from app.conf_inventario_counts c
        where c.cd = p_cd
          and c.cycle_date >= p_dt_ini
          and c.cycle_date <= p_dt_fim
    ),
    reviews_filtered as materialized (
        select
            r.cycle_date,
            r.cd,
            r.zona,
            r.endereco,
            r.coddv,
            r.review_id,
            r.reason_code,
            r.status,
            r.final_qtd,
            r.final_barras,
            r.final_resultado,
            r.resolved_mat,
            r.resolved_nome,
            r.resolved_at
        from app.conf_inventario_reviews r
        where r.cd = p_cd
          and r.cycle_date >= p_dt_ini
          and r.cycle_date <= p_dt_fim
    ),
    activity as materialized (
        select
            cf.cycle_date,
            cf.cd,
            cf.zona,
            cf.endereco,
            cf.coddv
        from counts_filtered cf
        union
        select
            rf.cycle_date,
            rf.cd,
            rf.zona,
            rf.endereco,
            rf.coddv
        from reviews_filtered rf
    ),
    activity_page as materialized (
        select
            a.cycle_date,
            a.cd,
            a.zona,
            a.endereco,
            a.coddv
        from activity a
        order by a.cycle_date desc, a.zona, a.endereco, a.coddv
        offset v_offset
        limit v_limit
    ),
    group_keys as materialized (
        select distinct
            ap.cycle_date,
            ap.cd,
            ap.coddv
        from activity_page ap
    ),
    group_activity as materialized (
        select
            a.cycle_date,
            a.cd,
            a.zona,
            a.endereco,
            a.coddv
        from activity a
        join group_keys g
          on g.cycle_date = a.cycle_date
         and g.cd = a.cd
         and g.coddv = a.coddv
    ),
    c1 as materialized (
        select c.*
        from counts_filtered c
        join group_keys g
          on g.cycle_date = c.cycle_date
         and g.cd = c.cd
         and g.coddv = c.coddv
        where c.etapa = 1
    ),
    c2 as materialized (
        select c.*
        from counts_filtered c
        join group_keys g
          on g.cycle_date = c.cycle_date
         and g.cd = c.cd
         and g.coddv = c.coddv
        where c.etapa = 2
    ),
    reviews_group as materialized (
        select r.*
        from reviews_filtered r
        join group_keys g
          on g.cycle_date = r.cycle_date
         and g.cd = r.cd
         and g.coddv = r.coddv
    ),
    base_rows_all as materialized (
        select
            a.cycle_date,
            a.cd,
            a.zona,
            a.endereco,
            a.coddv,
            coalesce(
                nullif(trim(coalesce(b.descricao, '')), ''),
                nullif(trim(coalesce(c2.descricao, '')), ''),
                nullif(trim(coalesce(c1.descricao, '')), ''),
                format('CODDV %s', a.coddv)
            ) as descricao,
            greatest(coalesce(b.estoque, c2.estoque, c1.estoque, 0), 0) as estoque,
            c1.qtd_contada as qtd_primeira,
            c1.barras as barras_primeira,
            c1.resultado as resultado_primeira,
            c1.counted_mat as primeira_mat,
            c1.counted_nome as primeira_nome,
            c1.updated_at as primeira_at,
            c2.qtd_contada as qtd_segunda,
            c2.barras as barras_segunda,
            c2.resultado as resultado_segunda,
            c2.counted_mat as segunda_mat,
            c2.counted_nome as segunda_nome,
            c2.updated_at as segunda_at,
            r.reason_code as review_reason,
            r.status as review_status,
            r.final_qtd as review_final_qtd,
            r.final_barras as review_final_barras,
            r.final_resultado as review_final_resultado,
            r.resolved_mat as review_resolved_mat,
            r.resolved_nome as review_resolved_nome,
            r.resolved_at as review_resolved_at,
            case
                when r.status = 'resolvido' then r.final_qtd
                when c2.resultado = 'descartado' then 0
                when c1.resultado = 'descartado' then 0
                when c1.qtd_contada is not null and c2.qtd_contada is not null and c1.qtd_contada = c2.qtd_contada then c2.qtd_contada
                when c1.qtd_contada is not null and c1.resultado <> 'sobra' and r.review_id is null then c1.qtd_contada
                else null
            end as contado_final,
            case
                when r.status = 'resolvido' then 'revisao'
                when c2.resultado = 'descartado' then 'segunda_descartado'
                when c1.resultado = 'descartado' then 'primeira_descartado'
                when c1.qtd_contada is not null and c2.qtd_contada is not null and c1.qtd_contada = c2.qtd_contada then 'consenso_2a'
                when c1.qtd_contada is not null and c1.resultado <> 'sobra' and r.review_id is null then 'primeira'
                else 'pendente'
            end as origem_final,
            case
                when r.status = 'resolvido' then 'concluido'
                when c2.resultado = 'descartado' or c1.resultado = 'descartado' then 'concluido'
                when c1.qtd_contada is not null and c2.qtd_contada is not null and c1.qtd_contada = c2.qtd_contada then 'concluido'
                when c1.qtd_contada is not null and c1.resultado <> 'sobra' and r.review_id is null then 'concluido'
                when r.status = 'pendente' then 'pendente_revisao'
                when c1.resultado = 'sobra' and c2.count_id is null then 'pendente_segunda'
                else 'pendente_primeira'
            end as status_final
        from group_activity a
        left join app.db_inventario b
          on b.cd = a.cd
         and upper(b.endereco) = a.endereco
         and b.coddv = a.coddv
        left join c1
          on c1.cycle_date = a.cycle_date
         and c1.cd = a.cd
         and c1.endereco = a.endereco
         and c1.coddv = a.coddv
        left join c2
          on c2.cycle_date = a.cycle_date
         and c2.cd = a.cd
         and c2.endereco = a.endereco
         and c2.coddv = a.coddv
        left join reviews_group r
          on r.cycle_date = a.cycle_date
         and r.cd = a.cd
         and r.endereco = a.endereco
         and r.coddv = a.coddv
    ),
    grouped as materialized (
        select
            br.cycle_date,
            br.cd,
            br.coddv,
            sum(br.estoque)::integer as estoque_total_coddv,
            sum(coalesce(br.contado_final, 0))::integer as qtd_final_total_coddv,
            count(*)::integer as total_linhas,
            count(*) filter (where br.contado_final is not null)::integer as linhas_concluidas,
            coalesce(
                (array_agg(nullif(trim(br.review_final_barras), '') order by br.review_resolved_at desc nulls last, br.endereco, br.zona)
                    filter (where nullif(trim(br.review_final_barras), '') is not null))[1],
                (array_agg(nullif(trim(br.barras_segunda), '') order by br.segunda_at desc nulls last, br.endereco, br.zona)
                    filter (where nullif(trim(br.barras_segunda), '') is not null))[1],
                (array_agg(nullif(trim(br.barras_primeira), '') order by br.primeira_at desc nulls last, br.endereco, br.zona)
                    filter (where nullif(trim(br.barras_primeira), '') is not null))[1]
            ) as barras_final_coddv
        from base_rows_all br
        group by
            br.cycle_date,
            br.cd,
            br.coddv
    ),
    base_rows_page as (
        select br.*
        from base_rows_all br
        join activity_page ap
          on ap.cycle_date = br.cycle_date
         and ap.cd = br.cd
         and ap.zona = br.zona
         and ap.endereco = br.endereco
         and ap.coddv = br.coddv
    )
    select
        br.cycle_date,
        br.cd,
        br.zona,
        br.endereco,
        br.coddv,
        br.descricao,
        br.estoque,
        br.qtd_primeira,
        br.barras_primeira,
        br.resultado_primeira,
        br.primeira_mat,
        br.primeira_nome,
        br.primeira_at,
        br.qtd_segunda,
        br.barras_segunda,
        br.resultado_segunda,
        br.segunda_mat,
        br.segunda_nome,
        br.segunda_at,
        br.review_reason,
        br.review_status,
        br.review_final_qtd,
        br.review_final_barras,
        br.review_final_resultado,
        br.review_resolved_mat,
        br.review_resolved_nome,
        br.review_resolved_at,
        br.contado_final,
        g.barras_final_coddv as barras_final,
        case
            when g.linhas_concluidas < g.total_linhas then null
            when (g.estoque_total_coddv - g.qtd_final_total_coddv) = 0 then 'correto'
            when (g.estoque_total_coddv - g.qtd_final_total_coddv) > 0 then 'falta'
            else 'sobra'
        end as divergencia_final,
        case
            when g.linhas_concluidas < g.total_linhas then null
            else (g.estoque_total_coddv - g.qtd_final_total_coddv)
        end as valor_divergencia,
        br.origem_final,
        br.status_final
    from base_rows_page br
    join grouped g
      on g.cycle_date = br.cycle_date
     and g.cd = br.cd
     and g.coddv = br.coddv
    order by br.cycle_date desc, br.zona, br.endereco, br.coddv;
end;
$$;

grant execute on function public.rpc_conf_inventario_report_rows(date, date, integer, integer, integer) to authenticated;
