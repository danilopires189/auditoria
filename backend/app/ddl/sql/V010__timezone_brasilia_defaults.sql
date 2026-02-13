alter table public.schema_migrations
    alter column applied_at set default now();

alter table authz.profiles
    alter column created_at set default now();

alter table authz.user_deposits
    alter column created_at set default now();

alter table app.db_entrada_notas
    alter column updated_at set default now();
alter table app.db_avulso
    alter column updated_at set default now();
alter table app.db_usuario
    alter column updated_at set default now();
alter table app.db_barras
    alter column updated_at set default now();
alter table app.db_devolucao
    alter column updated_at set default now();
alter table app.db_pedido_direto
    alter column updated_at set default now();
alter table app.db_termo
    alter column updated_at set default now();

alter table staging.db_entrada_notas
    alter column ingested_at set default now();
alter table staging.db_avulso
    alter column ingested_at set default now();
alter table staging.db_usuario
    alter column ingested_at set default now();
alter table staging.db_barras
    alter column ingested_at set default now();
alter table staging.db_devolucao
    alter column ingested_at set default now();
alter table staging.db_pedido_direto
    alter column ingested_at set default now();
alter table staging.db_termo
    alter column ingested_at set default now();

alter table audit.rejections_db_entrada_notas
    alter column created_at set default now();
alter table audit.rejections_db_avulso
    alter column created_at set default now();
alter table audit.rejections_db_usuario
    alter column created_at set default now();
alter table audit.rejections_db_barras
    alter column created_at set default now();
alter table audit.rejections_db_devolucao
    alter column created_at set default now();
alter table audit.rejections_db_pedido_direto
    alter column created_at set default now();
alter table audit.rejections_db_termo
    alter column created_at set default now();

do $$
begin
    execute 'alter database postgres set timezone to ''America/Sao_Paulo''';
exception
    when insufficient_privilege then
        null;
end
$$;

