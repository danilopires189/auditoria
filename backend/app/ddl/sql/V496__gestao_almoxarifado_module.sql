create table if not exists app.almox_produtos (
    produto_id uuid primary key default gen_random_uuid(),
    codigo text not null,
    descricao text not null,
    marca text not null,
    tamanho text,
    estoque_atual integer not null default 0 check (estoque_atual >= 0),
    ultimo_custo numeric(18, 4) not null default 0 check (ultimo_custo >= 0),
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint uq_almox_produtos_codigo unique (codigo)
);

create table if not exists app.almox_solicitacoes (
    solicitacao_id uuid primary key default gen_random_uuid(),
    tipo text not null check (tipo in ('compra', 'retirada')),
    status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'reprovada')),
    motivo text,
    solicitante_id uuid not null references auth.users(id) on delete restrict,
    solicitante_mat text not null,
    solicitante_nome text not null,
    total_valor numeric(18, 2) not null default 0,
    aprovador_id uuid references auth.users(id) on delete restrict,
    aprovador_mat text,
    aprovador_nome text,
    aprovado_at timestamptz,
    decisao_observacao text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists app.almox_solicitacao_itens (
    item_id uuid primary key default gen_random_uuid(),
    solicitacao_id uuid not null references app.almox_solicitacoes(solicitacao_id) on delete cascade,
    produto_id uuid not null references app.almox_produtos(produto_id) on delete restrict,
    codigo text not null,
    descricao text not null,
    marca text not null,
    tamanho text,
    quantidade integer not null check (quantidade > 0),
    estoque_snapshot integer not null default 0,
    valor_unitario numeric(18, 4) not null default 0,
    valor_total numeric(18, 2) not null default 0
);

create table if not exists app.almox_movimentos (
    movimento_id uuid primary key default gen_random_uuid(),
    produto_id uuid not null references app.almox_produtos(produto_id) on delete restrict,
    tipo text not null check (tipo in ('inventario', 'retirada_aprovada', 'nota_aplicada')),
    origem_id uuid,
    origem_label text,
    codigo text not null,
    descricao text not null,
    quantidade_delta integer not null,
    estoque_antes integer not null,
    estoque_depois integer not null,
    valor_unitario numeric(18, 4) not null default 0,
    valor_total numeric(18, 2) not null default 0,
    observacao text,
    actor_id uuid references auth.users(id) on delete restrict,
    actor_mat text not null,
    actor_nome text not null,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists app.almox_nf_imports (
    import_id uuid primary key default gen_random_uuid(),
    numero_nf text,
    fornecedor text,
    data_emissao date,
    payload jsonb not null default '{}'::jsonb,
    alertas text[] not null default array[]::text[],
    status text not null default 'extraida' check (status in ('extraida', 'aplicada')),
    created_by uuid not null references auth.users(id) on delete restrict,
    created_mat text not null,
    created_nome text not null,
    created_at timestamptz not null default timezone('utc', now()),
    applied_by uuid references auth.users(id) on delete restrict,
    applied_mat text,
    applied_nome text,
    applied_at timestamptz
);

create index if not exists idx_almox_produtos_search on app.almox_produtos using gin (to_tsvector('portuguese', codigo || ' ' || descricao || ' ' || marca || ' ' || coalesce(tamanho, '')));
create index if not exists idx_almox_solic_status_created on app.almox_solicitacoes(status, created_at desc);
create index if not exists idx_almox_solic_user_created on app.almox_solicitacoes(solicitante_id, created_at desc);
create index if not exists idx_almox_mov_created on app.almox_movimentos(created_at desc);
create index if not exists idx_almox_nf_created on app.almox_nf_imports(created_at desc);

create or replace function app.almox_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists trg_almox_produtos_touch on app.almox_produtos;
create trigger trg_almox_produtos_touch
before update on app.almox_produtos
for each row execute function app.almox_touch_updated_at();

drop trigger if exists trg_almox_solic_touch on app.almox_solicitacoes;
create trigger trg_almox_solic_touch
before update on app.almox_solicitacoes
for each row execute function app.almox_touch_updated_at();

create or replace function app.almox_norm_codigo(p_codigo text)
returns text
language sql
immutable
as $$
    select upper(trim(coalesce(p_codigo, '')));
$$;

create or replace function app.almox_current_profile()
returns table (
    user_id uuid,
    mat text,
    nome text,
    role text,
    cd_default integer,
    is_global_admin boolean
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_uid uuid;
    v_profile record;
begin
    v_uid := auth.uid();
    if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
    if not authz.session_is_recent(6) then raise exception 'SESSAO_EXPIRADA'; end if;

    select * into v_profile from authz.current_profile_context_v2() limit 1;
    if v_profile.user_id is null then raise exception 'PROFILE_NAO_ENCONTRADO'; end if;

    return query
    select
        v_uid,
        coalesce(nullif(trim(v_profile.mat), ''), '-')::text,
        coalesce(nullif(trim(v_profile.nome), ''), 'Usuário')::text,
        coalesce(nullif(trim(v_profile.role), ''), 'auditor')::text,
        v_profile.cd_default::integer,
        (coalesce(v_profile.role, '') = 'admin' and v_profile.cd_default is null)::boolean;
end;
$$;

create or replace function app.almox_require_admin()
returns table (
    user_id uuid,
    mat text,
    nome text,
    role text,
    cd_default integer,
    is_global_admin boolean
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
begin
    select * into v_profile from app.almox_current_profile() limit 1;
    if v_profile.role <> 'admin' then raise exception 'APENAS_ADMIN'; end if;
    return query
    select v_profile.user_id::uuid, v_profile.mat::text, v_profile.nome::text, v_profile.role::text,
           v_profile.cd_default::integer, v_profile.is_global_admin::boolean;
end;
$$;

create or replace function app.almox_require_global_admin()
returns table (
    user_id uuid,
    mat text,
    nome text,
    role text,
    cd_default integer,
    is_global_admin boolean
)
language plpgsql
stable
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
begin
    select * into v_profile from app.almox_current_profile() limit 1;
    if not v_profile.is_global_admin then raise exception 'APENAS_ADMIN_GLOBAL'; end if;
    return query
    select v_profile.user_id::uuid, v_profile.mat::text, v_profile.nome::text, v_profile.role::text,
           v_profile.cd_default::integer, v_profile.is_global_admin::boolean;
end;
$$;

create or replace function app.almox_solicitacao_payload(p_solicitacao_id uuid)
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
language sql
stable
security definer
set search_path = app, public
set row_security = off
as $$
    select
        s.solicitacao_id,
        s.tipo,
        s.status,
        s.motivo,
        s.total_valor,
        s.solicitante_nome,
        s.solicitante_mat,
        s.created_at,
        s.aprovador_nome,
        s.aprovador_mat,
        s.aprovado_at,
        s.decisao_observacao,
        coalesce(jsonb_agg(to_jsonb(i) order by i.codigo) filter (where i.item_id is not null), '[]'::jsonb) as itens
    from app.almox_solicitacoes s
    left join app.almox_solicitacao_itens i on i.solicitacao_id = s.solicitacao_id
    where s.solicitacao_id = p_solicitacao_id
    group by s.solicitacao_id;
$$;

create or replace function public.rpc_almox_produtos_list(p_search text default '')
returns table (
    produto_id uuid,
    codigo text,
    descricao text,
    marca text,
    tamanho text,
    estoque_atual integer,
    ultimo_custo numeric,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
    v_search text;
begin
    select * into v_profile from app.almox_current_profile() limit 1;
    v_search := lower(trim(coalesce(p_search, '')));

    return query
    select p.produto_id, p.codigo, p.descricao, p.marca, p.tamanho, p.estoque_atual, p.ultimo_custo, p.created_at, p.updated_at
    from app.almox_produtos p
    where v_search = ''
       or lower(p.codigo || ' ' || p.descricao || ' ' || p.marca || ' ' || coalesce(p.tamanho, '')) like '%' || v_search || '%'
    order by p.descricao, p.codigo
    limit 300;
end;
$$;

create or replace function public.rpc_almox_produto_save(
    p_produto_id uuid default null,
    p_codigo text default null,
    p_descricao text default null,
    p_marca text default null,
    p_tamanho text default null
)
returns setof app.almox_produtos
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
    v_codigo text;
    v_produto_id uuid;
begin
    select * into v_profile from app.almox_require_global_admin() limit 1;
    v_codigo := app.almox_norm_codigo(p_codigo);
    if v_codigo = '' then raise exception 'CODIGO_OBRIGATORIO'; end if;
    if nullif(trim(coalesce(p_descricao, '')), '') is null then raise exception 'DESCRICAO_OBRIGATORIA'; end if;
    if nullif(trim(coalesce(p_marca, '')), '') is null then raise exception 'MARCA_OBRIGATORIA'; end if;

    if p_produto_id is null then
        insert into app.almox_produtos(codigo, descricao, marca, tamanho)
        values (v_codigo, trim(p_descricao), trim(p_marca), nullif(trim(coalesce(p_tamanho, '')), ''))
        on conflict (codigo) do update
           set descricao = excluded.descricao,
               marca = excluded.marca,
               tamanho = excluded.tamanho
        returning produto_id into v_produto_id;
    else
        update app.almox_produtos
           set codigo = v_codigo,
               descricao = trim(p_descricao),
               marca = trim(p_marca),
               tamanho = nullif(trim(coalesce(p_tamanho, '')), '')
         where produto_id = p_produto_id
         returning produto_id into v_produto_id;
    end if;

    if v_produto_id is null then raise exception 'PRODUTO_NAO_ENCONTRADO'; end if;
    return query select * from app.almox_produtos where produto_id = v_produto_id;
end;
$$;

create or replace function public.rpc_almox_inventario_ajustar(
    p_produto_id uuid,
    p_estoque_atual integer,
    p_observacao text default null
)
returns setof app.almox_produtos
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
    v_produto app.almox_produtos%rowtype;
begin
    select * into v_profile from app.almox_require_global_admin() limit 1;
    if p_estoque_atual is null or p_estoque_atual < 0 then raise exception 'QTD_INVALIDA'; end if;

    select * into v_produto from app.almox_produtos where produto_id = p_produto_id for update;
    if v_produto.produto_id is null then raise exception 'PRODUTO_NAO_ENCONTRADO'; end if;

    update app.almox_produtos set estoque_atual = p_estoque_atual where produto_id = p_produto_id;

    insert into app.almox_movimentos(
        produto_id, tipo, codigo, descricao, quantidade_delta, estoque_antes, estoque_depois,
        valor_unitario, valor_total, observacao, actor_id, actor_mat, actor_nome, origem_label
    )
    values (
        v_produto.produto_id, 'inventario', v_produto.codigo, v_produto.descricao,
        p_estoque_atual - v_produto.estoque_atual, v_produto.estoque_atual, p_estoque_atual,
        v_produto.ultimo_custo, round(abs(p_estoque_atual - v_produto.estoque_atual)::numeric * v_produto.ultimo_custo, 2),
        p_observacao, v_profile.user_id, v_profile.mat, v_profile.nome, 'Inventário manual'
    );

    return query select * from app.almox_produtos where produto_id = p_produto_id;
end;
$$;

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

    insert into app.almox_solicitacoes(tipo, motivo, solicitante_id, solicitante_mat, solicitante_nome)
    values (v_tipo, nullif(trim(coalesce(p_motivo, '')), ''), v_profile.user_id, v_profile.mat, v_profile.nome)
    returning solicitacao_id into v_solicitacao_id;

    for v_item in select * from jsonb_array_elements(p_itens)
    loop
        v_codigo := app.almox_norm_codigo(v_item->>'codigo');
        v_qtd := nullif(v_item->>'quantidade', '')::integer;
        if v_codigo = '' then raise exception 'CODIGO_OBRIGATORIO'; end if;
        if v_qtd is null or v_qtd <= 0 then raise exception 'QTD_INVALIDA'; end if;

        select * into v_produto from app.almox_produtos where codigo = v_codigo;
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

    update app.almox_solicitacoes set total_valor = v_total where solicitacao_id = v_solicitacao_id;
    return query select * from app.almox_solicitacao_payload(v_solicitacao_id);
end;
$$;

create or replace function public.rpc_almox_solicitacoes_list(
    p_scope text default 'minhas',
    p_tipo text default null
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
    v_scope text;
    v_tipo text;
begin
    select * into v_profile from app.almox_current_profile() limit 1;
    v_scope := lower(trim(coalesce(p_scope, 'minhas')));
    v_tipo := nullif(lower(trim(coalesce(p_tipo, ''))), '');
    if v_tipo is not null and v_tipo not in ('compra', 'retirada') then raise exception 'TIPO_INVALIDO'; end if;

    if v_scope in ('pendentes', 'todas') and not v_profile.is_global_admin then
        raise exception 'APENAS_ADMIN_GLOBAL';
    end if;

    return query
    select p.*
    from app.almox_solicitacoes s
    cross join lateral app.almox_solicitacao_payload(s.solicitacao_id) p
    where (v_scope <> 'minhas' or s.solicitante_id = v_profile.user_id)
      and (v_scope <> 'pendentes' or s.status = 'pendente')
      and (v_tipo is null or s.tipo = v_tipo)
    order by s.created_at desc
    limit 200;
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
    select * into v_solic from app.almox_solicitacoes where solicitacao_id = p_solicitacao_id for update;
    if v_solic.solicitacao_id is null then raise exception 'SOLICITACAO_NAO_ENCONTRADA'; end if;
    if v_solic.status <> 'pendente' then raise exception 'SOLICITACAO_NAO_PENDENTE'; end if;

    if p_approve and v_solic.tipo = 'retirada' then
        for v_item in select * from app.almox_solicitacao_itens where solicitacao_id = p_solicitacao_id order by codigo
        loop
            select * into v_produto from app.almox_produtos where produto_id = v_item.produto_id for update;
            if v_produto.estoque_atual < v_item.quantidade then
                raise exception 'ESTOQUE_INSUFICIENTE:%', v_item.codigo;
            end if;
        end loop;

        for v_item in select * from app.almox_solicitacao_itens where solicitacao_id = p_solicitacao_id order by codigo
        loop
            select * into v_produto from app.almox_produtos where produto_id = v_item.produto_id for update;
            v_new_stock := v_produto.estoque_atual - v_item.quantidade;
            update app.almox_produtos set estoque_atual = v_new_stock where produto_id = v_item.produto_id;
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

    update app.almox_solicitacoes
       set status = case when p_approve then 'aprovada' else 'reprovada' end,
           aprovador_id = v_profile.user_id,
           aprovador_mat = v_profile.mat,
           aprovador_nome = v_profile.nome,
           aprovado_at = timezone('utc', now()),
           decisao_observacao = nullif(trim(coalesce(p_observacao, '')), '')
     where solicitacao_id = p_solicitacao_id;

    return query select * from app.almox_solicitacao_payload(p_solicitacao_id);
end;
$$;

create or replace function public.rpc_almox_nf_import_save(p_payload jsonb)
returns setof app.almox_nf_imports
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
    v_import_id uuid;
    v_alertas text[];
begin
    select * into v_profile from app.almox_require_global_admin() limit 1;
    v_alertas := coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'alertas', '[]'::jsonb))), array[]::text[]);
    if jsonb_typeof(coalesce(p_payload->'itens', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_payload->'itens', '[]'::jsonb)) = 0 then
        raise exception 'NF_SEM_ITENS';
    end if;

    insert into app.almox_nf_imports(numero_nf, fornecedor, data_emissao, payload, alertas, created_by, created_mat, created_nome)
    values (
        nullif(trim(coalesce(p_payload->>'numero_nf', '')), ''),
        nullif(trim(coalesce(p_payload->>'fornecedor', '')), ''),
        nullif(trim(coalesce(p_payload->>'data_emissao', '')), '')::date,
        p_payload,
        v_alertas,
        v_profile.user_id,
        v_profile.mat,
        v_profile.nome
    )
    returning import_id into v_import_id;

    return query select * from app.almox_nf_imports where import_id = v_import_id;
end;
$$;

create or replace function public.rpc_almox_nf_validate_items(p_payload jsonb)
returns table (
    codigo text,
    descricao text,
    quantidade integer,
    valor_unitario numeric,
    valor_total numeric,
    produto_id uuid,
    produto_existe boolean,
    estoque_atual integer
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
begin
    select * into v_profile from app.almox_require_global_admin() limit 1;
    if jsonb_typeof(coalesce(p_payload->'itens', '[]'::jsonb)) <> 'array' then raise exception 'NF_SEM_ITENS'; end if;

    return query
    select
        app.almox_norm_codigo(item->>'codigo') as codigo,
        coalesce(nullif(trim(item->>'descricao'), ''), 'Item sem descrição') as descricao,
        greatest(coalesce(nullif(item->>'quantidade', '')::integer, 0), 0) as quantidade,
        greatest(coalesce(nullif(replace(item->>'valor_unitario', ',', '.'), '')::numeric, 0), 0) as valor_unitario,
        greatest(coalesce(nullif(replace(item->>'valor_total', ',', '.'), '')::numeric, 0), 0) as valor_total,
        p.produto_id,
        p.produto_id is not null as produto_existe,
        coalesce(p.estoque_atual, 0) as estoque_atual
    from jsonb_array_elements(coalesce(p_payload->'itens', '[]'::jsonb)) item
    left join app.almox_produtos p on p.codigo = app.almox_norm_codigo(item->>'codigo');
end;
$$;

create or replace function public.rpc_almox_nf_import_apply(
    p_import_id uuid,
    p_payload jsonb
)
returns setof app.almox_nf_imports
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
    v_import app.almox_nf_imports%rowtype;
    v_item jsonb;
    v_codigo text;
    v_qtd integer;
    v_unit numeric(18, 4);
    v_total numeric(18, 2);
    v_produto app.almox_produtos%rowtype;
    v_new_stock integer;
begin
    select * into v_profile from app.almox_require_global_admin() limit 1;
    select * into v_import from app.almox_nf_imports where import_id = p_import_id for update;
    if v_import.import_id is null then raise exception 'IMPORTACAO_NAO_ENCONTRADA'; end if;
    if v_import.status = 'aplicada' then return query select * from app.almox_nf_imports where import_id = p_import_id; return; end if;
    if jsonb_typeof(coalesce(p_payload->'itens', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_payload->'itens', '[]'::jsonb)) = 0 then
        raise exception 'NF_SEM_ITENS';
    end if;

    for v_item in select * from jsonb_array_elements(coalesce(p_payload->'itens', '[]'::jsonb))
    loop
        v_codigo := app.almox_norm_codigo(v_item->>'codigo');
        if not exists (select 1 from app.almox_produtos where codigo = v_codigo) then
            raise exception 'PRODUTO_NOVO_BLOQUEIA_APLICACAO:%', v_codigo;
        end if;
    end loop;

    for v_item in select * from jsonb_array_elements(coalesce(p_payload->'itens', '[]'::jsonb))
    loop
        v_codigo := app.almox_norm_codigo(v_item->>'codigo');
        v_qtd := greatest(coalesce(nullif(v_item->>'quantidade', '')::integer, 0), 0);
        v_unit := greatest(coalesce(nullif(replace(v_item->>'valor_unitario', ',', '.'), '')::numeric, 0), 0);
        v_total := greatest(coalesce(nullif(replace(v_item->>'valor_total', ',', '.'), '')::numeric, round(v_qtd::numeric * v_unit, 2)), 0);
        if v_qtd <= 0 then raise exception 'QTD_INVALIDA'; end if;

        select * into v_produto from app.almox_produtos where codigo = v_codigo for update;
        v_new_stock := v_produto.estoque_atual + v_qtd;
        update app.almox_produtos
           set estoque_atual = v_new_stock,
               ultimo_custo = v_unit
         where produto_id = v_produto.produto_id;

        insert into app.almox_movimentos(
            produto_id, tipo, origem_id, origem_label, codigo, descricao, quantidade_delta, estoque_antes,
            estoque_depois, valor_unitario, valor_total, actor_id, actor_mat, actor_nome
        )
        values (
            v_produto.produto_id, 'nota_aplicada', p_import_id, 'Nota fiscal ' || coalesce(nullif(p_payload->>'numero_nf', ''), '-'),
            v_produto.codigo, v_produto.descricao, v_qtd, v_produto.estoque_atual, v_new_stock,
            v_unit, v_total, v_profile.user_id, v_profile.mat, v_profile.nome
        );
    end loop;

    update app.almox_nf_imports
       set payload = p_payload,
           numero_nf = nullif(trim(coalesce(p_payload->>'numero_nf', '')), ''),
           fornecedor = nullif(trim(coalesce(p_payload->>'fornecedor', '')), ''),
           data_emissao = nullif(trim(coalesce(p_payload->>'data_emissao', '')), '')::date,
           status = 'aplicada',
           applied_by = v_profile.user_id,
           applied_mat = v_profile.mat,
           applied_nome = v_profile.nome,
           applied_at = timezone('utc', now())
     where import_id = p_import_id;

    return query select * from app.almox_nf_imports where import_id = p_import_id;
end;
$$;

create or replace function public.rpc_almox_nf_imports_list()
returns setof app.almox_nf_imports
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
begin
    select * into v_profile from app.almox_require_global_admin() limit 1;
    return query select * from app.almox_nf_imports order by created_at desc limit 100;
end;
$$;

create or replace function public.rpc_almox_movimentos_report()
returns table (
    movimento_id uuid,
    tipo text,
    codigo text,
    descricao text,
    quantidade_delta integer,
    estoque_antes integer,
    estoque_depois integer,
    valor_unitario numeric,
    valor_total numeric,
    actor_nome text,
    actor_mat text,
    created_at timestamptz,
    origem_label text
)
language plpgsql
security definer
set search_path = app, authz, public
set row_security = off
as $$
declare
    v_profile record;
begin
    select * into v_profile from app.almox_require_global_admin() limit 1;
    return query
    select m.movimento_id, m.tipo, m.codigo, m.descricao, m.quantidade_delta, m.estoque_antes, m.estoque_depois,
           m.valor_unitario, m.valor_total, m.actor_nome, m.actor_mat, m.created_at, m.origem_label
    from app.almox_movimentos m
    order by m.created_at desc
    limit 500;
end;
$$;

alter table app.almox_produtos enable row level security;
alter table app.almox_solicitacoes enable row level security;
alter table app.almox_solicitacao_itens enable row level security;
alter table app.almox_movimentos enable row level security;
alter table app.almox_nf_imports enable row level security;

revoke all on table app.almox_produtos from anon;
revoke all on table app.almox_solicitacoes from anon;
revoke all on table app.almox_solicitacao_itens from anon;
revoke all on table app.almox_movimentos from anon;
revoke all on table app.almox_nf_imports from anon;
revoke insert, update, delete, truncate, references, trigger on table app.almox_produtos from authenticated;
revoke insert, update, delete, truncate, references, trigger on table app.almox_solicitacoes from authenticated;
revoke insert, update, delete, truncate, references, trigger on table app.almox_solicitacao_itens from authenticated;
revoke insert, update, delete, truncate, references, trigger on table app.almox_movimentos from authenticated;
revoke insert, update, delete, truncate, references, trigger on table app.almox_nf_imports from authenticated;

drop policy if exists p_almox_produtos_select on app.almox_produtos;
create policy p_almox_produtos_select on app.almox_produtos for select using (authz.user_role(auth.uid()) in ('admin', 'auditor', 'viewer'));

insert into app.almox_produtos(codigo, descricao, marca, tamanho, estoque_atual, ultimo_custo)
values
    ('CX-LUVA-M', 'Luva nitrílica', 'Volk', 'M', 120, 0.85),
    ('CX-FITA-45', 'Fita adesiva transparente', 'Adelbras', '45mm', 36, 4.90),
    ('CX-PAPEL-A4', 'Papel sulfite A4', 'Chamex', '500 folhas', 18, 24.50),
    ('CX-CANETA-AZ', 'Caneta esferográfica azul', 'Bic', null, 80, 1.35)
on conflict (codigo) do nothing;

grant execute on function public.rpc_almox_produtos_list(text) to authenticated;
grant execute on function public.rpc_almox_produto_save(uuid, text, text, text, text) to authenticated;
grant execute on function public.rpc_almox_inventario_ajustar(uuid, integer, text) to authenticated;
grant execute on function public.rpc_almox_solicitacao_criar(text, text, jsonb) to authenticated;
grant execute on function public.rpc_almox_solicitacoes_list(text, text) to authenticated;
grant execute on function public.rpc_almox_solicitacao_decidir(uuid, boolean, text) to authenticated;
grant execute on function public.rpc_almox_nf_import_save(jsonb) to authenticated;
grant execute on function public.rpc_almox_nf_validate_items(jsonb) to authenticated;
grant execute on function public.rpc_almox_nf_import_apply(uuid, jsonb) to authenticated;
grant execute on function public.rpc_almox_nf_imports_list() to authenticated;
grant execute on function public.rpc_almox_movimentos_report() to authenticated;
