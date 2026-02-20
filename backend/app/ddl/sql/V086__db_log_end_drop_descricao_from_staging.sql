alter table if exists staging.db_log_end
    drop column if exists descricao;

alter table if exists app.db_log_end
    drop column if exists descricao;
