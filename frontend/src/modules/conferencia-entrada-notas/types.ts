export type EntradaNotasConfStatus =
  | "em_conferencia"
  | "finalizado_ok"
  | "finalizado_divergencia"
  | "finalizado_falta";

export type EntradaNotasDivergenciaTipo = "falta" | "sobra" | "correto";

export interface EntradaNotasModuleProfile {
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

export interface EntradaNotasManifestMeta {
  cd: number;
  row_count: number;
  sequencias_count?: number;
  etiquetas_count: number;
  source_run_id: string | null;
  manifest_hash: string;
  generated_at: string;
}

export interface EntradaNotasManifestItemRow {
  seq_entrada?: number;
  nf?: number;
  transportadora?: string;
  fornecedor?: string;
  coddv: number;
  descricao: string;
  qtd_esperada: number;

  // Compatibilidade com a UI derivada do modulo volume.
  nr_volume: string;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
}

export interface EntradaNotasManifestBarrasRow {
  barras: string;
  coddv: number;
  descricao: string;
  updated_at: string | null;
}

export interface EntradaNotasRouteOverviewRow {
  transportadora: string;
  fornecedor: string;
  seq_entrada: number;
  nf: number;
  total_itens: number;
  itens_conferidos: number;
  itens_divergentes: number;
  valor_total: number;
  valor_conferido: number;
  status: "pendente" | "em_andamento" | "concluido";
  colaborador_nome: string | null;
  colaborador_mat: string | null;
  status_at: string | null;
  produtos_multiplos_seq: number;

  // Compatibilidade com a UI derivada do modulo volume.
  rota: string;
  filial: number | null;
  filial_nome: string;
  total_etiquetas: number;
  conferidas: number;
  pendentes: number;
  pedidos_seq: string | null;
}

export interface EntradaNotasItemRow {
  item_id: string;
  conf_id: string;
  coddv: number;
  barras: string | null;
  descricao: string;
  qtd_esperada: number;
  qtd_conferida: number;
  ocorrencia_avariado_qtd?: number;
  ocorrencia_vencido_qtd?: number;
  qtd_falta: number;
  qtd_sobra: number;
  divergencia_tipo: EntradaNotasDivergenciaTipo;
  updated_at: string;
  seq_entrada?: number | null;
  nf?: number | null;
  target_conf_id?: string | null;
  item_key?: string | null;
  is_locked?: boolean;
  locked_by?: string | null;
  locked_mat?: string | null;
  locked_nome?: string | null;
}

export interface EntradaNotasContributor {
  user_id: string;
  mat: string;
  nome: string;
  first_action_at: string;
  last_action_at: string;
}

export interface EntradaNotasPartialReopenInfo {
  conf_id: string;
  seq_entrada: number;
  nf: number;
  status: EntradaNotasConfStatus;
  previous_started_by: string | null;
  previous_started_mat: string | null;
  previous_started_nome: string | null;
  locked_items: number;
  pending_items: number;
  can_reopen: boolean;
}

export interface EntradaNotasBarcodeSeqNfOption {
  coddv: number;
  descricao: string;
  barras: string;
  seq_entrada: number;
  nf: number;
  transportadora: string;
  fornecedor: string;
  qtd_esperada: number;
  qtd_conferida: number;
  qtd_pendente: number;
}

export interface EntradaNotasAvulsaTargetOption {
  coddv: number;
  descricao: string;
  barras: string;
  seq_entrada: number;
  nf: number;
  transportadora: string;
  fornecedor: string;
  qtd_esperada: number;
  qtd_conferida: number;
  qtd_pendente: number;
  target_conf_id: string | null;
  target_status: string | null;
  started_by: string | null;
  started_nome: string | null;
  started_mat: string | null;
  is_locked: boolean;
  is_available: boolean;
}

export interface EntradaNotasAvulsaTargetSummary {
  avulsa_conf_id: string;
  target_conf_id: string;
  seq_entrada: number;
  nf: number;
  transportadora: string;
  fornecedor: string;
  status: EntradaNotasConfStatus;
  total_itens: number;
  itens_conferidos: number;
  falta_count: number;
  sobra_count: number;
  correto_count: number;
  first_scan_at: string | null;
  last_scan_at: string | null;
}

export interface EntradaNotasAvulsaConflictCheck {
  conf_id: string;
  has_remote_data: boolean;
  remote_targets: number;
  remote_items_conferidos: number;
  seq_nf_list: string;
}

export interface EntradaNotasAvulsaQueueEvent {
  event_id: string;
  kind: "scan" | "set_qtd";
  barras: string;
  coddv: number;
  qtd: number;
  seq_entrada: number;
  nf: number;
  target_conf_id: string | null;
  created_at: string;
}

export interface EntradaNotasVolumeRow {
  conf_id: string;
  conf_date: string;
  cd: number;
  conference_kind?: "seq_nf" | "avulsa";
  seq_entrada?: number;
  nf?: number;
  transportadora?: string;
  fornecedor?: string;
  status: EntradaNotasConfStatus;
  started_by: string;
  started_mat: string;
  started_nome: string;
  started_at: string;
  finalized_at: string | null;
  updated_at: string;
  is_read_only: boolean;

  // Compatibilidade com a UI derivada do modulo volume.
  nr_volume: string;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  falta_motivo: string | null;
  contributors?: EntradaNotasContributor[];
}

export interface EntradaNotasLocalItem {
  coddv: number;
  barras: string | null;
  descricao: string;
  qtd_esperada: number;
  qtd_conferida: number;
  ocorrencia_avariado_qtd?: number;
  ocorrencia_vencido_qtd?: number;
  updated_at: string;
  seq_entrada?: number | null;
  nf?: number | null;
  target_conf_id?: string | null;
  item_key?: string | null;
  is_locked?: boolean;
  locked_by?: string | null;
  locked_mat?: string | null;
  locked_nome?: string | null;
}

export interface EntradaNotasLocalVolume {
  local_key: string;
  user_id: string;
  conf_date: string;
  cd: number;
  conference_kind?: "seq_nf" | "avulsa";
  seq_entrada?: number;
  nf?: number;
  transportadora?: string;
  fornecedor?: string;
  remote_conf_id: string | null;
  status: EntradaNotasConfStatus;
  started_by: string;
  started_mat: string;
  started_nome: string;
  started_at: string;
  finalized_at: string | null;
  updated_at: string;
  is_read_only: boolean;
  items: EntradaNotasLocalItem[];
  avulsa_targets?: EntradaNotasAvulsaTargetSummary[];
  avulsa_queue?: EntradaNotasAvulsaQueueEvent[];
  combined_seq_nf_labels?: string[];
  combined_seq_transportadora?: string | null;
  combined_seq_conf_ids?: Array<{
    seq_entrada: number;
    nf: number;
    conf_id: string;
  }>;
  combined_seq_allocations?: Array<{
    coddv: number;
    descricao: string;
    barras: string | null;
    seq_entrada: number;
    nf: number;
    qtd_esperada: number;
    qtd_conferida: number;
  }>;
  contributors?: EntradaNotasContributor[];
  pending_snapshot: boolean;
  pending_finalize: boolean;
  pending_cancel: boolean;
  sync_error: string | null;
  last_synced_at: string | null;

  // Compatibilidade com a UI derivada do modulo volume.
  nr_volume: string;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  falta_motivo: string | null;
  pending_finalize_reason: string | null;
}

export interface EntradaNotasPreferences {
  prefer_offline_mode: boolean;
  multiplo_padrao: number;
  cd_ativo: number | null;
}

export interface EntradaNotasPendingSummary {
  pending_count: number;
  errors_count: number;
}
