# Controle de Avarias

## Objetivo do módulo

Registrar avarias por produto com situação, origem, lote, validade e sincronização local, incluindo feed do dia e relatório administrativo.

## Quando usar

- Quando um item avariado for identificado na operação.
- Quando a liderança precisar consolidar avarias por período.

## Pré-requisitos e permissões

- CD correto.
- Base de barras disponível para consulta local.
- Internet para relatório e sincronização imediata.

## Visão da tela

- Campo de código de barras.
- Quantidade.
- Situação da avaria.
- Origem da ocorrência.
- Lote e validade opcionais.
- Lista de avarias do dia.

[INSERIR IMAGEM - CONTROLE AVARIAS - PASSO 01 - Formulário de lançamento e lista do dia]

## Passo a passo principal

1. Confirme o CD e, se necessário, ative o offline após atualizar a base.
2. Bipe o código de barras.
3. Informe a quantidade.
4. Escolha a situação da avaria.
5. Escolha a origem do problema.
6. Preencha lote e validade quando exigirem rastreabilidade.
7. Salve o lançamento.
8. Revise a lista de `Avarias de hoje`.

[INSERIR IMAGEM - CONTROLE AVARIAS - PASSO 02 - Scanner de barras e seleção de situação/origem]

## Fluxos alternativos e exceções

- Mobile permite scanner por câmera com flash.
- Linhas podem ser editadas ou excluídas conforme permissão.
- Admin pode consultar relatório por período e exportar planilha.

## Campos e botões importantes

- `Situação`: estado físico da avaria.
- `Origem`: onde o problema ocorreu.
- `Atualizar avarias de hoje`: recarrega feed compartilhado.
- `Sincronizar`: envia pendências.

## Regras e validações visíveis ao usuário

> [!REGRA] Avaria sem situação e sem origem não deve ser salva.

> [!REGRA] No offline, a base local precisa existir antes do lançamento.

## Erros comuns e como agir

> [!ERRO] `Câmera não disponível`. Continue com coletor ou digitação.

> [!ERRO] `Pendência de sincronização`. Mantenha o registro e envie quando a conexão voltar.

## Boas práticas

- Escolha a origem real do problema.
- Use lote e validade sempre que isso ajudar a rastrear o item.
- Não deixe pendências acumuladas.

## FAQ rápido

- Quem pode editar uma avaria?
- O próprio responsável e, em alguns casos, perfil admin.
