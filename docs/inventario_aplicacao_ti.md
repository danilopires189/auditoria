# Inventario da Aplicacao

> Status do documento: snapshot tecnico gerado em 23/03/2026. O repositorio continuou recebendo migracoes e modulos depois desta data. Use este arquivo como referencia historica, nao como contrato unico de producao. Para a fonte oficial atual, consulte `backend/app/ddl/sql/`, `backend/config.yml` e os documentos em `docs/`.

## 1. Resumo executivo

Esta aplicação é uma plataforma de auditoria operacional para CDs, composta por:

- frontend web em React/Vite;
- backend local em Python para ETL/sincronização e automação;
- banco Supabase/Postgres com regras de acesso por perfil, por CD e por sessão;
- módulos operacionais para conferência, auditoria, inventário, produtividade e indicadores.

Em termos práticos, a solução:

- autentica usuários por matrícula;
- permite cadastro e redefinição de senha por validação de dados funcionais;
- controla acesso por perfil (`admin`, `auditor`, `viewer`) e por CD;
- mantém trilha de auditoria de sincronização e rejeições de carga;
- recebe bases operacionais locais em Excel/CSV e publica no banco central;
- expõe módulos web para operação diária de auditoria e conferência.

Observação importante:

- o inventário abaixo cobre as tabelas customizadas definidas no repositório;
- tabelas internas padrão do Supabase, como `auth.users`, não estão listadas porque não são criadas pelas migrações deste projeto.

## 2. O que a aplicação faz

### 2.1 Acesso e segurança

- login por matrícula;
- cadastro de usuário com validação por matrícula, data de nascimento e data de admissão;
- redefinição de senha com desafio de identidade;
- separação de acesso por perfil;
- escopo de acesso por CD;
- suporte a conta global para usuários com acesso multi-CD;
- proteção de sessão por dispositivo único;
- expiração por inatividade;
- modo de manutenção global.

### 2.2 Ingestão e sincronização de dados

- lê arquivos locais Excel/CSV;
- carrega dados em tabelas de `staging`;
- promove dados validados para tabelas de negócio em `app`;
- registra execuções, snapshots, passos e rejeições em `audit`;
- pode rodar manualmente, por automação agendada, por CLI ou por interface Tkinter;
- possui caminho alternativo de sincronização via Supabase Edge Function quando a rede bloqueia conexão Postgres direta.

### 2.3 Módulos operacionais ativos no frontend

- Atividade Extra: registro de atividades extras com pontuação e fluxo de aprovação;
- Indicadores: painéis e indicadores operacionais, incluindo dados de blitz;
- Auditoria de PVPS e Alocação: filas operacionais, auditoria de separação/pulmão, regras administrativas, prioridades e exceções;
- Busca por Produto: consulta de produto por código de barras e dados derivados das bases centrais;
- Coleta de Mercadoria: registro de coleta/auditoria de mercadoria;
- Conferência de Entrada de Notas: abertura, conferência, divergência, ocorrências e finalização de notas;
- Conferência de Pedido Direto: conferência por volume/pedido/filial/rota;
- Conferência de Termo: conferência por etiqueta, pedido, filial e rota;
- Conferência de Volume Avulso: conferência de volumes avulsos por pedido/rota;
- Controle de Validade: coleta e retirada de itens por validade, incluindo linha e pulmão;
- Devolução de Mercadoria: conferência de devoluções por NFD/chave, motivo e itens;
- Inventário (zerados): inventário por zona/endereço com contagem, revisão e seed administrativo;
- Produtividade: visão e regras de visibilidade por CD para dados de produtividade;
- Validar Endereçamento: validação de endereço/código de barras;
- Validar Etiqueta Pulmão: validação de etiqueta/código interno de pulmão.

### 2.4 Módulos cadastrados no menu, mas ainda não operacionais

- Check List;
- Meta Mês;
- Registro de Embarque.

Esses módulos existem no menu, mas hoje usam tela padrão "Em construção".

## 3. Origens de dados carregadas pelo backend

Arquivos/bases configurados atualmente:

- `DB_ENTRADA_NOTAS.xlsx`
- `BD_AVULSO.xlsx`
- `DB_USUARIO.xlsx`
- `DB_BARRAS.xlsx`
- `DB_DEVOLUCAO.xlsx`
- `DB_PEDIDO_DIRETO.xlsx`
- `BD_ROTAS.xlsx`
- `DB_TERMO.xlsx`
- `convertido/BD_END.csv`
- `convertido/DB_ESTQ_ENTR.csv`
- `convertido/DB_LOG_END.csv`
- `DB_PROD_BLITZ.xlsx`
- `DB_PROD_VOL.xlsx`

## 4. Estrutura de banco utilizada

Resumo por schema:

- `app`: 54 tabelas de negócio e operação;
- `staging`: 16 tabelas temporárias de carga;
- `audit`: 20 tabelas de execução, rejeição e rastreabilidade;
- `authz`: 5 tabelas de perfil e controle de acesso;
- `aud`: 2 tabelas operacionais de validação manual;
- `public`: 1 tabela de controle de migrações.

Total de tabelas customizadas identificadas nas migrações atuais: 98.

## 5. Inventário completo de tabelas e colunas

### 5.1 Schema `app`

- `atividade_extra`: `id`, `cd`, `user_id`, `mat`, `nome`, `data_inicio`, `hora_inicio`, `data_fim`, `hora_fim`, `duracao_segundos`, `pontos`, `descricao`, `created_at`, `updated_at`, `approval_status`
- `atividade_extra_cd_settings`: `cd`, `visibility_mode`, `updated_by`, `updated_at`
- `aud_alocacao`: `audit_id`, `queue_id`, `cd`, `zona`, `coddv`, `descricao`, `endereco`, `nivel`, `end_sit`, `val_sist`, `val_conf`, `aud_sit`, `auditor_id`, `auditor_mat`, `auditor_nome`, `dt_hr`, `updated_at`
- `aud_coleta`: `id`, `etiqueta`, `cd`, `barras`, `coddv`, `descricao`, `qtd`, `ocorrencia`, `lote`, `val_mmaa`, `mat_aud`, `nome_aud`, `user_id`, `data_hr`, `created_at`, `updated_at`
- `aud_pvps`: `audit_id`, `cd`, `zona`, `coddv`, `descricao`, `end_sep`, `end_sit`, `val_sep`, `auditor_id`, `auditor_mat`, `auditor_nome`, `status`, `dt_hr`, `updated_at`
- `aud_pvps_pul`: `audit_pul_id`, `audit_id`, `end_pul`, `val_pul`, `dt_hr`, `updated_at`, `end_sit`
- `conf_devolucao`: `conf_id`, `conf_date`, `cd`, `conference_kind`, `nfd`, `chave`, `source_motivo`, `nfo`, `motivo_sem_nfd`, `status`, `falta_motivo`, `started_by`, `started_mat`, `started_nome`, `started_at`, `finalized_at`, `updated_at`
- `conf_devolucao_itens`: `item_id`, `conf_id`, `coddv`, `barras`, `descricao`, `tipo`, `qtd_esperada`, `qtd_conferida`, `qtd_manual_total`, `updated_at`, `lotes`
- `conf_entrada_notas`: `conf_id`, `conf_date`, `cd`, `seq_entrada`, `nf`, `transportadora`, `fornecedor`, `started_by`, `started_mat`, `started_nome`, `status`, `started_at`, `finalized_at`, `updated_at`
- `conf_entrada_notas_colaboradores`: `conf_id`, `user_id`, `mat`, `nome`, `first_action_at`, `last_action_at`
- `conf_entrada_notas_itens`: `item_id`, `conf_id`, `seq_entrada`, `nf`, `coddv`, `barras`, `descricao`, `qtd_esperada`, `qtd_conferida`, `updated_at`, `locked_by`, `locked_mat`, `locked_nome`
- `conf_entrada_notas_itens_conferidos`: `conf_id`, `item_id`, `seq_entrada`, `nf`, `coddv`, `barras`, `descricao`, `qtd_conferida`, `divergencia_tipo`, `updated_at`
- `conf_entrada_notas_ocorrencias`: `ocorrencia_id`, `conf_id`, `item_id`, `coddv`, `tipo`, `qtd`, `updated_by`, `created_at`, `updated_at`
- `conf_inventario_admin_seed_config`: `cd`, `zonas`, `estoque_ini`, `estoque_fim`, `incluir_pul`, `manual_coddv`, `updated_by`, `updated_at`
- `conf_inventario_counts`: `count_id`, `cycle_date`, `cd`, `zona`, `endereco`, `coddv`, `descricao`, `estoque`, `etapa`, `qtd_contada`, `barras`, `resultado`, `counted_by`, `counted_mat`, `counted_nome`, `client_event_id`, `created_at`, `updated_at`
- `conf_inventario_event_log`: `client_event_id`, `user_id`, `event_type`, `payload`, `status`, `info`, `processed_at`
- `conf_inventario_reviews`: `review_id`, `cycle_date`, `cd`, `zona`, `endereco`, `coddv`, `descricao`, `estoque`, `reason_code`, `snapshot`, `status`, `final_qtd`, `final_barras`, `final_resultado`, `resolved_by`, `resolved_mat`, `resolved_nome`, `resolved_at`, `created_at`, `updated_at`
- `conf_inventario_zone_locks`: `lock_id`, `cycle_date`, `cd`, `zona`, `etapa`, `locked_by`, `locked_mat`, `locked_nome`, `heartbeat_at`, `expires_at`, `created_at`, `updated_at`
- `conf_pedido_direto`: `conf_id`, `conf_date`, `cd`, `id_vol`, `caixa`, `pedido`, `filial`, `filial_nome`, `rota`, `started_by`, `started_mat`, `started_nome`, `status`, `falta_motivo`, `started_at`, `finalized_at`, `updated_at`, `sq`
- `conf_pedido_direto_itens`: `item_id`, `conf_id`, `coddv`, `descricao`, `qtd_esperada`, `qtd_conferida`, `updated_at`, `barras`, `id_vol`
- `conf_termo`: `conf_id`, `conf_date`, `cd`, `id_etiqueta`, `caixa`, `pedido`, `filial`, `filial_nome`, `rota`, `started_by`, `started_mat`, `started_nome`, `status`, `falta_motivo`, `started_at`, `finalized_at`, `updated_at`
- `conf_termo_itens`: `item_id`, `conf_id`, `coddv`, `descricao`, `qtd_esperada`, `qtd_conferida`, `updated_at`, `barras`, `id_etiqueta`
- `conf_volume_avulso`: `conf_id`, `conf_date`, `cd`, `nr_volume`, `caixa`, `pedido`, `filial`, `filial_nome`, `rota`, `started_by`, `started_mat`, `started_nome`, `status`, `falta_motivo`, `started_at`, `finalized_at`, `updated_at`
- `conf_volume_avulso_itens`: `item_id`, `conf_id`, `nr_volume`, `coddv`, `barras`, `descricao`, `qtd_esperada`, `qtd_conferida`, `updated_at`
- `ctrl_validade_linha_coletas`: `id`, `client_event_id`, `cd`, `barras`, `coddv`, `descricao`, `endereco_sep`, `val_mmaa`, `qtd`, `data_coleta`, `auditor_id`, `auditor_mat`, `auditor_nome`, `created_at`, `updated_at`
- `ctrl_validade_linha_retiradas`: `id`, `client_event_id`, `cd`, `coddv`, `descricao`, `endereco_sep`, `val_mmaa`, `ref_coleta_mes`, `qtd_retirada`, `data_retirada`, `auditor_id`, `auditor_mat`, `auditor_nome`, `created_at`, `updated_at`
- `ctrl_validade_pul_retiradas`: `id`, `client_event_id`, `cd`, `coddv`, `descricao`, `endereco_pul`, `val_mmaa`, `qtd_retirada`, `data_retirada`, `auditor_id`, `auditor_mat`, `auditor_nome`, `created_at`, `updated_at`
- `db_alocacao`: `queue_id`, `cd`, `zona`, `coddv`, `descricao`, `endereco`, `nivel`, `val_sist`, `qtd_est_disp`, `dat_ult_compra`, `is_pending`, `source_run_id`, `created_at`, `updated_at`, `is_window_active`
- `db_avulso`: `cd`, `id_mov`, `nr_volume`, `dt_mov`, `coddv`, `descricao`, `lote`, `val`, `qtd_mov`, `source_run_id`, `updated_at`
- `db_barras`: `coddv`, `descricao`, `barras`, `source_run_id`, `updated_at`
- `db_conf_blitz`: `cd`, `filial`, `pedido`, `seq`, `tt_un`, `conferente`, `dt_conf`, `tt_vol`, `qtd_avaria`, `qtd_vencido`, `qtd_falta`, `qtd_sobra`, `source_run_id`, `updated_at`
- `db_devolucao`: `cd`, `motivo`, `nfd`, `coddv`, `descricao`, `tipo`, `qtd_dev`, `dt_gera`, `chave`, `geracao`, `source_run_id`, `updated_at`
- `db_div_blitz`: `cd`, `pedido`, `seq`, `filial`, `coddv`, `descricao`, `qtd_nfo`, `conf`, `vl_div`, `conferente`, `data_conf`, `qtd_venc`, `caixa`, `endereco`, `zona`, `source_run_id`, `updated_at`
- `db_end`: `cd`, `coddv`, `descricao`, `endereco`, `andar`, `validade`, `tipo`, `source_run_id`, `updated_at`
- `db_entrada_notas`: `cd`, `transportadora`, `forn`, `seq_entrada`, `nf`, `coddv`, `descricao`, `qtd_cx`, `un_por_cx`, `qtd_total`, `vl_tt`, `source_run_id`, `updated_at`
- `db_estq_entr`: `cd`, `coddv`, `qtd_est_atual`, `qtd_est_disp`, `dat_ult_compra`, `source_run_id`, `updated_at`
- `db_inventario`: `cd`, `endereco`, `descricao`, `rua`, `coddv`, `estoque`, `source_run_id`, `updated_at`, `base_updated_by`
- `db_log_end`: `cd`, `coddv`, `endereco`, `exclusao`, `source_run_id`, `updated_at`
- `db_pedido_direto`: `cd`, `pedido`, `sq`, `filial`, `dt_pedido`, `coddv`, `descricao`, `qtd_fat`, `source_run_id`, `updated_at`, `pedidoseq`
- `db_prod_blitz`: `cd`, `filial`, `nr_pedido`, `dt_conf`, `auditor`, `qtd_un`, `source_run_id`, `updated_at`
- `db_prod_vol`: `cd`, `aud`, `vol_conf`, `source_run_id`, `updated_at`
- `db_pvps`: `queue_id`, `cd`, `zona`, `coddv`, `descricao`, `end_sep`, `end_pul`, `qtd_est_disp`, `dat_ult_compra`, `is_pending`, `source_run_id`, `created_at`, `updated_at`, `is_window_active`
- `db_rotas`: `cd`, `filial`, `uf`, `nome`, `rota`, `source_run_id`, `updated_at`
- `db_termo`: `pedido`, `cd`, `filial`, `coddv`, `descricao`, `caixa`, `qtd_separada`, `num_rota`, `id_etiqueta`, `source_run_id`, `updated_at`
- `db_usuario`: `cd`, `mat`, `nome`, `dt_nasc`, `dt_adm`, `cargo`, `cd_nome`, `source_run_id`, `updated_at`
- `produtividade_cd_settings`: `cd`, `visibility_mode`, `updated_by`, `updated_at`
- `pvps_admin_rule_grace`: `grace_id`, `rule_id`, `modulo`, `item_key`, `created_at`
- `pvps_admin_rule_history`: `history_id`, `rule_id`, `cd`, `modulo`, `rule_kind`, `target_type`, `target_value`, `priority_value`, `action_type`, `apply_mode`, `affected_pvps`, `affected_alocacao`, `actor_user_id`, `details_json`, `created_at`
- `pvps_admin_rules`: `rule_id`, `cd`, `modulo`, `rule_kind`, `target_type`, `target_value`, `priority_value`, `active`, `created_by`, `created_at`, `removed_by`, `removed_at`
- `pvps_alocacao_blacklist`: `blacklist_id`, `cd`, `modulo`, `zona`, `coddv`, `created_at`, `created_by`
- `pvps_alocacao_offline_discard`: `discard_id`, `created_at`, `cd`, `modulo`, `event_kind`, `local_event_id`, `local_event_created_at`, `local_payload`, `local_user_id`, `local_user_mat`, `local_user_nome`, `coddv`, `zona`, `end_sep`, `end_pul`, `queue_id`, `conflict_reason`, `existing_audit_id`, `existing_auditor_id`, `existing_auditor_mat`, `existing_auditor_nome`, `existing_audit_dt_hr`, `existing_status`, `details_json`
- `pvps_alocacao_priority_zones`: `priority_id`, `cd`, `modulo`, `zona`, `prioridade`, `created_at`, `updated_at`
- `pvps_alocacao_replenish_state`: `cd`, `modulo`, `last_run_at`, `pending_before`, `reason`, `updated_at`
- `runtime_settings`: `id`, `maintenance_mode`, `updated_at`, `updated_by`

### 5.2 Schema `aud`

- `endereco`: `id`, `data_hr`, `user_id`, `usuario`, `cd`, `barra`, `coddv`, `descricao`, `end_infor`, `end_corret`, `validado`, `created_at`
- `etiqueta_pulmao`: `id`, `data_hr`, `user_id`, `usuario`, `cd`, `codigo_interno`, `barra`, `coddv_resolvido`, `descricao`, `validado`, `created_at`

### 5.3 Schema `audit`

- `rejections_db_avulso`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_barras`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_conf_blitz`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_devolucao`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_div_blitz`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_end`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_entrada_notas`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_estq_entr`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_inventario`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_log_end`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_pedido_direto`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_prod_blitz`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_prod_vol`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_rotas`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_termo`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `rejections_db_usuario`: `rejection_id`, `run_id`, `source_row_number`, `reason_code`, `reason_detail`, `payload`, `created_at`
- `run_steps`: `step_id`, `run_id`, `step_name`, `table_name`, `started_at`, `finished_at`, `status`, `rows_in`, `rows_out`, `rows_rejected`, `error_message`, `details`
- `runs`: `run_id`, `started_at`, `finished_at`, `status`, `app_version`, `machine_id`, `config_hash`, `notes`, `triggered_by`
- `runs_metadata`: `run_id`, `table_name`, `meta_key`, `meta_value`, `created_at`
- `table_snapshots`: `run_id`, `table_name`, `row_count`, `checksum`, `captured_at`

### 5.4 Schema `authz`

- `active_login_sessions`: `user_id`, `device_id`, `claimed_at`, `last_activity_at`, `updated_at`
- `global_login_accounts`: `login_email`, `mat`, `nome`, `active`, `created_at`
- `identity_challenges`: `challenge_id`, `purpose`, `mat`, `dt_nasc`, `dt_adm`, `nome`, `cargo`, `role_suggested`, `cd_default`, `cds`, `expires_at`, `consumed_at`, `created_at`, `created_by`, `created_ip`
- `profiles`: `user_id`, `nome`, `mat`, `role`, `cd_default`, `created_at`, `home_menu_view`
- `user_deposits`: `user_id`, `cd`, `created_at`

### 5.5 Schema `public`

- `schema_migrations`: `version`, `filename`, `checksum`, `applied_at`

### 5.6 Schema `staging`

- `db_avulso`: `cd`, `id_mov`, `nr_volume`, `dt_mov`, `coddv`, `descricao`, `lote`, `val`, `qtd_mov`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_barras`: `coddv`, `descricao`, `barras`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_conf_blitz`: `cd`, `filial`, `pedido`, `seq`, `tt_un`, `conferente`, `dt_conf`, `tt_vol`, `qtd_avaria`, `qtd_vencido`, `qtd_falta`, `qtd_sobra`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_devolucao`: `cd`, `motivo`, `nfd`, `coddv`, `descricao`, `tipo`, `qtd_dev`, `dt_gera`, `chave`, `geracao`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_div_blitz`: `cd`, `pedido`, `seq`, `filial`, `coddv`, `descricao`, `qtd_nfo`, `conf`, `vl_div`, `conferente`, `data_conf`, `qtd_venc`, `caixa`, `endereco`, `zona`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_end`: `cd`, `coddv`, `descricao`, `endereco`, `andar`, `validade`, `tipo`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_entrada_notas`: `cd`, `transportadora`, `forn`, `seq_entrada`, `nf`, `coddv`, `descricao`, `qtd_cx`, `un_por_cx`, `qtd_total`, `vl_tt`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_estq_entr`: `cd`, `coddv`, `qtd_est_atual`, `qtd_est_disp`, `dat_ult_compra`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_inventario`: `cd`, `endereco`, `descricao`, `rua`, `coddv`, `estoque`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_log_end`: `cd`, `coddv`, `endereco`, `exclusao`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_pedido_direto`: `cd`, `pedido`, `sq`, `filial`, `dt_pedido`, `coddv`, `descricao`, `qtd_fat`, `run_id`, `source_file`, `source_row_number`, `ingested_at`, `pedidoseq`
- `db_prod_blitz`: `cd`, `filial`, `nr_pedido`, `dt_conf`, `auditor`, `qtd_un`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_prod_vol`: `cd`, `aud`, `vol_conf`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_rotas`: `cd`, `filial`, `uf`, `nome`, `rota`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_termo`: `pedido`, `cd`, `filial`, `coddv`, `descricao`, `caixa`, `qtd_separada`, `num_rota`, `id_etiqueta`, `run_id`, `source_file`, `source_row_number`, `ingested_at`
- `db_usuario`: `cd`, `mat`, `nome`, `dt_nasc`, `dt_adm`, `cargo`, `cd_nome`, `run_id`, `source_file`, `source_row_number`, `ingested_at`

## 6. Resumo


"A aplicação Auditoria é uma plataforma web com backend de sincronização local que centraliza rotinas de auditoria operacional dos CDs. Ela utiliza frontend React/Vite, autenticação Supabase por matrícula e banco PostgreSQL/Supabase com controle de acesso por perfil e por CD. Os módulos ativos cobrem conferência de entrada de notas, pedido direto, termo, volume avulso, devolução, inventário zerados, auditoria de PVPS e alocação, coleta de mercadoria, controle de validade, indicadores, produtividade, atividade extra, busca por produto, validação de endereçamento e validação de etiqueta pulmão. O backend também executa ETL de arquivos Excel/CSV para tabelas de staging, promoção para tabelas de negócio e trilha de auditoria das cargas. O inventário atual do banco customizado contém 98 tabelas distribuídas entre os schemas `app`, `staging`, `audit`, `authz`, `aud` e `public`, conforme detalhado neste documento." 
