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
