import type {
  InventarioCountRow,
  InventarioLocalStateCache,
  InventarioLockRow,
  InventarioManifestItemRow,
  InventarioManifestMeta,
  InventarioPendingEvent,
  InventarioPreferences,
  InventarioReviewRow,
  InventarioSyncPullState
} from "./types";

const DB_NAME = "auditoria-inventario-v1";
const DB_VERSION = 1;

const STORE_MANIFEST_ITEMS = "manifest_items";
const STORE_MANIFEST_META = "manifest_meta";
const STORE_REMOTE_STATE_CACHE = "remote_state_cache";
const STORE_PENDING_EVENTS = "pending_events";
const STORE_PREFS = "prefs";

const INDEX_ITEMS_BY_USER = "by_user";
const INDEX_ITEMS_BY_USER_CD = "by_user_cd";
const INDEX_ITEMS_BY_USER_CD_ZONA = "by_user_cd_zona";
const INDEX_META_BY_USER = "by_user";
const INDEX_META_BY_USER_CD = "by_user_cd";
const INDEX_STATE_BY_USER = "by_user";
const INDEX_STATE_BY_USER_CD_CYCLE = "by_user_cd_cycle";
const INDEX_PENDING_BY_USER = "by_user";
const INDEX_PENDING_BY_USER_CD_CYCLE = "by_user_cd_cycle";
const INDEX_PENDING_BY_STATUS = "by_status";

interface ManifestItemStoreRow extends InventarioManifestItemRow {
  key: string;
  user_id: string;
}

interface ManifestMetaStoreRow extends InventarioManifestMeta {
  key: string;
  user_id: string;
  cached_at: string;
}

interface LocalStateStoreRow extends InventarioLocalStateCache {}

interface PendingEventStoreRow extends InventarioPendingEvent {}

interface PrefStoreRow {
  key: string;
  value: InventarioPreferences;
}

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

function parsePositiveInt(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed >= 0 ? parsed : fallback;
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

function normalizePreferences(value: Partial<InventarioPreferences> | null | undefined): InventarioPreferences {
  return {
    cd_ativo:
      typeof value?.cd_ativo === "number" && Number.isFinite(value.cd_ativo)
        ? Math.trunc(value.cd_ativo)
        : null,
    prefer_offline_mode: Boolean(value?.prefer_offline_mode)
  };
}

function prefsKey(userId: string): string {
  return `prefs:${userId}`;
}

function manifestMetaKey(userId: string, cd: number): string {
  return `manifest_meta:${userId}:${cd}`;
}

function manifestItemKey(userId: string, cd: number, zona: string, endereco: string, coddv: number): string {
  return `manifest_item:${userId}:${cd}:${zona}:${endereco}:${coddv}`;
}

function remoteStateKey(userId: string, cd: number, cycleDate: string): string {
  return `remote_state:${userId}:${cd}:${cycleDate}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_MANIFEST_ITEMS)) {
        const store = db.createObjectStore(STORE_MANIFEST_ITEMS, { keyPath: "key" });
        store.createIndex(INDEX_ITEMS_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_ITEMS_BY_USER_CD, ["user_id", "cd"], { unique: false });
        store.createIndex(INDEX_ITEMS_BY_USER_CD_ZONA, ["user_id", "cd", "zona"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_MANIFEST_META)) {
        const store = db.createObjectStore(STORE_MANIFEST_META, { keyPath: "key" });
        store.createIndex(INDEX_META_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_META_BY_USER_CD, ["user_id", "cd"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_REMOTE_STATE_CACHE)) {
        const store = db.createObjectStore(STORE_REMOTE_STATE_CACHE, { keyPath: "key" });
        store.createIndex(INDEX_STATE_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_STATE_BY_USER_CD_CYCLE, ["user_id", "cd", "cycle_date"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_PENDING_EVENTS)) {
        const store = db.createObjectStore(STORE_PENDING_EVENTS, { keyPath: "event_id" });
        store.createIndex(INDEX_PENDING_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_PENDING_BY_USER_CD_CYCLE, ["user_id", "cd", "cycle_date"], { unique: false });
        store.createIndex(INDEX_PENDING_BY_STATUS, "status", { unique: false });
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

async function clearByUserCd(
  storeName: string,
  indexName: string,
  userId: string,
  cd: number
): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  const index = store.index(indexName);
  const request = index.openCursor(IDBKeyRange.only([userId, cd]));

  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar dados por CD."));
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

  await transactionDone(transaction);
}

async function clearByUserCdCycle(
  storeName: string,
  indexName: string,
  userId: string,
  cd: number,
  cycleDate: string
): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  const index = store.index(indexName);
  const request = index.openCursor(IDBKeyRange.only([userId, cd, cycleDate]));

  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar dados por ciclo."));
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

  await transactionDone(transaction);
}

async function clearByUser(storeName: string, indexName: string, userId: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  const index = store.index(indexName);
  const request = index.openCursor(IDBKeyRange.only(userId));

  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar dados por usuário."));
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

  await transactionDone(transaction);
}

export async function getInventarioPreferences(userId: string): Promise<InventarioPreferences> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readonly");
  const store = transaction.objectStore(STORE_PREFS);
  const raw = await requestToPromise(store.get(prefsKey(userId)));
  await transactionDone(transaction);
  const payload = (raw as PrefStoreRow | undefined)?.value;
  return normalizePreferences(payload);
}

export async function saveInventarioPreferences(userId: string, value: InventarioPreferences): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readwrite");
  const store = transaction.objectStore(STORE_PREFS);
  const payload: PrefStoreRow = {
    key: prefsKey(userId),
    value: normalizePreferences(value)
  };
  store.put(payload);
  await transactionDone(transaction);
}

export async function getManifestMetaLocal(userId: string, cd: number): Promise<InventarioManifestMeta | null> {
  const db = await getDb();
  const transaction = db.transaction(STORE_MANIFEST_META, "readonly");
  const store = transaction.objectStore(STORE_MANIFEST_META);
  const raw = await requestToPromise(store.get(manifestMetaKey(userId, cd)));
  await transactionDone(transaction);
  if (!raw || typeof raw !== "object") return null;

  const row = raw as ManifestMetaStoreRow;
  return {
    cd: row.cd,
    row_count: row.row_count,
    zonas_count: row.zonas_count,
    source_run_id: row.source_run_id,
    manifest_hash: row.manifest_hash,
    generated_at: row.generated_at
  };
}

export async function saveManifestSnapshot(params: {
  user_id: string;
  cd: number;
  meta: InventarioManifestMeta;
  items: InventarioManifestItemRow[];
}): Promise<void> {
  await clearByUserCd(STORE_MANIFEST_ITEMS, INDEX_ITEMS_BY_USER_CD, params.user_id, params.cd);

  {
    const db = await getDb();
    const transaction = db.transaction(STORE_MANIFEST_ITEMS, "readwrite");
    const itemsStore = transaction.objectStore(STORE_MANIFEST_ITEMS);

    for (const row of params.items) {
      const zona = String(row.zona ?? "").trim().toUpperCase();
      const endereco = String(row.endereco ?? "").trim().toUpperCase();
      const coddv = parsePositiveInt(row.coddv, 0);
      if (!zona || !endereco || coddv <= 0) continue;

      const payload: ManifestItemStoreRow = {
        key: manifestItemKey(params.user_id, params.cd, zona, endereco, coddv),
        user_id: params.user_id,
        cd: params.cd,
        zona,
        endereco,
        coddv,
        descricao: String(row.descricao ?? "").trim() || `CODDV ${coddv}`,
        estoque: parsePositiveInt(row.estoque, 0)
      };
      itemsStore.put(payload);
    }

    await transactionDone(transaction);
  }

  {
    const db = await getDb();
    const transaction = db.transaction(STORE_MANIFEST_META, "readwrite");
    const metaStore = transaction.objectStore(STORE_MANIFEST_META);
    const payload: ManifestMetaStoreRow = {
      key: manifestMetaKey(params.user_id, params.cd),
      user_id: params.user_id,
      cd: params.meta.cd,
      row_count: parsePositiveInt(params.meta.row_count, 0),
      zonas_count: parsePositiveInt(params.meta.zonas_count, 0),
      source_run_id: parseNullableString(params.meta.source_run_id),
      manifest_hash: String(params.meta.manifest_hash ?? ""),
      generated_at: String(params.meta.generated_at ?? new Date().toISOString()),
      cached_at: new Date().toISOString()
    };
    metaStore.put(payload);
    await transactionDone(transaction);
  }
}

export async function listManifestItemsByCd(userId: string, cd: number): Promise<InventarioManifestItemRow[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_MANIFEST_ITEMS, "readonly");
  const store = transaction.objectStore(STORE_MANIFEST_ITEMS);
  const index = store.index(INDEX_ITEMS_BY_USER_CD);
  const rows = (await requestToPromise(index.getAll(IDBKeyRange.only([userId, cd])))) as ManifestItemStoreRow[];
  await transactionDone(transaction);

  return (rows ?? [])
    .map((row) => ({
      cd: row.cd,
      zona: row.zona,
      endereco: row.endereco,
      coddv: row.coddv,
      descricao: row.descricao,
      estoque: row.estoque
    }))
    .sort((a, b) => {
      const byZona = a.zona.localeCompare(b.zona);
      if (byZona !== 0) return byZona;
      const byEndereco = a.endereco.localeCompare(b.endereco);
      if (byEndereco !== 0) return byEndereco;
      return a.coddv - b.coddv;
    });
}

export async function listManifestZonesByCd(userId: string, cd: number): Promise<string[]> {
  const rows = await listManifestItemsByCd(userId, cd);
  const unique = new Set<string>();
  for (const row of rows) {
    if (row.zona) unique.add(row.zona);
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

export async function getRemoteStateCache(
  userId: string,
  cd: number,
  cycleDate: string
): Promise<InventarioSyncPullState | null> {
  const db = await getDb();
  const transaction = db.transaction(STORE_REMOTE_STATE_CACHE, "readonly");
  const store = transaction.objectStore(STORE_REMOTE_STATE_CACHE);
  const raw = await requestToPromise(store.get(remoteStateKey(userId, cd, cycleDate)));
  await transactionDone(transaction);
  if (!raw || typeof raw !== "object") return null;

  const row = raw as LocalStateStoreRow;
  return {
    counts: Array.isArray(row.counts) ? row.counts : [],
    reviews: Array.isArray(row.reviews) ? row.reviews : [],
    locks: Array.isArray(row.locks) ? row.locks : [],
    server_time: parseNullableString(row.server_time)
  };
}

export async function saveRemoteStateCache(params: {
  user_id: string;
  cd: number;
  cycle_date: string;
  state: InventarioSyncPullState;
}): Promise<void> {
  await clearByUserCdCycle(
    STORE_REMOTE_STATE_CACHE,
    INDEX_STATE_BY_USER_CD_CYCLE,
    params.user_id,
    params.cd,
    params.cycle_date
  );

  const db = await getDb();
  const transaction = db.transaction(STORE_REMOTE_STATE_CACHE, "readwrite");
  const store = transaction.objectStore(STORE_REMOTE_STATE_CACHE);

  const payload: LocalStateStoreRow = {
    key: remoteStateKey(params.user_id, params.cd, params.cycle_date),
    user_id: params.user_id,
    cd: params.cd,
    cycle_date: params.cycle_date,
    counts: params.state.counts,
    reviews: params.state.reviews,
    locks: params.state.locks,
    server_time: parseNullableString(params.state.server_time),
    updated_at: new Date().toISOString()
  };

  store.put(payload);
  await transactionDone(transaction);
}

export async function queuePendingEvent(event: InventarioPendingEvent): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PENDING_EVENTS, "readwrite");
  const store = transaction.objectStore(STORE_PENDING_EVENTS);
  const payload: PendingEventStoreRow = {
    ...event,
    status: event.status,
    attempt_count: parsePositiveInt(event.attempt_count, 0),
    updated_at: event.updated_at || new Date().toISOString()
  };
  store.put(payload);
  await transactionDone(transaction);
}

export async function listPendingEventsByCycle(
  userId: string,
  cd: number,
  cycleDate: string
): Promise<InventarioPendingEvent[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PENDING_EVENTS, "readonly");
  const store = transaction.objectStore(STORE_PENDING_EVENTS);
  const index = store.index(INDEX_PENDING_BY_USER_CD_CYCLE);
  const rows = (await requestToPromise(
    index.getAll(IDBKeyRange.only([userId, cd, cycleDate]))
  )) as PendingEventStoreRow[];
  await transactionDone(transaction);

  return (rows ?? [])
    .filter((row) => row.status === "pending" || row.status === "error")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function countPendingEventsByCycle(userId: string, cd: number, cycleDate: string): Promise<number> {
  const rows = await listPendingEventsByCycle(userId, cd, cycleDate);
  return rows.length;
}

export async function updatePendingEventStatus(params: {
  event_id: string;
  status: "pending" | "error";
  error_message?: string | null;
  increment_attempt?: boolean;
}): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PENDING_EVENTS, "readwrite");
  const store = transaction.objectStore(STORE_PENDING_EVENTS);
  const raw = await requestToPromise(store.get(params.event_id));
  if (!raw || typeof raw !== "object") {
    await transactionDone(transaction);
    return;
  }

  const row = raw as PendingEventStoreRow;
  const nextAttempt = params.increment_attempt ? row.attempt_count + 1 : row.attempt_count;
  store.put({
    ...row,
    status: params.status,
    attempt_count: parsePositiveInt(nextAttempt, 0),
    error_message: parseNullableString(params.error_message),
    updated_at: new Date().toISOString()
  });
  await transactionDone(transaction);
}

export async function removePendingEvent(eventId: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PENDING_EVENTS, "readwrite");
  const store = transaction.objectStore(STORE_PENDING_EVENTS);
  store.delete(eventId);
  await transactionDone(transaction);
}

export async function clearUserInventarioSessionCache(userId: string): Promise<void> {
  await clearByUser(STORE_MANIFEST_ITEMS, INDEX_ITEMS_BY_USER, userId);
  await clearByUser(STORE_MANIFEST_META, INDEX_META_BY_USER, userId);
  await clearByUser(STORE_REMOTE_STATE_CACHE, INDEX_STATE_BY_USER, userId);
  await clearByUser(STORE_PENDING_EVENTS, INDEX_PENDING_BY_USER, userId);

  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readwrite");
  transaction.objectStore(STORE_PREFS).delete(prefsKey(userId));
  await transactionDone(transaction);
}
