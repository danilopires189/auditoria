# Frontend (Etapa 1)

Aplicação React + Vite focada em Chrome mobile com:

- Login por matrícula + senha
- Cadastro por matrícula + `dt_nasc` + `dt_adm`
- Redefinição de senha por matrícula + `dt_nasc` + `dt_adm`
- Tela pós-login com header exibindo `nome`, `matrícula` e `CD`

## Pré-requisitos

- Node.js 20+
- Backend migrado até `V016` (`bootstrap` executado)

## Configuração

1. Copie `.env.example` para `.env`.
2. Preencha:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

## Execução local

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`.

## Build

```bash
npm run build
npm run preview
```
