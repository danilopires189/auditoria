# Auditoria de Caixa

## Objetivo do módulo

Registrar auditoria de volumes por etiqueta, com vínculo de rota e filial, controle de ocorrências e feed do dia.

## Quando usar

- Quando houver validação operacional de volume de caixa.
- Quando a equipe precisar registrar não conformidades por etiqueta.
- Quando liderança precisar consultar feed do dia ou relatório administrativo.

## Pré-requisitos e permissões

- CD correto no topo da tela.
- Base de rotas atualizada para uso offline local.
- Internet para sincronização, feed compartilhado e relatório admin.

## Visão da tela

- Campo principal para etiqueta do volume.
- Campo opcional para ID Knapp quando exigido.
- Campo de ocorrência com seleção múltipla de não conformidades.
- Feed de hoje agrupado por rota e filial.
- Botões para `Trabalhar offline`, `Atualizar base` e `Sincronizar`.

[INSERIR IMAGEM - AUDITORIA DE CAIXA - PASSO 01 - Tela principal com campo de etiqueta, ocorrência e feed]

## Passo a passo principal

1. Confirme o CD ativo e o status online.
2. Se for operar sem internet, ative `Trabalhar offline` somente depois de atualizar a base local de rotas.
3. Bipe ou digite a etiqueta do volume.
4. Informe o ID Knapp quando a rotina exigir complemento.
5. Abra o seletor de ocorrência quando houver não conformidade.
6. Salve o registro e confira se entrou no feed do dia.
7. Se estiver online, aguarde sincronização automática ou use sincronização manual.

[INSERIR IMAGEM - AUDITORIA DE CAIXA - PASSO 02 - Modal de seleção de não conformidades]

## Fluxos alternativos e exceções

- Em volume misturado, a tela abre aviso específico antes da gravação.
- Se a internet cair no mobile, continue no modo offline somente com base local válida.
- No desktop, a auditoria funciona somente online.
- O relatório administrativo fica disponível para perfil admin em ambiente compatível.

## Campos e botões importantes

- `Etiqueta`: volume auditado.
- `Ocorrência`: não conformidade encontrada no volume.
- `Trabalhar offline`: ativa uso local de rotas no dispositivo.
- `Atualizar feed/base`: baixa base mais recente e tenta enviar pendências.
- `Relatório de Auditoria de Caixa`: consulta e exporta por período.

## Regras e validações visíveis ao usuário

> [!REGRA] Sem base local de rotas não é permitido trabalhar offline.

> [!REGRA] A auditoria sem internet no desktop é bloqueada.

> [!REGRA] Etiqueta inválida ou mal lida impede o salvamento.

## Erros comuns e como agir

> [!ERRO] `Sem base local de rotas`. Conecte o dispositivo, atualize a base e tente novamente.

> [!ERRO] `Você está sem internet`. Ative o offline local ou volte para uma rede estável.

> [!ERRO] `Falha ao iniciar câmera`. Use bipagem pelo coletor ou digitação manual até normalizar a permissão da câmera.

## Boas práticas

- Feche uma auditoria antes de iniciar outra etiqueta.
- Revise a ocorrência antes de salvar.
- Atualize a base de rotas no início do turno.
- Use o feed para checar duplicidade e contexto por rota.

## FAQ rápido

- Posso editar ou excluir meu próprio lançamento?
- Sim, quando a linha ainda permitir gerenciamento pelo seu usuário.

- O que fazer se aparecer pendência local?
- Sincronize quando a internet voltar e confira a tela de pendências.
