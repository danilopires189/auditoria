export type PvpsEndSit = "vazio" | "obstruido";
export type PvpsModulo = "pvps" | "alocacao" | "ambos";
export type PvpsRuleKind = "blacklist" | "priority";
export type PvpsRuleTargetType = "zona" | "coddv";
export type PvpsRuleApplyMode = "apply_now" | "next_inclusions";

export type PvpsStatus = "pendente_sep" | "pendente_pul" | "concluido" | "nao_conforme";

export interface PvpsManifestRow {
  cd: number;
  zona: string;
  coddv: number;
  descricao: string;
  end_sep: string;
  pul_total: number;
  pul_auditados: number;
  status: PvpsStatus;
  end_sit: PvpsEndSit | null;
  val_sep: string | null;
  audit_id: string | null;
  dat_ult_compra: string;
  qtd_est_disp: number;
  priority_score: number;
}

export interface PvpsPulItemRow {
  end_pul: string;
  val_pul: string | null;
  end_sit: PvpsEndSit | null;
  auditado: boolean;
}

export interface PvpsSepSubmitResult {
  audit_id: string;
  status: PvpsStatus;
  val_sep: string | null;
  end_sit: PvpsEndSit | null;
  pul_total: number;
  pul_auditados: number;
}

export interface PvpsPulSubmitResult {
  audit_id: string;
  status: PvpsStatus;
  pul_total: number;
  pul_auditados: number;
  conforme: boolean;
}

export interface AlocacaoManifestRow {
  queue_id: string;
  cd: number;
  zona: string;
  coddv: number;
  descricao: string;
  endereco: string;
  nivel: string | null;
  val_sist: string;
  dat_ult_compra: string;
  qtd_est_disp: number;
  priority_score: number;
}

export interface AlocacaoSubmitResult {
  audit_id: string;
  aud_sit: "conforme" | "nao_conforme" | "ocorrencia";
  val_sist: string;
  val_conf: string | null;
}

export interface PvpsCompletedRow {
  audit_id: string;
  auditor_id: string;
  cd: number;
  zona: string;
  coddv: number;
  descricao: string;
  end_sep: string;
  status: PvpsStatus;
  end_sit: PvpsEndSit | null;
  val_sep: string | null;
  pul_total: number;
  pul_auditados: number;
  pul_has_lower: boolean;
  pul_lower_end: string | null;
  pul_lower_val: string | null;
  dt_hr: string;
  auditor_nome: string;
}

export interface AlocacaoCompletedRow {
  audit_id: string;
  auditor_id: string;
  queue_id: string;
  cd: number;
  zona: string;
  coddv: number;
  descricao: string;
  endereco: string;
  nivel: string | null;
  end_sit: PvpsEndSit | null;
  val_sist: string;
  val_conf: string | null;
  aud_sit: "conforme" | "nao_conforme" | "ocorrencia";
  dt_hr: string;
  auditor_nome: string;
}

export interface PvpsAlocacaoModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface PvpsAdminBlacklistRow {
  blacklist_id: string;
  cd: number;
  modulo: PvpsModulo;
  zona: string;
  coddv: number;
  created_at: string;
}

export interface PvpsAdminPriorityZoneRow {
  priority_id: string;
  cd: number;
  modulo: PvpsModulo;
  zona: string;
  prioridade: number;
  updated_at: string;
}

export interface PvpsAdminClearZoneResult {
  cleared_pvps: number;
  cleared_alocacao: number;
  reposto_pvps: number;
  reposto_alocacao: number;
}

export interface PvpsAdminRuleActiveRow {
  rule_id: string;
  cd: number;
  modulo: PvpsModulo;
  rule_kind: PvpsRuleKind;
  target_type: PvpsRuleTargetType;
  target_value: string;
  priority_value: number | null;
  created_by: string | null;
  created_by_mat: string | null;
  created_by_nome: string | null;
  created_at: string;
}

export interface PvpsAdminRuleHistoryRow {
  history_id: string;
  rule_id: string | null;
  cd: number;
  modulo: PvpsModulo;
  rule_kind: PvpsRuleKind;
  target_type: PvpsRuleTargetType;
  target_value: string;
  priority_value: number | null;
  action_type: "create" | "remove";
  apply_mode: PvpsRuleApplyMode | null;
  affected_pvps: number;
  affected_alocacao: number;
  actor_user_id: string | null;
  actor_user_mat: string | null;
  actor_user_nome: string | null;
  created_at: string;
}

export interface PvpsAdminRulePreviewResult {
  affected_pvps: number;
  affected_alocacao: number;
  affected_total: number;
}

export interface PvpsAdminRuleCreateResult {
  rule_id: string;
  cd: number;
  modulo: PvpsModulo;
  rule_kind: PvpsRuleKind;
  target_type: PvpsRuleTargetType;
  target_value: string;
  priority_value: number | null;
  apply_mode: PvpsRuleApplyMode;
  affected_pvps: number;
  affected_alocacao: number;
  created_at: string;
}
