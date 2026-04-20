# Check List

## Objetivo do módulo

Executar auditorias estruturadas por checklist, com cálculo de conformidade, assinatura eletrônica e consulta administrativa com geração de PDF.

## Quando usar

- Quando houver auditoria formal por colaborador ou por CD.
- Quando a rotina exigir checklist temático, como DTO, prevenção de perdas ou riscos.

## Pré-requisitos e permissões

- Internet ativa.
- CD definido no perfil.
- Matrícula do colaborador avaliado quando o checklist exigir avaliação individual.

## Visão da tela

- Seletor de checklist.
- Cabeçalho com progresso e resultado parcial.
- Seções com perguntas e respostas.
- Campo de observações.
- Confirmação de assinatura eletrônica.

[INSERIR IMAGEM - CHECK LIST - PASSO 01 - Seletor de checklist com opções disponíveis]

## Passo a passo principal

1. Selecione o checklist correto.
2. Se o modelo exigir, informe a matrícula do colaborador avaliado.
3. Responda todos os itens por seção.
4. Registre observação geral quando houver não conformidade.
5. Marque o aceite de assinatura eletrônica.
6. Revise o resultado parcial exibido no topo.
7. Clique em `Finalizar checklist` e confirme.

[INSERIR IMAGEM - CHECK LIST - PASSO 02 - Formulário com seções, observações e assinatura]

## Fluxos alternativos e exceções

- Alguns checklists são por colaborador e exigem busca no `DB_USUARIO`.
- Outros são por CD e não pedem avaliado individual.
- Perfil admin pode consultar histórico e emitir PDF de auditorias concluídas.

## Campos e botões importantes

- `Trocar checklist`: volta ao seletor inicial.
- `Matrícula`: busca o colaborador avaliado.
- `Observações`: detalha não conformidades.
- `Finalizar checklist`: grava a auditoria.
- `Admin`: consulta lista histórica e gera PDF.

## Regras e validações visíveis ao usuário

> [!REGRA] Todos os itens precisam estar respondidos antes da finalização.

> [!REGRA] Quando houver não conformidade, a observação geral é obrigatória.

> [!REGRA] Sem assinatura eletrônica o checklist não é concluído.

## Erros comuns e como agir

> [!ERRO] `Informe a matrícula do colaborador avaliado`. Faça a busca online e valide o nome retornado.

> [!ERRO] `Responda todos os itens`. Revise seções com perguntas em branco.

## Boas práticas

- Escolha o checklist com calma antes de começar.
- Faça observações objetivas e úteis para ação corretiva.
- Em auditoria por colaborador, confirme nome e matrícula antes de finalizar.

## FAQ rápido

- Posso gerar evidência em PDF?
- Sim, pelo fluxo de consulta detalhada do módulo.
