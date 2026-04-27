import { supabase } from "../../lib/supabase";
import {
  getDbEndMeta,
  mergeDbEndCache,
  reconcileDbEndCache,
  replaceDbEndCache,
  touchDbEndMeta
} from "./storage";
import type { DbEndCacheRow, DbEndProgress } from "./types";

const DB_END_PAGE_SIZE = 400;
const DB_END_MIN_PAGE_SIZE = 100;

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

export function normalizeEnderecoDisplay(value: string): string {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeEnderecoForCompare(value: string): string {
  return normalizeEnderecoDisplay(value).replace(/\s+/g, "");
}

function splitEnderecoBlocks(value: string): string[] {
  const normalized = normalizeEnderecoForCompare(value);
  if (!normalized) return [];
  return normalized
    .split(".")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function normalizeCd(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function computeCd02PrefixFromMBlock(realFirstBlock: string): string | null {
  const matched = /^M(\d+)$/i.exec(realFirstBlock);
  if (!matched) return null;

  const digits = matched[1];
  if (digits.length < 2) return null;
  const firstLast = Number.parseInt(`${digits[0]}${digits[digits.length - 1]}`, 10);
  if (!Number.isFinite(firstLast)) return null;

  const computed = firstLast - 10;
  if (!Number.isFinite(computed) || computed < 0) return null;
  return String(computed).padStart(3, "0");
}

function matchesCd02PrefixRule(input: string, candidate: string): boolean {
  const inputBlocks = splitEnderecoBlocks(input);
  const candidateBlocks = splitEnderecoBlocks(candidate);
  if (inputBlocks.length <= 0 || candidateBlocks.length <= 0) return false;
  if (inputBlocks.length !== candidateBlocks.length) return false;

  const computedPrefix = computeCd02PrefixFromMBlock(candidateBlocks[0]);
  if (!computedPrefix) return false;
  if (inputBlocks[0] !== computedPrefix) return false;

  for (let index = 1; index < candidateBlocks.length; index += 1) {
    if (inputBlocks[index] !== candidateBlocks[index]) return false;
  }
  return true;
}

export function buildEnderecoCompareKeys(value: string): string[] {
  const normalized = normalizeEnderecoForCompare(value);
  return normalized ? [normalized] : [];
}

export function enderecoMatchesForCompare(
  input: string,
  candidate: string,
  options?: { cd?: number | null }
): boolean {
  const normalizedInput = normalizeEnderecoForCompare(input);
  const normalizedCandidate = normalizeEnderecoForCompare(candidate);
  if (!normalizedInput || !normalizedCandidate) return false;
  if (normalizedInput === normalizedCandidate) return true;

  const cd = normalizeCd(options?.cd);
  if (cd !== 2) return false;
  return matchesCd02PrefixRule(normalizedInput, normalizedCandidate);
}

function parseDbEndRow(raw: Record<string, unknown>): DbEndCacheRow | null {
  const cd = parseInteger(raw.cd, 0);
  const coddv = parseInteger(raw.coddv, 0);
  const endereco = normalizeEnderecoDisplay(String(raw.endereco ?? ""));
  if (cd <= 0 || coddv <= 0 || !endereco) return null;

  return {
    cd,
    coddv,
    descricao: String(raw.descricao ?? "").trim(),
    endereco,
    tipo: normalizeEnderecoDisplay(String(raw.tipo ?? "")),
    andar: parseNullableString(raw.andar),
    validade: parseNullableString(raw.validade),
    updated_at: parseNullableString(raw.updated_at)
  };
}

export async function fetchDbEndMetaRemote(cd: number): Promise<{ row_count: number; updated_max: string | null }> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_db_end_meta", {
    p_cd: cd
  });

  if (error) {
    throw new Error(`Falha ao obter metadados de endereços: ${toErrorMessage(error)}`);
  }

  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return {
    row_count: Math.max(parseInteger(first?.row_count, 0), 0),
    updated_max: parseNullableString(first?.updated_max)
  };
}

async function fetchDbEndPageWithAdaptiveLimit(params: {
  rpcName: "rpc_db_end_page" | "rpc_db_end_delta";
  cd: number;
  offset: number;
  updatedAfter?: string;
  limit?: number;
}): Promise<{ page: unknown[]; usedLimit: number }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  let limit = Math.max(Math.trunc(params.limit ?? DB_END_PAGE_SIZE), DB_END_MIN_PAGE_SIZE);
  while (limit >= DB_END_MIN_PAGE_SIZE) {
    const payload: Record<string, unknown> = {
      p_cd: params.cd,
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

    if (!isStatementTimeout(error) || limit === DB_END_MIN_PAGE_SIZE) {
      const action = params.rpcName === "rpc_db_end_page" ? "carregar" : "atualizar";
      throw new Error(`Falha ao ${action} base de endereços: ${toErrorMessage(error)}`);
    }

    limit = Math.max(Math.trunc(limit / 2), DB_END_MIN_PAGE_SIZE);
  }

  return {
    page: [],
    usedLimit: DB_END_MIN_PAGE_SIZE
  };
}

export async function refreshDbEndCache(
  cd: number,
  onProgress?: (progress: DbEndProgress) => void
): Promise<{ rows: number; pages: number; totalRows: number }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const remoteMeta = await fetchDbEndMetaRemote(cd);
  const totalRows = Math.max(remoteMeta.row_count, 0);
  let offset = 0;
  let pages = 0;
  let pageLimit = DB_END_PAGE_SIZE;
  const allRows: DbEndCacheRow[] = [];

  while (true) {
    const result = await fetchDbEndPageWithAdaptiveLimit({
      rpcName: "rpc_db_end_page",
      cd,
      offset,
      limit: pageLimit
    });
    const page = result.page;
    pageLimit = result.usedLimit;
    if (page.length === 0) break;

    for (const item of page) {
      const parsed = parseDbEndRow(item as Record<string, unknown>);
      if (!parsed) continue;
      allRows.push(parsed);
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

  const replaced = await replaceDbEndCache(cd, allRows);
  onProgress?.({
    mode: "full",
    pagesFetched: pages,
    rowsFetched: replaced.row_count,
    totalRows,
    percent: 100
  });

  return {
    rows: replaced.row_count,
    pages,
    totalRows
  };
}

async function refreshDbEndCacheReconcile(
  cd: number,
  onProgress?: (progress: DbEndProgress) => void,
  remoteMetaInput?: { row_count: number; updated_max: string | null } | null
): Promise<{ rows: number; pages: number; totalRows: number; removed: number }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const remoteMeta = remoteMetaInput ?? await fetchDbEndMetaRemote(cd);
  const totalRows = Math.max(remoteMeta.row_count, 0);
  let offset = 0;
  let pages = 0;
  let pageLimit = DB_END_PAGE_SIZE;
  const allRows: DbEndCacheRow[] = [];

  while (true) {
    const result = await fetchDbEndPageWithAdaptiveLimit({
      rpcName: "rpc_db_end_page",
      cd,
      offset,
      limit: pageLimit
    });
    const page = result.page;
    pageLimit = result.usedLimit;
    if (page.length === 0) break;

    for (const item of page) {
      const parsed = parseDbEndRow(item as Record<string, unknown>);
      if (!parsed) continue;
      allRows.push(parsed);
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

  const reconciled = await reconcileDbEndCache(cd, allRows, remoteMeta.updated_max ?? undefined);
  onProgress?.({
    mode: "full",
    pagesFetched: pages,
    rowsFetched: reconciled.row_count,
    totalRows,
    percent: 100
  });

  return {
    rows: reconciled.row_count,
    pages,
    totalRows,
    removed: reconciled.removed
  };
}

export async function refreshDbEndCacheSmart(
  cd: number,
  onProgress?: (progress: DbEndProgress) => void,
  options?: {
    allowFullReconcile?: boolean;
  }
): Promise<{ mode: "full" | "delta"; pages: number; applied: number; total: number }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const allowFullReconcile = options?.allowFullReconcile ?? true;
  const remoteMeta = await fetchDbEndMetaRemote(cd);
  const meta = await getDbEndMeta(cd);

  if (meta.row_count <= 0 || !meta.last_sync_at) {
    const result = await refreshDbEndCacheReconcile(cd, onProgress, remoteMeta);
    return {
      mode: "full",
      pages: result.pages,
      applied: result.rows,
      total: result.rows
    };
  }

  const needsReconcile = remoteMeta.row_count < meta.row_count;
  if (needsReconcile && allowFullReconcile) {
    const reconciled = await refreshDbEndCacheReconcile(cd, onProgress, remoteMeta);
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
    await touchDbEndMeta(cd, new Date().toISOString());
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

  let offset = 0;
  let pages = 0;
  let pageLimit = DB_END_PAGE_SIZE;
  const changedRows: DbEndCacheRow[] = [];
  let maxSeenUpdatedAt: string | null = null;

  while (true) {
    let pageResult: { page: unknown[]; usedLimit: number };
    try {
      pageResult = await fetchDbEndPageWithAdaptiveLimit({
        rpcName: "rpc_db_end_delta",
        cd,
        updatedAfter: meta.last_sync_at,
        offset,
        limit: pageLimit
      });
    } catch (error) {
      if (isStatementTimeout(error) && allowFullReconcile) {
        const reconciled = await refreshDbEndCacheReconcile(cd, onProgress, remoteMeta);
        return {
          mode: "full",
          pages: reconciled.pages,
          applied: reconciled.rows,
          total: reconciled.rows
        };
      }

      throw error;
    }

    const page = pageResult.page;
    pageLimit = pageResult.usedLimit;
    if (page.length === 0) break;

    for (const item of page) {
      const parsed = parseDbEndRow(item as Record<string, unknown>);
      if (!parsed) continue;
      changedRows.push(parsed);

      if (parsed.updated_at) {
        const parsedTs = Date.parse(parsed.updated_at);
        const currentMax = maxSeenUpdatedAt ? Date.parse(maxSeenUpdatedAt) : Number.NEGATIVE_INFINITY;
        if (Number.isFinite(parsedTs) && parsedTs > currentMax) {
          maxSeenUpdatedAt = parsed.updated_at;
        }
      }
    }

    pages += 1;
    offset += page.length;
    onProgress?.({
      mode: "delta",
      pagesFetched: pages,
      rowsFetched: changedRows.length,
      totalRows: 0,
      percent: 0
    });

    if (page.length < pageLimit) break;
  }

  if (changedRows.length > 0) {
    const merged = await mergeDbEndCache(cd, changedRows, maxSeenUpdatedAt);

    if (allowFullReconcile && remoteMeta.row_count !== merged.row_count) {
      const reconciled = await refreshDbEndCacheReconcile(cd, onProgress, remoteMeta);
      return {
        mode: "full",
        pages: reconciled.pages,
        applied: reconciled.rows,
        total: reconciled.rows
      };
    }

    return {
      mode: "delta",
      pages,
      applied: changedRows.length,
      total: merged.row_count
    };
  }

  await touchDbEndMeta(cd, new Date().toISOString());
  onProgress?.({
    mode: "delta",
    pagesFetched: pages,
    rowsFetched: 0,
    totalRows: 0,
    percent: 100
  });

  return {
    mode: "delta",
    pages,
    applied: 0,
    total: meta.row_count
  };
}
