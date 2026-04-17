import { supabase } from "../../lib/supabase";
import {
  getDbBarrasMeta,
  mergeDbBarrasCache,
  reconcileDbBarrasCache,
  replaceDbBarrasCache,
  touchDbBarrasMeta
} from "./storage";
import type { DbBarrasCacheRow, DbBarrasProgress } from "./types";

const DB_BARRAS_PAGE_SIZE = 400;
const DB_BARRAS_MIN_PAGE_SIZE = 100;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.error_description === "string") return candidate.error_description;
    if (typeof candidate.details === "string") return candidate.details;
  }
  return "Erro inesperado";
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

function toPercent(current: number, total: number): number {
  if (total <= 0) return current > 0 ? 100 : 0;
  const ratio = Math.max(0, Math.min(1, current / total));
  return Math.round(ratio * 100);
}

function isStatementTimeout(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes("statement timeout")
    || message.includes("canceling statement due to statement timeout")
    || message.includes("canceling statement");
}

export function normalizeBarcode(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

export async function fetchDbBarrasMetaRemote(): Promise<{ row_count: number; updated_max: string | null }> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_db_barras_meta");
  if (error) {
    throw new Error(`Falha ao obter metadados de barras: ${toErrorMessage(error)}`);
  }
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return {
    row_count: parseInteger(first?.row_count, 0),
    updated_max: parseNullableString(first?.updated_max)
  };
}

async function fetchDbBarrasPageWithAdaptiveLimit(params: {
  rpcName: "rpc_db_barras_page" | "rpc_db_barras_delta";
  offset: number;
  updatedAfter?: string;
  limit?: number;
}): Promise<{ page: unknown[]; usedLimit: number }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  let limit = Math.max(Math.trunc(params.limit ?? DB_BARRAS_PAGE_SIZE), DB_BARRAS_MIN_PAGE_SIZE);
  while (limit >= DB_BARRAS_MIN_PAGE_SIZE) {
    const payload: Record<string, unknown> = {
      p_offset: params.offset,
      p_limit: limit
    };
    if (params.updatedAfter) {
      payload.p_updated_after = params.updatedAfter;
    }

    const { data, error } = await supabase.rpc(params.rpcName, payload);
    if (!error) {
      return {
        page: Array.isArray(data) ? data : [],
        usedLimit: limit
      };
    }

    if (!isStatementTimeout(error) || limit === DB_BARRAS_MIN_PAGE_SIZE) {
      const action = params.rpcName === "rpc_db_barras_page" ? "carregar" : "atualizar";
      throw new Error(`Falha ao ${action} base de barras: ${toErrorMessage(error)}`);
    }

    limit = Math.max(Math.trunc(limit / 2), DB_BARRAS_MIN_PAGE_SIZE);
  }

  return {
    page: [],
    usedLimit: DB_BARRAS_MIN_PAGE_SIZE
  };
}

export async function fetchDbBarrasDeltaCount(updatedAfter: string): Promise<number> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_db_barras_delta_count", {
    p_updated_after: updatedAfter
  });
  if (error) {
    throw new Error(`Falha ao obter contagem delta de barras: ${toErrorMessage(error)}`);
  }
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return parseInteger(first?.row_count, 0);
}

export async function refreshDbBarrasCache(
  onProgress?: (progress: DbBarrasProgress) => void
): Promise<{ rows: number; pages: number; totalRows: number }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const remoteMeta = await fetchDbBarrasMetaRemote();
  const totalRows = Math.max(remoteMeta.row_count, 0);
  let offset = 0;
  let pages = 0;
  let pageLimit = DB_BARRAS_PAGE_SIZE;
  const allRows: DbBarrasCacheRow[] = [];

  while (true) {
    const result = await fetchDbBarrasPageWithAdaptiveLimit({
      rpcName: "rpc_db_barras_page",
      offset,
      limit: pageLimit
    });
    const page = result.page;
    pageLimit = result.usedLimit;
    if (page.length === 0) break;

    for (const item of page) {
      const raw = item as Record<string, unknown>;
      const barras = normalizeBarcode(String(raw.barras ?? ""));
      const coddv = Number.parseInt(String(raw.coddv ?? ""), 10);
      const descricao = String(raw.descricao ?? "").trim();
      const updatedAt = raw.updated_at == null ? null : String(raw.updated_at);

      if (!barras || !Number.isFinite(coddv)) continue;

      allRows.push({
        barras,
        coddv,
        descricao,
        updated_at: updatedAt
      });
    }

    pages += 1;
    offset += page.length;
    onProgress?.({
      mode: "full",
      pagesFetched: pages,
      rowsFetched: allRows.length,
      totalRows,
      percent: toPercent(allRows.length, totalRows)
    });

    if (page.length < pageLimit) break;
  }

  await replaceDbBarrasCache(allRows);
  onProgress?.({
    mode: "full",
    pagesFetched: pages,
    rowsFetched: allRows.length,
    totalRows,
    percent: 100
  });
  return { rows: allRows.length, pages, totalRows };
}

async function refreshDbBarrasCacheReconcile(
  onProgress?: (progress: DbBarrasProgress) => void,
  remoteMetaInput?: { row_count: number; updated_max: string | null } | null
): Promise<{ rows: number; pages: number; totalRows: number; removed: number }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const remoteMeta = remoteMetaInput ?? await fetchDbBarrasMetaRemote();
  const totalRows = Math.max(remoteMeta.row_count, 0);
  let offset = 0;
  let pages = 0;
  let pageLimit = DB_BARRAS_PAGE_SIZE;
  const allRows: DbBarrasCacheRow[] = [];

  while (true) {
    const result = await fetchDbBarrasPageWithAdaptiveLimit({
      rpcName: "rpc_db_barras_page",
      offset,
      limit: pageLimit
    });
    const page = result.page;
    pageLimit = result.usedLimit;
    if (page.length === 0) break;

    for (const item of page) {
      const raw = item as Record<string, unknown>;
      const barras = normalizeBarcode(String(raw.barras ?? ""));
      const coddv = Number.parseInt(String(raw.coddv ?? ""), 10);
      const descricao = String(raw.descricao ?? "").trim();
      const updatedAt = raw.updated_at == null ? null : String(raw.updated_at);

      if (!barras || !Number.isFinite(coddv)) continue;

      allRows.push({
        barras,
        coddv,
        descricao,
        updated_at: updatedAt
      });
    }

    pages += 1;
    offset += page.length;
    onProgress?.({
      mode: "full",
      pagesFetched: pages,
      rowsFetched: allRows.length,
      totalRows,
      percent: toPercent(allRows.length, totalRows)
    });

    if (page.length < pageLimit) break;
  }

  const reconciled = await reconcileDbBarrasCache(allRows, remoteMeta.updated_max ?? undefined);
  onProgress?.({
    mode: "full",
    pagesFetched: pages,
    rowsFetched: allRows.length,
    totalRows,
    percent: 100
  });
  return { rows: reconciled.row_count, pages, totalRows, removed: reconciled.removed };
}

export async function refreshDbBarrasCacheSmart(
  onProgress?: (progress: DbBarrasProgress) => void,
  options?: {
    allowFullReconcile?: boolean;
  }
): Promise<{ mode: "full" | "delta"; pages: number; applied: number; total: number }> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const allowFullReconcile = options?.allowFullReconcile ?? false;

  const remoteMeta = await fetchDbBarrasMetaRemote();
  const meta = await getDbBarrasMeta();
  if (meta.row_count <= 0 || !meta.last_sync_at) {
    const result = await refreshDbBarrasCacheReconcile(onProgress, remoteMeta);
    return {
      mode: "full",
      pages: result.pages,
      applied: result.rows,
      total: result.rows
    };
  }

  const needsReconcile = remoteMeta.row_count < meta.row_count;
  if (needsReconcile && allowFullReconcile) {
    const reconciled = await refreshDbBarrasCacheReconcile(onProgress, remoteMeta);
    return {
      mode: "full",
      pages: reconciled.pages,
      applied: reconciled.rows,
      total: reconciled.rows
    };
  }

  const remoteUpdatedTs = remoteMeta.updated_max ? Date.parse(remoteMeta.updated_max) : Number.NaN;
  const localSyncTs = meta.last_sync_at ? Date.parse(meta.last_sync_at) : Number.NaN;
  if (
    Number.isFinite(remoteUpdatedTs)
    && Number.isFinite(localSyncTs)
    && remoteUpdatedTs <= localSyncTs
    && remoteMeta.row_count === meta.row_count
  ) {
    await touchDbBarrasMeta(new Date().toISOString());
    onProgress?.({
      mode: "delta",
      pagesFetched: 0,
      rowsFetched: 0,
      totalRows: 0,
      percent: 100
    });
    return {
      mode: "delta",
      pages: 0,
      applied: 0,
      total: meta.row_count
    };
  }

  let deltaTotal: number | null = null;
  let offset = 0;
  let pages = 0;
  let pageLimit = DB_BARRAS_PAGE_SIZE;
  const changedRows: DbBarrasCacheRow[] = [];
  let maxSeenUpdatedAt: string | null = null;

  while (true) {
    let pageResult: { page: unknown[]; usedLimit: number };
    try {
      pageResult = await fetchDbBarrasPageWithAdaptiveLimit({
        rpcName: "rpc_db_barras_delta",
        updatedAfter: meta.last_sync_at,
        offset,
        limit: pageLimit
      });
    } catch (error) {
      if (isStatementTimeout(error) && allowFullReconcile) {
        const reconciled = await refreshDbBarrasCacheReconcile(onProgress, remoteMeta);
        return {
          mode: "full",
          pages: reconciled.pages,
          applied: reconciled.rows,
          total: reconciled.rows
        };
      }
      if (isStatementTimeout(error) && !allowFullReconcile) {
        onProgress?.({
          mode: "delta",
          pagesFetched: pages,
          rowsFetched: changedRows.length,
          totalRows: 0,
          percent: 100
        });
        return {
          mode: "delta",
          pages,
          applied: changedRows.length,
          total: meta.row_count
        };
      }
      throw error;
    }
    const page = pageResult.page;
    pageLimit = pageResult.usedLimit;
    if (page.length === 0) break;

    for (const item of page) {
      const raw = item as Record<string, unknown>;
      const barras = normalizeBarcode(String(raw.barras ?? ""));
      const coddv = Number.parseInt(String(raw.coddv ?? ""), 10);
      const descricao = String(raw.descricao ?? "").trim();
      const updatedAt = raw.updated_at == null ? null : String(raw.updated_at);

      if (!barras || !Number.isFinite(coddv)) continue;
      changedRows.push({
        barras,
        coddv,
        descricao,
        updated_at: updatedAt
      });

      if (updatedAt) {
        const parsed = Date.parse(updatedAt);
        const currentMax = maxSeenUpdatedAt ? Date.parse(maxSeenUpdatedAt) : Number.NEGATIVE_INFINITY;
        if (Number.isFinite(parsed) && parsed > currentMax) {
          maxSeenUpdatedAt = updatedAt;
        }
      }
    }

    pages += 1;
    offset += page.length;
    onProgress?.({
      mode: "delta",
      pagesFetched: pages,
      rowsFetched: changedRows.length,
      totalRows: deltaTotal ?? 0,
      percent: deltaTotal == null ? 0 : toPercent(changedRows.length, deltaTotal)
    });

    if (page.length < pageLimit) break;
  }

  if (changedRows.length > 0) {
    const merged = await mergeDbBarrasCache(changedRows, maxSeenUpdatedAt);
    return {
      mode: "delta",
      pages,
      applied: changedRows.length,
      total: merged.row_count
    };
  }

  await touchDbBarrasMeta(new Date().toISOString());
  onProgress?.({
    mode: "delta",
    pagesFetched: pages,
    rowsFetched: 0,
    totalRows: deltaTotal ?? 0,
    percent: 100
  });
  return {
    mode: "delta",
    pages,
    applied: 0,
    total: meta.row_count
  };
}

export async function fetchDbBarrasByBarcodeOnline(barras: string): Promise<DbBarrasCacheRow | null> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const normalized = normalizeBarcode(barras);
  if (!normalized) return null;

  const { data, error } = await supabase.rpc("rpc_db_barras_lookup", {
    p_barras: normalized
  });

  if (error) {
    throw new Error(`Falha ao buscar barras online: ${toErrorMessage(error)}`);
  }

  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) return null;

  const coddv = Number.parseInt(String(first.coddv ?? ""), 10);
  const descricao = String(first.descricao ?? "").trim();
  if (!Number.isFinite(coddv)) return null;

  return {
    barras: normalizeBarcode(String(first.barras ?? normalized)),
    coddv,
    descricao,
    updated_at: first.updated_at == null ? null : String(first.updated_at)
  };
}
