drop function if exists public.rpc_conf_pedido_direto_manifest_items_page(integer, integer, integer);

create or replace function public.rpc_conf_pedido_direto_manifest_items_page(
    p_cd integer default null,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    id_vol text,
    caixa text,
    pedido bigint,
    sq bigint,
    filial bigint,
    filial_nome text,
    rota text,
    coddv integer,
    descricao text,
    qtd_esperada integer
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_offset integer;
    v_limit integer;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_pedido_direto_resolve_cd(p_cd);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 2000);

    return query
    with source as (
        select
            app.conf_pedido_direto_source_id_vol(t.pedidoseq, t.pedido, t.sq) as id_vol,
            null::text as caixa,
            t.pedido,
            t.sq,
            t.filial,
            t.coddv,
            t.descricao,
            t.qtd_fat as qtd_separada,
            null::text as num_rota
        from app.db_pedido_direto t
        where t.cd = v_cd
    ),
    manifest as (
        select
            s.id_vol,
            min(nullif(trim(s.caixa), '')) as caixa,
            min(s.pedido) as pedido,
            min(s.sq) as sq,
            min(s.filial) as filial,
            coalesce(
                min(nullif(trim(r.nome), '')),
                format('FILIAL %s', min(s.filial))
            ) as filial_nome,
            coalesce(
                min(nullif(trim(r.rota), '')),
                min(nullif(trim(s.num_rota), '')),
                'SEM ROTA'
            ) as rota,
            s.coddv,
            coalesce(
                min(nullif(trim(s.descricao), '')),
                format('CODDV %s', s.coddv)
            ) as descricao,
            sum(greatest(coalesce(s.qtd_separada, 0)::integer, 0))::integer as qtd_esperada
        from source s
        left join app.db_rotas r
          on r.cd = v_cd
         and r.filial = s.filial
        where nullif(trim(coalesce(s.id_vol, '')), '') is not null
        group by s.id_vol, s.coddv
    )
    select
        m.id_vol,
        m.caixa,
        m.pedido,
        m.sq,
        m.filial,
        m.filial_nome,
        m.rota,
        m.coddv,
        m.descricao,
        greatest(m.qtd_esperada, 1) as qtd_esperada
    from manifest m
    order by m.id_vol, m.coddv
    offset v_offset
    limit v_limit;
end;
$$;

grant execute on function public.rpc_conf_pedido_direto_manifest_items_page(integer, integer, integer) to authenticated;
