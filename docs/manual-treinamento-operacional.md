# Manual Mestre de Treinamento Operacional

Manual de referência para operação de campo da plataforma Auditoria.

Material elaborado para treinamento prático, consulta rápida no dia a dia e padronização de execução por módulo.

> [!ATENCAO] Este material foi escrito com base no estado atual do repositório. Se a tela mudar depois de uma atualização, use a lógica do processo e valide a nova interface antes de publicar nova revisão.

## Objetivo do material

- Ensinar o uso passo a passo dos módulos ativos.
- Reduzir erro operacional em abertura, bipagem, conferência, finalização e sincronização.
- Padronizar alertas, exceções e decisões mais comuns.
- Deixar o documento pronto para receber capturas de tela sem reescrever o texto.

## Público principal

- Operadores de campo.
- Auditores.
- Líderes de turno que apoiam execução e conferência.
- Multiplicadores internos de treinamento.

## Como usar este manual

1. Leia a seção geral antes do primeiro uso.
2. Vá direto ao módulo desejado pelo sumário.
3. Siga o fluxo principal na ordem.
4. Use a seção de exceções quando a operação sair do padrão.
5. Consulte erros comuns antes de acionar suporte.

## Convenções visuais deste documento

- `Atenção`: risco operacional, bloqueio ou perda de lançamento.
- `Dica`: ganho de velocidade, ergonomia ou prevenção de retrabalho.
- `Regra`: validação obrigatória da aplicação ou da rotina.
- `Erro comum`: mensagem frequente e ação imediata recomendada.

## Histórico de versão

- Versão base: 1.0
- Data de consolidação: 20/04/2026
- Fonte funcional: código atual do frontend, docs do repositório e contratos ativos do sistema

## Sumário

[[TOC]]

[[PAGEBREAK]]

# Instruções Gerais de Uso

## Acesso ao sistema

1. Abra a aplicação Auditoria no navegador homologado pela empresa.
2. Entre com matrícula e senha.
3. Confirme o CD exibido no topo da tela.
4. Em perfil com múltiplos CDs, ajuste o contexto antes de iniciar qualquer lançamento.

[INSERIR IMAGEM - GERAL - PASSO 01 - Tela de login com campos de matrícula e senha]

> [!REGRA] Nunca inicie conferência, auditoria ou lançamento em CD incorreto. O contexto do CD afeta consulta, gravação e relatório.

## Navegação inicial

- A tela inicial exibe os módulos liberados para o seu perfil.
- Use a busca de módulo quando houver muitos cards.
- Observe sempre três sinais antes de começar:
- CD ativo.
- Perfil do usuário.
- Status `Online` ou `Offline`.

[INSERIR IMAGEM - GERAL - PASSO 02 - Tela inicial com cards dos módulos e informações do topo]

## Status online e offline

- `Online`: a aplicação pode consultar base remota, abrir conferências remotas e sincronizar pendências.
- `Offline`: a aplicação depende da base local já baixada no dispositivo, quando o módulo permitir.
- Alguns módulos funcionam só online.
- Outros aceitam operação local e sincronizam depois.

> [!ATENCAO] Ativar modo offline sem base local atualizada aumenta risco de consulta incompleta, falha de validação e retrabalho.

## Uso de coletor, teclado e câmera

- Prefira bipagem direta quando houver leitor físico.
- Use câmera do navegador quando a tela mostrar botão de scanner.
- Em campos numéricos, digite apenas números.
- Em validade, respeite formato `MMAA` ou `MM/AA`, conforme a tela.
- Em campos com QR Code, leia exatamente o tipo de código esperado pelo módulo.

[INSERIR IMAGEM - GERAL - PASSO 03 - Exemplo de scanner por câmera aberto com moldura de leitura]

## Padrão de trabalho recomendado

1. Confirmar módulo, CD e status de conexão.
2. Sincronizar base local quando o módulo tiver botão de atualização ou trabalho offline.
3. Abrir a tarefa correta antes de bipar produtos.
4. Acompanhar alertas de divergência e mensagens de bloqueio.
5. Revisar antes de finalizar ou cancelar.
6. Confirmar se não restaram pendências locais.

## Mensagens e alertas

- Mensagem verde: ação concluída com sucesso.
- Mensagem vermelha: erro, bloqueio ou validação não atendida.
- Mensagem de pendência: dado salvo localmente aguardando envio.
- Modal de confirmação: tela pedindo decisão irreversível, como finalizar, cancelar ou excluir.

> [!DICA] Antes de fechar o navegador, confirme se o módulo não deixou itens em `pendência`, `fila` ou `erro de sincronização`.

## Boas práticas gerais

- Trabalhe com um fluxo por vez.
- Não compartilhe credencial.
- Não ignore mensagens de CD, lote, rota, NF, NFD ou volume em andamento.
- Ao trocar de tarefa, finalize ou cancele a anterior de forma consciente.
- Em operação offline, sincronize assim que a internet voltar.

## Situações que pedem apoio de liderança ou suporte

- Conferência presa em outro usuário.
- Base local vazia sem opção de sincronizar.
- Produto fora da base quando a operação tem certeza do cadastro.
- Falha repetida de câmera, scanner ou exportação.
- Mensagem de conferência já finalizada por outro dispositivo.

[INSERIR IMAGEM - GERAL - PASSO 04 - Exemplo de alerta de erro e exemplo de mensagem de sucesso]

[[PAGEBREAK]]

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

[[PAGEBREAK]]

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

[[PAGEBREAK]]

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

[[PAGEBREAK]]

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

[[PAGEBREAK]]

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

[[PAGEBREAK]]

# Coleta de Mercadoria

## Objetivo do módulo

Registrar coletas de mercadoria por código de barras, quantidade, ocorrência, lote e validade, com suporte a operação offline e relatório administrativo.

## Quando usar

- Quando a equipe precisa lançar coleta operacional do dia.
- Quando houver ocorrência de item avariado ou vencido durante a coleta.

## Pré-requisitos e permissões

- CD correto.
- Base de barras sincronizada para operação offline.
- Internet para sincronização e relatório.

## Visão da tela

- Campo de código de barras.
- Quantidade, ocorrência, lote e validade.
- Lista de coletas de hoje.
- Botões para `Trabalhar offline`, atualizar e sincronizar.

[INSERIR IMAGEM - COLETA MERCADORIA - PASSO 01 - Tela de coleta com código, quantidade e lista do dia]

## Passo a passo principal

1. Confirme o CD e o status da conexão.
2. Se necessário, ative o offline depois de carregar a base local de barras.
3. Bipe ou digite o código de barras.
4. Ajuste a quantidade.
5. Preencha ocorrência, lote e validade quando se aplicarem.
6. Clique em `Salvar coleta`.
7. Confira se o item entrou em `Coletas de hoje`.
8. Sincronize pendências quando a internet estiver disponível.

[INSERIR IMAGEM - COLETA MERCADORIA - PASSO 02 - Exemplo de ocorrência, lote e validade]

## Fluxos alternativos e exceções

- Em mobile a câmera pode ser usada para leitura automática.
- O módulo aceita edição e exclusão de registros conforme permissão.
- Admin pode buscar coletas por período e exportar relatório.

## Campos e botões importantes

- `Código de barras`: item a coletar.
- `Quantidade`: múltiplo da coleta.
- `Ocorrência`: `Avariado` ou `Vencido`.
- `Trabalhar offline`: usa base local de barras.
- `Sincronizar`: envia pendências.

## Regras e validações visíveis ao usuário

> [!REGRA] Sem base de barras válida, a coleta offline não deve ser iniciada.

> [!REGRA] Validade precisa respeitar o formato solicitado pela tela.

## Erros comuns e como agir

> [!ERRO] `Sem base local`. Atualize a base antes de desligar a internet.

> [!ERRO] Produto não encontrado. Confirme a leitura do código e o CD ativo.

## Boas práticas

- Mantenha lote e validade preenchidos quando a coleta exigir rastreabilidade.
- Revise duplicidades na lista do dia.
- Sincronize antes de trocar de turno.

## FAQ rápido

- Posso continuar sem internet?
- Sim, quando a base local já estiver carregada no dispositivo.

[[PAGEBREAK]]

# Conferência de Entrada de Notas

## Objetivo do módulo

Conferir entrada de notas por Seq/NF, leitura de barras, divergências, ocorrências e lotes conjuntos por transportadora ou fornecedor.

## Quando usar

- Quando houver recebimento por Seq/NF para conferência de itens.
- Quando a liderança precisar abrir conferência conjunta por lote do dia.

## Pré-requisitos e permissões

- CD correto.
- Internet para operação remota, cancelamentos conjuntos e relatórios.
- Base local pronta quando a equipe precisar seguir offline.

## Visão da tela

- Área de abertura por `Seq/NF ou código de barras`.
- Painel de lote ativo do dia.
- Progresso por valor conferido.
- Lista de itens da conferência com grupos por status.
- Modal de relatório e seleção por fornecedor/transportadora.

[INSERIR IMAGEM - ENTRADA DE NOTAS - PASSO 01 - Abertura de conferência e lista do dia]

## Passo a passo principal

1. Abra a conferência informando `Seq/NF` ou código de barras.
2. Quando houver várias opções, selecione o Seq/NF correto.
3. Em operação por lote, escolha os Seq/NF do mesmo grupo e inicie a conferência conjunta.
4. Durante a conferência, bique os produtos.
5. Lance ocorrência quando houver diferença, sobra, falta ou correção.
6. Revise grupos de itens, ocorrências e totais pendentes.
7. Clique em `Finalizar` e confirme o resumo.

[INSERIR IMAGEM - ENTRADA DE NOTAS - PASSO 02 - Tela de conferência com itens e ocorrências]

## Fluxos alternativos e exceções

- Conferência conjunta pode exigir internet para liberar ou cancelar o lote.
- Itens podem ficar parcialmente conferidos por outros colaboradores.
- O módulo permite retomada automática quando existe conferência válida para sua matrícula.

## Campos e botões importantes

- `Seq/NF ou barras`: abre a conferência.
- `Ocorrência`: classifica correção ou divergência do item.
- `Cancelar conferência`: encerra o processo atual.
- `Finalizar`: fecha a conferência com resumo de faltas, sobras e ocorrências.
- `Relatório`: consulta período e exporta resultados.

## Regras e validações visíveis ao usuário

> [!REGRA] Depois do primeiro produto informado, finalize pelo botão próprio. Não abandone a conferência.

> [!REGRA] Conferência conjunta precisa respeitar vínculos do lote e pode depender de internet para cancelamento.

## Erros comuns e como agir

> [!ERRO] `Conferência já finalizada`. Atualize a tela e reabra somente se existir opção formal de retomada.

> [!ERRO] `Existe conferência em andamento`. Finalize ou cancele a atual antes de abrir outro Seq/NF.

## Boas práticas

- Trabalhe um lote por vez.
- Revise os itens com ocorrência antes da finalização.
- Use o relatório para fechamento diário e apoio da liderança.

## FAQ rápido

- Posso abrir por código de barras?
- Sim, quando o módulo localizar o Seq/NF correspondente.

[[PAGEBREAK]]

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

[[PAGEBREAK]]

# Conferência de Pedido Direto

## Objetivo do módulo

Conferir volumes de Pedido Direto por leitura de etiqueta e de barras, com divergências, visão por rota e filial, retomada e operação offline.

## Quando usar

- Quando houver volume de Pedido Direto para conferência.
- Quando a operação precisar revisar status por rota ou loja.

## Pré-requisitos e permissões

- CD correto.
- Base local do manifesto e de barras para uso offline.
- Internet para sincronização, retomada remota e relatório.

## Visão da tela

- Abertura por `PedidoSeq` do volume.
- Lista por rota, filial e status.
- Área da conferência ativa com código de barras e múltiplo.
- Resumo de divergências e finalização.

[INSERIR IMAGEM - PEDIDO DIRETO - PASSO 01 - Tela de abertura e visão por rota]

## Passo a passo principal

1. Atualize a base local se houver chance de operar offline.
2. Abra o volume pelo `PedidoSeq` ou pela etiqueta correspondente.
3. Na conferência ativa, bique os produtos.
4. Ajuste múltiplo quando a leitura representar mais de uma unidade.
5. Revise faltas, sobras e itens corretos.
6. Finalize a conferência pelo resumo final.

[INSERIR IMAGEM - PEDIDO DIRETO - PASSO 02 - Conferência ativa com grupos de itens]

## Fluxos alternativos e exceções

- O módulo pode retomar automaticamente uma conferência válida.
- Conferência parcialmente finalizada pode ser reaberta conforme regra do sistema.
- Em offline, a base local precisa estar pronta antes da abertura.

## Campos e botões importantes

- `PedidoSeq`: referência do volume.
- `Código de barras`: leitura do item.
- `Múltiplo`: quantidade por bipagem.
- `Finalizar`: fecha o volume.
- `Relatório`: exporta consolidado do período.

## Regras e validações visíveis ao usuário

> [!REGRA] Só abra outro volume depois de finalizar ou cancelar o atual.

> [!REGRA] Sem base local pronta, o offline não deve ser iniciado.

## Erros comuns e como agir

> [!ERRO] `Conferência reaberta`. Continue somente os itens pendentes e não repita itens corretos bloqueados.

> [!ERRO] `Volume já finalizado`. Atualize a tela e confirme o status antes de tentar nova abertura.

## Boas práticas

- Trabalhe um volume por vez.
- Confira rota e filial antes de iniciar.
- Revise divergências antes da finalização.

## FAQ rápido

- Posso continuar offline?
- Sim, desde que o manifesto e a base de barras já estejam baixados.

[[PAGEBREAK]]

# Conferência de Termo

## Objetivo do módulo

Conferir volumes de Termo por etiqueta, leitura de barras, divergências e visão por rota ou filial.

## Quando usar

- Quando houver volume termo para conferência.
- Quando a equipe precisar validar produtos e faltas por rota.

## Pré-requisitos e permissões

- CD correto.
- Internet para sincronização e relatórios.
- Base local pronta quando houver operação offline.

## Visão da tela

- Abertura por etiqueta do volume.
- Campo de código de barras.
- Lista de volumes por rota e status.
- Resumo de divergências e finalização.

[INSERIR IMAGEM - CONFERENCIA TERMO - PASSO 01 - Abertura por etiqueta e visão por rota]

## Passo a passo principal

1. Abra o volume informando a etiqueta.
2. Bipe os produtos da conferência.
3. Registre faltas quando existirem.
4. Revise itens corretos, faltas e sobras.
5. Finalize o volume pelo resumo final.

## Fluxos alternativos e exceções

- O módulo pode retomar conferências em andamento.
- Existe visão por rota para localizar volumes pendentes, concluídos e com falta.

## Campos e botões importantes

- `Etiqueta do volume`: abre a conferência.
- `Código de barras`: registra item conferido.
- `Motivo da falta`: justifica divergência quando necessário.
- `Finalizar`: fecha a conferência.

## Regras e validações visíveis ao usuário

> [!REGRA] Use a etiqueta correta do volume para evitar abrir conferência errada.

## Erros comuns e como agir

> [!ERRO] Volume não encontrado. Revise a leitura e o CD.

> [!ERRO] Conferência presa em outro usuário. Alinhe retomada com liderança.

## Boas práticas

- Sempre confirme rota e filial do volume aberto.
- Não finalize sem revisar itens pendentes.

## FAQ rápido

- Existe visão por rota?
- Sim, a tela permite localizar volumes por rota, filial e status.

[[PAGEBREAK]]

# Conferência de Volume Avulso

## Objetivo do módulo

Conferir volumes avulsos por número do volume, leitura de barras e controle de divergências por rota.

## Quando usar

- Quando a operação trabalhar com volume avulso fora do fluxo padrão de termo ou pedido direto.

## Pré-requisitos e permissões

- CD correto.
- Internet para sincronização e consulta do estado atual.
- Base local pronta para suporte offline, quando aplicável.

## Visão da tela

- Campo `NR Volume`.
- Campo de leitura de barras.
- Lista por rota e status.
- Área de faltas e finalização.

[INSERIR IMAGEM - VOLUME AVULSO - PASSO 01 - Abertura por número do volume]

## Passo a passo principal

1. Informe o número do volume.
2. Abra a conferência do volume correto.
3. Bipe os produtos.
4. Registre motivo da falta quando existir divergência.
5. Revise o resumo.
6. Finalize a conferência.

## Fluxos alternativos e exceções

- Pode haver retomada de conferência parcial conforme o status do volume.
- A visão por rota ajuda a localizar pendências do dia.

## Campos e botões importantes

- `NR Volume`: referência principal.
- `Código de barras`: leitura dos itens.
- `Motivo da falta`: registro de exceção.
- `Finalizar`: fechamento do volume.

## Regras e validações visíveis ao usuário

> [!REGRA] O número do volume precisa estar correto para evitar abertura indevida.

## Erros comuns e como agir

> [!ERRO] Volume não encontrado. Confirme a origem do número informado.

## Boas práticas

- Confira o status do volume antes de abrir.
- Revise divergências antes de finalizar.

## FAQ rápido

- Posso buscar por status?
- Sim, a visão geral permite pesquisa por volume, status e quantidade.

[[PAGEBREAK]]

# Controle de Validade

## Objetivo do módulo

Registrar coletas e retiradas ligadas ao controle de validade, com busca de produto, endereço, histórico recente e suporte a base offline.

## Quando usar

- Quando a operação precisar registrar validade coletada em linha.
- Quando houver retirada por endereço ou por item com necessidade de histórico.

## Pré-requisitos e permissões

- CD correto.
- Internet para sincronização e atualização da base.
- Base offline baixada quando a equipe precisar trabalhar sem rede.

## Visão da tela

- Campo de busca por código de barras.
- Campo de validade.
- Área de última coleta.
- Campos de retirada e edição de quantidades.
- Scanner de barras por câmera.

[INSERIR IMAGEM - CONTROLE VALIDADE - PASSO 01 - Tela principal com busca, validade e histórico]

## Passo a passo principal

1. Confirme o CD e, se necessário, baixe a base para uso offline.
2. Bipe o produto ou use a busca da câmera.
3. Consulte o produto retornado.
4. Informe a validade no formato pedido pela tela.
5. Salve a coleta.
6. Quando precisar retirar, localize a última coleta por endereço, CODDV ou barras.
7. Ajuste quantidade de retirada e salve.

[INSERIR IMAGEM - CONTROLE VALIDADE - PASSO 02 - Exemplo de coleta e retirada com edição]

## Fluxos alternativos e exceções

- É possível buscar a última coleta para decidir a retirada correta.
- Algumas linhas aceitam edição posterior de validade ou quantidade.
- O módulo mantém controles separados para coleta e retirada.

## Campos e botões importantes

- `Buscar`: localiza o produto.
- `Salvar coleta`: grava a validade coletada.
- `Buscar última coleta`: recupera histórico operacional.
- `Qtd`: quantidade usada na retirada ou ajuste.

## Regras e validações visíveis ao usuário

> [!REGRA] A validade deve respeitar o formato exigido pela tela.

> [!REGRA] Trabalhar offline depende da base baixada no dispositivo.

## Erros comuns e como agir

> [!ERRO] Produto não localizado. Revise a leitura do código e o CD ativo.

> [!ERRO] Formato de validade incorreto. Reescreva a validade no padrão pedido.

## Boas práticas

- Busque a última coleta antes de alterar uma retirada.
- Trabalhe um item por vez para evitar confusão entre endereços.
- Sincronize pendências no fim da rotina.

## FAQ rápido

- O módulo guarda histórico recente?
- Sim, a tela permite consultar a última coleta para apoiar a retirada.

[[PAGEBREAK]]

# Devolução de Mercadoria

## Objetivo do módulo

Conferir devoluções por NFD ou chave, com leitura de barras, divergências, lotes, validades e fluxo especial para devolução sem NFD.

## Quando usar

- Quando houver devolução formal por NFD ou chave.
- Quando houver exceção operacional de devolução sem NFD com justificativa.

## Pré-requisitos e permissões

- CD correto.
- Internet para maior parte das aberturas e retomadas remotas.
- Base local pronta para operação offline quando liberada pelo processo.

## Visão da tela

- Campo `NFD ou Chave`.
- Abertura de devolução sem NFD.
- Conferência ativa com leitura de barras.
- Campos de lote, validade, NFO e motivo.
- Histórico por volume e relatório.

[INSERIR IMAGEM - DEVOLUCAO - PASSO 01 - Abertura por NFD ou chave]

## Passo a passo principal

1. Abra a devolução informando `NFD` ou `Chave`.
2. Se houver mais de uma opção possível, escolha a devolução correta.
3. Na conferência ativa, bique os produtos.
4. Informe lotes e validades quando a rastreabilidade exigir.
5. Revise faltas, sobras e itens corretos.
6. Em devolução sem NFD, preencha NFO e motivo obrigatório.
7. Finalize a conferência pelo resumo final.

[INSERIR IMAGEM - DEVOLUCAO - PASSO 02 - Conferência ativa com lotes, validades e divergências]

## Fluxos alternativos e exceções

- O módulo pode reabrir conferência parcial quando houver pendência real.
- Há fluxo de `sem NFD` para cenário excepcional.
- Certos motivos permitem coleta mais livre sem divergência padrão.

## Campos e botões importantes

- `NFD ou Chave`: referência principal da devolução.
- `NFO`: obrigatório no fluxo sem NFD.
- `Motivo sem NFD`: justifica a exceção.
- `Lote` e `Validade`: apoio de rastreabilidade.
- `Finalizar`: fecha a conferência.

## Regras e validações visíveis ao usuário

> [!REGRA] Em devolução sem NFD, `NFO` e motivo são obrigatórios.

> [!REGRA] Só é permitido uma devolução em andamento por matrícula.

> [!REGRA] NFD ambígua deve ser resolvida pela chave correta.

## Erros comuns e como agir

> [!ERRO] `NFD/Chave não encontrado`. Revise o documento e confirme o CD.

> [!ERRO] `Conferência em andamento`. Finalize ou cancele a devolução atual antes de abrir outra.

> [!ERRO] `Produto fora da NFD`. Pare, confirme a leitura e trate como exceção operacional.

## Boas práticas

- Confirme se a devolução é com ou sem NFD antes de abrir.
- Preencha rastreabilidade sempre que disponível.
- Revise faltas e sobras antes da finalização.

## FAQ rápido

- Posso iniciar sem NFD?
- Sim, mas somente pelo fluxo próprio e com justificativa completa.

[[PAGEBREAK]]

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

[[PAGEBREAK]]

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

[[PAGEBREAK]]

# Indicadores

## Objetivo do módulo

Centralizar painéis analíticos publicados, com destaque para indicadores de Blitz, Gestão de Estoque e PVPS/Alocação.

## Quando usar

- Quando liderança precisar leitura rápida do desempenho operacional.
- Quando a equipe precisar entender tendência, divergência e concentração de erro.

## Pré-requisitos e permissões

- Internet ativa.
- Perfil com acesso ao painel correspondente.

## Visão da tela

- Tela de seleção de indicador.
- Cards com descrição curta do painel.
- Acesso a séries, resumos e listas detalhadas em cada indicador.

[INSERIR IMAGEM - INDICADORES - PASSO 01 - Tela inicial de seleção de indicador]

## Passo a passo principal

1. Abra o módulo e escolha o indicador desejado.
2. Ajuste filtros disponíveis no painel específico.
3. Analise resumo, séries e detalhamentos.
4. Use a visão detalhada para localizar zona, item ou dia com maior desvio.

## Fluxos alternativos e exceções

- O módulo serve como porta de entrada para subpainéis.
- A profundidade do filtro depende do indicador selecionado.

## Campos e botões importantes

- `Selecione um indicador`: navegação principal.
- Cards descritivos: ajudam a escolher o painel certo.

## Regras e validações visíveis ao usuário

> [!REGRA] Indicador não substitui conferência operacional. Use o painel para decisão e priorização.

## Erros comuns e como agir

> [!ERRO] Interpretação sem filtro. Ajuste período, CD ou zona antes de concluir tendência.

## Boas práticas

- Compare resumo com detalhamento antes de decidir ação.
- Use os indicadores no início e no fechamento do turno.

## FAQ rápido

- Quais painéis entram aqui?
- Entre outros, Blitz, Gestão de Estoque e PVPS/Alocação.

[[PAGEBREAK]]

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

[[PAGEBREAK]]

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

[[PAGEBREAK]]

# Produtividade

## Objetivo do módulo

Consultar ranking de produtividade, histórico e relatórios consolidados por colaborador.

## Quando usar

- Quando liderança precisar acompanhar desempenho do time.
- Quando houver fechamento ou comparação de produtividade por período.

## Pré-requisitos e permissões

- Internet ativa.
- Perfil com acesso ao ranking ou ao histórico.

## Visão da tela

- Alternância entre `Ranking` e `Histórico`.
- Filtros do período.
- Lista de colaboradores e pontuação.
- Exportação de PDF.

[INSERIR IMAGEM - PRODUTIVIDADE - PASSO 01 - Tela do ranking e filtros]

## Passo a passo principal

1. Abra o módulo e escolha entre `Ranking` e `Histórico`.
2. Ajuste filtros de data, CD ou colaborador conforme a análise desejada.
3. Clique em buscar para carregar o resultado.
4. Analise posição, pontuação e detalhes do período.
5. Se necessário, exporte o relatório em PDF.

## Fluxos alternativos e exceções

- O histórico ajuda a explicar variação entre períodos.
- A exportação depende de consulta feita previamente.

## Campos e botões importantes

- `Ranking`: visão principal do desempenho.
- `Histórico`: visão de períodos anteriores.
- `Buscar Ranking`: prepara a tela e a exportação.
- `Exportar PDF`: gera o relatório consolidado.

## Regras e validações visíveis ao usuário

> [!REGRA] Exporte PDF somente depois de carregar a busca do ranking.

## Erros comuns e como agir

> [!ERRO] `Clique em Buscar Ranking antes de exportar o PDF`. Refaça a consulta e tente novamente.

## Boas práticas

- Use o histórico para contextualizar ranking do mês.
- Valide filtros antes de apresentar resultado à liderança.

## FAQ rápido

- O módulo mostra histórico?
- Sim, existe modo próprio para visão histórica.

[[PAGEBREAK]]

# Registro de Embarque - Caixa Térmica

## Objetivo do módulo

Cadastrar caixas térmicas, expedir por etiqueta de volume, receber retorno com observação de avarias e consultar histórico de movimentação.

## Quando usar

- Quando houver controle operacional de caixas térmicas.
- Quando a equipe precisar registrar expedição, recebimento ou manutenção de cadastro.

## Pré-requisitos e permissões

- CD correto.
- Internet para expedição e recebimento.
- Base local de rotas atualizada para apoio offline do cadastro e consulta.

## Visão da tela

- Busca por código ou descrição.
- Feed do dia.
- Modal de cadastro de nova caixa.
- Modal de expedição.
- Modal de recebimento.
- Histórico da caixa.

[INSERIR IMAGEM - CAIXA TERMICA - PASSO 01 - Feed do dia e busca de caixas]

## Passo a passo principal

1. Confirme o CD e a base local de rotas.
2. Para nova caixa, abra `Registrar Nova Caixa Térmica`.
3. Preencha código, descrição, capacidade e avarias existentes, se houver.
4. Para expedir, abra a ação da caixa disponível.
5. Leia ou digite a etiqueta do volume e informe a placa.
6. Confirme a expedição.
7. Para receber, abra a ação da caixa em trânsito.
8. Marque `Recebido sem avarias` ou descreva as avarias encontradas.

[INSERIR IMAGEM - CAIXA TERMICA - PASSO 02 - Modal de expedição e modal de recebimento]

## Fluxos alternativos e exceções

- O cadastro pode ser salvo localmente e sincronizado depois.
- Expedição e recebimento exigem internet.
- O histórico mostra rota, filial e observações de avaria por movimento.

## Campos e botões importantes

- `Registrar Nova Caixa Térmica`: cadastro inicial.
- `Expedir Caixa`: saída vinculada a etiqueta e placa.
- `Receber Caixa`: retorno com condição física.
- `Histórico`: rastreia movimentações anteriores.

## Regras e validações visíveis ao usuário

> [!REGRA] Recebimento exige marcar `sem avarias` ou descrever a avaria.

> [!REGRA] Sem base de rotas, o trabalho offline fica incompleto.

## Erros comuns e como agir

> [!ERRO] `Caixa não encontrada neste CD`. Revise o código e o contexto do CD.

> [!ERRO] `Expedição requer conexão`. Reconecte o dispositivo antes de concluir a saída.

## Boas práticas

- Mantenha a descrição padronizada no cadastro.
- Registre avaria no recebimento com detalhe suficiente para rastreio.
- Consulte o histórico antes de excluir ou editar uma caixa.

## FAQ rápido

- O módulo usa câmera?
- Sim, para ler código da caixa e etiqueta de volume quando necessário.

[[PAGEBREAK]]

# Ronda de Qualidade

## Objetivo do módulo

Executar auditorias de qualidade por zona de Separação ou Pulmão, registrar ocorrências, marcar correção e consultar histórico consolidado.

## Quando usar

- Quando houver ronda periódica de qualidade.
- Quando liderança precisar acompanhar correção de ocorrências por zona.

## Pré-requisitos e permissões

- CD correto.
- Internet para auditoria online e gestão de ocorrências.
- Base offline sincronizada para consulta local quando necessário.

## Visão da tela

- Sincronização da base local.
- Alternância entre zonas de `Separação` e `Pulmão`.
- Lista de zonas.
- Detalhe da zona com colunas, histórico e ocorrências.
- Composer de ocorrência com endereço e motivo.

[INSERIR IMAGEM - RONDA - PASSO 01 - Seleção de tipo de zona e lista de zonas]

## Passo a passo principal

1. Sincronize a base local se houver chance de operar sem internet.
2. Escolha `Separação` ou `Pulmão`.
3. Localize a zona desejada.
4. Inicie a auditoria da zona ou da coluna.
5. Se houver problema, abra o composer de ocorrência.
6. Informe endereço, motivo e observação quando necessário.
7. Finalize a auditoria com ou sem ocorrência.
8. Acompanhe o histórico e marque correções quando a ação corretiva ocorrer.

[INSERIR IMAGEM - RONDA - PASSO 02 - Composer de ocorrência e histórico da zona]

## Fluxos alternativos e exceções

- O módulo aceita auditoria sem ocorrência.
- Meses anteriores ficam como consulta e correção, não como nova auditoria.
- Admin pode excluir ocorrência.
- Histórico consolidado pode ser filtrado por mês, tipo, status e busca textual.

## Campos e botões importantes

- `Sincronizar base`: atualiza snapshot local.
- `Off-Line`: ativa uso local da base.
- `Ocorrências`: abre histórico consolidado.
- `Finalizar Auditoria`: encerra a sessão ativa.
- `Corrigido/Não corrigido`: status da ação corretiva.

## Regras e validações visíveis ao usuário

> [!REGRA] Sem base local sincronizada, o offline não deve ser ativado.

> [!REGRA] Nova auditoria não é aberta em mês histórico de consulta.

> [!REGRA] Auditoria com ocorrência pede dados mínimos válidos do endereço e motivo.

## Erros comuns e como agir

> [!ERRO] `Sem base local da Ronda`. Conecte-se e sincronize antes de trabalhar offline.

> [!ERRO] `Conecte-se à internet para registrar a auditoria`. Volte ao online antes de salvar.

## Boas práticas

- Feche uma auditoria antes de iniciar outra zona.
- Marque correção assim que a ação de campo acontecer.
- Use histórico para acompanhar reincidência.

## FAQ rápido

- Posso auditar sem ocorrência?
- Sim, o módulo possui fluxo específico para auditoria sem ocorrência.

[[PAGEBREAK]]

# Conferência de Transferência CD

## Objetivo do módulo

Conferir notas de transferência entre CDs, por etapa de saída ou entrada, com leitura de NF e barras, lote multi-NF, ocorrências e conciliação em relatório.

## Quando usar

- Quando houver mercadoria a enviar ou a receber entre CDs.
- Quando a liderança precisar conciliar saída e entrada por NF.

## Pré-requisitos e permissões

- CD correto.
- Internet para baixar base, abrir lote multi-NF e sincronizar conferências.
- Base local e barras atualizadas para uso offline.

## Visão da tela

- Sincronização da base.
- Seletor de CD.
- Abertura por número da NF.
- Modal de notas do dia.
- Conferência ativa por NF ou lote.
- Relatório de conciliação.

[INSERIR IMAGEM - TRANSFERENCIA CD - PASSO 01 - Abertura por NF e visão geral de progresso]

## Passo a passo principal

1. Sincronize a base de Transferência CD e barras.
2. Confirme o CD ativo.
3. Abra a NF informando o número ou usando a câmera.
4. Se necessário, abra o modal de notas e monte um lote da mesma etapa.
5. Na conferência ativa, bique os produtos.
6. Ajuste múltiplo e, na etapa de entrada, marque ocorrência `Avariado` ou `Vencido` quando necessário.
7. Revise grupos de `não conferido`, `falta`, `sobra` e `correto`.
8. Finalize a conferência.

[INSERIR IMAGEM - TRANSFERENCIA CD - PASSO 02 - Conferência ativa com grupos de itens e ocorrência]

## Fluxos alternativos e exceções

- Lote multi-NF exige internet para seguir conferência.
- Conferências podem ficar como pendência local até reconectar.
- O módulo oferece lista de pendências locais com descarte controlado.

## Campos e botões importantes

- `NF`: abertura da conferência.
- `Código de barras`: leitura do item.
- `Múltiplo`: quantidade por leitura.
- `Ocorrência`: usada na etapa de recebimento.
- `Relatório`: exporta conciliação entre origem e destino.

## Regras e validações visíveis ao usuário

> [!REGRA] Não misture etapas diferentes no mesmo lote.

> [!REGRA] Só abra nova NF depois de finalizar ou cancelar a atual.

## Erros comuns e como agir

> [!ERRO] `Lote multi-NF precisa estar online`. Volte à rede antes de continuar.

> [!ERRO] Pendência local com erro. Revise a lista de pendências e sincronize ou descarte conforme orientação da liderança.

## Boas práticas

- Separe bem mercadoria a enviar e a receber.
- Revise o resumo final antes de confirmar.
- Não descarte pendência local sem validar impacto com a operação.

## FAQ rápido

- O relatório mostra conciliação?
- Sim, o módulo possui relatório próprio de conferência de transferência CD.

[[PAGEBREAK]]

# Validar Endereçamento

## Objetivo do módulo

Validar se o endereço lido bate com o endereço esperado do produto, com apoio de consulta online/offline e auditoria do evento.

## Quando usar

- Quando a operação precisar confirmar se o produto está no endereço SEP correto.
- Quando houver auditoria rápida de endereçamento em campo.

## Pré-requisitos e permissões

- CD correto.
- Internet para sincronização e atualização da base.
- Base local pronta quando a equipe usar offline.

## Visão da tela

- Campo dinâmico para `Produto` e depois `Endereço`.
- Botão de câmera para leitura do código certo em cada etapa.
- Indicador de validação em andamento.
- Botões para sincronizar base e ativar offline.

[INSERIR IMAGEM - VALIDAR ENDERECAMENTO - PASSO 01 - Fluxo de leitura do produto e depois do endereço]

## Passo a passo principal

1. Confirme o CD ativo.
2. Se necessário, sincronize a base local e ative o offline.
3. No primeiro passo, leia o produto.
4. Aguarde a validação do produto.
5. No segundo passo, leia o endereço informado na operação.
6. Confira o resultado da validação.
7. Reinicie o fluxo para o próximo item.

[INSERIR IMAGEM - VALIDAR ENDERECAMENTO - PASSO 02 - Resultado positivo e resultado de divergência]

## Fluxos alternativos e exceções

- A leitura pode ser feita por coletor ou câmera.
- O módulo aceita modo offline quando a base já foi baixada.
- Produto sem endereço SEP cadastrado gera erro específico.

## Campos e botões importantes

- `Produto (código de barras)`: primeira etapa.
- `Endereço`: segunda etapa.
- `Trabalhar offline`: usa base local.
- `Sincronizar`: atualiza a base local.

## Regras e validações visíveis ao usuário

> [!REGRA] A validação só faz sentido depois do produto correto ser reconhecido.

> [!REGRA] Produto sem endereço SEP válido não deve seguir como confirmação de endereço.

## Erros comuns e como agir

> [!ERRO] `Produto não informado`. Recomece pela leitura do produto.

> [!ERRO] `Produto sem endereço SEP cadastrado`. Trate como exceção cadastral e não force confirmação.

## Boas práticas

- Leia produto e endereço sem trocar a ordem.
- Recomece o fluxo sempre que houver dúvida de leitura.
- Atualize a base local no início do turno.

## FAQ rápido

- Posso usar câmera nas duas etapas?
- Sim, o botão muda conforme o campo ativo.

[[PAGEBREAK]]

# Validar Etiqueta Pulmão

## Objetivo do módulo

Validar se o código interno ou etiqueta de pulmão corresponde ao produto lido, com apoio de base local e auditoria da validação.

## Quando usar

- Quando houver checagem rápida entre produto físico e identificação interna do pulmão.
- Quando a operação quiser evitar troca de etiqueta ou erro de identificação.

## Pré-requisitos e permissões

- CD correto.
- Internet para sincronização da base.
- Base local pronta para uso offline.

## Visão da tela

- Campo dinâmico para produto e depois código interno.
- Botão de câmera com leitura distinta para barras e QR/código interno.
- Indicador de validação em andamento.
- Controles de sincronização e modo offline.

[INSERIR IMAGEM - VALIDAR ETIQUETA PULMAO - PASSO 01 - Fluxo de leitura do produto e do código interno]

## Passo a passo principal

1. Confirme o CD e o status da base local.
2. Sincronize a base caso vá trabalhar offline.
3. Leia o produto.
4. Aguarde a validação inicial.
5. Leia o código interno ou etiqueta do pulmão.
6. Confira o resultado da comparação.
7. Reinicie para o próximo item.

[INSERIR IMAGEM - VALIDAR ETIQUETA PULMAO - PASSO 02 - Scanner para código interno e retorno da validação]

## Fluxos alternativos e exceções

- O scanner muda o tipo de leitura conforme o campo ativo.
- A base local de barras deve estar pronta antes do offline.
- O módulo pode registrar auditoria local e sincronizar depois.

## Campos e botões importantes

- `Produto`: primeira leitura.
- `Código interno`: segunda leitura.
- `Trabalhar offline`: ativa base local.
- `Sincronizar`: atualiza base do dispositivo.

## Regras e validações visíveis ao usuário

> [!REGRA] Não leia o código interno antes do produto.

> [!REGRA] Sem base local pronta, o offline não deve ser usado.

## Erros comuns e como agir

> [!ERRO] `Falha ao iniciar câmera`. Troque para coletor ou digitação.

> [!ERRO] Base local vazia. Sincronize antes de continuar sem internet.

## Boas práticas

- Confirme o campo ativo antes de usar a câmera.
- Recomece a validação se a primeira leitura estiver duvidosa.
- Sincronize a base local no começo da jornada.

## FAQ rápido

- O scanner lê barras e código interno?
- Sim, o módulo alterna o tipo de leitura conforme a etapa do fluxo.

[[PAGEBREAK]]

# Anexos Operacionais

## Glossário rápido

- `CD`: centro de distribuição em contexto ativo.
- `Manifesto/Base local`: cópia de dados baixada no dispositivo para uso offline.
- `Pendência local`: lançamento salvo no dispositivo aguardando sincronização.
- `Divergência`: diferença entre esperado e conferido.
- `Falta`: quantidade conferida menor que a esperada.
- `Sobra`: quantidade conferida maior que a esperada.
- `Ocorrência`: exceção operacional registrada na linha ou no item.
- `Conferência em andamento`: processo aberto e ainda não finalizado ou cancelado.

## Erros comuns e ação imediata

> [!ERRO] `Sem base local`. Conecte o dispositivo, baixe a base do módulo e só depois ative o offline.

> [!ERRO] `Conferência em uso por outro usuário`. Não force nova abertura. Valide quem está com a tarefa e retome só pelo fluxo correto.

> [!ERRO] `Produto não encontrado`. Confirme o CD, a leitura do código e a base do módulo. Se persistir, escale para validação de cadastro.

> [!ERRO] `Já existe conferência em andamento`. Finalize ou cancele a tarefa atual antes de abrir outra.

## FAQ curto

- Posso trocar de módulo no meio da execução?
- Sim, mas finalize ou interrompa conscientemente a atividade atual para não deixar dado preso.

- Posso trabalhar sem internet?
- Somente nos módulos que oferecem base local e botão de modo offline.

- Quando devo exportar relatório?
- Quando a liderança pedir consolidação, auditoria do dia, conciliação ou evidência de execução.

- O que fazer com divergência?
- Registrar corretamente, revisar a linha afetada e finalizar só depois de entender a diferença.

## Checklist diário do operador

1. Validar login, perfil e CD.
2. Conferir se a internet está disponível.
3. Atualizar bases locais dos módulos que serão usados offline.
4. Abrir somente a tarefa certa.
5. Bipar com atenção e acompanhar mensagens da tela.
6. Revisar divergências antes de finalizar.
7. Sincronizar pendências locais antes de encerrar turno.

[INSERIR IMAGEM - ANEXOS - PASSO 01 - Exemplo de pendências locais e status online]
