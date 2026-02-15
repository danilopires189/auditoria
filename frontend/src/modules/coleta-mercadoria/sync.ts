import { supabase } from "../../lib/supabase";
import {
  countPendingRows,
  getPendingRows,
  removeColetaRow,
  replaceDbBarrasCache,
  upsertColetaRow
} from "./storage";
import type { CdOption, ColetaRow, DbBarrasCacheRow } from "./types";

const DB_BARRAS_PAGE_SIZE = 1000;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.error_description === "string") return candidate.error_description;
  }
  return "Erro inesperado";
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

function patchError(row: ColetaRow, message: string): ColetaRow {
  return {
    ...row,
    sync_status: "error",
    sync_error: message,
    updated_at: new Date().toISOString()
  };
}

function toRowFromRpc(base: ColetaRow, payload: Record<string, unknown>): ColetaRow {
  const remoteId = typeof payload.id === "string" ? payload.id : base.remote_id;
  const dataHr = typeof payload.data_hr === "string" ? payload.data_hr : base.data_hr;
  const createdAt = typeof payload.created_at === "string" ? payload.created_at : base.created_at;
  const updatedAt = typeof payload.updated_at === "string" ? payload.updated_at : new Date().toISOString();

  return {
    ...base,
    remote_id: remoteId,
    etiqueta: typeof payload.etiqueta === "string" ? payload.etiqueta : base.etiqueta,
    cd: Number.parseInt(String(payload.cd ?? base.cd), 10),
    barras: typeof payload.barras === "string" ? payload.barras : base.barras,
    coddv: Number.parseInt(String(payload.coddv ?? base.coddv), 10),
    descricao: typeof payload.descricao === "string" ? payload.descricao : base.descricao,
    qtd: Number.parseInt(String(payload.qtd ?? base.qtd), 10),
    ocorrencia:
      payload.ocorrencia === "Avariado" || payload.ocorrencia === "Vencido"
        ? payload.ocorrencia
        : null,
    lote: typeof payload.lote === "string" ? payload.lote : base.lote,
    val_mmaa: typeof payload.val_mmaa === "string" ? payload.val_mmaa : base.val_mmaa,
    mat_aud: typeof payload.mat_aud === "string" ? payload.mat_aud : base.mat_aud,
    nome_aud: typeof payload.nome_aud === "string" ? payload.nome_aud : base.nome_aud,
    data_hr: dataHr,
    created_at: createdAt,
    updated_at: updatedAt,
    sync_status: "synced",
    sync_error: null
  };
}

async function syncInsert(row: ColetaRow): Promise<ColetaRow> {
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

  return toRowFromRpc(row, first as Record<string, unknown>);
}

async function syncUpdate(row: ColetaRow): Promise<ColetaRow> {
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

  return toRowFromRpc(row, first as Record<string, unknown>);
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
        const syncedRow = await syncUpdate(row);
        await upsertColetaRow(syncedRow);
      } else {
        const syncedRow = row.remote_id ? await syncUpdate(row) : await syncInsert(row);
        await upsertColetaRow(syncedRow);
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
