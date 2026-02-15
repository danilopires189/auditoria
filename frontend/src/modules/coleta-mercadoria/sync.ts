import { supabase } from "../../lib/supabase";
import {
  countPendingRows,
  getDbBarrasMeta,
  getPendingRows,
  mergeDbBarrasCache,
  removeColetaRow,
  replaceDbBarrasCache,
  touchDbBarrasMeta,
  upsertColetaRow
} from "./storage";
import type {
  CdOption,
  ColetaReportFilters,
  ColetaReportRow,
  ColetaRow,
  DbBarrasCacheRow
} from "./types";

const DB_BARRAS_PAGE_SIZE = 1000;

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

function mapRpcRowToColetaRow(raw: Record<string, unknown>, userIdFallback = ""): ColetaRow {
  const id = typeof raw.id === "string" ? raw.id : "";
  const dataHr = typeof raw.data_hr === "string" ? raw.data_hr : new Date().toISOString();
  const createdAt = typeof raw.created_at === "string" ? raw.created_at : dataHr;
  const updatedAt = typeof raw.updated_at === "string" ? raw.updated_at : dataHr;

  return {
    local_id: id ? `remote:${id}` : `remote:${Date.now()}`,
    remote_id: id || null,
    user_id: typeof raw.user_id === "string" ? raw.user_id : userIdFallback,
    etiqueta: parseNullableString(raw.etiqueta),
    cd: parseInteger(raw.cd),
    barras: String(raw.barras ?? ""),
    coddv: parseInteger(raw.coddv),
    descricao: String(raw.descricao ?? "").trim(),
    qtd: parseInteger(raw.qtd, 1),
    ocorrencia: raw.ocorrencia === "Avariado" || raw.ocorrencia === "Vencido" ? raw.ocorrencia : null,
    lote: parseNullableString(raw.lote),
    val_mmaa: parseNullableString(raw.val_mmaa),
    mat_aud: String(raw.mat_aud ?? ""),
    nome_aud: String(raw.nome_aud ?? ""),
    data_hr: dataHr,
    created_at: createdAt,
    updated_at: updatedAt,
    sync_status: "synced",
    sync_error: null
  };
}

function mapRpcRowToReport(raw: Record<string, unknown>): ColetaReportRow {
  return {
    id: String(raw.id ?? ""),
    etiqueta: parseNullableString(raw.etiqueta),
    cd: parseInteger(raw.cd),
    barras: String(raw.barras ?? ""),
    coddv: parseInteger(raw.coddv),
    descricao: String(raw.descricao ?? ""),
    qtd: parseInteger(raw.qtd),
    ocorrencia: raw.ocorrencia === "Avariado" || raw.ocorrencia === "Vencido" ? raw.ocorrencia : null,
    lote: parseNullableString(raw.lote),
    val_mmaa: parseNullableString(raw.val_mmaa),
    mat_aud: String(raw.mat_aud ?? ""),
    nome_aud: String(raw.nome_aud ?? ""),
    user_id: String(raw.user_id ?? ""),
    data_hr: String(raw.data_hr ?? ""),
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? "")
  };
}

export function normalizeBarcode(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

export function normalizeValidadeInput(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length !== 4) {
    throw new Error("Validade deve ser MM/AA.");
  }

  const month = Number.parseInt(digits.slice(0, 2), 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error("Mês de validade inválido.");
  }

  return digits;
}

export function formatValidade(value: string | null): string {
  if (!value || value.length !== 4) return "";
  return `${value.slice(0, 2)}/${value.slice(2)}`;
}

export async function fetchCdOptions(): Promise<CdOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_cd_options");
  if (error) throw error;

  if (!Array.isArray(data)) return [];

  return data
    .map((row) => {
      const cd = Number.parseInt(String((row as Record<string, unknown>).cd ?? ""), 10);
      const cdNomeRaw = (row as Record<string, unknown>).cd_nome;
      const cdNome = typeof cdNomeRaw === "string" ? cdNomeRaw : `CD ${cd}`;
      if (!Number.isFinite(cd)) return null;
      return { cd, cd_nome: cdNome } satisfies CdOption;
    })
    .filter((row): row is CdOption => row != null);
}

export async function refreshDbBarrasCache(
  onProgress?: (pagesFetched: number, rowsFetched: number) => void
): Promise<{ rows: number; pages: number }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  let offset = 0;
  let pages = 0;
  const allRows: DbBarrasCacheRow[] = [];

  while (true) {
    const { data, error } = await supabase.rpc("rpc_db_barras_page", {
      p_offset: offset,
      p_limit: DB_BARRAS_PAGE_SIZE
    });

    if (error) {
      throw new Error(`Falha ao carregar base de barras: ${toErrorMessage(error)}`);
    }

    const page = Array.isArray(data) ? data : [];
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
    onProgress?.(pages, allRows.length);

    if (page.length < DB_BARRAS_PAGE_SIZE) break;
  }

  await replaceDbBarrasCache(allRows);
  return { rows: allRows.length, pages };
}

export async function refreshDbBarrasCacheSmart(
  onProgress?: (pagesFetched: number, rowsFetched: number) => void
): Promise<{ mode: "full" | "delta"; pages: number; applied: number; total: number }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const meta = await getDbBarrasMeta();
  if (meta.row_count <= 0 || !meta.last_sync_at) {
    const result = await refreshDbBarrasCache(onProgress);
    return {
      mode: "full",
      pages: result.pages,
      applied: result.rows,
      total: result.rows
    };
  }

  let offset = 0;
  let pages = 0;
  const changedRows: DbBarrasCacheRow[] = [];
  let maxSeenUpdatedAt: string | null = null;

  while (true) {
    const { data, error } = await supabase.rpc("rpc_db_barras_delta", {
      p_updated_after: meta.last_sync_at,
      p_offset: offset,
      p_limit: DB_BARRAS_PAGE_SIZE
    });

    if (error) {
      throw new Error(`Falha ao atualizar base de barras: ${toErrorMessage(error)}`);
    }

    const page = Array.isArray(data) ? data : [];
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
        if (Number.isFinite(parsed)) {
          const currentMax = maxSeenUpdatedAt ? Date.parse(maxSeenUpdatedAt) : 0;
          if (parsed > currentMax) {
            maxSeenUpdatedAt = updatedAt;
          }
        }
      }
    }

    pages += 1;
    offset += page.length;
    onProgress?.(pages, changedRows.length);

    if (page.length < DB_BARRAS_PAGE_SIZE) break;
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

export async function fetchTodaySharedColetaRows(cd: number, limit = 1200): Promise<ColetaRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_aud_coleta_today", {
    p_cd: cd,
    p_limit: limit
  });

  if (error) {
    throw new Error(`Falha ao buscar coletas do dia: ${toErrorMessage(error)}`);
  }

  if (!Array.isArray(data)) return [];

  return data
    .map((item) => mapRpcRowToColetaRow(item as Record<string, unknown>))
    .filter((item) => item.remote_id != null);
}

function patchError(row: ColetaRow, message: string): ColetaRow {
  return {
    ...row,
    sync_status: "error",
    sync_error: message,
    updated_at: new Date().toISOString()
  };
}

async function syncInsert(row: ColetaRow): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_aud_coleta_insert", {
    p_cd: row.cd,
    p_barras: row.barras,
    p_qtd: row.qtd,
    p_etiqueta: row.etiqueta,
    p_ocorrencia: row.ocorrencia,
    p_lote: row.lote,
    p_val_mmaa: row.val_mmaa,
    p_data_hr: row.data_hr
  });

  if (error) {
    throw new Error(toErrorMessage(error));
  }

  const first = Array.isArray(data) ? data[0] : null;
  if (!first || typeof first !== "object") {
    throw new Error("Resposta inválida ao inserir coleta.");
  }
}

async function syncUpdate(row: ColetaRow): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  if (!row.remote_id) {
    throw new Error("Linha sem ID remoto para atualização.");
  }

  const { data, error } = await supabase.rpc("rpc_aud_coleta_update", {
    p_id: row.remote_id,
    p_qtd: row.qtd,
    p_etiqueta: row.etiqueta,
    p_ocorrencia: row.ocorrencia,
    p_lote: row.lote,
    p_val_mmaa: row.val_mmaa
  });

  if (error) {
    throw new Error(toErrorMessage(error));
  }

  const first = Array.isArray(data) ? data[0] : null;
  if (!first || typeof first !== "object") {
    throw new Error("Resposta inválida ao atualizar coleta.");
  }
}

async function syncDelete(row: ColetaRow): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  if (!row.remote_id) {
    await removeColetaRow(row.local_id);
    return;
  }

  const { data, error } = await supabase.rpc("rpc_aud_coleta_delete", {
    p_id: row.remote_id
  });

  if (error) {
    throw new Error(toErrorMessage(error));
  }

  if (data !== true) {
    throw new Error("Linha não encontrada para exclusão.");
  }

  await removeColetaRow(row.local_id);
}

export async function syncPendingColetaRows(userId: string): Promise<{
  processed: number;
  synced: number;
  failed: number;
  pending: number;
}> {
  const pendingRows = await getPendingRows(userId);

  let synced = 0;
  let failed = 0;

  for (const row of pendingRows) {
    try {
      if (row.sync_status === "pending_delete") {
        await syncDelete(row);
      } else if (row.sync_status === "pending_update") {
        await syncUpdate(row);
        await removeColetaRow(row.local_id);
      } else {
        if (row.remote_id) {
          await syncUpdate(row);
        } else {
          await syncInsert(row);
        }
        await removeColetaRow(row.local_id);
      }
      synced += 1;
    } catch (error) {
      failed += 1;
      await upsertColetaRow(patchError(row, toErrorMessage(error)));
    }
  }

  const pending = await countPendingRows(userId);
  return {
    processed: pendingRows.length,
    synced,
    failed,
    pending
  };
}

export async function countColetaReportRows(filters: ColetaReportFilters): Promise<number> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_aud_coleta_report_count", {
    p_dt_ini: filters.dtIni,
    p_dt_fim: filters.dtFim,
    p_cd: filters.cd
  });

  if (error) {
    throw new Error(toErrorMessage(error));
  }

  return parseInteger(data, 0);
}

export async function fetchColetaReportRows(
  filters: ColetaReportFilters,
  limit = 20000
): Promise<ColetaReportRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_aud_coleta_report_rows", {
    p_dt_ini: filters.dtIni,
    p_dt_fim: filters.dtFim,
    p_cd: filters.cd,
    p_limit: limit
  });

  if (error) {
    throw new Error(toErrorMessage(error));
  }

  if (!Array.isArray(data)) return [];
  return data.map((item) => mapRpcRowToReport(item as Record<string, unknown>));
}
