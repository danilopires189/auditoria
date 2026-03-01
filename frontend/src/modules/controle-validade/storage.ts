import type {
  ControleValidadeOfflineEventKind,
  ControleValidadeOfflineEventRow,
  ControleValidadeOfflineEventStatus,
  ControleValidadeOfflinePayload,
  ControleValidadeOfflineSnapshot,
  ControleValidadePreferences,
  LinhaColetaPayload,
  LinhaRetiradaPayload,
  PulRetiradaPayload
} from "./types";

const DB_NAME = "auditoria-controle-validade-v1";
const DB_VERSION = 1;

const STORE_PREFS = "prefs";
const STORE_EVENTS = "events";
const STORE_SNAPSHOTS = "snapshots";

const INDEX_EVENTS_BY_USER_CD = "by_user_cd";

interface PrefStoreRow {
  key: string;
  value: ControleValidadePreferences;
}

interface EventStoreRow extends ControleValidadeOfflineEventRow {}

interface SnapshotStoreRow {
  key: string;
  user_id: string;
  cd: number;
  linha_rows: ControleValidadeOfflineSnapshot["linha_rows"];
  pul_rows: ControleValidadeOfflineSnapshot["pul_rows"];
  cached_at: string;
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

function normalizeCd(value: number): number {
  const parsed = Math.trunc(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function defaultPreferences(): ControleValidadePreferences {
  return {
    prefer_offline_mode: false
  };
}

function prefsKey(userId: string): string {
  return `prefs:${userId}`;
}

function snapshotKey(userId: string, cd: number): string {
  return `snapshot:${userId}:${normalizeCd(cd)}`;
}

function toClientEventId(payload: ControleValidadeOfflinePayload): string {
  const raw = String((payload as { client_event_id?: unknown }).client_event_id ?? "").trim();
  return raw || `event:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function eventKey(
  userId: string,
  cd: number,
  kind: ControleValidadeOfflineEventKind,
  payload: ControleValidadeOfflinePayload
): string {
  return `${kind}|${userId}|${normalizeCd(cd)}|${toClientEventId(payload)}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    throw new Error("IndexedDB indisponível neste ambiente.");
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
      }

      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir IndexedDB do Controle de Validade."));
  });

  return dbPromise;
}

export async function getControleValidadePrefs(userId: string): Promise<ControleValidadePreferences> {
  const db = await getDb();
  const tx = db.transaction(STORE_PREFS, "readonly");
  const raw = await requestToPromise(tx.objectStore(STORE_PREFS).get(prefsKey(userId)));
  await transactionDone(tx);
  const parsed = (raw as PrefStoreRow | undefined)?.value;
  return {
    prefer_offline_mode: Boolean(parsed?.prefer_offline_mode)
  };
}

export async function saveControleValidadePrefs(userId: string, prefs: ControleValidadePreferences): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_PREFS, "readwrite");
  tx.objectStore(STORE_PREFS).put({
    key: prefsKey(userId),
    value: {
      prefer_offline_mode: Boolean(prefs.prefer_offline_mode)
    }
  } satisfies PrefStoreRow);
  await transactionDone(tx);
}

export async function saveOfflineSnapshot(params: {
  user_id: string;
  cd: number;
  linha_rows: ControleValidadeOfflineSnapshot["linha_rows"];
  pul_rows: ControleValidadeOfflineSnapshot["pul_rows"];
}): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_SNAPSHOTS, "readwrite");
  tx.objectStore(STORE_SNAPSHOTS).put({
    key: snapshotKey(params.user_id, params.cd),
    user_id: params.user_id,
    cd: normalizeCd(params.cd),
    linha_rows: Array.isArray(params.linha_rows) ? params.linha_rows : [],
    pul_rows: Array.isArray(params.pul_rows) ? params.pul_rows : [],
    cached_at: new Date().toISOString()
  } satisfies SnapshotStoreRow);
  await transactionDone(tx);
}

export async function loadOfflineSnapshot(userId: string, cd: number): Promise<ControleValidadeOfflineSnapshot | null> {
  const db = await getDb();
  const tx = db.transaction(STORE_SNAPSHOTS, "readonly");
  const raw = await requestToPromise(tx.objectStore(STORE_SNAPSHOTS).get(snapshotKey(userId, cd)));
  await transactionDone(tx);
  const row = (raw as SnapshotStoreRow | undefined) ?? null;
  if (!row) return null;
  return {
    user_id: row.user_id,
    cd: row.cd,
    linha_rows: Array.isArray(row.linha_rows) ? row.linha_rows : [],
    pul_rows: Array.isArray(row.pul_rows) ? row.pul_rows : [],
    cached_at: row.cached_at ?? new Date().toISOString()
  };
}

export async function hasOfflineSnapshot(userId: string, cd: number): Promise<boolean> {
  return (await loadOfflineSnapshot(userId, cd)) != null;
}

export async function queueOfflineEvent(input: {
  user_id: string;
  cd: number;
  kind: ControleValidadeOfflineEventKind;
  payload: ControleValidadeOfflinePayload;
}): Promise<ControleValidadeOfflineEventRow> {
  const nowIso = new Date().toISOString();
  const row: ControleValidadeOfflineEventRow = {
    event_id: eventKey(input.user_id, input.cd, input.kind, input.payload),
    user_id: input.user_id,
    cd: normalizeCd(input.cd),
    kind: input.kind,
    status: "pending",
    attempt_count: 0,
    error_message: null,
    payload: input.payload,
    created_at: nowIso,
    updated_at: nowIso
  };

  const db = await getDb();
  const tx = db.transaction(STORE_EVENTS, "readwrite");
  tx.objectStore(STORE_EVENTS).put(row as EventStoreRow);
  await transactionDone(tx);
  return row;
}

export async function listPendingOfflineEvents(userId: string, cd: number): Promise<ControleValidadeOfflineEventRow[]> {
  const db = await getDb();
  const tx = db.transaction(STORE_EVENTS, "readonly");
  const index = tx.objectStore(STORE_EVENTS).index(INDEX_EVENTS_BY_USER_CD);
  const raw = await requestToPromise(index.getAll(IDBKeyRange.only([userId, normalizeCd(cd)])));
  await transactionDone(tx);

  const rows = ((raw as EventStoreRow[] | undefined) ?? []).filter(
    (row) => row.status === "pending" || row.status === "error"
  );
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
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
  status: ControleValidadeOfflineEventStatus;
  error_message?: string | null;
  increment_attempt?: boolean;
}): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_EVENTS, "readwrite");
  const store = tx.objectStore(STORE_EVENTS);
  const raw = await requestToPromise(store.get(params.event_id));
  const row = (raw as EventStoreRow | undefined) ?? null;
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

export async function saveOfflineLinhaColetaEvent(params: {
  user_id: string;
  cd: number;
  payload: LinhaColetaPayload;
}): Promise<ControleValidadeOfflineEventRow> {
  return queueOfflineEvent({
    user_id: params.user_id,
    cd: params.cd,
    kind: "linha_coleta",
    payload: params.payload
  });
}

export async function saveOfflineLinhaRetiradaEvent(params: {
  user_id: string;
  cd: number;
  payload: LinhaRetiradaPayload;
}): Promise<ControleValidadeOfflineEventRow> {
  return queueOfflineEvent({
    user_id: params.user_id,
    cd: params.cd,
    kind: "linha_retirada",
    payload: params.payload
  });
}

export async function saveOfflinePulRetiradaEvent(params: {
  user_id: string;
  cd: number;
  payload: PulRetiradaPayload;
}): Promise<ControleValidadeOfflineEventRow> {
  return queueOfflineEvent({
    user_id: params.user_id,
    cd: params.cd,
    kind: "pul_retirada",
    payload: params.payload
  });
}

export async function clearUserControleValidadeCache(userId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([STORE_EVENTS, STORE_PREFS, STORE_SNAPSHOTS], "readwrite");
  const eventsStore = tx.objectStore(STORE_EVENTS);
  const eventsIndex = eventsStore.index(INDEX_EVENTS_BY_USER_CD);
  const request = eventsIndex.openCursor(IDBKeyRange.bound([userId, Number.MIN_SAFE_INTEGER], [userId, Number.MAX_SAFE_INTEGER]));

  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar eventos offline."));
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

  tx.objectStore(STORE_PREFS).delete(prefsKey(userId));
  const snapshotsStore = tx.objectStore(STORE_SNAPSHOTS);
  const snapRequest = snapshotsStore.openCursor();

  await new Promise<void>((resolve, reject) => {
    snapRequest.onerror = () => reject(snapRequest.error ?? new Error("Falha ao limpar snapshots offline."));
    snapRequest.onsuccess = () => {
      const cursor = snapRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      const value = cursor.value as SnapshotStoreRow;
      if (value.user_id === userId) {
        cursor.delete();
      }
      cursor.continue();
    };
  });

  await transactionDone(tx);
}

export function normalizeOfflinePayload<T extends ControleValidadeOfflinePayload>(payload: T): T {
  const parseInteger = (value: unknown, fallback = 0): number => {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const normalizeText = (value: unknown): string => String(value ?? "").trim();

  if ("endereco_sep" in payload && "barras" in payload) {
    return {
      ...payload,
      client_event_id: normalizeText(payload.client_event_id),
      cd: parseInteger(payload.cd, 0),
      barras: normalizeText(payload.barras),
      endereco_sep: normalizeText(payload.endereco_sep).toUpperCase(),
      val_mmaa: normalizeText(payload.val_mmaa),
      data_hr: payload.data_hr ? normalizeText(payload.data_hr) : null
    } as T;
  }

  if ("endereco_sep" in payload) {
    return {
      ...payload,
      client_event_id: normalizeText(payload.client_event_id),
      cd: parseInteger(payload.cd, 0),
      coddv: parseInteger(payload.coddv, 0),
      endereco_sep: normalizeText(payload.endereco_sep).toUpperCase(),
      val_mmaa: normalizeText(payload.val_mmaa),
      qtd_retirada: parseInteger(payload.qtd_retirada, 1),
      data_hr: payload.data_hr ? normalizeText(payload.data_hr) : null
    } as T;
  }

  return {
    ...payload,
    client_event_id: normalizeText(payload.client_event_id),
    cd: parseInteger(payload.cd, 0),
    coddv: parseInteger(payload.coddv, 0),
    endereco_pul: normalizeText(payload.endereco_pul).toUpperCase(),
    val_mmaa: normalizeText(payload.val_mmaa),
    qtd_retirada: parseInteger(payload.qtd_retirada, 1),
    data_hr: payload.data_hr ? normalizeText(payload.data_hr) : null
  } as T;
}

export function normalizePreferences(value: Partial<ControleValidadePreferences> | null | undefined): ControleValidadePreferences {
  if (!value) return defaultPreferences();
  return {
    prefer_offline_mode: Boolean(value.prefer_offline_mode)
  };
}
