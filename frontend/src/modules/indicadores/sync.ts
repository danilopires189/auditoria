import { supabase } from "../../lib/supabase";
import type {
  IndicadoresBlitzDailyRow,
  IndicadoresBlitzDayDetailRow,
  IndicadoresBlitzMonthOption,
  IndicadoresBlitzSummary,
  IndicadoresBlitzZoneTotalRow,
  IndicadoresPvpsAlocDailyRow,
  IndicadoresPvpsAlocDayDetailRow,
  IndicadoresPvpsAlocMonthOption,
  IndicadoresPvpsAlocSummary,
  IndicadoresPvpsAlocTipo,
  IndicadoresPvpsAlocZoneTotalRow
} from "./types";

function toErrorMessage(error: unknown): string {
  const mapCode = (raw: string): string => {
    const normalized = raw.trim().toUpperCase();
    if (normalized.includes("AUTH_REQUIRED")) return "Sessão inválida. Faça login novamente.";
    if (normalized.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Faça login novamente.";
    if (normalized.includes("CD_NAO_DEFINIDO_USUARIO")) return "CD não definido para este usuário.";
    if (normalized.includes("CD_SEM_ACESSO")) return "Sem acesso ao CD selecionado.";
    if (normalized.includes("PROFILE_NAO_ENCONTRADO")) return "Perfil do usuário não encontrado.";
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

function parseNullableInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
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

function mapMonthOption(raw: Record<string, unknown>): IndicadoresBlitzMonthOption {
  return {
    month_start: parseString(raw.month_start),
    month_label: parseString(raw.month_label)
  };
}

function mapSummary(raw: Record<string, unknown>): IndicadoresBlitzSummary {
  return {
    month_start: parseString(raw.month_start),
    month_end: parseString(raw.month_end),
    available_day_start: parseNullableString(raw.available_day_start),
    available_day_end: parseNullableString(raw.available_day_end),
    updated_at: parseNullableString(raw.updated_at),
    conferido_total: parseInteger(raw.conferido_total),
    divergencia_oficial: parseInteger(raw.divergencia_oficial),
    percentual_oficial: parseNumber(raw.percentual_oficial),
    fora_politica_total: parseInteger(raw.fora_politica_total),
    percentual_fora_politica: parseNumber(raw.percentual_fora_politica),
    avaria_mes: parseInteger(raw.avaria_mes),
    erros_hoje: parseNullableInteger(raw.erros_hoje),
    media_conferencia_dia: parseNumber(raw.media_conferencia_dia)
  };
}

function mapDailyRow(raw: Record<string, unknown>): IndicadoresBlitzDailyRow {
  return {
    date_ref: parseString(raw.date_ref),
    conferido_total: parseInteger(raw.conferido_total),
    divergencia_oficial: parseInteger(raw.divergencia_oficial),
    percentual_oficial: parseNumber(raw.percentual_oficial)
  };
}

function mapZoneRow(raw: Record<string, unknown>): IndicadoresBlitzZoneTotalRow {
  return {
    zona: parseString(raw.zona, "Sem zona"),
    falta_total: parseInteger(raw.falta_total),
    sobra_total: parseInteger(raw.sobra_total),
    fora_politica_total: parseInteger(raw.fora_politica_total),
    erro_total: parseInteger(raw.erro_total)
  };
}

function mapDayDetailRow(raw: Record<string, unknown>): IndicadoresBlitzDayDetailRow {
  const zona = parseString(raw.zona, "Sem zona");
  const endereco = parseNullableString(raw.endereco) ?? zona;

  return {
    data_conf: parseString(raw.data_conf),
    filial: parseInteger(raw.filial),
    filial_nome: parseString(raw.filial_nome),
    pedido: parseInteger(raw.pedido),
    seq: parseInteger(raw.seq),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao, "Item sem descrição"),
    zona,
    endereco,
    status: parseString(raw.status, "Falta") as IndicadoresBlitzDayDetailRow["status"],
    quantidade: parseInteger(raw.quantidade),
    vl_div: parseNumber(raw.vl_div)
  };
}

function mapPvpsAlocMonthOption(raw: Record<string, unknown>): IndicadoresPvpsAlocMonthOption {
  return {
    month_start: parseString(raw.month_start),
    month_label: parseString(raw.month_label)
  };
}

function mapPvpsAlocSummary(raw: Record<string, unknown>): IndicadoresPvpsAlocSummary {
  return {
    month_start: parseString(raw.month_start),
    month_end: parseString(raw.month_end),
    available_day_start: parseNullableString(raw.available_day_start),
    available_day_end: parseNullableString(raw.available_day_end),
    updated_at: parseNullableString(raw.updated_at),
    enderecos_auditados: parseInteger(raw.enderecos_auditados),
    nao_conformes: parseInteger(raw.nao_conformes),
    ocorrencias_total: parseInteger(raw.ocorrencias_total),
    ocorrencias_vazio: parseInteger(raw.ocorrencias_vazio),
    ocorrencias_obstruido: parseInteger(raw.ocorrencias_obstruido),
    erros_total: parseInteger(raw.erros_total),
    erros_percentual_total: parseInteger(raw.erros_percentual_total),
    percentual_erro: parseNumber(raw.percentual_erro),
    conformes_elegiveis: parseInteger(raw.conformes_elegiveis),
    percentual_conformidade: parseNumber(raw.percentual_conformidade)
  };
}

function mapPvpsAlocDailyRow(raw: Record<string, unknown>): IndicadoresPvpsAlocDailyRow {
  return {
    date_ref: parseString(raw.date_ref),
    enderecos_auditados: parseInteger(raw.enderecos_auditados),
    nao_conformes: parseInteger(raw.nao_conformes),
    ocorrencias_total: parseInteger(raw.ocorrencias_total),
    erros_total: parseInteger(raw.erros_total),
    erros_percentual_total: parseInteger(raw.erros_percentual_total),
    percentual_erro: parseNumber(raw.percentual_erro),
    conformes_elegiveis: parseInteger(raw.conformes_elegiveis),
    percentual_conformidade: parseNumber(raw.percentual_conformidade)
  };
}

function mapPvpsAlocZoneRow(raw: Record<string, unknown>): IndicadoresPvpsAlocZoneTotalRow {
  return {
    zona: parseString(raw.zona, "Sem zona"),
    nao_conforme_total: parseInteger(raw.nao_conforme_total),
    vazio_total: parseInteger(raw.vazio_total),
    obstruido_total: parseInteger(raw.obstruido_total),
    erro_total: parseInteger(raw.erro_total)
  };
}

function mapPvpsAlocDayDetailRow(raw: Record<string, unknown>): IndicadoresPvpsAlocDayDetailRow {
  return {
    date_ref: parseString(raw.date_ref),
    modulo: parseString(raw.modulo, "pvps") as IndicadoresPvpsAlocDayDetailRow["modulo"],
    zona: parseString(raw.zona, "Sem zona"),
    endereco: parseString(raw.endereco, "Sem endereço"),
    descricao: parseString(raw.descricao, "Item sem descrição"),
    coddv: parseInteger(raw.coddv),
    status_dashboard: parseString(raw.status_dashboard, "nao_conforme") as IndicadoresPvpsAlocDayDetailRow["status_dashboard"],
    quantidade: parseInteger(raw.quantidade, 1)
  };
}

export async function fetchIndicadoresBlitzMonthOptions(cd: number | null): Promise<IndicadoresBlitzMonthOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_blitz_month_options", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapMonthOption(row as Record<string, unknown>));
}

export async function fetchIndicadoresBlitzSummary(cd: number | null, monthStart: string): Promise<IndicadoresBlitzSummary> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_blitz_summary", {
    p_cd: cd,
    p_month_start: monthStart
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao carregar o resumo do Blitz.");
  return mapSummary(row);
}

export async function fetchIndicadoresBlitzDailySeries(cd: number | null, monthStart: string): Promise<IndicadoresBlitzDailyRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_blitz_daily_series", {
    p_cd: cd,
    p_month_start: monthStart
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapDailyRow(row as Record<string, unknown>));
}

export async function fetchIndicadoresBlitzZoneTotals(cd: number | null, monthStart: string): Promise<IndicadoresBlitzZoneTotalRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_blitz_zone_totals", {
    p_cd: cd,
    p_month_start: monthStart
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapZoneRow(row as Record<string, unknown>));
}

export async function fetchIndicadoresBlitzDayDetails(
  cd: number | null,
  monthStart: string,
  day: string | null
): Promise<IndicadoresBlitzDayDetailRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_blitz_day_details", {
    p_cd: cd,
    p_month_start: monthStart,
    p_day: day
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapDayDetailRow(row as Record<string, unknown>));
}

export async function fetchIndicadoresPvpsAlocMonthOptions(
  cd: number | null,
  tipo: IndicadoresPvpsAlocTipo
): Promise<IndicadoresPvpsAlocMonthOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_pvps_aloc_month_options", {
    p_cd: cd,
    p_tipo: tipo
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapPvpsAlocMonthOption(row as Record<string, unknown>));
}

export async function fetchIndicadoresPvpsAlocSummary(
  cd: number | null,
  monthStart: string,
  tipo: IndicadoresPvpsAlocTipo
): Promise<IndicadoresPvpsAlocSummary> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_pvps_aloc_summary", {
    p_cd: cd,
    p_month_start: monthStart,
    p_tipo: tipo
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao carregar o resumo do dashboard PVPS e Alocação.");
  return mapPvpsAlocSummary(row);
}

export async function fetchIndicadoresPvpsAlocDailySeries(
  cd: number | null,
  monthStart: string,
  tipo: IndicadoresPvpsAlocTipo
): Promise<IndicadoresPvpsAlocDailyRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_pvps_aloc_daily_series", {
    p_cd: cd,
    p_month_start: monthStart,
    p_tipo: tipo
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapPvpsAlocDailyRow(row as Record<string, unknown>));
}

export async function fetchIndicadoresPvpsAlocZoneTotals(
  cd: number | null,
  monthStart: string,
  tipo: IndicadoresPvpsAlocTipo
): Promise<IndicadoresPvpsAlocZoneTotalRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_pvps_aloc_zone_totals", {
    p_cd: cd,
    p_month_start: monthStart,
    p_tipo: tipo
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapPvpsAlocZoneRow(row as Record<string, unknown>));
}

export async function fetchIndicadoresPvpsAlocDayDetails(
  cd: number | null,
  monthStart: string,
  tipo: IndicadoresPvpsAlocTipo,
  day: string | null
): Promise<IndicadoresPvpsAlocDayDetailRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_indicadores_pvps_aloc_day_details", {
    p_cd: cd,
    p_month_start: monthStart,
    p_tipo: tipo,
    p_day: day
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapPvpsAlocDayDetailRow(row as Record<string, unknown>));
}
