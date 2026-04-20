# Conferência de Entrada de Notas

## Objetivo do módulo

Conferir entrada de notas por Seq/NF, leitura de barras, divergências, ocorrências e lotes conjuntos por transportadora ou fornecedor.

## Quando usar

- Quando houver recebimento por Seq/NF para conferência de itens.
- Quando a liderança precisar abrir conferência conjunta por lote do dia.

## Pré-requisitos e permissões

- CD correto.
- Internet para operação remota, cancelamentos conjuntos e relatórios.
- Base local pronta quando a equipe precisar seguir offline.

## Visão da tela

- Área de abertura por `Seq/NF ou código de barras`.
- Painel de lote ativo do dia.
- Progresso por valor conferido.
- Lista de itens da conferência com grupos por status.
- Modal de relatório e seleção por fornecedor/transportadora.

[INSERIR IMAGEM - ENTRADA DE NOTAS - PASSO 01 - Abertura de conferência e lista do dia]

## Passo a passo principal

1. Abra a conferência informando `Seq/NF` ou código de barras.
2. Quando houver várias opções, selecione o Seq/NF correto.
3. Em operação por lote, escolha os Seq/NF do mesmo grupo e inicie a conferência conjunta.
4. Durante a conferência, bique os produtos.
5. Lance ocorrência quando houver diferença, sobra, falta ou correção.
6. Revise grupos de itens, ocorrências e totais pendentes.
7. Clique em `Finalizar` e confirme o resumo.

[INSERIR IMAGEM - ENTRADA DE NOTAS - PASSO 02 - Tela de conferência com itens e ocorrências]

## Fluxos alternativos e exceções

- Conferência conjunta pode exigir internet para liberar ou cancelar o lote.
- Itens podem ficar parcialmente conferidos por outros colaboradores.
- O módulo permite retomada automática quando existe conferência válida para sua matrícula.

## Campos e botões importantes

- `Seq/NF ou barras`: abre a conferência.
- `Ocorrência`: classifica correção ou divergência do item.
- `Cancelar conferência`: encerra o processo atual.
- `Finalizar`: fecha a conferência com resumo de faltas, sobras e ocorrências.
- `Relatório`: consulta período e exporta resultados.

## Regras e validações visíveis ao usuário

> [!REGRA] Depois do primeiro produto informado, finalize pelo botão próprio. Não abandone a conferência.

> [!REGRA] Conferência conjunta precisa respeitar vínculos do lote e pode depender de internet para cancelamento.

## Erros comuns e como agir

> [!ERRO] `Conferência já finalizada`. Atualize a tela e reabra somente se existir opção formal de retomada.

> [!ERRO] `Existe conferência em andamento`. Finalize ou cancele a atual antes de abrir outro Seq/NF.

## Boas práticas

- Trabalhe um lote por vez.
- Revise os itens com ocorrência antes da finalização.
- Use o relatório para fechamento diário e apoio da liderança.

## FAQ rápido

- Posso abrir por código de barras?
- Sim, quando o módulo localizar o Seq/NF correspondente.
