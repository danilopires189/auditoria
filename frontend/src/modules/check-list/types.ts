export type ChecklistAnswer = "Sim" | "Não" | "N.A.";
export type ChecklistKey =
  | "dto_pvps"
  | "dto_alocacao"
  | "dto_blitz_separacao"
  | "auditoria_prevencao_perdas"
  | "prevencao_riscos_geral"
  | "prevencao_riscos_expedicao"
  | "prevencao_riscos_avaria";
export type ChecklistSectionKey = string;
export type ChecklistScoringMode = "simple" | "risk_weighted" | "score_points";

export interface CheckListModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface ChecklistItem {
  item_number: number;
  section_key: ChecklistSectionKey;
  section_title: string;
  question: string;
  item_weight?: number | null;
  max_points?: number | null;
  criticality?: string | null;
  is_critical?: boolean;
}

export interface ChecklistDefinition {
  checklist_key: ChecklistKey;
  title: string;
  version: string;
  total_items: number;
  description: string;
  sections: ChecklistSectionKey[];
  items: ChecklistItem[];
  scoring_mode: ChecklistScoringMode;
  requires_evaluated_user: boolean;
}

export interface ChecklistAnswerPayload {
  item_number: number;
  answer: ChecklistAnswer;
  section_key: ChecklistSectionKey;
  section_title: string;
  question: string;
  item_weight?: number | null;
  max_points?: number | null;
  criticality?: string | null;
  is_critical?: boolean;
}

export interface ChecklistFinalizePayload {
  checklist_key: ChecklistKey;
  cd: number | null;
  evaluated_mat: string | null;
  observations: string | null;
  signature_accepted: boolean;
  answers: ChecklistAnswerPayload[];
}

export interface ChecklistAuditSummary {
  audit_id: string;
  cd: number;
  cd_nome: string | null;
  checklist_key: ChecklistKey;
  checklist_title: string;
  checklist_version: string;
  evaluated_mat: string;
  evaluated_nome: string;
  auditor_mat: string;
  auditor_nome: string;
  non_conformities: number;
  conformity_percent: number;
  scoring_mode: ChecklistScoringMode;
  risk_score_percent: number | null;
  risk_level: string | null;
  score_points: number | null;
  score_max_points: number | null;
  created_at: string;
  signed_at: string | null;
}

export interface ChecklistAuditResult extends ChecklistAuditSummary {
  observations: string | null;
  signature_accepted: boolean;
  total_items: number;
}

export interface ChecklistAnswerRow extends ChecklistItem {
  answer: ChecklistAnswer;
  is_nonconformity: boolean;
  earned_points?: number | null;
  risk_points?: number | null;
}

export interface ChecklistAuditDetail extends ChecklistAuditResult {
  answers: ChecklistAnswerRow[];
}

export interface ChecklistAdminFilters {
  dt_ini: string;
  dt_fim: string;
  cd: number | null;
  auditor: string | null;
  evaluated: string | null;
  checklist_key: ChecklistKey | null;
  limit?: number;
}

export interface ChecklistEvaluatedUser {
  cd: number;
  mat: string;
  nome: string;
  cargo: string | null;
}

const item = (
  item_number: number,
  section_key: string,
  section_title: string,
  question: string,
  extra: Partial<ChecklistItem> = {}
): ChecklistItem => ({
  item_number,
  section_key,
  section_title,
  question,
  ...extra
});

const PVPS_ITEMS: ChecklistItem[] = [
  item(1, "zona_separacao", "Zona de Separação", "O flow rack contém o produto?"),
  item(2, "zona_separacao", "Zona de Separação", "O colaborador está informando a data de validade corretamente?"),
  item(3, "zona_separacao", "Zona de Separação", "O colaborador verifica se o endereço está com várias validades?"),
  item(4, "zona_separacao", "Zona de Separação", "O colaborador está informando a validade mais próxima?"),
  item(5, "zona_separacao", "Zona de Separação", "Existem coletores disponíveis?"),
  item(6, "zona_separacao", "Zona de Separação", "O colaborador identifica o produto corretamente? (Verificando a descrição do produto)"),
  item(7, "zona_separacao", "Zona de Separação", "O endereço está desobstruído e com acesso livre?"),
  item(8, "zona_separacao", "Zona de Separação", "Todos os produtos estão dentro da política de envio e dentro do prazo de validade?"),
  item(9, "zona_separacao", "Zona de Separação", "Todos os produtos no flow rack estão segregados por SKU e lote (sem mistura)?"),
  item(10, "zona_separacao", "Zona de Separação", "Todos os produtos armazenados no flow rack estão íntegros (sem avarias)?"),
  item(11, "pulmao", "Pulmão", "O produto está no endereço indicado?"),
  item(12, "pulmao", "Pulmão", "O produto possui alguma identificação? (Etiqueta Pulmão)"),
  item(13, "pulmao", "Pulmão", "O endereço está desobstruído e com acesso livre?"),
  item(14, "pulmao", "Pulmão", "O produto está de fácil acesso?"),
  item(15, "pulmao", "Pulmão", "A validade sinalizada na caixa padrão do fornecedor pela Logística está correta?"),
  item(16, "pulmao", "Pulmão", "Todos os produtos armazenados no pulmão estão dentro da política e dentro do prazo de validade?"),
  item(17, "pulmao", "Pulmão", "Os produtos armazenados no pulmão estão íntegros (sem avarias)?")
];

const ALOCACAO_ITEMS: ChecklistItem[] = [
  item(1, "alocacao", "Alocação", "Existem coletores disponíveis?"),
  item(2, "alocacao", "Alocação", "Os endereços estão visíveis?"),
  item(3, "alocacao", "Alocação", "O endereço está desobstruído e com acesso livre?"),
  item(4, "alocacao", "Alocação", "O colaborador confere a data de validade do produto?"),
  item(5, "alocacao", "Alocação", "O colaborador retorna o volume para o endereço correto?"),
  item(6, "alocacao", "Alocação", "O colaborador organizou o volume que conferiu?"),
  item(7, "alocacao", "Alocação", "O colaborador sinaliza a não conformidade?"),
  item(8, "alocacao", "Alocação", "O colaborador registra com foto a não conformidade?"),
  item(9, "alocacao", "Alocação", "A supervisão de logística acompanha as anomalias apontadas na auditoria?")
];

const BLITZ_SEPARACAO_ITEMS: ChecklistItem[] = [
  item(1, "blitz_preparo", "Preparo da Separação", "Existem coletores disponíveis e em condição de uso?"),
  item(2, "blitz_preparo", "Preparo da Separação", "Os endereços do flow rack estão visíveis e corretos?"),
  item(3, "blitz_preparo", "Preparo da Separação", "O endereço está desobstruído e com acesso livre?"),
  item(4, "blitz_preparo", "Preparo da Separação", "O flow rack contém o produto esperado para a separação?"),
  item(5, "blitz_preparo", "Preparo da Separação", "Os volumes separados mantêm organização e integridade física?"),
  item(6, "blitz_execucao", "Execução da Separação", "O colaborador identifica o produto corretamente antes de separar?"),
  item(7, "blitz_execucao", "Execução da Separação", "O colaborador confere a data de validade do produto?"),
  item(8, "blitz_execucao", "Execução da Separação", "O colaborador aplica PVPS e prioriza a validade mais próxima?"),
  item(9, "blitz_execucao", "Execução da Separação", "Os produtos estão segregados por SKU e lote, sem mistura?"),
  item(10, "blitz_execucao", "Execução da Separação", "O manuseio previne avarias, quedas e empilhamento excessivo?"),
  item(11, "blitz_execucao", "Execução da Separação", "O colaborador sinaliza a não conformidade encontrada?"),
  item(12, "blitz_execucao", "Execução da Separação", "A supervisão acompanha as anomalias apontadas na blitz?")
];

const AUDITORIA_PREVENCAO_PERDAS_ITEMS: ChecklistItem[] = [
  item(1, "sdpf", "SDPF", "As avarias são destinadas ao SDPF dentro do prazo definido, sem acúmulo no setor?"),
  item(2, "sdpf", "SDPF", "Os volumes avulsos seguem padrão de rastreabilidade com QR Code, produto, lote, validade e quantidade?"),
  item(3, "sdpf", "SDPF", "Existe controle formal sobre produtos recuperáveis, com prazo para decisão e execução?"),
  item(4, "sdpf", "SDPF", "Todo expurgo do resultado do CD é formalmente autorizado, auditado e evidenciado?"),
  item(5, "sdpf", "SDPF", "A Prevenção de Perdas realiza auditoria física dos volumes SDPF versus relatórios?"),
  item(6, "sdpf", "SDPF", "Os volumes registrados no sistema correspondem aos volumes físicos conferidos no setor?"),
  item(7, "separacao_logistica", "Separação Logística", "Os lacres são armazenados sob controle, rastreabilidade e responsabilidade definida?"),
  item(8, "separacao_logistica", "Separação Logística", "O flow rack respeita volumetria, endereço correto, PVPS e 5S?"),
  item(9, "separacao_logistica", "Separação Logística", "Apenas lacres homologados são utilizados e auditados por amostragem?"),
  item(10, "separacao_logistica", "Separação Logística", "O manuseio do produto previne avarias, quedas, empilhamento excessivo e contaminação?"),
  item(11, "separacao_logistica", "Separação Logística", "Os volumes separados mantêm organização, integridade e coerência física?"),
  item(12, "separacao_logistica", "Separação Logística", "O colaborador identifica corretamente produto, endereço, lote e validade?"),
  item(13, "separacao_logistica", "Separação Logística", "As não conformidades são sinalizadas e acompanhadas pela liderança?"),
  item(14, "separacao_logistica", "Separação Logística", "A área está limpa, organizada e sem obstruções operacionais?"),
  item(15, "psicotropico", "Psicotrópico", "Existe área segregada com controle de acesso físico e funcional?"),
  item(16, "psicotropico", "Psicotrópico", "Existe algum produto controlado fora da zona autorizada?"),
  item(17, "psicotropico", "Psicotrópico", "O PVPS é aplicado e auditado por amostragem mínima?"),
  item(18, "psicotropico", "Psicotrópico", "O lote físico confere com etiqueta, bin ou jateamento?"),
  item(19, "psicotropico", "Psicotrópico", "A capacidade física e organização do setor estão adequadas à criticidade do estoque?"),
  item(20, "psicotropico", "Psicotrópico", "Os registros e movimentações de controlados estão rastreáveis?"),
  item(21, "pulmao_prevencao", "Pulmão", "Os produtos estão corretamente identificados por validade, lote e endereço?"),
  item(22, "pulmao_prevencao", "Pulmão", "Existe ausência de excesso de carga nos paletes?"),
  item(23, "pulmao_prevencao", "Pulmão", "A organização física dos volumes nos paletes segue o padrão de estabilidade e integridade?"),
  item(24, "pulmao_prevencao", "Pulmão", "As ruas estão livres e acessíveis para operação e emergência?"),
  item(25, "pulmao_prevencao", "Pulmão", "Há coerência entre estoque físico e sistema por amostragem?"),
  item(26, "pulmao_prevencao", "Pulmão", "Os produtos do pulmão estão dentro da política e dentro do prazo de validade?")
];

const PREVENCAO_RISCOS_GERAL_ITEMS: ChecklistItem[] = [
  item(1, "recebimento", "Recebimento", "O recebimento ocorre exclusivamente conforme agendamento autorizado, com exceções formalmente definidas e justificadas (fraldas, leite, termolábil)?", { item_weight: 0.03 }),
  item(2, "recebimento", "Recebimento", "As cargas recebidas atendem ao padrão físico e de integridade definido: paletização correta, altura padrão, filme íntegro e sem avaria aparente?", { item_weight: 0.03 }),
  item(3, "recebimento", "Recebimento", "Existe um controle e uma segregação imediata de produtos termolábeis, com verificação e registro de veículo refrigerado, temperatura, local de conferência e armazenagem?", { item_weight: 0.05 }),
  item(4, "recebimento", "Recebimento", "Os medicamentos controlados são recebidos com dupla validação, protocolo formal e rastreabilidade entre recebimento e armazenagem?", { item_weight: 0.03 }),
  item(5, "recebimento", "Recebimento", "Os desvios identificados (avaria, vencido, falta ou sobra) possuem registro formal, evidência, assinatura das partes envolvidas e validação da Prevenção de Perdas?", { item_weight: 0.03 }),
  item(6, "recebimento", "Recebimento", "A devolução dos desvios identificados possui registro formal, evidência, assinatura das partes envolvidas e validação da Prevenção de Perdas?", { item_weight: 0.03 }),
  item(7, "expedicao_risco", "Expedição", "A expedição ocorre com dimensionamento adequado de pessoas, com a presença obrigatória do CD, da Prevenção de Perdas e da Transportadora?", { item_weight: 0.04 }),
  item(8, "expedicao_risco", "Expedição", "As rotas estão fisicamente segregadas, organizadas e sinalizadas para evitar troca, mistura ou erro de volumes no carregamento?", { item_weight: 0.04 }),
  item(9, "expedicao_risco", "Expedição", "A conferência físico vs documentação é realizada antes do fechamento do carregamento, com assinatura de todos os envolvidos e registro formal de divergências?", { item_weight: 0.04 }),
  item(10, "expedicao_risco", "Expedição", "Os veículos atendem aos critérios de segurança operacional e patrimonial antes do carregamento?", { item_weight: 0.04 }),
  item(11, "expedicao_risco", "Expedição", "A Prevenção de Perdas acompanha e audita a expedição de itens críticos (termolábeis)?", { item_weight: 0.04 }),
  item(12, "avaria_sdpf", "Avaria / SDPF", "As avarias são destinadas ao SDPF dentro do prazo máximo definido, sem acúmulo ou desvio de fluxo?", { item_weight: 0.015 }),
  item(13, "avaria_sdpf", "Avaria / SDPF", "Os volumes avulsos seguem padrão de rastreabilidade (QR Code, produto, lote, validade e quantidade)?", { item_weight: 0.015 }),
  item(14, "avaria_sdpf", "Avaria / SDPF", "Existe controle formal sobre produtos recuperáveis, com prazo máximo para decisão e execução do que vai ser recuperado ou não?", { item_weight: 0.01 }),
  item(15, "avaria_sdpf", "Avaria / SDPF", "Todo expurgo do resultado do CD é formalmente autorizado, auditado e evidenciado?", { item_weight: 0.03 }),
  item(16, "avaria_sdpf", "Avaria / SDPF", "A Prevenção de Perdas realiza auditoria física periódica dos volumes SDPF versus relatórios?", { item_weight: 0.03 }),
  item(17, "reversa_excesso", "Logística Reversa - Excesso", "Os volumes de excessos retornam exclusivamente em embalagem padrão Pague Menos, lacrada e identificada?", { item_weight: 0.01 }),
  item(18, "reversa_excesso", "Logística Reversa - Excesso", "A documentação física e sistêmica está 100% aderente aos volumes recebidos?", { item_weight: 0.01 }),
  item(19, "reversa_excesso", "Logística Reversa - Excesso", "Os produtos controlados são segregados imediatamente no recebimento da reversa?", { item_weight: 0.01 }),
  item(20, "reversa_excesso", "Logística Reversa - Excesso", "Não há mistura de categorias, produtos ou condições sanitárias nos volumes?", { item_weight: 0.01 }),
  item(21, "reversa_excesso", "Logística Reversa - Excesso", "O setor possui fluxo definido, sinalização clara e espaço físico respeitado?", { item_weight: 0.01 }),
  item(22, "reversa_excesso", "Logística Reversa - Excesso", "Não existem lojas pendentes de recebimento pela logística reversa?", { item_weight: 0.015 }),
  item(23, "reversa_excesso", "Logística Reversa - Excesso", "Não existem produtos pendentes de armazenamento pela logística?", { item_weight: 0.01 }),
  item(24, "separacao_logistica", "Separação Logística", "Os lacres são armazenados sob controle, rastreabilidade e responsabilidade definida?", { item_weight: 0.015 }),
  item(25, "separacao_logistica", "Separação Logística", "O flow rack respeita volumetria, endereço correto, PVPS e 5S?", { item_weight: 0.015 }),
  item(26, "separacao_logistica", "Separação Logística", "Apenas lacres homologados são utilizados e auditados por amostragem?", { item_weight: 0.015 }),
  item(27, "separacao_logistica", "Separação Logística", "O manuseio do produto previne avarias, quedas, empilhamento excessivo e contaminação?", { item_weight: 0.02 }),
  item(28, "separacao_logistica", "Separação Logística", "Os volumes separados mantêm organização, integridade e coerência física?", { item_weight: 0.01 }),
  item(29, "psicotropicos", "Psicotrópicos", "Existe uma área segregada com controle de acesso físico e funcional?", { item_weight: 0.03 }),
  item(30, "psicotropicos", "Psicotrópicos", "Existe algum produto controlado fora da zona autorizada?", { item_weight: 0.03 }),
  item(31, "psicotropicos", "Psicotrópicos", "O PVPS é aplicado e auditado por amostragem mínima?", { item_weight: 0.03 }),
  item(32, "psicotropicos", "Psicotrópicos", "O lote físico confere com etiqueta, bin ou jateamento?", { item_weight: 0.03 }),
  item(33, "psicotropicos", "Psicotrópicos", "A capacidade física e organização do setor está adequada à criticidade do estoque?", { item_weight: 0.03 }),
  item(34, "seguranca_patrimonial", "Segurança Patrimonial", "O controle de acesso é efetivo, sem presença de terceiros não autorizados em todo o perímetro do CD?", { item_weight: 0.02 }),
  item(35, "seguranca_patrimonial", "Segurança Patrimonial", "O sistema de CFTV, iluminação e monitoramento estão 100% operantes?", { item_weight: 0.015 }),
  item(36, "seguranca_patrimonial", "Segurança Patrimonial", "O descarte de resíduos é acompanhado e registrado?", { item_weight: 0.02 }),
  item(37, "seguranca_patrimonial", "Segurança Patrimonial", "Há ausência de indícios de consumo, subtração ou desvio?", { item_weight: 0.01 }),
  item(38, "seguranca_patrimonial", "Segurança Patrimonial", "Quando ocorre visita de terceiros na operação, o time de Prevenção de Perdas e Segurança Patrimonial é previamente avisado com dados completos?", { item_weight: 0.02 }),
  item(39, "seguranca_patrimonial", "Segurança Patrimonial", "Há não conformidades registradas, tratadas e escalonadas?", { item_weight: 0.015 }),
  item(40, "seguranca_trabalho_incendio", "Segurança do Trabalho e Incêndio", "As rotas de passagem do CD estão livres, sem obstrução, com sinalização visível e piso adequado?", { item_weight: 0.005 }),
  item(41, "seguranca_trabalho_incendio", "Segurança do Trabalho e Incêndio", "Há áreas críticas sinalizadas (empilhadeiras, docas, pulmão, flow rack)?", { item_weight: 0.005 }),
  item(42, "seguranca_trabalho_incendio", "Segurança do Trabalho e Incêndio", "Os equipamentos de combate a incêndio estão acessíveis, sinalizados e dentro da validade?", { item_weight: 0.005 }),
  item(43, "seguranca_trabalho_incendio", "Segurança do Trabalho e Incêndio", "Iluminação, ventilação e ergonomia estão adequadas às atividades?", { item_weight: 0.005 }),
  item(44, "seguranca_trabalho_incendio", "Segurança do Trabalho e Incêndio", "Os colaboradores são instruídos, treinados e respeitam a segregação homem x máquina?", { item_weight: 0.02 }),
  item(45, "seguranca_trabalho_incendio", "Segurança do Trabalho e Incêndio", "Os colaboradores estão treinados para emergência, abandono e primeiros combates?", { item_weight: 0.01 }),
  item(46, "pulmao_armazenagem", "Pulmão / Armazenagem", "Os produtos estão corretamente identificados (validade, lote, endereço)?", { item_weight: 0.005 }),
  item(47, "pulmao_armazenagem", "Pulmão / Armazenagem", "Existe ausência de excesso de carga nos paletes?", { item_weight: 0.005 }),
  item(48, "pulmao_armazenagem", "Pulmão / Armazenagem", "A organização física dos volumes nos pallets está seguindo o padrão (estabilidade e integridade)?", { item_weight: 0.005 }),
  item(49, "pulmao_armazenagem", "Pulmão / Armazenagem", "As ruas estão livres e são acessíveis para a operação e para situações de emergência?", { item_weight: 0.015 }),
  item(50, "pulmao_armazenagem", "Pulmão / Armazenagem", "Há coerência entre estoque físico e sistema por amostragem multicanal?", { item_weight: 0.02 })
];

const EXPEDICAO_ITEMS: ChecklistItem[] = [
  item(1, "expedicao", "Expedição", "No momento da expedição, todos os envolvidos estão presentes (CD, Prevenção de Perdas e Transportadora)? O quantitativo de colaboradores é suficiente para execução segura da operação?", { max_points: 10, criticality: "Crítico", is_critical: true }),
  item(2, "expedicao", "Expedição", "As rotas estão claramente organizadas, com distanciamento padrão entre lojas e, quando aplicável, uso de divisórias ou gaiolas para evitar trocas ou erros de carregamento?", { max_points: 5, criticality: "Importante" }),
  item(3, "expedicao", "Expedição", "O relatório de expedição corresponde aos volumes físicos carregados? Todos os documentos estão assinados pelos responsáveis e, em caso de divergência, há e-mail formal anexado ao relatório?", { max_points: 10, criticality: "Crítico", is_critical: true }),
  item(4, "expedicao", "Expedição", "O veículo acoplado à doca atende aos padrões de segurança operacional (trava de roda, plataforma niveladora e rampa adequadas)?", { max_points: 10, criticality: "Crítico", is_critical: true }),
  item(5, "expedicao", "Expedição", "Há recebimento de mercadorias sendo realizado na doca de expedição, fora do fluxo padrão (exceto logística reversa autorizada)?", { max_points: 5, criticality: "Importante" }),
  item(6, "expedicao", "Expedição", "Os volumes estão corretamente padronizados nos paletes quanto à altura (até 5 basquetas), quantidade e integridade das embalagens?", { max_points: 10, criticality: "Crítico", is_critical: true }),
  item(7, "expedicao", "Expedição", "O manuseio dos volumes pela transportadora está sendo feito de forma adequada, minimizando riscos de avarias?", { max_points: 5, criticality: "Importante" }),
  item(8, "expedicao", "Expedição", "Os colaboradores da transportadora receberam treinamento para os processos de carregamento e expedição?", { max_points: 5, criticality: "Importante" }),
  item(9, "expedicao", "Expedição", "A equipe de Prevenção de Perdas está auditando a integridade física dos volumes antes do embarque?", { max_points: 10, criticality: "Crítico", is_critical: true }),
  item(10, "expedicao", "Expedição", "A conferência dos volumes pela Prevenção de Perdas está sendo realizada conforme a sequência correta de carregamento?", { max_points: 10, criticality: "Crítico", is_critical: true }),
  item(11, "expedicao", "Expedição", "Os produtos termolábeis estão sendo conferidos pela Prevenção de Perdas, com registro e evidência documental do embarque?", { max_points: 10, criticality: "Crítico", is_critical: true }),
  item(12, "expedicao", "Expedição", "As caixas térmicas (isopores) estão limpas, íntegras e adequadas para o transporte de produtos termolábeis?", { max_points: 5, criticality: "Importante" }),
  item(13, "expedicao", "Expedição", "A temperatura dos produtos termolábeis e do caminhão com conservadora está entre 2 °C e 8 °C? Nos CDs sem conservadora, as baterias estão 100% maturadas?", { max_points: 10, criticality: "Crítico", is_critical: true }),
  item(14, "expedicao", "Expedição", "O sistema de monitoramento da expedição está operante (iluminação adequada, câmeras funcionando e sensores ativos)?", { max_points: 2, criticality: "Controle" }),
  item(15, "expedicao", "Expedição", "Existem riscos ou vulnerabilidades identificados na área de expedição (docas, embarque ou volumes de mercadoria)?", { max_points: 2, criticality: "Controle" }),
  item(16, "expedicao", "Expedição", "Todas as docas estão em condições adequadas e seguras para operação?", { max_points: 2, criticality: "Controle" }),
  item(17, "expedicao", "Expedição", "Os veículos da transportadora apresentam condições adequadas de higiene e piso não contaminante, conforme RDC nº 430/2020 - Art. 67?", { max_points: 2, criticality: "Controle" }),
  item(18, "expedicao", "Expedição", "A organização das mercadorias dentro do baú garante a integridade dos produtos e evita avarias durante o transporte?", { max_points: 5, criticality: "Importante" })
];

const AVARIA_ITEMS: ChecklistItem[] = [
  item(1, "avaria", "Avaria", "As avarias estão sendo registradas mensalmente no sistema e encaminhadas ao SDPF pela Logística dentro do prazo, sem gerar acúmulo de materiais no setor?", { max_points: 20, criticality: "Crítico", is_critical: true }),
  item(2, "avaria", "Avaria", "A Logística está seguindo o padrão definido para a criação de volumes avulsos, contendo corretamente QR Code, identificação do produto, quantidade, lote e data de vencimento?", { max_points: 15, criticality: "Importante" }),
  item(3, "avaria", "Avaria", "Os processos relacionados a desvio de qualidade estão sendo avaliados e formalmente aprovados pelo farmacêutico responsável, conforme estabelecido no PO SD4?", { max_points: 20, criticality: "Crítico", is_critical: true }),
  item(4, "avaria", "Avaria", "Os volumes registrados no sistema correspondem integralmente aos volumes físicos existentes e conferidos no setor?", { max_points: 20, criticality: "Crítico", is_critical: true }),
  item(5, "avaria", "Avaria", "O setor de avarias e não conformes possui câmeras de monitoramento operantes e com cobertura adequada da área?", { max_points: 5, criticality: "Controle" }),
  item(6, "avaria", "Avaria", "O processo de tratamento de avarias e não conformidades está sendo executado em área devidamente segregada, conforme normas vigentes e procedimentos internos?", { max_points: 15, criticality: "Importante" }),
  item(7, "avaria", "Avaria", "O setor mantém padrões de organização, limpeza e controle, em conformidade com a metodologia 5S e os procedimentos internos vigentes?", { max_points: 5, criticality: "Controle" })
];

export const CHECKLIST_DEFINITIONS: ChecklistDefinition[] = [
  {
    checklist_key: "dto_pvps",
    title: "DTO - Auditoria de PVPS",
    version: "1.0",
    total_items: 17,
    description: "Auditoria de PVPS nas áreas de separação e pulmão.",
    sections: ["zona_separacao", "pulmao"],
    items: PVPS_ITEMS,
    scoring_mode: "simple",
    requires_evaluated_user: true
  },
  {
    checklist_key: "dto_alocacao",
    title: "DTO - Auditoria de Alocação",
    version: "1.0",
    total_items: 9,
    description: "Auditoria do processo de alocação e tratamento de anomalias.",
    sections: ["alocacao"],
    items: ALOCACAO_ITEMS,
    scoring_mode: "simple",
    requires_evaluated_user: true
  },
  {
    checklist_key: "dto_blitz_separacao",
    title: "DTO - Blitz de Separação",
    version: "1.0",
    total_items: 12,
    description: "Blitz operacional de separação, adaptada para registro eletrônico.",
    sections: ["blitz_preparo", "blitz_execucao"],
    items: BLITZ_SEPARACAO_ITEMS,
    scoring_mode: "simple",
    requires_evaluated_user: true
  },
  {
    checklist_key: "auditoria_prevencao_perdas",
    title: "Auditoria de Prevenção de Perdas",
    version: "1.0",
    total_items: 26,
    description: "Auditoria de prevenção por SDPF, separação, psicotrópico e pulmão.",
    sections: ["sdpf", "separacao_logistica", "psicotropico", "pulmao_prevencao"],
    items: AUDITORIA_PREVENCAO_PERDAS_ITEMS,
    scoring_mode: "simple",
    requires_evaluated_user: true
  },
  {
    checklist_key: "prevencao_riscos_geral",
    title: "Prevenção de Perdas e Gestão de Riscos - Geral",
    version: "1.0",
    total_items: 50,
    description: "Auditoria por CD com cálculo ponderado de risco por bloco.",
    sections: ["recebimento", "expedicao_risco", "avaria_sdpf", "reversa_excesso", "separacao_logistica", "psicotropicos", "seguranca_patrimonial", "seguranca_trabalho_incendio", "pulmao_armazenagem"],
    items: PREVENCAO_RISCOS_GERAL_ITEMS,
    scoring_mode: "risk_weighted",
    requires_evaluated_user: false
  },
  {
    checklist_key: "prevencao_riscos_expedicao",
    title: "Prevenção de Perdas e Gestão de Riscos - Expedição",
    version: "1.0",
    total_items: 18,
    description: "Auditoria por CD com pontuação da expedição e trava por item crítico.",
    sections: ["expedicao"],
    items: EXPEDICAO_ITEMS,
    scoring_mode: "score_points",
    requires_evaluated_user: false
  },
  {
    checklist_key: "prevencao_riscos_avaria",
    title: "Prevenção de Perdas e Gestão de Riscos - Avaria",
    version: "1.0",
    total_items: 7,
    description: "Auditoria por CD com pontuação de avaria e trava por item crítico.",
    sections: ["avaria"],
    items: AVARIA_ITEMS,
    scoring_mode: "score_points",
    requires_evaluated_user: false
  }
];

export function getChecklistDefinition(key: ChecklistKey): ChecklistDefinition {
  return CHECKLIST_DEFINITIONS.find((definition) => definition.checklist_key === key) ?? CHECKLIST_DEFINITIONS[0];
}
