alter table if exists app.db_entrada_notas
    add column if not exists dh_consistida timestamptz,
    add column if not exists dh_liberacao timestamptz;

alter table if exists staging.db_entrada_notas
    add column if not exists dh_consistida timestamptz,
    add column if not exists dh_liberacao timestamptz;

create table if not exists staging.db_atendimento (
    cd integer,
    pedido bigint,
    origem text,
    coddv integer,
    descricao text,
    ocorrencia timestamptz,
    caixa text,
    filial bigint,
    qtd_caixa integer,
    qtd_acertada integer,
    dif integer,
    estoque integer,
    mat text,
    endereco text,
    descricao_zona text,
    rua text,
    dat_ult_compra date,
    qtd_ult_compra integer,
    emb_exp integer,
    run_id uuid not null,
    source_file text,
    source_row_number bigint,
    ingested_at timestamptz not null default now()
);

create table if not exists app.db_atendimento (
    cd integer,
    pedido bigint,
    origem text,
    coddv integer,
    descricao text,
    ocorrencia timestamptz,
    caixa text,
    filial bigint,
    qtd_caixa integer,
    qtd_acertada integer,
    dif integer,
    estoque integer,
    mat text,
    endereco text,
    descricao_zona text,
    rua text,
    dat_ult_compra date,
    qtd_ult_compra integer,
    emb_exp integer,
    source_run_id uuid,
    updated_at timestamptz not null default now()
);

create table if not exists audit.rejections_db_atendimento (
    rejection_id bigserial primary key,
    run_id uuid not null references audit.runs(run_id) on delete cascade,
    source_row_number bigint,
    reason_code text not null,
    reason_detail text,
    payload jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_app_db_atendimento_cd
    on app.db_atendimento(cd);

create index if not exists idx_app_db_atendimento_cd_pedido
    on app.db_atendimento(cd, pedido);

create index if not exists idx_app_db_atendimento_cd_coddv
    on app.db_atendimento(cd, coddv);

create index if not exists idx_staging_db_atendimento_run_id
    on staging.db_atendimento(run_id);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_app_db_atendimento_source_run'
    ) then
        alter table app.db_atendimento
            add constraint fk_app_db_atendimento_source_run
            foreign key (source_run_id) references audit.runs(run_id) on delete set null;
    end if;
end;
$$;

select app.apply_runtime_security('db_atendimento');
