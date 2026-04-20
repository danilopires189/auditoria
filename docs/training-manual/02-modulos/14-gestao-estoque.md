# Gestão de Estoque

## Objetivo do módulo

Executar ajuste diário de estoque, inclusão de itens, baixa com motivo, revisão do dia, consulta de histórico, lista de não atendido e lista em recebimento.

## Quando usar

- Quando houver ajuste operacional de estoque.
- Quando liderança precisar revisar o dia ou consultar histórico de produto.
- Quando a equipe precisar tratar itens não atendidos ou em recebimento.

## Pré-requisitos e permissões

- CD correto.
- Internet para consultar listas e gravar ações.
- Perfil com permissão para ajuste, revisão ou exclusão.

## Visão da tela

- Busca por produto.
- Pré-visualização com estoque atual e disponível.
- Modos de lista: operacional, não atendido e em recebimento.
- Área de revisão do dia.
- Histórico do produto e registros excluídos.

[INSERIR IMAGEM - GESTAO ESTOQUE - PASSO 01 - Tela de ajuste diário com busca e preview]

## Passo a passo principal

1. Escolha o modo de trabalho: operacional, não atendido ou em recebimento.
2. Localize o produto por bipagem ou digitação.
3. Confira a pré-visualização do item, estoque atual e disponível.
4. Se for ajuste, informe a quantidade e o tipo de movimento.
5. Em baixa, escolha o motivo obrigatório.
6. Salve o lançamento.
7. Revise a lista do dia e o status de revisão.

[INSERIR IMAGEM - GESTAO ESTOQUE - PASSO 02 - Lista operacional com ocorrência, estoque e ações]

## Fluxos alternativos e exceções

- O módulo permite abrir histórico do produto.
- Há consulta específica para itens excluídos.
- `Não atendido` e `Em recebimento` funcionam como visões próprias da operação.
- Liderança pode marcar o dia como revisado.

## Campos e botões importantes

- `Localizar produto`: inicia a operação.
- `Motivo da baixa`: obrigatório quando o movimento for baixa.
- `Revisado`: status da revisão diária.
- `Em Recebimento`: visão de itens em entrada.
- `Não Atendido`: visão de itens pendentes por atendimento.

## Regras e validações visíveis ao usuário

> [!REGRA] Baixa sem motivo não deve ser confirmada.

> [!REGRA] Revise o produto certo antes de excluir ou alterar quantidade.

## Erros comuns e como agir

> [!ERRO] Produto incorreto na busca. Confira CODDV, descrição e zona antes de salvar.

> [!ERRO] Ajuste sem motivo. Preencha o motivo da baixa quando a tela exigir.

## Boas práticas

- Sempre confirme estoque atual e disponível antes do ajuste.
- Revise a lista do dia antes de marcar como revisado.
- Use o histórico do produto para validar comportamento fora do padrão.

## FAQ rápido

- O módulo mostra itens excluídos?
- Sim, existe visão específica para registros excluídos.
