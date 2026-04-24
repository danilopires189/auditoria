export type IndicadoresGestaoEstoqueMovementFilter = "todas" | "entrada" | "saida";
export type IndicadoresGestaoEstoqueInventarioStockType = "disponivel" | "atual";

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

export interface IndicadoresGestaoEstoqueZoneValueRow {
  zona: string;
  entrada_total: number;
  saida_total: number;
  valor_total: number;
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
  responsavel: string;
  cargo: string;
  quantidade: number;
  ocorrencias: number;
}

export interface IndicadoresGestaoEstoqueZoneProductRow extends IndicadoresGestaoEstoqueDetailRow {
  zona: string;
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

export interface IndicadoresGestaoEstoqueLossDimensionItem {
  dimension_key: string;
  perda_mes: number;
  perda_acumulada_ano: number;
  total_faltas_mes: number;
  total_sobras_mes: number;
  total_faltas_ano: number;
  total_sobras_ano: number;
  produtos_distintos_mes: number;
  produtos_distintos_ano: number;
}

export interface IndicadoresGestaoEstoqueReportSummary {
  dt_ini: string;
  dt_fim: string;
  available_day_start: string | null;
  available_day_end: string | null;
  updated_at: string | null;
  total_entradas_periodo: number;
  total_saidas_periodo: number;
  total_sobras_periodo: number;
  total_faltas_periodo: number;
  perda_liquida_periodo: number;
  produtos_distintos_periodo: number;
}

export interface IndicadoresGestaoEstoqueReportReentryItem {
  coddv: number;
  descricao: string;
  first_saida_date: string | null;
  first_entrada_after_saida_date: string | null;
  total_saida_periodo: number;
  total_entrada_periodo: number;
  saldo_periodo: number;
}

export interface IndicadoresGestaoEstoqueReportLossDimensionItem {
  dimension_key: string;
  perda_periodo: number;
  total_faltas_periodo: number;
  total_sobras_periodo: number;
  produtos_distintos_periodo: number;
}

export interface IndicadoresGestaoEstoqueReportBaseRow {
  cd: number;
  data_mov: string;
  coddv: number;
  descricao: string;
  tipo_movimentacao: string;
  categoria_n1: string | null;
  categoria_n2: string | null;
  fornecedor: string | null;
  usuario: string | null;
  qtd_mov: number | null;
  valor_mov: number;
  updated_at: string | null;
}

export interface IndicadoresGestaoEstoqueInventarioPreviewSummary {
  produtos_qtd: number;
  enderecos_qtd: number;
  itens_qtd: number;
  zonas_qtd: number;
}

export interface IndicadoresGestaoEstoqueInventarioApplySummary extends IndicadoresGestaoEstoqueInventarioPreviewSummary {
  itens_afetados: number;
  zonas_afetadas: number;
  total_geral: number;
  usuario_id: string | null;
  usuario_mat: string | null;
  usuario_nome: string | null;
  atualizado_em: string | null;
}
