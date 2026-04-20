# Atividade Extra

## Objetivo do módulo

Registrar, editar, excluir e aprovar atividades extras com pontuação no mês corrente.

## Quando usar

- Quando houver lançamento de produtividade complementar.
- Quando liderança precisar aprovar ou acompanhar extras pendentes.

## Pré-requisitos e permissões

- Usuário autenticado.
- Perfil compatível com lançamento ou aprovação.
- Internet para persistir dados do mês.

## Visão da tela

- Formulário de lançamento.
- Lista das atividades do período.
- Indicadores de pendência de aprovação.
- Controles de edição, exclusão e aprovação.

[INSERIR IMAGEM - ATIVIDADE EXTRA - PASSO 01 - Tela do formulário e lista de registros]

## Passo a passo principal

1. Abra o módulo e confirme o mês de referência.
2. Preencha a atividade, matrícula envolvida e quantidade ou pontuação.
3. Revise o lançamento antes de salvar.
4. Acompanhe a lista do período.
5. Se for liderança, localize os itens pendentes e aprove ou recuse conforme a rotina.

## Fluxos alternativos e exceções

- Itens já lançados podem ser editados ou excluídos quando a regra permitir.
- O menu inicial pode exibir badge com pendências de aprovação.

## Campos e botões importantes

- `Matrícula`: colaborador do lançamento.
- `Quantidade/Pontos`: medida usada no cálculo.
- `Salvar`: grava o lançamento.
- `Aprovar`: conclui o fluxo gerencial.

## Regras e validações visíveis ao usuário

> [!REGRA] Só lance atividade realmente executada e validada pela rotina local.

> [!REGRA] Lançamentos pendentes de aprovação podem afetar leitura de produtividade até decisão final.

## Erros comuns e como agir

> [!ERRO] Quantidade inválida. Revise formato numérico antes de salvar.

> [!ERRO] Matrícula incorreta. Confirme o colaborador antes de aprovar.

## Boas práticas

- Lance no mesmo dia da execução.
- Revise duplicidades antes de salvar.
- Aprove pendências diariamente para não acumular fila.

## FAQ rápido

- Posso lançar para outra pessoa?
- Somente quando sua rotina e perfil permitirem esse tipo de registro.
