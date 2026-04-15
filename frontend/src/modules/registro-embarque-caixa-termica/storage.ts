import type {
  CaixaTermicaBox,
  CaixaTermicaMov,
  CaixaTermicaPrefs,
  CaixaTermicaSyncStatus
} from "./types";

const DB_NAME = "auditoria-caixa-termica-v1";
const DB_VERSION = 1;

const STORE_BOXES = "caixa_boxes";
const STORE_MOVS = "caixa_movs";
const STORE_PREFS = "prefs";
const STORE_META = "meta";

const INDEX_BOXES_BY_USER = "by_user";
const INDEX_BOXES_BY_USER_CD = "by_user_cd";
const INDEX_BOXES_BY_USER_STATUS = "by_user_status";
const INDEX_BOXES_BY_CODIGO = "by_codigo";
const INDEX_MOVS_BY_CAIXA = "by_caixa";

const PENDING_STATUSES: CaixaTermicaSyncStatus[] = ["pending_insert", "error"];

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

function prefsKey(userId: string): string {
  return `prefs:${userId}`;
}

function sortBoxes(boxes: CaixaTermicaBox[]): CaixaTermicaBox[] {
  return [...boxes].sort((a, b) => {
    const aTime = Date.parse(a.updated_at || a.created_at || "");
    const bTime = Date.parse(b.updated_at || b.created_at || "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return bTime - aTime;
    }
    return (b.updated_at || "").localeCompare(a.updated_at || "");
  });
}

function sortMovs(movs: CaixaTermicaMov[]): CaixaTermicaMov[] {
  return [...movs].sort((a, b) => {
    const aTime = Date.parse(a.data_hr || a.created_at || "");
    const bTime = Date.parse(b.data_hr || b.created_at || "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime;
    return (a.data_hr || "").localeCompare(b.data_hr || "");
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_BOXES)) {
        const store = db.createObjectStore(STORE_BOXES, { keyPath: "local_id" });
        store.createIndex(INDEX_BOXES_BY_USER, "created_by", { unique: false });
        store.createIndex(INDEX_BOXES_BY_USER_CD, ["created_by", "cd"], { unique: false });
        store.createIndex(INDEX_BOXES_BY_USER_STATUS, ["created_by", "sync_status"], { unique: false });
        store.createIndex(INDEX_BOXES_BY_CODIGO, "codigo", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_MOVS)) {
        const store = db.createObjectStore(STORE_MOVS, { keyPath: "id" });
        store.createIndex(INDEX_MOVS_BY_CAIXA, "caixa_id", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_PREFS)) {
        db.createObjectStore(STORE_PREFS, { keyPath: "key" });
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

// ── Box operations ──────────────────────────────────────────

export async function upsertCaixaTermicaBox(box: CaixaTermicaBox): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_BOXES, "readwrite");
  transaction.objectStore(STORE_BOXES).put(box);
  await transactionDone(transaction);
}

export async function getAllCaixaTermicaBoxes(userId: string, cd: number): Promise<CaixaTermicaBox[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_BOXES, "readonly");
  const index = transaction.objectStore(STORE_BOXES).index(INDEX_BOXES_BY_USER_CD);
  const rows = (await requestToPromise(index.getAll(IDBKeyRange.only([userId, cd])))) as CaixaTermicaBox[];
  await transactionDone(transaction);
  return sortBoxes(rows ?? []);
}

export async function getCaixaTermicaBoxByCodigo(
  userId: string,
  cd: number,
  codigo: string
): Promise<CaixaTermicaBox | null> {
  const db = await getDb();
  const transaction = db.transaction(STORE_BOXES, "readonly");
  const index = transaction.objectStore(STORE_BOXES).index(INDEX_BOXES_BY_CODIGO);
  const rows = (await requestToPromise(index.getAll(IDBKeyRange.only(codigo.toUpperCase())))) as CaixaTermicaBox[];
  await transactionDone(transaction);
  const match = rows.find((b) => b.created_by === userId && b.cd === cd);
  return match ?? null;
}

export async function getPendingCaixaTermicaBoxes(userId: string): Promise<CaixaTermicaBox[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_BOXES, "readonly");
  const index = transaction.objectStore(STORE_BOXES).index(INDEX_BOXES_BY_USER_STATUS);

  const batches = await Promise.all(
    PENDING_STATUSES.map((status) =>
      requestToPromise(index.getAll(IDBKeyRange.only([userId, status])))
    )
  );
  await transactionDone(transaction);

  const rows = batches.flatMap((batch) =>
    Array.isArray(batch) ? (batch as CaixaTermicaBox[]) : []
  );
  return sortBoxes(rows);
}

export async function countPendingCaixaTermicaBoxes(userId: string): Promise<number> {
  const db = await getDb();
  const transaction = db.transaction(STORE_BOXES, "readonly");
  const index = transaction.objectStore(STORE_BOXES).index(INDEX_BOXES_BY_USER_STATUS);

  const counts = await Promise.all(
    PENDING_STATUSES.map((status) =>
      requestToPromise(index.count(IDBKeyRange.only([userId, status])))
    )
  );
  await transactionDone(transaction);

  return counts.reduce((sum, current) => {
    const value = typeof current === "number" && Number.isFinite(current) ? current : 0;
    return sum + value;
  }, 0);
}

// ── Movement operations ─────────────────────────────────────

export async function upsertCaixaTermicaMov(mov: CaixaTermicaMov): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_MOVS, "readwrite");
  transaction.objectStore(STORE_MOVS).put(mov);
  await transactionDone(transaction);
}

export async function getMovsByBox(caixaId: string): Promise<CaixaTermicaMov[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_MOVS, "readonly");
  const index = transaction.objectStore(STORE_MOVS).index(INDEX_MOVS_BY_CAIXA);
  const rows = (await requestToPromise(index.getAll(IDBKeyRange.only(caixaId)))) as CaixaTermicaMov[];
  await transactionDone(transaction);
  return sortMovs(rows ?? []);
}

export async function clearMovsByBox(caixaId: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_MOVS, "readwrite");
  const index = transaction.objectStore(STORE_MOVS).index(INDEX_MOVS_BY_CAIXA);
  const keys = await requestToPromise(index.getAllKeys(IDBKeyRange.only(caixaId)));
  for (const key of Array.isArray(keys) ? keys : []) {
    transaction.objectStore(STORE_MOVS).delete(key);
  }
  await transactionDone(transaction);
}

// ── Preferences ─────────────────────────────────────────────

export async function getCaixaTermicaPrefs(userId: string): Promise<CaixaTermicaPrefs> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readonly");
  const raw = await requestToPromise(transaction.objectStore(STORE_PREFS).get(prefsKey(userId)));
  await transactionDone(transaction);

  if (!raw || typeof raw !== "object") return { cd_ativo: null };
  const payload = (raw as { value?: Partial<CaixaTermicaPrefs> }).value;
  return {
    cd_ativo: typeof payload?.cd_ativo === "number" && Number.isFinite(payload.cd_ativo)
      ? Math.trunc(payload.cd_ativo)
      : null
  };
}

export async function saveCaixaTermicaPrefs(userId: string, prefs: CaixaTermicaPrefs): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readwrite");
  transaction.objectStore(STORE_PREFS).put({ key: prefsKey(userId), value: { cd_ativo: prefs.cd_ativo } });
  await transactionDone(transaction);
}

// ── Session cleanup (called on logout from App.tsx) ─────────

export async function clearUserCaixaTermicaSessionCache(userId: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction([STORE_BOXES, STORE_MOVS, STORE_PREFS], "readwrite");
  const boxStore = transaction.objectStore(STORE_BOXES);
  const movStore = transaction.objectStore(STORE_MOVS);
  const prefStore = transaction.objectStore(STORE_PREFS);

  const boxIndex = boxStore.index(INDEX_BOXES_BY_USER);
  const boxRequest = boxIndex.openCursor(IDBKeyRange.only(userId));

  const deletedCaixaIds: IDBValidKey[] = [];

  await new Promise<void>((resolve, reject) => {
    boxRequest.onerror = () => reject(boxRequest.error ?? new Error("Falha ao limpar caixas"));
    boxRequest.onsuccess = () => {
      const cursor = boxRequest.result;
      if (!cursor) { resolve(); return; }
      const box = cursor.value as CaixaTermicaBox;
      deletedCaixaIds.push(box.id);
      cursor.delete();
      cursor.continue();
    };
  });

  // Remove movs for deleted boxes
  const movIndex = movStore.index(INDEX_MOVS_BY_CAIXA);
  for (const caixaId of deletedCaixaIds) {
    const movKeys = await requestToPromise(movIndex.getAllKeys(IDBKeyRange.only(caixaId)));
    for (const key of Array.isArray(movKeys) ? movKeys : []) {
      movStore.delete(key);
    }
  }

  prefStore.delete(prefsKey(userId));
  await transactionDone(transaction);
}
