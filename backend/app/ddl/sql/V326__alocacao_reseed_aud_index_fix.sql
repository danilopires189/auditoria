create index if not exists idx_aud_alocacao_cd_coddv_endereco_dt
    on app.aud_alocacao (cd, coddv, endereco, dt_hr desc);
