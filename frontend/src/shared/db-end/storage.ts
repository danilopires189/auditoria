import type { DbEndCacheRow, DbEndSyncMeta } from "./types";

const DB_NAME = "auditoria-db-end-v1";
const DB_VERSION = 1;

const STORE_DB_END_ROWS = "db_end_rows";
const STORE_META = "meta";

const INDEX_ROWS_BY_CD = "by_cd";
const INDEX_ROWS_BY_CD_CODDV = "by_cd_coddv";
const INDEX_ROWS_BY_CD_CODDV_TIPO = "by_cd_coddv_tipo";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function normalizeNonNegativeInteger(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const parsed = Math.trunc(value);
  return parsed >= 0 ? parsed : 0;
}

function normalizeCd(value: number): number {
  const parsed = Math.trunc(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCoddv(value: number): number {
  const parsed = Math.trunc(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeEndereco(value: string): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeTipo(value: string): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value == null) return null;
  const compact = String(value).trim();
  return compact ? compact : null;
}

function metaKey(cd: number): string {
  return `db_end_sync:${normalizeCd(cd)}`;
}

function rowKey(cd: number, coddv: number, tipo: string, endereco: string): string {
  return `${normalizeCd(cd)}|${normalizeCoddv(coddv)}|${normalizeTipo(tipo)}|${normalizeEndereco(endereco)}`;
}

interface DbEndStoreRow extends DbEndCacheRow {
  key: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_DB_END_ROWS)) {
        const store = db.createObjectStore(STORE_DB_END_ROWS, { keyPath: "key" });
        store.createIndex(INDEX_ROWS_BY_CD, "cd", { unique: false });
        store.createIndex(INDEX_ROWS_BY_CD_CODDV, ["cd", "coddv"], { unique: false });
        store.createIndex(INDEX_ROWS_BY_CD_CODDV_TIPO, ["cd", "coddv", "tipo"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open IndexedDB"));
  });

  return dbPromise;
}

function toStoreRow(row: DbEndCacheRow): DbEndStoreRow | null {
  const cd = normalizeCd(row.cd);
  const coddv = normalizeCoddv(row.coddv);
  const endereco = normalizeEndereco(row.endereco);
  if (cd <= 0 || coddv <= 0 || !endereco) return null;

  const tipo = normalizeTipo(row.tipo || "SEP");
  return {
    key: rowKey(cd, coddv, tipo, endereco),
    cd,
    coddv,
    descricao: String(row.descricao ?? "").trim(),
    endereco,
    tipo,
    andar: normalizeNullableString(row.andar),
    validade: normalizeNullableString(row.validade),
    updated_at: normalizeNullableString(row.updated_at)
  };
}

function fromStoreRow(value: unknown): DbEndCacheRow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const cd = normalizeCd(Number(raw.cd ?? 0));
  const coddv = normalizeCoddv(Number(raw.coddv ?? 0));
  const endereco = normalizeEndereco(String(raw.endereco ?? ""));
  const tipo = normalizeTipo(String(raw.tipo ?? ""));
  if (cd <= 0 || coddv <= 0 || !endereco) return null;

  return {
    cd,
    coddv,
    descricao: String(raw.descricao ?? "").trim(),
    endereco,
    tipo,
    andar: normalizeNullableString(raw.andar as string | null | undefined),
    validade: normalizeNullableString(raw.validade as string | null | undefined),
    updated_at: normalizeNullableString(raw.updated_at as string | null | undefined)
  };
}

async function deleteRowsByCd(rowsStore: IDBObjectStore, cd: number): Promise<number> {
  const rowsByCd = rowsStore.index(INDEX_ROWS_BY_CD);
  const range = IDBKeyRange.only(normalizeCd(cd));
  let removed = 0;

  await new Promise<void>((resolve, reject) => {
    const request = rowsByCd.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      removed += 1;
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar cache db_end por CD"));
  });

  return removed;
}

async function countRowsByCd(rowsStore: IDBObjectStore, cd: number): Promise<number> {
  const rowsByCd = rowsStore.index(INDEX_ROWS_BY_CD);
  const countRaw = await requestToPromise(rowsByCd.count(IDBKeyRange.only(normalizeCd(cd))));
  return normalizeNonNegativeInteger((countRaw as number | undefined) ?? 0);
}

function maxUpdatedAt(rows: DbEndCacheRow[]): string | null {
  let maxIso: string | null = null;
  let maxTs = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    if (!row.updated_at) continue;
    const parsed = Date.parse(row.updated_at);
    if (!Number.isFinite(parsed)) continue;
    if (parsed > maxTs) {
      maxTs = parsed;
      maxIso = row.updated_at;
    }
  }

  return maxIso;
}

export async function replaceDbEndCache(cd: number, rows: DbEndCacheRow[]): Promise<{ row_count: number; removed: number; last_sync_at: string }> {
  const normalizedCd = normalizeCd(cd);
  const db = await getDb();
  const transaction = db.transaction([STORE_DB_END_ROWS, STORE_META], "readwrite");
  const rowsStore = transaction.objectStore(STORE_DB_END_ROWS);
  const metaStore = transaction.objectStore(STORE_META);

  const removed = await deleteRowsByCd(rowsStore, normalizedCd);
  let applied = 0;
  for (const row of rows) {
    const storeRow = toStoreRow({ ...row, cd: normalizedCd });
    if (!storeRow) continue;
    rowsStore.put(storeRow);
    applied += 1;
  }

  const rowCount = await countRowsByCd(rowsStore, normalizedCd);
  const effectiveSyncAt = maxUpdatedAt(rows) ?? new Date().toISOString();

  metaStore.put({
    key: metaKey(normalizedCd),
    cd: normalizedCd,
    row_count: rowCount,
    last_sync_at: effectiveSyncAt
  });

  await transactionDone(transaction);
  return {
    row_count: rowCount,
    removed,
    last_sync_at: effectiveSyncAt
  };
}

export async function mergeDbEndCache(
  cd: number,
  rows: DbEndCacheRow[],
  syncAt?: string | null
): Promise<{ row_count: number; last_sync_at: string }> {
  const normalizedCd = normalizeCd(cd);
  const db = await getDb();
  const transaction = db.transaction([STORE_DB_END_ROWS, STORE_META], "readwrite");
  const rowsStore = transaction.objectStore(STORE_DB_END_ROWS);
  const metaStore = transaction.objectStore(STORE_META);

  for (const row of rows) {
    const storeRow = toStoreRow({ ...row, cd: normalizedCd });
    if (!storeRow) continue;
    rowsStore.put(storeRow);
  }

  const rowCount = await countRowsByCd(rowsStore, normalizedCd);
  const effectiveSyncAt = syncAt ?? maxUpdatedAt(rows) ?? new Date().toISOString();
  metaStore.put({
    key: metaKey(normalizedCd),
    cd: normalizedCd,
    row_count: rowCount,
    last_sync_at: effectiveSyncAt
  });

  await transactionDone(transaction);
  return {
    row_count: rowCount,
    last_sync_at: effectiveSyncAt
  };
}

export async function reconcileDbEndCache(
  cd: number,
  rows: DbEndCacheRow[],
  syncAt?: string | null
): Promise<{ row_count: number; removed: number; last_sync_at: string }> {
  const normalizedCd = normalizeCd(cd);
  const db = await getDb();
  const transaction = db.transaction([STORE_DB_END_ROWS, STORE_META], "readwrite");
  const rowsStore = transaction.objectStore(STORE_DB_END_ROWS);
  const metaStore = transaction.objectStore(STORE_META);
  const remoteKeys = new Set<string>();

  for (const row of rows) {
    const storeRow = toStoreRow({ ...row, cd: normalizedCd });
    if (!storeRow) continue;
    remoteKeys.add(storeRow.key);
    rowsStore.put(storeRow);
  }

  const rowsByCd = rowsStore.index(INDEX_ROWS_BY_CD);
  let removed = 0;
  await new Promise<void>((resolve, reject) => {
    const request = rowsByCd.openCursor(IDBKeyRange.only(normalizedCd));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const key = String(cursor.primaryKey ?? "");
      if (!remoteKeys.has(key)) {
        cursor.delete();
        removed += 1;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("Falha ao reconciliar cache db_end"));
  });

  const rowCount = await countRowsByCd(rowsStore, normalizedCd);
  const effectiveSyncAt = syncAt ?? maxUpdatedAt(rows) ?? new Date().toISOString();
  metaStore.put({
    key: metaKey(normalizedCd),
    cd: normalizedCd,
    row_count: rowCount,
    last_sync_at: effectiveSyncAt
  });

  await transactionDone(transaction);
  return {
    row_count: rowCount,
    removed,
    last_sync_at: effectiveSyncAt
  };
}

export async function upsertDbEndCacheRows(cd: number, rows: DbEndCacheRow[]): Promise<number> {
  const normalizedCd = normalizeCd(cd);
  const db = await getDb();
  const transaction = db.transaction(STORE_DB_END_ROWS, "readwrite");
  const rowsStore = transaction.objectStore(STORE_DB_END_ROWS);
  let applied = 0;

  for (const row of rows) {
    const storeRow = toStoreRow({ ...row, cd: normalizedCd });
    if (!storeRow) continue;
    rowsStore.put(storeRow);
    applied += 1;
  }

  await transactionDone(transaction);
  return applied;
}

export async function touchDbEndMeta(cd: number, syncAt?: string | null): Promise<void> {
  const normalizedCd = normalizeCd(cd);
  const db = await getDb();
  const transaction = db.transaction([STORE_DB_END_ROWS, STORE_META], "readwrite");
  const rowsStore = transaction.objectStore(STORE_DB_END_ROWS);
  const metaStore = transaction.objectStore(STORE_META);

  const rowCount = await countRowsByCd(rowsStore, normalizedCd);
  metaStore.put({
    key: metaKey(normalizedCd),
    cd: normalizedCd,
    row_count: rowCount,
    last_sync_at: syncAt ?? new Date().toISOString()
  });

  await transactionDone(transaction);
}

export async function getDbEndMeta(cd: number): Promise<DbEndSyncMeta> {
  const normalizedCd = normalizeCd(cd);
  const db = await getDb();
  const transaction = db.transaction([STORE_DB_END_ROWS, STORE_META], "readonly");
  const rowsStore = transaction.objectStore(STORE_DB_END_ROWS);
  const metaStore = transaction.objectStore(STORE_META);

  const [metaRaw, rowCount] = await Promise.all([
    requestToPromise(metaStore.get(metaKey(normalizedCd))),
    countRowsByCd(rowsStore, normalizedCd)
  ]);

  await transactionDone(transaction);

  const meta = (metaRaw as { last_sync_at?: string | null } | undefined) ?? {};
  return {
    cd: normalizedCd,
    row_count: rowCount,
    last_sync_at: meta.last_sync_at ?? null
  };
}

export async function getDbEndRowsByCoddv(cd: number, coddv: number, tipo?: string | null): Promise<DbEndCacheRow[]> {
  const normalizedCd = normalizeCd(cd);
  const normalizedCoddv = normalizeCoddv(coddv);
  if (normalizedCd <= 0 || normalizedCoddv <= 0) return [];

  const db = await getDb();
  const transaction = db.transaction(STORE_DB_END_ROWS, "readonly");
  const rowsStore = transaction.objectStore(STORE_DB_END_ROWS);
  const rawRows = tipo
    ? await requestToPromise(
        rowsStore
          .index(INDEX_ROWS_BY_CD_CODDV_TIPO)
          .getAll([normalizedCd, normalizedCoddv, normalizeTipo(tipo)])
      )
    : await requestToPromise(
        rowsStore
          .index(INDEX_ROWS_BY_CD_CODDV)
          .getAll([normalizedCd, normalizedCoddv])
      );

  await transactionDone(transaction);

  const parsedRows = (Array.isArray(rawRows) ? rawRows : [])
    .map((row) => fromStoreRow(row))
    .filter((row): row is DbEndCacheRow => row != null);

  parsedRows.sort((a, b) => {
    const byTipo = a.tipo.localeCompare(b.tipo, "pt-BR");
    if (byTipo !== 0) return byTipo;
    return a.endereco.localeCompare(b.endereco, "pt-BR");
  });
  return parsedRows;
}
