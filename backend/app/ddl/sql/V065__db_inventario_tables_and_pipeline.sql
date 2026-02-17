create table if not exists staging.db_inventario (
    cd integer,
    endereco text,
    descricao text,
    rua text,
    coddv integer,
    estoque integer,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default now()
);

create table if not exists app.db_inventario (
    cd integer not null,
    endereco text not null,
    descricao text,
    rua text,
    coddv integer not null,
    estoque integer not null default 0 check (estoque >= 0),
    source_run_id uuid,
    updated_at timestamptz not null default now(),
    constraint uq_app_db_inventario unique (cd, endereco, coddv)
);

create table if not exists audit.rejections_db_inventario (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_app_db_inventario_cd_rua
    on app.db_inventario(cd, rua);

create index if not exists idx_app_db_inventario_cd_endereco
    on app.db_inventario(cd, endereco);

create index if not exists idx_app_db_inventario_cd_coddv
    on app.db_inventario(cd, coddv);

create index if not exists idx_staging_db_inventario_run_id
    on staging.db_inventario(run_id);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_inventario_source_run'
    ) then
        alter table app.db_inventario
            add constraint fk_app_db_inventario_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;
end;
$$;

select app.apply_runtime_security('db_inventario');
