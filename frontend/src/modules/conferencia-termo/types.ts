export type TermoConfStatus = "em_conferencia" | "finalizado_ok" | "finalizado_falta";

export type TermoDivergenciaTipo = "falta" | "sobra" | "correto";

export interface TermoModuleProfile {
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

export interface TermoManifestMeta {
  cd: number;
  row_count: number;
  etiquetas_count: number;
  source_run_id: string | null;
  manifest_hash: string;
  generated_at: string;
}

export interface TermoManifestItemRow {
  id_etiqueta: string;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  coddv: number;
  descricao: string;
  qtd_esperada: number;
}

export interface TermoManifestStoreSummaryRow {
  rota: string;
  filial: number | null;
  primary_etiqueta: string;
  coddv_total: number;
}

export interface TermoManifestBarrasRow {
  barras: string;
  coddv: number;
  descricao: string;
  updated_at: string | null;
}

export interface TermoRouteOverviewRow {
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

export interface TermoItemRow {
  item_id: string;
  conf_id: string;
  coddv: number;
  barras: string | null;
  descricao: string;
  qtd_esperada: number;
  qtd_conferida: number;
  qtd_falta: number;
  qtd_sobra: number;
  divergencia_tipo: TermoDivergenciaTipo;
  updated_at: string;
}

export interface TermoReportFilters {
  dtIni: string;
  dtFim: string;
  cd: number;
}

export interface TermoReportCount {
  total_conferencias: number;
  total_itens: number;
}

export interface TermoReportRow {
  conf_date: string;
  cd: number;
  id_etiqueta: string;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  status: TermoConfStatus;
  started_mat: string | null;
  started_nome: string | null;
  started_at: string | null;
  finalized_at: string | null;
  updated_at: string | null;
  total_itens: number;
  itens_conferidos: number;
  itens_divergentes: number;
  falta_motivo: string | null;
  coddv: number;
  descricao: string;
  barras: string | null;
  qtd_esperada: number;
  qtd_conferida: number;
  qtd_falta: number;
  qtd_sobra: number;
  divergencia_tipo: TermoDivergenciaTipo;
  item_updated_at: string | null;
}

export interface TermoVolumeRow {
  conf_id: string;
  conf_date: string;
  cd: number;
  id_etiqueta: string;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  status: TermoConfStatus;
  falta_motivo: string | null;
  started_by: string;
  started_mat: string;
  started_nome: string;
  started_at: string;
  finalized_at: string | null;
  updated_at: string;
  is_read_only: boolean;
}

export interface TermoLocalItem {
  coddv: number;
  barras: string | null;
  descricao: string;
  qtd_esperada: number;
  qtd_conferida: number;
  updated_at: string;
}

export interface TermoLocalVolume {
  local_key: string;
  user_id: string;
  conf_date: string;
  cd: number;
  id_etiqueta: string;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  remote_conf_id: string | null;
  status: TermoConfStatus;
  falta_motivo: string | null;
  started_by: string;
  started_mat: string;
  started_nome: string;
  started_at: string;
  finalized_at: string | null;
  updated_at: string;
  is_read_only: boolean;
  items: TermoLocalItem[];
  pending_snapshot: boolean;
  pending_finalize: boolean;
  pending_finalize_reason: string | null;
  pending_cancel: boolean;
  sync_error: string | null;
  last_synced_at: string | null;
}

export interface TermoPreferences {
  prefer_offline_mode: boolean;
  multiplo_padrao: number;
  cd_ativo: number | null;
}

export interface TermoPendingSummary {
  pending_count: number;
  errors_count: number;
}
