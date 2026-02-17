import { supabase } from "../../lib/supabase";
import type {
  CdOption,
  InventarioCountRow,
  InventarioEventApplyResponse,
  InventarioEventType,
  InventarioLockAcquireResponse,
  InventarioLockRow,
  InventarioManifestItemRow,
  InventarioManifestMeta,
  InventarioReportRow,
  InventarioResultado,
  InventarioReviewReason,
  InventarioReviewRow,
  InventarioReviewStatus,
  InventarioStage,
  InventarioSyncPullState,
  InventarioZoneOverviewRow
} from "./types";

const MANIFEST_PAGE_SIZE = 1000;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.error_description === "string") return candidate.error_description;
    if (typeof candidate.details === "string") return candidate.details;
  }
  return "Erro inesperado.";
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

function parseString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = parseString(value).toLowerCase().trim();
  return normalized === "true" || normalized === "t" || normalized === "1";
}

function parseResultado(value: unknown): InventarioResultado {
  const normalized = parseString(value, "").toLowerCase();
  if (normalized === "falta" || normalized === "sobra" || normalized === "descartado") return normalized;
  return "correto";
}

function parseStage(value: unknown): InventarioStage {
  return parseInteger(value, 1) === 2 ? 2 : 1;
}

function parseReviewStatus(value: unknown): InventarioReviewStatus {
  return parseString(value, "").toLowerCase() === "resolvido" ? "resolvido" : "pendente";
}

function parseReviewReason(value: unknown): InventarioReviewReason {
  return parseString(value, "").toLowerCase() === "conflito_lock" ? "conflito_lock" : "sem_consenso";
}

function mapManifestMeta(raw: Record<string, unknown>): InventarioManifestMeta {
  return {
    cd: parseInteger(raw.cd),
    row_count: parseInteger(raw.row_count),
    zonas_count: parseInteger(raw.zonas_count),
    source_run_id: parseNullableString(raw.source_run_id),
    manifest_hash: parseString(raw.manifest_hash),
    generated_at: parseString(raw.generated_at, new Date().toISOString())
  };
}

function mapManifestItem(raw: Record<string, unknown>): InventarioManifestItemRow {
  return {
    cd: parseInteger(raw.cd),
    zona: parseString(raw.zona, "SEM ZONA").trim().toUpperCase(),
    endereco: parseString(raw.endereco).trim().toUpperCase(),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao).trim(),
    estoque: Math.max(parseInteger(raw.estoque), 0)
  };
}

function mapCount(raw: Record<string, unknown>): InventarioCountRow {
  return {
    cycle_date: parseString(raw.cycle_date),
    cd: parseInteger(raw.cd),
    zona: parseString(raw.zona, "SEM ZONA").trim().toUpperCase(),
    endereco: parseString(raw.endereco).trim().toUpperCase(),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao).trim(),
    estoque: Math.max(parseInteger(raw.estoque), 0),
    etapa: parseStage(raw.etapa),
    qtd_contada: Math.max(parseInteger(raw.qtd_contada), 0),
    barras: parseNullableString(raw.barras),
    resultado: parseResultado(raw.resultado),
    counted_by: parseString(raw.counted_by),
    counted_mat: parseString(raw.counted_mat),
    counted_nome: parseString(raw.counted_nome),
    updated_at: parseString(raw.updated_at, new Date().toISOString())
  };
}

function mapReview(raw: Record<string, unknown>): InventarioReviewRow {
  const snapshot = raw.snapshot && typeof raw.snapshot === "object" ? (raw.snapshot as Record<string, unknown>) : {};
  const finalResultadoRaw = parseNullableString(raw.final_resultado);
  return {
    cycle_date: parseString(raw.cycle_date),
    cd: parseInteger(raw.cd),
    zona: parseString(raw.zona, "SEM ZONA").trim().toUpperCase(),
    endereco: parseString(raw.endereco).trim().toUpperCase(),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao).trim(),
    estoque: Math.max(parseInteger(raw.estoque), 0),
    reason_code: parseReviewReason(raw.reason_code),
    snapshot,
    status: parseReviewStatus(raw.status),
    final_qtd: raw.final_qtd == null ? null : Math.max(parseInteger(raw.final_qtd), 0),
    final_barras: parseNullableString(raw.final_barras),
    final_resultado: finalResultadoRaw ? parseResultado(finalResultadoRaw) : null,
    resolved_by: parseNullableString(raw.resolved_by),
    resolved_mat: parseNullableString(raw.resolved_mat),
    resolved_nome: parseNullableString(raw.resolved_nome),
    resolved_at: parseNullableString(raw.resolved_at),
    updated_at: parseString(raw.updated_at, new Date().toISOString())
  };
}

function mapLock(raw: Record<string, unknown>): InventarioLockRow {
  return {
    lock_id: parseString(raw.lock_id),
    cycle_date: parseString(raw.cycle_date),
    cd: parseInteger(raw.cd),
    zona: parseString(raw.zona, "SEM ZONA").trim().toUpperCase(),
    etapa: parseStage(raw.etapa),
    locked_by: parseString(raw.locked_by),
    locked_mat: parseString(raw.locked_mat),
    locked_nome: parseString(raw.locked_nome),
    heartbeat_at: parseString(raw.heartbeat_at, new Date().toISOString()),
    expires_at: parseString(raw.expires_at, new Date().toISOString()),
    updated_at: parseString(raw.updated_at, new Date().toISOString())
  };
}

function mapReportRow(raw: Record<string, unknown>): InventarioReportRow {
  const resultadoPrimeira = parseNullableString(raw.resultado_primeira);
  const resultadoSegunda = parseNullableString(raw.resultado_segunda);
  const reviewFinalResultado = parseNullableString(raw.review_final_resultado);
  const divergenciaFinal = parseNullableString(raw.divergencia_final);
  const reviewReason = parseNullableString(raw.review_reason);
  const reviewStatus = parseNullableString(raw.review_status);

  return {
    cycle_date: parseString(raw.cycle_date),
    cd: parseInteger(raw.cd),
    zona: parseString(raw.zona, "SEM ZONA"),
    endereco: parseString(raw.endereco),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao),
    estoque: Math.max(parseInteger(raw.estoque), 0),
    qtd_primeira: raw.qtd_primeira == null ? null : Math.max(parseInteger(raw.qtd_primeira), 0),
    barras_primeira: parseNullableString(raw.barras_primeira),
    resultado_primeira: resultadoPrimeira ? parseResultado(resultadoPrimeira) : null,
    primeira_mat: parseNullableString(raw.primeira_mat),
    primeira_nome: parseNullableString(raw.primeira_nome),
    primeira_at: parseNullableString(raw.primeira_at),
    qtd_segunda: raw.qtd_segunda == null ? null : Math.max(parseInteger(raw.qtd_segunda), 0),
    barras_segunda: parseNullableString(raw.barras_segunda),
    resultado_segunda: resultadoSegunda ? parseResultado(resultadoSegunda) : null,
    segunda_mat: parseNullableString(raw.segunda_mat),
    segunda_nome: parseNullableString(raw.segunda_nome),
    segunda_at: parseNullableString(raw.segunda_at),
    review_reason: reviewReason ? parseReviewReason(reviewReason) : null,
    review_status: reviewStatus ? parseReviewStatus(reviewStatus) : null,
    review_final_qtd: raw.review_final_qtd == null ? null : Math.max(parseInteger(raw.review_final_qtd), 0),
    review_final_barras: parseNullableString(raw.review_final_barras),
    review_final_resultado: reviewFinalResultado ? parseResultado(reviewFinalResultado) : null,
    review_resolved_mat: parseNullableString(raw.review_resolved_mat),
    review_resolved_nome: parseNullableString(raw.review_resolved_nome),
    review_resolved_at: parseNullableString(raw.review_resolved_at),
    contado_final: raw.contado_final == null ? null : Math.max(parseInteger(raw.contado_final), 0),
    barras_final: parseNullableString(raw.barras_final),
    divergencia_final: divergenciaFinal ? parseResultado(divergenciaFinal) : null,
    origem_final: parseString(raw.origem_final),
    status_final: parseString(raw.status_final)
  };
}

export async function fetchCdOptions(): Promise<CdOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_cd_options");
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data
    .map((row) => {
      const raw = row as Record<string, unknown>;
      const cd = parseInteger(raw.cd, -1);
      if (cd < 0) return null;
      return {
        cd,
        cd_nome: parseString(raw.cd_nome, `CD ${cd}`)
      } satisfies CdOption;
    })
    .filter((row): row is CdOption => row != null);
}

export async function fetchManifestMeta(cd: number): Promise<InventarioManifestMeta> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_inventario_manifest_meta", { p_cd: cd });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Manifesto do inventário não encontrado.");
  return mapManifestMeta(first);
}

export async function fetchManifestItemsPage(
  cd: number,
  offset: number,
  limit = MANIFEST_PAGE_SIZE
): Promise<InventarioManifestItemRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_inventario_manifest_items_page", {
    p_cd: cd,
    p_offset: Math.max(offset, 0),
    p_limit: Math.max(1, limit)
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => mapManifestItem(row as Record<string, unknown>))
    .filter((row) => row.zona && row.endereco && row.coddv > 0);
}

export async function fetchManifestBundle(
  cd: number,
  onProgress?: (progress: { rows: number; total: number; percent: number }) => void
): Promise<{ meta: InventarioManifestMeta; items: InventarioManifestItemRow[] }> {
  const meta = await fetchManifestMeta(cd);

  const items: InventarioManifestItemRow[] = [];
  let offset = 0;
  const expectedTotal = Math.max(meta.row_count, 0);

  while (true) {
    const page = await fetchManifestItemsPage(cd, offset, MANIFEST_PAGE_SIZE);
    if (!page.length) break;
    items.push(...page);
    offset += page.length;
    const percent = expectedTotal > 0 ? Math.round(Math.min(1, items.length / expectedTotal) * 100) : 100;
    onProgress?.({ rows: items.length, total: expectedTotal, percent });
    if (expectedTotal > 0 && items.length >= expectedTotal) break;
    if (page.length < MANIFEST_PAGE_SIZE) break;
  }

  if (expectedTotal > 0 && items.length !== expectedTotal) {
    throw new Error(`MANIFESTO_INCOMPLETO: local=${items.length} esperado=${expectedTotal}`);
  }

  onProgress?.({ rows: items.length, total: expectedTotal, percent: 100 });
  return { meta, items };
}

export async function fetchZoneOverview(cd: number, cycleDate: string): Promise<InventarioZoneOverviewRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_inventario_zone_overview", {
    p_cd: cd,
    p_cycle_date: cycleDate
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => {
    const raw = row as Record<string, unknown>;
    return {
      zona: parseString(raw.zona, "SEM ZONA"),
      total_itens: parseInteger(raw.total_itens),
      pendentes_primeira: parseInteger(raw.pendentes_primeira),
      concluidos_primeira: parseInteger(raw.concluidos_primeira),
      pendentes_segunda: parseInteger(raw.pendentes_segunda),
      concluidos_segunda: parseInteger(raw.concluidos_segunda),
      revisao_pendente: parseInteger(raw.revisao_pendente),
      concluidos_finais: parseInteger(raw.concluidos_finais)
    } satisfies InventarioZoneOverviewRow;
  });
}

export async function acquireZoneLock(
  cd: number,
  cycleDate: string,
  zona: string,
  etapa: InventarioStage,
  ttlSeconds = 900
): Promise<InventarioLockAcquireResponse> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_inventario_lock_acquire", {
    p_cd: cd,
    p_cycle_date: cycleDate,
    p_zona: zona,
    p_etapa: etapa,
    p_ttl_seconds: ttlSeconds
  });
  if (error) throw new Error(toErrorMessage(error));

  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao adquirir lock de zona.");

  return {
    lock_id: parseString(first.lock_id),
    cycle_date: parseString(first.cycle_date),
    cd: parseInteger(first.cd),
    zona: parseString(first.zona, "SEM ZONA"),
    etapa: parseStage(first.etapa),
    locked_by: parseString(first.locked_by),
    locked_mat: parseString(first.locked_mat),
    locked_nome: parseString(first.locked_nome),
    heartbeat_at: parseString(first.heartbeat_at),
    expires_at: parseString(first.expires_at)
  };
}

export async function heartbeatZoneLock(
  lockId: string,
  ttlSeconds = 900
): Promise<InventarioLockAcquireResponse> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_inventario_lock_heartbeat", {
    p_lock_id: lockId,
    p_ttl_seconds: ttlSeconds
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao renovar lock.");
  return {
    lock_id: parseString(first.lock_id),
    cycle_date: parseString(first.cycle_date),
    cd: parseInteger(first.cd),
    zona: parseString(first.zona, "SEM ZONA"),
    etapa: parseStage(first.etapa),
    locked_by: parseString(first.locked_by),
    locked_mat: parseString(first.locked_mat),
    locked_nome: parseString(first.locked_nome),
    heartbeat_at: parseString(first.heartbeat_at),
    expires_at: parseString(first.expires_at)
  };
}

export async function releaseZoneLock(lockId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_inventario_lock_release", {
    p_lock_id: lockId
  });
  if (error) throw new Error(toErrorMessage(error));
  return parseBoolean(data);
}

export async function applyInventarioEvent(params: {
  event_type: InventarioEventType;
  payload: Record<string, unknown>;
  client_event_id: string;
}): Promise<InventarioEventApplyResponse> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_inventario_apply_event", {
    p_event_type: params.event_type,
    p_payload: params.payload,
    p_client_event_id: params.client_event_id
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Resposta inválida ao aplicar evento.");

  return {
    accepted: parseBoolean(first.accepted),
    info: parseString(first.info),
    updated_at: parseString(first.updated_at, new Date().toISOString())
  };
}

export async function fetchSyncPull(params: {
  cd: number;
  cycle_date: string;
  since?: string | null;
}): Promise<InventarioSyncPullState> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_inventario_sync_pull", {
    p_cd: params.cd,
    p_cycle_date: params.cycle_date,
    p_since: params.since ?? null
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;

  const rawCounts = Array.isArray(first?.counts) ? first?.counts : [];
  const rawReviews = Array.isArray(first?.reviews) ? first?.reviews : [];
  const rawLocks = Array.isArray(first?.locks) ? first?.locks : [];

  const counts = rawCounts
    .map((row) => mapCount(row as Record<string, unknown>))
    .filter((row) => row.cd > 0 && row.endereco && row.coddv > 0);

  const reviews = rawReviews
    .map((row) => mapReview(row as Record<string, unknown>))
    .filter((row) => row.cd > 0 && row.endereco && row.coddv > 0);

  const locks = rawLocks
    .map((row) => mapLock(row as Record<string, unknown>))
    .filter((row) => row.lock_id);

  return {
    counts,
    reviews,
    locks,
    server_time: parseNullableString(first?.server_time)
  };
}

export async function countReportRows(params: {
  dt_ini: string;
  dt_fim: string;
  cd: number;
}): Promise<number> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_inventario_report_count", {
    p_dt_ini: params.dt_ini,
    p_dt_fim: params.dt_fim,
    p_cd: params.cd
  });
  if (error) throw new Error(toErrorMessage(error));
  return parseInteger(data, 0);
}

export async function fetchReportRows(params: {
  dt_ini: string;
  dt_fim: string;
  cd: number;
  limit?: number;
}): Promise<InventarioReportRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_inventario_report_rows", {
    p_dt_ini: params.dt_ini,
    p_dt_fim: params.dt_fim,
    p_cd: params.cd,
    p_limit: Math.max(1, Math.trunc(params.limit ?? 20000))
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapReportRow(row as Record<string, unknown>));
}
