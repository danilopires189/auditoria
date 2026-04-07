# Documentacao do Projeto

Este diretorio concentra a documentacao oficial do projeto Auditoria. O objetivo aqui e separar o que e guia operacional atual do que e material historico ou snapshot.

## Ordem recomendada de leitura

1. `../README.md`: visao geral do produto e mapa rapido do repositorio.
2. `arquitetura.md`: componentes, fluxos e responsabilidades.
3. `setup-e-deploy.md`: como subir localmente e publicar em producao.
4. `runbook-operacional.md`: como operar, validar e sustentar o ambiente.
5. `troubleshooting.md`: diagnostico de incidentes e falhas recorrentes.

## Documentos de referencia

- `resumo-aplicacao-ti.md`: resumo executivo para TI, acessos e requisitos de ambiente.
- `inventario_aplicacao_ti.md`: inventario tecnico historico do banco e das capacidades do sistema.

## Fontes oficiais por assunto

Quando houver divergencia entre documentos, considere como fonte oficial:

- schema e regras de banco: `../backend/app/ddl/sql/`
- contratos de CLI: `../backend/app/cli/app.py`
- configuracao de ETL: `../backend/config.yml`
- automacao agendada: `../backend/automation_config.json`
- Edge Function: `../backend/edge_function/sync_ingest/index.ts`
- catalogo de modulos publicados: `../frontend/src/modules/registry.ts`
- configuracao de build web: `../frontend/package.json`, `../frontend/vite.config.ts` e `../vercel.json`

## Como manter a documentacao profissional

- sempre documente o fluxo atual antes de remover o antigo;
- quando um documento virar snapshot historico, sinalize isso no topo;
- prefira apontar para a fonte oficial em vez de duplicar contratos longos;
- ao adicionar modulos novos, revise o `README` da raiz, `frontend/README.md` e `docs/arquitetura.md`;
- ao alterar migracoes, revise os documentos de TI quando o impacto for operacional.
