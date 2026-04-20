# Gestão de Conservadoras Térmicas

## Objetivo do módulo

Acompanhar embarques por rota, placa e pedido, confirmar documentação recebida e manter vínculo entre transportadoras e rotas.

## Quando usar

- Quando houver validação documental de embarque de conservadora.
- Quando liderança precisar consultar histórico ou manter cadastro de transportadoras.

## Pré-requisitos e permissões

- Internet obrigatória.
- CD padrão definido.
- Perfil de gestão para cadastro e vínculo de transportadoras.

## Visão da tela

- Busca por rota, pedido, placa, transportadora ou situação.
- Cards de embarque do dia.
- Ação `Histórico`.
- Ação `Transportadoras`.
- Modal de confirmação documental com aprovação ou reprovação.

[INSERIR IMAGEM - GESTAO CONSERVADORAS - PASSO 01 - Cards de embarque e ações de histórico]

## Passo a passo principal

1. Abra o módulo e localize o embarque desejado.
2. Selecione o card correto.
3. Abra `Confirmar Recebimento do Doc.`.
4. Escolha aprovação ou reprovação.
5. Em reprovação, descreva a ocorrência obrigatória.
6. Confirme o resultado.
7. Quando necessário, consulte o histórico do embarque.

[INSERIR IMAGEM - GESTAO CONSERVADORAS - PASSO 02 - Modal de confirmação documental]

## Fluxos alternativos e exceções

- O histórico permite busca avançada por rota, pedido e placa.
- Perfil com gestão pode cadastrar transportadora, inativar cadastro e vincular rota.
- Há filtro específico para transportadora e responsável.

## Campos e botões importantes

- `Histórico`: abre embarques anteriores.
- `Transportadoras`: abre gestão de cadastros e vínculos.
- `Ocorrência`: obrigatório quando o doc é reprovado.
- `Vincular`: associa transportadora à rota.

## Regras e validações visíveis ao usuário

> [!REGRA] Reprovação documental exige ocorrência descritiva.

> [!REGRA] O módulo depende da base online para cálculo de embarques agregados.

## Erros comuns e como agir

> [!ERRO] Módulo offline. Aguarde retorno da internet, pois a tela depende da base online.

> [!ERRO] Rota sem vínculo. Use a gestão de transportadoras para corrigir o cadastro.

## Boas práticas

- Registre ocorrência clara em caso de reprovação.
- Mantenha vínculos de rota atualizados.
- Use o histórico para rastrear confirmação documental anterior.

## FAQ rápido

- Quem pode gerenciar transportadoras?
- Usuários com permissão de gestão no módulo.
