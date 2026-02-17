export type InventarioRole = "admin" | "auditor" | "viewer";
export type InventarioStage = 1 | 2;
export type InventarioResultado = "correto" | "falta" | "sobra" | "descartado";
export type InventarioReviewReason = "sem_consenso" | "conflito_lock";
export type InventarioReviewStatus = "pendente" | "resolvido";
export type InventarioEventType = "count_upsert" | "review_resolve";
export type InventarioPendingStatus = "pending" | "error";

export interface InventarioModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: InventarioRole;
  cd_default: number | null;
  cd_nome: string | null;
}

export interface CdOption {
  cd: number;
  cd_nome: string;
}

export interface InventarioManifestMeta {
  cd: number;
  row_count: number;
  zonas_count: number;
  source_run_id: string | null;
  manifest_hash: string;
  generated_at: string;
}

export interface InventarioManifestItemRow {
  cd: number;
  zona: string;
  endereco: string;
  coddv: number;
  descricao: string;
  estoque: number;
}

export interface InventarioCountRow {
  cycle_date: string;
  cd: number;
  zona: string;
  endereco: string;
  coddv: number;
  descricao: string;
  estoque: number;
  etapa: InventarioStage;
  qtd_contada: number;
  barras: string | null;
  resultado: InventarioResultado;
  counted_by: string;
  counted_mat: string;
  counted_nome: string;
  updated_at: string;
}

export interface InventarioReviewRow {
  cycle_date: string;
  cd: number;
  zona: string;
  endereco: string;
  coddv: number;
  descricao: string;
  estoque: number;
  reason_code: InventarioReviewReason;
  snapshot: Record<string, unknown>;
  status: InventarioReviewStatus;
  final_qtd: number | null;
  final_barras: string | null;
  final_resultado: InventarioResultado | null;
  resolved_by: string | null;
  resolved_mat: string | null;
  resolved_nome: string | null;
  resolved_at: string | null;
  updated_at: string;
}

export interface InventarioLockRow {
  lock_id: string;
  cycle_date: string;
  cd: number;
  zona: string;
  etapa: InventarioStage;
  locked_by: string;
  locked_mat: string;
  locked_nome: string;
  heartbeat_at: string;
  expires_at: string;
  updated_at: string;
}

export interface InventarioZoneOverviewRow {
  zona: string;
  total_itens: number;
  pendentes_primeira: number;
  concluidos_primeira: number;
  pendentes_segunda: number;
  concluidos_segunda: number;
  revisao_pendente: number;
  concluidos_finais: number;
}

export interface InventarioPendingEvent {
  event_id: string;
  client_event_id: string;
  user_id: string;
  cd: number;
  cycle_date: string;
  event_type: InventarioEventType;
  payload: Record<string, unknown>;
  status: InventarioPendingStatus;
  attempt_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventarioSyncPullState {
  counts: InventarioCountRow[];
  reviews: InventarioReviewRow[];
  locks: InventarioLockRow[];
  server_time: string | null;
}

export interface InventarioLocalStateCache extends InventarioSyncPullState {
  key: string;
  user_id: string;
  cd: number;
  cycle_date: string;
  updated_at: string;
}

export interface InventarioPreferences {
  cd_ativo: number | null;
  prefer_offline_mode: boolean;
}

export interface InventarioEventApplyResponse {
  accepted: boolean;
  info: string;
  updated_at: string;
}

export interface InventarioLockAcquireResponse {
  lock_id: string;
  cycle_date: string;
  cd: number;
  zona: string;
  etapa: InventarioStage;
  locked_by: string;
  locked_mat: string;
  locked_nome: string;
  heartbeat_at: string;
  expires_at: string;
}

export interface InventarioReportRow {
  cycle_date: string;
  cd: number;
  zona: string;
  endereco: string;
  coddv: number;
  descricao: string;
  estoque: number;
  qtd_primeira: number | null;
  barras_primeira: string | null;
  resultado_primeira: InventarioResultado | null;
  primeira_mat: string | null;
  primeira_nome: string | null;
  primeira_at: string | null;
  qtd_segunda: number | null;
  barras_segunda: string | null;
  resultado_segunda: InventarioResultado | null;
  segunda_mat: string | null;
  segunda_nome: string | null;
  segunda_at: string | null;
  review_reason: InventarioReviewReason | null;
  review_status: InventarioReviewStatus | null;
  review_final_qtd: number | null;
  review_final_barras: string | null;
  review_final_resultado: InventarioResultado | null;
  review_resolved_mat: string | null;
  review_resolved_nome: string | null;
  review_resolved_at: string | null;
  contado_final: number | null;
  barras_final: string | null;
  divergencia_final: InventarioResultado | null;
  origem_final: string;
  status_final: string;
}
