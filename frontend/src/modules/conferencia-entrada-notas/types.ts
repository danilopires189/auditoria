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
  qtd_falta: number;
  qtd_sobra: number;
  divergencia_tipo: EntradaNotasDivergenciaTipo;
  updated_at: string;
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
}

export interface EntradaNotasLocalItem {
  coddv: number;
  barras: string | null;
  descricao: string;
  qtd_esperada: number;
  qtd_conferida: number;
  updated_at: string;
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
