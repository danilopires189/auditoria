import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import {
  fetchDbBarrasByBarcodeOnline,
  normalizeBarcode
} from "../../shared/db-barras/sync";
import {
  getDbBarrasByBarcode,
  getDbBarrasMeta,
  upsertDbBarrasCacheRow
} from "../../shared/db-barras/storage";
import { getModuleByKeyOrThrow } from "../registry";
import {
  countPendingEventsByCycle,
  getInventarioPreferences,
  getManifestMetaLocal,
  getRemoteStateCache,
  listManifestItemsByCd,
  listPendingEventsByCycle,
  queuePendingEvent,
  removePendingEvent,
  saveInventarioPreferences,
  saveManifestSnapshot,
  saveRemoteStateCache,
  updatePendingEventStatus
} from "./storage";
import {
  acquireZoneLock,
  applyInventarioEvent,
  countReportRows,
  fetchCdOptions,
  fetchManifestBundle,
  fetchManifestMeta,
  fetchReportRows,
  fetchSyncPull,
  heartbeatZoneLock,
  releaseZoneLock
} from "./sync";
import type {
  CdOption,
  InventarioAddressBucket,
  InventarioCountRow,
  InventarioEventType,
  InventarioLockAcquireResponse,
  InventarioManifestItemRow,
  InventarioManifestMeta,
  InventarioModuleProfile,
  InventarioPendingEvent,
  InventarioPreferences,
  InventarioResultado,
  InventarioReviewRow,
  InventarioStageView,
  InventarioSyncPullState
} from "./types";

interface InventarioPageProps {
  isOnline: boolean;
  profile: InventarioModuleProfile;
}

type StageStatusFilter = "pendente" | "concluido";
type ReviewStatusFilter = "pendente" | "resolvido";

type Row = InventarioManifestItemRow & {
  key: string;
  c1: InventarioCountRow | null;
  c2: InventarioCountRow | null;
  review: InventarioReviewRow | null;
  final: boolean;
};

type AddressBucketView = InventarioAddressBucket & {
  items: Row[];
};

const MODULE_DEF = getModuleByKeyOrThrow("zerados");
const CYCLE_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

function displayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((s) => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1))
    .join(" ");
}

function fixedCd(profile: InventarioModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) return Math.trunc(profile.cd_default);
  const m = /cd\s*0*(\d+)/i.exec(profile.cd_nome ?? "");
  return m ? Number.parseInt(m[1], 10) : null;
}

function keyOf(zona: string, endereco: string, coddv: number): string {
  return `${zona.toUpperCase()}|${endereco.toUpperCase()}|${coddv}`;
}

function addressKeyOf(zona: string, endereco: string): string {
  return `${zona.toUpperCase()}|${endereco.toUpperCase()}`;
}

function resultOf(estoque: number, qtd: number, discarded: boolean): InventarioResultado {
  if (discarded) return "descartado";
  if (qtd > estoque) return "sobra";
  if (qtd < estoque) return "falta";
  return "correto";
}

function parseErr(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "Erro inesperado");
  if (raw.includes("BARRAS_INVALIDA_CODDV")) return "Código de barras inválido para este CODDV.";
  if (raw.includes("SEGUNDA_CONTAGEM_EXIGE_USUARIO_DIFERENTE")) return "2ª verificação exige usuário diferente.";
  if (raw.includes("ZONA_TRAVADA_OUTRO_USUARIO")) return "Zona/etapa bloqueada por outro usuário.";
  if (raw.includes("APENAS_ADMIN")) return "Apenas admin pode exportar relatório.";
  if (raw.includes("MANIFESTO_INCOMPLETO")) return "Base local incompleta. Sincronize novamente para baixar todos os endereços.";
  if (raw.includes("ETAPA1_APENAS_AUTOR")) return "Apenas o autor pode editar a 1ª verificação.";
  if (raw.includes("ETAPA2_APENAS_AUTOR")) return "Apenas o autor pode editar a 2ª verificação.";
  if (raw.includes("ETAPA1_BLOQUEADA_SEGUNDA_EXISTE")) return "A 1ª verificação não pode ser alterada após existir 2ª verificação.";
  if (raw.includes("ITEM_JA_RESOLVIDO")) return "Item já resolvido na conciliação.";
  return raw;
}

function defaultState(): InventarioSyncPullState {
  return { counts: [], reviews: [], locks: [], server_time: null };
}

function isS1Pending(row: Row): boolean {
  return row.c1 == null;
}

function isS2Eligible(row: Row): boolean {
  return row.c1 != null && row.c1.resultado === "sobra";
}

function isS2Pending(row: Row): boolean {
  return isS2Eligible(row) && row.c2 == null;
}

function isConciliationPending(row: Row): boolean {
  return row.review?.status === "pendente";
}

function rowMatchesStageUniverse(row: Row, stage: InventarioStageView): boolean {
  if (stage === "s1") return true;
  if (stage === "s2") return isS2Eligible(row);
  if (stage === "conciliation") return row.review != null;
  return row.final;
}

function rowMatchesStageStatus(
  row: Row,
  stage: InventarioStageView,
  statusFilter: StageStatusFilter,
  reviewFilter: ReviewStatusFilter
): boolean {
  if (stage === "s1") {
    return statusFilter === "pendente" ? isS1Pending(row) : !isS1Pending(row);
  }

  if (stage === "s2") {
    return statusFilter === "pendente" ? isS2Pending(row) : !isS2Pending(row);
  }

  if (stage === "conciliation") {
    return reviewFilter === "pendente" ? isConciliationPending(row) : row.review?.status === "resolvido";
  }

  return true;
}

function stageLabel(stage: InventarioStageView): string {
  if (stage === "s1") return "1ª Verificação";
  if (stage === "s2") return "2ª Verificação";
  if (stage === "conciliation") return "Conciliação";
  return "Concluídos";
}

function derive(manifest: InventarioManifestItemRow[], remote: InventarioSyncPullState): Row[] {
  const counts = new Map<string, { c1: InventarioCountRow | null; c2: InventarioCountRow | null }>();
  for (const c of remote.counts) {
    const k = keyOf(c.zona, c.endereco, c.coddv);
    const cur = counts.get(k) ?? { c1: null, c2: null };
    if (c.etapa === 2) cur.c2 = c; else cur.c1 = c;
    counts.set(k, cur);
  }
  const reviews = new Map<string, InventarioReviewRow>();
  for (const r of remote.reviews) reviews.set(keyOf(r.zona, r.endereco, r.coddv), r);

  return manifest.map((m) => {
    const k = keyOf(m.zona, m.endereco, m.coddv);
    const c = counts.get(k) ?? { c1: null, c2: null };
    const review = reviews.get(k) ?? null;
    const final = review?.status === "resolvido"
      || c.c1?.resultado === "descartado"
      || c.c2?.resultado === "descartado"
      || (c.c1 != null && c.c2 != null && c.c1.qtd_contada === c.c2.qtd_contada)
      || (c.c1 != null && c.c1.resultado !== "sobra" && review == null);
    return { ...m, key: k, c1: c.c1, c2: c.c2, review, final };
  });
}

function optimistic(previous: InventarioSyncPullState, payload: Record<string, unknown>, profile: InventarioModuleProfile): InventarioSyncPullState {
  const cycle = String(payload.cycle_date ?? CYCLE_DATE);
  const cd = Number.parseInt(String(payload.cd ?? ""), 10);
  const zona = String(payload.zona ?? "").trim().toUpperCase();
  const endereco = String(payload.endereco ?? "").trim().toUpperCase();
  const coddv = Number.parseInt(String(payload.coddv ?? ""), 10);
  if (!Number.isFinite(cd) || !zona || !endereco || !Number.isFinite(coddv)) return previous;

  if (String(payload.final_qtd ?? "").length > 0) {
    const q = Math.max(Number.parseInt(String(payload.final_qtd ?? "0"), 10) || 0, 0);
    const estoque = Math.max(Number.parseInt(String(payload.estoque ?? "0"), 10) || 0, 0);
    const nextReviews = [...previous.reviews];
    const idx = nextReviews.findIndex((r) => r.cycle_date === cycle && r.cd === cd && keyOf(r.zona, r.endereco, r.coddv) === keyOf(zona, endereco, coddv));
    if (idx >= 0) {
      nextReviews[idx] = {
        ...nextReviews[idx],
        status: "resolvido",
        final_qtd: q,
        final_barras: q > estoque ? String(payload.final_barras ?? "") || null : null,
        final_resultado: resultOf(estoque, q, false),
        resolved_by: profile.user_id,
        resolved_mat: profile.mat,
        resolved_nome: profile.nome,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }
    return { ...previous, reviews: nextReviews, server_time: new Date().toISOString() };
  }

  const etapa = Number.parseInt(String(payload.etapa ?? "1"), 10) === 2 ? 2 : 1;
  const qtd = payload.discarded === true ? 0 : Math.max(Number.parseInt(String(payload.qtd_contada ?? "0"), 10) || 0, 0);
  const estoque = Math.max(Number.parseInt(String(payload.estoque ?? "0"), 10) || 0, 0);
  const r = resultOf(estoque, qtd, payload.discarded === true);
  const nextCount: InventarioCountRow = {
    cycle_date: cycle,
    cd,
    zona,
    endereco,
    coddv,
    descricao: String(payload.descricao ?? `CODDV ${coddv}`),
    estoque,
    etapa,
    qtd_contada: qtd,
    barras: qtd > estoque && payload.discarded !== true ? String(payload.barras ?? "") || null : null,
    resultado: r,
    counted_by: profile.user_id,
    counted_mat: profile.mat,
    counted_nome: profile.nome,
    updated_at: new Date().toISOString()
  };
  const counts = previous.counts.filter((c) => !(c.cycle_date === cycle && c.cd === cd && keyOf(c.zona, c.endereco, c.coddv) === keyOf(zona, endereco, coddv) && c.etapa === etapa));
  counts.push(nextCount);
  return { ...previous, counts, server_time: new Date().toISOString() };
}

export default function InventarioZeradosPage({ isOnline, profile }: InventarioPageProps) {
  const userName = useMemo(() => displayName(profile.nome), [profile.nome]);
  const fixed = useMemo(() => fixedCd(profile), [profile]);
  const isGlobalAdmin = profile.role === "admin" && fixed == null;
  const canEdit = profile.role !== "viewer";
  const canExport = profile.role === "admin";

  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [cd, setCd] = useState<number | null>(fixed);
  const [preferOffline, setPreferOffline] = useState(false);

  const [manifestMeta, setManifestMeta] = useState<InventarioManifestMeta | null>(null);
  const [manifestItems, setManifestItems] = useState<InventarioManifestItemRow[]>([]);
  const [remoteState, setRemoteState] = useState<InventarioSyncPullState>(defaultState);
  const [pendingCount, setPendingCount] = useState(0);
  const [dbBarrasCount, setDbBarrasCount] = useState(0);

  const [tab, setTab] = useState<InventarioStageView>("s1");
  const [statusFilter, setStatusFilter] = useState<StageStatusFilter>("pendente");
  const [reviewFilter, setReviewFilter] = useState<ReviewStatusFilter>("pendente");
  const [zone, setZone] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [qtd, setQtd] = useState("0");
  const [barras, setBarras] = useState("");
  const [finalQtd, setFinalQtd] = useState("0");
  const [finalBarras, setFinalBarras] = useState("");

  const [lock, setLock] = useState<InventarioLockAcquireResponse | null>(null);
  const lockRef = useRef<InventarioLockAcquireResponse | null>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [dtIni, setDtIni] = useState(CYCLE_DATE);
  const [dtFim, setDtFim] = useState(CYCLE_DATE);
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth >= 1024;
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const syncRef = useRef(false);

  useEffect(() => { lockRef.current = lock; }, [lock]);

  const refreshPending = useCallback(async () => {
    if (cd == null) return setPendingCount(0);
    setPendingCount(await countPendingEventsByCycle(profile.user_id, cd, CYCLE_DATE));
  }, [cd, profile.user_id]);

  const loadLocal = useCallback(async () => {
    if (cd == null) return;
    const [meta, items, state] = await Promise.all([
      getManifestMetaLocal(profile.user_id, cd),
      listManifestItemsByCd(profile.user_id, cd),
      getRemoteStateCache(profile.user_id, cd, CYCLE_DATE)
    ]);
    setManifestMeta(meta);
    setManifestItems(items);
    setRemoteState(state ?? defaultState());
  }, [cd, profile.user_id]);

  const pull = useCallback(async () => {
    if (cd == null) return;
    const pulled = await fetchSyncPull({ cd, cycle_date: CYCLE_DATE, since: null });
    setRemoteState(pulled);
    await saveRemoteStateCache({ user_id: profile.user_id, cd, cycle_date: CYCLE_DATE, state: pulled });
  }, [cd, profile.user_id]);

  const syncPending = useCallback(async () => {
    if (!isOnline || cd == null) return;
    const queue = await listPendingEventsByCycle(profile.user_id, cd, CYCLE_DATE);
    for (const e of queue) {
      try {
        await applyInventarioEvent({ event_type: e.event_type, payload: e.payload, client_event_id: e.client_event_id });
        await removePendingEvent(e.event_id);
      } catch (error) {
        await updatePendingEventStatus({ event_id: e.event_id, status: "error", error_message: parseErr(error), increment_attempt: true });
      }
    }
    await refreshPending();
  }, [cd, isOnline, profile.user_id, refreshPending]);

  const syncNow = useCallback(async (forceManifest = false) => {
    if (!isOnline || cd == null || syncRef.current) return;
    syncRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      const remoteMeta = await fetchManifestMeta(cd);
      const localMeta = await getManifestMetaLocal(profile.user_id, cd);
      const localRows = await listManifestItemsByCd(profile.user_id, cd);
      const localCount = localRows.length;
      const manifestChanged = !localMeta || localMeta.manifest_hash !== remoteMeta.manifest_hash;
      const localIncomplete = localCount < Math.max(remoteMeta.row_count, 0);

      if (forceManifest || manifestChanged || localIncomplete) {
        const bundle = await fetchManifestBundle(cd);
        await saveManifestSnapshot({ user_id: profile.user_id, cd, meta: bundle.meta, items: bundle.items });
        setManifestMeta(bundle.meta);
        setManifestItems(bundle.items);
      } else {
        setManifestMeta(remoteMeta);
        if (manifestItems.length === 0 && localRows.length > 0) {
          setManifestItems(localRows);
        }
      }
      await syncPending();
      await pull();
      const bm = await getDbBarrasMeta();
      setDbBarrasCount(bm.row_count);
      setMsg("Sincronização concluída.");
    } catch (error) {
      setErr(parseErr(error));
    } finally {
      setBusy(false);
      syncRef.current = false;
    }
  }, [cd, isOnline, manifestItems.length, profile.user_id, pull, syncPending]);

  const send = useCallback(async (eventType: InventarioEventType, payload: Record<string, unknown>) => {
    if (cd == null) return;
    if (!isOnline || preferOffline) {
      const id = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `inv-${Date.now()}`;
      const p: InventarioPendingEvent = {
        event_id: `pending:${id}`,
        client_event_id: id,
        user_id: profile.user_id,
        cd,
        cycle_date: CYCLE_DATE,
        event_type: eventType,
        payload,
        status: "pending",
        attempt_count: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await queuePendingEvent(p);
      setRemoteState((prev) => {
        const next = optimistic(prev, payload, profile);
        void saveRemoteStateCache({ user_id: profile.user_id, cd, cycle_date: CYCLE_DATE, state: next });
        return next;
      });
      await refreshPending();
      setMsg("Evento salvo offline.");
      return;
    }

    await applyInventarioEvent({
      event_type: eventType,
      payload,
      client_event_id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `inv-${Date.now()}`
    });
    await pull();
    await refreshPending();
    setMsg("Evento aplicado.");
  }, [cd, isOnline, preferOffline, profile, pull, refreshPending]);

  useEffect(() => {
    let canceled = false;
    const init = async () => {
      try {
        const prefs = await getInventarioPreferences(profile.user_id);
        if (canceled) return;
        setPreferOffline(Boolean(prefs.prefer_offline_mode));
        if (fixed != null) setCd(fixed); else if (prefs.cd_ativo != null) setCd(prefs.cd_ativo);
        if (isGlobalAdmin && isOnline) setCdOptions(await fetchCdOptions());
      } catch (error) {
        if (!canceled) setErr(parseErr(error));
      }
    };
    void init();
    return () => { canceled = true; };
  }, [fixed, isGlobalAdmin, isOnline, profile.user_id]);

  useEffect(() => { if (fixed == null) void saveInventarioPreferences(profile.user_id, { cd_ativo: cd, prefer_offline_mode: preferOffline } satisfies InventarioPreferences); }, [cd, fixed, preferOffline, profile.user_id]);
  useEffect(() => { if (cd != null) { void loadLocal(); void refreshPending(); void getDbBarrasMeta().then((m) => setDbBarrasCount(m.row_count)); if (isOnline) void syncNow(false); } }, [cd, isOnline, loadLocal, refreshPending, syncNow]);
  useEffect(() => { if (!isOnline || cd == null) return; const id = window.setInterval(() => { void syncNow(false); }, 30000); return () => window.clearInterval(id); }, [cd, isOnline, syncNow]);
  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    if (!isDesktop) setReportOpen(false);
  }, [isDesktop]);

  useEffect(() => {
    const needsLock = (tab === "s1" || tab === "s2") && isOnline && cd != null && zone && canEdit;
    if (!needsLock) { if (lockRef.current) void releaseZoneLock(lockRef.current.lock_id); setLock(null); return; }
    let canceled = false;
    void (async () => {
      try {
        if (lockRef.current) {
          await releaseZoneLock(lockRef.current.lock_id);
          lockRef.current = null;
          setLock(null);
        }
        const l = await acquireZoneLock(cd!, CYCLE_DATE, zone!, tab === "s2" ? 2 : 1, 900);
        if (!canceled) {
          setLock(l);
          lockRef.current = l;
        } else {
          await releaseZoneLock(l.lock_id);
        }
      } catch (e) {
        if (!canceled) setErr(parseErr(e));
      }
    })();
    return () => { canceled = true; };
  }, [canEdit, cd, isOnline, tab, zone]);

  useEffect(() => {
    if (!lock || !isOnline) return;
    const id = window.setInterval(() => { void heartbeatZoneLock(lock.lock_id, 900).then((l) => { setLock(l); lockRef.current = l; }).catch(() => {}); }, 60000);
    return () => window.clearInterval(id);
  }, [isOnline, lock]);

  useEffect(() => {
    return () => {
      if (lockRef.current) void releaseZoneLock(lockRef.current.lock_id);
    };
  }, []);

  const rows = useMemo(() => derive(manifestItems, remoteState), [manifestItems, remoteState]);
  const stageUniverse = useMemo(() => rows.filter((r) => rowMatchesStageUniverse(r, tab)), [rows, tab]);
  const zones = useMemo(
    () => Array.from(new Set(stageUniverse.map((r) => r.zona))).sort((a, b) => a.localeCompare(b)),
    [stageUniverse]
  );

  useEffect(() => {
    if (!zone && zones.length) {
      setZone(zones[0]);
      return;
    }

    if (zone && !zones.includes(zone)) {
      setZone(zones[0] ?? null);
    }
  }, [zone, zones]);

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    return stageUniverse.filter((r) => {
      if (zone && r.zona !== zone) return false;
      if (!rowMatchesStageStatus(r, tab, statusFilter, reviewFilter)) return false;
      if (!q) return true;
      return `${r.zona} ${r.endereco} ${r.coddv} ${r.descricao}`.toLocaleLowerCase("pt-BR").includes(q);
    });
  }, [reviewFilter, search, stageUniverse, statusFilter, tab, zone]);

  const addressBuckets = useMemo<AddressBucketView[]>(() => {
    const map = new Map<string, AddressBucketView>();

    for (const row of visible) {
      const key = addressKeyOf(row.zona, row.endereco);
      const existing = map.get(key);
      const isPending = tab === "s1"
        ? isS1Pending(row)
        : tab === "s2"
          ? isS2Pending(row)
          : tab === "conciliation"
            ? isConciliationPending(row)
            : false;

      if (existing) {
        existing.items.push(row);
        existing.total_items += 1;
        if (isPending) existing.pending_items += 1;
        else existing.done_items += 1;
      } else {
        map.set(key, {
          key,
          zona: row.zona,
          endereco: row.endereco,
          total_items: 1,
          pending_items: isPending ? 1 : 0,
          done_items: isPending ? 0 : 1,
          items: [row]
        });
      }
    }

    const list = Array.from(map.values());
    for (const bucket of list) {
      bucket.items.sort((a, b) => a.coddv - b.coddv);
    }
    list.sort((a, b) => {
      const byEndereco = a.endereco.localeCompare(b.endereco);
      if (byEndereco !== 0) return byEndereco;
      return a.zona.localeCompare(b.zona);
    });
    return list;
  }, [tab, visible]);

  useEffect(() => {
    if (!selectedAddress || !addressBuckets.some((b) => b.key === selectedAddress)) {
      setSelectedAddress(addressBuckets[0]?.key ?? null);
    }
  }, [addressBuckets, selectedAddress]);

  const activeAddress = useMemo(
    () => addressBuckets.find((b) => b.key === selectedAddress) ?? null,
    [addressBuckets, selectedAddress]
  );

  useEffect(() => {
    const items = activeAddress?.items ?? [];
    if (!selectedItem || !items.some((item) => item.key === selectedItem)) {
      setSelectedItem(items[0]?.key ?? null);
    }
  }, [activeAddress, selectedItem]);

  const active = useMemo(() => {
    const items = activeAddress?.items ?? [];
    if (!items.length) return null;
    if (!selectedItem) return items[0];
    return items.find((row) => row.key === selectedItem) ?? items[0];
  }, [activeAddress, selectedItem]);

  useEffect(() => {
    if (!active) {
      setQtd("0");
      setBarras("");
      setFinalQtd("0");
      setFinalBarras("");
      return;
    }

    const currentCount = tab === "s2" ? active.c2 : active.c1;
    setQtd(String(currentCount?.qtd_contada ?? 0));
    setBarras(currentCount?.barras ?? "");

    const suggestedFinal = active.review?.final_qtd
      ?? active.c2?.qtd_contada
      ?? active.c1?.qtd_contada
      ?? 0;
    setFinalQtd(String(suggestedFinal));
    setFinalBarras(active.review?.final_barras ?? "");
  }, [active, tab]);

  useEffect(() => {
    if (!editorOpen) return;
    if (!active) setEditorOpen(false);
  }, [active, editorOpen]);

  const canEditCount = useCallback((row: Row | null): boolean => {
    if (!row || !canEdit) return false;

    if (tab === "s1") {
      if (row.review?.status === "resolvido") return false;
      if (row.c2 != null) return false;
      if (row.c1 == null) return true;
      return row.c1.counted_by === profile.user_id;
    }

    if (tab === "s2") {
      if (!isS2Eligible(row)) return false;
      if (row.review?.status === "resolvido") return false;
      if (row.c2 == null) return row.c1!.counted_by !== profile.user_id;
      return row.c2.counted_by === profile.user_id;
    }

    return false;
  }, [canEdit, profile.user_id, tab]);

  const canResolveConciliation = useMemo(
    () => canEdit && tab === "conciliation" && active?.review?.status === "pendente",
    [active?.review?.status, canEdit, tab]
  );

  const validateBarras = useCallback(async (coddv: number, value: string): Promise<string> => {
    const n = normalizeBarcode(value);
    if (!n) throw new Error("Informe o código de barras.");
    let found = await getDbBarrasByBarcode(n);
    if (!found && isOnline) {
      const online = await fetchDbBarrasByBarcodeOnline(n);
      if (online) { await upsertDbBarrasCacheRow(online); found = online; }
    }
    if (!found) throw new Error("Código de barras não encontrado na base.");
    if (found.coddv !== coddv) throw new Error("Código de barras inválido para este CODDV.");
    return found.barras;
  }, [isOnline]);

  const saveCount = useCallback(async (discarded: boolean) => {
    if (!active || cd == null) return;
    if (!(tab === "s1" || tab === "s2")) return;
    if (!canEditCount(active)) {
      setErr("Você não pode editar este item nesta etapa.");
      return;
    }

    setErr(null);
    try {
      const etapa = tab === "s2" ? 2 : 1;
      const qty = discarded ? 0 : Number.parseInt(qtd, 10);
      if (!discarded && (!Number.isFinite(qty) || qty < 0)) return setErr("Quantidade inválida.");
      let b: string | null = null;
      if (!discarded && qty > active.estoque) b = await validateBarras(active.coddv, barras);
      await send("count_upsert", {
        cycle_date: CYCLE_DATE,
        cd,
        zona: active.zona,
        endereco: active.endereco,
        coddv: active.coddv,
        descricao: active.descricao,
        estoque: active.estoque,
        etapa,
        qtd_contada: qty,
        barras: b,
        discarded
      });
    } catch (error) {
      setErr(parseErr(error));
    }
  }, [active, barras, canEditCount, cd, qtd, send, tab, validateBarras]);

  const resolveReview = useCallback(async () => {
    if (!active || !active.review || cd == null) return;
    if (!canResolveConciliation) {
      setErr("Conciliação já resolvida ou sem permissão de edição.");
      return;
    }
    setErr(null);
    try {
      const qty = Number.parseInt(finalQtd, 10);
      if (!Number.isFinite(qty) || qty < 0) return setErr("Quantidade final inválida.");
      let b: string | null = null;
      if (qty > active.estoque) b = await validateBarras(active.coddv, finalBarras);
      await send("review_resolve", {
        cycle_date: CYCLE_DATE,
        cd,
        zona: active.zona,
        endereco: active.endereco,
        coddv: active.coddv,
        estoque: active.estoque,
        final_qtd: qty,
        final_barras: b
      });
    } catch (error) {
      setErr(parseErr(error));
    }
  }, [active, canResolveConciliation, cd, finalBarras, finalQtd, send, validateBarras]);

  const exportReport = useCallback(async () => {
    if (!canExport || cd == null) return;
    const total = await countReportRows({ dt_ini: dtIni, dt_fim: dtFim, cd });
    setReportCount(total);
    const rowsReport = await fetchReportRows({ dt_ini: dtIni, dt_fim: dtFim, cd, limit: 30000 });
    const XLSX = await import("xlsx");
    const detail = rowsReport.map((r) => ({
      Data: r.cycle_date,
      CD: r.cd,
      Zona: r.zona,
      Endereco: r.endereco,
      CODDV: r.coddv,
      Descricao: r.descricao,
      Estoque: r.estoque,
      QtdPrimeira: r.qtd_primeira,
      QtdSegunda: r.qtd_segunda,
      QtdFinal: r.contado_final,
      BarrasFinal: r.barras_final,
      DivergenciaFinal: r.divergencia_final,
      StatusFinal: r.status_final,
      UsuarioPrimeira: `${r.primeira_nome ?? "-"} (${r.primeira_mat ?? "-"})`,
      UsuarioSegunda: `${r.segunda_nome ?? "-"} (${r.segunda_mat ?? "-"})`,
      UsuarioRevisao: `${r.review_resolved_nome ?? "-"} (${r.review_resolved_mat ?? "-"})`
    }));
    const summary = Array.from(rowsReport.reduce((acc, r) => {
      const z = r.zona;
      const cur = acc.get(z) ?? { Zona: z, Total: 0, Concluidos: 0, Pendentes: 0 };
      cur.Total += 1;
      if (r.status_final === "concluido") cur.Concluidos += 1; else cur.Pendentes += 1;
      acc.set(z, cur);
      return acc;
    }, new Map<string, { Zona: string; Total: number; Concluidos: number; Pendentes: number }>()).values());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "Detalhe");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Resumo por Zona");
    XLSX.writeFile(wb, `inventario-zerados-${dtIni}-${dtFim}-cd${String(cd).padStart(2, "0")}.xlsx`, { compression: true });
  }, [canExport, cd, dtFim, dtIni]);

  return (
    <>
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
            <span className="module-back-icon" aria-hidden="true"><BackIcon /></span>
            <span>Início</span>
          </Link>
          <div className="module-topbar-user-side">
            <PendingSyncBadge pendingCount={pendingCount} title="Eventos pendentes" />
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>{isOnline ? "Online" : "Offline"}</span>
          </div>
        </div>
        <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
          <span className="module-icon" aria-hidden="true"><ModuleIcon name={MODULE_DEF.icon} /></span>
          <span className="module-title">{MODULE_DEF.title}</span>
        </div>
      </header>

      <section className="modules-shell termo-shell inventario-shell">
        <div className="termo-head">
          <h2>Olá, {userName}</h2>
          <p className="termo-meta-line">{`Ciclo ${CYCLE_DATE} | db_inventario: ${manifestItems.length}/${manifestMeta?.row_count ?? 0} | db_barras: ${dbBarrasCount}`}</p>
          <div className="inventario-base-chips">
            <span className={`inventario-base-chip ${manifestMeta && manifestItems.length >= manifestMeta.row_count ? "ok" : "warn"}`}>{`db_inventario ${manifestItems.length}/${manifestMeta?.row_count ?? 0}`}</span>
            <span className={`inventario-base-chip ${dbBarrasCount > 0 ? "ok" : "warn"}`}>{`db_barras ${dbBarrasCount}`}</span>
          </div>
        </div>
        {err ? <div className="alert error">{err}</div> : null}
        {msg ? <div className="alert success">{msg}</div> : null}

        <div className="termo-actions-row inventario-toolbar">
          {fixed != null ? <input disabled value={`CD ${String(fixed).padStart(2, "0")}`} /> : (
            <select value={cd ?? ""} onChange={(e) => setCd(e.target.value ? Number.parseInt(e.target.value, 10) : null)}>
              <option value="">Selecione CD</option>
              {cdOptions.map((o) => <option key={o.cd} value={o.cd}>{`CD ${String(o.cd).padStart(2, "0")} - ${o.cd_nome}`}</option>)}
            </select>
          )}
          <button className={`btn btn-muted termo-offline-toggle${preferOffline ? " is-active" : ""}`} type="button" onClick={() => setPreferOffline((v) => !v)}>
            {preferOffline ? "Offline local" : "Online"}
          </button>
          <button className="btn btn-muted" type="button" onClick={() => void syncNow(true)} disabled={!isOnline || busy || cd == null}>{busy ? "Sincronizando..." : "Sincronizar"}</button>
          {canExport && isDesktop ? (
            <button
              type="button"
              className="btn btn-muted inventario-report-icon-btn"
              onClick={() => setReportOpen(true)}
              title="Relatório XLSX (Admin)"
              aria-label="Abrir relatório XLSX"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="3" width="16" height="18" rx="2" />
                <path d="M8 8h8" />
                <path d="M8 12h8" />
                <path d="M8 16h5" />
              </svg>
            </button>
          ) : null}
        </div>

        <div className="termo-actions-row inventario-tabs">
          <button type="button" className={`inventario-tab-btn${tab === "s1" ? " active" : ""}`} onClick={() => setTab("s1")}>1ª Verificação</button>
          <button type="button" className={`inventario-tab-btn${tab === "s2" ? " active" : ""}`} onClick={() => setTab("s2")}>2ª Verificação</button>
          <button type="button" className={`inventario-tab-btn${tab === "conciliation" ? " active" : ""}`} onClick={() => setTab("conciliation")}>Conciliação</button>
          <button type="button" className={`inventario-tab-btn${tab === "done" ? " active" : ""}`} onClick={() => setTab("done")}>Concluídos</button>
        </div>

        <div className="termo-actions-row inventario-subfilters">
          {(tab === "s1" || tab === "s2") ? (
            <>
              <button type="button" className={`btn btn-muted${statusFilter === "pendente" ? " is-active" : ""}`} onClick={() => setStatusFilter("pendente")}>Pendentes</button>
              <button type="button" className={`btn btn-muted${statusFilter === "concluido" ? " is-active" : ""}`} onClick={() => setStatusFilter("concluido")}>Concluídos</button>
            </>
          ) : null}
          {tab === "conciliation" ? (
            <>
              <button type="button" className={`btn btn-muted${reviewFilter === "pendente" ? " is-active" : ""}`} onClick={() => setReviewFilter("pendente")}>Pendentes</button>
              <button type="button" className={`btn btn-muted${reviewFilter === "resolvido" ? " is-active" : ""}`} onClick={() => setReviewFilter("resolvido")}>Resolvidos</button>
            </>
          ) : null}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar endereço, CODDV ou descrição" />
        </div>

        <div className="inventario-zones">{zones.map((z) => <button type="button" key={z} className={`inventario-zone-chip${zone === z ? " active" : ""}`} onClick={() => setZone(z)}>{z}</button>)}</div>

        <div className="inventario-layout">
          <div className="termo-form inventario-address-panel">
            <h3>{`Endereços - ${stageLabel(tab)}`}</h3>
            <p className="inventario-editor-text">{`${addressBuckets.length} endereço(s)`}</p>

            <div className="inventario-address-list">
              {addressBuckets.map((bucket) => (
                <button
                  type="button"
                  key={bucket.key}
                  className={`inventario-address-card${selectedAddress === bucket.key ? " active" : ""}`}
                  onClick={() => {
                    setSelectedAddress(bucket.key);
                    setSelectedItem(bucket.items[0]?.key ?? null);
                    setEditorOpen(true);
                  }}
                >
                  <div>
                    <strong>{bucket.endereco}</strong>
                    <p>{`${bucket.total_items} item(ns)`}</p>
                  </div>
                  <span className={`termo-divergencia ${bucket.pending_items > 0 ? "andamento" : "correto"}`}>
                    {bucket.pending_items > 0 ? `${bucket.pending_items} pendente(s)` : `${bucket.done_items} concluído(s)`}
                  </span>
                </button>
              ))}
              {addressBuckets.length === 0 ? (
                <div className="inventario-empty-card"><p>Nenhum endereço para os filtros selecionados.</p></div>
              ) : null}
            </div>
          </div>

          <div className="termo-form inventario-editor-hint">
            <h3>Edição em Popup</h3>
            <p className="inventario-editor-text">Toque no endereço para abrir o popup de conferência.</p>
            <p className="inventario-editor-text">Fluxo otimizado para uso no navegador do celular.</p>
          </div>
        </div>

        {editorOpen && active ? (
          <div className="inventario-popup-overlay" role="dialog" aria-modal="true" onClick={() => setEditorOpen(false)}>
            <div className="inventario-popup-card" onClick={(event) => event.stopPropagation()}>
              <div className="inventario-popup-head">
                <div>
                  <h3>{active.endereco}</h3>
                  <p>{`${stageLabel(tab)} | CODDV ${active.coddv}`}</p>
                </div>
                <button type="button" className="inventario-popup-close" onClick={() => setEditorOpen(false)} aria-label="Fechar popup">Fechar</button>
              </div>
              <div className="inventario-popup-body">
                <p className="inventario-editor-text">{active.descricao}</p>
                {(tab === "s1" || tab === "s2") ? (
                  <>
                    <label>Quantidade<input value={qtd} onChange={(e) => setQtd(e.target.value)} disabled={!canEditCount(active) || busy} /></label>
                    <label>Barras (obrigatório se sobra)<input value={barras} onChange={(e) => setBarras(e.target.value)} disabled={!canEditCount(active) || busy} /></label>
                    <div className="inventario-editor-actions">
                      <button className="btn btn-primary" type="button" disabled={!canEditCount(active) || busy} onClick={() => void saveCount(false)}>Salvar</button>
                      <button className="btn btn-muted" type="button" disabled={!canEditCount(active) || busy} onClick={() => void saveCount(true)}>Descartar</button>
                    </div>
                  </>
                ) : null}
                {tab === "conciliation" ? (
                  <>
                    <div className="inventario-conciliation-grid">
                      <article className="inventario-conciliation-card">
                        <h4>1ª Verificação</h4>
                        <p>{`Qtd: ${active.c1?.qtd_contada ?? "-"}`}</p>
                        <p>{`Barras: ${active.c1?.barras ?? "-"}`}</p>
                        <p>{`Usuário: ${active.c1?.counted_nome ?? "-"}`}</p>
                      </article>
                      <article className="inventario-conciliation-card">
                        <h4>2ª Verificação</h4>
                        <p>{`Qtd: ${active.c2?.qtd_contada ?? "-"}`}</p>
                        <p>{`Barras: ${active.c2?.barras ?? "-"}`}</p>
                        <p>{`Usuário: ${active.c2?.counted_nome ?? "-"}`}</p>
                      </article>
                    </div>
                    <label>Qtd final<input value={finalQtd} onChange={(e) => setFinalQtd(e.target.value)} disabled={!canResolveConciliation || busy} /></label>
                    <label>Barras final (obrigatório se sobra)<input value={finalBarras} onChange={(e) => setFinalBarras(e.target.value)} disabled={!canResolveConciliation || busy} /></label>
                    <div className="inventario-editor-actions"><button className="btn btn-primary" type="button" disabled={!canResolveConciliation || busy} onClick={() => void resolveReview()}>Resolver conciliação</button></div>
                  </>
                ) : null}
                {tab === "done" ? <p className="inventario-editor-text">Item concluído e imutável.</p> : null}
              </div>
            </div>
          </div>
        ) : null}

        {canExport && isDesktop && reportOpen ? (
          <div className="inventario-popup-overlay" role="dialog" aria-modal="true" onClick={() => setReportOpen(false)}>
            <div className="inventario-popup-card inventario-report-popup" onClick={(event) => event.stopPropagation()}>
              <div className="inventario-popup-head">
                <div>
                  <h3>Relatório XLSX (Admin)</h3>
                  <p>Defina o período e exporte.</p>
                </div>
                <button type="button" className="inventario-popup-close" onClick={() => setReportOpen(false)} aria-label="Fechar popup">Fechar</button>
              </div>
              <div className="inventario-popup-body">
                <div className="inventario-report-filters">
                  <label>Data inicial<input type="date" value={dtIni} onChange={(e) => setDtIni(e.target.value)} /></label>
                  <label>Data final<input type="date" value={dtFim} onChange={(e) => setDtFim(e.target.value)} /></label>
                  <label>CD<input disabled value={cd ?? ""} /></label>
                </div>
                <div className="inventario-report-actions">
                  <button className="btn btn-muted" type="button" onClick={() => void countReportRows({ dt_ini: dtIni, dt_fim: dtFim, cd: cd ?? -1 }).then(setReportCount).catch((e) => setErr(parseErr(e)))} disabled={cd == null}>Contar</button>
                  <button className="btn btn-primary" type="button" onClick={() => void exportReport().catch((e) => setErr(parseErr(e)))} disabled={cd == null}>Exportar XLSX</button>
                </div>
                {reportCount != null ? <p>{`Registros: ${reportCount}`}</p> : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
