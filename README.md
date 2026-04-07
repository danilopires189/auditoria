# Auditoria

Monorepo da plataforma de auditoria operacional dos CDs. O projeto combina um frontend web em React/Vite, um backend local em Python para ETL e automacao, banco Supabase/Postgres com RLS e uma Edge Function opcional para sincronizacao via HTTPS quando a rede bloqueia PostgreSQL direto.

## O que este repositorio entrega

- autenticacao por matricula, cadastro e redefinicao de senha;
- controle de acesso por perfil, CD e contexto global de administracao;
- modulos operacionais para auditoria, conferencia, produtividade, indicadores e validacoes;
- sincronizacao de bases Excel/CSV para Supabase com trilha de auditoria e rejeicoes;
- execucao manual, por GUI, por CLI ou por Windows Task Scheduler;
- deploy web preparado para Vercel.

## Visao rapida da arquitetura

1. O backend local le arquivos operacionais em `backend/data/`, valida e promove os dados para o Supabase.
2. O frontend consome RPCs e tabelas protegidas por RLS para operar os modulos web.
3. Quando a rede nao libera `5432/6543`, o backend pode enviar os lotes para uma Edge Function em HTTPS.
4. O schema evolui por migracoes SQL versionadas em `backend/app/ddl/sql` e atualmente vai ate `V365`.

## Modulos do frontend

Modulos operacionais implementados hoje:

- Atividade Extra
- Busca por Produto
- Coleta de Mercadoria
- Conferencia de Entrada de Notas
- Conferencia de Pedido Direto
- Conferencia de Termo
- Conferencia de Volume Avulso
- Controle de Validade
- Devolucao de Mercadoria
- Gestao de Estoque
- Indicadores
- Meta Mes
- Produtividade
- Auditoria de PVPS e Alocacao
- Validar Enderecamento
- Validar Etiqueta Pulmao
- Inventario (zerados)

Modulos publicados como placeholder:

- Check List
- Registro de Embarque

## Estrutura do repositorio

- `backend/`: CLI, GUI Tkinter, ETL, automacao, migracoes SQL, Edge Function e empacotamento.
- `frontend/`: aplicacao React/Vite, PWA, autenticacao Supabase e modulos operacionais.
- `docs/`: documentacao funcional, tecnica e operacional.
- `automacao - atual/` e `automacao - nova/`: scripts auxiliares e operacao Windows em campo.

## Inicio rapido

### Backend

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
Copy-Item backend\env.example backend\.env
py -3 backend\main.py healthcheck --config backend\config.yml --env-file backend\.env
```

### Frontend

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

## Deploy

O frontend ja esta preparado para Vercel via `vercel.json`. Variaveis minimas:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BASE_PATH` quando o deploy nao usar a raiz `/`

Para o backend, veja:

- `backend/README.md`
- `docs/setup-e-deploy.md`

## Documentacao

- `docs/README.md`: mapa da documentacao e fontes oficiais.
- `docs/arquitetura.md`: arquitetura, fluxos e diretorios.
- `docs/setup-e-deploy.md`: setup local, deploy e checklist de publicacao.
- `docs/runbook-operacional.md`: operacao diaria, automacao e rotina de suporte.
- `docs/troubleshooting.md`: falhas comuns e como diagnosticar.
- `docs/resumo-aplicacao-ti.md`: resumo executivo e requisitos de rede para TI.
- `docs/inventario_aplicacao_ti.md`: snapshot historico do inventario tecnico.

## Fonte oficial de verdade

Para evitar ambiguidade entre documentos antigos e o estado atual do projeto, use estas fontes como canonicas:

- contratos de CLI: `backend/app/cli/app.py`
- migracoes e schema: `backend/app/ddl/sql/`
- configuracao de carga: `backend/config.yml`
- catalogo de modulos do frontend: `frontend/src/modules/registry.ts`
- variaveis do frontend: `frontend/.env.example`
