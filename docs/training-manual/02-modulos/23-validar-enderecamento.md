# Validar Endereçamento

## Objetivo do módulo

Validar se o endereço lido bate com o endereço esperado do produto, com apoio de consulta online/offline e auditoria do evento.

## Quando usar

- Quando a operação precisar confirmar se o produto está no endereço SEP correto.
- Quando houver auditoria rápida de endereçamento em campo.

## Pré-requisitos e permissões

- CD correto.
- Internet para sincronização e atualização da base.
- Base local pronta quando a equipe usar offline.

## Visão da tela

- Campo dinâmico para `Produto` e depois `Endereço`.
- Botão de câmera para leitura do código certo em cada etapa.
- Indicador de validação em andamento.
- Botões para sincronizar base e ativar offline.

[INSERIR IMAGEM - VALIDAR ENDERECAMENTO - PASSO 01 - Fluxo de leitura do produto e depois do endereço]

## Passo a passo principal

1. Confirme o CD ativo.
2. Se necessário, sincronize a base local e ative o offline.
3. No primeiro passo, leia o produto.
4. Aguarde a validação do produto.
5. No segundo passo, leia o endereço informado na operação.
6. Confira o resultado da validação.
7. Reinicie o fluxo para o próximo item.

[INSERIR IMAGEM - VALIDAR ENDERECAMENTO - PASSO 02 - Resultado positivo e resultado de divergência]

## Fluxos alternativos e exceções

- A leitura pode ser feita por coletor ou câmera.
- O módulo aceita modo offline quando a base já foi baixada.
- Produto sem endereço SEP cadastrado gera erro específico.

## Campos e botões importantes

- `Produto (código de barras)`: primeira etapa.
- `Endereço`: segunda etapa.
- `Trabalhar offline`: usa base local.
- `Sincronizar`: atualiza a base local.

## Regras e validações visíveis ao usuário

> [!REGRA] A validação só faz sentido depois do produto correto ser reconhecido.

> [!REGRA] Produto sem endereço SEP válido não deve seguir como confirmação de endereço.

## Erros comuns e como agir

> [!ERRO] `Produto não informado`. Recomece pela leitura do produto.

> [!ERRO] `Produto sem endereço SEP cadastrado`. Trate como exceção cadastral e não force confirmação.

## Boas práticas

- Leia produto e endereço sem trocar a ordem.
- Recomece o fluxo sempre que houver dúvida de leitura.
- Atualize a base local no início do turno.

## FAQ rápido

- Posso usar câmera nas duas etapas?
- Sim, o botão muda conforme o campo ativo.
