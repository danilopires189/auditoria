# Auditoria de PVPS e Alocação

## Objetivo do módulo

Auditar validade e conformidade nas etapas de PVPS, Separação, Pulmão e Alocação, inclusive com fila offline, gestão de regras e relatórios.

## Quando usar

- Quando a operação precisar auditar validade informada versus validade real.
- Quando houver checagem de endereço vazio, obstruído ou não conforme.
- Quando a liderança precisar reordenar fila por regras administrativas.

## Pré-requisitos e permissões

- CD ativo correto.
- Internet para abrir gestão de regras, relatórios e sincronizar fila.
- Base offline baixada quando a equipe for operar sem conexão.

## Visão da tela

- Abas de PVPS, Alocação ou visão combinada.
- Filtros por zona e nível.
- Botão de `Trabalhar offline`.
- Fila de pendentes e área de concluídos.
- Painel admin para regras e relatórios.

[INSERIR IMAGEM - PVPS E ALOCACAO - PASSO 01 - Tela com filtros por zona, abas e progresso]

## Passo a passo principal

1. Escolha a visão desejada: PVPS, Alocação ou ambos.
2. Ajuste filtros de zona e nível para reduzir a fila.
3. Se a operação for offline, baixe a base local antes de começar.
4. Abra o item pendente.
5. Na Separação, informe validade ou ocorrência do endereço.
6. No Pulmão, confirme validade do pulmão ou registre ocorrência.
7. Na Alocação, informe validade do produto ou marque ocorrência como `vazio` ou `obstruído`.
8. Salve a auditoria e avance para o próximo item.
9. Ao final, sincronize a fila pendente e revise os concluídos.

[INSERIR IMAGEM - PVPS E ALOCACAO - PASSO 02 - Editor de auditoria com validade e ocorrência]

## Fluxos alternativos e exceções

- O módulo permite fila offline com sincronização posterior.
- Pulmão offline depende da etapa de Separação já salva para o mesmo contexto.
- Admin pode criar regras por zona ou SKU com prioridade e aplicação imediata.
- Itens já auditados por outro dispositivo podem refrescar a fila automaticamente.

## Campos e botões importantes

- `Buscar zona` e `Buscar nível`: reduzem a fila operacional.
- `Trabalhar offline`: baixa e ativa snapshot local.
- `Iniciar Alocação`: abre o item focal.
- `Ocorrência`: classifica endereço vazio, obstruído ou situação equivalente.
- `Relatórios`: exporta PDF e planilhas.
- `Admin: Gestão de Regras`: cria, visualiza e remove regras ativas.

## Regras e validações visíveis ao usuário

> [!REGRA] Quando não houver ocorrência, a validade informada é obrigatória no formato `MMAA`.

> [!REGRA] Para operar offline sem erro, a base precisa existir no dispositivo.

> [!REGRA] A fila é recomposta conforme regras administrativas ativas no CD.

## Erros comuns e como agir

> [!ERRO] `Sem snapshot offline`. Fique online, baixe a base e só depois ative o offline.

> [!ERRO] `Endereço de Pulmão ainda está carregando`. Aguarde a hidratação do endereço e tente de novo.

> [!ERRO] `Este endereço já avançou para Pulmão`. Atualize a fila para evitar auditoria duplicada.

## Boas práticas

- Trabalhe zona por zona.
- Use filtros para diminuir troca de contexto.
- Sincronize pendências antes de encerrar turno.
- Revise concluídos do dia quando houver dúvida de conformidade.

## FAQ rápido

- Posso editar um concluído?
- Em casos permitidos, sim, principalmente para perfis com poder de correção.

- Quando usar regra admin?
- Somente quando liderança precisar alterar prioridade operacional de forma controlada.
