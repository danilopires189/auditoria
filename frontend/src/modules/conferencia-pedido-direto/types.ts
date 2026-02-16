export type PedidoDiretoConfStatus = "em_conferencia" | "finalizado_ok" | "finalizado_falta";

export type PedidoDiretoDivergenciaTipo = "falta" | "sobra" | "correto";

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
  updated_at: string;
}

export interface PedidoDiretoVolumeRow {
  conf_id: string;
  conf_date: string;
  cd: number;
  id_vol: string;
  caixa: string | null;
  pedido: number | null;
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
}

export interface PedidoDiretoLocalItem {
  coddv: number;
  barras: string | null;
  descricao: string;
  qtd_esperada: number;
  qtd_conferida: number;
  updated_at: string;
}

export interface PedidoDiretoLocalVolume {
  local_key: string;
  user_id: string;
  conf_date: string;
  cd: number;
  id_vol: string;
  caixa: string | null;
  pedido: number | null;
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

