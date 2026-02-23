-- Post-deploy operational script (run in Supabase SQL editor).
-- Important: run statements directly (no explicit transaction block).

-- 1) Support indexes for high-read paths in PVPS/Alocacao/Inventario.
create index concurrently if not exists idx_app_db_end_cd_coddv_tipo_norm
    on app.db_end (
        cd,
        coddv,
        (upper(trim(coalesce(tipo, ''))))
    );

create index concurrently if not exists idx_app_db_end_sep_cd_coddv_endereco_norm
    on app.db_end (
        cd,
        coddv,
        (upper(trim(coalesce(endereco, ''))))
    )
    where upper(trim(coalesce(tipo, ''))) = 'SEP'
      and nullif(trim(coalesce(endereco, '')), '') is not null;

create index concurrently if not exists idx_app_db_end_pul_cd_coddv_endereco_norm
    on app.db_end (
        cd,
        coddv,
        (upper(trim(coalesce(endereco, ''))))
    )
    where upper(trim(coalesce(tipo, ''))) = 'PUL'
      and nullif(trim(coalesce(endereco, '')), '') is not null;

create index concurrently if not exists idx_app_db_estq_entr_cd_dat_ult_compra_coddv_hot
    on app.db_estq_entr (cd, dat_ult_compra desc, coddv)
    where dat_ult_compra is not null
      and coalesce(qtd_est_disp, 0) > 100;

create index concurrently if not exists idx_app_db_estq_entr_cd_coddv_updated_at_desc
    on app.db_estq_entr (cd, coddv, updated_at desc);

create index concurrently if not exists idx_app_db_inventario_cd_zone_norm_endereco_coddv
    on app.db_inventario (
        cd,
        app.conf_inventario_normalize_zone(rua, endereco),
        endereco,
        coddv
    );

-- 2) Online maintenance after deployment.
vacuum (analyze) staging.db_end;
vacuum (analyze) staging.db_estq_entr;
vacuum (analyze) app.db_end;
vacuum (analyze) app.db_estq_entr;
vacuum (analyze) app.db_inventario;
vacuum (analyze) app.db_pvps;
vacuum (analyze) app.db_alocacao;

-- 3) Optional: run only when bloat indicators justify it.
-- reindex index concurrently app.idx_app_db_end_sep_cd_coddv_endereco_norm;
-- reindex index concurrently app.idx_app_db_end_pul_cd_coddv_endereco_norm;
-- reindex index concurrently app.idx_app_db_estq_entr_cd_dat_ult_compra_coddv_hot;
-- reindex index concurrently app.idx_app_db_inventario_cd_zone_norm_endereco_coddv;
