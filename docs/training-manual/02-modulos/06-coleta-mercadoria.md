# Coleta de Mercadoria

## Objetivo do módulo

Registrar coletas de mercadoria por código de barras, quantidade, ocorrência, lote e validade, com suporte a operação offline e relatório administrativo.

## Quando usar

- Quando a equipe precisa lançar coleta operacional do dia.
- Quando houver ocorrência de item avariado ou vencido durante a coleta.

## Pré-requisitos e permissões

- CD correto.
- Base de barras sincronizada para operação offline.
- Internet para sincronização e relatório.

## Visão da tela

- Campo de código de barras.
- Quantidade, ocorrência, lote e validade.
- Lista de coletas de hoje.
- Botões para `Trabalhar offline`, atualizar e sincronizar.

[INSERIR IMAGEM - COLETA MERCADORIA - PASSO 01 - Tela de coleta com código, quantidade e lista do dia]

## Passo a passo principal

1. Confirme o CD e o status da conexão.
2. Se necessário, ative o offline depois de carregar a base local de barras.
3. Bipe ou digite o código de barras.
4. Ajuste a quantidade.
5. Preencha ocorrência, lote e validade quando se aplicarem.
6. Clique em `Salvar coleta`.
7. Confira se o item entrou em `Coletas de hoje`.
8. Sincronize pendências quando a internet estiver disponível.

[INSERIR IMAGEM - COLETA MERCADORIA - PASSO 02 - Exemplo de ocorrência, lote e validade]

## Fluxos alternativos e exceções

- Em mobile a câmera pode ser usada para leitura automática.
- O módulo aceita edição e exclusão de registros conforme permissão.
- Admin pode buscar coletas por período e exportar relatório.

## Campos e botões importantes

- `Código de barras`: item a coletar.
- `Quantidade`: múltiplo da coleta.
- `Ocorrência`: `Avariado` ou `Vencido`.
- `Trabalhar offline`: usa base local de barras.
- `Sincronizar`: envia pendências.

## Regras e validações visíveis ao usuário

> [!REGRA] Sem base de barras válida, a coleta offline não deve ser iniciada.

> [!REGRA] Validade precisa respeitar o formato solicitado pela tela.

## Erros comuns e como agir

> [!ERRO] `Sem base local`. Atualize a base antes de desligar a internet.

> [!ERRO] Produto não encontrado. Confirme a leitura do código e o CD ativo.

## Boas práticas

- Mantenha lote e validade preenchidos quando a coleta exigir rastreabilidade.
- Revise duplicidades na lista do dia.
- Sincronize antes de trocar de turno.

## FAQ rápido

- Posso continuar sem internet?
- Sim, quando a base local já estiver carregada no dispositivo.
