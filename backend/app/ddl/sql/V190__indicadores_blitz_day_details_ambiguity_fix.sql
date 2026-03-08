create or replace function public.rpc_indicadores_blitz_day_details(
    p_cd integer default null,
    p_month_start date default null,
    p_day date default null
)
returns table (
    data_conf date,
    filial integer,
    filial_nome text,
    pedido bigint,
    seq integer,
    coddv integer,
    descricao text,
    zona text,
    status text,
    quantidade integer,
    vl_div numeric
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_cd integer;
    v_day date;
begin
    v_cd := app.indicadores_resolve_cd(p_cd);
    v_day := coalesce(p_day, timezone('America/Sao_Paulo', now())::date);

    return query
    with base_rows as (
        select *
        from app.indicadores_blitz_month_rows(v_cd, p_month_start) src
        where src.data_conf = v_day
    )
    select
        br.data_conf,
        br.filial,
        br.filial_nome,
        br.pedido,
        br.seq,
        br.coddv,
        br.descricao,
        br.zona,
        detail.status,
        detail.quantidade,
        br.vl_div
    from base_rows br
    cross join lateral (
        values
            ('Falta'::text, br.falta_qty),
            ('Sobra'::text, br.sobra_qty),
            ('Fora da Política'::text, br.fora_politica_qty)
    ) as detail(status, quantidade)
    where detail.quantidade > 0
    order by
        br.data_conf desc,
        br.zona asc,
        br.filial asc,
        detail.status asc,
        br.descricao asc,
        br.pedido asc,
        br.coddv asc;
end;
$$;

grant execute on function public.rpc_indicadores_blitz_day_details(integer, date, date) to authenticated;
