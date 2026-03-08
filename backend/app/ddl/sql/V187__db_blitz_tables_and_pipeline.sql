create table if not exists staging.db_conf_blitz (
    cd integer,
    filial integer,
    pedido bigint,
    seq integer,
    tt_un integer,
    conferente text,
    dt_conf date,
    tt_vol integer,
    qtd_avaria integer,
    qtd_vencido integer,
    qtd_falta integer,
    qtd_sobra integer,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default now()
);

create table if not exists app.db_conf_blitz (
    cd integer,
    filial integer,
    pedido bigint,
    seq integer,
    tt_un integer,
    conferente text,
    dt_conf date,
    tt_vol integer,
    qtd_avaria integer,
    qtd_vencido integer,
    qtd_falta integer,
    qtd_sobra integer,
    source_run_id uuid,
    updated_at timestamptz not null default now(),
    constraint uq_app_db_conf_blitz unique (cd, filial, pedido, seq)
);

create table if not exists audit.rejections_db_conf_blitz (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default now()
);

create table if not exists staging.db_div_blitz (
    cd integer,
    pedido bigint,
    seq integer,
    filial integer,
    coddv integer,
    descricao text,
    qtd_nfo integer,
    conf text,
    vl_div numeric,
    conferente text,
    data_conf date,
    qtd_venc integer,
    caixa text,
    endereco text,
    zona text,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default now()
);

create table if not exists app.db_div_blitz (
    cd integer,
    pedido bigint,
    seq integer,
    filial integer,
    coddv integer,
    descricao text,
    qtd_nfo integer,
    conf text,
    vl_div numeric,
    conferente text,
    data_conf date,
    qtd_venc integer,
    caixa text,
    endereco text,
    zona text,
    source_run_id uuid,
    updated_at timestamptz not null default now(),
    constraint uq_app_db_div_blitz unique (cd, pedido, seq, filial, coddv)
);

create table if not exists audit.rejections_db_div_blitz (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_app_db_conf_blitz_cd
    on app.db_conf_blitz(cd);

create index if not exists idx_app_db_div_blitz_cd
    on app.db_div_blitz(cd);

create index if not exists idx_staging_db_conf_blitz_run_id
    on staging.db_conf_blitz(run_id);

create index if not exists idx_staging_db_div_blitz_run_id
    on staging.db_div_blitz(run_id);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_conf_blitz_source_run'
    ) then
        alter table app.db_conf_blitz
            add constraint fk_app_db_conf_blitz_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_div_blitz_source_run'
    ) then
        alter table app.db_div_blitz
            add constraint fk_app_db_div_blitz_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;
end;
$$;

select app.apply_runtime_security('db_conf_blitz');
select app.apply_runtime_security('db_div_blitz');
