# Conferência de Volume Avulso

## Objetivo do módulo

Conferir volumes avulsos por número do volume, leitura de barras e controle de divergências por rota.

## Quando usar

- Quando a operação trabalhar com volume avulso fora do fluxo padrão de termo ou pedido direto.

## Pré-requisitos e permissões

- CD correto.
- Internet para sincronização e consulta do estado atual.
- Base local pronta para suporte offline, quando aplicável.

## Visão da tela

- Campo `NR Volume`.
- Campo de leitura de barras.
- Lista por rota e status.
- Área de faltas e finalização.

[INSERIR IMAGEM - VOLUME AVULSO - PASSO 01 - Abertura por número do volume]

## Passo a passo principal

1. Informe o número do volume.
2. Abra a conferência do volume correto.
3. Bipe os produtos.
4. Registre motivo da falta quando existir divergência.
5. Revise o resumo.
6. Finalize a conferência.

## Fluxos alternativos e exceções

- Pode haver retomada de conferência parcial conforme o status do volume.
- A visão por rota ajuda a localizar pendências do dia.

## Campos e botões importantes

- `NR Volume`: referência principal.
- `Código de barras`: leitura dos itens.
- `Motivo da falta`: registro de exceção.
- `Finalizar`: fechamento do volume.

## Regras e validações visíveis ao usuário

> [!REGRA] O número do volume precisa estar correto para evitar abertura indevida.

## Erros comuns e como agir

> [!ERRO] Volume não encontrado. Confirme a origem do número informado.

## Boas práticas

- Confira o status do volume antes de abrir.
- Revise divergências antes de finalizar.

## FAQ rápido

- Posso buscar por status?
- Sim, a visão geral permite pesquisa por volume, status e quantidade.
