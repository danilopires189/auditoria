alter table if exists app.db_avulso
    drop constraint if exists uq_app_db_avulso;

alter table if exists app.db_devolucao
    drop constraint if exists uq_app_db_devolucao;
