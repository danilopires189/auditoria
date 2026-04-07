# Resumo da Aplicacao Auditoria

> Status do documento: snapshot executivo gerado em 23/03/2026. O projeto continuou evoluindo depois desta data. Para setup, deploy e operacao atual use primeiro `README.md`, `docs/arquitetura.md`, `docs/setup-e-deploy.md` e `docs/runbook-operacional.md`. Para schema e contratos atuais, a fonte oficial e o codigo em `backend/app/ddl/sql/`, `backend/config.yml` e `frontend/src/modules/registry.ts`.

## 1. O que a aplicação faz

A solução é composta por duas partes:

- Um backend local em Windows que lê arquivos Excel/CSV operacionais, valida os dados, carrega em tabelas de staging, promove para tabelas finais no Supabase Postgres, registra auditoria de execução e pode rodar manualmente, via GUI ou via tarefa agendada do Windows.
- Um frontend web em React que autentica usuários por matrícula, aplica controle de acesso por CD e perfil, trabalha com módulos operacionais de auditoria/conferência e, em vários casos, permite operação offline com sincronização posterior.

## 2. Fluxos principais da solução

### Backend local

O backend:

- Executa `bootstrap` para criar/atualizar estrutura SQL, funções de segurança, RLS e objetos auxiliares.
- Executa `healthcheck` para validar conectividade com Supabase por PostgreSQL direto ou por Edge Function HTTPS.
- Executa `refresh` para atualizar planilhas Excel que dependem de conexão/consulta externa.
- Executa `validate` para validar estrutura e conteúdo antes da promoção.
- Executa `sync` para carregar os arquivos para o banco.
- Executa `dry-run` para validar sem promover.
- Executa `automation-cycle` para rodar em política agendada, inclusive reprocessando tabelas com falha.
- Instala/remove/consulta/dispara uma tarefa do Windows Scheduler.
- Pode abrir uma GUI Tkinter para operação manual.

### Frontend web

O frontend:

- Faz login por matrícula + senha.
- Permite cadastro por matrícula, data de nascimento e data de admissão.
- Permite redefinição de senha pelo mesmo fluxo de validação.
- Trabalha com perfil por usuário e escopo de CD.
- Permite contexto global para administradores com acesso a todos os CDs.
- Pode entrar em modo de manutenção.
- Mantém sessão persistida e possui proteção contra sessão inativa / dispositivo concorrente.

## 3. Módulos funcionais publicados

### Módulos implementados

- `Atividade Extra`: lançamento, edição, exclusão e aprovação de atividades extras com pontuação.
- `Indicadores`: indicadores de Blitz com séries, resumo diário, totais por zona e detalhamento.
- `Auditoria de PVPS e Alocação`: operação online/offline, fila operacional, regras administrativas, auditoria de separação/pulmão/alocação e exportação de relatórios.
- `Busca por Produto`: consulta de produto por código de barras / código interno, incluindo lista de barras.
- `Coleta de Mercadoria`: coleta com leitura de barras, ocorrências e relatório.
- `Conferência de Entrada de Notas`: abertura de conferência por volume/lote, leitura de barras, divergências, colaboradores, cancelamento e finalização.
- `Conferência de Pedido Direto`: abertura por volume, leitura de barras, divergências, visão por rota/filial, cancelamento e finalização.
- `Conferência de Termo`: abertura por etiqueta, leitura de barras, divergências, visão por rota/filial, cancelamento e finalização.
- `Conferência de Volume Avulso`: abertura por volume, leitura de barras, divergências, visão por rota, cancelamento e finalização.
- `Controle de Validade`: coleta e retirada por linha/pulmão, lookup de produto e registros operacionais.
- `Devolução de Mercadoria`: abertura por NFD/chave, leitura de barras, conferência com ou sem NFD, lotes/validades, cancelamento e finalização.
- `Inventário (zerados)`: conferência por zona/endereço, trava operacional, revisão, seed administrativo, inclusão manual de produtos e relatórios.
- `Produtividade`: ranking, totais por colaborador, visibilidade por CD e consolidação de produção.
- `Validar Endereçamento`: valida se o endereço informado bate com o cadastro do produto.
- `Validar Etiqueta Pulmão`: valida se a etiqueta/código interno aponta para o produto correto.

### Módulos publicados como placeholder

- `Check List`
- `Meta Mês`
- `Registro de Embarque`

Hoje esses 3 módulos existem no menu, mas a tela é somente “Em construção. Volte depois.”

## 4. Capacidades operacionais relevantes

- Operação offline em vários módulos usando `IndexedDB` e `localStorage`.
- Sincronização posterior de pendências locais quando a conexão volta.
- Cache local de `db_barras` e, em alguns módulos, também de `db_end` e bases operacionais.
- Scanner por câmera no navegador com `BarcodeDetector` nativo ou fallback `@zxing/browser`.
- Exportação de relatórios em PDF e Excel em pelo menos o módulo de PVPS/Alocação.
- Deploy web preparado para Vercel.
- Sync local empacotável em `.exe` com PyInstaller.

## 5. Tecnologias usadas

### Frontend

- React 18
- TypeScript
- Vite
- React Router DOM
- Supabase JS
- `@zxing/browser` para leitura por câmera
- `xlsx` para exportação Excel
- `jspdf` e `jspdf-autotable` para PDF
- `IndexedDB` e `localStorage` para modo offline

### Backend local

- Python 3.11+
- Typer (CLI)
- Tkinter (GUI)
- Pandas
- OpenPyXL
- SQLAlchemy
- Psycopg2
- Pydantic
- Python Dotenv
- Loguru
- PyYAML
- PyInstaller
- `xlwings` e `pywin32` opcionalmente para refresh de Excel
- Windows Task Scheduler (`schtasks`)

### Banco e plataforma

- Supabase Postgres
- Supabase Auth
- RPCs SQL no banco
- RLS (Row Level Security)
- Edge Function TypeScript para ingestão via HTTPS
- Vercel para hospedagem do frontend

## 6. Fontes de dados carregadas pelo backend

Arquivos operacionais carregados para o Supabase:

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

## 7. Acessos que a TI precisa liberar

### Para o frontend web

- HTTPS para o domínio onde o frontend estiver publicado.
- HTTPS para o projeto Supabase configurado em `VITE_SUPABASE_URL`.
- Se houver política restritiva por domínio, liberar também autenticação e RPCs do mesmo projeto Supabase.
- Permissão de câmera no navegador para módulos com scanner.
- Permissão para `IndexedDB` e `localStorage` no navegador, senão o modo offline não funciona.

### Para o backend local

- Saída TCP para o banco Supabase:
  - `db.<project-ref>.supabase.co:5432`
  - opcionalmente `:6543` se for adotado pooler
- Se a rede não puder liberar PostgreSQL direto, liberar HTTPS para a Edge Function:
  - `https://<project-ref>.functions.supabase.co/sync_ingest`
- Liberação de execução do `sync_backend.exe` ou do Python local.
- Liberação do `schtasks` para criação/execução da tarefa agendada `AUDITORIA_SYNC_AUTO`.
- Permissão de leitura/escrita na pasta local da aplicação:
  - `data\`
  - `logs\`
  - `logs\rejections\`
- Se o fluxo usar refresh de Excel:
  - Microsoft Excel instalado
  - permissões de automação COM / Office
  - suporte a `pywin32` ou `xlwings`

### Credenciais e variáveis necessárias

- `SUPABASE_DB_HOST`
- `SUPABASE_DB_PORT`
- `SUPABASE_DB_NAME`
- `SUPABASE_DB_USER`
- `SUPABASE_DB_PASSWORD`
- `SYNC_TRANSPORT`
- `EDGE_FUNCTION_URL` quando usar transporte HTTPS
- `EDGE_FUNCTION_BEARER_TOKEN` quando usar Edge Function
- `EDGE_FUNCTION_SHARED_SECRET` quando usar Edge Function
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 8. Observações de segurança e operação

- O frontend depende de RLS e RPCs do banco para controle de acesso.
- Existe separação por perfil e por CD.
- Há fluxo de administrador global com troca de CD no frontend.
- Há modo de manutenção global.
- Há controle de sessão por dispositivo e proteção por inatividade.
- O backend registra execuções, rejeições por tabela e metadados de carga.

## 9. Inventário de tabelas e colunas

## 9.1. Autenticação, perfil e sessão

### `profiles`

- `user_id`
- `nome`
- `mat`
- `role`
- `cd_default`
- `created_at`
- `home_menu_view`

### `user_deposits`

- `user_id`
- `cd`
- `created_at`

### `global_login_accounts`

- `login_email`
- `mat`
- `nome`
- `active`
- `created_at`

### `identity_challenges`

- `challenge_id`
- `purpose`
- `mat`
- `dt_nasc`
- `dt_adm`
- `nome`
- `cargo`
- `role_suggested`
- `cd_default`
- `cds`
- `expires_at`
- `consumed_at`
- `created_at`
- `created_by`
- `created_ip`

### `active_login_sessions`

- `user_id`
- `device_id`
- `claimed_at`
- `last_activity_at`
- `updated_at`

### `runtime_settings`

- `id`
- `maintenance_mode`
- `updated_at`
- `updated_by`

## 9.2. Tabelas de controle de migração e auditoria do ETL

### `schema_migrations`

- `version`
- `filename`
- `checksum`
- `applied_at`

### `runs`

- `run_id`
- `started_at`
- `finished_at`
- `status`
- `app_version`
- `machine_id`
- `config_hash`
- `notes`
- `triggered_by`

### `run_steps`

- `step_id`
- `run_id`
- `step_name`
- `table_name`
- `started_at`
- `finished_at`
- `status`
- `rows_in`
- `rows_out`
- `rows_rejected`
- `error_message`
- `details`

### `runs_metadata`

- `run_id`
- `table_name`
- `meta_key`
- `meta_value`
- `created_at`

### `table_snapshots`

- `run_id`
- `table_name`
- `row_count`
- `checksum`
- `captured_at`

## 9.3. Tabelas de origem sincronizadas pelo backend

### `db_entrada_notas`

- `cd`
- `transportadora`
- `forn`
- `seq_entrada`
- `nf`
- `coddv`
- `descricao`
- `qtd_cx`
- `un_por_cx`
- `qtd_total`
- `vl_tt`
- `run_id`
- `source_file`
- `source_row_number`
- `ingested_at`

### `db_avulso`

- `cd`
- `id_mov`
- `nr_volume`
- `dt_mov`
- `coddv`
- `descricao`
- `lote`
- `val`
- `qtd_mov`
- `run_id`
- `source_file`
- `source_row_number`
- `ingested_at`

### `db_usuario`

- `cd`
- `mat`
- `nome`
- `dt_nasc`
- `dt_adm`
- `cargo`
- `cd_nome`
- `run_id`
- `source_file`
- `source_row_number`
- `ingested_at`

### `db_barras`

- `coddv`
- `descricao`
- `barras`
- `run_id`
- `source_file`
- `source_row_number`
- `ingested_at`

### `db_devolucao`

- `cd`
- `motivo`
- `nfd`
- `coddv`
- `descricao`
- `tipo`
- `qtd_dev`
- `dt_gera`
- `chave`
- `geracao`
- `run_id`
- `source_file`
- `source_row_number`
- `ingested_at`

### `db_pedido_direto`

- `cd`
- `pedido`
- `sq`
- `filial`
- `dt_pedido`
- `coddv`
- `descricao`
- `qtd_fat`
- `run_id`
- `source_file`
- `source_row_number`
- `ingested_at`
- `pedidoseq`

### `db_rotas`

- `cd`
- `filial`
- `uf`
- `nome`
- `rota`
- `source_run_id`
- `updated_at`

### `db_termo`

- `pedido`
- `cd`
- `filial`
- `coddv`
- `descricao`
- `caixa`
- `qtd_separada`
- `num_rota`
- `id_etiqueta`
- `run_id`
- `source_file`
- `source_row_number`
- `ingested_at`

### `db_end`

- `cd`
- `coddv`
- `descricao`
- `endereco`
- `andar`
- `validade`
- `tipo`
- `source_run_id`
- `updated_at`

### `db_estq_entr`

- `cd`
- `coddv`
- `qtd_est_atual`
- `qtd_est_disp`
- `dat_ult_compra`
- `source_run_id`
- `updated_at`

### `db_log_end`

- `cd`
- `coddv`
- `endereco`
- `exclusao`
- `source_run_id`
- `updated_at`

### `db_prod_blitz`

- `cd`
- `filial`
- `nr_pedido`
- `dt_conf`
- `auditor`
- `qtd_un`
- `source_run_id`
- `updated_at`

### `db_prod_vol`

- `cd`
- `aud`
- `vol_conf`
- `source_run_id`
- `updated_at`

### `db_inventario`

- `cd`
- `endereco`
- `descricao`
- `rua`
- `coddv`
- `estoque`
- `source_run_id`
- `updated_at`
- `base_updated_by`

### `db_conf_blitz`

- `cd`
- `filial`
- `pedido`
- `seq`
- `tt_un`
- `conferente`
- `dt_conf`
- `tt_vol`
- `qtd_avaria`
- `qtd_vencido`
- `qtd_falta`
- `qtd_sobra`
- `source_run_id`
- `updated_at`

### `db_div_blitz`

- `cd`
- `pedido`
- `seq`
- `filial`
- `coddv`
- `descricao`
- `qtd_nfo`
- `conf`
- `vl_div`
- `conferente`
- `data_conf`
- `qtd_venc`
- `caixa`
- `endereco`
- `zona`
- `source_run_id`
- `updated_at`

### `db_pvps`

- `queue_id`
- `cd`
- `zona`
- `coddv`
- `descricao`
- `end_sep`
- `end_pul`
- `qtd_est_disp`
- `dat_ult_compra`
- `is_pending`
- `source_run_id`
- `created_at`
- `updated_at`
- `is_window_active`

### `db_alocacao`

- `queue_id`
- `cd`
- `zona`
- `coddv`
- `descricao`
- `endereco`
- `nivel`
- `val_sist`
- `qtd_est_disp`
- `dat_ult_compra`
- `is_pending`
- `source_run_id`
- `created_at`
- `updated_at`
- `is_window_active`

## 9.4. Rejeições do ETL

### `rejections_db_avulso`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_barras`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_conf_blitz`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_devolucao`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_div_blitz`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_end`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_entrada_notas`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_estq_entr`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_inventario`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_log_end`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_pedido_direto`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_prod_blitz`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_prod_vol`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_rotas`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_termo`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

### `rejections_db_usuario`

- `rejection_id`
- `run_id`
- `source_row_number`
- `reason_code`
- `reason_detail`
- `payload`
- `created_at`

## 9.5. Módulo Coleta / validações operacionais

### `aud_coleta`

- `id`
- `etiqueta`
- `cd`
- `barras`
- `coddv`
- `descricao`
- `qtd`
- `ocorrencia`
- `lote`
- `val_mmaa`
- `mat_aud`
- `nome_aud`
- `user_id`
- `data_hr`
- `created_at`
- `updated_at`

### `endereco`

- `id`
- `data_hr`
- `user_id`
- `usuario`
- `cd`
- `barra`
- `coddv`
- `descricao`
- `end_infor`
- `end_corret`
- `validado`
- `created_at`

### `etiqueta_pulmao`

- `id`
- `data_hr`
- `user_id`
- `usuario`
- `cd`
- `codigo_interno`
- `barra`
- `coddv_resolvido`
- `descricao`
- `validado`
- `created_at`

## 9.6. Módulo Atividade Extra / Produtividade

### `atividade_extra`

- `id`
- `cd`
- `user_id`
- `mat`
- `nome`
- `data_inicio`
- `hora_inicio`
- `data_fim`
- `hora_fim`
- `duracao_segundos`
- `pontos`
- `descricao`
- `created_at`
- `updated_at`
- `approval_status`

### `atividade_extra_cd_settings`

- `cd`
- `visibility_mode`
- `updated_by`
- `updated_at`

### `produtividade_cd_settings`

- `cd`
- `visibility_mode`
- `updated_by`
- `updated_at`

## 9.7. Módulo PVPS e Alocação

### `aud_pvps`

- `audit_id`
- `cd`
- `zona`
- `coddv`
- `descricao`
- `end_sep`
- `end_sit`
- `val_sep`
- `auditor_id`
- `auditor_mat`
- `auditor_nome`
- `status`
- `dt_hr`
- `updated_at`

### `aud_pvps_pul`

- `audit_pul_id`
- `audit_id`
- `end_pul`
- `val_pul`
- `dt_hr`
- `updated_at`
- `end_sit`

### `aud_alocacao`

- `audit_id`
- `queue_id`
- `cd`
- `zona`
- `coddv`
- `descricao`
- `endereco`
- `nivel`
- `end_sit`
- `val_sist`
- `val_conf`
- `aud_sit`
- `auditor_id`
- `auditor_mat`
- `auditor_nome`
- `dt_hr`
- `updated_at`

### `pvps_admin_rules`

- `rule_id`
- `cd`
- `modulo`
- `rule_kind`
- `target_type`
- `target_value`
- `priority_value`
- `active`
- `created_by`
- `created_at`
- `removed_by`
- `removed_at`

### `pvps_admin_rule_history`

- `history_id`
- `rule_id`
- `cd`
- `modulo`
- `rule_kind`
- `target_type`
- `target_value`
- `priority_value`
- `action_type`
- `apply_mode`
- `affected_pvps`
- `affected_alocacao`
- `actor_user_id`
- `details_json`
- `created_at`

### `pvps_admin_rule_grace`

- `grace_id`
- `rule_id`
- `modulo`
- `item_key`
- `created_at`

### `pvps_alocacao_blacklist`

- `blacklist_id`
- `cd`
- `modulo`
- `zona`
- `coddv`
- `created_at`
- `created_by`

### `pvps_alocacao_priority_zones`

- `priority_id`
- `cd`
- `modulo`
- `zona`
- `prioridade`
- `created_at`
- `updated_at`

### `pvps_alocacao_replenish_state`

- `cd`
- `modulo`
- `last_run_at`
- `pending_before`
- `reason`
- `updated_at`

### `pvps_alocacao_offline_discard`

- `discard_id`
- `created_at`
- `cd`
- `modulo`
- `event_kind`
- `local_event_id`
- `local_event_created_at`
- `local_payload`
- `local_user_id`
- `local_user_mat`
- `local_user_nome`
- `coddv`
- `zona`
- `end_sep`
- `end_pul`
- `queue_id`
- `conflict_reason`
- `existing_audit_id`
- `existing_auditor_id`
- `existing_auditor_mat`
- `existing_auditor_nome`
- `existing_audit_dt_hr`
- `existing_status`
- `details_json`

## 9.8. Conferência de Termo

### `conf_termo`

- `conf_id`
- `conf_date`
- `cd`
- `id_etiqueta`
- `caixa`
- `pedido`
- `filial`
- `filial_nome`
- `rota`
- `started_by`
- `started_mat`
- `started_nome`
- `status`
- `falta_motivo`
- `started_at`
- `finalized_at`
- `updated_at`

### `conf_termo_itens`

- `item_id`
- `conf_id`
- `coddv`
- `descricao`
- `qtd_esperada`
- `qtd_conferida`
- `updated_at`
- `barras`
- `id_etiqueta`

## 9.9. Conferência de Pedido Direto

### `conf_pedido_direto`

- `conf_id`
- `conf_date`
- `cd`
- `id_vol`
- `caixa`
- `pedido`
- `filial`
- `filial_nome`
- `rota`
- `started_by`
- `started_mat`
- `started_nome`
- `status`
- `falta_motivo`
- `started_at`
- `finalized_at`
- `updated_at`
- `sq`

### `conf_pedido_direto_itens`

- `item_id`
- `conf_id`
- `coddv`
- `descricao`
- `qtd_esperada`
- `qtd_conferida`
- `updated_at`
- `barras`
- `id_vol`

## 9.10. Conferência de Volume Avulso

### `conf_volume_avulso`

- `conf_id`
- `conf_date`
- `cd`
- `nr_volume`
- `caixa`
- `pedido`
- `filial`
- `filial_nome`
- `rota`
- `started_by`
- `started_mat`
- `started_nome`
- `status`
- `falta_motivo`
- `started_at`
- `finalized_at`
- `updated_at`

### `conf_volume_avulso_itens`

- `item_id`
- `conf_id`
- `nr_volume`
- `coddv`
- `barras`
- `descricao`
- `qtd_esperada`
- `qtd_conferida`
- `updated_at`

## 9.11. Conferência de Entrada de Notas

### `conf_entrada_notas`

- `conf_id`
- `conf_date`
- `cd`
- `seq_entrada`
- `nf`
- `transportadora`
- `fornecedor`
- `started_by`
- `started_mat`
- `started_nome`
- `status`
- `started_at`
- `finalized_at`
- `updated_at`

### `conf_entrada_notas_itens`

- `item_id`
- `conf_id`
- `seq_entrada`
- `nf`
- `coddv`
- `barras`
- `descricao`
- `qtd_esperada`
- `qtd_conferida`
- `updated_at`
- `locked_by`
- `locked_mat`
- `locked_nome`

### `conf_entrada_notas_itens_conferidos`

- `conf_id`
- `item_id`
- `seq_entrada`
- `nf`
- `coddv`
- `barras`
- `descricao`
- `qtd_conferida`
- `divergencia_tipo`
- `updated_at`

### `conf_entrada_notas_colaboradores`

- `conf_id`
- `user_id`
- `mat`
- `nome`
- `first_action_at`
- `last_action_at`

### `conf_entrada_notas_ocorrencias`

- `ocorrencia_id`
- `conf_id`
- `item_id`
- `coddv`
- `tipo`
- `qtd`
- `updated_by`
- `created_at`
- `updated_at`

### `conf_entrada_notas_avulsa`

- `conf_id`
- `conf_date`
- `cd`
- `kind`
- `transportadora`
- `fornecedor`
- `started_by`
- `started_mat`
- `started_nome`
- `status`
- `started_at`
- `finalized_at`
- `updated_at`

### `conf_entrada_notas_avulsa_itens`

- `item_id`
- `conf_id`
- `coddv`
- `barras`
- `descricao`
- `qtd_esperada`
- `qtd_conferida`
- `updated_at`

### `conf_entrada_notas_avulsa_itens_conferidos`

- `conf_id`
- `item_id`
- `coddv`
- `barras`
- `descricao`
- `qtd_conferida`
- `divergencia_tipo`
- `updated_at`

### `conf_entrada_notas_avulsa_targets`

- `avulsa_conf_id`
- `target_conf_id`
- `cd`
- `seq_entrada`
- `nf`
- `created_via_session`
- `first_scan_at`
- `last_scan_at`

## 9.12. Devolução de Mercadoria

### `conf_devolucao`

- `conf_id`
- `conf_date`
- `cd`
- `conference_kind`
- `nfd`
- `chave`
- `source_motivo`
- `nfo`
- `motivo_sem_nfd`
- `status`
- `falta_motivo`
- `started_by`
- `started_mat`
- `started_nome`
- `started_at`
- `finalized_at`
- `updated_at`

### `conf_devolucao_itens`

- `item_id`
- `conf_id`
- `coddv`
- `barras`
- `descricao`
- `tipo`
- `qtd_esperada`
- `qtd_conferida`
- `qtd_manual_total`
- `updated_at`
- `lotes`

## 9.13. Inventário (zerados)

### `conf_inventario_counts`

- `count_id`
- `cycle_date`
- `cd`
- `zona`
- `endereco`
- `coddv`
- `descricao`
- `estoque`
- `etapa`
- `qtd_contada`
- `barras`
- `resultado`
- `counted_by`
- `counted_mat`
- `counted_nome`
- `client_event_id`
- `created_at`
- `updated_at`

### `conf_inventario_reviews`

- `review_id`
- `cycle_date`
- `cd`
- `zona`
- `endereco`
- `coddv`
- `descricao`
- `estoque`
- `reason_code`
- `snapshot`
- `status`
- `final_qtd`
- `final_barras`
- `final_resultado`
- `resolved_by`
- `resolved_mat`
- `resolved_nome`
- `resolved_at`
- `created_at`
- `updated_at`

### `conf_inventario_zone_locks`

- `lock_id`
- `cycle_date`
- `cd`
- `zona`
- `etapa`
- `locked_by`
- `locked_mat`
- `locked_nome`
- `heartbeat_at`
- `expires_at`
- `created_at`
- `updated_at`

### `conf_inventario_event_log`

- `client_event_id`
- `user_id`
- `event_type`
- `payload`
- `status`
- `info`
- `processed_at`

### `conf_inventario_admin_seed_config`

- `cd`
- `zonas`
- `estoque_ini`
- `estoque_fim`
- `incluir_pul`
- `manual_coddv`
- `updated_by`
- `updated_at`

## 9.14. Controle de Validade

### `ctrl_validade_linha_coletas`

- `id`
- `client_event_id`
- `cd`
- `barras`
- `coddv`
- `descricao`
- `endereco_sep`
- `val_mmaa`
- `qtd`
- `data_coleta`
- `auditor_id`
- `auditor_mat`
- `auditor_nome`
- `created_at`
- `updated_at`

### `ctrl_validade_linha_retiradas`

- `id`
- `client_event_id`
- `cd`
- `coddv`
- `descricao`
- `endereco_sep`
- `val_mmaa`
- `ref_coleta_mes`
- `qtd_retirada`
- `data_retirada`
- `auditor_id`
- `auditor_mat`
- `auditor_nome`
- `created_at`
- `updated_at`

### `ctrl_validade_pul_retiradas`

- `id`
- `client_event_id`
- `cd`
- `coddv`
- `descricao`
- `endereco_pul`
- `val_mmaa`
- `qtd_retirada`
- `data_retirada`
- `auditor_id`
- `auditor_mat`
- `auditor_nome`
- `created_at`
- `updated_at`

## 9.15. Fechamento

Esse inventário foi montado a partir das migrations SQL, do `config.yml`, do backend Python e do frontend React existentes no repositório. Se você quiser, o próximo passo pode ser eu transformar este material em:

- um documento executivo de 1 página para a TI
- uma planilha CSV com todas as tabelas e colunas
- ou um mapa “módulo x tabela x porta/domínio a liberar”
