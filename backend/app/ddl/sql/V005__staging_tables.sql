create table if not exists staging.db_entrada_notas (
    cd integer,
    transportadora text,
    forn text,
    seq_entrada bigint,
    nf bigint,
    coddv integer,
    descricao text,
    qtd_cx numeric,
    un_por_cx numeric,
    qtd_total numeric,
    vl_tt numeric(18, 2),
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default timezone('utc', now())
);

create table if not exists staging.db_avulso (
    cd integer,
    id_mov text,
    nr_volume text,
    dt_mov date,
    coddv integer,
    descricao text,
    lote text,
    val text,
    qtd_mov numeric,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default timezone('utc', now())
);

create table if not exists staging.db_usuario (
    cd integer,
    mat text,
    nome text,
    dt_nasc date,
    dt_adm date,
    cargo text,
    cd_nome text,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default timezone('utc', now())
);

create table if not exists staging.db_barras (
    coddv integer,
    descricao text,
    barras text,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default timezone('utc', now())
);

create table if not exists staging.db_devolucao (
    cd integer,
    motivo text,
    nfd bigint,
    coddv integer,
    descricao text,
    tipo text,
    qtd_dev numeric,
    dt_gera date,
    chave text,
    geracao text,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default timezone('utc', now())
);

create table if not exists staging.db_pedido_direto (
    cd integer,
    pedido bigint,
    sq bigint,
    filial bigint,
    dt_pedido date,
    coddv integer,
    descricao text,
    qtd_fat numeric,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default timezone('utc', now())
);

create table if not exists staging.db_termo (
    pedido bigint,
    cd integer,
    filial bigint,
    coddv integer,
    descricao text,
    caixa text,
    qtd_separada numeric,
    num_rota text,
    id_etiqueta text,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default timezone('utc', now())
);