import { supabase } from "../../lib/supabase";
import type {
  MetaMesActivityOption,
  MetaMesDailyRow,
  MetaMesMonthOption,
  MetaMesSummary,
  MetaMesValueMode
} from "./types";

function toErrorMessage(error: unknown): string {
  const mapCode = (raw: string): string => {
    const normalized = raw.trim().toUpperCase();
    if (normalized.includes("AUTH_REQUIRED")) return "Sessão inválida. Faça login novamente.";
    if (normalized.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Faça login novamente.";
    if (normalized.includes("CD_NAO_DEFINIDO_USUARIO")) return "CD não definido para este usuário.";
    if (normalized.includes("CD_SEM_ACESSO")) return "Sem acesso ao CD selecionado.";
    if (normalized.includes("PROFILE_NAO_ENCONTRADO")) return "Perfil do usuário não encontrado.";
    if (normalized.includes("APENAS_ADMIN")) return "Apenas admin pode editar metas e feriados.";
    if (normalized.includes("ATIVIDADE_INVALIDA")) return "Atividade inválida.";
    if (normalized.includes("APENAS_MES_ATUAL")) return "A edição de metas é permitida somente no mês atual.";
    if (normalized.includes("DOMINGO_META_ZERO")) return "Domingos permanecem com meta zero e não podem ser editados.";
    if (normalized.includes("META_INVALIDA")) return "Informe uma meta válida.";
    if (normalized.includes("META_DIARIA_INVALIDA")) return "Informe uma meta diária válida.";
    if (normalized.includes("DATA_OBRIGATORIA")) return "Selecione um dia válido.";
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

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
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

function parseBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function parseValueMode(value: unknown): MetaMesValueMode {
  return String(value) === "currency" ? "currency" : String(value) === "decimal" ? "decimal" : "integer";
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data)) return null;
  const row = data[0];
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

function mapActivity(raw: Record<string, unknown>): MetaMesActivityOption {
  return {
    sort_order: parseInteger(raw.sort_order),
    activity_key: parseString(raw.activity_key),
    activity_label: parseString(raw.activity_label),
    unit_label: parseString(raw.unit_label),
    value_mode: parseValueMode(raw.value_mode)
  };
}

function mapMonthOption(raw: Record<string, unknown>): MetaMesMonthOption {
  return {
    month_start: parseString(raw.month_start),
    month_label: parseString(raw.month_label)
  };
}

function mapSummary(raw: Record<string, unknown>): MetaMesSummary {
  return {
    activity_key: parseString(raw.activity_key),
    activity_label: parseString(raw.activity_label),
    unit_label: parseString(raw.unit_label),
    value_mode: parseValueMode(raw.value_mode),
    month_start: parseString(raw.month_start),
    month_end: parseString(raw.month_end),
    updated_at: parseNullableString(raw.updated_at),
    total_actual: parseNumber(raw.total_actual),
    total_target: parseNumber(raw.total_target),
    achievement_percent: parseNullableNumber(raw.achievement_percent),
    daily_average: parseNumber(raw.daily_average),
    monthly_projection: parseNumber(raw.monthly_projection),
    days_with_target: parseInteger(raw.days_with_target),
    days_hit: parseInteger(raw.days_hit),
    days_over: parseInteger(raw.days_over),
    days_holiday: parseInteger(raw.days_holiday),
    days_without_target: parseInteger(raw.days_without_target),
    balance_to_target: parseNumber(raw.balance_to_target),
    daily_target_value: parseNullableNumber(raw.daily_target_value),
    target_reference_month: parseNullableString(raw.target_reference_month),
    month_workdays: parseInteger(raw.month_workdays),
    elapsed_workdays: parseInteger(raw.elapsed_workdays)
  };
}

function mapDailyRow(raw: Record<string, unknown>): MetaMesDailyRow {
  return {
    date_ref: parseString(raw.date_ref),
    day_number: parseInteger(raw.day_number),
    weekday_label: parseString(raw.weekday_label),
    target_kind: parseString(raw.target_kind, "sem_meta") as MetaMesDailyRow["target_kind"],
    target_value: parseNullableNumber(raw.target_value),
    actual_value: parseNumber(raw.actual_value),
    percent_achievement: parseNullableNumber(raw.percent_achievement),
    delta_value: parseNullableNumber(raw.delta_value),
    cumulative_target: parseNumber(raw.cumulative_target),
    cumulative_actual: parseNumber(raw.cumulative_actual),
    cumulative_percent: parseNullableNumber(raw.cumulative_percent),
    status: parseString(raw.status, "sem_meta") as MetaMesDailyRow["status"],
    is_holiday: parseBoolean(raw.is_holiday),
    is_sunday: parseBoolean(raw.is_sunday),
    updated_at: parseNullableString(raw.updated_at)
  };
}

export async function fetchMetaMesActivities(cd: number | null): Promise<MetaMesActivityOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_meta_mes_activities", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapActivity(row as Record<string, unknown>));
}

export async function fetchMetaMesMonthOptions(cd: number | null): Promise<MetaMesMonthOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_meta_mes_month_options", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapMonthOption(row as Record<string, unknown>));
}

export async function fetchMetaMesSummary(cd: number | null, activityKey: string, monthStart: string): Promise<MetaMesSummary> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_meta_mes_summary", {
    p_cd: cd,
    p_activity_key: activityKey,
    p_month_start: monthStart
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao carregar o resumo da meta mensal.");
  return mapSummary(row);
}

export async function fetchMetaMesDailyRows(cd: number | null, activityKey: string, monthStart: string): Promise<MetaMesDailyRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_meta_mes_daily_rows", {
    p_cd: cd,
    p_activity_key: activityKey,
    p_month_start: monthStart
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapDailyRow(row as Record<string, unknown>));
}

export async function setMetaMesDailyTarget(params: {
  cd: number | null;
  activityKey: string;
  dateRef: string;
  targetValue: number | null;
}): Promise<MetaMesDailyRow | null> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_meta_mes_set_daily_target", {
    p_cd: params.cd,
    p_activity_key: params.activityKey,
    p_date_ref: params.dateRef,
    p_target_value: params.targetValue
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  return row ? mapDailyRow(row) : null;
}

export async function setMetaMesMonthTarget(params: {
  cd: number | null;
  activityKey: string;
  monthStart: string;
  dailyTargetValue: number | null;
}): Promise<Record<string, unknown> | null> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_meta_mes_set_month_target", {
    p_cd: params.cd,
    p_activity_key: params.activityKey,
    p_month_start: params.monthStart,
    p_daily_target_value: params.dailyTargetValue
  });
  if (error) throw new Error(toErrorMessage(error));

  return firstRow(data);
}

export async function setMetaMesHoliday(params: {
  cd: number | null;
  activityKey: string;
  dateRef: string;
  isHoliday: boolean;
}): Promise<MetaMesDailyRow | null> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_meta_mes_set_holiday", {
    p_cd: params.cd,
    p_activity_key: params.activityKey,
    p_date_ref: params.dateRef,
    p_is_holiday: params.isHoliday
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  return row ? mapDailyRow(row) : null;
}
