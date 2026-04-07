# Backend Local -> Supabase

Backend Python responsavel por migracoes, validacao, carga e automacao das bases operacionais do projeto Auditoria.

## Responsabilidades

- aplicar migracoes SQL do banco;
- validar conectividade com o Supabase;
- atualizar planilhas com `refresh` quando o fluxo exigir;
- ler Excel/CSV de `data/`;
- carregar tabelas `staging` e promover para tabelas finais;
- registrar execucoes, metadados, snapshots e rejeicoes;
- operar por CLI, GUI Tkinter e Task Scheduler do Windows.

## Requisitos

- Python 3.11+
- acesso ao Supabase Postgres ou a Edge Function
- Windows para GUI, `schtasks` e automacao COM do Excel

## Setup

No diretorio `backend/`:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item env.example .env
```

Se preferir usar a virtualenv da raiz do repositorio, os scripts `.bat` tambem reconhecem `..\.venv\Scripts\python.exe`.

## Arquivos de configuracao

### `.env`

Credenciais e transporte:

- `SUPABASE_DB_HOST`
- `SUPABASE_DB_PORT`
- `SUPABASE_DB_NAME`
- `SUPABASE_DB_USER`
- `SUPABASE_DB_PASSWORD`
- `SYNC_TRANSPORT`
- `EDGE_FUNCTION_URL`
- `EDGE_FUNCTION_BEARER_TOKEN`
- `EDGE_FUNCTION_SHARED_SECRET`
- `EDGE_FUNCTION_TIMEOUT_SECONDS`
- `EDGE_FUNCTION_CHUNK_SIZE`

### `config.yml`

Define:

- `app.data_dir`
- `app.rejections_dir`
- `app.log_level`
- timeouts e pool do Supabase
- tabelas carregadas, modo de sync, arquivos, abas e tipos

### `automation_config.json`

Define:

- janela operacional
- intervalo
- timezone
- regra de domingo
- nome da tarefa agendada

## Modos de transporte

### PostgreSQL direto

Modo padrao, usando `5432` ou `6543`.

### Edge Function

Use quando a rede bloquear PostgreSQL:

```env
SYNC_TRANSPORT=edge
EDGE_FUNCTION_URL=https://<project-ref>.functions.supabase.co/sync_ingest
EDGE_FUNCTION_BEARER_TOKEN=<anon-or-service-role-key>
EDGE_FUNCTION_SHARED_SECRET=<secret>
EDGE_FUNCTION_TIMEOUT_SECONDS=120
EDGE_FUNCTION_CHUNK_SIZE=1000
```

Fonte de referencia da function: `edge_function/sync_ingest/index.ts`.

## Comandos principais

```powershell
py -3 main.py bootstrap --config .\config.yml --env-file .\.env
py -3 main.py healthcheck --config .\config.yml --env-file .\.env
py -3 main.py refresh --config .\config.yml --env-file .\.env
py -3 main.py validate --config .\config.yml --env-file .\.env
py -3 main.py sync --config .\config.yml --env-file .\.env
py -3 main.py dry-run --config .\config.yml --env-file .\.env
py -3 main.py automation-cycle --scheduled --config .\config.yml --env-file .\.env --automation-config .\automation_config.json
py -3 main.py automation-task install --config .\config.yml --env-file .\.env --automation-config .\automation_config.json
py -3 main.py automation-task status --config .\config.yml --env-file .\.env --automation-config .\automation_config.json
py -3 main.py automation-task run-now --config .\config.yml --env-file .\.env --automation-config .\automation_config.json
py -3 main.py automation-task remove --config .\config.yml --env-file .\.env --automation-config .\automation_config.json
py -3 main.py gui --config .\config.yml --env-file .\.env --automation-config .\automation_config.json
```

Resumo de uso:

- `bootstrap`: aplica o schema
- `healthcheck`: valida conectividade
- `refresh`: atualiza planilhas externas
- `validate`: valida sem promover
- `sync`: executa a carga real
- `dry-run`: simula a carga
- `automation-cycle`: executa o fluxo orquestrado
- `automation-task *`: administra a tarefa do Windows
- `gui`: abre a interface Tkinter

Sem argumentos, `main.py` abre a GUI.

## Empacotamento

```powershell
py -3 -m PyInstaller sync_backend.spec
```

Artefato esperado:

- `dist\sync_backend.exe`

O `sync_backend.spec` inclui:

- `config.yml`
- `automation_config.json` quando existir
- migracoes em `app/ddl/sql/`

## Execucao em outra maquina

Copie:

- `dist\sync_backend.exe`
- `config.yml`
- `automation_config.json`
- `.env`
- pasta `data\`
- `run_bootstrap.bat`
- `run_sync.bat`

Regras:

1. mantenha `data\` no mesmo diretorio do executavel;
2. execute `run_bootstrap.bat` na primeira subida;
3. depois use `run_sync.bat` ou a tarefa agendada.

## Logs e evidencias

- logs gerais: `logs\`
- rejeicoes exportadas: `logs\rejections\`
- identificador de execucao: `run_id` na saida da CLI

## Boas praticas

- nunca salve segredo em `config.yml`
- altere schema apenas via nova migracao versionada
- documente novos arquivos de origem tambem em `config.yml`
- valide `healthcheck` antes de culpar o frontend

## Leitura complementar

- `../docs/setup-e-deploy.md`
- `../docs/runbook-operacional.md`
- `../docs/troubleshooting.md`
- `edge_function/README.md`
