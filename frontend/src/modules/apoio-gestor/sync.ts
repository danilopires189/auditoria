import { supabase } from "../../lib/supabase";
import type { ApoioGestorActivityRow, ApoioGestorDayFlags } from "./types";

function parseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return parseNumber(value);
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function mapRow(row: Record<string, unknown>): ApoioGestorActivityRow {
  return {
    activity_key: String(row.activity_key ?? ""),
    activity_label: String(row.activity_label ?? ""),
    unit_label: String(row.unit_label ?? ""),
    actual_today: parseNumber(row.actual_today),
    target_today: parseNullableNumber(row.target_today),
    achievement_pct: parseNullableNumber(row.achievement_pct),
    has_meta: parseBoolean(row.has_meta),
    sort_order: parseNumber(row.sort_order),
  };
}

export async function fetchApoioGestorDailySummary(
  cd: number,
  date: string
): Promise<ApoioGestorActivityRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_apoio_gestor_daily_summary", {
    p_cd: cd,
    p_date: date,
  });
  if (error) throw new Error(error.message ?? "Erro ao carregar resumo diário.");
  if (!Array.isArray(data)) return [];
  return (data as Record<string, unknown>[])
    .map(mapRow)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export async function fetchApoioGestorDayFlags(
  cd: number,
  date: string
): Promise<ApoioGestorDayFlags> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_apoio_gestor_day_flags", {
    p_cd: cd,
    p_date: date,
  });
  if (error) throw new Error(error.message ?? "Erro ao carregar contexto diário.");
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return {
    meta_defined_count: parseNumber(row?.meta_defined_count),
    is_holiday: parseBoolean(row?.is_holiday),
    is_sunday: parseBoolean(row?.is_sunday),
  };
}
