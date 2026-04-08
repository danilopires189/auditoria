import { supabase } from "../../lib/supabase";
import type {
  IndicadoresGestaoEstoqueDailyRow,
  IndicadoresGestaoEstoqueDetailRow,
  IndicadoresGestaoEstoqueInventarioApplySummary,
  IndicadoresGestaoEstoqueInventarioPreviewSummary,
  IndicadoresGestaoEstoqueInventarioStockType,
  IndicadoresGestaoEstoqueLossDimensionItem,
  IndicadoresGestaoEstoqueMonthOption,
  IndicadoresGestaoEstoqueReportBaseRow,
  IndicadoresGestaoEstoqueReportLossDimensionItem,
  IndicadoresGestaoEstoqueReportReentryItem,
  IndicadoresGestaoEstoqueReportSummary,
  IndicadoresGestaoEstoqueMovementFilter,
  IndicadoresGestaoEstoqueReentryItem,
  IndicadoresGestaoEstoqueSummary,
  IndicadoresGestaoEstoqueTopItem
} from "./gestao-estoque-types";

function toErrorMessage(error: unknown): string {
  const mapCode = (raw: string): string => {
    const normalized = raw.trim().toUpperCase();
    if (normalized.includes("STATEMENT TIMEOUT") || normalized.includes("CANCELING STATEMENT DUE TO STATEMENT TIMEOUT")) {
      return "A consulta demorou mais que o permitido. Tente um mês mais recente ou abra o detalhamento só quando precisar.";
    }
    if (normalized.includes("AUTH_REQUIRED")) return "Sessão inválida. Faça login novamente.";
    if (normalized.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Faça login novamente.";
    if (normalized.includes("CD_NAO_DEFINIDO_USUARIO")) return "CD não definido para este usuário.";
    if (normalized.includes("CD_SEM_ACESSO")) return "Sem acesso ao CD selecionado.";
    if (normalized.includes("PROFILE_NAO_ENCONTRADO")) return "Perfil do usuário não encontrado.";
    if (normalized.includes("PERIODO_OBRIGATORIO")) return "Informe a data inicial e a data final.";
    if (normalized.includes("INTERVALO_INVALIDO")) return "A data inicial não pode ser maior que a data final.";
    if (normalized.includes("TIPO_ESTOQUE_OBRIGATORIO")) return "Selecione o tipo de estoque: Disponível ou Atual.";
    if (normalized.includes("APENAS_ADMIN")) return "Apenas admin pode enviar itens para o inventário.";
    return raw;
  };

  if (error instanceof Error) return mapCode(error.message);
  if (typeof error === "string") return mapCode(error);
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.message === "string") return mapCode(candidate.message);
    if (typeof candidate.error_description === "string") return mapCode(candidate.error_description);
    if (typeof candidate.details === "string") return mapCode(candidate.details);
  }
  return "Erro inesperado.";
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumber(value: unknown, fallback = 0): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data)) return null;
  const row = data[0];
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

function mapMonthOption(raw: Record<string, unknown>): IndicadoresGestaoEstoqueMonthOption {
  return {
    month_start: parseString(raw.month_start),
    month_label: parseString(raw.month_label)
  };
}

function mapSummary(raw: Record<string, unknown>): IndicadoresGestaoEstoqueSummary {
  return {
    month_start: parseString(raw.month_start),
    month_end: parseString(raw.month_end),
    available_day_start: parseNullableString(raw.available_day_start),
    available_day_end: parseNullableString(raw.available_day_end),
    updated_at: parseNullableString(raw.updated_at),
    total_entradas_mes: parseNumber(raw.total_entradas_mes),
    total_saidas_mes: parseNumber(raw.total_saidas_mes),
    total_sobras_mes: parseNumber(raw.total_sobras_mes),
    total_faltas_mes: parseNumber(raw.total_faltas_mes),
    perda_mes_atual: parseNumber(raw.perda_mes_atual),
    perda_acumulada_ano: parseNumber(raw.perda_acumulada_ano),
    acumulado_entradas_ano: parseNumber(raw.acumulado_entradas_ano),
    acumulado_saidas_ano: parseNumber(raw.acumulado_saidas_ano),
    produtos_distintos_mes: parseInteger(raw.produtos_distintos_mes)
  };
}

function mapDailyRow(raw: Record<string, unknown>): IndicadoresGestaoEstoqueDailyRow {
  return {
    date_ref: parseString(raw.date_ref),
    entrada_total: parseNumber(raw.entrada_total),
    saida_total: parseNumber(raw.saida_total),
    perda_total: parseNumber(raw.perda_total)
  };
}

function mapTopItem(raw: Record<string, unknown>): IndicadoresGestaoEstoqueTopItem {
  return {
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao, "Item sem descrição"),
    movement_group: parseString(raw.movement_group, "entrada") as IndicadoresGestaoEstoqueTopItem["movement_group"],
    total_valor: parseNumber(raw.total_valor),
    movimentacoes: parseInteger(raw.movimentacoes),
    dias_distintos: parseInteger(raw.dias_distintos),
    first_date: parseNullableString(raw.first_date),
    last_date: parseNullableString(raw.last_date)
  };
}

function mapDetailRow(raw: Record<string, unknown>): IndicadoresGestaoEstoqueDetailRow {
  return {
    data_mov: parseString(raw.data_mov),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao, "Item sem descrição"),
    tipo_movimentacao: parseString(raw.tipo_movimentacao, "-"),
    movement_group: parseString(raw.movement_group, "outros") as IndicadoresGestaoEstoqueDetailRow["movement_group"],
    natureza: parseString(raw.natureza, "neutro") as IndicadoresGestaoEstoqueDetailRow["natureza"],
    valor_total: parseNumber(raw.valor_total),
    responsavel: parseString(raw.responsavel, "-"),
    cargo: parseString(raw.cargo, "-"),
    quantidade: parseInteger(raw.quantidade, parseInteger(raw.ocorrencias)),
    ocorrencias: parseInteger(raw.ocorrencias)
  };
}

function mapReentryItem(raw: Record<string, unknown>): IndicadoresGestaoEstoqueReentryItem {
  return {
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao, "Item sem descrição"),
    first_saida_date: parseNullableString(raw.first_saida_date),
    first_entrada_after_saida_date: parseNullableString(raw.first_entrada_after_saida_date),
    total_saida_ano: parseNumber(raw.total_saida_ano),
    total_entrada_ano: parseNumber(raw.total_entrada_ano),
    saldo_ano: parseNumber(raw.saldo_ano)
  };
}

function mapLossDimensionItem(raw: Record<string, unknown>): IndicadoresGestaoEstoqueLossDimensionItem {
  return {
    dimension_key: parseString(raw.dimension_key, "Sem informação"),
    perda_mes: parseNumber(raw.perda_mes),
    perda_acumulada_ano: parseNumber(raw.perda_acumulada_ano),
    total_faltas_mes: parseNumber(raw.total_faltas_mes),
    total_sobras_mes: parseNumber(raw.total_sobras_mes),
    total_faltas_ano: parseNumber(raw.total_faltas_ano),
    total_sobras_ano: parseNumber(raw.total_sobras_ano),
    produtos_distintos_mes: parseInteger(raw.produtos_distintos_mes),
    produtos_distintos_ano: parseInteger(raw.produtos_distintos_ano)
  };
}

function mapReportSummary(raw: Record<string, unknown>): IndicadoresGestaoEstoqueReportSummary {
  return {
    dt_ini: parseString(raw.dt_ini),
    dt_fim: parseString(raw.dt_fim),
    available_day_start: parseNullableString(raw.available_day_start),
    available_day_end: parseNullableString(raw.available_day_end),
    updated_at: parseNullableString(raw.updated_at),
    total_entradas_periodo: parseNumber(raw.total_entradas_periodo),
    total_saidas_periodo: parseNumber(raw.total_saidas_periodo),
    total_sobras_periodo: parseNumber(raw.total_sobras_periodo),
    total_faltas_periodo: parseNumber(raw.total_faltas_periodo),
    perda_liquida_periodo: parseNumber(raw.perda_liquida_periodo),
    produtos_distintos_periodo: parseInteger(raw.produtos_distintos_periodo)
  };
}

function mapReportReentryItem(raw: Record<string, unknown>): IndicadoresGestaoEstoqueReportReentryItem {
  return {
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao, "Item sem descrição"),
    first_saida_date: parseNullableString(raw.first_saida_date),
    first_entrada_after_saida_date: parseNullableString(raw.first_entrada_after_saida_date),
    total_saida_periodo: parseNumber(raw.total_saida_periodo),
    total_entrada_periodo: parseNumber(raw.total_entrada_periodo),
    saldo_periodo: parseNumber(raw.saldo_periodo)
  };
}

function mapReportLossDimensionItem(raw: Record<string, unknown>): IndicadoresGestaoEstoqueReportLossDimensionItem {
  return {
    dimension_key: parseString(raw.dimension_key, "Sem informação"),
    perda_periodo: parseNumber(raw.perda_periodo),
    total_faltas_periodo: parseNumber(raw.total_faltas_periodo),
    total_sobras_periodo: parseNumber(raw.total_sobras_periodo),
    produtos_distintos_periodo: parseInteger(raw.produtos_distintos_periodo)
  };
}

function mapReportBaseRow(raw: Record<string, unknown>): IndicadoresGestaoEstoqueReportBaseRow {
  return {
    cd: parseInteger(raw.cd),
    data_mov: parseString(raw.data_mov),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao, "Item sem descrição"),
    tipo_movimentacao: parseString(raw.tipo_movimentacao, "-"),
    categoria_n1: parseNullableString(raw.categoria_n1),
    categoria_n2: parseNullableString(raw.categoria_n2),
    fornecedor: parseNullableString(raw.fornecedor),
    usuario: parseNullableString(raw.usuario),
    qtd_mov: raw.qtd_mov == null ? null : parseInteger(raw.qtd_mov),
    valor_mov: parseNumber(raw.valor_mov),
    updated_at: parseNullableString(raw.updated_at)
  };
}

function mapInventarioPreviewSummary(raw: Record<string, unknown> | null | undefined): IndicadoresGestaoEstoqueInventarioPreviewSummary {
  return {
    produtos_qtd: Math.max(parseInteger(raw?.produtos_qtd), 0),
    enderecos_qtd: Math.max(parseInteger(raw?.enderecos_qtd), 0),
    itens_qtd: Math.max(parseInteger(raw?.itens_qtd), 0),
    zonas_qtd: Math.max(parseInteger(raw?.zonas_qtd), 0)
  };
}

function mapInventarioApplySummary(raw: Record<string, unknown> | null | undefined): IndicadoresGestaoEstoqueInventarioApplySummary {
  return {
    ...mapInventarioPreviewSummary(raw),
    itens_afetados: Math.max(parseInteger(raw?.itens_afetados), 0),
    zonas_afetadas: Math.max(parseInteger(raw?.zonas_afetadas), 0),
    total_geral: Math.max(parseInteger(raw?.total_geral), 0),
    usuario_id: parseNullableString(raw?.usuario_id),
    usuario_mat: parseNullableString(raw?.usuario_mat),
    usuario_nome: parseNullableString(raw?.usuario_nome),
    atualizado_em: parseNullableString(raw?.atualizado_em)
  };
}

export async function fetchIndicadoresGestaoEstoqueMonthOptions(cd: number | null): Promise<IndicadoresGestaoEstoqueMonthOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_month_options", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapMonthOption(row as Record<string, unknown>));
}

export async function fetchIndicadoresGestaoEstoqueSummary(
  cd: number | null,
  monthStart: string,
  movementFilter: IndicadoresGestaoEstoqueMovementFilter
): Promise<IndicadoresGestaoEstoqueSummary> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_summary", {
    p_cd: cd,
    p_month_start: monthStart,
    p_movement_filter: movementFilter
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao carregar o resumo da gestão de estoque.");
  return mapSummary(row);
}

export async function fetchIndicadoresGestaoEstoqueDailySeries(
  cd: number | null,
  monthStart: string,
  movementFilter: IndicadoresGestaoEstoqueMovementFilter
): Promise<IndicadoresGestaoEstoqueDailyRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_daily_series", {
    p_cd: cd,
    p_month_start: monthStart,
    p_movement_filter: movementFilter
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapDailyRow(row as Record<string, unknown>));
}

export async function fetchIndicadoresGestaoEstoqueTopItems(params: {
  cd: number | null;
  monthStart: string;
  day: string | null;
  rankGroup: "entrada" | "saida";
  movementFilter: IndicadoresGestaoEstoqueMovementFilter;
}): Promise<IndicadoresGestaoEstoqueTopItem[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_top_items", {
    p_cd: params.cd,
    p_month_start: params.monthStart,
    p_day: params.day,
    p_rank_group: params.rankGroup,
    p_movement_filter: params.movementFilter
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapTopItem(row as Record<string, unknown>));
}

export async function fetchIndicadoresGestaoEstoqueDetails(
  cd: number | null,
  monthStart: string,
  day: string | null,
  movementFilter: IndicadoresGestaoEstoqueMovementFilter,
  limit = 150
): Promise<IndicadoresGestaoEstoqueDetailRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_details", {
    p_cd: cd,
    p_month_start: monthStart,
    p_day: day,
    p_movement_filter: movementFilter,
    p_limit: limit
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapDetailRow(row as Record<string, unknown>));
}

export async function fetchIndicadoresGestaoEstoqueYearReentryItems(
  cd: number | null,
  monthStart: string,
  limit = 30
): Promise<IndicadoresGestaoEstoqueReentryItem[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_year_reentry_items", {
    p_cd: cd,
    p_month_start: monthStart,
    p_limit: limit
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapReentryItem(row as Record<string, unknown>));
}

export async function fetchIndicadoresGestaoEstoqueLossDimension(params: {
  cd: number | null;
  monthStart: string;
  dimension: "fornecedor" | "categoria_n1" | "categoria_n2";
  movementFilter: IndicadoresGestaoEstoqueMovementFilter;
  limit?: number;
}): Promise<IndicadoresGestaoEstoqueLossDimensionItem[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_loss_dimension", {
    p_cd: params.cd,
    p_month_start: params.monthStart,
    p_dimension: params.dimension,
    p_movement_filter: params.movementFilter,
    p_limit: params.limit ?? 15
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapLossDimensionItem(row as Record<string, unknown>));
}

export async function fetchIndicadoresGestaoEstoqueReportSummary(params: {
  cd: number | null;
  dtIni: string;
  dtFim: string;
  movementFilter: IndicadoresGestaoEstoqueMovementFilter;
}): Promise<IndicadoresGestaoEstoqueReportSummary> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_report_summary", {
    p_cd: params.cd,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_movement_filter: params.movementFilter
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao carregar o resumo do relatório da gestão de estoque.");
  return mapReportSummary(row);
}

export async function fetchIndicadoresGestaoEstoqueReportDailySeries(params: {
  cd: number | null;
  dtIni: string;
  dtFim: string;
  movementFilter: IndicadoresGestaoEstoqueMovementFilter;
}): Promise<IndicadoresGestaoEstoqueDailyRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_report_daily_series", {
    p_cd: params.cd,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_movement_filter: params.movementFilter
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapDailyRow(row as Record<string, unknown>));
}

export async function fetchIndicadoresGestaoEstoqueReportTopItems(params: {
  cd: number | null;
  dtIni: string;
  dtFim: string;
  rankGroup: "entrada" | "saida";
  movementFilter: IndicadoresGestaoEstoqueMovementFilter;
}): Promise<IndicadoresGestaoEstoqueTopItem[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_report_top_items", {
    p_cd: params.cd,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_rank_group: params.rankGroup,
    p_movement_filter: params.movementFilter
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapTopItem(row as Record<string, unknown>));
}

export async function fetchIndicadoresGestaoEstoqueReportReentryItems(params: {
  cd: number | null;
  dtIni: string;
  dtFim: string;
  movementFilter: IndicadoresGestaoEstoqueMovementFilter;
}): Promise<IndicadoresGestaoEstoqueReportReentryItem[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_report_reentry_items", {
    p_cd: params.cd,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_movement_filter: params.movementFilter
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapReportReentryItem(row as Record<string, unknown>));
}

export async function fetchIndicadoresGestaoEstoqueReportLossDimension(params: {
  cd: number | null;
  dtIni: string;
  dtFim: string;
  dimension: "fornecedor" | "categoria_n2";
  movementFilter: IndicadoresGestaoEstoqueMovementFilter;
}): Promise<IndicadoresGestaoEstoqueReportLossDimensionItem[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_report_loss_dimension", {
    p_cd: params.cd,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_dimension: params.dimension,
    p_movement_filter: params.movementFilter
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapReportLossDimensionItem(row as Record<string, unknown>));
}

export async function fetchIndicadoresGestaoEstoqueReportDetails(params: {
  cd: number | null;
  dtIni: string;
  dtFim: string;
  movementFilter: IndicadoresGestaoEstoqueMovementFilter;
}): Promise<IndicadoresGestaoEstoqueDetailRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_report_details", {
    p_cd: params.cd,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_movement_filter: params.movementFilter
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapDetailRow(row as Record<string, unknown>));
}

export async function fetchIndicadoresGestaoEstoqueReportBase(params: {
  cd: number | null;
  dtIni: string;
  dtFim: string;
  movementFilter: IndicadoresGestaoEstoqueMovementFilter;
}): Promise<IndicadoresGestaoEstoqueReportBaseRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_report_base", {
    p_cd: params.cd,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_movement_filter: params.movementFilter
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapReportBaseRow(row as Record<string, unknown>));
}

export async function previewIndicadoresGestaoEstoqueInventarioSeed(params: {
  cd: number | null;
  dtIni: string;
  dtFim: string;
  estoqueTipo: IndicadoresGestaoEstoqueInventarioStockType;
  incluirPul: boolean;
}): Promise<IndicadoresGestaoEstoqueInventarioPreviewSummary> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_inventario_preview", {
    p_cd: params.cd,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_estoque_tipo: params.estoqueTipo,
    p_incluir_pul: params.incluirPul
  });
  if (error) throw new Error(toErrorMessage(error));

  return mapInventarioPreviewSummary(firstRow(data));
}

export async function applyIndicadoresGestaoEstoqueInventarioSeed(params: {
  cd: number | null;
  dtIni: string;
  dtFim: string;
  estoqueTipo: IndicadoresGestaoEstoqueInventarioStockType;
  incluirPul: boolean;
}): Promise<IndicadoresGestaoEstoqueInventarioApplySummary> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_gestao_estq_inventario_apply", {
    p_cd: params.cd,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_estoque_tipo: params.estoqueTipo,
    p_incluir_pul: params.incluirPul
  });
  if (error) throw new Error(toErrorMessage(error));

  return mapInventarioApplySummary(firstRow(data));
}
