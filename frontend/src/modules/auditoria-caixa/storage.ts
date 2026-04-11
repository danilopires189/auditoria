import type {
  AuditoriaCaixaPreferences,
  AuditoriaCaixaRow,
  AuditoriaCaixaSyncStatus,
  DbRotasCacheRow,
  DbRotasSyncMeta
} from "./types";

const DB_NAME = "auditoria-caixa-v1";
const DB_VERSION = 1;

const STORE_DB_ROTAS = "db_rotas";
const STORE_META = "meta";
const STORE_CAIXA_ROWS = "caixa_rows";
const STORE_PREFS = "prefs";

const INDEX_ROTAS_BY_USER = "by_user";
const INDEX_ROTAS_BY_USER_CD = "by_user_cd";
const INDEX_ROWS_BY_USER = "by_user";
const INDEX_ROWS_BY_USER_STATUS = "by_user_status";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const META_ROTAS_PREFIX = "db_rotas_meta";
const PREFS_PREFIX = "prefs";
const PENDING_STATUSES: AuditoriaCaixaSyncStatus[] = ["pending_insert", "pending_update", "pending_delete", "error"];

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

function createDefaultPreferences(): AuditoriaCaixaPreferences {
  return {
    cd_ativo: null,
    prefer_offline_mode: false
  };
}

function prefsKey(userId: string): string {
  return `${PREFS_PREFIX}:${userId}`;
}

function routeMetaKey(userId: string, cd: number): string {
  return `${META_ROTAS_PREFIX}:${userId}:${cd}`;
}

function routeKey(userId: string, cd: number, filial: number): string {
  return `${userId}:${cd}:${filial}`;
}

function normalizePositiveInteger(value: number | null | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const parsed = Math.trunc(value);
  return parsed >= 0 ? parsed : fallback;
}

function sortRows(rows: AuditoriaCaixaRow[]): AuditoriaCaixaRow[] {
  return [...rows].sort((a, b) => {
    const aTime = Date.parse(a.data_hr || a.updated_at || a.created_at || "");
    const bTime = Date.parse(b.data_hr || b.updated_at || b.created_at || "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return bTime - aTime;
    }
    return (b.updated_at || "").localeCompare(a.updated_at || "");
  });
}

function safeTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

let dbPromise: Promise<IDBDatabase> | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      // Verifica se a conexão ainda está aberta tentando uma transação vazia
      db.transaction([], "readonly").abort();
      return db;
    } catch {
      dbPromise = null;
    }
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_DB_ROTAS)) {
        const store = db.createObjectStore(STORE_DB_ROTAS, { keyPath: "key" });
        store.createIndex(INDEX_ROTAS_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_ROTAS_BY_USER_CD, ["user_id", "cd"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORE_CAIXA_ROWS)) {
        const store = db.createObjectStore(STORE_CAIXA_ROWS, { keyPath: "local_id" });
        store.createIndex(INDEX_ROWS_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_ROWS_BY_USER_STATUS, ["user_id", "sync_status"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_PREFS)) {
        db.createObjectStore(STORE_PREFS, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => { dbPromise = null; };
      db.onerror = () => { dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Cannot open IndexedDB"));
    };
  });

  return dbPromise;
}

export async function replaceDbRotasCache(params: {
  user_id: string;
  cd: number;
  rows: DbRotasCacheRow[];
  synced_at?: string | null;
}): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction([STORE_DB_ROTAS, STORE_META], "readwrite");
  const routeStore = transaction.objectStore(STORE_DB_ROTAS);
  const routeIndex = routeStore.index(INDEX_ROTAS_BY_USER_CD);
  const metaStore = transaction.objectStore(STORE_META);
  const keyRange = IDBKeyRange.only([params.user_id, Math.trunc(params.cd)]);
  const request = routeIndex.openCursor(keyRange);

  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar cache local de rotas."));
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

  for (const row of params.rows) {
    routeStore.put({
      key: routeKey(params.user_id, params.cd, row.filial),
      user_id: params.user_id,
      cd: Math.trunc(params.cd),
      filial: Math.trunc(row.filial),
      uf: row.uf ?? null,
      nome: row.nome ?? null,
      rota: row.rota ?? null,
      updated_at: row.updated_at ?? null
    });
  }

  metaStore.put({
    key: routeMetaKey(params.user_id, params.cd),
    user_id: params.user_id,
    cd: Math.trunc(params.cd),
    row_count: params.rows.length,
    last_sync_at: params.synced_at ?? new Date().toISOString()
  });

  await transactionDone(transaction);
}

export async function getDbRotasMeta(userId: string, cd: number): Promise<DbRotasSyncMeta> {
  const db = await getDb();
  const transaction = db.transaction(STORE_META, "readonly");
  const store = transaction.objectStore(STORE_META);
  const result = await requestToPromise(store.get(routeMetaKey(userId, cd)));
  await transactionDone(transaction);

  const meta = (result as { row_count?: number; last_sync_at?: string | null } | undefined) ?? {};
  return {
    row_count: normalizePositiveInteger(meta.row_count, 0),
    last_sync_at: meta.last_sync_at ?? null
  };
}

export async function getDbRotasByFilial(userId: string, cd: number, filial: number): Promise<DbRotasCacheRow | null> {
  const db = await getDb();
  const transaction = db.transaction(STORE_DB_ROTAS, "readonly");
  const store = transaction.objectStore(STORE_DB_ROTAS);
  const result = await requestToPromise(store.get(routeKey(userId, cd, filial)));
  await transactionDone(transaction);

  const row = result as { filial?: number; uf?: string | null; nome?: string | null; rota?: string | null; updated_at?: string | null } | undefined;
  if (!row) return null;
  return {
    filial: normalizePositiveInteger(row.filial, 0),
    uf: row.uf ?? null,
    nome: row.nome ?? null,
    rota: row.rota ?? null,
    updated_at: row.updated_at ?? null
  };
}

export async function upsertAuditoriaCaixaRow(row: AuditoriaCaixaRow): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_CAIXA_ROWS, "readwrite");
  transaction.objectStore(STORE_CAIXA_ROWS).put(row);
  await transactionDone(transaction);
}

export async function removeAuditoriaCaixaRow(localId: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_CAIXA_ROWS, "readwrite");
  transaction.objectStore(STORE_CAIXA_ROWS).delete(localId);
  await transactionDone(transaction);
}

export async function getUserAuditoriaCaixaRows(userId: string): Promise<AuditoriaCaixaRow[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_CAIXA_ROWS, "readonly");
  const index = transaction.objectStore(STORE_CAIXA_ROWS).index(INDEX_ROWS_BY_USER);
  const rows = (await requestToPromise(index.getAll(userId))) as AuditoriaCaixaRow[];
  await transactionDone(transaction);
  return sortRows(rows ?? []);
}

export async function getPendingAuditoriaCaixaRows(userId: string): Promise<AuditoriaCaixaRow[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_CAIXA_ROWS, "readonly");
  const index = transaction.objectStore(STORE_CAIXA_ROWS).index(INDEX_ROWS_BY_USER_STATUS);

  const batches = await Promise.all(
    PENDING_STATUSES.map((status) =>
      requestToPromise(index.getAll(IDBKeyRange.only([userId, status])))
    )
  );
  await transactionDone(transaction);

  const rows = batches.flatMap((batch) => (Array.isArray(batch) ? (batch as AuditoriaCaixaRow[]) : []));
  return sortRows(rows);
}

export async function countPendingAuditoriaCaixaRows(userId: string): Promise<number> {
  const db = await getDb();
  const transaction = db.transaction(STORE_CAIXA_ROWS, "readonly");
  const index = transaction.objectStore(STORE_CAIXA_ROWS).index(INDEX_ROWS_BY_USER_STATUS);

  const counts = await Promise.all(
    PENDING_STATUSES.map((status) =>
      requestToPromise(index.count(IDBKeyRange.only([userId, status])))
    )
  );
  await transactionDone(transaction);

  return counts.reduce((sum, current) => sum + normalizePositiveInteger(current as number | undefined, 0), 0);
}

export async function getAuditoriaCaixaPreferences(userId: string): Promise<AuditoriaCaixaPreferences> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readonly");
  const store = transaction.objectStore(STORE_PREFS);
  const result = await requestToPromise(store.get(prefsKey(userId)));
  await transactionDone(transaction);

  if (!result || typeof result !== "object") {
    return createDefaultPreferences();
  }

  const payload = (result as { value?: Partial<AuditoriaCaixaPreferences> }).value;
  return {
    cd_ativo: typeof payload?.cd_ativo === "number" && Number.isFinite(payload.cd_ativo)
      ? Math.trunc(payload.cd_ativo)
      : null,
    prefer_offline_mode: Boolean(payload?.prefer_offline_mode)
  };
}

export async function saveAuditoriaCaixaPreferences(userId: string, preferences: AuditoriaCaixaPreferences): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readwrite");
  const store = transaction.objectStore(STORE_PREFS);

  store.put({
    key: prefsKey(userId),
    value: {
      cd_ativo: preferences.cd_ativo,
      prefer_offline_mode: Boolean(preferences.prefer_offline_mode)
    }
  });

  await transactionDone(transaction);
}

export async function cleanupExpiredAuditoriaCaixaRows(userId: string, ttlMs = ONE_DAY_MS): Promise<number> {
  const db = await getDb();
  const transaction = db.transaction(STORE_CAIXA_ROWS, "readwrite");
  const store = transaction.objectStore(STORE_CAIXA_ROWS);
  const index = store.index(INDEX_ROWS_BY_USER);
  const request = index.openCursor(IDBKeyRange.only(userId));
  const threshold = Date.now() - Math.max(ttlMs, 60_000);
  let removed = 0;

  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar auditorias de caixa expiradas."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      const row = cursor.value as AuditoriaCaixaRow;
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

export async function clearUserAuditoriaCaixaSessionCache(userId: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction([STORE_DB_ROTAS, STORE_META, STORE_CAIXA_ROWS, STORE_PREFS], "readwrite");
  const routeStore = transaction.objectStore(STORE_DB_ROTAS);
  const routeIndex = routeStore.index(INDEX_ROTAS_BY_USER);
  const rowStore = transaction.objectStore(STORE_CAIXA_ROWS);
  const rowIndex = rowStore.index(INDEX_ROWS_BY_USER);
  const metaStore = transaction.objectStore(STORE_META);
  const prefStore = transaction.objectStore(STORE_PREFS);
  const routeRequest = routeIndex.openCursor(IDBKeyRange.only(userId));
  const rowRequest = rowIndex.openCursor(IDBKeyRange.only(userId));

  await new Promise<void>((resolve, reject) => {
    routeRequest.onerror = () => reject(routeRequest.error ?? new Error("Falha ao limpar cache de rotas do módulo."));
    routeRequest.onsuccess = () => {
      const cursor = routeRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  });

  await new Promise<void>((resolve, reject) => {
    rowRequest.onerror = () => reject(rowRequest.error ?? new Error("Falha ao limpar sessão do módulo Auditoria de Caixa."));
    rowRequest.onsuccess = () => {
      const cursor = rowRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  });

  const metaRequest = metaStore.openCursor();
  await new Promise<void>((resolve, reject) => {
    metaRequest.onerror = () => reject(metaRequest.error ?? new Error("Falha ao limpar metadados do módulo."));
    metaRequest.onsuccess = () => {
      const cursor = metaRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      const key = String((cursor.value as { key?: string }).key ?? "");
      if (key.includes(`:${userId}:`)) {
        cursor.delete();
      }
      cursor.continue();
    };
  });

  prefStore.delete(prefsKey(userId));
  await transactionDone(transaction);
  dbPromise = null;
}
