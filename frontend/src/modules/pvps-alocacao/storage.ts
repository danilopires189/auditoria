const DB_NAME = "auditoria-pvps-offline-v1";
const DB_VERSION = 1;
const STORE_EVENTS = "pvps_offline_events";
const STORE_SEP_CACHE = "pvps_offline_sep_cache";

export type PvpsOfflineEventKind = "sep" | "pul";

export interface PvpsOfflineEventRow {
  event_id: string;
  kind: PvpsOfflineEventKind;
  cd: number;
  coddv: number;
  end_sep: string;
  end_pul?: string | null;
  end_sit?: string | null;
  val_sep?: string | null;
  val_pul?: string | null;
  audit_id?: string | null;
  created_at: string;
}

export interface PvpsOfflineSepCacheRow {
  key: string;
  cd: number;
  coddv: number;
  end_sep: string;
  end_sit: string | null;
  val_sep: string | null;
  saved_at: string;
}

function ensureIndexedDbAvailable(): void {
  if (typeof window === "undefined" || !window.indexedDB) {
    throw new Error("IndexedDB indisponivel neste ambiente.");
  }
}

function normalizeAddress(value: string): string {
  return value.trim().toUpperCase();
}

function sepCacheKey(cd: number, coddv: number, endSep: string): string {
  return `${Math.trunc(cd)}|${Math.trunc(coddv)}|${normalizeAddress(endSep)}`;
}

function sepEventKey(cd: number, coddv: number, endSep: string): string {
  return `sep|${sepCacheKey(cd, coddv, endSep)}`;
}

function pulEventKey(cd: number, coddv: number, endSep: string, endPul: string): string {
  return `pul|${Math.trunc(cd)}|${Math.trunc(coddv)}|${normalizeAddress(endSep)}|${normalizeAddress(endPul)}`;
}

async function getDb(): Promise<IDBDatabase> {
  ensureIndexedDbAvailable();
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const events = db.createObjectStore(STORE_EVENTS, { keyPath: "event_id" });
        events.createIndex("by_created_at", "created_at", { unique: false });
        events.createIndex("by_kind", "kind", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SEP_CACHE)) {
        db.createObjectStore(STORE_SEP_CACHE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir IndexedDB do PVPS offline."));
  });
}

export async function saveOfflineSepEvent(params: {
  cd: number;
  coddv: number;
  end_sep: string;
  end_sit?: string | null;
  val_sep?: string | null;
}): Promise<PvpsOfflineEventRow> {
  const cd = Math.trunc(params.cd);
  const coddv = Math.trunc(params.coddv);
  const endSep = normalizeAddress(params.end_sep);
  const nowIso = new Date().toISOString();
  const row: PvpsOfflineEventRow = {
    event_id: sepEventKey(cd, coddv, endSep),
    kind: "sep",
    cd,
    coddv,
    end_sep: endSep,
    end_sit: params.end_sit ?? null,
    val_sep: params.val_sep ?? null,
    created_at: nowIso
  };

  const db = await getDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Falha ao salvar evento offline SEP."));
      tx.objectStore(STORE_EVENTS).put(row);
    });
    return row;
  } finally {
    db.close();
  }
}

export async function saveOfflinePulEvent(params: {
  cd: number;
  coddv: number;
  end_sep: string;
  end_pul: string;
  val_pul: string;
  audit_id?: string | null;
}): Promise<PvpsOfflineEventRow> {
  const cd = Math.trunc(params.cd);
  const coddv = Math.trunc(params.coddv);
  const endSep = normalizeAddress(params.end_sep);
  const endPul = normalizeAddress(params.end_pul);
  const nowIso = new Date().toISOString();
  const row: PvpsOfflineEventRow = {
    event_id: pulEventKey(cd, coddv, endSep, endPul),
    kind: "pul",
    cd,
    coddv,
    end_sep: endSep,
    end_pul: endPul,
    val_pul: params.val_pul,
    audit_id: params.audit_id ?? null,
    created_at: nowIso
  };

  const db = await getDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Falha ao salvar evento offline PUL."));
      tx.objectStore(STORE_EVENTS).put(row);
    });
    return row;
  } finally {
    db.close();
  }
}

export async function listOfflinePvpsEvents(): Promise<PvpsOfflineEventRow[]> {
  const db = await getDb();
  try {
    return await new Promise<PvpsOfflineEventRow[]>((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, "readonly");
      const request = tx.objectStore(STORE_EVENTS).getAll();
      request.onsuccess = () => {
        const rows = (request.result as PvpsOfflineEventRow[] | undefined) ?? [];
        rows.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "sep" ? -1 : 1;
          return a.created_at.localeCompare(b.created_at);
        });
        resolve(rows);
      };
      request.onerror = () => reject(request.error ?? new Error("Falha ao listar eventos offline PVPS."));
    });
  } finally {
    db.close();
  }
}

export async function deleteOfflinePvpsEvent(eventId: string): Promise<void> {
  const db = await getDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Falha ao remover evento offline PVPS."));
      tx.objectStore(STORE_EVENTS).delete(eventId);
    });
  } finally {
    db.close();
  }
}

export async function upsertOfflineSepCache(params: {
  cd: number;
  coddv: number;
  end_sep: string;
  end_sit?: string | null;
  val_sep?: string | null;
}): Promise<PvpsOfflineSepCacheRow> {
  const cd = Math.trunc(params.cd);
  const coddv = Math.trunc(params.coddv);
  const endSep = normalizeAddress(params.end_sep);
  const row: PvpsOfflineSepCacheRow = {
    key: sepCacheKey(cd, coddv, endSep),
    cd,
    coddv,
    end_sep: endSep,
    end_sit: params.end_sit ?? null,
    val_sep: params.val_sep ?? null,
    saved_at: new Date().toISOString()
  };

  const db = await getDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SEP_CACHE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Falha ao salvar cache offline SEP."));
      tx.objectStore(STORE_SEP_CACHE).put(row);
    });
    return row;
  } finally {
    db.close();
  }
}

export async function hasOfflineSepCache(cd: number, coddv: number, endSep: string): Promise<boolean> {
  const key = sepCacheKey(cd, coddv, endSep);
  const db = await getDb();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_SEP_CACHE, "readonly");
      const request = tx.objectStore(STORE_SEP_CACHE).get(key);
      request.onsuccess = () => resolve(Boolean(request.result));
      request.onerror = () => reject(request.error ?? new Error("Falha ao consultar cache offline SEP."));
    });
  } finally {
    db.close();
  }
}
