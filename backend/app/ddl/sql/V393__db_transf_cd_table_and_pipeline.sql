create table if not exists staging.db_transf_cd (
    cd_ori integer,
    cd_des integer,
    dt_nf date,
    nf_trf bigint,
    sq_nf bigint,
    coddv integer,
    descricao text,
    qtd_atend integer,
    embcomp_cx integer,
    qtd_cxpad integer,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default now()
);

create table if not exists app.db_transf_cd (
    cd_ori integer,
    cd_des integer,
    dt_nf date,
    nf_trf bigint,
    sq_nf bigint,
    coddv integer,
    descricao text,
    qtd_atend integer,
    embcomp_cx integer,
    qtd_cxpad integer,
    source_run_id uuid,
    updated_at timestamptz not null default now()
);

create table if not exists audit.rejections_db_transf_cd (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_staging_db_transf_cd_run_id
    on staging.db_transf_cd(run_id);

create index if not exists idx_app_db_transf_cd_cd_ori_dt_nf
    on app.db_transf_cd(cd_ori, dt_nf);

create index if not exists idx_app_db_transf_cd_cd_des_dt_nf
    on app.db_transf_cd(cd_des, dt_nf);

create index if not exists idx_app_db_transf_cd_coddv
    on app.db_transf_cd(coddv);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_transf_cd_source_run'
    ) then
        alter table app.db_transf_cd
            add constraint fk_app_db_transf_cd_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;
end;
$$;

select app.apply_runtime_security('db_transf_cd');
