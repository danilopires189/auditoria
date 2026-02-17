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
  InventarioSyncPullState
} from "./types";

interface InventarioPageProps {
  isOnline: boolean;
  profile: InventarioModuleProfile;
}

type Tab = "s1" | "s2" | "rev" | "done";

type Row = InventarioManifestItemRow & {
  key: string;
  c1: InventarioCountRow | null;
  c2: InventarioCountRow | null;
  review: InventarioReviewRow | null;
  final: boolean;
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
  return raw;
}

function defaultState(): InventarioSyncPullState {
  return { counts: [], reviews: [], locks: [], server_time: null };
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

  const [tab, setTab] = useState<Tab>("s1");
  const [statusFilter, setStatusFilter] = useState<"pendente" | "concluido">("pendente");
  const [reviewFilter, setReviewFilter] = useState<"pendente" | "resolvido">("pendente");
  const [zone, setZone] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<string | null>(null);
  const [qtd, setQtd] = useState("");
  const [barras, setBarras] = useState("");
  const [finalQtd, setFinalQtd] = useState("");
  const [finalBarras, setFinalBarras] = useState("");

  const [lock, setLock] = useState<InventarioLockAcquireResponse | null>(null);
  const lockRef = useRef<InventarioLockAcquireResponse | null>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [dtIni, setDtIni] = useState(CYCLE_DATE);
  const [dtFim, setDtFim] = useState(CYCLE_DATE);
  const [reportCount, setReportCount] = useState<number | null>(null);

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
      if (forceManifest || !localMeta || localMeta.manifest_hash !== remoteMeta.manifest_hash) {
        const bundle = await fetchManifestBundle(cd);
        await saveManifestSnapshot({ user_id: profile.user_id, cd, meta: bundle.meta, items: bundle.items });
        setManifestMeta(bundle.meta);
        setManifestItems(bundle.items);
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
  }, [cd, isOnline, profile.user_id, pull, syncPending]);

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
  const zones = useMemo(() => Array.from(new Set(rows.map((r) => r.zona))).sort((a, b) => a.localeCompare(b)), [rows]);
  useEffect(() => { if (!zone && zones.length) setZone(zones[0]); if (zone && !zones.includes(zone)) setZone(zones[0] ?? null); }, [zone, zones]);

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    return rows.filter((r) => {
      if (zone && r.zona !== zone) return false;
      if (q && !`${r.zona} ${r.endereco} ${r.coddv} ${r.descricao}`.toLocaleLowerCase("pt-BR").includes(q)) return false;
      if (tab === "s1") return statusFilter === "pendente" ? r.c1 == null : r.c1 != null;
      if (tab === "s2") {
        if (!r.c1 || r.c1.resultado !== "sobra") return false;
        return statusFilter === "pendente" ? r.c2 == null : r.c2 != null;
      }
      if (tab === "rev") return r.review != null && (reviewFilter === "pendente" ? r.review.status === "pendente" : r.review.status === "resolvido");
      return r.final;
    });
  }, [reviewFilter, rows, search, statusFilter, tab, zone]);

  useEffect(() => { if (!selected || !visible.some((r) => r.key === selected)) setSelected(visible[0]?.key ?? null); }, [selected, visible]);
  const active = useMemo(() => visible.find((r) => r.key === selected) ?? null, [selected, visible]);

  useEffect(() => {
    if (!active) return;
    setQtd(String((tab === "s2" ? active.c2?.qtd_contada : active.c1?.qtd_contada) ?? active.estoque));
    setBarras((tab === "s2" ? active.c2?.barras : active.c1?.barras) ?? "");
    setFinalQtd(String(active.review?.final_qtd ?? active.estoque));
    setFinalBarras(active.review?.final_barras ?? "");
  }, [active, tab]);

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
    if (!active || cd == null || !canEdit) return;
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
  }, [active, barras, canEdit, cd, qtd, send, tab, validateBarras]);

  const resolveReview = useCallback(async () => {
    if (!active || !active.review || cd == null) return;
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
  }, [active, cd, finalBarras, finalQtd, send, validateBarras]);

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
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>{isOnline ? "🟢 Online" : "🔴 Offline"}</span>
          </div>
        </div>
        <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
          <span className="module-icon" aria-hidden="true"><ModuleIcon name={MODULE_DEF.icon} /></span>
          <span className="module-title">{MODULE_DEF.title}</span>
        </div>
      </header>

      <section className="modules-shell inventario-shell">
        <div className="inventario-head"><h2>Olá, {userName}</h2><p>{`Ciclo ${CYCLE_DATE} | db_inventario: ${manifestItems.length} | db_barras: ${dbBarrasCount}`}</p></div>
        {err ? <div className="alert error">{err}</div> : null}
        {msg ? <div className="alert success">{msg}</div> : null}

        <div className="inventario-toolbar">
          {fixed != null ? <input disabled value={`CD ${String(fixed).padStart(2, "0")}`} /> : (
            <select value={cd ?? ""} onChange={(e) => setCd(e.target.value ? Number.parseInt(e.target.value, 10) : null)}>
              <option value="">Selecione CD</option>
              {cdOptions.map((o) => <option key={o.cd} value={o.cd}>{`CD ${String(o.cd).padStart(2, "0")} - ${o.cd_nome}`}</option>)}
            </select>
          )}
          <button className={`btn btn-muted${preferOffline ? " is-active" : ""}`} type="button" onClick={() => setPreferOffline((v) => !v)}>
            {preferOffline ? "Offline local" : "Online"}
          </button>
          <button className="btn btn-muted" type="button" onClick={() => void syncNow(true)} disabled={!isOnline || busy || cd == null}>{busy ? "Sincronizando..." : "Sincronizar"}</button>
        </div>

        <div className="inventario-tabs">
          <button type="button" className={`inventario-tab-btn${tab === "s1" ? " active" : ""}`} onClick={() => setTab("s1")}>1ª Verificação</button>
          <button type="button" className={`inventario-tab-btn${tab === "s2" ? " active" : ""}`} onClick={() => setTab("s2")}>2ª Verificação</button>
          <button type="button" className={`inventario-tab-btn${tab === "rev" ? " active" : ""}`} onClick={() => setTab("rev")}>Revisão</button>
          <button type="button" className={`inventario-tab-btn${tab === "done" ? " active" : ""}`} onClick={() => setTab("done")}>Concluídos</button>
        </div>

        <div className="inventario-subfilters">
          {(tab === "s1" || tab === "s2") ? (
            <>
              <button type="button" className={`btn btn-muted${statusFilter === "pendente" ? " is-active" : ""}`} onClick={() => setStatusFilter("pendente")}>Pendentes</button>
              <button type="button" className={`btn btn-muted${statusFilter === "concluido" ? " is-active" : ""}`} onClick={() => setStatusFilter("concluido")}>Concluídos</button>
            </>
          ) : null}
          {tab === "rev" ? (
            <>
              <button type="button" className={`btn btn-muted${reviewFilter === "pendente" ? " is-active" : ""}`} onClick={() => setReviewFilter("pendente")}>Pendentes</button>
              <button type="button" className={`btn btn-muted${reviewFilter === "resolvido" ? " is-active" : ""}`} onClick={() => setReviewFilter("resolvido")}>Resolvidos</button>
            </>
          ) : null}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar" />
        </div>

        <div className="inventario-zones">{zones.map((z) => <button type="button" key={z} className={`inventario-zone-chip${zone === z ? " active" : ""}`} onClick={() => setZone(z)}>{z}</button>)}</div>

        <div className="inventario-layout">
          <div className="inventario-list">
            {visible.map((r) => (
              <button key={r.key} type="button" className={`inventario-item-card${selected === r.key ? " active" : ""}${r.final ? " done" : ""}`} onClick={() => setSelected(r.key)}>
                <div className="inventario-item-top"><strong>{r.endereco}</strong><span>{`CODDV ${r.coddv}`}</span></div>
                <p>{r.descricao}</p>
                <div className="inventario-item-meta"><span>{`Estoque: ${r.estoque}`}</span>{r.c1 ? <span>{`1ª: ${r.c1.qtd_contada}`}</span> : <span>1ª pendente</span>}{r.c2 ? <span>{`2ª: ${r.c2.qtd_contada}`}</span> : null}{r.review ? <span>{`Revisão: ${r.review.status}`}</span> : null}</div>
              </button>
            ))}
          </div>

          <div className="inventario-editor">
            {active ? (
              <>
                <h3>{active.endereco}</h3>
                <p>{active.descricao}</p>
                <p>{`Zona ${active.zona} | Estoque ${active.estoque}`}</p>
                {(tab === "s1" || tab === "s2") ? (
                  <>
                    <label>Quantidade<input value={qtd} onChange={(e) => setQtd(e.target.value)} disabled={!canEdit || busy} /></label>
                    <label>Barras (se sobra)<input value={barras} onChange={(e) => setBarras(e.target.value)} disabled={!canEdit || busy} /></label>
                    <div className="inventario-editor-actions">
                      <button className="btn btn-primary" type="button" disabled={!canEdit || busy} onClick={() => void saveCount(false)}>Salvar</button>
                      <button className="btn btn-muted" type="button" disabled={!canEdit || busy} onClick={() => void saveCount(true)}>Descartar</button>
                    </div>
                  </>
                ) : null}
                {tab === "rev" ? (
                  <>
                    <label>Qtd final<input value={finalQtd} onChange={(e) => setFinalQtd(e.target.value)} disabled={!canEdit || busy} /></label>
                    <label>Barras final (se sobra)<input value={finalBarras} onChange={(e) => setFinalBarras(e.target.value)} disabled={!canEdit || busy} /></label>
                    <div className="inventario-editor-actions"><button className="btn btn-primary" type="button" disabled={!canEdit || busy} onClick={() => void resolveReview()}>Resolver revisão</button></div>
                  </>
                ) : null}
                {tab === "done" ? <p>Item finalizado (imutável).</p> : null}
              </>
            ) : <div className="inventario-empty-card"><p>Selecione um item.</p></div>}
          </div>
        </div>

        {canExport ? (
          <section className="inventario-report">
            <h3>Relatório XLSX (Admin)</h3>
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
          </section>
        ) : null}
      </section>
    </>
  );
}
