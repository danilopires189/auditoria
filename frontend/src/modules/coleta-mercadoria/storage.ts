import type {
  ColetaPreferences,
  ColetaRow,
  ColetaSyncStatus,
  DbBarrasCacheRow,
  DbBarrasSyncMeta
} from "./types";

const DB_NAME = "auditoria-coleta-v1";
const DB_VERSION = 1;

const STORE_DB_BARRAS = "db_barras";
const STORE_META = "meta";
const STORE_COLETA_ROWS = "coleta_rows";
const STORE_PREFS = "prefs";

const INDEX_ROWS_BY_USER = "by_user";
const INDEX_ROWS_BY_USER_STATUS = "by_user_status";

const META_DB_BARRAS_SYNC = "db_barras_sync";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const PENDING_STATUSES: ColetaSyncStatus[] = ["pending_insert", "pending_update", "pending_delete", "error"];

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

function createDefaultPreferences(): ColetaPreferences {
  return {
    etiqueta_fixa: "",
    multiplo_padrao: 1,
    cd_ativo: null,
    prefer_offline_mode: false
  };
}

function prefsKey(userId: string): string {
  return `prefs:${userId}`;
}

function normalizePositiveInteger(value: number | null | undefined, fallback = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const parsed = Math.trunc(value);
  return parsed > 0 ? parsed : fallback;
}

function sortRows(rows: ColetaRow[]): ColetaRow[] {
  return [...rows].sort((a, b) => {
    const aTime = Date.parse(a.data_hr || a.updated_at || a.created_at || "");
    const bTime = Date.parse(b.data_hr || b.updated_at || b.created_at || "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return bTime - aTime;
    }
    return (b.updated_at || "").localeCompare(a.updated_at || "");
  });
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

function maxUpdatedAt(rows: DbBarrasCacheRow[]): string | null {
  let maxIso: string | null = null;
  let maxTs = 0;
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

export async function getDbBarrasByBarcode(barras: string): Promise<DbBarrasCacheRow | null> {
  const db = await getDb();
  const transaction = db.transaction(STORE_DB_BARRAS, "readonly");
  const store = transaction.objectStore(STORE_DB_BARRAS);
  const result = await requestToPromise(store.get(barras));
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

  const count = await requestToPromise(barrasStore.count());
  const effectiveSyncAt = syncAt ?? maxUpdatedAt(rows) ?? new Date().toISOString();

  metaStore.put({
    key: META_DB_BARRAS_SYNC,
    last_sync_at: effectiveSyncAt,
    row_count: normalizePositiveInteger((count as number | undefined) ?? 0, 0)
  });

  await transactionDone(transaction);
  return {
    row_count: normalizePositiveInteger((count as number | undefined) ?? 0, 0),
    last_sync_at: effectiveSyncAt
  };
}

export async function touchDbBarrasMeta(syncAt?: string | null): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction([STORE_DB_BARRAS, STORE_META], "readwrite");
  const barrasStore = transaction.objectStore(STORE_DB_BARRAS);
  const metaStore = transaction.objectStore(STORE_META);
  const count = await requestToPromise(barrasStore.count());
  metaStore.put({
    key: META_DB_BARRAS_SYNC,
    last_sync_at: syncAt ?? new Date().toISOString(),
    row_count: normalizePositiveInteger((count as number | undefined) ?? 0, 0)
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

  const meta = (metaRaw as { last_sync_at?: string | null; row_count?: number } | undefined) ?? {};
  return {
    last_sync_at: meta.last_sync_at ?? null,
    row_count: normalizePositiveInteger((countRaw as number | undefined) ?? 0, 0)
  };
}

export async function upsertColetaRow(row: ColetaRow): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_COLETA_ROWS, "readwrite");
  transaction.objectStore(STORE_COLETA_ROWS).put(row);
  await transactionDone(transaction);
}

export async function removeColetaRow(localId: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_COLETA_ROWS, "readwrite");
  transaction.objectStore(STORE_COLETA_ROWS).delete(localId);
  await transactionDone(transaction);
}

export async function getUserColetaRows(userId: string): Promise<ColetaRow[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_COLETA_ROWS, "readonly");
  const index = transaction.objectStore(STORE_COLETA_ROWS).index(INDEX_ROWS_BY_USER);

  const rows = (await requestToPromise(index.getAll(userId))) as ColetaRow[];
  await transactionDone(transaction);
  return sortRows(rows ?? []);
}

export async function getPendingRows(userId: string): Promise<ColetaRow[]> {
  const allRows = await getUserColetaRows(userId);
  return allRows.filter((row) => PENDING_STATUSES.includes(row.sync_status));
}

export async function countPendingRows(userId: string): Promise<number> {
  const pending = await getPendingRows(userId);
  return pending.length;
}

export async function getColetaPreferences(userId: string): Promise<ColetaPreferences> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readonly");
  const store = transaction.objectStore(STORE_PREFS);
  const raw = await requestToPromise(store.get(prefsKey(userId)));
  await transactionDone(transaction);

  if (!raw || typeof raw !== "object") {
    return createDefaultPreferences();
  }

  const payload = (raw as { value?: Partial<ColetaPreferences> }).value;
  return {
    etiqueta_fixa: typeof payload?.etiqueta_fixa === "string" ? payload.etiqueta_fixa : "",
    multiplo_padrao: normalizePositiveInteger(payload?.multiplo_padrao, 1),
    cd_ativo: typeof payload?.cd_ativo === "number" && Number.isFinite(payload.cd_ativo)
      ? Math.trunc(payload.cd_ativo)
      : null,
    prefer_offline_mode: Boolean(payload?.prefer_offline_mode)
  };
}

export async function saveColetaPreferences(userId: string, preferences: ColetaPreferences): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readwrite");
  const store = transaction.objectStore(STORE_PREFS);

  store.put({
    key: prefsKey(userId),
    value: {
      etiqueta_fixa: preferences.etiqueta_fixa,
      multiplo_padrao: normalizePositiveInteger(preferences.multiplo_padrao, 1),
      cd_ativo: preferences.cd_ativo,
      prefer_offline_mode: Boolean(preferences.prefer_offline_mode)
    }
  });

  await transactionDone(transaction);
}

function safeTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function cleanupExpiredColetaRows(userId: string, ttlMs = ONE_DAY_MS): Promise<number> {
  const db = await getDb();
  const transaction = db.transaction(STORE_COLETA_ROWS, "readwrite");
  const store = transaction.objectStore(STORE_COLETA_ROWS);
  const index = store.index(INDEX_ROWS_BY_USER);
  const request = index.openCursor(IDBKeyRange.only(userId));
  const threshold = Date.now() - Math.max(ttlMs, 60_000);
  let removed = 0;

  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar coletas expiradas."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      const row = cursor.value as ColetaRow;
      const lastTouch = Math.max(
        safeTimestamp(row.updated_at),
        safeTimestamp(row.created_at),
        safeTimestamp(row.data_hr)
      );

      if (lastTouch > 0 && lastTouch < threshold) {
        cursor.delete();
        removed += 1;
      }
      cursor.continue();
    };
  });

  await transactionDone(transaction);
  return removed;
}

export async function clearUserColetaSessionCache(userId: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction([STORE_COLETA_ROWS, STORE_PREFS], "readwrite");
  const rowStore = transaction.objectStore(STORE_COLETA_ROWS);
  const prefStore = transaction.objectStore(STORE_PREFS);
  const index = rowStore.index(INDEX_ROWS_BY_USER);
  const request = index.openCursor(IDBKeyRange.only(userId));

  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar sessão de coleta."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  });

  prefStore.delete(prefsKey(userId));
  await transactionDone(transaction);
}
