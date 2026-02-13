create index if not exists idx_app_db_entrada_notas_cd on app.db_entrada_notas(cd);
create index if not exists idx_app_db_avulso_cd on app.db_avulso(cd);
create index if not exists idx_app_db_usuario_cd on app.db_usuario(cd);
create index if not exists idx_app_db_devolucao_cd on app.db_devolucao(cd);
create index if not exists idx_app_db_pedido_direto_cd on app.db_pedido_direto(cd);
create index if not exists idx_app_db_termo_cd on app.db_termo(cd);

create index if not exists idx_staging_db_entrada_notas_run_id on staging.db_entrada_notas(run_id);
create index if not exists idx_staging_db_avulso_run_id on staging.db_avulso(run_id);
create index if not exists idx_staging_db_usuario_run_id on staging.db_usuario(run_id);
create index if not exists idx_staging_db_barras_run_id on staging.db_barras(run_id);
create index if not exists idx_staging_db_devolucao_run_id on staging.db_devolucao(run_id);
create index if not exists idx_staging_db_pedido_direto_run_id on staging.db_pedido_direto(run_id);
create index if not exists idx_staging_db_termo_run_id on staging.db_termo(run_id);