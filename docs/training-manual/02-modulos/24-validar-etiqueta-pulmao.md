# Validar Etiqueta Pulmão

## Objetivo do módulo

Validar se o código interno ou etiqueta de pulmão corresponde ao produto lido, com apoio de base local e auditoria da validação.

## Quando usar

- Quando houver checagem rápida entre produto físico e identificação interna do pulmão.
- Quando a operação quiser evitar troca de etiqueta ou erro de identificação.

## Pré-requisitos e permissões

- CD correto.
- Internet para sincronização da base.
- Base local pronta para uso offline.

## Visão da tela

- Campo dinâmico para produto e depois código interno.
- Botão de câmera com leitura distinta para barras e QR/código interno.
- Indicador de validação em andamento.
- Controles de sincronização e modo offline.

[INSERIR IMAGEM - VALIDAR ETIQUETA PULMAO - PASSO 01 - Fluxo de leitura do produto e do código interno]

## Passo a passo principal

1. Confirme o CD e o status da base local.
2. Sincronize a base caso vá trabalhar offline.
3. Leia o produto.
4. Aguarde a validação inicial.
5. Leia o código interno ou etiqueta do pulmão.
6. Confira o resultado da comparação.
7. Reinicie para o próximo item.

[INSERIR IMAGEM - VALIDAR ETIQUETA PULMAO - PASSO 02 - Scanner para código interno e retorno da validação]

## Fluxos alternativos e exceções

- O scanner muda o tipo de leitura conforme o campo ativo.
- A base local de barras deve estar pronta antes do offline.
- O módulo pode registrar auditoria local e sincronizar depois.

## Campos e botões importantes

- `Produto`: primeira leitura.
- `Código interno`: segunda leitura.
- `Trabalhar offline`: ativa base local.
- `Sincronizar`: atualiza base do dispositivo.

## Regras e validações visíveis ao usuário

> [!REGRA] Não leia o código interno antes do produto.

> [!REGRA] Sem base local pronta, o offline não deve ser usado.

## Erros comuns e como agir

> [!ERRO] `Falha ao iniciar câmera`. Troque para coletor ou digitação.

> [!ERRO] Base local vazia. Sincronize antes de continuar sem internet.

## Boas práticas

- Confirme o campo ativo antes de usar a câmera.
- Recomece a validação se a primeira leitura estiver duvidosa.
- Sincronize a base local no começo da jornada.

## FAQ rápido

- O scanner lê barras e código interno?
- Sim, o módulo alterna o tipo de leitura conforme a etapa do fluxo.
