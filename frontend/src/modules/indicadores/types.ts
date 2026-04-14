export interface IndicadoresModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface IndicadoresBlitzMonthOption {
  month_start: string;
  month_label: string;
}

export interface IndicadoresBlitzSummary {
  month_start: string;
  month_end: string;
  available_day_start: string | null;
  available_day_end: string | null;
  updated_at: string | null;
  conferido_total: number;
  divergencia_oficial: number;
  percentual_oficial: number;
  fora_politica_total: number;
  percentual_fora_politica: number;
  avaria_mes: number;
  erros_hoje: number | null;
  media_conferencia_dia: number;
}

export interface IndicadoresBlitzDailyRow {
  date_ref: string;
  conferido_total: number;
  divergencia_oficial: number;
  percentual_oficial: number;
}

export interface IndicadoresBlitzZoneTotalRow {
  zona: string;
  falta_total: number;
  sobra_total: number;
  fora_politica_total: number;
  erro_total: number;
}

export type IndicadoresBlitzDayStatus = "Falta" | "Sobra" | "Fora da Política";

export interface IndicadoresBlitzDayDetailRow {
  data_conf: string;
  filial: number;
  filial_nome: string;
  pedido: number;
  seq: number;
  coddv: number;
  descricao: string;
  zona: string;
  endereco: string;
  status: IndicadoresBlitzDayStatus;
  quantidade: number;
  vl_div: number;
}

export type IndicadoresPvpsAlocTipo = "ambos" | "pvps" | "alocacao";
export type IndicadoresPvpsAlocStatus = "conforme" | "nao_conforme" | "vazio" | "obstruido";

export interface IndicadoresPvpsAlocMonthOption {
  month_start: string;
  month_label: string;
}

export interface IndicadoresPvpsAlocSummary {
  month_start: string;
  month_end: string;
  available_day_start: string | null;
  available_day_end: string | null;
  updated_at: string | null;
  enderecos_auditados: number;
  nao_conformes: number;
  ocorrencias_total: number;
  ocorrencias_vazio: number;
  ocorrencias_obstruido: number;
  erros_total: number;
  erros_percentual_total: number;
  percentual_erro: number;
  conformes_elegiveis: number;
  percentual_conformidade: number;
}

export interface IndicadoresPvpsAlocDailyRow {
  date_ref: string;
  enderecos_auditados: number;
  nao_conformes: number;
  ocorrencias_total: number;
  erros_total: number;
  erros_percentual_total: number;
  percentual_erro: number;
  conformes_elegiveis: number;
  percentual_conformidade: number;
}

export interface IndicadoresPvpsAlocZoneTotalRow {
  zona: string;
  nao_conforme_total: number;
  vazio_total: number;
  obstruido_total: number;
  erro_total: number;
}

export interface IndicadoresPvpsAlocDayDetailRow {
  date_ref: string;
  modulo: Exclude<IndicadoresPvpsAlocTipo, "ambos">;
  zona: string;
  endereco: string;
  descricao: string;
  coddv: number;
  status_dashboard: Exclude<IndicadoresPvpsAlocStatus, "conforme">;
  quantidade: number;
}
