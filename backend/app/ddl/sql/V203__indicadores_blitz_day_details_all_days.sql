drop function if exists public.rpc_indicadores_blitz_day_details(integer, date, date);

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
    endereco text,
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
begin
    v_cd := app.indicadores_resolve_cd(p_cd);

    return query
    with base_rows as (
        select
            src.data_conf,
            src.filial,
            src.filial_nome,
            src.pedido,
            src.seq,
            src.coddv,
            src.descricao,
            src.zona,
            coalesce(nullif(trim(d.endereco), ''), src.zona) as endereco,
            src.falta_qty,
            src.sobra_qty,
            src.fora_politica_qty,
            src.vl_div
        from app.indicadores_blitz_month_rows(v_cd, p_month_start) src
        left join app.db_div_blitz d
          on d.cd = v_cd
         and d.data_conf = src.data_conf
         and d.filial = src.filial
         and d.pedido = src.pedido
         and d.seq = src.seq
         and d.coddv = src.coddv
        where p_day is null or src.data_conf = p_day
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
        br.endereco,
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
        br.zona asc,
        br.data_conf desc,
        br.filial asc,
        detail.status asc,
        br.descricao asc,
        br.pedido asc,
        br.coddv asc;
end;
$$;

grant execute on function public.rpc_indicadores_blitz_day_details(integer, date, date) to authenticated;
