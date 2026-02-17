create or replace function public.rpc_conf_inventario_report_count(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer
)
returns bigint
language plpgsql
stable
security invoker
set search_path = app, authz, public
as $$
declare
    v_role text;
    v_count bigint;
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

    with activity as (
        select distinct
            c.cycle_date,
            c.cd,
            c.zona,
            c.endereco,
            c.coddv
        from app.conf_inventario_counts c
        where c.cd = p_cd
          and c.cycle_date >= p_dt_ini
          and c.cycle_date <= p_dt_fim
        union
        select distinct
            r.cycle_date,
            r.cd,
            r.zona,
            r.endereco,
            r.coddv
        from app.conf_inventario_reviews r
        where r.cd = p_cd
          and r.cycle_date >= p_dt_ini
          and r.cycle_date <= p_dt_fim
    )
    select count(*)
    into v_count
    from activity;

    return coalesce(v_count, 0);
end;
$$;

create or replace function public.rpc_conf_inventario_report_rows(
    p_dt_ini date,
    p_dt_fim date,
    p_cd integer,
    p_limit integer default 20000
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
    v_count bigint;
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

    v_limit := least(greatest(coalesce(p_limit, 20000), 1), 50000);

    select public.rpc_conf_inventario_report_count(p_dt_ini, p_dt_fim, p_cd)
    into v_count;

    if v_count > v_limit then
        raise exception 'RELATORIO_MUITO_GRANDE_%', v_count;
    end if;

    return query
    with activity as (
        select distinct
            c.cycle_date,
            c.cd,
            c.zona,
            c.endereco,
            c.coddv
        from app.conf_inventario_counts c
        where c.cd = p_cd
          and c.cycle_date >= p_dt_ini
          and c.cycle_date <= p_dt_fim
        union
        select distinct
            r.cycle_date,
            r.cd,
            r.zona,
            r.endereco,
            r.coddv
        from app.conf_inventario_reviews r
        where r.cd = p_cd
          and r.cycle_date >= p_dt_ini
          and r.cycle_date <= p_dt_fim
    ),
    c1 as (
        select c.*
        from app.conf_inventario_counts c
        where c.etapa = 1
    ),
    c2 as (
        select c.*
        from app.conf_inventario_counts c
        where c.etapa = 2
    )
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
            when r.status = 'resolvido' then r.final_barras
            when c2.resultado = 'descartado' then null
            when c1.resultado = 'descartado' then null
            when c1.qtd_contada is not null and c2.qtd_contada is not null and c1.qtd_contada = c2.qtd_contada then c2.barras
            when c1.qtd_contada is not null and c1.resultado <> 'sobra' and r.review_id is null then c1.barras
            else null
        end as barras_final,
        case
            when r.status = 'resolvido' then r.final_resultado
            when c2.resultado = 'descartado' then 'descartado'
            when c1.resultado = 'descartado' then 'descartado'
            when c1.qtd_contada is not null and c2.qtd_contada is not null and c1.qtd_contada = c2.qtd_contada then c2.resultado
            when c1.qtd_contada is not null and c1.resultado <> 'sobra' and r.review_id is null then c1.resultado
            else null
        end as divergencia_final,
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
    from activity a
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
    left join app.conf_inventario_reviews r
      on r.cycle_date = a.cycle_date
     and r.cd = a.cd
     and r.endereco = a.endereco
     and r.coddv = a.coddv
    order by a.cycle_date desc, a.zona, a.endereco, a.coddv
    limit v_limit;
end;
$$;

grant execute on function public.rpc_conf_inventario_report_count(date, date, integer) to authenticated;
grant execute on function public.rpc_conf_inventario_report_rows(date, date, integer, integer) to authenticated;
