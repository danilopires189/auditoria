# Arquitetura

## Visao geral

O sistema Auditoria e composto por quatro blocos principais:

1. frontend web em React/Vite;
2. backend local em Python para ETL e automacao;
3. banco Supabase/Postgres com RLS, RPCs e objetos auxiliares;
4. Edge Function opcional para ingestao HTTPS.

## Componentes

### Frontend

Local: `frontend/`

Responsabilidades:

- autenticacao por matricula;
- cadastro e redefinicao de senha;
- aplicacao dos perfis e escopo por CD;
- operacao online e offline em modulos selecionados;
- consumo de RPCs, tabelas e status de manutencao;
- deploy estatico via Vercel.

Tecnologias principais:

- React 18
- TypeScript
- Vite
- React Router DOM
- Supabase JS
- IndexedDB e `localStorage`
- `@zxing/browser`, `xlsx`, `jspdf`, `jspdf-autotable`

### Backend local

Local: `backend/`

Responsabilidades:

- aplicar migracoes SQL;
- validar conectividade com o Supabase;
- refresh opcional de planilhas com Excel/COM;
- carregar arquivos Excel/CSV para staging;
- promover dados para tabelas de negocio;
- registrar execucoes, snapshots e rejeicoes;
- operar por CLI, GUI Tkinter e agendamento no Windows.

Tecnologias principais:

- Python 3.11+
- Typer
- SQLAlchemy
- Psycopg2
- Pandas e OpenPyXL
- Tkinter
- PyInstaller

### Banco Supabase/Postgres

Responsabilidades:

- autenticacao e sessao;
- controle de acesso por RLS;
- armazenamento das bases operacionais e tabelas de auditoria;
- exposicao de RPCs consumidas pelo frontend;
- persistencia das execucoes do ETL.

Fonte oficial do schema:

- `backend/app/ddl/sql/`

### Edge Function

Locais:

- fonte de referencia: `backend/edge_function/sync_ingest/index.ts`
- copia preparada para deploy local Supabase CLI: `backend/supabase/functions/sync_ingest/index.ts`

Uso:

- alternativa ao transporte PostgreSQL direto quando a rede permite apenas HTTPS.

## Fluxo de dados

### Fluxo padrao

1. Arquivos operacionais sao colocados em `backend/data/`.
2. O backend executa `validate` e `sync`.
3. Os dados entram em tabelas `staging`.
4. Regras de promocao atualizam tabelas `app`, `audit`, `authz` e correlatas.
5. O frontend consome o resultado por tabelas e RPCs no Supabase.

### Fluxo alternativo com Edge Function

1. O backend identifica `SYNC_TRANSPORT=edge`.
2. Os lotes sao enviados por HTTPS para `sync_ingest`.
3. A function persiste no Supabase usando credenciais de servico.
4. O restante da operacao continua igual para o frontend.

## Diretorios mais importantes

- `backend/app/cli/`: contratos da CLI.
- `backend/app/automation/`: scheduler, politica de janela, transporte Edge e runner.
- `backend/app/ddl/sql/`: migracoes versionadas.
- `backend/app/etl/`: leitura, normalizacao, validacao, carga e promocao.
- `backend/tests/`: testes automatizados do backend.
- `frontend/src/modules/`: modulos funcionais publicados.
- `frontend/src/shared/`: utilitarios de sincronizacao, offline e datas.
- `docs/`: documentacao operacional e executiva.

## Configuracoes-chave

- `backend/config.yml`: define pastas, politicas e tabelas carregadas.
- `backend/automation_config.json`: define janela, intervalo e tarefa agendada.
- `backend/.env`: credenciais do banco ou parametros de Edge Function.
- `frontend/.env`: variaveis do frontend.
- `vercel.json`: build e roteamento do deploy web.

## Modulos atualmente publicados

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

## Observacoes de governanca

- o schema deve evoluir apenas por nova migracao versionada;
- contratos operacionais devem refletir `backend/config.yml` e nao copias manuais antigas;
- documentos de inventario sao snapshots e podem envelhecer mais rapido que o codigo.
