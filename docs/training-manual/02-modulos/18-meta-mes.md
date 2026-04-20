# Meta Mês

## Objetivo do módulo

Planejar e acompanhar meta diária e meta mensal por atividade, com resumo executivo, ritmo diário e marcação de feriados.

## Quando usar

- Quando liderança precisar definir meta do mês.
- Quando a equipe quiser acompanhar atingido versus planejado ao longo dos dias úteis.

## Pré-requisitos e permissões

- Internet ativa.
- CD definido.
- Perfil admin para alterar meta diária e feriados do mês corrente.

## Visão da tela

- Seleção de atividade e mês.
- Planejamento mensal.
- Regra de cálculo.
- Gráfico `Meta x Atingido por dia`.
- Tabela de controle diário.

[INSERIR IMAGEM - META MES - PASSO 01 - Planejamento mensal com atividade e meta diária]

## Passo a passo principal

1. Selecione a atividade desejada.
2. Escolha o mês de referência.
3. Leia o resumo executivo do período.
4. Se for admin e o mês estiver aberto, ajuste a meta diária.
5. Marque ou desmarque feriados quando necessário.
6. Acompanhe o gráfico de ritmo diário.
7. Consulte a tabela de controle diário para entender meta, realizado e saldo.

[INSERIR IMAGEM - META MES - PASSO 02 - Gráfico de ritmo diário e tabela do mês]

## Fluxos alternativos e exceções

- Meses anteriores ficam travados para consulta histórica.
- A meta do mês é recalculada automaticamente com base nos dias úteis válidos.
- A última meta ativa pode ser replicada para o mês atual até nova alteração.

## Campos e botões importantes

- `Meta diária`: valor base do mês.
- `Meta ativa de referência`: mês de origem da configuração.
- `Controle diário`: detalhamento por data.

## Regras e validações visíveis ao usuário

> [!REGRA] Alterações de meta e feriado devem ser feitas somente no mês corrente e por perfil autorizado.

> [!REGRA] Meta mensal é derivada automaticamente da meta diária e dos dias úteis.

## Erros comuns e como agir

> [!ERRO] Tentativa de editar mês histórico. Volte para o mês atual se a regra pedir alteração.

## Boas práticas

- Revise o calendário antes de mudar meta.
- Use a leitura diária para corrigir ritmo cedo, não só no fim do mês.

## FAQ rápido

- Posso remover a meta do mês?
- Sim, o módulo permite limpar a configuração do mês atual quando a rotina autorizar.
