# Frontend Auditoria

Aplicacao web React/Vite do projeto Auditoria. O frontend autentica usuarios por matricula, aplica escopo por perfil e CD, opera modulos de auditoria/conferencia e oferece recursos offline em partes importantes do sistema.

## Capacidades principais

- login por matricula + senha;
- cadastro e redefinicao de senha com validacao por dados funcionais;
- sessao persistida com protecao contra inatividade e dispositivo concorrente;
- modo manutencao;
- escopo por perfil, CD e contexto global de administracao;
- modulos com suporte offline, cache local e sincronizacao posterior;
- deploy SPA preparado para Vercel.

## Stack

- React 18
- TypeScript
- Vite
- React Router DOM
- Supabase JS
- `@zxing/browser`
- `xlsx`
- `jspdf` e `jspdf-autotable`

## Pre-requisitos

- Node.js 20+
- backend e banco ja preparados com `bootstrap`

## Variaveis de ambiente

Copie `.env.example` para `.env` e preencha:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BASE_PATH` quando o app nao rodar na raiz `/`

## Execucao local

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`.

## Build e preview

```bash
npm run build
npm run preview
```

## Deploy

O deploy oficial usa o `vercel.json` da raiz:

- install em `frontend/`
- build em `frontend/`
- output em `frontend/dist`
- rewrite de todas as rotas para `index.html`

## Modulos publicados

Operacionais:

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

Placeholder:

- Check List
- Registro de Embarque

## Observacoes de operacao

- o frontend depende das migracoes e RPCs do banco para funcionar;
- alguns modulos usam `IndexedDB` e `localStorage` para modo offline;
- o scanner por camera depende de permissao do navegador;
- o hostname pode alterar branding e escopo visual em deploys dedicados.

## Checklist rapido de validacao

1. abrir a tela de login
2. validar autenticacao
3. validar carregamento da home
4. abrir ao menos um modulo de leitura
5. abrir ao menos um modulo transacional

## Leitura complementar

- `../README.md`
- `../docs/arquitetura.md`
- `../docs/setup-e-deploy.md`
- `../docs/troubleshooting.md`
