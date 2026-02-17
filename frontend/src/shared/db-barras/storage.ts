import type { DbBarrasCacheRow, DbBarrasSyncMeta } from "./types";

const DB_NAME = "auditoria-coleta-v1";
const DB_VERSION = 1;

const STORE_DB_BARRAS = "db_barras";
const STORE_META = "meta";
const STORE_COLETA_ROWS = "coleta_rows";
const STORE_PREFS = "prefs";

const INDEX_ROWS_BY_USER = "by_user";
const INDEX_ROWS_BY_USER_STATUS = "by_user_status";

const META_DB_BARRAS_SYNC = "db_barras_sync";

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
  return parsed > 0 ? parsed : 0;
}

function maxUpdatedAt(rows: DbBarrasCacheRow[]): string | null {
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

let dbPromise: Promise<IDBDatabase> | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_DB_BARRAS)) {
        db.createObjectStore(STORE_DB_BARRAS, { keyPath: "barras" });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORE_COLETA_ROWS)) {
        const store = db.createObjectStore(STORE_COLETA_ROWS, { keyPath: "local_id" });
        store.createIndex(INDEX_ROWS_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_ROWS_BY_USER_STATUS, ["user_id", "sync_status"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_PREFS)) {
        db.createObjectStore(STORE_PREFS, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open IndexedDB"));
  });

  return dbPromise;
}

export async function replaceDbBarrasCache(rows: DbBarrasCacheRow[]): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction([STORE_DB_BARRAS, STORE_META], "readwrite");
  const barrasStore = transaction.objectStore(STORE_DB_BARRAS);
  const metaStore = transaction.objectStore(STORE_META);

  barrasStore.clear();
  for (const row of rows) {
    barrasStore.put({
      barras: row.barras,
      coddv: row.coddv,
      descricao: row.descricao,
      updated_at: row.updated_at
    });
  }

  metaStore.put({
    key: META_DB_BARRAS_SYNC,
    last_sync_at: maxUpdatedAt(rows) ?? new Date().toISOString(),
    row_count: rows.length
  });

  await transactionDone(transaction);
}

export async function getDbBarrasByBarcode(barras: string): Promise<DbBarrasCacheRow | null> {
  const normalized = barras.trim();
  if (!normalized) return null;

  const db = await getDb();
  const transaction = db.transaction(STORE_DB_BARRAS, "readonly");
  const store = transaction.objectStore(STORE_DB_BARRAS);
  const result = await requestToPromise(store.get(normalized));
  await transactionDone(transaction);
  return (result as DbBarrasCacheRow | undefined) ?? null;
}

export async function upsertDbBarrasCacheRow(row: DbBarrasCacheRow): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_DB_BARRAS, "readwrite");
  const store = transaction.objectStore(STORE_DB_BARRAS);
  store.put({
    barras: row.barras,
    coddv: row.coddv,
    descricao: row.descricao,
    updated_at: row.updated_at
  });
  await transactionDone(transaction);
}

export async function mergeDbBarrasCache(
  rows: DbBarrasCacheRow[],
  syncAt?: string | null
): Promise<{ row_count: number; last_sync_at: string }> {
  const db = await getDb();
  const transaction = db.transaction([STORE_DB_BARRAS, STORE_META], "readwrite");
  const barrasStore = transaction.objectStore(STORE_DB_BARRAS);
  const metaStore = transaction.objectStore(STORE_META);

  for (const row of rows) {
    barrasStore.put({
      barras: row.barras,
      coddv: row.coddv,
      descricao: row.descricao,
      updated_at: row.updated_at
    });
  }

  const countRaw = await requestToPromise(barrasStore.count());
  const rowCount = normalizeNonNegativeInteger((countRaw as number | undefined) ?? 0);
  const effectiveSyncAt = syncAt ?? maxUpdatedAt(rows) ?? new Date().toISOString();

  metaStore.put({
    key: META_DB_BARRAS_SYNC,
    last_sync_at: effectiveSyncAt,
    row_count: rowCount
  });

  await transactionDone(transaction);
  return {
    row_count: rowCount,
    last_sync_at: effectiveSyncAt
  };
}

export async function touchDbBarrasMeta(syncAt?: string | null): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction([STORE_DB_BARRAS, STORE_META], "readwrite");
  const barrasStore = transaction.objectStore(STORE_DB_BARRAS);
  const metaStore = transaction.objectStore(STORE_META);
  const countRaw = await requestToPromise(barrasStore.count());
  const rowCount = normalizeNonNegativeInteger((countRaw as number | undefined) ?? 0);

  metaStore.put({
    key: META_DB_BARRAS_SYNC,
    last_sync_at: syncAt ?? new Date().toISOString(),
    row_count: rowCount
  });

  await transactionDone(transaction);
}

export async function getDbBarrasMeta(): Promise<DbBarrasSyncMeta> {
  const db = await getDb();
  const transaction = db.transaction([STORE_DB_BARRAS, STORE_META], "readonly");
  const barrasStore = transaction.objectStore(STORE_DB_BARRAS);
  const metaStore = transaction.objectStore(STORE_META);

  const [metaRaw, countRaw] = await Promise.all([
    requestToPromise(metaStore.get(META_DB_BARRAS_SYNC)),
    requestToPromise(barrasStore.count())
  ]);

  await transactionDone(transaction);

  const meta = (metaRaw as { last_sync_at?: string | null } | undefined) ?? {};
  return {
    last_sync_at: meta.last_sync_at ?? null,
    row_count: normalizeNonNegativeInteger((countRaw as number | undefined) ?? 0)
  };
}
