# Controle de Validade

## Objetivo do módulo

Registrar coletas e retiradas ligadas ao controle de validade, com busca de produto, endereço, histórico recente e suporte a base offline.

## Quando usar

- Quando a operação precisar registrar validade coletada em linha.
- Quando houver retirada por endereço ou por item com necessidade de histórico.

## Pré-requisitos e permissões

- CD correto.
- Internet para sincronização e atualização da base.
- Base offline baixada quando a equipe precisar trabalhar sem rede.

## Visão da tela

- Campo de busca por código de barras.
- Campo de validade.
- Área de última coleta.
- Campos de retirada e edição de quantidades.
- Scanner de barras por câmera.

[INSERIR IMAGEM - CONTROLE VALIDADE - PASSO 01 - Tela principal com busca, validade e histórico]

## Passo a passo principal

1. Confirme o CD e, se necessário, baixe a base para uso offline.
2. Bipe o produto ou use a busca da câmera.
3. Consulte o produto retornado.
4. Informe a validade no formato pedido pela tela.
5. Salve a coleta.
6. Quando precisar retirar, localize a última coleta por endereço, CODDV ou barras.
7. Ajuste quantidade de retirada e salve.

[INSERIR IMAGEM - CONTROLE VALIDADE - PASSO 02 - Exemplo de coleta e retirada com edição]

## Fluxos alternativos e exceções

- É possível buscar a última coleta para decidir a retirada correta.
- Algumas linhas aceitam edição posterior de validade ou quantidade.
- O módulo mantém controles separados para coleta e retirada.

## Campos e botões importantes

- `Buscar`: localiza o produto.
- `Salvar coleta`: grava a validade coletada.
- `Buscar última coleta`: recupera histórico operacional.
- `Qtd`: quantidade usada na retirada ou ajuste.

## Regras e validações visíveis ao usuário

> [!REGRA] A validade deve respeitar o formato exigido pela tela.

> [!REGRA] Trabalhar offline depende da base baixada no dispositivo.

## Erros comuns e como agir

> [!ERRO] Produto não localizado. Revise a leitura do código e o CD ativo.

> [!ERRO] Formato de validade incorreto. Reescreva a validade no padrão pedido.

## Boas práticas

- Busque a última coleta antes de alterar uma retirada.
- Trabalhe um item por vez para evitar confusão entre endereços.
- Sincronize pendências no fim da rotina.

## FAQ rápido

- O módulo guarda histórico recente?
- Sim, a tela permite consultar a última coleta para apoiar a retirada.
