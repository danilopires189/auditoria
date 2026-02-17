# Backend Sync Local -> Supabase

## 1. Setup

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Preencha `.env` com as credenciais reais do banco Supabase Postgres.

## 2. Comandos CLI

```powershell
py -3 main.py bootstrap --config .\config.yml --env-file .\.env
py -3 main.py healthcheck --config .\config.yml --env-file .\.env
py -3 main.py validate --config .\config.yml --env-file .\.env
py -3 main.py sync --config .\config.yml --env-file .\.env
py -3 main.py dry-run --config .\config.yml --env-file .\.env
py -3 main.py refresh --config .\config.yml --env-file .\.env
```

## 3. Empacotamento com PyInstaller

```powershell
py -3 -m PyInstaller --onefile --name sync_backend --add-data "config.yml;." main.py
```

Artefato gerado em `dist\sync_backend.exe`.

## 4. Execução em outra máquina

1. Copiar para a máquina de destino:
   - `dist\sync_backend.exe`
   - `config.yml`
   - `.env`
   - pasta `data\`
   - `run_bootstrap.bat`
   - `run_sync.bat`
2. Manter `data` no mesmo diretório do `.exe`.
3. Executar `run_bootstrap.bat` (primeira vez) e depois `run_sync.bat`.

Arquivos esperados no fluxo padrão (`data\`):
- `DB_BARRAS.xlsx`
- `DB_INVENTARIO.xlsx`
- demais arquivos já configurados em `config.yml`

## 5. Observações de segurança

- Nunca salvar senha real em `config.yml`.
- O frontend depende de RLS no banco para controle de acesso.
- `db_barras` é dimensão global (sem `cd`) e leitura autenticada via profile.
- `db_inventario` é base por CD usada no módulo `Inventário (zerados)` e sincroniza pelo mesmo pipeline Excel -> staging -> app.
