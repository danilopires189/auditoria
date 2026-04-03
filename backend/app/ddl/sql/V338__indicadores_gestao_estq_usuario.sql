alter table if exists staging.db_gestao_estq
    add column if not exists usuario text;

alter table if exists app.db_gestao_estq
    add column if not exists usuario text;
