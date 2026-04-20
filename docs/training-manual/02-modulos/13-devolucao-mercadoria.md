# Devolução de Mercadoria

## Objetivo do módulo

Conferir devoluções por NFD ou chave, com leitura de barras, divergências, lotes, validades e fluxo especial para devolução sem NFD.

## Quando usar

- Quando houver devolução formal por NFD ou chave.
- Quando houver exceção operacional de devolução sem NFD com justificativa.

## Pré-requisitos e permissões

- CD correto.
- Internet para maior parte das aberturas e retomadas remotas.
- Base local pronta para operação offline quando liberada pelo processo.

## Visão da tela

- Campo `NFD ou Chave`.
- Abertura de devolução sem NFD.
- Conferência ativa com leitura de barras.
- Campos de lote, validade, NFO e motivo.
- Histórico por volume e relatório.

[INSERIR IMAGEM - DEVOLUCAO - PASSO 01 - Abertura por NFD ou chave]

## Passo a passo principal

1. Abra a devolução informando `NFD` ou `Chave`.
2. Se houver mais de uma opção possível, escolha a devolução correta.
3. Na conferência ativa, bique os produtos.
4. Informe lotes e validades quando a rastreabilidade exigir.
5. Revise faltas, sobras e itens corretos.
6. Em devolução sem NFD, preencha NFO e motivo obrigatório.
7. Finalize a conferência pelo resumo final.

[INSERIR IMAGEM - DEVOLUCAO - PASSO 02 - Conferência ativa com lotes, validades e divergências]

## Fluxos alternativos e exceções

- O módulo pode reabrir conferência parcial quando houver pendência real.
- Há fluxo de `sem NFD` para cenário excepcional.
- Certos motivos permitem coleta mais livre sem divergência padrão.

## Campos e botões importantes

- `NFD ou Chave`: referência principal da devolução.
- `NFO`: obrigatório no fluxo sem NFD.
- `Motivo sem NFD`: justifica a exceção.
- `Lote` e `Validade`: apoio de rastreabilidade.
- `Finalizar`: fecha a conferência.

## Regras e validações visíveis ao usuário

> [!REGRA] Em devolução sem NFD, `NFO` e motivo são obrigatórios.

> [!REGRA] Só é permitido uma devolução em andamento por matrícula.

> [!REGRA] NFD ambígua deve ser resolvida pela chave correta.

## Erros comuns e como agir

> [!ERRO] `NFD/Chave não encontrado`. Revise o documento e confirme o CD.

> [!ERRO] `Conferência em andamento`. Finalize ou cancele a devolução atual antes de abrir outra.

> [!ERRO] `Produto fora da NFD`. Pare, confirme a leitura e trate como exceção operacional.

## Boas práticas

- Confirme se a devolução é com ou sem NFD antes de abrir.
- Preencha rastreabilidade sempre que disponível.
- Revise faltas e sobras antes da finalização.

## FAQ rápido

- Posso iniciar sem NFD?
- Sim, mas somente pelo fluxo próprio e com justificativa completa.
