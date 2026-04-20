# Conferência de Transferência CD

## Objetivo do módulo

Conferir notas de transferência entre CDs, por etapa de saída ou entrada, com leitura de NF e barras, lote multi-NF, ocorrências e conciliação em relatório.

## Quando usar

- Quando houver mercadoria a enviar ou a receber entre CDs.
- Quando a liderança precisar conciliar saída e entrada por NF.

## Pré-requisitos e permissões

- CD correto.
- Internet para baixar base, abrir lote multi-NF e sincronizar conferências.
- Base local e barras atualizadas para uso offline.

## Visão da tela

- Sincronização da base.
- Seletor de CD.
- Abertura por número da NF.
- Modal de notas do dia.
- Conferência ativa por NF ou lote.
- Relatório de conciliação.

[INSERIR IMAGEM - TRANSFERENCIA CD - PASSO 01 - Abertura por NF e visão geral de progresso]

## Passo a passo principal

1. Sincronize a base de Transferência CD e barras.
2. Confirme o CD ativo.
3. Abra a NF informando o número ou usando a câmera.
4. Se necessário, abra o modal de notas e monte um lote da mesma etapa.
5. Na conferência ativa, bique os produtos.
6. Ajuste múltiplo e, na etapa de entrada, marque ocorrência `Avariado` ou `Vencido` quando necessário.
7. Revise grupos de `não conferido`, `falta`, `sobra` e `correto`.
8. Finalize a conferência.

[INSERIR IMAGEM - TRANSFERENCIA CD - PASSO 02 - Conferência ativa com grupos de itens e ocorrência]

## Fluxos alternativos e exceções

- Lote multi-NF exige internet para seguir conferência.
- Conferências podem ficar como pendência local até reconectar.
- O módulo oferece lista de pendências locais com descarte controlado.

## Campos e botões importantes

- `NF`: abertura da conferência.
- `Código de barras`: leitura do item.
- `Múltiplo`: quantidade por leitura.
- `Ocorrência`: usada na etapa de recebimento.
- `Relatório`: exporta conciliação entre origem e destino.

## Regras e validações visíveis ao usuário

> [!REGRA] Não misture etapas diferentes no mesmo lote.

> [!REGRA] Só abra nova NF depois de finalizar ou cancelar a atual.

## Erros comuns e como agir

> [!ERRO] `Lote multi-NF precisa estar online`. Volte à rede antes de continuar.

> [!ERRO] Pendência local com erro. Revise a lista de pendências e sincronize ou descarte conforme orientação da liderança.

## Boas práticas

- Separe bem mercadoria a enviar e a receber.
- Revise o resumo final antes de confirmar.
- Não descarte pendência local sem validar impacto com a operação.

## FAQ rápido

- O relatório mostra conciliação?
- Sim, o módulo possui relatório próprio de conferência de transferência CD.
