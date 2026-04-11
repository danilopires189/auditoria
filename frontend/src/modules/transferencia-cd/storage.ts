import type {
  TransferenciaCdLocalConference,
  TransferenciaCdLocalItem,
  TransferenciaCdManifestBarrasRow,
  TransferenciaCdManifestItemRow,
  TransferenciaCdManifestMeta,
  TransferenciaCdNoteRow,
  TransferenciaCdPendingSummary,
  TransferenciaCdPreferences
} from "./types";

const DB_NAME = "auditoria-transferencia-cd-v1";
const DB_VERSION = 1;

const STORE_MANIFEST_ITEMS = "manifest_items";
const STORE_MANIFEST_BARRAS = "manifest_barras";
const STORE_MANIFEST_META = "manifest_meta";
const STORE_MANIFEST_NOTES = "manifest_notes";
const STORE_CONFERENCES = "conferences";
const STORE_PREFS = "prefs";

const INDEX_ITEMS_BY_USER_CD = "by_user_cd";
const INDEX_ITEMS_BY_USER_CD_NOTE = "by_user_cd_note";
const INDEX_ITEMS_BY_USER = "by_user";
const INDEX_BARRAS_BY_USER_CD = "by_user_cd";
const INDEX_BARRAS_BY_USER = "by_user";
const INDEX_META_BY_USER_CD = "by_user_cd";
const INDEX_META_BY_USER = "by_user";
const INDEX_NOTES_BY_USER_CD = "by_user_cd";
const INDEX_NOTES_BY_USER = "by_user";
const INDEX_CONFERENCES_BY_USER = "by_user";
const INDEX_CONFERENCES_BY_USER_CD = "by_user_cd";

interface ManifestItemStoreRow extends TransferenciaCdManifestItemRow {
  key: string;
  user_id: string;
  cd: number;
  note_key: string;
}

interface ManifestBarrasStoreRow extends TransferenciaCdManifestBarrasRow {
  key: string;
  user_id: string;
  cd: number;
}

interface ManifestMetaStoreRow extends TransferenciaCdManifestMeta {
  key: string;
  user_id: string;
  cached_at: string;
}

interface ManifestNoteStoreRow extends TransferenciaCdNoteRow {
  key: string;
  user_id: string;
  cd: number;
  note_key: string;
}

interface PrefStoreRow {
  key: string;
  value: TransferenciaCdPreferences;
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

function todayIsoBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function parsePositiveInt(value: unknown, fallback = 1): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed > 0 ? parsed : fallback;
}

function normalizePrefs(value: Partial<TransferenciaCdPreferences> | null | undefined): TransferenciaCdPreferences {
  return {
    prefer_offline_mode: Boolean(value?.prefer_offline_mode),
    multiplo_padrao: parsePositiveInt(value?.multiplo_padrao, 1),
    cd_ativo: typeof value?.cd_ativo === "number" && Number.isFinite(value.cd_ativo)
      ? Math.trunc(value.cd_ativo)
      : null
  };
}

export function buildTransferenciaCdNoteKey(note: Pick<TransferenciaCdNoteRow, "dt_nf" | "nf_trf" | "sq_nf" | "cd_ori" | "cd_des">): string {
  return `${note.dt_nf}|${note.nf_trf}|${note.sq_nf}|${note.cd_ori}|${note.cd_des}`;
}

export function buildTransferenciaCdConferenceKey(
  userId: string,
  cd: number,
  etapa: string,
  note: Pick<TransferenciaCdNoteRow, "dt_nf" | "nf_trf" | "sq_nf" | "cd_ori" | "cd_des">
): string {
  return `transferencia:${userId}:${cd}:${etapa}:${buildTransferenciaCdNoteKey(note)}`;
}

function prefsKey(userId: string): string {
  return `prefs:${userId}`;
}

function manifestMetaKey(userId: string, cd: number): string {
  return `manifest_meta:${userId}:${cd}`;
}

function manifestItemKey(userId: string, cd: number, noteKey: string, coddv: number): string {
  return `manifest_item:${userId}:${cd}:${noteKey}:${coddv}`;
}

function manifestBarrasKey(userId: string, cd: number, barras: string): string {
  return `manifest_barras:${userId}:${cd}:${barras}`;
}

function manifestNoteKey(userId: string, cd: number, noteKey: string): string {
  return `manifest_note:${userId}:${cd}:${noteKey}`;
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
        store.createIndex(INDEX_ITEMS_BY_USER_CD_NOTE, ["user_id", "cd", "note_key"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_MANIFEST_BARRAS)) {
        const store = db.createObjectStore(STORE_MANIFEST_BARRAS, { keyPath: "key" });
        store.createIndex(INDEX_BARRAS_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_BARRAS_BY_USER_CD, ["user_id", "cd"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_MANIFEST_META)) {
        const store = db.createObjectStore(STORE_MANIFEST_META, { keyPath: "key" });
        store.createIndex(INDEX_META_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_META_BY_USER_CD, ["user_id", "cd"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_MANIFEST_NOTES)) {
        const store = db.createObjectStore(STORE_MANIFEST_NOTES, { keyPath: "key" });
        store.createIndex(INDEX_NOTES_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_NOTES_BY_USER_CD, ["user_id", "cd"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_CONFERENCES)) {
        const store = db.createObjectStore(STORE_CONFERENCES, { keyPath: "local_key" });
        store.createIndex(INDEX_CONFERENCES_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_CONFERENCES_BY_USER_CD, ["user_id", "cd"], { unique: false });
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

async function clearByUserCd(storeName: string, indexName: string, userId: string, cd: number): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  const index = store.index(indexName);
  const request = index.openCursor(IDBKeyRange.only([userId, cd]));

  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar dados locais por CD."));
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

function sortLocalItems(rows: TransferenciaCdLocalItem[]): TransferenciaCdLocalItem[] {
  return [...rows].sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR") || a.coddv - b.coddv);
}

function normalizeLocalConference(row: TransferenciaCdLocalConference | null | undefined): TransferenciaCdLocalConference | null {
  if (!row) return null;
  const items = Array.isArray(row.items)
    ? row.items.map((item) => ({
      ...item,
      coddv: Number(item.coddv),
      qtd_esperada: Math.max(0, Number(item.qtd_esperada) || 0),
      qtd_conferida: Math.max(0, Number(item.qtd_conferida) || 0),
      ocorrencia_avariado_qtd: Math.max(0, Number(item.ocorrencia_avariado_qtd) || 0),
      ocorrencia_vencido_qtd: Math.max(0, Number(item.ocorrencia_vencido_qtd) || 0),
      updated_at: item.updated_at || new Date().toISOString()
    }))
    : [];
  return {
    ...row,
    items: sortLocalItems(items)
  };
}

function sortConferences(rows: TransferenciaCdLocalConference[]): TransferenciaCdLocalConference[] {
  return [...rows].sort((a, b) => {
    const aTime = Date.parse(a.updated_at || a.started_at || "");
    const bTime = Date.parse(b.updated_at || b.started_at || "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
    return b.local_key.localeCompare(a.local_key);
  });
}

export async function getTransferenciaCdPreferences(userId: string): Promise<TransferenciaCdPreferences> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readonly");
  const store = transaction.objectStore(STORE_PREFS);
  const raw = await requestToPromise(store.get(prefsKey(userId)));
  await transactionDone(transaction);
  return normalizePrefs((raw as PrefStoreRow | undefined)?.value);
}

export async function saveTransferenciaCdPreferences(userId: string, value: TransferenciaCdPreferences): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readwrite");
  const store = transaction.objectStore(STORE_PREFS);
  store.put({ key: prefsKey(userId), value: normalizePrefs(value) } satisfies PrefStoreRow);
  await transactionDone(transaction);
}

export async function getManifestMetaLocal(userId: string, cd: number): Promise<ManifestMetaStoreRow | null> {
  const db = await getDb();
  const transaction = db.transaction(STORE_MANIFEST_META, "readonly");
  const store = transaction.objectStore(STORE_MANIFEST_META);
  const raw = await requestToPromise(store.get(manifestMetaKey(userId, cd)));
  await transactionDone(transaction);
  return (raw as ManifestMetaStoreRow | undefined) ?? null;
}

export async function saveManifestSnapshot(params: {
  user_id: string;
  cd: number;
  meta: TransferenciaCdManifestMeta;
  notes: TransferenciaCdNoteRow[];
  items: TransferenciaCdManifestItemRow[];
  barras: TransferenciaCdManifestBarrasRow[];
}): Promise<void> {
  await clearByUserCd(STORE_MANIFEST_ITEMS, INDEX_ITEMS_BY_USER_CD, params.user_id, params.cd);
  await clearByUserCd(STORE_MANIFEST_BARRAS, INDEX_BARRAS_BY_USER_CD, params.user_id, params.cd);
  await clearByUserCd(STORE_MANIFEST_NOTES, INDEX_NOTES_BY_USER_CD, params.user_id, params.cd);

  {
    const db = await getDb();
    const transaction = db.transaction(STORE_MANIFEST_ITEMS, "readwrite");
    const store = transaction.objectStore(STORE_MANIFEST_ITEMS);
    for (const row of params.items) {
      const noteKey = buildTransferenciaCdNoteKey(row);
      const coddv = parsePositiveInt(row.coddv, 0);
      if (coddv <= 0) continue;
      store.put({
        ...row,
        key: manifestItemKey(params.user_id, params.cd, noteKey, coddv),
        user_id: params.user_id,
        cd: params.cd,
        note_key: noteKey,
        coddv,
        qtd_esperada: Math.max(Number(row.qtd_esperada ?? 0), 0)
      } satisfies ManifestItemStoreRow);
    }
    await transactionDone(transaction);
  }

  {
    const db = await getDb();
    const transaction = db.transaction(STORE_MANIFEST_BARRAS, "readwrite");
    const store = transaction.objectStore(STORE_MANIFEST_BARRAS);
    for (const row of params.barras) {
      const barras = String(row.barras ?? "").trim();
      const coddv = parsePositiveInt(row.coddv, 0);
      if (!barras || coddv <= 0) continue;
      store.put({
        ...row,
        key: manifestBarrasKey(params.user_id, params.cd, barras),
        user_id: params.user_id,
        cd: params.cd,
        barras,
        coddv
      } satisfies ManifestBarrasStoreRow);
    }
    await transactionDone(transaction);
  }

  {
    const db = await getDb();
    const transaction = db.transaction([STORE_MANIFEST_META, STORE_MANIFEST_NOTES], "readwrite");
    const metaStore = transaction.objectStore(STORE_MANIFEST_META);
    const notesStore = transaction.objectStore(STORE_MANIFEST_NOTES);
    const nowIso = new Date().toISOString();

    metaStore.put({
      ...params.meta,
      key: manifestMetaKey(params.user_id, params.cd),
      user_id: params.user_id,
      cached_at: nowIso
    } satisfies ManifestMetaStoreRow);

    for (const row of params.notes) {
      const noteKey = buildTransferenciaCdNoteKey(row);
      notesStore.put({
        ...row,
        key: manifestNoteKey(params.user_id, params.cd, noteKey),
        user_id: params.user_id,
        cd: params.cd,
        note_key: noteKey
      } satisfies ManifestNoteStoreRow);
    }

    await transactionDone(transaction);
  }
}

export async function listManifestNotesLocal(userId: string, cd: number): Promise<TransferenciaCdNoteRow[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_MANIFEST_NOTES, "readonly");
  const index = transaction.objectStore(STORE_MANIFEST_NOTES).index(INDEX_NOTES_BY_USER_CD);
  const rows = (await requestToPromise(index.getAll(IDBKeyRange.only([userId, cd])))) as ManifestNoteStoreRow[];
  await transactionDone(transaction);
  return rows
    .map(({ key: _key, user_id: _userId, cd: _cd, note_key: _noteKey, ...row }) => row)
    .sort((a, b) => b.dt_nf.localeCompare(a.dt_nf) || a.nf_trf - b.nf_trf || a.sq_nf - b.sq_nf);
}

export async function getManifestItemsByNote(userId: string, cd: number, note: TransferenciaCdNoteRow): Promise<TransferenciaCdManifestItemRow[]> {
  const noteKey = buildTransferenciaCdNoteKey(note);
  const db = await getDb();
  const transaction = db.transaction(STORE_MANIFEST_ITEMS, "readonly");
  const index = transaction.objectStore(STORE_MANIFEST_ITEMS).index(INDEX_ITEMS_BY_USER_CD_NOTE);
  const rows = (await requestToPromise(index.getAll(IDBKeyRange.only([userId, cd, noteKey])))) as ManifestItemStoreRow[];
  await transactionDone(transaction);
  return rows
    .map(({ key: _key, user_id: _userId, cd: _cd, note_key: _noteKey, ...row }) => row)
    .sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR") || a.coddv - b.coddv);
}

export async function findManifestBarras(userId: string, cd: number, barras: string): Promise<TransferenciaCdManifestBarrasRow | null> {
  const normalized = barras.trim();
  if (!normalized) return null;
  const db = await getDb();
  const transaction = db.transaction(STORE_MANIFEST_BARRAS, "readonly");
  const store = transaction.objectStore(STORE_MANIFEST_BARRAS);
  const raw = await requestToPromise(store.get(manifestBarrasKey(userId, cd, normalized)));
  await transactionDone(transaction);
  if (!raw || typeof raw !== "object") return null;
  const row = raw as ManifestBarrasStoreRow;
  return {
    barras: row.barras,
    coddv: row.coddv,
    descricao: row.descricao,
    updated_at: row.updated_at
  };
}

export async function saveLocalConference(conference: TransferenciaCdLocalConference): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_CONFERENCES, "readwrite");
  const normalized = normalizeLocalConference(conference);
  if (normalized) transaction.objectStore(STORE_CONFERENCES).put(normalized);
  await transactionDone(transaction);
}

export async function removeLocalConference(localKey: string): Promise<void> {
  const key = localKey.trim();
  if (!key) return;
  const db = await getDb();
  const transaction = db.transaction(STORE_CONFERENCES, "readwrite");
  transaction.objectStore(STORE_CONFERENCES).delete(key);
  await transactionDone(transaction);
}

export async function getLocalConference(localKey: string): Promise<TransferenciaCdLocalConference | null> {
  const db = await getDb();
  const transaction = db.transaction(STORE_CONFERENCES, "readonly");
  const raw = await requestToPromise(transaction.objectStore(STORE_CONFERENCES).get(localKey));
  await transactionDone(transaction);
  return normalizeLocalConference((raw as TransferenciaCdLocalConference | undefined) ?? null);
}

export async function listUserLocalConferences(userId: string): Promise<TransferenciaCdLocalConference[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_CONFERENCES, "readonly");
  const index = transaction.objectStore(STORE_CONFERENCES).index(INDEX_CONFERENCES_BY_USER);
  const rows = (await requestToPromise(index.getAll(IDBKeyRange.only(userId)))) as TransferenciaCdLocalConference[];
  await transactionDone(transaction);
  return sortConferences(rows.map((row) => normalizeLocalConference(row)).filter((row): row is TransferenciaCdLocalConference => row != null));
}

export async function listPendingLocalConferences(userId: string): Promise<TransferenciaCdLocalConference[]> {
  const rows = await listUserLocalConferences(userId);
  return rows.filter((row) => row.pending_snapshot || row.pending_finalize || row.pending_cancel || Boolean(row.sync_error));
}

export async function getPendingSummary(userId: string): Promise<TransferenciaCdPendingSummary> {
  const rows = await listPendingLocalConferences(userId);
  return {
    pending_count: rows.length,
    errors_count: rows.filter((row) => Boolean(row.sync_error)).length
  };
}

export async function cleanupExpiredTransferenciaCdConferences(userId: string): Promise<number> {
  const today = todayIsoBrasilia();
  const db = await getDb();
  const transaction = db.transaction(STORE_CONFERENCES, "readwrite");
  const store = transaction.objectStore(STORE_CONFERENCES);
  const index = store.index(INDEX_CONFERENCES_BY_USER);
  const request = index.openCursor(IDBKeyRange.only(userId));
  let removed = 0;

  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar conferências antigas."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const row = cursor.value as TransferenciaCdLocalConference;
      if ((row.conf_date || "") < today && !row.pending_snapshot && !row.pending_finalize && !row.pending_cancel) {
        cursor.delete();
        removed += 1;
      }
      cursor.continue();
    };
  });

  await transactionDone(transaction);
  return removed;
}
