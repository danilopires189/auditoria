import type { ClvPendingOperation, ClvPreferences } from "./types";

const DB_NAME = "controle-logistico-volume-v1";
const DB_VERSION = 1;
const STORE_PENDING = "pending_ops";
const STORE_PREFS = "prefs";
const INDEX_PENDING_BY_USER = "by_user";
const PREFS_PREFIX = "prefs";

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

let dbPromise: Promise<IDBDatabase> | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
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

      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        const store = db.createObjectStore(STORE_PENDING, { keyPath: "local_id" });
        store.createIndex(INDEX_PENDING_BY_USER, "user_id", { unique: false });
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

function prefsKey(userId: string): string {
  return `${PREFS_PREFIX}:${userId}`;
}

function defaultPrefs(): ClvPreferences {
  return {
    cd_ativo: null,
    prefer_offline_mode: false
  };
}

function sortPending(rows: ClvPendingOperation[]): ClvPendingOperation[] {
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function saveClvPendingOperation(operation: ClvPendingOperation): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PENDING, "readwrite");
  transaction.objectStore(STORE_PENDING).put(operation);
  await transactionDone(transaction);
}

export async function removeClvPendingOperation(localId: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PENDING, "readwrite");
  transaction.objectStore(STORE_PENDING).delete(localId);
  await transactionDone(transaction);
}

export async function listClvPendingOperations(userId: string): Promise<ClvPendingOperation[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PENDING, "readonly");
  const index = transaction.objectStore(STORE_PENDING).index(INDEX_PENDING_BY_USER);
  const rows = (await requestToPromise(index.getAll(userId))) as ClvPendingOperation[];
  await transactionDone(transaction);
  return sortPending(rows ?? []);
}

export async function countClvPendingOperations(userId: string): Promise<{ pending_count: number; error_count: number }> {
  const rows = await listClvPendingOperations(userId);
  return {
    pending_count: rows.length,
    error_count: rows.filter((row) => row.sync_status === "error").length
  };
}

export async function getClvPreferences(userId: string): Promise<ClvPreferences> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readonly");
  const result = await requestToPromise(transaction.objectStore(STORE_PREFS).get(prefsKey(userId)));
  await transactionDone(transaction);

  const payload = (result as { value?: Partial<ClvPreferences> } | undefined)?.value;
  if (!payload) return defaultPrefs();
  return {
    cd_ativo: typeof payload.cd_ativo === "number" && Number.isFinite(payload.cd_ativo) ? Math.trunc(payload.cd_ativo) : null,
    prefer_offline_mode: Boolean(payload.prefer_offline_mode)
  };
}

export async function saveClvPreferences(userId: string, preferences: ClvPreferences): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readwrite");
  transaction.objectStore(STORE_PREFS).put({
    key: prefsKey(userId),
    value: preferences
  });
  await transactionDone(transaction);
}

export async function clearUserClvSessionCache(userId: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction([STORE_PENDING, STORE_PREFS], "readwrite");
  const pendingStore = transaction.objectStore(STORE_PENDING);
  const index = pendingStore.index(INDEX_PENDING_BY_USER);
  const request = index.openCursor(IDBKeyRange.only(userId));

  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar pendências locais."));
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

  transaction.objectStore(STORE_PREFS).delete(prefsKey(userId));
  await transactionDone(transaction);
  dbPromise = null;
}
