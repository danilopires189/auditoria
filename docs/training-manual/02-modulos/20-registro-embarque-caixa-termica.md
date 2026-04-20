# Registro de Embarque - Caixa Térmica

## Objetivo do módulo

Cadastrar caixas térmicas, expedir por etiqueta de volume, receber retorno com observação de avarias e consultar histórico de movimentação.

## Quando usar

- Quando houver controle operacional de caixas térmicas.
- Quando a equipe precisar registrar expedição, recebimento ou manutenção de cadastro.

## Pré-requisitos e permissões

- CD correto.
- Internet para expedição e recebimento.
- Base local de rotas atualizada para apoio offline do cadastro e consulta.

## Visão da tela

- Busca por código ou descrição.
- Feed do dia.
- Modal de cadastro de nova caixa.
- Modal de expedição.
- Modal de recebimento.
- Histórico da caixa.

[INSERIR IMAGEM - CAIXA TERMICA - PASSO 01 - Feed do dia e busca de caixas]

## Passo a passo principal

1. Confirme o CD e a base local de rotas.
2. Para nova caixa, abra `Registrar Nova Caixa Térmica`.
3. Preencha código, descrição, capacidade e avarias existentes, se houver.
4. Para expedir, abra a ação da caixa disponível.
5. Leia ou digite a etiqueta do volume e informe a placa.
6. Confirme a expedição.
7. Para receber, abra a ação da caixa em trânsito.
8. Marque `Recebido sem avarias` ou descreva as avarias encontradas.

[INSERIR IMAGEM - CAIXA TERMICA - PASSO 02 - Modal de expedição e modal de recebimento]

## Fluxos alternativos e exceções

- O cadastro pode ser salvo localmente e sincronizado depois.
- Expedição e recebimento exigem internet.
- O histórico mostra rota, filial e observações de avaria por movimento.

## Campos e botões importantes

- `Registrar Nova Caixa Térmica`: cadastro inicial.
- `Expedir Caixa`: saída vinculada a etiqueta e placa.
- `Receber Caixa`: retorno com condição física.
- `Histórico`: rastreia movimentações anteriores.

## Regras e validações visíveis ao usuário

> [!REGRA] Recebimento exige marcar `sem avarias` ou descrever a avaria.

> [!REGRA] Sem base de rotas, o trabalho offline fica incompleto.

## Erros comuns e como agir

> [!ERRO] `Caixa não encontrada neste CD`. Revise o código e o contexto do CD.

> [!ERRO] `Expedição requer conexão`. Reconecte o dispositivo antes de concluir a saída.

## Boas práticas

- Mantenha a descrição padronizada no cadastro.
- Registre avaria no recebimento com detalhe suficiente para rastreio.
- Consulte o histórico antes de excluir ou editar uma caixa.

## FAQ rápido

- O módulo usa câmera?
- Sim, para ler código da caixa e etiqueta de volume quando necessário.
