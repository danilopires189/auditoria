# Setup e Deploy

## 1. Pre-requisitos

### Frontend

- Node.js 20+
- npm

### Backend

- Python 3.11+
- acesso ao Supabase
- Windows quando houver uso de GUI, Excel refresh ou Task Scheduler

### Opcionais

- Microsoft Excel com automacao COM, quando o fluxo exigir `refresh`
- Supabase CLI, quando a Edge Function for publicada manualmente

## 2. Setup local do backend

Na raiz do repositorio:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
Copy-Item backend\env.example backend\.env
```

Depois:

1. preencha `backend/.env` com as credenciais reais;
2. revise `backend/config.yml`;
3. ajuste `backend/automation_config.json` se for usar scheduler.

Comandos basicos:

```powershell
py -3 backend\main.py bootstrap --config backend\config.yml --env-file backend\.env
py -3 backend\main.py healthcheck --config backend\config.yml --env-file backend\.env
py -3 backend\main.py validate --config backend\config.yml --env-file backend\.env
py -3 backend\main.py sync --config backend\config.yml --env-file backend\.env
```

## 3. Setup local do frontend

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Variaveis do frontend:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BASE_PATH` quando necessario

## 4. Primeira subida de ambiente

Sequencia recomendada:

1. configurar `backend/.env`;
2. rodar `bootstrap`;
3. rodar `healthcheck`;
4. validar as bases com `validate`;
5. executar um `sync`;
6. subir o frontend localmente;
7. testar login, consulta de modulo e uma operacao simples.

## 5. Deploy do frontend no Vercel

O projeto usa `vercel.json` na raiz com:

- install em `frontend/`
- build em `frontend/`
- output em `frontend/dist`
- rewrite para SPA

Variaveis minimas no Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BASE_PATH` se o deploy nao ficar em `/`

Checklist de publicacao:

1. `npm run build` em `frontend/`
2. validar o dominio configurado
3. confirmar login
4. confirmar carregamento do menu inicial
5. confirmar ao menos um modulo de leitura e um modulo de escrita

## 6. Deploy do backend em outra maquina

Arquivos minimos:

- `backend/dist/sync_backend.exe`
- `backend/config.yml`
- `backend/automation_config.json`
- `backend/.env`
- pasta `backend/data/`

Artefato:

```powershell
cd backend
py -3 -m PyInstaller sync_backend.spec
```

Na maquina de destino:

1. copiar os arquivos para a mesma pasta;
2. manter `data\` ao lado do executavel;
3. executar `run_bootstrap.bat` na primeira vez;
4. depois usar `run_sync.bat` ou a automacao agendada.

## 7. Transporte alternativo por Edge Function

Use esse modo quando a rede bloquear PostgreSQL direto.

Configuracao no desktop:

```env
SYNC_TRANSPORT=edge
EDGE_FUNCTION_URL=https://<project-ref>.functions.supabase.co/sync_ingest
EDGE_FUNCTION_BEARER_TOKEN=<token>
EDGE_FUNCTION_SHARED_SECRET=<secret>
EDGE_FUNCTION_TIMEOUT_SECONDS=120
EDGE_FUNCTION_CHUNK_SIZE=1000
```

Passos de deploy:

1. criar a function `sync_ingest`;
2. publicar `../backend/edge_function/sync_ingest/index.ts`;
3. configurar os secrets no Supabase;
4. executar `healthcheck`;
5. executar um `automation-cycle` de teste.

Detalhes complementares em `../backend/edge_function/README.md`.

## 8. Checklist de smoke test

### Backend

- `bootstrap` conclui sem erro
- `healthcheck` retorna sucesso
- `validate` nao aponta falhas estruturais inesperadas
- `sync` gera `run_id`
- `logs/` e `logs/rejections/` sao gravados

### Frontend

- build concluida
- login funcionando
- sessao persiste ao recarregar
- modo manutencao responde corretamente
- ao menos um modulo com leitura de dados abre sem erro

## 9. Referencias rapidas

- setup do backend: `../backend/README.md`
- setup do frontend: `../frontend/README.md`
- operacao recorrente: `runbook-operacional.md`
- incidentes: `troubleshooting.md`
