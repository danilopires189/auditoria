export type VolumeAvulsoConfStatus = "em_conferencia" | "finalizado_ok" | "finalizado_falta";

export type VolumeAvulsoDivergenciaTipo = "falta" | "sobra" | "correto";

export interface VolumeAvulsoModuleProfile {
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

export interface VolumeAvulsoManifestMeta {
  cd: number;
  row_count: number;
  etiquetas_count: number;
  source_run_id: string | null;
  manifest_hash: string;
  generated_at: string;
}

export interface VolumeAvulsoManifestItemRow {
  nr_volume: string;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  coddv: number;
  descricao: string;
  qtd_esperada: number;
}

export interface VolumeAvulsoManifestBarrasRow {
  barras: string;
  coddv: number;
  descricao: string;
  updated_at: string | null;
}

export interface VolumeAvulsoRouteOverviewRow {
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

export interface VolumeAvulsoItemRow {
  item_id: string;
  conf_id: string;
  coddv: number;
  barras: string | null;
  descricao: string;
  qtd_esperada: number;
  qtd_conferida: number;
  qtd_falta: number;
  qtd_sobra: number;
  divergencia_tipo: VolumeAvulsoDivergenciaTipo;
  updated_at: string;
}

export interface VolumeAvulsoVolumeRow {
  conf_id: string;
  conf_date: string;
  cd: number;
  nr_volume: string;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  status: VolumeAvulsoConfStatus;
  falta_motivo: string | null;
  started_by: string;
  started_mat: string;
  started_nome: string;
  started_at: string;
  finalized_at: string | null;
  updated_at: string;
  is_read_only: boolean;
}

export interface VolumeAvulsoLocalItem {
  coddv: number;
  barras: string | null;
  descricao: string;
  qtd_esperada: number;
  qtd_conferida: number;
  updated_at: string;
}

export interface VolumeAvulsoLocalVolume {
  local_key: string;
  user_id: string;
  conf_date: string;
  cd: number;
  nr_volume: string;
  caixa: string | null;
  pedido: number | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  remote_conf_id: string | null;
  status: VolumeAvulsoConfStatus;
  falta_motivo: string | null;
  started_by: string;
  started_mat: string;
  started_nome: string;
  started_at: string;
  finalized_at: string | null;
  updated_at: string;
  is_read_only: boolean;
  items: VolumeAvulsoLocalItem[];
  pending_snapshot: boolean;
  pending_finalize: boolean;
  pending_finalize_reason: string | null;
  pending_cancel: boolean;
  sync_error: string | null;
  last_synced_at: string | null;
}

export interface VolumeAvulsoPreferences {
  prefer_offline_mode: boolean;
  multiplo_padrao: number;
  cd_ativo: number | null;
}

export interface VolumeAvulsoPendingSummary {
  pending_count: number;
  errors_count: number;
}
