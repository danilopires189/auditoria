import type {
  PedidoDiretoLocalVolume,
  PedidoDiretoManifestBarrasRow,
  PedidoDiretoManifestItemRow,
  PedidoDiretoManifestMeta,
  PedidoDiretoPendingSummary,
  PedidoDiretoPreferences,
  PedidoDiretoRouteOverviewRow
} from "./types";

const DB_NAME = "auditoria-pedido-direto-v1";
const DB_VERSION = 1;

const STORE_MANIFEST_ITEMS = "manifest_items";
const STORE_MANIFEST_BARRAS = "manifest_barras";
const STORE_MANIFEST_META = "manifest_meta";
const STORE_ROUTE_OVERVIEW = "route_overview";
const STORE_VOLUMES = "volumes";
const STORE_PREFS = "prefs";

const INDEX_ITEMS_BY_USER_CD = "by_user_cd";
const INDEX_ITEMS_BY_USER_CD_ETIQUETA = "by_user_cd_etiqueta";
const INDEX_ITEMS_BY_USER = "by_user";
const INDEX_BARRAS_BY_USER_CD = "by_user_cd";
const INDEX_BARRAS_BY_USER = "by_user";
const INDEX_META_BY_USER_CD = "by_user_cd";
const INDEX_META_BY_USER = "by_user";
const INDEX_ROUTES_BY_USER_CD = "by_user_cd";
const INDEX_ROUTES_BY_USER = "by_user";
const INDEX_VOLUMES_BY_USER = "by_user";
const INDEX_VOLUMES_BY_USER_CD = "by_user_cd";
const INDEX_VOLUMES_BY_USER_CD_ETIQUETA = "by_user_cd_etiqueta";
const INDEX_VOLUMES_BY_USER_DATE = "by_user_date";

interface ManifestItemStoreRow extends PedidoDiretoManifestItemRow {
  key: string;
  user_id: string;
  cd: number;
}

interface ManifestBarrasStoreRow extends PedidoDiretoManifestBarrasRow {
  key: string;
  user_id: string;
  cd: number;
}

interface ManifestMetaStoreRow extends PedidoDiretoManifestMeta {
  key: string;
  user_id: string;
  cached_at: string;
}

interface RouteOverviewStoreRow {
  key: string;
  user_id: string;
  cd: number;
  rows: PedidoDiretoRouteOverviewRow[];
  updated_at: string;
}

interface PrefStoreRow {
  key: string;
  value: PedidoDiretoPreferences;
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

function normalizePrefs(value: Partial<PedidoDiretoPreferences> | null | undefined): PedidoDiretoPreferences {
  return {
    prefer_offline_mode: Boolean(value?.prefer_offline_mode),
    multiplo_padrao: parsePositiveInt(value?.multiplo_padrao, 1),
    cd_ativo: typeof value?.cd_ativo === "number" && Number.isFinite(value.cd_ativo)
      ? Math.trunc(value.cd_ativo)
      : null
  };
}

function prefsKey(userId: string): string {
  return `prefs:${userId}`;
}

function manifestMetaKey(userId: string, cd: number): string {
  return `manifest_meta:${userId}:${cd}`;
}

function routeOverviewKey(userId: string, cd: number): string {
  return `route_overview:${userId}:${cd}`;
}

function manifestItemKey(userId: string, cd: number, idEtiqueta: string, coddv: number): string {
  return `manifest_item:${userId}:${cd}:${idEtiqueta}:${coddv}`;
}

function manifestBarrasKey(userId: string, cd: number, barras: string): string {
  return `manifest_barras:${userId}:${cd}:${barras}`;
}

export function buildPedidoDiretoVolumeKey(userId: string, cd: number, confDate: string, idEtiqueta: string): string {
  return `volume:${userId}:${cd}:${confDate}:${idEtiqueta}`;
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
        store.createIndex(INDEX_ITEMS_BY_USER_CD_ETIQUETA, ["user_id", "cd", "id_vol"], { unique: false });
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

      if (!db.objectStoreNames.contains(STORE_ROUTE_OVERVIEW)) {
        const store = db.createObjectStore(STORE_ROUTE_OVERVIEW, { keyPath: "key" });
        store.createIndex(INDEX_ROUTES_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_ROUTES_BY_USER_CD, ["user_id", "cd"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_VOLUMES)) {
        const store = db.createObjectStore(STORE_VOLUMES, { keyPath: "local_key" });
        store.createIndex(INDEX_VOLUMES_BY_USER, "user_id", { unique: false });
        store.createIndex(INDEX_VOLUMES_BY_USER_CD, ["user_id", "cd"], { unique: false });
        store.createIndex(INDEX_VOLUMES_BY_USER_CD_ETIQUETA, ["user_id", "cd", "id_vol"], { unique: false });
        store.createIndex(INDEX_VOLUMES_BY_USER_DATE, ["user_id", "conf_date"], { unique: false });
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

async function clearByUser(storeName: string, indexName: string, userId: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  const index = store.index(indexName);
  const request = index.openCursor(IDBKeyRange.only(userId));

  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Falha ao limpar dados locais por usuário."));
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

function sortVolumes(rows: PedidoDiretoLocalVolume[]): PedidoDiretoLocalVolume[] {
  return [...rows].sort((a, b) => {
    const aTime = Date.parse(a.updated_at || a.started_at || "");
    const bTime = Date.parse(b.updated_at || b.started_at || "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return bTime - aTime;
    }
    return b.local_key.localeCompare(a.local_key);
  });
}

export async function getPedidoDiretoPreferences(userId: string): Promise<PedidoDiretoPreferences> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readonly");
  const store = transaction.objectStore(STORE_PREFS);
  const raw = await requestToPromise(store.get(prefsKey(userId)));
  await transactionDone(transaction);
  const payload = (raw as PrefStoreRow | undefined)?.value;
  return normalizePrefs(payload);
}

export async function savePedidoDiretoPreferences(userId: string, value: PedidoDiretoPreferences): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readwrite");
  const store = transaction.objectStore(STORE_PREFS);
  const payload: PrefStoreRow = {
    key: prefsKey(userId),
    value: normalizePrefs(value)
  };
  store.put(payload);
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
  meta: PedidoDiretoManifestMeta;
  items: PedidoDiretoManifestItemRow[];
  barras: PedidoDiretoManifestBarrasRow[];
  routes: PedidoDiretoRouteOverviewRow[];
}): Promise<void> {
  await clearByUserCd(STORE_MANIFEST_ITEMS, INDEX_ITEMS_BY_USER_CD, params.user_id, params.cd);
  await clearByUserCd(STORE_MANIFEST_BARRAS, INDEX_BARRAS_BY_USER_CD, params.user_id, params.cd);

  {
    const db = await getDb();
    const transaction = db.transaction(STORE_MANIFEST_ITEMS, "readwrite");
    const itemsStore = transaction.objectStore(STORE_MANIFEST_ITEMS);

    for (const row of params.items) {
      const idEtiqueta = String(row.id_vol ?? "").trim();
      if (!idEtiqueta) continue;
      const coddv = parsePositiveInt(row.coddv, 0);
      if (coddv <= 0) continue;
      const payload: ManifestItemStoreRow = {
        key: manifestItemKey(params.user_id, params.cd, idEtiqueta, coddv),
        user_id: params.user_id,
        cd: params.cd,
        id_vol: idEtiqueta,
        caixa: row.caixa ?? null,
        pedido: row.pedido ?? null,
        filial: row.filial ?? null,
        filial_nome: row.filial_nome ?? null,
        rota: row.rota ?? null,
        coddv,
        descricao: row.descricao,
        qtd_esperada: parsePositiveInt(row.qtd_esperada, 1)
      };
      itemsStore.put(payload);
    }

    await transactionDone(transaction);
  }

  {
    const db = await getDb();
    const transaction = db.transaction(STORE_MANIFEST_BARRAS, "readwrite");
    const barrasStore = transaction.objectStore(STORE_MANIFEST_BARRAS);

    for (const row of params.barras) {
      const barras = String(row.barras ?? "").trim();
      if (!barras) continue;
      const coddv = parsePositiveInt(row.coddv, 0);
      if (coddv <= 0) continue;
      const payload: ManifestBarrasStoreRow = {
        key: manifestBarrasKey(params.user_id, params.cd, barras),
        user_id: params.user_id,
        cd: params.cd,
        barras,
        coddv,
        descricao: row.descricao ?? "",
        updated_at: row.updated_at ?? null
      };
      barrasStore.put(payload);
    }

    await transactionDone(transaction);
  }

  {
    const db = await getDb();
    const transaction = db.transaction([STORE_MANIFEST_META, STORE_ROUTE_OVERVIEW], "readwrite");
    const metaStore = transaction.objectStore(STORE_MANIFEST_META);
    const routesStore = transaction.objectStore(STORE_ROUTE_OVERVIEW);
    const nowIso = new Date().toISOString();

    const metaPayload: ManifestMetaStoreRow = {
      key: manifestMetaKey(params.user_id, params.cd),
      user_id: params.user_id,
      cd: params.meta.cd,
      row_count: parsePositiveInt(params.meta.row_count, 0),
      volumes_count: parsePositiveInt(params.meta.volumes_count, 0),
      source_run_id: params.meta.source_run_id,
      manifest_hash: params.meta.manifest_hash,
      generated_at: params.meta.generated_at,
      cached_at: nowIso
    };
    metaStore.put(metaPayload);

    const routePayload: RouteOverviewStoreRow = {
      key: routeOverviewKey(params.user_id, params.cd),
      user_id: params.user_id,
      cd: params.cd,
      rows: params.routes,
      updated_at: nowIso
    };
    routesStore.put(routePayload);

    await transactionDone(transaction);
  }
}

export async function getManifestItemsByEtiqueta(
  userId: string,
  cd: number,
  idEtiqueta: string
): Promise<PedidoDiretoManifestItemRow[]> {
  const etiqueta = idEtiqueta.trim();
  if (!etiqueta) return [];
  const db = await getDb();
  const transaction = db.transaction(STORE_MANIFEST_ITEMS, "readonly");
  const store = transaction.objectStore(STORE_MANIFEST_ITEMS);
  const index = store.index(INDEX_ITEMS_BY_USER_CD_ETIQUETA);
  const rows = (await requestToPromise(
    index.getAll(IDBKeyRange.only([userId, cd, etiqueta]))
  )) as ManifestItemStoreRow[];
  await transactionDone(transaction);
  return rows
    .map((row) => ({
      id_vol: row.id_vol,
      caixa: row.caixa,
      pedido: row.pedido,
      filial: row.filial,
      filial_nome: row.filial_nome,
      rota: row.rota,
      coddv: row.coddv,
      descricao: row.descricao,
      qtd_esperada: row.qtd_esperada
    }))
    .sort((a, b) => a.coddv - b.coddv);
}

export async function findManifestBarras(
  userId: string,
  cd: number,
  barras: string
): Promise<PedidoDiretoManifestBarrasRow | null> {
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

export async function getRouteOverviewLocal(userId: string, cd: number): Promise<PedidoDiretoRouteOverviewRow[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_ROUTE_OVERVIEW, "readonly");
  const store = transaction.objectStore(STORE_ROUTE_OVERVIEW);
  const raw = await requestToPromise(store.get(routeOverviewKey(userId, cd)));
  await transactionDone(transaction);
  const rows = (raw as RouteOverviewStoreRow | undefined)?.rows;
  return Array.isArray(rows) ? rows : [];
}

export async function saveRouteOverviewLocal(
  userId: string,
  cd: number,
  rows: PedidoDiretoRouteOverviewRow[]
): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_ROUTE_OVERVIEW, "readwrite");
  const store = transaction.objectStore(STORE_ROUTE_OVERVIEW);
  const payload: RouteOverviewStoreRow = {
    key: routeOverviewKey(userId, cd),
    user_id: userId,
    cd,
    rows,
    updated_at: new Date().toISOString()
  };
  store.put(payload);
  await transactionDone(transaction);
}

export async function saveLocalVolume(volume: PedidoDiretoLocalVolume): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(STORE_VOLUMES, "readwrite");
  const store = transaction.objectStore(STORE_VOLUMES);
  store.put(volume);
  await transactionDone(transaction);
}

export async function removeLocalVolume(localKey: string): Promise<void> {
  const key = localKey.trim();
  if (!key) return;
  const db = await getDb();
  const transaction = db.transaction(STORE_VOLUMES, "readwrite");
  const store = transaction.objectStore(STORE_VOLUMES);
  store.delete(key);
  await transactionDone(transaction);
}

export async function getLocalVolume(
  userId: string,
  cd: number,
  confDate: string,
  idEtiqueta: string
): Promise<PedidoDiretoLocalVolume | null> {
  const db = await getDb();
  const transaction = db.transaction(STORE_VOLUMES, "readonly");
  const store = transaction.objectStore(STORE_VOLUMES);
  const key = buildPedidoDiretoVolumeKey(userId, cd, confDate, idEtiqueta.trim());
  const raw = await requestToPromise(store.get(key));
  await transactionDone(transaction);
  return (raw as PedidoDiretoLocalVolume | undefined) ?? null;
}

export async function getLatestLocalVolumeByEtiqueta(
  userId: string,
  cd: number,
  idEtiqueta: string
): Promise<PedidoDiretoLocalVolume | null> {
  const etiqueta = idEtiqueta.trim();
  if (!etiqueta) return null;
  const db = await getDb();
  const transaction = db.transaction(STORE_VOLUMES, "readonly");
  const index = transaction.objectStore(STORE_VOLUMES).index(INDEX_VOLUMES_BY_USER_CD_ETIQUETA);
  const rows = (await requestToPromise(
    index.getAll(IDBKeyRange.only([userId, cd, etiqueta]))
  )) as PedidoDiretoLocalVolume[];
  await transactionDone(transaction);
  if (!rows.length) return null;
  return sortVolumes(rows)[0];
}

export async function listUserLocalVolumes(userId: string): Promise<PedidoDiretoLocalVolume[]> {
  const db = await getDb();
  const transaction = db.transaction(STORE_VOLUMES, "readonly");
  const index = transaction.objectStore(STORE_VOLUMES).index(INDEX_VOLUMES_BY_USER);
  const rows = (await requestToPromise(index.getAll(IDBKeyRange.only(userId)))) as PedidoDiretoLocalVolume[];
  await transactionDone(transaction);
  return sortVolumes(rows);
}

export async function listPendingLocalVolumes(userId: string): Promise<PedidoDiretoLocalVolume[]> {
  const rows = await listUserLocalVolumes(userId);
  return rows.filter((row) => row.pending_snapshot || row.pending_finalize || row.pending_cancel || Boolean(row.sync_error));
}

export async function getPendingSummary(userId: string): Promise<PedidoDiretoPendingSummary> {
  const rows = await listPendingLocalVolumes(userId);
  return {
    pending_count: rows.length,
    errors_count: rows.filter((row) => Boolean(row.sync_error)).length
  };
}

export async function cleanupExpiredPedidoDiretoVolumes(userId: string): Promise<number> {
  const today = todayIsoBrasilia();
  const db = await getDb();
  const transaction = db.transaction(STORE_VOLUMES, "readwrite");
  const store = transaction.objectStore(STORE_VOLUMES);
  const index = store.index(INDEX_VOLUMES_BY_USER);
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
      const row = cursor.value as PedidoDiretoLocalVolume;
      if ((row.conf_date || "") < today) {
        cursor.delete();
        removed += 1;
      }
      cursor.continue();
    };
  });

  await transactionDone(transaction);
  return removed;
}

export async function clearUserPedidoDiretoSessionCache(userId: string): Promise<void> {
  await clearByUser(STORE_MANIFEST_ITEMS, INDEX_ITEMS_BY_USER, userId);
  await clearByUser(STORE_MANIFEST_BARRAS, INDEX_BARRAS_BY_USER, userId);
  await clearByUser(STORE_MANIFEST_META, INDEX_META_BY_USER, userId);
  await clearByUser(STORE_ROUTE_OVERVIEW, INDEX_ROUTES_BY_USER, userId);
  await clearByUser(STORE_VOLUMES, INDEX_VOLUMES_BY_USER, userId);

  const db = await getDb();
  const transaction = db.transaction(STORE_PREFS, "readwrite");
  transaction.objectStore(STORE_PREFS).delete(prefsKey(userId));
  await transactionDone(transaction);
}

