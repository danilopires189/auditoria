# Inventário (Zerados)

## Objetivo do módulo

Executar conferência de inventário para itens zerados, com fluxo por zona, gestão da base, travas operacionais, revisão e relatório admin.

## Quando usar

- Quando houver rotina de inventário para endereços ou itens zerados.
- Quando liderança precisar gerir base, revisar pendências ou exportar relatório.

## Pré-requisitos e permissões

- CD correto.
- Internet para relatórios e sincronização.
- Regras locais de zona e endereço já alinhadas com a equipe.

## Visão da tela

- Seleção de tipo de gestão.
- Fluxo por zona ou por código e dígito.
- Busca por zona.
- Campo de quantidade.
- Gestão da base com confirmações administrativas.

[INSERIR IMAGEM - ZERADOS - PASSO 01 - Tela de seleção de fluxo e zonas]

## Passo a passo principal

1. Escolha o tipo de gestão do inventário.
2. Selecione o fluxo adequado: por zona ou por código e dígito.
3. Escolha a zona de trabalho.
4. Abra o endereço ou item desejado.
5. Informe a quantidade encontrada.
6. Salve a conferência.
7. Revise pendências e, se for admin, use o relatório quando necessário.

[INSERIR IMAGEM - ZERADOS - PASSO 02 - Lançamento de quantidade e gestão da base]

## Fluxos alternativos e exceções

- Admin pode operar gestão da base com confirmações específicas.
- O módulo possui scanner de barras por câmera para apoio operacional.
- Há relatório XLSX para fechamento administrativo.

## Campos e botões importantes

- `Selecionar zonas de Separação`: define escopo do inventário.
- `Buscar zona`: localiza rapidamente a área.
- `Quantidade`: valor apurado.
- `Relatório XLSX`: exporta consolidado.

## Regras e validações visíveis ao usuário

> [!REGRA] Trabalhe somente na zona liberada para sua rodada atual.

> [!REGRA] Não confirme base administrativa sem revisar o impacto da ação.

## Erros comuns e como agir

> [!ERRO] Zona errada selecionada. Volte e escolha a zona correta antes do lançamento.

> [!ERRO] Quantidade lançada sem conferência física. Refazer contagem antes de salvar.

## Boas práticas

- Feche uma zona antes de abrir outra.
- Registre evidências de exceção quando necessário.
- Use exportação para fechamento formal do inventário.

## FAQ rápido

- Há fluxo só para admin?
- Sim, existe gestão da base com confirmações específicas.
