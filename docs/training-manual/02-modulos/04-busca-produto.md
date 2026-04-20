# Busca por Produto

## Objetivo do módulo

Consultar produto por código de barras ou código interno e visualizar resumo, endereços de Separação, endereços de Pulmão e endereços excluídos.

## Quando usar

- Quando a operação precisa localizar rapidamente onde o produto está cadastrado.
- Quando houver dúvida de endereço ou disponibilidade operacional.

## Pré-requisitos e permissões

- CD correto.
- Internet para consulta atual.
- Permissão de câmera opcional para leitura por imagem.

## Visão da tela

- Campo único de busca.
- Botão de câmera.
- Botão `Buscar produto`.
- Blocos de resumo do produto e listas de endereços.

[INSERIR IMAGEM - BUSCA PRODUTO - PASSO 01 - Campo de busca e cartões de resultado]

## Passo a passo principal

1. Bipe, digite ou leia o código pela câmera.
2. Clique em `Buscar produto` quando a leitura não disparar automaticamente.
3. Confira o resumo do produto localizado.
4. Analise as listas de endereços de Separação, Pulmão e excluídos.
5. Use a informação encontrada para orientar a operação seguinte.

## Fluxos alternativos e exceções

- A pesquisa aceita código de barras e código interno quando o formato for reconhecido.
- Se a câmera falhar, continue com bipagem direta ou digitação.

## Campos e botões importantes

- `Buscar produto`: executa a consulta.
- `Scanner de barras`: lê automaticamente pela câmera.
- `Resumo do Produto`: confirma descrição e referência buscada.

## Regras e validações visíveis ao usuário

> [!REGRA] Produto não encontrado pode significar CD incorreto, leitura ruim ou ausência na base atual.

## Erros comuns e como agir

> [!ERRO] `Produto não encontrado`. Confira código, CD e integridade da leitura.

> [!ERRO] Falha na câmera. Refaça a leitura por coletor.

## Boas práticas

- Confirme a descrição antes de orientar alguém.
- Leia o código inteiro, sem cortar dígitos.
- Use o módulo como apoio de localização, não como substituto da conferência operacional.

## FAQ rápido

- Posso usar código interno?
- Sim, quando o formato for aceito pela busca do módulo.
