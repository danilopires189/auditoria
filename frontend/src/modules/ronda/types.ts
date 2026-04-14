export const RONDA_QUALIDADE_MOTIVOS_SEP = [
  "Produto misturado no mesmo bin",
  "Bin com excesso",
  "Bin virado com produto dentro",
  "Produto líquido deitado",
  "Bin sem etiqueta ou sem identificação",
  "Produto sem bin",
  "Envelopado sem sinalização de etiqueta vermelha",
  "Remanejamento sem troca da etiqueta de endereço",
  "Produto não envelopado ou desmembrado no bin"
] as const;

export const RONDA_QUALIDADE_MOTIVOS_PUL = [
  "Produto com escadinha",
  "Produto misturado",
  "Produto com validade misturada",
  "Produto mal armazenado",
  "Produto avariado",
  "Produto vencido",
  "Sem etiqueta de validade",
  "Sem etiqueta de endereço",
  "Sem etiqueta de endereço e validade",
  "Produto sem identificação",
  "Etiqueta manual ilegível",
  "Duas ou mais avarias na mesma caixa"
] as const;

export type RondaQualidadeZoneType = "SEP" | "PUL";
export type RondaQualidadeAuditResult = "sem_ocorrencia" | "com_ocorrencia";
export type RondaQualidadeCorrectionStatus = "nao_corrigido" | "corrigido";
export type RondaQualidadeOccurrenceReasonSep = typeof RONDA_QUALIDADE_MOTIVOS_SEP[number];
export type RondaQualidadeOccurrenceReasonPul = typeof RONDA_QUALIDADE_MOTIVOS_PUL[number];
export type RondaQualidadeOccurrenceReason = RondaQualidadeOccurrenceReasonSep | RondaQualidadeOccurrenceReasonPul;

export interface RondaQualidadeModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface RondaQualidadeMonthOption {
  month_start: string;
  month_label: string;
}

export interface RondaQualidadeAddressOption {
  endereco: string;
  coluna: number | null;
  nivel: string | null;
  produtos_unicos: number;
  produto_label: string;
}

export interface RondaQualidadeZoneSummary {
  cd: number;
  month_ref: string;
  zone_type: RondaQualidadeZoneType;
  zona: string;
  total_enderecos: number;
  produtos_unicos: number;
  enderecos_com_ocorrencia: number;
  percentual_conformidade: number;
  audited_in_month: boolean;
  total_auditorias: number;
  last_audit_at: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  total_colunas: number;
  total_colunas_auditadas: number;
  total_niveis: number;
}

export interface RondaQualidadeColumnStat {
  coluna: number;
  total_enderecos: number;
  produtos_unicos: number;
  enderecos_com_ocorrencia: number;
  percentual_conformidade: number;
  audited_in_month: boolean;
  total_auditorias: number;
  last_audit_at: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
}

export interface RondaQualidadeLevelStat {
  nivel: string;
  total_enderecos: number;
  produtos_unicos: number;
}

export interface RondaQualidadeHistoryOccurrence {
  occurrence_id: string;
  motivo: string;
  endereco: string;
  nivel: string | null;
  coluna: number | null;
  observacao: string;
  correction_status: RondaQualidadeCorrectionStatus;
  correction_updated_at: string | null;
  correction_updated_mat: string | null;
  correction_updated_nome: string | null;
  created_at: string;
}

export interface RondaQualidadeHistorySession {
  audit_id: string;
  audit_result: RondaQualidadeAuditResult;
  coluna: number | null;
  auditor_nome: string;
  auditor_mat: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  occurrence_count: number;
  occurrences: RondaQualidadeHistoryOccurrence[];
}

export interface RondaQualidadeZoneDetail extends RondaQualidadeZoneSummary {
  column_stats: RondaQualidadeColumnStat[];
  level_stats: RondaQualidadeLevelStat[];
  history_rows: RondaQualidadeHistorySession[];
}

export interface RondaQualidadeOccurrenceDraft {
  motivo: string;
  endereco: string;
  observacao: string;
  nivel: string;
  enderecoManual: boolean;
}

export interface RondaQualidadeOccurrenceHistoryRow {
  occurrence_id: string;
  audit_id: string;
  month_ref: string;
  cd: number;
  zone_type: RondaQualidadeZoneType;
  zona: string;
  coluna: number | null;
  endereco: string;
  nivel: string | null;
  motivo: string;
  observacao: string;
  correction_status: RondaQualidadeCorrectionStatus;
  correction_updated_at: string | null;
  correction_updated_mat: string | null;
  correction_updated_nome: string | null;
  created_at: string;
  auditor_nome: string;
  auditor_mat: string;
  audit_result: RondaQualidadeAuditResult;
}
