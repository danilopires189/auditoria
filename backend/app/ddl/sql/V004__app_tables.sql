create table if not exists app.db_entrada_notas (
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
    source_run_id uuid,
    updated_at timestamptz not null default timezone('utc', now()),
    constraint uq_app_db_entrada_notas unique (cd, seq_entrada, nf, coddv)
);

create table if not exists app.db_avulso (
    cd integer,
    id_mov text,
    nr_volume text,
    dt_mov date,
    coddv integer,
    descricao text,
    lote text,
    val text,
    qtd_mov numeric,
    source_run_id uuid,
    updated_at timestamptz not null default timezone('utc', now()),
    constraint uq_app_db_avulso unique (cd, id_mov, nr_volume, coddv)
);

create table if not exists app.db_usuario (
    cd integer,
    mat text,
    nome text,
    dt_nasc date,
    dt_adm date,
    cargo text,
    cd_nome text,
    source_run_id uuid,
    updated_at timestamptz not null default timezone('utc', now()),
    constraint uq_app_db_usuario unique (cd, mat)
);

create table if not exists app.db_barras (
    coddv integer,
    descricao text,
    barras text,
    source_run_id uuid,
    updated_at timestamptz not null default timezone('utc', now()),
    constraint uq_app_db_barras unique (coddv, barras)
);

create table if not exists app.db_devolucao (
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
    source_run_id uuid,
    updated_at timestamptz not null default timezone('utc', now()),
    constraint uq_app_db_devolucao unique (cd, chave, coddv)
);

create table if not exists app.db_pedido_direto (
    cd integer,
    pedido bigint,
    sq bigint,
    filial bigint,
    dt_pedido date,
    coddv integer,
    descricao text,
    qtd_fat numeric,
    source_run_id uuid,
    updated_at timestamptz not null default timezone('utc', now()),
    constraint uq_app_db_pedido_direto unique (cd, pedido, sq, coddv)
);

create table if not exists app.db_termo (
    pedido bigint,
    cd integer,
    filial bigint,
    coddv integer,
    descricao text,
    caixa text,
    qtd_separada numeric,
    num_rota text,
    id_etiqueta text,
    source_run_id uuid,
    updated_at timestamptz not null default timezone('utc', now()),
    constraint uq_app_db_termo unique (pedido, cd, filial, coddv, id_etiqueta)
);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_entrada_notas_source_run'
    ) then
        alter table app.db_entrada_notas
            add constraint fk_app_db_entrada_notas_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_avulso_source_run'
    ) then
        alter table app.db_avulso
            add constraint fk_app_db_avulso_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_usuario_source_run'
    ) then
        alter table app.db_usuario
            add constraint fk_app_db_usuario_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_barras_source_run'
    ) then
        alter table app.db_barras
            add constraint fk_app_db_barras_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_devolucao_source_run'
    ) then
        alter table app.db_devolucao
            add constraint fk_app_db_devolucao_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_pedido_direto_source_run'
    ) then
        alter table app.db_pedido_direto
            add constraint fk_app_db_pedido_direto_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_termo_source_run'
    ) then
        alter table app.db_termo
            add constraint fk_app_db_termo_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;
end;
$$;
