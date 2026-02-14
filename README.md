# Monorepo Auditoria

## Estrutura

- `backend/`: ETL/Sync para Supabase Postgres, migrações SQL, RLS e CLI.
- `frontend/`: app React (Vite) com login/cadastro/redefinição por matrícula.

## Backend

```powershell
cd backend
..\.venv\Scripts\python main.py --help
```

## Frontend (local)

```powershell
cd frontend
npm install
npm run dev
```

## Deploy Vercel

Projeto já preparado com `vercel.json` na raiz.

Variáveis de ambiente necessárias no Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
