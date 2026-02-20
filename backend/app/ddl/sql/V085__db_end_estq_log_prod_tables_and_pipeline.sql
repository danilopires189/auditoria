create table if not exists staging.db_end (
    cd integer,
    coddv integer,
    descricao text,
    endereco text,
    andar text,
    validade text,
    tipo text,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default now()
);

create table if not exists app.db_end (
    cd integer,
    coddv integer,
    descricao text,
    endereco text,
    andar text,
    validade text,
    tipo text,
    source_run_id uuid,
    updated_at timestamptz not null default now(),
    constraint uq_app_db_end unique (cd, coddv, endereco, tipo)
);

create table if not exists audit.rejections_db_end (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default now()
);

create table if not exists staging.db_estq_entr (
    cd integer,
    coddv integer,
    qtd_est_atual integer,
    qtd_est_disp integer,
    dat_ult_compra date,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default now()
);

create table if not exists app.db_estq_entr (
    cd integer,
    coddv integer,
    qtd_est_atual integer,
    qtd_est_disp integer,
    dat_ult_compra date,
    source_run_id uuid,
    updated_at timestamptz not null default now(),
    constraint uq_app_db_estq_entr unique (cd, coddv)
);

create table if not exists audit.rejections_db_estq_entr (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default now()
);

create table if not exists staging.db_log_end (
    cd integer,
    coddv integer,
    descricao text,
    endereco text,
    exclusao date,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default now()
);

create table if not exists app.db_log_end (
    cd integer,
    coddv integer,
    descricao text,
    endereco text,
    exclusao date,
    source_run_id uuid,
    updated_at timestamptz not null default now(),
    constraint uq_app_db_log_end unique (cd, coddv, endereco, exclusao)
);

create table if not exists audit.rejections_db_log_end (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default now()
);

create table if not exists staging.db_prod_blitz (
    cd integer,
    filial bigint,
    nr_pedido bigint,
    dt_conf timestamptz,
    auditor text,
    qtd_un integer,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default now()
);

create table if not exists app.db_prod_blitz (
    cd integer,
    filial bigint,
    nr_pedido bigint,
    dt_conf timestamptz,
    auditor text,
    qtd_un integer,
    source_run_id uuid,
    updated_at timestamptz not null default now(),
    constraint uq_app_db_prod_blitz unique (cd, filial, nr_pedido, dt_conf, auditor)
);

create table if not exists audit.rejections_db_prod_blitz (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default now()
);

create table if not exists staging.db_prod_vol (
    cd integer,
    aud text,
    vol_conf integer,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default now()
);

create table if not exists app.db_prod_vol (
    cd integer,
    aud text,
    vol_conf integer,
    source_run_id uuid,
    updated_at timestamptz not null default now(),
    constraint uq_app_db_prod_vol unique (cd, aud)
);

create table if not exists audit.rejections_db_prod_vol (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_app_db_end_cd
    on app.db_end(cd);

create index if not exists idx_app_db_estq_entr_cd
    on app.db_estq_entr(cd);

create index if not exists idx_app_db_log_end_cd
    on app.db_log_end(cd);

create index if not exists idx_app_db_prod_blitz_cd
    on app.db_prod_blitz(cd);

create index if not exists idx_app_db_prod_vol_cd
    on app.db_prod_vol(cd);

create index if not exists idx_staging_db_end_run_id
    on staging.db_end(run_id);

create index if not exists idx_staging_db_estq_entr_run_id
    on staging.db_estq_entr(run_id);

create index if not exists idx_staging_db_log_end_run_id
    on staging.db_log_end(run_id);

create index if not exists idx_staging_db_prod_blitz_run_id
    on staging.db_prod_blitz(run_id);

create index if not exists idx_staging_db_prod_vol_run_id
    on staging.db_prod_vol(run_id);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_end_source_run'
    ) then
        alter table app.db_end
            add constraint fk_app_db_end_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_estq_entr_source_run'
    ) then
        alter table app.db_estq_entr
            add constraint fk_app_db_estq_entr_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_log_end_source_run'
    ) then
        alter table app.db_log_end
            add constraint fk_app_db_log_end_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_prod_blitz_source_run'
    ) then
        alter table app.db_prod_blitz
            add constraint fk_app_db_prod_blitz_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_prod_vol_source_run'
    ) then
        alter table app.db_prod_vol
            add constraint fk_app_db_prod_vol_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;
end;
$$;

select app.apply_runtime_security('db_end');
select app.apply_runtime_security('db_estq_entr');
select app.apply_runtime_security('db_log_end');
select app.apply_runtime_security('db_prod_blitz');
select app.apply_runtime_security('db_prod_vol');
