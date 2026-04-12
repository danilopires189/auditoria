export type ChecklistAnswer = "Sim" | "Não" | "N.A.";
export type ChecklistKey = "dto_pvps" | "dto_alocacao";
export type ChecklistSectionKey = "zona_separacao" | "pulmao" | "alocacao";

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
}

export interface ChecklistDefinition {
  checklist_key: ChecklistKey;
  title: string;
  version: string;
  total_items: number;
  description: string;
  sections: ChecklistSectionKey[];
  items: ChecklistItem[];
}

export interface ChecklistAnswerPayload {
  item_number: number;
  answer: ChecklistAnswer;
}

export interface ChecklistFinalizePayload {
  checklist_key: ChecklistKey;
  cd: number | null;
  evaluated_mat: string;
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

const PVPS_ITEMS: ChecklistItem[] = [
  { item_number: 1, section_key: "zona_separacao", section_title: "Zona de Separação", question: "O flow rack contém o produto?" },
  { item_number: 2, section_key: "zona_separacao", section_title: "Zona de Separação", question: "O colaborador está informando a data de validade corretamente?" },
  { item_number: 3, section_key: "zona_separacao", section_title: "Zona de Separação", question: "O colaborador verifica se o endereço está com várias validades?" },
  { item_number: 4, section_key: "zona_separacao", section_title: "Zona de Separação", question: "O colaborador está informando a validade mais próxima?" },
  { item_number: 5, section_key: "zona_separacao", section_title: "Zona de Separação", question: "Existem coletores disponíveis?" },
  { item_number: 6, section_key: "zona_separacao", section_title: "Zona de Separação", question: "O colaborador identifica o produto corretamente? (Verificando a descrição do produto)" },
  { item_number: 7, section_key: "zona_separacao", section_title: "Zona de Separação", question: "O endereço está desobstruído e com acesso livre?" },
  { item_number: 8, section_key: "zona_separacao", section_title: "Zona de Separação", question: "Todos os produtos estão dentro da política de envio e dentro do prazo de validade?" },
  { item_number: 9, section_key: "zona_separacao", section_title: "Zona de Separação", question: "Todos os produtos no flow rack estão segregados por SKU e lote (sem mistura)?" },
  { item_number: 10, section_key: "zona_separacao", section_title: "Zona de Separação", question: "Todos os produtos armazenados no flow rack estão íntegros (sem avarias)?" },
  { item_number: 11, section_key: "pulmao", section_title: "Pulmão", question: "O produto está no endereço indicado?" },
  { item_number: 12, section_key: "pulmao", section_title: "Pulmão", question: "O produto possui alguma identificação? (Etiqueta Pulmão)" },
  { item_number: 13, section_key: "pulmao", section_title: "Pulmão", question: "O endereço está desobstruído e com acesso livre?" },
  { item_number: 14, section_key: "pulmao", section_title: "Pulmão", question: "O produto está de fácil acesso?" },
  { item_number: 15, section_key: "pulmao", section_title: "Pulmão", question: "A validade sinalizada na caixa padrão do fornecedor pela Logística está correta?" },
  { item_number: 16, section_key: "pulmao", section_title: "Pulmão", question: "Todos os produtos armazenados no pulmão estão dentro da política e dentro do prazo de validade?" },
  { item_number: 17, section_key: "pulmao", section_title: "Pulmão", question: "Os produtos armazenados no pulmão estão íntegros (sem avarias)?" }
];

const ALOCACAO_ITEMS: ChecklistItem[] = [
  { item_number: 1, section_key: "alocacao", section_title: "Alocação", question: "Existem coletores disponíveis?" },
  { item_number: 2, section_key: "alocacao", section_title: "Alocação", question: "Os endereços estão visíveis?" },
  { item_number: 3, section_key: "alocacao", section_title: "Alocação", question: "O endereço está desobstruído e com acesso livre?" },
  { item_number: 4, section_key: "alocacao", section_title: "Alocação", question: "O colaborador confere a data de validade do produto?" },
  { item_number: 5, section_key: "alocacao", section_title: "Alocação", question: "O colaborador retorna o volume para o endereço correto?" },
  { item_number: 6, section_key: "alocacao", section_title: "Alocação", question: "O colaborador organizou o volume que conferiu?" },
  { item_number: 7, section_key: "alocacao", section_title: "Alocação", question: "O colaborador sinaliza a não conformidade?" },
  { item_number: 8, section_key: "alocacao", section_title: "Alocação", question: "O colaborador registra com foto a não conformidade?" },
  { item_number: 9, section_key: "alocacao", section_title: "Alocação", question: "A supervisão de logística acompanha as anomalias apontadas na auditoria?" }
];

export const CHECKLIST_DEFINITIONS: ChecklistDefinition[] = [
  {
    checklist_key: "dto_pvps",
    title: "DTO - Auditoria de PVPS",
    version: "1.0",
    total_items: 17,
    description: "Auditoria de PVPS nas áreas de separação e pulmão.",
    sections: ["zona_separacao", "pulmao"],
    items: PVPS_ITEMS
  },
  {
    checklist_key: "dto_alocacao",
    title: "DTO - Auditoria de Alocação",
    version: "1.0",
    total_items: 9,
    description: "Auditoria do processo de alocação e tratamento de anomalias.",
    sections: ["alocacao"],
    items: ALOCACAO_ITEMS
  }
];

export function getChecklistDefinition(key: ChecklistKey): ChecklistDefinition {
  return CHECKLIST_DEFINITIONS.find((definition) => definition.checklist_key === key) ?? CHECKLIST_DEFINITIONS[0];
}
