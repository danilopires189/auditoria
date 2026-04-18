export type PedidoDiretoConfStatus = "em_conferencia" | "finalizado_ok" | "finalizado_falta";

export type PedidoDiretoDivergenciaTipo = "falta" | "sobra" | "correto";

export type PedidoDiretoLinkOrigin = "prevencaocd" | "logisticacd";

export interface PedidoDiretoModuleProfile {
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

export interface PedidoDiretoManifestMeta {
  cd: number;
  row_count: number;
  volumes_count: number;
  source_run_id: string | null;
  manifest_hash: string;
  generated_at: string;
}

export interface PedidoDiretoManifestItemRow {
  id_vol: string;
  caixa: string | null;
  pedido: number | null;
  sq: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  coddv: number;
  descricao: string;
  qtd_esperada: number;
}

export interface PedidoDiretoManifestBarrasRow {
  barras: string;
  coddv: number;
  descricao: string;
  updated_at: string | null;
}

export interface PedidoDiretoRouteOverviewRow {
  rota: string;
  filial: number | null;
  filial_nome: string;
  pedidos_seq: string | null;
  total_etiquetas: number;
  conferidas: number;
  pendentes: number;
  status: "pendente" | "em_andamento" | "concluido";
  tem_falta: boolean;
  colaborador_nome: string | null;
  colaborador_mat: string | null;
  status_at: string | null;
}

export interface PedidoDiretoItemRow {
  item_id: string;
  conf_id: string;
  coddv: number;
  barras: string | null;
  descricao: string;
  qtd_esperada: number;
  qtd_conferida: number;
  qtd_falta: number;
  qtd_sobra: number;
  divergencia_tipo: PedidoDiretoDivergenciaTipo;
  is_locked: boolean;
  locked_mat: string | null;
  locked_nome: string | null;
  updated_at: string;
}

export interface PedidoDiretoReportFilters {
  dtIni: string;
  dtFim: string;
  cd: number;
  origem_link: PedidoDiretoLinkOrigin;
}

export interface PedidoDiretoReportCount {
  total_conferencias: number;
  total_itens: number;
}

export interface PedidoDiretoReportRow {
  conf_date: string;
  cd: number;
  id_vol: string;
  origem_link: PedidoDiretoLinkOrigin;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  status: PedidoDiretoConfStatus;
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
  divergencia_tipo: PedidoDiretoDivergenciaTipo;
  item_updated_at: string | null;
}

export interface PedidoDiretoVolumeRow {
  conf_id: string;
  conf_date: string;
  cd: number;
  id_vol: string;
  origem_link: PedidoDiretoLinkOrigin;
  caixa: string | null;
  pedido: number | null;
  sq: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  status: PedidoDiretoConfStatus;
  falta_motivo: string | null;
  started_by: string;
  started_mat: string;
  started_nome: string;
  started_at: string;
  finalized_at: string | null;
  updated_at: string;
  is_read_only: boolean;
  reopened_from_finalized: boolean;
}

export interface PedidoDiretoLocalItem {
  coddv: number;
  barras: string | null;
  descricao: string;
  qtd_esperada: number;
  qtd_conferida: number;
  is_locked: boolean;
  locked_mat: string | null;
  locked_nome: string | null;
  updated_at: string;
}

export interface PedidoDiretoLocalVolume {
  local_key: string;
  user_id: string;
  conf_date: string;
  cd: number;
  id_vol: string;
  origem_link: PedidoDiretoLinkOrigin;
  caixa: string | null;
  pedido: number | null;
  sq: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  remote_conf_id: string | null;
  status: PedidoDiretoConfStatus;
  falta_motivo: string | null;
  started_by: string;
  started_mat: string;
  started_nome: string;
  started_at: string;
  finalized_at: string | null;
  updated_at: string;
  is_read_only: boolean;
  reopened_from_finalized: boolean;
  items: PedidoDiretoLocalItem[];
  pending_snapshot: boolean;
  pending_finalize: boolean;
  pending_finalize_reason: string | null;
  pending_cancel: boolean;
  sync_error: string | null;
  last_synced_at: string | null;
}

export interface PedidoDiretoPreferences {
  prefer_offline_mode: boolean;
  multiplo_padrao: number;
  cd_ativo: number | null;
}

export interface PedidoDiretoPendingSummary {
  pending_count: number;
  errors_count: number;
}

export interface PedidoDiretoPartialReopenInfo {
  conf_id: string;
  conf_date: string;
  cd: number;
  id_vol: string;
  origem_link: PedidoDiretoLinkOrigin;
  status: PedidoDiretoConfStatus;
  previous_started_by: string | null;
  previous_started_mat: string | null;
  previous_started_nome: string | null;
  locked_items: number;
  falta_items: number;
  sobra_items: number;
  can_reopen: boolean;
}

