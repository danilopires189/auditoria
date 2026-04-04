export interface ControleValidadeModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface ControleValidadePreferences {
  prefer_offline_mode: boolean;
}

export type RetiradaStatus = "pendente" | "concluido";
export type RetiradaStatusFilter = RetiradaStatus | "todos";

export interface LinhaColetaLookupResult {
  cd: number;
  coddv: number;
  descricao: string;
  barras: string;
  enderecos_sep: string[];
}

export interface LinhaRetiradaRow {
  cd: number;
  coddv: number;
  descricao: string;
  endereco_sep: string;
  val_mmaa: string;
  ref_coleta_mes: string;
  qtd_coletada: number;
  qtd_retirada: number;
  qtd_pendente: number;
  status: RetiradaStatus;
  regra_aplicada: string;
  dt_ultima_coleta: string | null;
  auditor_nome_ultima_coleta: string | null;
  auditor_mat_ultima_coleta: string | null;
  editable_retirada_id: string | null;
  editable_retirada_qtd: number | null;
}

export interface LinhaColetaHistoryRow {
  id: string;
  cd: number;
  coddv: number;
  descricao: string;
  barras: string;
  zona: string;
  endereco_sep: string;
  val_mmaa: string;
  data_coleta: string | null;
  auditor_id: string | null;
  auditor_mat: string | null;
  auditor_nome: string | null;
}

export interface PulRetiradaRow {
  cd: number;
  coddv: number;
  descricao: string;
  zona: string;
  endereco_pul: string;
  andar: string | null;
  val_mmaa: string;
  qtd_retirada: number;
  qtd_pendente: number;
  status: RetiradaStatus;
  qtd_est_disp: number;
  dt_ultima_retirada: string | null;
  auditor_nome_ultima_retirada: string | null;
  editable_retirada_id: string | null;
  editable_retirada_qtd: number | null;
}

export interface LinhaColetaPayload {
  client_event_id: string;
  cd: number;
  barras: string;
  coddv: number;
  descricao: string;
  endereco_sep: string;
  val_mmaa: string;
  auditor_mat: string | null;
  auditor_nome: string | null;
  data_hr: string | null;
}

export interface LinhaRetiradaPayload {
  client_event_id: string;
  cd: number;
  coddv: number;
  endereco_sep: string;
  val_mmaa: string;
  ref_coleta_mes: string;
  qtd_retirada: number;
  data_hr: string | null;
}

export interface PulRetiradaPayload {
  client_event_id: string;
  cd: number;
  coddv: number;
  endereco_pul: string;
  val_mmaa: string;
  qtd_retirada: number;
  data_hr: string | null;
}

export type ControleValidadeOfflineEventKind =
  | "linha_coleta"
  | "linha_retirada"
  | "pul_retirada";

export type ControleValidadeOfflineEventStatus = "pending" | "error";

export type ControleValidadeOfflinePayload =
  | LinhaColetaPayload
  | LinhaRetiradaPayload
  | PulRetiradaPayload;

export interface ControleValidadeOfflineEventRow {
  event_id: string;
  user_id: string;
  cd: number;
  kind: ControleValidadeOfflineEventKind;
  status: ControleValidadeOfflineEventStatus;
  attempt_count: number;
  error_message: string | null;
  payload: ControleValidadeOfflinePayload;
  created_at: string;
  updated_at: string;
}

export interface ControleValidadeOfflineSnapshot {
  user_id: string;
  cd: number;
  linha_rows: LinhaRetiradaRow[];
  linha_coleta_history: LinhaColetaHistoryRow[];
  pul_rows: PulRetiradaRow[];
  cached_at: string;
}

export interface ControleValidadeOfflineSyncResult {
  synced: number;
  failed: number;
  discarded: number;
  remaining: number;
  discarded_pul_sem_estoque: number;
}
