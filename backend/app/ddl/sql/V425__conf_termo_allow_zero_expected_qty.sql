alter table app.conf_termo_itens
    drop constraint if exists conf_termo_itens_qtd_esperada_check;

alter table app.conf_termo_itens
    add constraint conf_termo_itens_qtd_esperada_check
    check (qtd_esperada >= 0);

create or replace function public.rpc_conf_termo_manifest_meta(p_cd integer default null)
returns table (
    cd integer,
    row_count bigint,
    etiquetas_count bigint,
    source_run_id uuid,
    manifest_hash text,
    generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = app, authz, public
as $$
declare
    v_uid uuid;
    v_cd integer;
    v_row_count bigint;
    v_etiquetas bigint;
    v_source_run_id uuid;
    v_updated_at timestamptz;
begin
    v_uid := auth.uid();
    if v_uid is null then
        raise exception 'AUTH_REQUIRED';
    end if;

    if not authz.session_is_recent(6) then
        raise exception 'SESSAO_EXPIRADA';
    end if;

    v_cd := app.conf_termo_resolve_cd(p_cd);

    select
        count(*)::bigint,
        count(distinct t.id_etiqueta)::bigint,
        max(t.updated_at)
    into
        v_row_count,
        v_etiquetas,
        v_updated_at
    from app.db_termo t
    where t.cd = v_cd
      and nullif(trim(coalesce(t.id_etiqueta, '')), '') is not null;

    if coalesce(v_row_count, 0) = 0 then
        raise exception 'BASE_TERMO_VAZIA';
    end if;

    select t.source_run_id
    into v_source_run_id
    from app.db_termo t
    where t.cd = v_cd
      and nullif(trim(coalesce(t.id_etiqueta, '')), '') is not null
      and t.source_run_id is not null
    order by t.updated_at desc nulls last
    limit 1;

    return query
    select
        v_cd,
        v_row_count,
        v_etiquetas,
        v_source_run_id,
        md5(
            concat_ws(
                ':',
                'allow_zero_expected_qty_v1',
                coalesce(v_source_run_id::text, ''),
                v_row_count::text,
                v_etiquetas::text,
                coalesce(v_updated_at::text, '')
            )
        ),
        now();
end;
$$;

create or replace function public.rpc_conf_termo_manifest_items_page(
    p_cd integer default null,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns table (
    id_etiqueta text,
    caixa text,
    pedido bigint,
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

    v_cd := app.conf_termo_resolve_cd(p_cd);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_limit := least(greatest(coalesce(p_limit, 1000), 1), 2000);

    return query
    with manifest as (
        select
            t.id_etiqueta,
            min(nullif(trim(t.caixa::text), '')) as caixa,
            min(t.pedido) as pedido,
            min(t.filial) as filial,
            coalesce(
                min(nullif(trim(r.nome), '')),
                format('FILIAL %s', min(t.filial))
            ) as filial_nome,
            coalesce(
                min(nullif(trim(r.rota), '')),
                min(nullif(trim(t.num_rota), '')),
                'SEM ROTA'
            ) as rota,
            t.coddv,
            coalesce(
                min(nullif(trim(t.descricao), '')),
                format('CODDV %s', t.coddv)
            ) as descricao,
            sum(greatest(coalesce(t.qtd_separada, 0)::integer, 0))::integer as qtd_esperada
        from app.db_termo t
        left join app.db_rotas r
          on r.cd = t.cd
         and r.filial = t.filial
        where t.cd = v_cd
          and nullif(trim(coalesce(t.id_etiqueta, '')), '') is not null
        group by t.id_etiqueta, t.coddv
    )
    select
        m.id_etiqueta,
        m.caixa,
        m.pedido,
        m.filial,
        m.filial_nome,
        m.rota,
        m.coddv,
        m.descricao,
        greatest(m.qtd_esperada, 0) as qtd_esperada
    from manifest m
    order by m.id_etiqueta, m.coddv
    offset v_offset
    limit v_limit;
end;
$$;

grant execute on function public.rpc_conf_termo_manifest_meta(integer) to authenticated;
grant execute on function public.rpc_conf_termo_manifest_items_page(integer, integer, integer) to authenticated;
