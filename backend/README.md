# Backend Sync Local -> Supabase

## 1. Setup

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Preencha `.env` com as credenciais reais do banco Supabase Postgres.

Se a rede bloquear PostgreSQL (`5432/6543`), use modo HTTPS:

```env
SYNC_TRANSPORT=edge
EDGE_FUNCTION_URL=https://<project-ref>.functions.supabase.co/sync_ingest
EDGE_FUNCTION_BEARER_TOKEN=<anon-or-service-role-key>
EDGE_FUNCTION_SHARED_SECRET=<secret>
EDGE_FUNCTION_TIMEOUT_SECONDS=120
EDGE_FUNCTION_CHUNK_SIZE=1000
```

Template da function: `edge_function/sync_ingest/index.ts`.

## 2. Comandos CLI

```powershell
py -3 main.py bootstrap --config .\config.yml --env-file .\.env
py -3 main.py healthcheck --config .\config.yml --env-file .\.env
py -3 main.py validate --config .\config.yml --env-file .\.env
py -3 main.py sync --config .\config.yml --env-file .\.env
py -3 main.py dry-run --config .\config.yml --env-file .\.env
py -3 main.py refresh --config .\config.yml --env-file .\.env
py -3 main.py automation-cycle --scheduled --config .\config.yml --env-file .\.env --automation-config .\automation_config.json
py -3 main.py automation-task install --config .\config.yml --env-file .\.env --automation-config .\automation_config.json
py -3 main.py automation-task status --config .\config.yml --env-file .\.env --automation-config .\automation_config.json
py -3 main.py gui --config .\config.yml --env-file .\.env --automation-config .\automation_config.json
```

No modo `SYNC_TRANSPORT=edge`, `healthcheck` valida a Edge Function (HTTPS) e
`automation-cycle` envia dados para o Supabase via função HTTP.

Sem argumentos (`py -3 main.py`) o app abre a interface Tkinter.

## 3. Empacotamento com PyInstaller

```powershell
py -3 -m PyInstaller sync_backend.spec
```

Artefato gerado em `dist\sync_backend.exe`.

## 4. Execução em outra máquina

1. Copiar para a máquina de destino:
   - `dist\sync_backend.exe`
   - `config.yml`
   - `automation_config.json`
   - `.env`
   - pasta `data\`
   - `run_bootstrap.bat`
   - `run_sync.bat`
2. Manter `data` no mesmo diretório do `.exe`.
3. Executar `run_bootstrap.bat` (primeira vez) e depois `run_sync.bat`.

Arquivos esperados no fluxo padrão (`data\`):
- `DB_BARRAS.xlsx`
- demais arquivos já configurados em `config.yml`

## 5. Observações de segurança

- Nunca salvar senha real em `config.yml`.
- O frontend depende de RLS no banco para controle de acesso.
- `db_barras` é dimensão global (sem `cd`) e leitura autenticada via profile.
- `db_inventario` é base por CD usada no módulo `Inventário (zerados)`, gerida por RPCs Admin e montada a partir de `db_end` + `db_estq_entr`.
