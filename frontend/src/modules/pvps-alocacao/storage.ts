import type {
  AlocacaoManifestRow,
  PvpsAlocOfflineEventKind,
  PvpsAlocOfflineEventRow,
  PvpsAlocOfflineEventStatus,
  PvpsAlocOfflinePreferences,
  PvpsAlocOfflineSnapshot,
  PvpsEndSit,
  PvpsManifestRow,
  PvpsPulItemRow
} from "./types";

const DB_NAME = "auditoria-pvps-aloc-offline-v2";
const DB_VERSION = 2;

const STORE_PREFS = "prefs";
const STORE_EVENTS = "offline_events";
const STORE_PVPS_SNAPSHOT = "manifest_pvps_snapshot";
const STORE_ALOC_SNAPSHOT = "manifest_aloc_snapshot";
const STORE_PUL_SNAPSHOT = "manifest_pul_snapshot";
const STORE_SEP_CACHE = "pvps_offline_sep_cache";

const INDEX_EVENTS_BY_USER_CD = "by_user_cd";
const INDEX_EVENTS_BY_USER_CD_STATUS = "by_user_cd_status";
const INDEX_EVENTS_BY_STATUS = "by_status";
const INDEX_SEP_CACHE_BY_USER_CD = "by_user_cd";

interface PrefStoreRow {
  key: string;
  value: PvpsAlocOfflinePreferences;
}

interface EventsStoreRow extends PvpsAlocOfflineEventRow {}

interface PvpsSnapshotStoreRow {
  key: string;
  user_id: string;
  cd: number;
  rows: PvpsManifestRow[];
  cached_at: string;
}

interface AlocSnapshotStoreRow {
  key: string;
  user_id: string;
  cd: number;
  rows: AlocacaoManifestRow[];
  cached_at: string;
}

interface PulSnapshotStoreRow {
  key: string;
  user_id: string;
  cd: number;
  rows: Record<string, PvpsPulItemRow[]>;
  cached_at: string;
}

export interface PvpsOfflineSepCacheRow {
  key: string;
  user_id: string;
  cd: number;
  coddv: number;
  end_sep: string;
  end_sit: PvpsEndSit | null;
  val_sep: string | null;
  saved_at: string;
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

function normalizeAddress(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizePrefs(value: Partial<PvpsAlocOfflinePreferences> | null | undefined): PvpsAlocOfflinePreferences {
  return {
    prefer_offline_mode: Boolean(value?.prefer_offline_mode)
  };
}

function toCd(value: number): number {
  return Math.trunc(value);
}

function prefsKey(userId: string): string {
  return `prefs:${userId}`;
}

function pvpsSnapshotKey(userId: string, cd: number): string {
  return `pvps_snapshot:${userId}:${toCd(cd)}`;
}

function alocSnapshotKey(userId: string, cd: number): string {
  return `aloc_snapshot:${userId}:${toCd(cd)}`;
}

function pulSnapshotKey(userId: string, cd: number): string {
  return `pul_snapshot:${userId}:${toCd(cd)}`;
}

function sepCacheKey(userId: string, cd: number, coddv: number, endSep: string): string {
  return `${userId}|${toCd(cd)}|${toCd(coddv)}|${normalizeAddress(endSep)}`;
}

function sepEventKey(userId: string, cd: number, coddv: number, endSep: string): string {
  return `sep|${userId}|${toCd(cd)}|${toCd(coddv)}|${normalizeAddress(endSep)}`;
}

function pulEventKey(userId: string, cd: number, coddv: number, endSep: string, endPul: string): string {
  return `pul|${userId}|${toCd(cd)}|${toCd(coddv)}|${normalizeAddress(endSep)}|${normalizeAddress(endPul)}`;
}

function alocEventKey(userId: string, cd: number, queueId: string): string {
  return `alocacao|${userId}|${toCd(cd)}|${queueId}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    throw new Error("IndexedDB indisponivel neste ambiente.");
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_PREFS)) {
        db.createObjectStore(STORE_PREFS, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const store = db.createObjectStore(STORE_EVENTS, { keyPath: "event_id" });
        store.createIndex(INDEX_EVENTS_BY_USER_CD, ["user_id", "cd"], { unique: false });
        store.createIndex(INDEX_EVENTS_BY_USER_CD_STATUS, ["user_id", "cd", "status"], { unique: false });
        store.createIndex(INDEX_EVENTS_BY_STATUS, "status", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_PVPS_SNAPSHOT)) {
        db.createObjectStore(STORE_PVPS_SNAPSHOT, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORE_ALOC_SNAPSHOT)) {
        db.createObjectStore(STORE_ALOC_SNAPSHOT, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORE_PUL_SNAPSHOT)) {
        db.createObjectStore(STORE_PUL_SNAPSHOT, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORE_SEP_CACHE)) {
        const store = db.createObjectStore(STORE_SEP_CACHE, { keyPath: "key" });
        store.createIndex(INDEX_SEP_CACHE_BY_USER_CD, ["user_id", "cd"], { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir IndexedDB do PVPS/Alocacao offline."));
  });

  return dbPromise;
}

export async function getPvpsAlocPrefs(userId: string): Promise<PvpsAlocOfflinePreferences> {
  const db = await getDb();
  const tx = db.transaction(STORE_PREFS, "readonly");
  const raw = await requestToPromise(tx.objectStore(STORE_PREFS).get(prefsKey(userId)));
  await transactionDone(tx);
  return normalizePrefs((raw as PrefStoreRow | undefined)?.value);
}

export async function savePvpsAlocPrefs(userId: string, value: PvpsAlocOfflinePreferences): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_PREFS, "readwrite");
  tx.objectStore(STORE_PREFS).put({
    key: prefsKey(userId),
    value: normalizePrefs(value)
  } satisfies PrefStoreRow);
  await transactionDone(tx);
}

export async function saveOfflineSnapshot(params: {
  user_id: string;
  cd: number;
  pvps_rows: PvpsManifestRow[];
  aloc_rows: AlocacaoManifestRow[];
  pul_by_sep_key: Record<string, PvpsPulItemRow[]>;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const cd = toCd(params.cd);
  const db = await getDb();
  const tx = db.transaction([STORE_PVPS_SNAPSHOT, STORE_ALOC_SNAPSHOT, STORE_PUL_SNAPSHOT], "readwrite");

  tx.objectStore(STORE_PVPS_SNAPSHOT).put({
    key: pvpsSnapshotKey(params.user_id, cd),
    user_id: params.user_id,
    cd,
    rows: params.pvps_rows,
    cached_at: nowIso
  } satisfies PvpsSnapshotStoreRow);

  tx.objectStore(STORE_ALOC_SNAPSHOT).put({
    key: alocSnapshotKey(params.user_id, cd),
    user_id: params.user_id,
    cd,
    rows: params.aloc_rows,
    cached_at: nowIso
  } satisfies AlocSnapshotStoreRow);

  tx.objectStore(STORE_PUL_SNAPSHOT).put({
    key: pulSnapshotKey(params.user_id, cd),
    user_id: params.user_id,
    cd,
    rows: params.pul_by_sep_key,
    cached_at: nowIso
  } satisfies PulSnapshotStoreRow);

  await transactionDone(tx);
}

export async function loadOfflineSnapshot(userId: string, cd: number): Promise<PvpsAlocOfflineSnapshot | null> {
  const normalizedCd = toCd(cd);
  const db = await getDb();
  const tx = db.transaction([STORE_PVPS_SNAPSHOT, STORE_ALOC_SNAPSHOT, STORE_PUL_SNAPSHOT], "readonly");
  const pvpsRaw = await requestToPromise(tx.objectStore(STORE_PVPS_SNAPSHOT).get(pvpsSnapshotKey(userId, normalizedCd)));
  const alocRaw = await requestToPromise(tx.objectStore(STORE_ALOC_SNAPSHOT).get(alocSnapshotKey(userId, normalizedCd)));
  const pulRaw = await requestToPromise(tx.objectStore(STORE_PUL_SNAPSHOT).get(pulSnapshotKey(userId, normalizedCd)));
  await transactionDone(tx);

  const pvps = (pvpsRaw as PvpsSnapshotStoreRow | undefined) ?? null;
  const aloc = (alocRaw as AlocSnapshotStoreRow | undefined) ?? null;
  const pul = (pulRaw as PulSnapshotStoreRow | undefined) ?? null;

  if (!pvps || !aloc || !pul) return null;

  return {
    user_id: userId,
    cd: normalizedCd,
    pvps_rows: Array.isArray(pvps.rows) ? pvps.rows : [],
    aloc_rows: Array.isArray(aloc.rows) ? aloc.rows : [],
    pul_by_sep_key: pul.rows ?? {},
    cached_at: pvps.cached_at ?? aloc.cached_at ?? pul.cached_at ?? new Date().toISOString()
  };
}

export async function hasOfflineSnapshot(userId: string, cd: number): Promise<boolean> {
  return (await loadOfflineSnapshot(userId, cd)) != null;
}

export async function queueOfflineEvent(input: {
  user_id: string;
  cd: number;
  kind: PvpsAlocOfflineEventKind;
  coddv: number;
  zona?: string | null;
  end_sep?: string | null;
  end_pul?: string | null;
  queue_id?: string | null;
  end_sit?: PvpsEndSit | null;
  val_sep?: string | null;
  val_pul?: string | null;
  val_conf?: string | null;
  audit_id?: string | null;
}): Promise<PvpsAlocOfflineEventRow> {
  const cd = toCd(input.cd);
  const coddv = toCd(input.coddv);
  const endSep = normalizeAddress(input.end_sep);
  const endPul = normalizeAddress(input.end_pul);
  const queueId = String(input.queue_id ?? "").trim();

  const eventId = input.kind === "sep"
    ? sepEventKey(input.user_id, cd, coddv, endSep)
    : input.kind === "pul"
      ? pulEventKey(input.user_id, cd, coddv, endSep, endPul)
      : alocEventKey(input.user_id, cd, queueId);

  const nowIso = new Date().toISOString();

  const row: PvpsAlocOfflineEventRow = {
    event_id: eventId,
    user_id: input.user_id,
    cd,
    kind: input.kind,
    status: "pending",
    attempt_count: 0,
    error_message: null,
    coddv,
    zona: normalizeAddress(input.zona) || null,
    end_sep: endSep || null,
    end_pul: endPul || null,
    queue_id: queueId || null,
    end_sit: input.end_sit ?? null,
    val_sep: input.val_sep ?? null,
    val_pul: input.val_pul ?? null,
    val_conf: input.val_conf ?? null,
    audit_id: input.audit_id ?? null,
    created_at: nowIso,
    updated_at: nowIso
  };

  const db = await getDb();
  const tx = db.transaction(STORE_EVENTS, "readwrite");
  tx.objectStore(STORE_EVENTS).put(row as EventsStoreRow);
  await transactionDone(tx);
  return row;
}

export async function listPendingOfflineEvents(userId: string, cd: number): Promise<PvpsAlocOfflineEventRow[]> {
  const db = await getDb();
  const tx = db.transaction(STORE_EVENTS, "readonly");
  const index = tx.objectStore(STORE_EVENTS).index(INDEX_EVENTS_BY_USER_CD);
  const raw = await requestToPromise(index.getAll(IDBKeyRange.only([userId, toCd(cd)])));
  await transactionDone(tx);

  const rows = ((raw as EventsStoreRow[] | undefined) ?? [])
    .filter((row) => row.status === "pending" || row.status === "error");

  const order: Record<PvpsAlocOfflineEventKind, number> = { sep: 0, pul: 1, alocacao: 2 };
  rows.sort((a, b) => {
    const byKind = order[a.kind] - order[b.kind];
    if (byKind !== 0) return byKind;
    return a.created_at.localeCompare(b.created_at);
  });

  return rows;
}

export async function countPendingOfflineEvents(userId: string, cd: number): Promise<number> {
  return (await listPendingOfflineEvents(userId, cd)).length;
}

export async function countErrorOfflineEvents(userId: string, cd: number): Promise<number> {
  const rows = await listPendingOfflineEvents(userId, cd);
  return rows.filter((row) => row.status === "error").length;
}

export async function updateOfflineEventStatus(params: {
  event_id: string;
  status: PvpsAlocOfflineEventStatus;
  error_message?: string | null;
  increment_attempt?: boolean;
}): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_EVENTS, "readwrite");
  const store = tx.objectStore(STORE_EVENTS);
  const raw = await requestToPromise(store.get(params.event_id));
  const row = (raw as EventsStoreRow | undefined) ?? null;
  if (row) {
    row.status = params.status;
    row.error_message = params.error_message ?? null;
    row.updated_at = new Date().toISOString();
    if (params.increment_attempt) {
      row.attempt_count = Math.max(0, row.attempt_count) + 1;
    }
    store.put(row);
  }
  await transactionDone(tx);
}

export async function removeOfflineEvent(eventId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_EVENTS, "readwrite");
  tx.objectStore(STORE_EVENTS).delete(eventId);
  await transactionDone(tx);
}

export async function saveOfflineSepEvent(params: {
  user_id: string;
  cd: number;
  coddv: number;
  end_sep: string;
  end_sit?: PvpsEndSit | null;
  val_sep?: string | null;
}): Promise<PvpsAlocOfflineEventRow> {
  return queueOfflineEvent({
    user_id: params.user_id,
    cd: params.cd,
    kind: "sep",
    coddv: params.coddv,
    end_sep: params.end_sep,
    end_sit: params.end_sit ?? null,
    val_sep: params.val_sep ?? null
  });
}

export async function saveOfflinePulEvent(params: {
  user_id: string;
  cd: number;
  coddv: number;
  end_sep: string;
  end_pul: string;
  end_sit?: PvpsEndSit | null;
  val_pul?: string | null;
  audit_id?: string | null;
}): Promise<PvpsAlocOfflineEventRow> {
  return queueOfflineEvent({
    user_id: params.user_id,
    cd: params.cd,
    kind: "pul",
    coddv: params.coddv,
    end_sep: params.end_sep,
    end_pul: params.end_pul,
    end_sit: params.end_sit ?? null,
    val_pul: params.val_pul ?? null,
    audit_id: params.audit_id ?? null
  });
}

export async function saveOfflineAlocacaoEvent(params: {
  user_id: string;
  cd: number;
  queue_id: string;
  coddv: number;
  zona: string;
  end_sit?: PvpsEndSit | null;
  val_conf?: string | null;
}): Promise<PvpsAlocOfflineEventRow> {
  return queueOfflineEvent({
    user_id: params.user_id,
    cd: params.cd,
    kind: "alocacao",
    coddv: params.coddv,
    queue_id: params.queue_id,
    zona: params.zona,
    end_sit: params.end_sit ?? null,
    val_conf: params.val_conf ?? null
  });
}

export async function upsertOfflineSepCache(params: {
  user_id: string;
  cd: number;
  coddv: number;
  end_sep: string;
  end_sit?: PvpsEndSit | null;
  val_sep?: string | null;
}): Promise<PvpsOfflineSepCacheRow> {
  const row: PvpsOfflineSepCacheRow = {
    key: sepCacheKey(params.user_id, params.cd, params.coddv, params.end_sep),
    user_id: params.user_id,
    cd: toCd(params.cd),
    coddv: toCd(params.coddv),
    end_sep: normalizeAddress(params.end_sep),
    end_sit: params.end_sit ?? null,
    val_sep: params.val_sep ?? null,
    saved_at: new Date().toISOString()
  };

  const db = await getDb();
  const tx = db.transaction(STORE_SEP_CACHE, "readwrite");
  tx.objectStore(STORE_SEP_CACHE).put(row);
  await transactionDone(tx);
  return row;
}

export async function hasOfflineSepCache(userId: string, cd: number, coddv: number, endSep: string): Promise<boolean> {
  const key = sepCacheKey(userId, cd, coddv, endSep);
  const db = await getDb();
  const tx = db.transaction(STORE_SEP_CACHE, "readonly");
  const raw = await requestToPromise(tx.objectStore(STORE_SEP_CACHE).get(key));
  await transactionDone(tx);
  return Boolean(raw);
}
