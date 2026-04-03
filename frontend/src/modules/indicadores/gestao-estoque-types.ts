export type IndicadoresGestaoEstoqueMovementFilter = "todas" | "entrada" | "saida";

export interface IndicadoresGestaoEstoqueSummary {
  month_start: string;
  month_end: string;
  available_day_start: string | null;
  available_day_end: string | null;
  updated_at: string | null;
  total_entradas_mes: number;
  total_saidas_mes: number;
  total_sobras_mes: number;
  total_faltas_mes: number;
  perda_mes_atual: number;
  perda_acumulada_ano: number;
  acumulado_entradas_ano: number;
  acumulado_saidas_ano: number;
  produtos_distintos_mes: number;
}

export interface IndicadoresGestaoEstoqueMonthOption {
  month_start: string;
  month_label: string;
}

export interface IndicadoresGestaoEstoqueDailyRow {
  date_ref: string;
  entrada_total: number;
  saida_total: number;
  perda_total: number;
}

export interface IndicadoresGestaoEstoqueTopItem {
  coddv: number;
  descricao: string;
  movement_group: "entrada" | "saida";
  total_valor: number;
  movimentacoes: number;
  dias_distintos: number;
  first_date: string | null;
  last_date: string | null;
}

export interface IndicadoresGestaoEstoqueDetailRow {
  data_mov: string;
  coddv: number;
  descricao: string;
  tipo_movimentacao: string;
  movement_group: "entrada" | "saida" | "outros";
  natureza: "sobra" | "falta" | "neutro";
  valor_total: number;
  valor_assinado: number;
  ocorrencias: number;
}

export interface IndicadoresGestaoEstoqueReentryItem {
  coddv: number;
  descricao: string;
  first_saida_date: string | null;
  first_entrada_after_saida_date: string | null;
  total_saida_ano: number;
  total_entrada_ano: number;
  saldo_ano: number;
}
