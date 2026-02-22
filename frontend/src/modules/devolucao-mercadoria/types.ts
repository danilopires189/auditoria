export type DevolucaoMercadoriaConfStatus = "em_conferencia" | "finalizado_ok" | "finalizado_falta";
export type DevolucaoMercadoriaConferenceKind = "com_nfd" | "sem_nfd";
export type DevolucaoMercadoriaDivergenciaTipo = "falta" | "sobra" | "correto";

export interface DevolucaoMercadoriaModuleProfile {
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

export interface DevolucaoMercadoriaManifestMeta {
  cd: number;
  row_count: number;
  etiquetas_count: number;
  source_run_id: string | null;
  manifest_hash: string;
  generated_at: string;
}

export interface DevolucaoMercadoriaManifestItemRow {
  ref: string;
  nfd: number | null;
  chave: string | null;
  motivo: string | null;
  coddv: number;
  descricao: string;
  tipo: string;
  qtd_esperada: number;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  lotes: string | null;
  validades: string | null;
}

export interface DevolucaoMercadoriaManifestNotaRow {
  ref: string;
  nfd: number | null;
  chave: string | null;
  motivo: string | null;
  itens_total: number;
  qtd_esperada_total: number;
  status: "pendente" | "em_andamento" | "concluido" | null;
  colaborador_nome: string | null;
  colaborador_mat: string | null;
  status_at: string | null;
}

export type DevolucaoMercadoriaManifestVolumeRow = DevolucaoMercadoriaManifestNotaRow;

export interface DevolucaoMercadoriaManifestBarrasRow {
  barras: string;
  coddv: number;
  descricao: string;
  updated_at: string | null;
}

export interface DevolucaoMercadoriaRouteOverviewRow {
  rota: string;
  filial: number | null;
  filial_nome: string;
  total_etiquetas: number;
  conferidas: number;
  pendentes: number;
  status: "pendente" | "em_andamento" | "concluido";
  tem_falta: boolean;
  colaborador_nome: string | null;
  colaborador_mat: string | null;
  status_at: string | null;
}

export interface DevolucaoMercadoriaItemRow {
  item_id: string;
  conf_id: string;
  coddv: number;
  barras: string | null;
  descricao: string;
  tipo: string;
  qtd_esperada: number;
  qtd_conferida: number;
  qtd_manual_total: number;
  qtd_falta: number;
  qtd_sobra: number;
  divergencia_tipo: DevolucaoMercadoriaDivergenciaTipo;
  lotes: string | null;
  validades: string | null;
  updated_at: string;
}

export interface DevolucaoMercadoriaVolumeRow {
  conf_id: string;
  conf_date: string;
  cd: number;
  conference_kind: DevolucaoMercadoriaConferenceKind;
  nfd: number | null;
  chave: string | null;
  ref: string;
  source_motivo: string | null;
  nfo: string | null;
  motivo_sem_nfd: string | null;
  status: DevolucaoMercadoriaConfStatus;
  falta_motivo: string | null;
  started_by: string;
  started_mat: string;
  started_nome: string;
  started_at: string;
  finalized_at: string | null;
  updated_at: string;
  is_read_only: boolean;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
}

export interface DevolucaoMercadoriaLocalItem {
  coddv: number;
  barras: string | null;
  descricao: string;
  tipo: string;
  qtd_esperada: number;
  qtd_conferida: number;
  qtd_manual_total: number;
  lotes: string | null;
  validades: string | null;
  updated_at: string;
}

export interface DevolucaoMercadoriaLocalVolume {
  local_key: string;
  user_id: string;
  conf_date: string;
  cd: number;
  conference_kind: DevolucaoMercadoriaConferenceKind;
  nfd: number | null;
  chave: string | null;
  ref: string;
  source_motivo: string | null;
  nfo: string | null;
  motivo_sem_nfd: string | null;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  remote_conf_id: string | null;
  status: DevolucaoMercadoriaConfStatus;
  falta_motivo: string | null;
  started_by: string;
  started_mat: string;
  started_nome: string;
  started_at: string;
  finalized_at: string | null;
  updated_at: string;
  is_read_only: boolean;
  items: DevolucaoMercadoriaLocalItem[];
  pending_snapshot: boolean;
  pending_finalize: boolean;
  pending_finalize_reason: string | null;
  pending_finalize_without_scan: boolean;
  pending_finalize_nfo: string | null;
  pending_finalize_motivo_sem_nfd: string | null;
  pending_cancel: boolean;
  sync_error: string | null;
  last_synced_at: string | null;
}

export interface DevolucaoMercadoriaPreferences {
  prefer_offline_mode: boolean;
  multiplo_padrao: number;
  cd_ativo: number | null;
}

export interface DevolucaoMercadoriaPendingSummary {
  pending_count: number;
  errors_count: number;
}

export interface DevolucaoMercadoriaPartialReopenInfo {
  conf_id: string;
  ref: string;
  status: DevolucaoMercadoriaConfStatus;
  previous_started_by: string | null;
  previous_started_mat: string | null;
  previous_started_nome: string | null;
  locked_items: number;
  pending_items: number;
  can_reopen: boolean;
}
