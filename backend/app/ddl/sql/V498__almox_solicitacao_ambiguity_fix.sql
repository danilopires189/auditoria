create or replace function public.rpc_almox_solicitacao_criar(
    p_tipo text,
    p_motivo text default null,
    p_itens jsonb default '[]'::jsonb
)
returns table (
    solicitacao_id uuid,
    tipo text,
    status text,
    motivo text,
    total_valor numeric,
    solicitante_nome text,
    solicitante_mat text,
    created_at timestamptz,
    aprovador_nome text,
    aprovador_mat text,
    aprovado_at timestamptz,
    decisao_observacao text,
    itens jsonb
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
    v_tipo text;
    v_solicitacao_id uuid;
    v_item jsonb;
    v_codigo text;
    v_qtd integer;
    v_produto app.almox_produtos%rowtype;
    v_total numeric(18, 2) := 0;
begin
    select * into v_profile from app.almox_require_admin() limit 1;
    v_tipo := lower(trim(coalesce(p_tipo, '')));
    if v_tipo not in ('compra', 'retirada') then raise exception 'TIPO_INVALIDO'; end if;
    if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'NF_SEM_ITENS'; end if;

    insert into app.almox_solicitacoes as s(tipo, motivo, solicitante_id, solicitante_mat, solicitante_nome)
    values (v_tipo, nullif(trim(coalesce(p_motivo, '')), ''), v_profile.user_id, v_profile.mat, v_profile.nome)
    returning s.solicitacao_id into v_solicitacao_id;

    for v_item in select * from jsonb_array_elements(p_itens)
    loop
        v_codigo := app.almox_norm_codigo(v_item->>'codigo');
        v_qtd := nullif(v_item->>'quantidade', '')::integer;
        if v_codigo = '' then raise exception 'CODIGO_OBRIGATORIO'; end if;
        if v_qtd is null or v_qtd <= 0 then raise exception 'QTD_INVALIDA'; end if;

        select * into v_produto from app.almox_produtos as p where p.codigo = v_codigo;
        if v_produto.produto_id is null then raise exception 'PRODUTO_NAO_ENCONTRADO'; end if;

        insert into app.almox_solicitacao_itens(
            solicitacao_id, produto_id, codigo, descricao, marca, tamanho, quantidade,
            estoque_snapshot, valor_unitario, valor_total
        )
        values (
            v_solicitacao_id, v_produto.produto_id, v_produto.codigo, v_produto.descricao, v_produto.marca, v_produto.tamanho,
            v_qtd, v_produto.estoque_atual, v_produto.ultimo_custo, round(v_qtd::numeric * v_produto.ultimo_custo, 2)
        );
        v_total := v_total + round(v_qtd::numeric * v_produto.ultimo_custo, 2);
    end loop;

    update app.almox_solicitacoes as s
       set total_valor = v_total
     where s.solicitacao_id = v_solicitacao_id;

    return query select * from app.almox_solicitacao_payload(v_solicitacao_id);
end;
$$;

create or replace function public.rpc_almox_solicitacao_decidir(
    p_solicitacao_id uuid,
    p_approve boolean,
    p_observacao text default null
)
returns table (
    solicitacao_id uuid,
    tipo text,
    status text,
    motivo text,
    total_valor numeric,
    solicitante_nome text,
    solicitante_mat text,
    created_at timestamptz,
    aprovador_nome text,
    aprovador_mat text,
    aprovado_at timestamptz,
    decisao_observacao text,
    itens jsonb
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
    v_solic app.almox_solicitacoes%rowtype;
    v_item app.almox_solicitacao_itens%rowtype;
    v_produto app.almox_produtos%rowtype;
    v_new_stock integer;
begin
    select * into v_profile from app.almox_require_global_admin() limit 1;
    select * into v_solic
      from app.almox_solicitacoes as s
     where s.solicitacao_id = p_solicitacao_id
       for update;

    if v_solic.solicitacao_id is null then raise exception 'SOLICITACAO_NAO_ENCONTRADA'; end if;
    if v_solic.status <> 'pendente' then raise exception 'SOLICITACAO_NAO_PENDENTE'; end if;

    if p_approve and v_solic.tipo = 'retirada' then
        for v_item in
            select *
              from app.almox_solicitacao_itens as i
             where i.solicitacao_id = p_solicitacao_id
             order by i.codigo
        loop
            select * into v_produto
              from app.almox_produtos as p
             where p.produto_id = v_item.produto_id
               for update;

            if v_produto.estoque_atual < v_item.quantidade then
                raise exception 'ESTOQUE_INSUFICIENTE:%', v_item.codigo;
            end if;
        end loop;

        for v_item in
            select *
              from app.almox_solicitacao_itens as i
             where i.solicitacao_id = p_solicitacao_id
             order by i.codigo
        loop
            select * into v_produto
              from app.almox_produtos as p
             where p.produto_id = v_item.produto_id
               for update;

            v_new_stock := v_produto.estoque_atual - v_item.quantidade;
            update app.almox_produtos as p
               set estoque_atual = v_new_stock
             where p.produto_id = v_item.produto_id;

            insert into app.almox_movimentos(
                produto_id, tipo, origem_id, origem_label, codigo, descricao, quantidade_delta, estoque_antes,
                estoque_depois, valor_unitario, valor_total, observacao, actor_id, actor_mat, actor_nome
            )
            values (
                v_item.produto_id, 'retirada_aprovada', p_solicitacao_id, 'Solicitação de retirada',
                v_item.codigo, v_item.descricao, -v_item.quantidade, v_produto.estoque_atual, v_new_stock,
                v_item.valor_unitario, v_item.valor_total, p_observacao, v_profile.user_id, v_profile.mat, v_profile.nome
            );
        end loop;
    end if;

    update app.almox_solicitacoes as s
       set status = case when p_approve then 'aprovada' else 'reprovada' end,
           aprovador_id = v_profile.user_id,
           aprovador_mat = v_profile.mat,
           aprovador_nome = v_profile.nome,
           aprovado_at = timezone('utc', now()),
           decisao_observacao = nullif(trim(coalesce(p_observacao, '')), '')
     where s.solicitacao_id = p_solicitacao_id;

    return query select * from app.almox_solicitacao_payload(p_solicitacao_id);
end;
$$;
