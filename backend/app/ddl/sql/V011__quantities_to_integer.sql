alter table app.db_entrada_notas
    alter column qtd_cx type integer using case when qtd_cx is null then null else qtd_cx::integer end,
    alter column un_por_cx type integer using case when un_por_cx is null then null else un_por_cx::integer end,
    alter column qtd_total type integer using case when qtd_total is null then null else qtd_total::integer end;

alter table app.db_avulso
    alter column qtd_mov type integer using case when qtd_mov is null then null else qtd_mov::integer end;

alter table app.db_devolucao
    alter column qtd_dev type integer using case when qtd_dev is null then null else qtd_dev::integer end;

alter table app.db_pedido_direto
    alter column qtd_fat type integer using case when qtd_fat is null then null else qtd_fat::integer end;

alter table app.db_termo
    alter column qtd_separada type integer using case when qtd_separada is null then null else qtd_separada::integer end;

alter table staging.db_entrada_notas
    alter column qtd_cx type integer using case when qtd_cx is null then null else qtd_cx::integer end,
    alter column un_por_cx type integer using case when un_por_cx is null then null else un_por_cx::integer end,
    alter column qtd_total type integer using case when qtd_total is null then null else qtd_total::integer end;

alter table staging.db_avulso
    alter column qtd_mov type integer using case when qtd_mov is null then null else qtd_mov::integer end;

alter table staging.db_devolucao
    alter column qtd_dev type integer using case when qtd_dev is null then null else qtd_dev::integer end;

alter table staging.db_pedido_direto
    alter column qtd_fat type integer using case when qtd_fat is null then null else qtd_fat::integer end;

alter table staging.db_termo
    alter column qtd_separada type integer using case when qtd_separada is null then null else qtd_separada::integer end;

