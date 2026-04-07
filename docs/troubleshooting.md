# Troubleshooting

## 1. Frontend nao inicia localmente

Sintomas:

- erro de build
- pagina em branco
- mensagem sobre `VITE_SUPABASE_URL` ou `VITE_SUPABASE_ANON_KEY`

Verificacoes:

1. confirme `frontend/.env`
2. rode `npm install`
3. rode `npm run build`
4. revise `frontend/src/lib/supabase.ts`

## 2. Login falha para todos os usuarios

Verificacoes:

1. conferir `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
2. validar disponibilidade do projeto Supabase
3. confirmar que o frontend publicado aponta para o projeto correto
4. revisar RLS, RPCs e modo manutencao

## 3. `healthcheck` do backend falha

Possiveis causas:

- credenciais erradas em `backend/.env`
- porta `5432` ou `6543` bloqueada
- DNS ou firewall
- projeto Supabase indisponivel

Diagnostico:

```powershell
py -3 backend\main.py healthcheck --config backend\config.yml --env-file backend\.env
```

Se a rede bloquear PostgreSQL, migre para `SYNC_TRANSPORT=edge`.

## 4. `bootstrap` falha por checksum de migracao

Causa comum:

- uma migracao ja aplicada foi editada manualmente

Correcao:

1. nao altere migracoes ja aplicadas em producao;
2. crie uma nova migracao versionada em `backend/app/ddl/sql/`;
3. reaplique com `bootstrap`.

## 5. `sync` falha por lock em uso

Sintoma:

- retorno informando `advisory lock in use`
- `run_sync.bat` avisa que outra sincronizacao ja esta rodando

Interpretacao:

- o lock evita concorrencia de duas cargas ao mesmo tempo

Acao:

1. aguarde a execucao atual terminar;
2. confirme se nao ha tarefa duplicada;
3. repita o comando apenas depois da liberacao.

## 6. Tarefa agendada nao executa

Verificacoes:

1. rode `automation-task status`
2. confirme o `task_name` em `backend/automation_config.json`
3. valide permissao do `schtasks`
4. confirme que a pasta e os arquivos ainda existem no caminho configurado

Comandos uteis:

```powershell
py -3 backend\main.py automation-task status --config backend\config.yml --env-file backend\.env --automation-config backend\automation_config.json
py -3 backend\main.py automation-task run-now --config backend\config.yml --env-file backend\.env --automation-config backend\automation_config.json
```

## 7. Sync via Edge Function falha

Verificacoes:

1. `SYNC_TRANSPORT=edge`
2. `EDGE_FUNCTION_URL` correta
3. `EDGE_FUNCTION_BEARER_TOKEN` correto
4. `EDGE_FUNCTION_SHARED_SECRET` igual ao da function
5. function publicada e acessivel por HTTPS

Depois rode:

```powershell
py -3 backend\main.py healthcheck --config backend\config.yml --env-file backend\.env
```

## 8. Arquivos nao sao encontrados no backend

Verificacoes:

1. confirme `backend/config.yml`
2. confirme a pasta `backend/data/`
3. valide nomes de arquivo, aba e extensao
4. confirme se o executavel e a pasta `data\` estao lado a lado na maquina de destino

## 9. `refresh` nao atualiza planilhas

Possiveis causas:

- Excel nao instalado
- automacao COM bloqueada
- `xlwings` ou `pywin32` ausentes
- arquivo travado por outro processo

Acao:

1. valide instalacao do Excel
2. feche planilhas abertas
3. instale dependencias opcionais
4. teste novamente o comando `refresh`

## 10. Documento tecnico parece desatualizado

Isso pode acontecer com os snapshots em `docs/resumo-aplicacao-ti.md` e `docs/inventario_aplicacao_ti.md`.

Use como fonte oficial:

- `backend/app/ddl/sql/`
- `backend/config.yml`
- `backend/app/cli/app.py`
- `frontend/src/modules/registry.ts`
