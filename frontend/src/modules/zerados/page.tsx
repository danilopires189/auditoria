import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import type { IScannerControls } from "@zxing/browser";
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
type MobileFlowStep = "stage" | "zone" | "address";
type ScannerTarget = "barras" | "final_barras";

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

type ZoneBucketView = {
  zona: string;
  total_addresses: number;
  done_addresses: number;
  pending_addresses: number;
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
  if (raw.includes("ETAPA2_APENAS_QUANDO_SOBRA")) return "2ª verificação só é permitida quando houver sobra na 1ª verificação.";
  if (raw.includes("ETAPA1_OBRIGATORIA")) return "A 1ª verificação precisa ser concluída antes da 2ª.";
  if (raw.includes("ZONA_TRAVADA_OUTRO_USUARIO")) return "Zona/etapa bloqueada por outro usuário.";
  if (raw.includes("APENAS_ADMIN")) return "Apenas admin pode exportar relatório.";
  if (raw.includes("MANIFESTO_INCOMPLETO")) return "Base local incompleta. Sincronize novamente para baixar todos os endereços.";
  if (raw.includes("ETAPA1_APENAS_AUTOR")) return "Apenas o autor pode editar a 1ª verificação.";
  if (raw.includes("ETAPA2_APENAS_AUTOR")) return "Apenas o autor pode editar a 2ª verificação.";
  if (raw.includes("ETAPA1_BLOQUEADA_SEGUNDA_EXISTE")) return "A 1ª verificação não pode ser alterada após existir 2ª verificação.";
  if (raw.includes("ITEM_JA_RESOLVIDO")) return "Endereço já resolvido na conciliação.";
  return raw;
}

function defaultState(): InventarioSyncPullState {
  return { counts: [], reviews: [], locks: [], server_time: null };
}

function refreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function listIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <circle cx="4" cy="6" r="1.2" />
      <circle cx="4" cy="12" r="1.2" />
      <circle cx="4" cy="18" r="1.2" />
    </svg>
  );
}

function searchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.7-3.7" />
    </svg>
  );
}

function reportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </svg>
  );
}

function cameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h4l1.5-2h5L16 7h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function closeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function flashIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {on ? <path d="M7 2h10l-4 7h5l-9 13 2-9H6z" /> : <path d="M7 2h10l-4 7h5l-9 13 2-9H6z" />}
      {!on ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function editIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20l4.6-1 9.8-9.8a1.8 1.8 0 0 0 0-2.5L16.4 5a1.8 1.8 0 0 0-2.5 0L4 14.8z" />
      <path d="M12.6 6.8l4.6 4.6" />
    </svg>
  );
}

function isS1Pending(row: Row): boolean {
  return row.c1 == null;
}

function isS2Eligible(row: Row): boolean {
  return row.c1 != null && row.c1.resultado === "sobra";
}

function isS2Pending(row: Row): boolean {
  return isS2Eligible(row) && row.c2 == null && row.review == null;
}

function isS2BlockedBySameUser(row: Row, userId: string): boolean {
  return isS2Eligible(row) && row.c2 == null && row.review == null && row.c1?.counted_by === userId;
}

function normalizeApplicableReview(
  review: InventarioReviewRow | null,
  c1: InventarioCountRow | null,
  c2: InventarioCountRow | null
): InventarioReviewRow | null {
  if (!review) return null;
  if (review.status === "resolvido") return review;

  if (review.reason_code === "sem_consenso") {
    if (!c1 || !c2) return null;
    if (c1.resultado === "descartado" || c2.resultado === "descartado") return null;
    if (c1.qtd_contada === c2.qtd_contada) return null;
    return review;
  }

  if (review.reason_code === "conflito_lock") {
    if (c2 != null) {
      if (!c1) return review;
      if (c1.resultado === "descartado" || c2.resultado === "descartado") return null;
      if (c1.qtd_contada === c2.qtd_contada) return null;
      return review;
    }
    if (c1 != null && c1.resultado === "sobra") return review;
    return null;
  }

  return null;
}

function isConciliationPending(row: Row): boolean {
  return row.review?.status === "pendente";
}

function rowMatchesStageUniverse(row: Row, stage: InventarioStageView): boolean {
  if (stage === "s1") return true;
  if (stage === "s2") return isS2Eligible(row) && row.review == null;
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

function labelByCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

type CountedDisplayInfo = {
  qtd: number | null;
  mat: string | null;
  nome: string | null;
};

type SnapshotCountInfo = {
  qtd: number | null;
  barras: string | null;
  nome: string | null;
  mat: string | null;
};

function parseSnapshotCountInfo(value: unknown): SnapshotCountInfo | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const qtdRaw = raw.qtd_contada;
  const qtdParsed = qtdRaw == null ? null : Number.parseInt(String(qtdRaw), 10);
  const barras = raw.barras == null ? null : String(raw.barras).trim() || null;
  const nomeSource = raw.counted_nome ?? raw.nome ?? raw.locked_nome ?? null;
  const nome = nomeSource == null ? null : String(nomeSource).trim() || null;
  const matSource = raw.counted_mat ?? raw.mat ?? raw.locked_mat ?? null;
  const mat = matSource == null ? null : String(matSource).trim() || null;

  return {
    qtd: Number.isFinite(qtdParsed ?? NaN) ? Math.max(qtdParsed as number, 0) : null,
    barras,
    nome,
    mat
  };
}

function extractReviewSnapshotCount(review: InventarioReviewRow | null, stage: 1 | 2): SnapshotCountInfo | null {
  if (!review?.snapshot || typeof review.snapshot !== "object") return null;
  const snapshot = review.snapshot as Record<string, unknown>;

  if (review.reason_code === "sem_consenso") {
    return parseSnapshotCountInfo(stage === 1 ? snapshot.primeira : snapshot.segunda);
  }

  if (review.reason_code === "conflito_lock" && stage === 2) {
    const eventInfo = parseSnapshotCountInfo(snapshot.event_payload);
    if (!eventInfo) return null;
    if (eventInfo.nome || eventInfo.mat) return eventInfo;
    const lockedNome = snapshot.locked_nome == null ? null : String(snapshot.locked_nome).trim() || null;
    const lockedMat = snapshot.locked_mat == null ? null : String(snapshot.locked_mat).trim() || null;
    return { ...eventInfo, nome: lockedNome, mat: lockedMat };
  }

  return null;
}

function pickText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const compact = value.trim();
    if (compact) return compact;
  }
  return null;
}

function resolveCountedDisplayInfo(row: Row, stage: InventarioStageView): CountedDisplayInfo | null {
  if (stage === "s1") {
    if (!row.c1) return null;
    return { qtd: row.c1.qtd_contada, mat: row.c1.counted_mat, nome: row.c1.counted_nome };
  }

  if (stage === "s2") {
    if (!row.c2) return null;
    return { qtd: row.c2.qtd_contada, mat: row.c2.counted_mat, nome: row.c2.counted_nome };
  }

  if (stage === "conciliation" || stage === "done") {
    if (row.review?.status === "resolvido") {
      const fallbackSource = row.c2 ?? row.c1 ?? null;
      return {
        qtd: row.review.final_qtd,
        mat: row.review.resolved_mat ?? fallbackSource?.counted_mat ?? null,
        nome: row.review.resolved_nome ?? fallbackSource?.counted_nome ?? null
      };
    }
    if (row.c2) return { qtd: row.c2.qtd_contada, mat: row.c2.counted_mat, nome: row.c2.counted_nome };
    if (row.c1) return { qtd: row.c1.qtd_contada, mat: row.c1.counted_mat, nome: row.c1.counted_nome };
  }

  return null;
}

function formatCountedByLine(nome: string | null): string | null {
  const nomeTrim = (nome ?? "").trim().replace(/\s+/g, " ");
  if (!nomeTrim) return null;

  return nomeTrim
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function formatConcludedByLine(info: CountedDisplayInfo | null): string {
  if (!info) return "Concluído por: Usuário não informado";

  const formattedName = formatCountedByLine(info.nome);
  if (formattedName) return `Concluído por: ${formattedName}`;

  const mat = (info.mat ?? "").trim();
  if (mat) return `Concluído por: Mat ${mat}`;

  return "Concluído por: Usuário não informado";
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
    const rawReview = reviews.get(k) ?? null;
    const review = normalizeApplicableReview(rawReview, c.c1, c.c2);
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
  const [validatedBarras, setValidatedBarras] = useState<string | null>(null);
  const [countEditMode, setCountEditMode] = useState(true);
  const [finalQtd, setFinalQtd] = useState("0");
  const [finalBarras, setFinalBarras] = useState("");

  const [lock, setLock] = useState<InventarioLockAcquireResponse | null>(null);
  const lockRef = useRef<InventarioLockAcquireResponse | null>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [popupErr, setPopupErr] = useState<string | null>(null);

  const [dtIni, setDtIni] = useState(CYCLE_DATE);
  const [dtFim, setDtFim] = useState(CYCLE_DATE);
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth >= 1024;
  });
  const [mobileStep, setMobileStep] = useState<MobileFlowStep>(() => {
    return "stage";
  });
  const [showZonePicker, setShowZonePicker] = useState(false);
  const [zoneSearchInput, setZoneSearchInput] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerTarget, setScannerTarget] = useState<ScannerTarget>("barras");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  const syncRef = useRef(false);
  const qtdInputRef = useRef<HTMLInputElement | null>(null);
  const finalQtdInputRef = useRef<HTMLInputElement | null>(null);
  const reportDtIniInputRef = useRef<HTMLInputElement | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerTrackRef = useRef<MediaStreamTrack | null>(null);
  const scannerTorchModeRef = useRef<"none" | "controls" | "track">("none");
  const popupWasOpenRef = useRef(false);
  const popupReturnFocusRef = useRef<HTMLElement | null>(null);
  const popupBodyRef = useRef<HTMLDivElement | null>(null);
  const cameraSupported = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }, []);

  useEffect(() => { lockRef.current = lock; }, [lock]);

  const closeEditorPopup = useCallback(() => {
    setPopupErr(null);
    setCountEditMode(true);
    setValidatedBarras(null);
    setScannerOpen(false);
    setScannerError(null);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTrackRef.current = null;
    scannerTorchModeRef.current = "none";
    setEditorOpen(false);
  }, []);

  const keepFocusedControlVisible = useCallback((event: FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = event.currentTarget;
    window.setTimeout(() => {
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }, 120);
  }, []);
  const focusAndSelectNumericInput = useCallback((event: FocusEvent<HTMLInputElement>) => {
    event.currentTarget.select();
    keepFocusedControlVisible(event);
  }, [keepFocusedControlVisible]);

  const resolveScannerTrack = useCallback((): MediaStreamTrack | null => {
    const videoEl = scannerVideoRef.current;
    if (videoEl?.srcObject instanceof MediaStream) {
      const [track] = videoEl.srcObject.getVideoTracks();
      return track ?? null;
    }
    return null;
  }, []);

  const supportsTrackTorch = useCallback((track: MediaStreamTrack | null): boolean => {
    if (!track) return false;
    const trackWithCaps = track as MediaStreamTrack & {
      getCapabilities?: () => MediaTrackCapabilities;
    };
    if (typeof trackWithCaps.getCapabilities !== "function") return false;
    const capabilities = trackWithCaps.getCapabilities();
    return Boolean((capabilities as { torch?: boolean } | null)?.torch);
  }, []);

  const stopCameraScanner = useCallback(() => {
    const controls = scannerControlsRef.current;
    const activeTrack = scannerTrackRef.current ?? resolveScannerTrack();
    if (controls) {
      if (controls.switchTorch && torchEnabled && scannerTorchModeRef.current === "controls") {
        void controls.switchTorch(false).catch(() => {
          // Ignore torch shutdown failures on unsupported browsers.
        });
      }
      controls.stop();
      scannerControlsRef.current = null;
    }
    if (activeTrack && torchEnabled && scannerTorchModeRef.current === "track") {
      const trackWithConstraints = activeTrack as MediaStreamTrack & {
        applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
      };
      if (typeof trackWithConstraints.applyConstraints === "function") {
        void trackWithConstraints
          .applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] })
          .catch(() => {
            // Ignore torch shutdown failures on unsupported browsers.
          });
      }
    }

    const videoEl = scannerVideoRef.current;
    if (videoEl && videoEl.srcObject instanceof MediaStream) {
      for (const track of videoEl.srcObject.getTracks()) {
        track.stop();
      }
      videoEl.srcObject = null;
    }
    scannerTrackRef.current = null;
    scannerTorchModeRef.current = "none";
  }, [resolveScannerTrack, torchEnabled]);

  const closeCameraScanner = useCallback(() => {
    stopCameraScanner();
    setScannerOpen(false);
    setScannerError(null);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTrackRef.current = null;
    scannerTorchModeRef.current = "none";
  }, [stopCameraScanner]);

  const openCameraScanner = useCallback((target: ScannerTarget) => {
    if (!cameraSupported) {
      setPopupErr("Câmera não disponível neste navegador/dispositivo.");
      return;
    }
    setPopupErr(null);
    setScannerError(null);
    setScannerTarget(target);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTrackRef.current = null;
    scannerTorchModeRef.current = "none";
    setScannerOpen(true);
  }, [cameraSupported]);

  const toggleTorch = useCallback(async () => {
    const controls = scannerControlsRef.current;
    const track = scannerTrackRef.current ?? resolveScannerTrack();
    if (!controls?.switchTorch && scannerTorchModeRef.current !== "track") {
      setScannerError("Flash não disponível neste dispositivo.");
      return;
    }
    try {
      const next = !torchEnabled;
      if (scannerTorchModeRef.current === "controls" && controls?.switchTorch) {
        await controls.switchTorch(next);
      } else {
        const trackWithConstraints = track as MediaStreamTrack & {
          applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
        };
        if (!trackWithConstraints || typeof trackWithConstraints.applyConstraints !== "function") {
          throw new Error("Track sem suporte de constraints");
        }
        await trackWithConstraints.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      }
      setTorchEnabled(next);
      setScannerError(null);
    } catch {
      setScannerError("Não foi possível alternar o flash.");
    }
  }, [resolveScannerTrack, torchEnabled]);

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
    const popupOpen = editorOpen || reportOpen || scannerOpen;
    if (popupOpen && !popupWasOpenRef.current) {
      popupReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (!popupOpen && popupWasOpenRef.current) {
      const target = popupReturnFocusRef.current;
      if (target && document.contains(target)) target.focus();
      popupReturnFocusRef.current = null;
    }
    popupWasOpenRef.current = popupOpen;
  }, [editorOpen, reportOpen, scannerOpen]);
  useEffect(() => {
    if (!(editorOpen || reportOpen || scannerOpen)) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [editorOpen, reportOpen, scannerOpen]);
  useEffect(() => {
    if (!editorOpen) return;
    const id = window.setTimeout(() => {
      popupBodyRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      if (tab === "conciliation") return;

      const target = qtdInputRef.current;
      if (!target || target.disabled) return;
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
      target.select();
    }, 80);
    return () => window.clearTimeout(id);
  }, [editorOpen, selectedItem, tab]);
  useEffect(() => {
    if (!editorOpen && scannerOpen) {
      closeCameraScanner();
    }
  }, [closeCameraScanner, editorOpen, scannerOpen]);
  useEffect(() => {
    if (!reportOpen) return;
    const id = window.setTimeout(() => {
      const target = reportDtIniInputRef.current;
      if (!target) return;
      target.focus();
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(id);
  }, [reportOpen]);
  useEffect(() => {
    if (!(editorOpen || reportOpen || scannerOpen)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (scannerOpen) closeCameraScanner();
      else if (reportOpen) setReportOpen(false);
      else closeEditorPopup();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeCameraScanner, closeEditorPopup, editorOpen, reportOpen, scannerOpen]);

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
    if (zone && !zones.includes(zone)) setZone(null);
  }, [zone, zones]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    return stageUniverse.filter((r) => {
      if (!rowMatchesStageStatus(r, tab, statusFilter, reviewFilter)) return false;
      if (!q) return true;
      return `${r.zona} ${r.endereco} ${r.coddv} ${r.descricao}`.toLocaleLowerCase("pt-BR").includes(q);
    });
  }, [reviewFilter, search, stageUniverse, statusFilter, tab]);

  const visible = useMemo(
    () => filteredRows.filter((r) => (zone ? r.zona === zone : true)),
    [filteredRows, zone]
  );

  const zoneBuckets = useMemo<ZoneBucketView[]>(() => {
    const zonesInCurrentFilter = new Set(filteredRows.map((row) => row.zona));
    const zoneMap = new Map<string, Map<string, { has_pending: boolean; has_done: boolean }>>();

    for (const row of stageUniverse) {
      if (!zonesInCurrentFilter.has(row.zona)) continue;
      const isPending = tab === "s1"
        ? isS1Pending(row)
        : tab === "s2"
          ? isS2Pending(row)
          : tab === "conciliation"
            ? isConciliationPending(row)
            : false;

      let addressMap = zoneMap.get(row.zona);
      if (!addressMap) {
        addressMap = new Map<string, { has_pending: boolean; has_done: boolean }>();
        zoneMap.set(row.zona, addressMap);
      }

      const addressState = addressMap.get(row.endereco) ?? { has_pending: false, has_done: false };
      if (isPending) addressState.has_pending = true;
      else addressState.has_done = true;
      addressMap.set(row.endereco, addressState);
    }

    return Array.from(zoneMap.entries())
      .map(([zona, addressMap]) => {
        let pending_addresses = 0;
        let done_addresses = 0;

        for (const state of addressMap.values()) {
          if (state.has_pending) pending_addresses += 1;
          else if (state.has_done) done_addresses += 1;
        }

        return {
          zona,
          total_addresses: addressMap.size,
          done_addresses,
          pending_addresses
        };
      })
      .sort((a, b) => a.zona.localeCompare(b.zona));
  }, [filteredRows, stageUniverse, tab]);
  const filteredZoneBuckets = useMemo(() => {
    const query = zoneSearchInput.trim().toLocaleLowerCase("pt-BR");
    if (!query) return zoneBuckets;
    return zoneBuckets.filter((bucket) => {
      return `${bucket.zona} ${bucket.total_addresses} ${bucket.done_addresses} ${bucket.pending_addresses}`.toLocaleLowerCase("pt-BR").includes(query);
    });
  }, [zoneBuckets, zoneSearchInput]);

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
    if (mobileStep !== "address" || !zone) {
      if (selectedAddress != null) setSelectedAddress(null);
      return;
    }
    if (!selectedAddress || !addressBuckets.some((b) => b.key === selectedAddress)) {
      setSelectedAddress(addressBuckets[0]?.key ?? null);
    }
  }, [addressBuckets, mobileStep, selectedAddress, zone]);

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
      setValidatedBarras(null);
      setFinalQtd("0");
      setFinalBarras("");
      return;
    }

    const currentCount = tab === "s2" ? active.c2 : active.c1;
    setQtd(String(currentCount?.qtd_contada ?? 0));
    setBarras(currentCount?.barras ?? "");
    setValidatedBarras(null);

    const suggestedFinal = active.review?.final_qtd
      ?? active.c2?.qtd_contada
      ?? active.c1?.qtd_contada
      ?? 0;
    setFinalQtd(String(suggestedFinal));
    setFinalBarras(active.review?.final_barras ?? "");
  }, [active?.key, active?.c1?.updated_at, active?.c2?.updated_at, active?.review?.updated_at, tab]);

  useEffect(() => {
    if (!editorOpen) return;
    if (!active) closeEditorPopup();
  }, [active, closeEditorPopup, editorOpen]);
  useEffect(() => {
    if (!editorOpen) {
      setPopupErr(null);
      return;
    }
    setPopupErr(null);
  }, [active?.key, editorOpen, tab]);
  useEffect(() => {
    if (!editorOpen) {
      setCountEditMode(true);
      return;
    }

    if ((tab === "s1" || tab === "s2") && statusFilter === "concluido") {
      setCountEditMode(false);
      return;
    }

    setCountEditMode(true);
  }, [active?.key, editorOpen, statusFilter, tab]);

  const canShowStageSelector = mobileStep === "stage";
  const canShowZoneSelector = mobileStep === "zone";
  const canShowAddressList = mobileStep === "address";
  const showTopContextBlocks = canShowStageSelector;

  const handleTabChange = useCallback((nextTab: InventarioStageView) => {
    setTab(nextTab);
    closeEditorPopup();
    setShowZonePicker(false);
    setZoneSearchInput("");
    setZone(null);
    setSelectedAddress(null);
    setSelectedItem(null);
    setSearch("");
    if (nextTab === "s1" || nextTab === "s2") setStatusFilter("pendente");
    if (nextTab === "conciliation") setReviewFilter("pendente");
    setMobileStep("zone");
  }, [closeEditorPopup]);

  const handleZoneSelect = useCallback((value: string) => {
    setShowZonePicker(false);
    setZoneSearchInput("");
    setZone(value);
    setSelectedAddress(null);
    setSelectedItem(null);
    setSearch("");
    setMobileStep("address");
  }, []);

  const openAddressEditor = useCallback((bucket: AddressBucketView) => {
    setSelectedAddress(bucket.key);
    setSelectedItem(bucket.items[0]?.key ?? null);
    setEditorOpen(true);
  }, []);

  const advanceAfterAction = useCallback((addressKey: string | null, itemKey: string | null) => {
    if (!addressKey || !itemKey) {
      closeEditorPopup();
      return;
    }

    const addressIndex = addressBuckets.findIndex((bucket) => bucket.key === addressKey);
    if (addressIndex < 0) {
      closeEditorPopup();
      setMobileStep("zone");
      return;
    }

    const sameAddressItems = addressBuckets[addressIndex].items;
    const itemIndex = sameAddressItems.findIndex((row) => row.key === itemKey);
    if (itemIndex >= 0 && itemIndex + 1 < sameAddressItems.length) {
      setSelectedAddress(addressKey);
      setSelectedItem(sameAddressItems[itemIndex + 1].key);
      setEditorOpen(true);
      return;
    }

    for (let index = addressIndex + 1; index < addressBuckets.length; index += 1) {
      const nextBucket = addressBuckets[index];
      if (!nextBucket.items.length) continue;
      setSelectedAddress(nextBucket.key);
      setSelectedItem(nextBucket.items[0].key);
      setEditorOpen(true);
      return;
    }

    closeEditorPopup();
    setSelectedAddress(null);
    setSelectedItem(null);
    setShowZonePicker(false);
    setZoneSearchInput("");
    setZone(null);
    setSearch("");
    setMobileStep("zone");
    setMsg("Zona concluída. Selecione a próxima zona.");
  }, [addressBuckets, closeEditorPopup]);

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

  const activeStageCount = useMemo(() => {
    if (!active || !(tab === "s1" || tab === "s2")) return null;
    return tab === "s2" ? active.c2 : active.c1;
  }, [active, tab]);
  const isConcludedCountFilter = (tab === "s1" || tab === "s2") && statusFilter === "concluido";
  const canEditConcludedCount = Boolean(isConcludedCountFilter && activeStageCount && canEditCount(active));
  const showCountReadOnlyDetails = Boolean(isConcludedCountFilter && activeStageCount && !countEditMode);

  const canResolveConciliation = useMemo(
    () => tab === "conciliation" && active?.review?.status === "pendente",
    [active?.review?.status, tab]
  );

  const qtyParsed = Number.parseInt(qtd, 10);
  const finalQtyParsed = Number.parseInt(finalQtd, 10);
  const requiresBarras = Boolean(
    active
    && (tab === "s1" || tab === "s2")
    && Number.isFinite(qtyParsed)
    && qtyParsed > active.estoque
  );
  const normalizedBarras = normalizeBarcode(barras);
  const barrasValidatedForCurrentInput = Boolean(
    requiresBarras
    && normalizedBarras
    && validatedBarras === normalizedBarras
  );
  const saveCountLabel = requiresBarras && !barrasValidatedForCurrentInput ? "Validar barras" : "Salvar";
  const requiresFinalBarras = Boolean(
    active
    && tab === "conciliation"
    && Number.isFinite(finalQtyParsed)
    && finalQtyParsed > active.estoque
  );
  const mobileStageMenu = useMemo(
    () => ([
      { view: "s1" as const, label: "1ª Verificação" },
      { view: "s2" as const, label: "2ª Verificação" },
      { view: "conciliation" as const, label: "Conciliação" },
      { view: "done" as const, label: "Concluídos" }
    ].map((entry) => ({
      ...entry,
      count: rows.filter((row) => rowMatchesStageUniverse(row, entry.view) && rowMatchesStageStatus(row, entry.view, statusFilter, reviewFilter)).length
    }))),
    [reviewFilter, rows, statusFilter]
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
      setPopupErr("Você não pode editar este endereço nesta etapa.");
      return;
    }

    setPopupErr(null);
    try {
      const currentAddressKey = selectedAddress;
      const currentItemKey = active.key;
      const etapa = tab === "s2" ? 2 : 1;
      const qty = discarded ? 0 : Number.parseInt(qtd, 10);
      if (!discarded && (!Number.isFinite(qty) || qty < 0)) return setPopupErr("Quantidade inválida.");
      let b: string | null = null;
      const needsBarrasValidation = !discarded && qty > active.estoque;
      if (needsBarrasValidation) {
        const normalized = normalizeBarcode(barras);
        if (!normalized) {
          setValidatedBarras(null);
          setPopupErr("Sobra detectada. Informe o código de barras ou descarte.");
          return;
        }

        if (validatedBarras !== normalized) {
          const validated = await validateBarras(active.coddv, normalized);
          setBarras(validated);
          setValidatedBarras(validated);
          setPopupErr(null);
          return;
        }
        b = normalized;
      }
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
      setValidatedBarras(null);
      advanceAfterAction(currentAddressKey, currentItemKey);
    } catch (error) {
      setValidatedBarras(null);
      setPopupErr(parseErr(error));
    }
  }, [active, advanceAfterAction, barras, canEditCount, cd, qtd, selectedAddress, send, tab, validateBarras, validatedBarras]);

  const resolveReview = useCallback(async () => {
    if (!active || !active.review || cd == null) return;
    if (!canResolveConciliation) {
      setPopupErr("Conciliação já resolvida.");
      return;
    }
    setPopupErr(null);
    try {
      const currentAddressKey = selectedAddress;
      const currentItemKey = active.key;
      const qty = Number.parseInt(finalQtd, 10);
      if (!Number.isFinite(qty) || qty < 0) return setPopupErr("Quantidade final inválida.");
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
      advanceAfterAction(currentAddressKey, currentItemKey);
    } catch (error) {
      setPopupErr(parseErr(error));
    }
  }, [active, advanceAfterAction, canResolveConciliation, cd, finalBarras, finalQtd, selectedAddress, send, validateBarras]);

  useEffect(() => {
    if (!scannerOpen) return;

    let cancelled = false;
    let torchProbeTimer: number | null = null;
    let torchProbeAttempts = 0;
    setScannerError(null);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTorchModeRef.current = "none";

    const startScanner = async () => {
      try {
        const zxing = await import("@zxing/browser");
        if (cancelled) return;

        const videoEl = scannerVideoRef.current;
        if (!videoEl) {
          setScannerError("Falha ao abrir visualização da câmera.");
          return;
        }

        const reader = new zxing.BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" }
            }
          },
          videoEl,
          (result, error) => {
            if (cancelled) return;

            if (result) {
              const scanned = normalizeBarcode(result.getText() ?? "");
              if (!scanned) return;

              if (scannerTarget === "final_barras") {
                setFinalBarras(scanned);
              } else {
                setBarras(scanned);
                setValidatedBarras(null);
              }

              closeCameraScanner();
              return;
            }

            const errorName = (error as { name?: string } | null)?.name;
            if (error && errorName !== "NotFoundException" && errorName !== "ChecksumException" && errorName !== "FormatException") {
              setScannerError("Não foi possível ler o código. Aproxime a câmera e tente novamente.");
            }
          }
        );

        if (cancelled) {
          controls.stop();
          return;
        }
        scannerControlsRef.current = controls;
        const probeTorchAvailability = () => {
          if (cancelled) return;
          if (typeof controls.switchTorch === "function") {
            scannerTorchModeRef.current = "controls";
            setTorchSupported(true);
            return;
          }
          const track = resolveScannerTrack();
          if (track) {
            scannerTrackRef.current = track;
          }
          if (supportsTrackTorch(track)) {
            scannerTorchModeRef.current = "track";
            setTorchSupported(true);
            return;
          }
          if (torchProbeAttempts < 10) {
            torchProbeAttempts += 1;
            torchProbeTimer = window.setTimeout(probeTorchAvailability, 120);
            return;
          }
          scannerTorchModeRef.current = "none";
          setTorchSupported(false);
        };

        probeTorchAvailability();
      } catch (error) {
        setScannerError(error instanceof Error ? error.message : "Falha ao iniciar câmera para leitura.");
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      if (torchProbeTimer != null) {
        window.clearTimeout(torchProbeTimer);
      }
      stopCameraScanner();
    };
  }, [closeCameraScanner, resolveScannerTrack, scannerOpen, scannerTarget, stopCameraScanner, supportsTrackTorch]);

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
        {showTopContextBlocks ? (
          <>
            <div className="termo-head">
              <div className="inventario-head-row">
                <h2>Olá, {userName}</h2>
                {canExport && isDesktop ? (
                  <button
                    type="button"
                    className="btn btn-muted termo-route-btn inventario-report-inline-btn"
                    onClick={() => setReportOpen(true)}
                    title="Gerar Relatório"
                    aria-label="Gerar Relatório"
                  >
                    <span aria-hidden="true">{reportIcon()}</span>
                    Gerar Relatório
                  </button>
                ) : null}
              </div>
              <p className="termo-meta-line">{`Ciclo ${CYCLE_DATE} | db_inventario: ${manifestItems.length}/${manifestMeta?.row_count ?? 0} | db_barras: ${dbBarrasCount}`}</p>
              <div className="inventario-base-chips">
                <span className={`inventario-base-chip ${manifestMeta && manifestItems.length >= manifestMeta.row_count ? "ok" : "warn"}`}>{`db_inventario ${manifestItems.length}/${manifestMeta?.row_count ?? 0}`}</span>
                <span className={`inventario-base-chip ${dbBarrasCount > 0 ? "ok" : "warn"}`}>{`db_barras ${dbBarrasCount}`}</span>
              </div>
            </div>
            {err ? <div className="alert error">{err}</div> : null}
            {msg ? <div className="alert success">{msg}</div> : null}

            <div className="termo-actions-row inventario-toolbar">
              {isGlobalAdmin ? (
                <select value={cd ?? ""} onChange={(e) => setCd(e.target.value ? Number.parseInt(e.target.value, 10) : null)}>
                  <option value="">Selecione CD</option>
                  {cdOptions.map((o) => <option key={o.cd} value={o.cd}>{`CD ${String(o.cd).padStart(2, "0")} - ${o.cd_nome}`}</option>)}
                </select>
              ) : null}
              <button
                type="button"
                className="btn btn-muted termo-sync-btn"
                onClick={() => void syncNow(true)}
                disabled={!isOnline || busy || cd == null}
              >
                <span aria-hidden="true">{refreshIcon()}</span>
                {busy ? "Sincronizando..." : "Sincronizar agora"}
              </button>
              <button
                className={`btn btn-muted termo-offline-toggle${preferOffline ? " is-active" : ""}`}
                type="button"
                onClick={() => setPreferOffline((v) => !v)}
              >
                {preferOffline ? "📦 Offline ativo" : "📶 Trabalhar offline"}
              </button>
            </div>
          </>
        ) : null}

        {canShowStageSelector ? (
          <div className="termo-form inventario-mobile-stage-card">
            <h3>Selecione a etapa</h3>
            <div className="inventario-mobile-stage-list">
              {mobileStageMenu.map((stageEntry) => (
                <button
                  key={stageEntry.view}
                  type="button"
                  className={`inventario-mobile-stage-btn${tab === stageEntry.view ? " active" : ""}`}
                  onClick={() => handleTabChange(stageEntry.view)}
                >
                  <span>{stageEntry.label}</span>
                  <small>{labelByCount(stageEntry.count, "endereço", "endereços")}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {!canShowStageSelector ? (
          <div className="inventario-mobile-nav">
            <button
              type="button"
              className="btn btn-muted inventario-mobile-back-btn"
              onClick={() => {
                closeEditorPopup();
                if (mobileStep === "address") {
                  setSelectedAddress(null);
                  setSelectedItem(null);
                  setShowZonePicker(false);
                  setZoneSearchInput("");
                  setSearch("");
                  setMobileStep("zone");
                  return;
                }
                setShowZonePicker(false);
                setZoneSearchInput("");
                setZone(null);
                setSearch("");
                setMobileStep("stage");
              }}
            >
              Voltar
            </button>
            {mobileStep === "zone" ? (
              <p className="inventario-editor-text">{`Etapa atual: ${stageLabel(tab)}`}</p>
            ) : (
              <div className="inventario-zone-current-row">
                <p className="inventario-editor-text">{`Zona atual: ${zone ?? "-"}`}</p>
                <button
                  type="button"
                  className="btn btn-muted termo-route-btn inventario-change-zone-btn"
                  onClick={() => setShowZonePicker(true)}
                  disabled={zoneBuckets.length === 0}
                >
                  <span aria-hidden="true">{listIcon()}</span>
                  Alterar Zona
                </button>
              </div>
            )}
          </div>
        ) : null}

        {!canShowStageSelector ? (
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
            {canShowAddressList ? (
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar" />
            ) : null}
          </div>
        ) : null}

        {canShowZoneSelector ? (
          <div className="termo-form inventario-zone-list-mobile">
            <h3>{`Zonas - ${stageLabel(tab)}`}</h3>
            <p className="inventario-editor-text">Use o botão abaixo para escolher entre as zonas disponíveis.</p>
            <button type="button" className="btn btn-muted termo-route-btn inventario-zone-picker-btn" onClick={() => setShowZonePicker(true)} disabled={zoneBuckets.length === 0}>
              Escolher zona
            </button>
            {zone ? <p className="inventario-editor-text">{`Zona atual: ${zone}`}</p> : null}
            {zoneBuckets.length === 0 ? (
              <div className="inventario-empty-card"><p>Nenhuma zona para os filtros selecionados.</p></div>
            ) : null}
          </div>
        ) : null}

        {canShowAddressList ? (
          <div className="inventario-layout">
            <div className="termo-form inventario-address-panel">
              <h3 className="inventario-address-title-row">
                <span>{`Endereços - ${stageLabel(tab)}`}</span>
                {zone ? <span className="inventario-address-title-sep">|</span> : null}
                {zone ? <span className="inventario-zone-name-chip">{zone}</span> : null}
                <span className="inventario-zone-total-chip" title={`Total: ${labelByCount(addressBuckets.length, "endereço", "endereços")}`}>
                  {addressBuckets.length}
                </span>
              </h3>

              <div className="inventario-address-list">
                {addressBuckets.map((bucket) => {
                  const singleItem = bucket.total_items === 1 ? bucket.items[0] : null;
                  const showConcludedDetails = (
                    ((tab === "s1" || tab === "s2") && statusFilter === "concluido")
                    || (tab === "conciliation" && reviewFilter === "resolvido")
                    || tab === "done"
                  );
                  const blockedForCurrentUser = tab === "s2"
                    && statusFilter === "pendente"
                    && bucket.items.some((row) => isS2BlockedBySameUser(row, profile.user_id));
                  const countedInfo = singleItem ? resolveCountedDisplayInfo(singleItem, tab) : null;
                  const countedByLine = showConcludedDetails ? formatConcludedByLine(countedInfo) : null;
                  const addressMeta = singleItem
                    ? `${singleItem.coddv} - ${singleItem.descricao}`
                    : labelByCount(bucket.total_items, "endereço", "endereços");
                  return (
                    <button
                      type="button"
                      key={bucket.key}
                      className={`inventario-address-card${selectedAddress === bucket.key ? " active" : ""}`}
                      onClick={() => openAddressEditor(bucket)}
                    >
                      <div className="inventario-address-main">
                        <div className="inventario-address-head">
                          <strong>{bucket.endereco}</strong>
                          <span className={`termo-divergencia inventario-address-status ${bucket.pending_items > 0 ? "andamento" : "correto"}`}>
                            {bucket.pending_items > 0
                              ? (bucket.pending_items === 1 ? "pendente" : labelByCount(bucket.pending_items, "pendente", "pendentes"))
                              : (bucket.done_items === 1 ? "concluído" : labelByCount(bucket.done_items, "concluído", "concluídos"))}
                          </span>
                        </div>
                        <p className="inventario-address-meta">{addressMeta}</p>
                        {showConcludedDetails && countedInfo?.qtd != null ? (
                          <p className="inventario-address-extra">{`Estoque: ${singleItem?.estoque ?? "-"} Conferido: ${countedInfo.qtd}`}</p>
                        ) : null}
                        {showConcludedDetails ? (
                          <p className="inventario-address-user">{countedByLine}</p>
                        ) : null}
                        {blockedForCurrentUser ? (
                          <p className="inventario-address-blocked-note">Verificação não disponível para você.</p>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
                {addressBuckets.length === 0 ? (
                  <div className="inventario-empty-card"><p>Nenhum endereço para os filtros selecionados.</p></div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {showZonePicker && typeof document !== "undefined"
          ? createPortal(
              <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="inventario-zonas-title" onClick={() => setShowZonePicker(false)}>
                <div className="confirm-dialog termo-routes-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                  <h3 id="inventario-zonas-title">{`Zonas - ${stageLabel(tab)}`}</h3>
                  <div className="input-icon-wrap termo-routes-search">
                    <span className="field-icon" aria-hidden="true">{searchIcon()}</span>
                    <input
                      type="text"
                      value={zoneSearchInput}
                      onChange={(event) => setZoneSearchInput(event.target.value)}
                      placeholder="Buscar zona..."
                    />
                  </div>
                  {filteredZoneBuckets.length === 0 ? (
                    <p>Sem zonas disponíveis para este filtro.</p>
                  ) : (
                    <div className="termo-routes-list">
                      {filteredZoneBuckets.map((zoneBucket) => {
                        const pendingWord = zoneBucket.pending_addresses === 1 ? "pendente" : "pendentes";
                        const doneWord = zoneBucket.done_addresses === 1 ? "concluído" : "concluídos";

                        return (
                          <div key={zoneBucket.zona} className={`termo-route-group${zone === zoneBucket.zona ? " is-open" : ""}`}>
                            <button
                              type="button"
                              className="termo-route-row-button termo-route-row-button-volume"
                              onClick={() => handleZoneSelect(zoneBucket.zona)}
                            >
                              <span className="termo-route-main">
                                <span className="termo-route-info">
                                  <span className="termo-route-title inventario-zone-title-row">
                                    <span className="inventario-zone-name-chip">{zoneBucket.zona}</span>
                                    <span className="inventario-zone-total-chip" title={`Total: ${labelByCount(zoneBucket.total_addresses, "endereço", "endereços")}`}>
                                      {zoneBucket.total_addresses}
                                    </span>
                                  </span>
                                  <span className="inventario-zone-stats">
                                    <span className="inventario-zone-stat pending">
                                      <span className="inventario-zone-stat-count">{zoneBucket.pending_addresses}</span>
                                      <span className="inventario-zone-stat-icon pending">X</span>
                                      <span className="inventario-zone-stat-label">{pendingWord}</span>
                                    </span>
                                    <span className="inventario-zone-stat done">
                                      <span className="inventario-zone-stat-count">{zoneBucket.done_addresses}</span>
                                      <span className="inventario-zone-stat-icon done">✓</span>
                                      <span className="inventario-zone-stat-label">{doneWord}</span>
                                    </span>
                                  </span>
                                </span>
                                <span className="termo-route-actions-row">
                                  <span className={`termo-divergencia ${zone === zoneBucket.zona ? "correto" : "andamento"}`}>
                                    {zone === zoneBucket.zona ? "Selecionada" : "Disponível"}
                                  </span>
                                </span>
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="confirm-actions">
                    <button className="btn btn-muted" type="button" onClick={() => setShowZonePicker(false)}>Fechar</button>
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}

        {editorOpen && active ? (
          <div className="inventario-popup-overlay" role="dialog" aria-modal="true" onClick={closeEditorPopup}>
            <div className="inventario-popup-card" onClick={(event) => event.stopPropagation()}>
              <div className="inventario-popup-head">
                <div>
                  <h3>{active.endereco}</h3>
                  <p>{`${stageLabel(tab)} | CODDV ${active.coddv}`}</p>
                  <p className="inventario-popup-head-product">{active.descricao}</p>
                </div>
                <div className="inventario-popup-head-actions">
                  {canEditConcludedCount ? (
                    <button
                      type="button"
                      className="inventario-popup-edit"
                      onClick={() => {
                        setPopupErr(null);
                        setCountEditMode(true);
                      }}
                      aria-label="Editar contagem"
                      title="Editar contagem"
                    >
                      {editIcon()}
                      <span>Editar</span>
                    </button>
                  ) : null}
                  <button type="button" className="inventario-popup-close" onClick={closeEditorPopup} aria-label="Fechar popup">Fechar</button>
                </div>
              </div>
              <div ref={popupBodyRef} className="inventario-popup-body">
                {popupErr ? <p className="inventario-popup-note error">{popupErr}</p> : null}
                {(tab === "s1" || tab === "s2") ? (
                  <>
                    {showCountReadOnlyDetails ? (
                      <div className="inventario-count-readonly">
                        <p>{`Quantidade informada: ${activeStageCount?.qtd_contada ?? "-"}`}</p>
                        <p>{`Barras: ${activeStageCount?.barras ?? "-"}`}</p>
                        <p>{`Usuário: ${activeStageCount?.counted_nome ?? "-"} (${activeStageCount?.counted_mat ?? "-"})`}</p>
                      </div>
                    ) : (
                      <>
                        <label>
                          Quantidade
                          <input
                            ref={qtdInputRef}
                            autoFocus
                            value={qtd}
                            onChange={(e) => {
                              setQtd(e.target.value);
                              setValidatedBarras(null);
                            }}
                            onFocus={focusAndSelectNumericInput}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            enterKeyHint="next"
                            disabled={!canEditCount(active) || busy}
                          />
                        </label>
                        {requiresBarras ? (
                          <p className={`inventario-popup-note ${barrasValidatedForCurrentInput ? "ok" : "warn"}`}>
                            {barrasValidatedForCurrentInput
                              ? "Código de barras validado. Toque em Salvar para concluir."
                              : "Sobra detectada. Informe barras válido do mesmo CODDV e valide antes de salvar, ou descarte."}
                          </p>
                        ) : null}
                        {requiresBarras ? (
                          <label>
                            Barras (obrigatório)
                            <div className="input-icon-wrap with-action inventario-popup-input-action-wrap">
                              <input
                                value={barras}
                                onChange={(e) => {
                                  setBarras(e.target.value);
                                  setValidatedBarras(null);
                                }}
                                onFocus={keepFocusedControlVisible}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                autoCapitalize="off"
                                autoCorrect="off"
                                autoComplete="off"
                                spellCheck={false}
                                enterKeyHint="done"
                                disabled={!canEditCount(active) || busy}
                              />
                              <button
                                type="button"
                                className="input-action-btn inventario-popup-scan-btn"
                                onClick={() => openCameraScanner("barras")}
                                title="Ler código pela câmera"
                                aria-label="Ler código pela câmera"
                                disabled={!canEditCount(active) || busy || !cameraSupported}
                              >
                                {cameraIcon()}
                              </button>
                            </div>
                          </label>
                        ) : null}
                        <div className="inventario-editor-actions">
                          <button className="btn btn-primary" type="button" disabled={!canEditCount(active) || busy} onClick={() => void saveCount(false)}>{saveCountLabel}</button>
                          <button className="btn btn-muted" type="button" disabled={!canEditCount(active) || busy} onClick={() => void saveCount(true)}>Descartar</button>
                        </div>
                      </>
                    )}
                  </>
                ) : null}
                {tab === "conciliation" ? (
                  <>
                    <p className="inventario-editor-text">{`Endereço: ${active.endereco} | CODDV: ${active.coddv}`}</p>
                    {(() => {
                      const c1Fallback = extractReviewSnapshotCount(active.review, 1);
                      const c2Fallback = extractReviewSnapshotCount(active.review, 2);

                      const c1Qtd = active.c1?.qtd_contada ?? c1Fallback?.qtd ?? "-";
                      const c1Barras = active.c1?.barras ?? c1Fallback?.barras ?? "-";
                      const c1Nome = pickText(
                        active.c1?.counted_nome,
                        c1Fallback?.nome,
                        active.c1?.counted_mat ? `Mat ${active.c1.counted_mat}` : null,
                        c1Fallback?.mat ? `Mat ${c1Fallback.mat}` : null
                      ) ?? "-";

                      const c2Qtd = active.c2?.qtd_contada ?? c2Fallback?.qtd ?? "-";
                      const c2Barras = active.c2?.barras ?? c2Fallback?.barras ?? "-";
                      const c2Nome = pickText(
                        active.c2?.counted_nome,
                        c2Fallback?.nome,
                        active.c2?.counted_mat ? `Mat ${active.c2.counted_mat}` : null,
                        c2Fallback?.mat ? `Mat ${c2Fallback.mat}` : null
                      ) ?? "-";

                      return (
                        <>
                          {active.review?.reason_code === "conflito_lock" && active.c2 == null ? (
                            <p className="inventario-popup-note warn">
                              2ª verificação não registrada por conflito de lock. Resolve pela conciliação.
                            </p>
                          ) : null}
                          <div className="inventario-conciliation-grid">
                            <article className="inventario-conciliation-card">
                              <h4>1ª Verificação</h4>
                              <p>{`Qtd: ${c1Qtd}`}</p>
                              <p>{`Barras: ${c1Barras}`}</p>
                              <p>{`Usuário: ${c1Nome}`}</p>
                            </article>
                            <article className="inventario-conciliation-card">
                              <h4>2ª Verificação</h4>
                              <p>{`Qtd: ${c2Qtd}`}</p>
                              <p>{`Barras: ${c2Barras}`}</p>
                              <p>{`Usuário: ${c2Nome}`}</p>
                            </article>
                          </div>
                        </>
                      );
                    })()}
                    <label>
                      Qtd final
                      <input
                        ref={finalQtdInputRef}
                        value={finalQtd}
                        onChange={(e) => setFinalQtd(e.target.value)}
                        onFocus={focusAndSelectNumericInput}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        enterKeyHint="next"
                        disabled={!canResolveConciliation || busy}
                      />
                    </label>
                    {requiresFinalBarras ? (
                      <p className="inventario-popup-note warn">Quantidade final acima do esperado. Informe barras válido do mesmo CODDV.</p>
                    ) : null}
                    {requiresFinalBarras ? (
                      <label>
                        Barras final (obrigatório na sobra)
                        <div className="input-icon-wrap with-action inventario-popup-input-action-wrap">
                          <input
                            value={finalBarras}
                            onChange={(e) => setFinalBarras(e.target.value)}
                            onFocus={keepFocusedControlVisible}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            autoCapitalize="off"
                            autoCorrect="off"
                            autoComplete="off"
                            spellCheck={false}
                            enterKeyHint="done"
                            disabled={!canResolveConciliation || busy}
                          />
                          <button
                            type="button"
                            className="input-action-btn inventario-popup-scan-btn"
                            onClick={() => openCameraScanner("final_barras")}
                            title="Ler código pela câmera"
                            aria-label="Ler código pela câmera"
                            disabled={!canResolveConciliation || busy || !cameraSupported}
                          >
                            {cameraIcon()}
                          </button>
                        </div>
                      </label>
                    ) : null}
                    <div className="inventario-editor-actions">
                      <button className="btn btn-muted" type="button" onClick={closeEditorPopup}>Fechar</button>
                      <button className="btn btn-primary" type="button" disabled={!canResolveConciliation || busy} onClick={() => void resolveReview()}>Resolver conciliação</button>
                    </div>
                  </>
                ) : null}
                {tab === "done" ? <p className="inventario-editor-text">Endereço concluído e não pode ser alterado.</p> : null}
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
                  <label>
                    Data inicial
                    <input
                      ref={reportDtIniInputRef}
                      type="date"
                      value={dtIni}
                      onChange={(e) => setDtIni(e.target.value)}
                      onFocus={keepFocusedControlVisible}
                    />
                  </label>
                  <label>
                    Data final
                    <input
                      type="date"
                      value={dtFim}
                      onChange={(e) => setDtFim(e.target.value)}
                      onFocus={keepFocusedControlVisible}
                    />
                  </label>
                </div>
                <div className="inventario-report-actions">
                  <button className="btn btn-muted" type="button" onClick={() => void countReportRows({ dt_ini: dtIni, dt_fim: dtFim, cd: cd ?? -1 }).then(setReportCount).catch((e) => setErr(parseErr(e)))} disabled={cd == null}>Contar</button>
                  <button className="btn btn-primary" type="button" onClick={() => void exportReport().catch((e) => setErr(parseErr(e)))} disabled={cd == null}>Exportar XLSX</button>
                </div>
                {reportCount != null ? <p>{labelByCount(reportCount, "registro", "registros")}</p> : null}
              </div>
            </div>
          </div>
        ) : null}
        {scannerOpen && typeof document !== "undefined"
          ? createPortal(
              <div className="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="inventario-scanner-title" onClick={closeCameraScanner}>
                <div className="scanner-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                  <div className="scanner-head">
                    <h3 id="inventario-scanner-title">Scanner de barras</h3>
                    <div className="scanner-head-actions">
                      {!isDesktop ? (
                        <button
                          type="button"
                          className={`scanner-flash-btn${torchEnabled ? " is-on" : ""}`}
                          onClick={() => void toggleTorch()}
                          aria-label={torchEnabled ? "Desligar flash" : "Ligar flash"}
                          title={torchSupported ? (torchEnabled ? "Desligar flash" : "Ligar flash") : "Flash indisponível"}
                          disabled={!torchSupported}
                        >
                          {flashIcon({ on: torchEnabled })}
                          <span>{torchEnabled ? "Flash on" : "Flash"}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="scanner-close-btn"
                        onClick={closeCameraScanner}
                        aria-label="Fechar scanner"
                        title="Fechar scanner"
                      >
                        {closeIcon()}
                      </button>
                    </div>
                  </div>
                  <div className="scanner-video-wrap">
                    <video ref={scannerVideoRef} className="scanner-video" autoPlay muted playsInline />
                    <div className="scanner-frame" aria-hidden="true">
                      <div className="scanner-frame-corner top-left" />
                      <div className="scanner-frame-corner top-right" />
                      <div className="scanner-frame-corner bottom-left" />
                      <div className="scanner-frame-corner bottom-right" />
                      <div className="scanner-frame-line" />
                    </div>
                  </div>
                  <p className="scanner-hint">Aponte a câmera para o código de barras para leitura automática.</p>
                  {scannerError ? <div className="alert error">{scannerError}</div> : null}
                </div>
              </div>,
              document.body
            )
          : null}
      </section>
    </>
  );
}
