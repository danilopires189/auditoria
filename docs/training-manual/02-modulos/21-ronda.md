# Ronda de Qualidade

## Objetivo do módulo

Executar auditorias de qualidade por zona de Separação ou Pulmão, registrar ocorrências, marcar correção e consultar histórico consolidado.

## Quando usar

- Quando houver ronda periódica de qualidade.
- Quando liderança precisar acompanhar correção de ocorrências por zona.

## Pré-requisitos e permissões

- CD correto.
- Internet para auditoria online e gestão de ocorrências.
- Base offline sincronizada para consulta local quando necessário.

## Visão da tela

- Sincronização da base local.
- Alternância entre zonas de `Separação` e `Pulmão`.
- Lista de zonas.
- Detalhe da zona com colunas, histórico e ocorrências.
- Composer de ocorrência com endereço e motivo.

[INSERIR IMAGEM - RONDA - PASSO 01 - Seleção de tipo de zona e lista de zonas]

## Passo a passo principal

1. Sincronize a base local se houver chance de operar sem internet.
2. Escolha `Separação` ou `Pulmão`.
3. Localize a zona desejada.
4. Inicie a auditoria da zona ou da coluna.
5. Se houver problema, abra o composer de ocorrência.
6. Informe endereço, motivo e observação quando necessário.
7. Finalize a auditoria com ou sem ocorrência.
8. Acompanhe o histórico e marque correções quando a ação corretiva ocorrer.

[INSERIR IMAGEM - RONDA - PASSO 02 - Composer de ocorrência e histórico da zona]

## Fluxos alternativos e exceções

- O módulo aceita auditoria sem ocorrência.
- Meses anteriores ficam como consulta e correção, não como nova auditoria.
- Admin pode excluir ocorrência.
- Histórico consolidado pode ser filtrado por mês, tipo, status e busca textual.

## Campos e botões importantes

- `Sincronizar base`: atualiza snapshot local.
- `Off-Line`: ativa uso local da base.
- `Ocorrências`: abre histórico consolidado.
- `Finalizar Auditoria`: encerra a sessão ativa.
- `Corrigido/Não corrigido`: status da ação corretiva.

## Regras e validações visíveis ao usuário

> [!REGRA] Sem base local sincronizada, o offline não deve ser ativado.

> [!REGRA] Nova auditoria não é aberta em mês histórico de consulta.

> [!REGRA] Auditoria com ocorrência pede dados mínimos válidos do endereço e motivo.

## Erros comuns e como agir

> [!ERRO] `Sem base local da Ronda`. Conecte-se e sincronize antes de trabalhar offline.

> [!ERRO] `Conecte-se à internet para registrar a auditoria`. Volte ao online antes de salvar.

## Boas práticas

- Feche uma auditoria antes de iniciar outra zona.
- Marque correção assim que a ação de campo acontecer.
- Use histórico para acompanhar reincidência.

## FAQ rápido

- Posso auditar sem ocorrência?
- Sim, o módulo possui fluxo específico para auditoria sem ocorrência.
