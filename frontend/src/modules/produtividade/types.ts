export type ProdutividadeVisibilityMode = "public_cd" | "owner_only";

export interface ProdutividadeModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface ProdutividadeVisibilityRow {
  cd: number;
  visibility_mode: ProdutividadeVisibilityMode;
  updated_by: string | null;
  updated_at: string | null;
}

export interface ProdutividadeCollaboratorRow {
  user_id: string;
  mat: string;
  nome: string;
  registros_count: number;
  dias_ativos: number;
  atividades_count: number;
  valor_total: number;
}

export interface ProdutividadeActivityTotalRow {
  sort_order: number;
  activity_key: string;
  activity_label: string;
  unit_label: string;
  registros_count: number;
  valor_total: number;
  last_event_date: string | null;
}

export interface ProdutividadeDailyRow {
  date_ref: string;
  activity_key: string;
  activity_label: string;
  unit_label: string;
  registros_count: number;
  valor_total: number;
}

export interface ProdutividadeEntryRow {
  entry_id: string;
  event_at: string | null;
  event_date: string;
  activity_key: string;
  activity_label: string;
  unit_label: string;
  metric_value: number;
  detail: string;
  source_ref: string | null;
}

export interface ProdutividadeRankingRow {
  user_id: string;
  mat: string;
  nome: string;
  posicao: number;
  pvps_pontos: number;
  vol_pontos: number;
  blitz_pontos: number;
  zerados_qtd: number;
  zerados_pontos: number;
  alocacao_qtd: number;
  devolucao_qtd: number;
  conf_termo_qtd: number;
  conf_avulso_qtd: number;
  conf_entrada_qtd: number;
  conf_lojas_qtd: number;
  atividade_extra_pontos: number;
  total_pontos: number;
}
