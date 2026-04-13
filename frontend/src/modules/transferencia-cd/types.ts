export type TransferenciaCdConfStatus = "em_conferencia" | "finalizado_ok" | "finalizado_falta" | "finalizado_parcial";
export type TransferenciaCdEtapa = "saida" | "entrada";
export type TransferenciaCdDivergenciaTipo = "nao_conferido" | "falta" | "sobra" | "correto";

export interface TransferenciaCdModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface CdOption {
  cd: number;
  cd_nome: string;
}

export interface TransferenciaCdNoteRow {
  dt_nf: string;
  nf_trf: number;
  sq_nf: number;
  cd_ori: number;
  cd_des: number;
  cd_ori_nome: string;
  cd_des_nome: string;
  etapa: TransferenciaCdEtapa;
  total_itens: number;
  qtd_esperada_total: number;
  saida_status: TransferenciaCdConfStatus | null;
  saida_started_mat: string | null;
  saida_started_nome: string | null;
  saida_started_at: string | null;
  saida_finalized_at: string | null;
  entrada_status: TransferenciaCdConfStatus | null;
  entrada_started_mat: string | null;
  entrada_started_nome: string | null;
  entrada_started_at: string | null;
  entrada_finalized_at: string | null;
}

export interface TransferenciaCdManifestMeta {
  cd: number;
  row_count: number;
  notas_count: number;
  source_run_id: string | null;
  manifest_hash: string;
  generated_at: string;
}

export interface TransferenciaCdManifestItemRow {
  dt_nf: string;
  nf_trf: number;
  sq_nf: number;
  cd_ori: number;
  cd_des: number;
  cd_ori_nome: string;
  cd_des_nome: string;
  etapa: TransferenciaCdEtapa;
  coddv: number;
  descricao: string;
  qtd_esperada: number;
  embcomp_cx: number | null;
  qtd_cxpad: number | null;
}

export interface TransferenciaCdManifestBarrasRow {
  barras: string;
  coddv: number;
  descricao: string;
  updated_at: string | null;
}

export interface TransferenciaCdConferenceRow {
  conf_id: string;
  conf_date: string;
  dt_nf: string;
  nf_trf: number;
  sq_nf: number;
  cd_ori: number;
  cd_des: number;
  cd_ori_nome: string;
  cd_des_nome: string;
  etapa: TransferenciaCdEtapa;
  status: TransferenciaCdConfStatus;
  falta_motivo: string | null;
  started_by: string;
  started_mat: string;
  started_nome: string;
  started_at: string;
  finalized_at: string | null;
  updated_at: string;
  is_read_only: boolean;
  origem_status: TransferenciaCdConfStatus | null;
  origem_started_mat: string | null;
  origem_started_nome: string | null;
  origem_started_at: string | null;
  origem_finalized_at: string | null;
}

export interface TransferenciaCdLocalItem {
  coddv: number;
  barras: string | null;
  descricao: string;
  qtd_esperada: number;
  qtd_conferida: number;
  embcomp_cx: number | null;
  qtd_cxpad: number | null;
  ocorrencia_avariado_qtd: number;
  ocorrencia_vencido_qtd: number;
  updated_at: string;
  is_locked?: boolean;
  locked_by?: string | null;
  locked_mat?: string | null;
  locked_nome?: string | null;
}

export interface TransferenciaCdBatchNoteRef extends TransferenciaCdNoteRow {
  conf_id: string | null;
}

export interface TransferenciaCdBatchAllocationRow {
  note_key: string;
  conf_id: string | null;
  dt_nf: string;
  nf_trf: number;
  sq_nf: number;
  cd_ori: number;
  cd_des: number;
  cd_ori_nome: string;
  cd_des_nome: string;
  etapa: TransferenciaCdEtapa;
  coddv: number;
  descricao: string;
  barras: string | null;
  qtd_esperada: number;
  qtd_conferida: number;
  embcomp_cx: number | null;
  qtd_cxpad: number | null;
  ocorrencia_avariado_qtd: number;
  ocorrencia_vencido_qtd: number;
  updated_at: string;
  is_locked: boolean;
  locked_by: string | null;
  locked_mat: string | null;
  locked_nome: string | null;
}

export interface TransferenciaCdLocalConference extends TransferenciaCdConferenceRow {
  local_key: string;
  user_id: string;
  cd: number;
  remote_conf_id: string | null;
  items: TransferenciaCdLocalItem[];
  pending_snapshot: boolean;
  pending_finalize: boolean;
  pending_finalize_reason: string | null;
  pending_cancel: boolean;
  sync_error: string | null;
  last_synced_at: string | null;
  conference_mode?: "single" | "batch";
  batch_notes?: TransferenciaCdBatchNoteRef[];
  batch_allocations?: TransferenciaCdBatchAllocationRow[];
}

export interface TransferenciaCdItemRow {
  item_id: string;
  conf_id: string;
  coddv: number;
  barras: string | null;
  descricao: string;
  qtd_esperada: number;
  qtd_conferida: number;
  qtd_falta: number;
  qtd_sobra: number;
  divergencia_tipo: TransferenciaCdDivergenciaTipo;
  embcomp_cx: number | null;
  qtd_cxpad: number | null;
  ocorrencia_avariado_qtd: number;
  ocorrencia_vencido_qtd: number;
  updated_at: string;
  is_locked: boolean;
  locked_by: string | null;
  locked_mat: string | null;
  locked_nome: string | null;
}

export interface TransferenciaCdPreferences {
  prefer_offline_mode: boolean;
  multiplo_padrao: number;
  cd_ativo: number | null;
}

export interface TransferenciaCdPendingSummary {
  pending_count: number;
  errors_count: number;
}

export interface TransferenciaCdReportFilters {
  dtIni: string;
  dtFim: string;
  cd: number;
}

export interface TransferenciaCdReportCount {
  total_notas: number;
  total_itens: number;
}

export interface TransferenciaCdReportRow {
  dt_nf: string;
  nf_trf: number;
  sq_nf: number;
  cd_ori: number;
  cd_des: number;
  cd_ori_nome: string;
  cd_des_nome: string;
  saida_status: TransferenciaCdConfStatus | null;
  saida_started_mat: string | null;
  saida_started_nome: string | null;
  saida_started_at: string | null;
  saida_finalized_at: string | null;
  entrada_status: TransferenciaCdConfStatus | null;
  entrada_started_mat: string | null;
  entrada_started_nome: string | null;
  entrada_started_at: string | null;
  entrada_finalized_at: string | null;
  conciliacao_status: string;
  coddv: number;
  descricao: string;
  qtd_atend: number;
  qtd_conferida_saida: number;
  qtd_conferida_entrada: number;
  diferenca_saida_destino: number;
  embcomp_cx: number | null;
  qtd_cxpad: number | null;
  ocorrencia_avariado_qtd: number;
  ocorrencia_vencido_qtd: number;
}
