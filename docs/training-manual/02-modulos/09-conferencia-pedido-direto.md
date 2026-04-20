# Conferência de Pedido Direto

## Objetivo do módulo

Conferir volumes de Pedido Direto por leitura de etiqueta e de barras, com divergências, visão por rota e filial, retomada e operação offline.

## Quando usar

- Quando houver volume de Pedido Direto para conferência.
- Quando a operação precisar revisar status por rota ou loja.

## Pré-requisitos e permissões

- CD correto.
- Base local do manifesto e de barras para uso offline.
- Internet para sincronização, retomada remota e relatório.

## Visão da tela

- Abertura por `PedidoSeq` do volume.
- Lista por rota, filial e status.
- Área da conferência ativa com código de barras e múltiplo.
- Resumo de divergências e finalização.

[INSERIR IMAGEM - PEDIDO DIRETO - PASSO 01 - Tela de abertura e visão por rota]

## Passo a passo principal

1. Atualize a base local se houver chance de operar offline.
2. Abra o volume pelo `PedidoSeq` ou pela etiqueta correspondente.
3. Na conferência ativa, bique os produtos.
4. Ajuste múltiplo quando a leitura representar mais de uma unidade.
5. Revise faltas, sobras e itens corretos.
6. Finalize a conferência pelo resumo final.

[INSERIR IMAGEM - PEDIDO DIRETO - PASSO 02 - Conferência ativa com grupos de itens]

## Fluxos alternativos e exceções

- O módulo pode retomar automaticamente uma conferência válida.
- Conferência parcialmente finalizada pode ser reaberta conforme regra do sistema.
- Em offline, a base local precisa estar pronta antes da abertura.

## Campos e botões importantes

- `PedidoSeq`: referência do volume.
- `Código de barras`: leitura do item.
- `Múltiplo`: quantidade por bipagem.
- `Finalizar`: fecha o volume.
- `Relatório`: exporta consolidado do período.

## Regras e validações visíveis ao usuário

> [!REGRA] Só abra outro volume depois de finalizar ou cancelar o atual.

> [!REGRA] Sem base local pronta, o offline não deve ser iniciado.

## Erros comuns e como agir

> [!ERRO] `Conferência reaberta`. Continue somente os itens pendentes e não repita itens corretos bloqueados.

> [!ERRO] `Volume já finalizado`. Atualize a tela e confirme o status antes de tentar nova abertura.

## Boas práticas

- Trabalhe um volume por vez.
- Confira rota e filial antes de iniciar.
- Revise divergências antes da finalização.

## FAQ rápido

- Posso continuar offline?
- Sim, desde que o manifesto e a base de barras já estejam baixados.
