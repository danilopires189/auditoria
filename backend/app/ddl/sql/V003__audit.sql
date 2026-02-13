create table if not exists audit.runs (
    run_id uuid primary key,
    started_at timestamptz not null,
    finished_at timestamptz,
    status text not null check (status in ('running', 'success', 'failed', 'partial')),
    app_version text not null,
    machine_id text not null,
    config_hash text not null,
    notes text,
    triggered_by text
);

create table if not exists audit.run_steps (
    step_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    step_name text not null check (step_name in ('refresh', 'load_staging', 'validate', 'promote', 'cleanup')),
    table_name text,
    started_at timestamptz not null,
    finished_at timestamptz,
    status text not null check (status in ('running', 'success', 'failed')),
    rows_in bigint,
    rows_out bigint,
    rows_rejected bigint,
    error_message text,
    details jsonb
);

create table if not exists audit.table_snapshots (
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    table_name text not null,
    row_count bigint not null,
    checksum text,
    captured_at timestamptz not null,
    primary key (run_id, table_name)
);

create table if not exists audit.runs_metadata (
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    table_name text not null,
    meta_key text not null,
    meta_value jsonb not null,
    created_at timestamptz not null,
    primary key (run_id, table_name, meta_key)
);

create table if not exists audit.rejections_db_entrada_notas (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists audit.rejections_db_avulso (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists audit.rejections_db_usuario (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists audit.rejections_db_barras (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists audit.rejections_db_devolucao (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists audit.rejections_db_pedido_direto (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists audit.rejections_db_termo (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_audit_run_steps_run_id on audit.run_steps(run_id);
create index if not exists idx_audit_run_steps_table_name on audit.run_steps(table_name);
create index if not exists idx_audit_runs_status on audit.runs(status);