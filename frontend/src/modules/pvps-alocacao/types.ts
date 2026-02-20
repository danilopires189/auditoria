export type PvpsEndSit = "vazio" | "obstruido";
export type PvpsModulo = "pvps" | "alocacao" | "ambos";

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
}

export interface PvpsPulItemRow {
  end_pul: string;
  val_pul: string | null;
  auditado: boolean;
}

export interface PvpsSepSubmitResult {
  audit_id: string;
  status: PvpsStatus;
  val_sep: string;
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
}

export interface AlocacaoSubmitResult {
  audit_id: string;
  aud_sit: "conforme" | "nao_conforme";
  val_sist: string;
  val_conf: string;
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
