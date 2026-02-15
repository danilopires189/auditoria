create table if not exists staging.db_rotas (
    cd integer,
    filial bigint,
    uf text,
    nome text,
    rota text,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default now()
);

create table if not exists app.db_rotas (
    cd integer,
    filial bigint,
    uf text,
    nome text,
    rota text,
    source_run_id uuid,
    updated_at timestamptz not null default now(),
    constraint uq_app_db_rotas unique (cd, filial)
);

create table if not exists audit.rejections_db_rotas (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_app_db_rotas_cd on app.db_rotas(cd);
create index if not exists idx_staging_db_rotas_run_id on staging.db_rotas(run_id);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_rotas_source_run'
    ) then
        alter table app.db_rotas
            add constraint fk_app_db_rotas_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;
end;
$$;

select app.apply_runtime_security('db_rotas');
