import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  FocusEvent as ReactFocusEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent
} from "react";
import type { IScannerControls } from "@zxing/browser";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { formatDateTimeBrasilia, todayIsoBrasilia } from "../../shared/brasilia-datetime";
import {
  QUEUED_WRITE_FLUSH_INTERVAL_MS,
  shouldTriggerQueuedBackgroundSync
} from "../../shared/offline/queue-policy";
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import { PendingSyncDialog } from "../../ui/pending-sync-dialog";
import {
  getDbBarrasByBarcode,
  getDbBarrasMeta,
  upsertDbBarrasCacheRow
} from "../../shared/db-barras/storage";
import type { DbBarrasCacheRow } from "../../shared/db-barras/types";
import {
  fetchDbBarrasByBarcodeOnline,
  normalizeBarcode,
  refreshDbBarrasCacheSmart
} from "../../shared/db-barras/sync";
import { useOnDemandSoftKeyboard } from "../../shared/use-on-demand-soft-keyboard";
import { useScanFeedback } from "../../shared/use-scan-feedback";
import { getModuleByKeyOrThrow } from "../registry";
import {
  cleanupExpiredControleAvariasRows,
  getControleAvariasPreferences,
  getPendingRows,
  getUserControleAvariasRows,
  removeControleAvariasRow,
  saveControleAvariasPreferences,
  upsertControleAvariasRow
} from "./storage";
import {
  countControleAvariasReportRows,
  fetchCdOptions,
  fetchControleAvariasReportRows,
  fetchTodaySharedControleAvariasRows,
  formatValidade,
  normalizeValidadeInput,
  syncPendingControleAvariasRows
} from "./sync";
import type {
  CdOption,
  ControleAvariasModuleProfile,
  ControleAvariasOrigem,
  ControleAvariasReportFilters,
  ControleAvariasRow,
  ControleAvariasSituacao
} from "./types";

interface ControleAvariasPageProps {
  isOnline: boolean;
  profile: ControleAvariasModuleProfile;
}
const MODULE_DEF = getModuleByKeyOrThrow("controle-avarias");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SWIPE_ACTION_WIDTH = 104;
const SWIPE_OPEN_THRESHOLD = 40;
const QUICK_SYNC_THROTTLE_MS = 2500;
const SCANNER_INPUT_MAX_INTERVAL_MS = 45;
const SCANNER_INPUT_MIN_BURST_CHARS = 5;
const SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS = 90;
const SCANNER_INPUT_SUBMIT_COOLDOWN_MS = 600;
const LOOKUP_CACHE_MAX_ENTRIES = 800;
const ORIGEM_OPTIONS: ControleAvariasOrigem[] = ["Blitz", "Entrada", "Expedição", "Pulmão", "Separação"];
const CAUSA_OPTIONS = [
  "Armazenamento",
  "Caixa do fornecedor",
  "Contaminado por outro produto",
  "Empilhadeira",
  "Embalagem sem produto",
  "Excesso no bin",
  "Gaiola",
  "Goteira",
  "Outro",
  "Prego no pallet",
  "Produto sem embalagem",
  "Queda",
  "Queda por excesso"
] as const satisfies readonly string[];
const SITUACAO_OPTIONS: ControleAvariasSituacao[] = [
  "Amassado",
  "Furado",
  "Manchado",
  "Molhado",
  "Quebrado",
  "Rasgado",
  "Vazando",
  "Vazio"
];
const PENDING_SYNC_STATUSES = new Set<ControleAvariasRow["sync_status"]>([
  "pending_insert",
  "pending_update",
  "pending_delete",
  "error"
]);

interface ScannerInputState {
  lastInputAt: number;
  lastLength: number;
  burstChars: number;
  timerId: number | null;
  lastSubmittedValue: string;
  lastSubmittedAt: number;
}

function createScannerInputState(): ScannerInputState {
  return {
    lastInputAt: 0,
    lastLength: 0,
    burstChars: 0,
    timerId: null,
    lastSubmittedValue: "",
    lastSubmittedAt: 0
  };
}

type RowEditDraft = {
  qtd: string;
  etiqueta: string;
  motivo: "" | typeof CAUSA_OPTIONS[number];
  situacao: "" | ControleAvariasSituacao;
  origem: "" | ControleAvariasOrigem;
  lote: string;
  validade: string;
};

type BlockingAlertState = {
  title: string;
  message: string;
};
type BarcodeValidationState = "idle" | "validating" | "valid" | "invalid";

function cdCodeLabel(cd: number | null): string {
  if (cd == null) return "CD não definido";
  return `CD ${String(cd).padStart(2, "0")}`;
}

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function formatDateTime(value: string): string {
  return formatDateTimeBrasilia(value, { includeSeconds: true, emptyFallback: "-", invalidFallback: "-" });
}

function hasRowChangeAfterCollect(row: ControleAvariasRow): boolean {
  const updatedAtMs = Date.parse(row.updated_at || "");
  const baseMs = Date.parse(row.created_at || row.data_hr || "");

  if (Number.isFinite(updatedAtMs) && Number.isFinite(baseMs)) {
    return updatedAtMs - baseMs > 1000;
  }

  const updatedRaw = (row.updated_at || "").trim();
  const createdRaw = (row.created_at || row.data_hr || "").trim();
  return Boolean(updatedRaw && createdRaw && updatedRaw !== createdRaw);
}

function asStatusLabel(status: ControleAvariasRow["sync_status"]): string {
  if (status === "pending_insert") return "Pendente envio";
  if (status === "pending_update") return "Pendente atualização";
  if (status === "pending_delete") return "Pendente exclusão";
  if (status === "error") return "Erro de sync";
  return "Sincronizado";
}

function asStatusClass(status: ControleAvariasRow["sync_status"]): string {
  if (status === "synced") return "synced";
  if (status === "error") return "error";
  return "pending";
}

function sortRows(rows: ControleAvariasRow[]): ControleAvariasRow[] {
  return [...rows].sort((a, b) => {
    const aTime = Date.parse(a.data_hr || a.updated_at || a.created_at || "");
    const bTime = Date.parse(b.data_hr || b.updated_at || b.created_at || "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return bTime - aTime;
    }
    return (b.updated_at || "").localeCompare(a.updated_at || "");
  });
}

function safeUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatValidadeInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function parseMultiplo(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

function roleIsGlobalAdmin(profile: ControleAvariasModuleProfile): boolean {
  return profile.role === "admin" && profile.cd_default == null;
}

function canManageControleAvariasRow(profile: ControleAvariasModuleProfile, row: ControleAvariasRow): boolean {
  return profile.role === "admin" || row.user_id === profile.user_id;
}

function fixedCdFromProfile(profile: ControleAvariasModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) {
    return Math.trunc(profile.cd_default);
  }
  return parseCdFromLabel(profile.cd_nome);
}

function toPendingLocalId(row: ControleAvariasRow): string {
  if (row.remote_id) {
    return row.local_id.startsWith("pending:") ? row.local_id : `pending:${row.remote_id}`;
  }
  return row.local_id;
}

function BarcodeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6v12" />
      <path d="M7 6v12" />
      <path d="M10 6v12" />
      <path d="M14 6v12" />
      <path d="M18 6v12" />
      <path d="M20 6v12" />
      <path d="M3 4h18" />
      <path d="M3 20h18" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h4l1.5-2h5L16 7h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function FlashIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {on ? <path d="M7 2h10l-4 7h5l-9 13 2-9H6z" /> : <path d="M7 2h10l-4 7h5l-9 13 2-9H6z" />}
      {!on ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function QuantityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 8h12" />
      <path d="M12 4v16" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4 20h16" />
    </svg>
  );
}

function OfflineModeIcon({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8a10 10 0 0 1 16 0" />
        <path d="M7 12a6 6 0 0 1 10 0" />
        <path d="M10 16a2 2 0 0 1 4 0" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8a10 10 0 0 1 16 0" />
      <path d="M7 12a6 6 0 0 1 10 0" />
      <path d="M10 16a2 2 0 0 1 4 0" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M8 7l1 13h6l1-13" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 21l3-0.5 11-11a2 2 0 0 0 0-2.8l-0.7-0.7a2 2 0 0 0-2.8 0l-11 11z" />
      <path d="M13 6l5 5" />
    </svg>
  );
}

function XMarkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {open ? <path d="M6 14l6-6 6 6" /> : <path d="M6 10l6 6 6-6" />}
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  );
}

export default function ControleAvariasPage({ isOnline, profile }: ControleAvariasPageProps) {
  const barcodeRef = useRef<HTMLInputElement | null>(null);
  const resolveScanFeedbackAnchor = useCallback(() => barcodeRef.current, []);
  const {
    scanFeedback,
    scanFeedbackTop,
    showScanFeedback,
    triggerScanErrorAlert
  } = useScanFeedback(resolveScanFeedbackAnchor);
  const {
    inputMode: barcodeInputMode,
    enableSoftKeyboard: enableBarcodeSoftKeyboard,
    disableSoftKeyboard: disableBarcodeSoftKeyboard
  } = useOnDemandSoftKeyboard("numeric");
  const quantityInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerTrackRef = useRef<MediaStreamTrack | null>(null);
  const scannerTorchModeRef = useRef<"none" | "controls" | "track">("none");
  const scannerInputStateRef = useRef<ScannerInputState>(createScannerInputState());
  const swipeTouchRowRef = useRef<string | null>(null);
  const swipeStartXRef = useRef(0);
  const swipeStartYRef = useRef(0);
  const swipeStartOffsetRef = useRef(0);
  const swipeCurrentOffsetRef = useRef(0);
  const swipeDraggingRef = useRef(false);
  const suppressRowClickRef = useRef<string | null>(null);
  const syncInFlightRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const collectInFlightRef = useRef(false);
  const lastQuickSyncAtRef = useRef(0);
  const queuedSyncStateRef = useRef({
    lastAttemptAt: 0,
    lastSuccessAt: 0,
    lastMutationAt: 0,
    lastSuccessfulMutationAt: 0
  });
  const productLookupCacheRef = useRef<Map<string, DbBarrasCacheRow>>(new Map());

  const [localRows, setLocalRows] = useState<ControleAvariasRow[]>([]);
  const [sharedTodayRows, setSharedTodayRows] = useState<ControleAvariasRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingErrors, setPendingErrors] = useState(0);
  const [showPendingSyncModal, setShowPendingSyncModal] = useState(false);
  const [pendingSyncRows, setPendingSyncRows] = useState<ControleAvariasRow[]>([]);
  const [busyPendingDiscard, setBusyPendingDiscard] = useState(false);
  const [dbBarrasCount, setDbBarrasCount] = useState(0);
  const [dbBarrasLastSyncAt, setDbBarrasLastSyncAt] = useState<string | null>(null);

  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeValidationState, setBarcodeValidationState] = useState<BarcodeValidationState>("idle");
  const [multiploInput, setMultiploInput] = useState("1");
  const [motivoInput, setMotivoInput] = useState<"" | typeof CAUSA_OPTIONS[number]>("");
  const [situacaoInput, setSituacaoInput] = useState<"" | ControleAvariasSituacao>("");
  const [origemInput, setOrigemInput] = useState<"" | ControleAvariasOrigem>("");
  const [loteInput, setLoteInput] = useState("");
  const [validadeInput, setValidadeInput] = useState("");

  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [cdAtivo, setCdAtivo] = useState<number | null>(null);
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);

  const [busyRefresh, setBusyRefresh] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [preferencesReady, setPreferencesReady] = useState(false);

  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 980px)").matches;
  });
  const [showReport, setShowReport] = useState(false);
  const [reportDtIni, setReportDtIni] = useState(todayIsoBrasilia());
  const [reportDtFim, setReportDtFim] = useState(todayIsoBrasilia());
  const [reportCd, setReportCd] = useState<string>("");
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [reportBusySearch, setReportBusySearch] = useState(false);
  const [reportBusyExport, setReportBusyExport] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<RowEditDraft | null>(null);
  const [swipeOpen, setSwipeOpen] = useState<{ rowId: string; side: "edit" | "delete" } | null>(null);
  const [swipeDrag, setSwipeDrag] = useState<{ rowId: string; offset: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ControleAvariasRow | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [blockingAlert, setBlockingAlert] = useState<BlockingAlertState | null>(null);

  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const isGlobalAdmin = useMemo(() => roleIsGlobalAdmin(profile), [profile]);
  const fixedCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const currentCd = isGlobalAdmin ? cdAtivo : fixedCd;

  const canSeeReportTools = isDesktop && profile.role === "admin";
  const cameraSupported = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }, []);
  const barcodeIconClassName = `field-icon validation-status${barcodeValidationState === "validating" ? " is-validating" : ""}${barcodeValidationState === "valid" ? " is-valid" : ""}${barcodeValidationState === "invalid" ? " is-invalid" : ""}`;

  const visibleRows = useMemo(() => {
    if (currentCd == null) return [];

    const localCurrent = localRows.filter((row) => row.cd === currentCd && row.sync_status !== "synced");
    const pendingByRemoteId = new Map<string, ControleAvariasRow>();
    const pendingDeleteIds = new Set<string>();
    const pendingNewRows: ControleAvariasRow[] = [];

    for (const row of localCurrent) {
      if (row.remote_id) {
        if (row.sync_status === "pending_delete") {
          pendingDeleteIds.add(row.remote_id);
        } else {
          pendingByRemoteId.set(row.remote_id, row);
        }
      } else if (row.sync_status !== "pending_delete") {
        pendingNewRows.push(row);
      }
    }

    const remoteIds = new Set<string>();
    const mergedRemote = sharedTodayRows
      .filter((row) => row.cd === currentCd && row.remote_id)
      .filter((row) => {
        if (!row.remote_id) return true;
        remoteIds.add(row.remote_id);
        return !pendingDeleteIds.has(row.remote_id);
      })
      .map((row) => {
        if (!row.remote_id) return row;
        return pendingByRemoteId.get(row.remote_id) ?? row;
      });

    const pendingOrphans = localCurrent.filter(
      (row) => row.remote_id && !remoteIds.has(row.remote_id) && row.sync_status !== "pending_delete"
    );

    return sortRows([...pendingNewRows, ...pendingOrphans, ...mergedRemote]);
  }, [currentCd, localRows, sharedTodayRows]);

  useEffect(() => {
    if (!swipeOpen) return;
    if (!visibleRows.some((row) => row.local_id === swipeOpen.rowId)) {
      setSwipeOpen(null);
    }
  }, [swipeOpen, visibleRows]);

  useEffect(() => {
    if (!editingRowId) return;
    if (!visibleRows.some((row) => row.local_id === editingRowId)) {
      setEditingRowId(null);
      setEditDraft(null);
    }
  }, [editingRowId, visibleRows]);

  const refreshLocalState = useCallback(async () => {
    const [nextRows, nextMeta] = await Promise.all([
      getUserControleAvariasRows(profile.user_id),
      getDbBarrasMeta()
    ]);
    const nextPending = nextRows.reduce((count, row) => (
      PENDING_SYNC_STATUSES.has(row.sync_status) ? count + 1 : count
    ), 0);
    setLocalRows(nextRows);
    setPendingCount(nextPending);
    setPendingErrors(nextRows.filter((row) => row.sync_status === "error").length);
    setDbBarrasCount(nextMeta.row_count);
    setDbBarrasLastSyncAt(nextMeta.last_sync_at);
  }, [profile.user_id]);

  const loadPendingSyncRows = useCallback(async () => {
    const rows = await getPendingRows(profile.user_id);
    setPendingSyncRows(rows);
    return rows;
  }, [profile.user_id]);

  const openPendingSyncModal = useCallback(async () => {
    const rows = await loadPendingSyncRows();
    if (rows.length <= 0) {
      setShowPendingSyncModal(false);
      return;
    }
    setShowPendingSyncModal(true);
  }, [loadPendingSyncRows]);

  const discardPendingSyncRow = useCallback(async (localId: string) => {
    setBusyPendingDiscard(true);
    try {
      await removeControleAvariasRow(localId);
      const rows = await loadPendingSyncRows();
      await refreshLocalState();
      if (rows.length <= 0) {
        setShowPendingSyncModal(false);
      }
    } finally {
      setBusyPendingDiscard(false);
    }
  }, [loadPendingSyncRows, refreshLocalState]);

  const discardAllPendingSyncRows = useCallback(async () => {
    if (pendingSyncRows.length <= 0) {
      setShowPendingSyncModal(false);
      return;
    }
    setBusyPendingDiscard(true);
    try {
      for (const row of pendingSyncRows) {
        await removeControleAvariasRow(row.local_id);
      }
      await refreshLocalState();
      setPendingSyncRows([]);
      setShowPendingSyncModal(false);
    } finally {
      setBusyPendingDiscard(false);
    }
  }, [pendingSyncRows, refreshLocalState]);

  const refreshSharedState = useCallback(async () => {
    if (!isOnline || currentCd == null) return;
    try {
      const rows = await fetchTodaySharedControleAvariasRows(currentCd);
      setSharedTodayRows(rows);
    } catch {
      // Keep existing shared rows when network call fails.
    }
  }, [currentCd, isOnline]);

  const focusBarcode = useCallback(() => {
    disableBarcodeSoftKeyboard();
    window.requestAnimationFrame(() => {
      barcodeRef.current?.focus({ preventScroll: true });
    });
  }, [disableBarcodeSoftKeyboard]);

  const readCachedProduct = useCallback((barras: string): DbBarrasCacheRow | null => {
    const cache = productLookupCacheRef.current;
    const hit = cache.get(barras);
    if (!hit) return null;
    cache.delete(barras);
    cache.set(barras, hit);
    return hit;
  }, []);

  const writeCachedProduct = useCallback((product: DbBarrasCacheRow) => {
    const key = normalizeBarcode(product.barras);
    if (!key) return;

    const cache = productLookupCacheRef.current;
    if (cache.has(key)) cache.delete(key);
    cache.set(key, { ...product, barras: key });

    if (cache.size <= LOOKUP_CACHE_MAX_ENTRIES) return;
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey === "string") cache.delete(oldestKey);
  }, []);

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

  const openCameraScanner = useCallback(() => {
    if (!cameraSupported) {
      setErrorMessage("Câmera não disponível neste navegador/dispositivo.");
      return;
    }
    setScannerError(null);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTrackRef.current = null;
    scannerTorchModeRef.current = "none";
    setScannerOpen(true);
  }, [cameraSupported]);

  const closeCameraScanner = useCallback(() => {
    stopCameraScanner();
    setScannerOpen(false);
    setScannerError(null);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTrackRef.current = null;
    scannerTorchModeRef.current = "none";
    focusBarcode();
  }, [focusBarcode, stopCameraScanner]);

  const toggleTorch = useCallback(async () => {
    const controls = scannerControlsRef.current;
    const track = scannerTrackRef.current ?? resolveScannerTrack();
    const hasTrackTorch = supportsTrackTorch(track);
    if (!controls?.switchTorch && !hasTrackTorch) {
      setScannerError("Flash não disponível neste dispositivo.");
      return;
    }
    try {
      const next = !torchEnabled;
      if (hasTrackTorch && track) {
        const trackWithConstraints = track as MediaStreamTrack & {
          applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
        };
        if (!trackWithConstraints || typeof trackWithConstraints.applyConstraints !== "function") {
          throw new Error("Track sem suporte de constraints");
        }
        await trackWithConstraints.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
        if (next) {
          window.setTimeout(() => {
            void trackWithConstraints
              .applyConstraints?.({ advanced: [{ torch: true } as MediaTrackConstraintSet] })
              .catch(() => undefined);
          }, 140);
        }
        scannerTorchModeRef.current = "track";
      } else if (controls?.switchTorch) {
        await controls.switchTorch(next);
        scannerTorchModeRef.current = "controls";
      }
      setTorchEnabled(next);
      setScannerError(null);
    } catch {
      setScannerError("Não foi possível alternar o flash.");
    }
  }, [resolveScannerTrack, supportsTrackTorch, torchEnabled]);

  const getOpenedSwipeOffset = useCallback(
    (rowId: string): number => {
      if (!swipeOpen || swipeOpen.rowId !== rowId) return 0;
      return swipeOpen.side === "edit" ? SWIPE_ACTION_WIDTH : -SWIPE_ACTION_WIDTH;
    },
    [swipeOpen]
  );

  const getRowSwipeOffset = useCallback(
    (rowId: string): number => {
      if (swipeDrag && swipeDrag.rowId === rowId) return swipeDrag.offset;
      return getOpenedSwipeOffset(rowId);
    },
    [getOpenedSwipeOffset, swipeDrag]
  );

  const buildRowEditDraft = useCallback((row: ControleAvariasRow): RowEditDraft => {
    return {
      qtd: String(row.qtd),
      etiqueta: row.etiqueta ?? "",
      motivo: CAUSA_OPTIONS.includes(row.motivo as (typeof CAUSA_OPTIONS)[number])
        ? (row.motivo as (typeof CAUSA_OPTIONS)[number])
        : "",
      situacao: row.situacao ?? "",
      origem: row.origem,
      lote: row.lote ?? "",
      validade: formatValidade(row.val_mmaa)
    };
  }, []);

  const startRowEdit = useCallback((row: ControleAvariasRow) => {
    if (!canManageControleAvariasRow(profile, row)) return;
    setSwipeOpen(null);
    setSwipeDrag(null);
    setExpandedRowId(row.local_id);
    setEditingRowId(row.local_id);
    setEditDraft(buildRowEditDraft(row));
    window.setTimeout(() => {
      const input = quantityInputRefs.current[row.local_id];
      if (input) {
        input.focus();
        input.select();
      }
    }, 40);
  }, [buildRowEditDraft, profile]);

  const cancelRowEdit = useCallback(() => {
    setEditingRowId(null);
    setEditDraft(null);
  }, []);

  const openQuickEdit = useCallback((row: ControleAvariasRow) => {
    startRowEdit(row);
  }, [startRowEdit]);

  const onSwipeActionDelete = useCallback((row: ControleAvariasRow) => {
    setSwipeOpen(null);
    setSwipeDrag(null);
    setDeleteTarget(row);
  }, []);

  const onRowTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLButtonElement>, rowId: string, canManageRow: boolean) => {
      if (!canManageRow) return;
      const touch = event.touches[0];
      if (!touch) return;
      swipeTouchRowRef.current = rowId;
      swipeStartXRef.current = touch.clientX;
      swipeStartYRef.current = touch.clientY;
      swipeStartOffsetRef.current = getRowSwipeOffset(rowId);
      swipeCurrentOffsetRef.current = swipeStartOffsetRef.current;
      swipeDraggingRef.current = false;
      if (swipeOpen && swipeOpen.rowId !== rowId) {
        setSwipeOpen(null);
      }
    },
    [getRowSwipeOffset, swipeOpen]
  );

  const onRowTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLButtonElement>, rowId: string, canManageRow: boolean) => {
      if (!canManageRow || swipeTouchRowRef.current !== rowId) return;
      const touch = event.touches[0];
      if (!touch) return;
      const deltaX = touch.clientX - swipeStartXRef.current;
      const deltaY = touch.clientY - swipeStartYRef.current;

      if (!swipeDraggingRef.current) {
        if (Math.abs(deltaX) < 8) return;
        if (Math.abs(deltaX) <= Math.abs(deltaY)) {
          swipeTouchRowRef.current = null;
          return;
        }
        swipeDraggingRef.current = true;
      }

      event.preventDefault();
      const rawOffset = swipeStartOffsetRef.current + deltaX;
      const clamped = Math.max(-SWIPE_ACTION_WIDTH, Math.min(SWIPE_ACTION_WIDTH, rawOffset));
      swipeCurrentOffsetRef.current = clamped;
      setSwipeDrag({ rowId, offset: clamped });
    },
    []
  );

  const onRowTouchEnd = useCallback((rowId: string) => {
    if (swipeTouchRowRef.current !== rowId) return;
    const wasDragging = swipeDraggingRef.current;
    const finalOffset = swipeCurrentOffsetRef.current;

    swipeTouchRowRef.current = null;
    swipeDraggingRef.current = false;
    swipeStartOffsetRef.current = 0;
    swipeCurrentOffsetRef.current = 0;
    setSwipeDrag(null);

    if (!wasDragging) return;
    suppressRowClickRef.current = rowId;
    if (finalOffset >= SWIPE_OPEN_THRESHOLD) {
      setSwipeOpen({ rowId, side: "edit" });
      return;
    }
    if (finalOffset <= -SWIPE_OPEN_THRESHOLD) {
      setSwipeOpen({ rowId, side: "delete" });
      return;
    }
    setSwipeOpen(null);
  }, []);

  const runSync = useCallback(
    async (silent = false) => {
      if (!isOnline || syncInFlightRef.current) return;
      queuedSyncStateRef.current.lastAttemptAt = Date.now();
      syncInFlightRef.current = true;
      if (!silent) {
        setBusySync(true);
      }
      if (!silent) {
        setErrorMessage(null);
        setStatusMessage(null);
      }

      try {
        const result = await syncPendingControleAvariasRows(profile.user_id);
        await refreshLocalState();
        await refreshSharedState();
        if (result.failed === 0) {
          const now = Date.now();
          queuedSyncStateRef.current.lastSuccessAt = now;
          queuedSyncStateRef.current.lastSuccessfulMutationAt = queuedSyncStateRef.current.lastMutationAt;
        }
        if (!silent) {
          setStatusMessage(
            result.processed === 0
              ? "Sem pendências para sincronizar."
              : `Sincronização concluída: ${result.synced} ok, ${result.failed} com erro.`
          );
        }
      } catch (error) {
        if (!silent) {
          const message = error instanceof Error ? error.message : "Falha ao sincronizar pendências.";
          setErrorMessage(message);
        }
      } finally {
        syncInFlightRef.current = false;
        if (!silent) {
          setBusySync(false);
        }
      }
    },
    [isOnline, profile.user_id, refreshLocalState, refreshSharedState]
  );

  const requestQueuedSync = useCallback(
    (reason: "mutation" | "online" | "focus" | "visibility" | "interval") => {
      if (!shouldTriggerQueuedBackgroundSync({
        isOnline,
        pendingCount,
        reason,
        lastAttemptAt: queuedSyncStateRef.current.lastAttemptAt,
        lastMutationAt: queuedSyncStateRef.current.lastMutationAt,
        lastSuccessfulMutationAt: queuedSyncStateRef.current.lastSuccessfulMutationAt
      })) {
        return;
      }

      if (reason === "mutation") {
        const now = Date.now();
        if (now - lastQuickSyncAtRef.current < QUICK_SYNC_THROTTLE_MS) {
          return;
        }
        lastQuickSyncAtRef.current = now;
      }

      void runSync(true);
    },
    [isOnline, pendingCount, runSync]
  );

  const runDbBarrasRefresh = useCallback(
    async (silent = false) => {
      if (!isOnline || refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      setBusyRefresh(true);
      if (!silent) {
        setErrorMessage(null);
        setStatusMessage(null);
      }

      try {
        const result = await refreshDbBarrasCacheSmart((progress) => {
          const percent = Math.max(0, Math.min(100, progress.percent));
          if (progress.totalRows > 0) {
            setProgressMessage(
              `Atualizando base de barras... ${percent}% (${progress.rowsFetched}/${progress.totalRows})`
            );
            return;
          }
          setProgressMessage(`Atualizando base de barras... ${percent}%`);
        });
        await refreshLocalState();
        if (!silent) {
          if (result.mode === "full") {
            setStatusMessage(`Base de barras carregada: ${result.total} itens.`);
          } else if (result.applied > 0) {
            setStatusMessage(`Base offline atualizada: ${result.applied} itens novos/alterados.`);
          } else {
            setStatusMessage("Base offline já está atualizada.");
          }
        }
      } catch (error) {
        if (!silent) {
          const message = error instanceof Error ? error.message : "Falha ao atualizar base de barras.";
          setErrorMessage(message);
        }
      } finally {
        refreshInFlightRef.current = false;
        setProgressMessage(null);
        setBusyRefresh(false);
      }
    },
    [isOnline, refreshLocalState]
  );

  const onToggleOfflineMode = useCallback(async () => {
    const nextOffline = !preferOfflineMode;
    setErrorMessage(null);
    setStatusMessage(null);
    setPreferOfflineMode(nextOffline);

    if (nextOffline) {
      if (!isOnline) {
        if (dbBarrasCount <= 0) {
          setErrorMessage("Sem internet para carregar base offline agora.");
        } else {
          setStatusMessage("Modo offline ativado com base local existente.");
        }
        return;
      }

      setStatusMessage("Modo offline ativado. Atualizando base de barras neste dispositivo...");
      void runDbBarrasRefresh(true);
      return;
    }

    setStatusMessage("Modo online ativado. Busca de barras direto no Supabase.");
  }, [dbBarrasCount, isOnline, preferOfflineMode, runDbBarrasRefresh]);

  const openBlockingAlert = useCallback((title: string, message: string) => {
    setBlockingAlert({ title, message });
  }, []);

  const closeBlockingAlert = useCallback(() => {
    setBlockingAlert(null);
    focusBarcode();
  }, [focusBarcode]);

  const applyRowUpdate = useCallback(
    async (row: ControleAvariasRow, patch: Partial<ControleAvariasRow>) => {
      if (!canManageControleAvariasRow(profile, row)) {
        return;
      }
      const nextRow: ControleAvariasRow = {
        ...row,
        ...patch,
        local_id: toPendingLocalId(row),
        sync_status: row.remote_id ? "pending_update" : "pending_insert",
        sync_error: null,
        updated_at: new Date().toISOString()
      };
      await upsertControleAvariasRow(nextRow);
      await refreshLocalState();
      queuedSyncStateRef.current.lastMutationAt = Date.now();
      requestQueuedSync("mutation");
    },
    [preferOfflineMode, refreshLocalState, requestQueuedSync]
  );

  const saveRowEdit = useCallback(
    async (row: ControleAvariasRow) => {
      if (!canManageControleAvariasRow(profile, row) || editingRowId !== row.local_id || !editDraft) return;
      try {
        const nextQtd = parseMultiplo(editDraft.qtd);
        const nextEtiqueta = editDraft.etiqueta.trim() || null;
        const nextMotivo = editDraft.motivo;
        const nextSituacao = editDraft.situacao;
        const nextOrigem = editDraft.origem;
        const nextLote = editDraft.lote.trim() || null;
        const nextValMmaa = normalizeValidadeInput(editDraft.validade);

        if (!nextMotivo) {
          setErrorMessage("Causa obrigatória.");
          return;
        }
        if (!nextSituacao) {
          setErrorMessage("Situação obrigatória.");
          return;
        }
        if (!nextOrigem) {
          setErrorMessage("Origem obrigatória.");
          return;
        }

        const patch: Partial<ControleAvariasRow> = {};
        if (nextQtd !== row.qtd) patch.qtd = nextQtd;
        if (nextEtiqueta !== row.etiqueta) patch.etiqueta = nextEtiqueta;
        if (nextMotivo !== row.motivo) patch.motivo = nextMotivo;
        if (nextSituacao !== row.situacao) patch.situacao = nextSituacao;
        if (nextOrigem !== row.origem) patch.origem = nextOrigem;
        if (nextLote !== row.lote) patch.lote = nextLote;
        if (nextValMmaa !== row.val_mmaa) patch.val_mmaa = nextValMmaa;

        if (Object.keys(patch).length > 0) {
          await applyRowUpdate(row, patch);
        }
        setEditingRowId(null);
        setEditDraft(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao validar alterações.";
        setErrorMessage(message);
      }
    },
    [applyRowUpdate, editDraft, editingRowId, profile]
  );

  const executeDeleteRow = useCallback(
    async (row: ControleAvariasRow) => {
      if (!canManageControleAvariasRow(profile, row)) {
        return;
      }
      if (row.remote_id) {
        const nextRow: ControleAvariasRow = {
          ...row,
          local_id: toPendingLocalId(row),
          sync_status: "pending_delete",
          sync_error: null,
          updated_at: new Date().toISOString()
        };
        await upsertControleAvariasRow(nextRow);
      } else {
        await removeControleAvariasRow(row.local_id);
      }

      await refreshLocalState();
      queuedSyncStateRef.current.lastMutationAt = Date.now();
      requestQueuedSync("mutation");
    },
    [preferOfflineMode, refreshLocalState, requestQueuedSync]
  );

  const requestDeleteRow = useCallback((row: ControleAvariasRow) => {
    setDeleteTarget(row);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const confirmDeleteRow = useCallback(async () => {
    if (!deleteTarget) return;
    await executeDeleteRow(deleteTarget);
    setDeleteTarget(null);
    setExpandedRowId((current) => (current === deleteTarget.local_id ? null : current));
    setEditingRowId((current) => (current === deleteTarget.local_id ? null : current));
    setEditDraft(null);
  }, [deleteTarget, executeDeleteRow]);
  const runReportSearch = useCallback(async () => {
    if (!canSeeReportTools) return;
    setReportError(null);
    setReportMessage(null);
    setReportCount(null);

    if (!reportDtIni || !reportDtFim) {
      setReportError("Informe data inicial e final.");
      return;
    }

    const dtIni = new Date(reportDtIni);
    const dtFim = new Date(reportDtFim);
    if (Number.isNaN(dtIni.getTime()) || Number.isNaN(dtFim.getTime())) {
      setReportError("Período inválido.");
      return;
    }
    if (dtFim < dtIni) {
      setReportError("A data final não pode ser menor que a data inicial.");
      return;
    }

    const parsedCd = reportCd ? Number.parseInt(reportCd, 10) : Number.NaN;
    const filters: ControleAvariasReportFilters = {
      dtIni: reportDtIni,
      dtFim: reportDtFim,
      cd: Number.isFinite(parsedCd) ? parsedCd : null
    };

    setReportBusySearch(true);
    try {
      const count = await countControleAvariasReportRows(filters);
      setReportCount(count);
      if (count > 0) {
        setReportMessage(`Foram encontradas ${count} avarias no período.`);
      } else {
        setReportMessage("Nenhuma avaria encontrada no período informado.");
      }
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Falha ao buscar avarias para relatório.");
    } finally {
      setReportBusySearch(false);
    }
  }, [canSeeReportTools, reportCd, reportDtFim, reportDtIni]);

  const runReportExport = useCallback(async () => {
    if (!canSeeReportTools || !reportCount || reportCount <= 0) return;
    setReportError(null);
    setReportBusyExport(true);

    try {
      const parsedCd = reportCd ? Number.parseInt(reportCd, 10) : Number.NaN;
      const filters: ControleAvariasReportFilters = {
        dtIni: reportDtIni,
        dtFim: reportDtFim,
        cd: Number.isFinite(parsedCd) ? parsedCd : null
      };

      const rows = await fetchControleAvariasReportRows(filters, 50000);
      if (rows.length === 0) {
        setReportMessage("Nenhuma avaria disponível para exportação.");
        return;
      }

      const XLSX = await import("xlsx");
      const exportRows = rows.map((row) => ({
        "Data/Hora": formatDateTime(row.data_hr),
        CD: row.cd,
        Etiqueta: row.etiqueta ?? "",
        Barras: row.barras,
        CODDV: row.coddv,
        Descricao: row.descricao,
        Quantidade: row.qtd,
        Origem: row.origem,
        Causa: row.motivo ?? "",
        Situação: row.situacao ?? "",
        Lote: row.lote ?? "",
        Validade: formatValidade(row.val_mmaa),
        Matricula_Auditor: row.mat_aud,
        Nome_Auditor: row.nome_aud
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      worksheet["!cols"] = [
        { wch: 20 },
        { wch: 8 },
        { wch: 16 },
        { wch: 20 },
        { wch: 10 },
        { wch: 48 },
        { wch: 12 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 16 },
        { wch: 11 },
        { wch: 18 },
        { wch: 32 }
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Avarias");
      const suffix = filters.cd == null ? "todos-cds" : `cd-${filters.cd}`;
      const fileName = `relatorio-avarias-${reportDtIni}-${reportDtFim}-${suffix}.xlsx`;

      XLSX.writeFile(workbook, fileName, { compression: true });
      setReportDtIni("");
      setReportDtFim("");
      setReportCount(null);
      setReportMessage(`Relatório gerado com sucesso (${rows.length} linhas).`);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Falha ao gerar relatório Excel.");
    } finally {
      setReportBusyExport(false);
    }
  }, [canSeeReportTools, reportCd, reportCount, reportDtFim, reportDtIni]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 980px)");
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);

    setIsDesktop(media.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const prefs = await getControleAvariasPreferences(profile.user_id);
      if (cancelled) return;

      setMultiploInput("1");
      setPreferOfflineMode(false);

      const initialCd = prefs.cd_ativo ?? fixedCd;
      setCdAtivo(initialCd ?? null);

      await cleanupExpiredControleAvariasRows(profile.user_id, ONE_DAY_MS);
      await refreshLocalState();
      if (cancelled) return;

      setPreferencesReady(true);
      await refreshSharedState();
      focusBarcode();
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [fixedCd, focusBarcode, profile.user_id, refreshLocalState, refreshSharedState]);

  useEffect(() => {
    if (!preferencesReady) return;
    const payloadCd = isGlobalAdmin ? cdAtivo : fixedCd;
    void saveControleAvariasPreferences(profile.user_id, {
      multiplo_padrao: 1,
      cd_ativo: payloadCd,
      prefer_offline_mode: preferOfflineMode
    });
  }, [cdAtivo, fixedCd, isGlobalAdmin, preferOfflineMode, preferencesReady, profile.user_id]);

  useEffect(() => {
    if (!isDesktop || !preferOfflineMode) return;
    setPreferOfflineMode(false);
    setStatusMessage("Modo online ativado no desktop.");
  }, [isDesktop, preferOfflineMode]);

  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;

    const loadOptions = async () => {
      try {
        const options = await fetchCdOptions();
        if (cancelled) return;
        setCdOptions(options);
        if (isGlobalAdmin && options.length > 0 && (cdAtivo == null || !options.some((item) => item.cd === cdAtivo))) {
          setCdAtivo(options[0].cd);
        }
      } catch {
        if (!cancelled) setCdOptions([]);
      }
    };

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [cdAtivo, isGlobalAdmin, isOnline]);

  useEffect(() => {
    if (!isOnline) return;
    void refreshSharedState();
  }, [isOnline, refreshSharedState]);

  useEffect(() => {
    if (!isOnline || pendingCount <= 0) return;

    let cancelled = false;

    const runAutoSync = async () => {
      if (cancelled) return;
      requestQueuedSync("interval");
    };

    void runAutoSync();
    const handleFocus = () => {
      requestQueuedSync("focus");
    };
    const handleOnline = () => {
      requestQueuedSync("online");
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestQueuedSync("visibility");
      }
    };
    const intervalId = window.setInterval(() => {
      void runAutoSync();
    }, QUEUED_WRITE_FLUSH_INTERVAL_MS);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isOnline, pendingCount, requestQueuedSync]);

  useEffect(() => {
    if (!showReport) return;
    const baseCd = isGlobalAdmin ? currentCd : fixedCd;
    setReportCd(baseCd != null ? String(baseCd) : "");
  }, [currentCd, fixedCd, isGlobalAdmin, showReport]);

  useEffect(() => {
    focusBarcode();
  }, [focusBarcode]);

  const handleCollect = useCallback(async (barcodeOverride?: string) => {
    if (collectInFlightRef.current) return;
    collectInFlightRef.current = true;
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const barras = normalizeBarcode(barcodeOverride ?? barcodeInput);
      if (!barras) {
        setBarcodeValidationState("invalid");
        openBlockingAlert("Código de barras obrigatório", "Informe o código de barras para continuar.");
        focusBarcode();
        return;
      }
      if (currentCd == null) {
        setBarcodeValidationState("invalid");
        setErrorMessage("CD não definido para o controle de avarias atual.");
        return;
      }
      const motivo = motivoInput.trim();
      if (!motivo) {
        setBarcodeValidationState("invalid");
        setErrorMessage("Causa obrigatória.");
        return;
      }
      if (!situacaoInput) {
        setBarcodeValidationState("invalid");
        setErrorMessage("Situação obrigatória.");
        return;
      }
      if (!origemInput) {
        setBarcodeValidationState("invalid");
        setErrorMessage("Origem obrigatória.");
        return;
      }
      setBarcodeValidationState("validating");
      const qtd = parseMultiplo(multiploInput);
      let valMmaa: string | null = null;
      try {
        valMmaa = normalizeValidadeInput(validadeInput);
      } catch (error) {
        setBarcodeValidationState("invalid");
        const validationError = error instanceof Error ? error.message : "Validade inválida.";
        setErrorMessage(validationError);
        return;
      }

      let product = readCachedProduct(barras);
      const hasLocalBase = dbBarrasCount > 0;

      // Prioridade: base local (quando já existe no dispositivo).
      if (!product && hasLocalBase) {
        product = await getDbBarrasByBarcode(barras);
        if (product) writeCachedProduct(product);
      }

      // Fallback online quando necessário (inclusive durante carga offline em andamento).
      if (!product) {
        if (shouldTriggerQueuedBackgroundSync(isOnline)) {
          product = await fetchDbBarrasByBarcodeOnline(barras);
          if (product) {
            writeCachedProduct(product);
            void upsertDbBarrasCacheRow(product);
            setDbBarrasCount((value) => Math.max(value, 1));
            setDbBarrasLastSyncAt(new Date().toISOString());
          }
        } else {
          setBarcodeValidationState("invalid");
          if (hasLocalBase) {
            openBlockingAlert(
              "Código de barras inválido",
              `O código de barras "${barras}" é inválido. Ele não existe na base db_barras.`
            );
            triggerScanErrorAlert("Código de barras inválido.");
          } else {
            openBlockingAlert(
              "Base de barras indisponível",
              "Sem internet para validação online e sem base local db_barras. Conecte-se e atualize a base."
            );
          }
          focusBarcode();
          return;
        }
      }

      if (!product) {
        setBarcodeValidationState("invalid");
        openBlockingAlert(
          "Código de barras inválido",
          `O código de barras "${barras}" é inválido. Ele não existe na base db_barras.`
        );
        triggerScanErrorAlert("Código de barras inválido.");
        focusBarcode();
        return;
      }

      const nowIso = new Date().toISOString();
      const row: ControleAvariasRow = {
        local_id: safeUuid(),
        remote_id: null,
        user_id: profile.user_id,
        etiqueta: null,
        cd: currentCd,
        barras: product.barras,
        coddv: product.coddv,
        descricao: product.descricao,
        qtd,
        motivo,
        situacao: situacaoInput,
        origem: origemInput,
        lote: loteInput.trim() || null,
        val_mmaa: valMmaa,
        mat_aud: profile.mat,
        nome_aud: profile.nome,
        data_hr: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
        sync_status: "pending_insert",
        sync_error: null
      };

      await upsertControleAvariasRow(row);
      void refreshLocalState();
      queuedSyncStateRef.current.lastMutationAt = Date.now();

      setBarcodeInput("");
      setMultiploInput("1");
      setMotivoInput("");
      setSituacaoInput("");
      setLoteInput("");
      setValidadeInput("");
      setExpandedRowId(row.local_id);

      if (shouldTriggerQueuedBackgroundSync(isOnline)) {
        requestQueuedSync("mutation");
        setStatusMessage("Avaria registrada e enviada para sincronização.");
      } else {
        setStatusMessage("Avaria registrada localmente. Pendência será sincronizada quando houver internet.");
      }
      showScanFeedback("success", product.descricao || "Produto", `+ ${qtd}`);
      setBarcodeValidationState("valid");
      focusBarcode();
    } catch (error) {
      setBarcodeValidationState("invalid");
      const normalizedError = error instanceof Error ? error.message : "Falha ao salvar avaria.";
      setErrorMessage(normalizedError);
      focusBarcode();
    } finally {
      collectInFlightRef.current = false;
    }
  }, [
    barcodeInput,
    currentCd,
    dbBarrasCount,
    focusBarcode,
    isOnline,
    loteInput,
    multiploInput,
    motivoInput,
    origemInput,
    situacaoInput,
    preferOfflineMode,
    profile.mat,
    profile.nome,
    profile.user_id,
    refreshLocalState,
    requestQueuedSync,
    showScanFeedback,
    readCachedProduct,
    writeCachedProduct,
    openBlockingAlert,
    triggerScanErrorAlert,
    validadeInput
  ]);

  const clearScannerInputTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current;
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const commitScannerInput = useCallback(async (rawValue: string) => {
    const normalized = normalizeBarcode(rawValue);
    if (!normalized) return;

    const state = scannerInputStateRef.current;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (
      state.lastSubmittedValue === normalized
      && now - state.lastSubmittedAt < SCANNER_INPUT_SUBMIT_COOLDOWN_MS
    ) {
      return;
    }

    clearScannerInputTimer();
    state.lastSubmittedValue = normalized;
    state.lastSubmittedAt = now;
    state.lastInputAt = 0;
    state.lastLength = 0;
    state.burstChars = 0;

    setBarcodeInput(normalized);
    await handleCollect(normalized);
  }, [clearScannerInputTimer, handleCollect]);

  const scheduleScannerInputAutoSubmit = useCallback((value: string) => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current;
    clearScannerInputTimer();
    state.timerId = window.setTimeout(() => {
      state.timerId = null;
      void commitScannerInput(value);
    }, SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS);
  }, [clearScannerInputTimer, commitScannerInput]);

  const onBarcodeInputChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setBarcodeInput(nextValue);
    setBarcodeValidationState("idle");

    const state = scannerInputStateRef.current;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsed = state.lastInputAt > 0 ? now - state.lastInputAt : Number.POSITIVE_INFINITY;
    const lengthDelta = Math.max(nextValue.length - state.lastLength, 0);

    if (lengthDelta > 0 && elapsed <= SCANNER_INPUT_MAX_INTERVAL_MS) {
      state.burstChars += lengthDelta;
    } else {
      state.burstChars = lengthDelta;
    }
    state.lastInputAt = now;
    state.lastLength = nextValue.length;

    if (!nextValue) {
      state.burstChars = 0;
      clearScannerInputTimer();
      return;
    }

    if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) {
      scheduleScannerInputAutoSubmit(nextValue);
      return;
    }

    clearScannerInputTimer();
  };

  const shouldHandleScannerTab = (value: string): boolean => {
    if (!value.trim()) return false;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const state = scannerInputStateRef.current;
    if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) return true;
    if (state.lastInputAt <= 0) return false;
    return now - state.lastInputAt <= SCANNER_INPUT_MAX_INTERVAL_MS * 2;
  };

  const onCollectSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void commitScannerInput(barcodeInput);
  };

  const onBarcodeKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !shouldHandleScannerTab(barcodeInput)) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    void commitScannerInput(barcodeInput);
  };

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      const state = scannerInputStateRef.current;
      if (state.timerId != null) {
        window.clearTimeout(state.timerId);
        state.timerId = null;
      }
    };
  }, []);

  const onMultiploFocus = (event: ReactFocusEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    window.requestAnimationFrame(() => {
      input.select();
    });
  };

  const onMultiploClick = (event: ReactMouseEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    window.requestAnimationFrame(() => {
      input.select();
    });
  };

  const onMultiploChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/\D/g, "");
    if (!digits) {
      setMultiploInput("");
      return;
    }
    const parsed = Number.parseInt(digits, 10);
    setMultiploInput(Number.isFinite(parsed) ? String(Math.max(1, parsed)) : "1");
  };

  const adjustMultiplo = (delta: number) => {
    setMultiploInput((current) => String(Math.max(1, parseMultiplo(current) + delta)));
  };

  useEffect(() => {
    if (!scannerOpen) return;

    let cancelled = false;
    let nativeFrameId: number | null = null;
    let nativeStream: MediaStream | null = null;
    let torchProbeTimer: number | null = null;
    let torchProbeAttempts = 0;
    setScannerError(null);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTorchModeRef.current = "none";

    const startScanner = async () => {
      try {
        const videoEl = scannerVideoRef.current;
        if (!videoEl) {
          setScannerError("Falha ao abrir visualização da câmera.");
          return;
        }

        const nativeBarcodeDetectorCtor = (window as Window & {
          BarcodeDetector?: new (options?: { formats?: string[] }) => {
            detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
          };
        }).BarcodeDetector;

        if (nativeBarcodeDetectorCtor && typeof navigator.mediaDevices?.getUserMedia === "function") {
          try {
            const detector = new nativeBarcodeDetectorCtor({
              formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "codabar"]
            });
            nativeStream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
              }
            });
            if (cancelled) {
              nativeStream.getTracks().forEach((track) => track.stop());
              nativeStream = null;
              return;
            }

            videoEl.srcObject = nativeStream;
            await videoEl.play().catch(() => undefined);
            const track = nativeStream.getVideoTracks()[0] ?? null;
            if (track) scannerTrackRef.current = track;

            const runNativeDetect = async () => {
              if (cancelled) return;
              try {
                const detections = await detector.detect(videoEl);
                const first = detections[0];
                const scanned = normalizeBarcode(first?.rawValue ?? "");
                if (scanned) {
                  setBarcodeInput(scanned);
                  setScannerOpen(false);
                  stopCameraScanner();
                  setTorchEnabled(false);
                  setTorchSupported(false);
                  void handleCollect(scanned);
                  return;
                }
              } catch {
                // Mantem polling silencioso enquanto a camera busca foco.
              }
              nativeFrameId = window.requestAnimationFrame(() => {
                void runNativeDetect();
              });
            };

            nativeFrameId = window.requestAnimationFrame(() => {
              void runNativeDetect();
            });

            const probeTorchAvailabilityNative = () => {
              if (cancelled) return;
              const track = resolveScannerTrack();
              if (track) scannerTrackRef.current = track;
              if (supportsTrackTorch(track)) {
                scannerTorchModeRef.current = "track";
                setTorchSupported(true);
              } else {
                scannerTorchModeRef.current = "none";
                setTorchSupported(false);
              }
            };
            probeTorchAvailabilityNative();
            return;
          } catch {
            if (nativeStream) {
              nativeStream.getTracks().forEach((track) => track.stop());
              nativeStream = null;
            }
          }
        }

        const zxing = await import("@zxing/browser");
        if (cancelled) return;

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
              const formatName = result.getBarcodeFormat?.().toString?.() ?? "";
              if (/QR_CODE/i.test(formatName)) return;
              const scanned = normalizeBarcode(result.getText() ?? "");
              if (!scanned) return;

              setBarcodeInput(scanned);
              setScannerOpen(false);
              stopCameraScanner();
              setTorchEnabled(false);
              setTorchSupported(false);
              void handleCollect(scanned);
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
          const track = resolveScannerTrack();
          if (track) {
            scannerTrackRef.current = track;
          }
          if (supportsTrackTorch(track)) {
            scannerTorchModeRef.current = "track";
            setTorchSupported(true);
            return;
          }
          if (typeof controls.switchTorch === "function") {
            scannerTorchModeRef.current = "controls";
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
      if (nativeFrameId != null) window.cancelAnimationFrame(nativeFrameId);
      if (nativeStream) {
        nativeStream.getTracks().forEach((track) => track.stop());
        nativeStream = null;
      }
      if (torchProbeTimer != null) {
        window.clearTimeout(torchProbeTimer);
      }
      stopCameraScanner();
    };
  }, [handleCollect, resolveScannerTrack, scannerOpen, stopCameraScanner, supportsTrackTorch]);

  return (
    <>
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
            <span className="module-back-icon" aria-hidden="true">
              <BackIcon />
            </span>
            <span>Início</span>
          </Link>

          <div className="module-topbar-user-side">
            <PendingSyncBadge
              pendingCount={pendingCount}
              errorCount={pendingErrors}
              title="Linhas pendentes de envio"
              onClick={pendingCount > 0 || pendingErrors > 0 ? () => void openPendingSyncModal() : undefined}
            />
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
              {isOnline ? "🟢 Online" : "🔴 Offline"}
            </span>
          </div>
        </div>

        <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
          <span className="module-icon" aria-hidden="true">
            <ModuleIcon name={MODULE_DEF.icon} />
          </span>
          <span className="module-title">{MODULE_DEF.title}</span>
        </div>
      </header>

      <PendingSyncDialog
        isOpen={showPendingSyncModal}
        title="Pendências de sincronização"
        items={pendingSyncRows.map((row) => ({
          id: row.local_id,
          title: `Produto ${row.coddv} - ${row.descricao}`,
          subtitle: `Status ${asStatusLabel(row.sync_status)}`,
          detail: [
            row.origem ? `Origem ${row.origem}` : null,
            row.motivo ? `Causa ${row.motivo}` : null,
            row.situacao ? `Situação ${row.situacao}` : null,
            row.etiqueta ? `Etiqueta ${row.etiqueta}` : null
          ].filter(Boolean).join(" | ") || `Barras ${row.barras}`,
          error: row.sync_error,
          updatedAt: formatDateTime(row.updated_at),
          onDiscard: () => void discardPendingSyncRow(row.local_id)
        }))}
        emptyText="Nenhuma pendência encontrada."
        busy={busyPendingDiscard}
        onClose={() => setShowPendingSyncModal(false)}
        onDiscardAll={pendingSyncRows.length > 0 ? () => void discardAllPendingSyncRows() : undefined}
      />

      <section className="modules-shell coleta-shell">
        <div className="coleta-head">
          <h2>Olá, {displayUserName}</h2>
          <p>Para trabalhar offline, sincronize a base de barras antes de iniciar o controle de avarias.</p>
          <p className="coleta-meta-line">
            Base local: <strong>{dbBarrasCount}</strong> itens
            {dbBarrasLastSyncAt ? ` | Atualizada em ${formatDateTime(dbBarrasLastSyncAt)}` : " | Sem atualização ainda"}
          </p>
        </div>

        {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
        {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
        {progressMessage ? <div className="alert success">{progressMessage}</div> : null}
        {scanFeedback ? (
          <div
            key={scanFeedback.id}
            className={`termo-scan-feedback ${scanFeedback.tone === "error" ? "is-error" : "is-success"}`}
            role="status"
            aria-live="polite"
            style={scanFeedbackTop != null ? { top: `${scanFeedbackTop}px` } : undefined}
          >
            <strong>{scanFeedback.tone === "error" ? "Erro" : scanFeedback.title}</strong>
            {scanFeedback.detail ? <span>{scanFeedback.detail}</span> : null}
          </div>
        ) : null}
        {preferOfflineMode ? (
          <div className="alert success">
            Modo offline ativo: novas avarias ficam locais e você sincroniza quando quiser.
          </div>
        ) : null}

        {preferOfflineMode && dbBarrasCount <= 0 ? (
          isOnline ? (
            <div className="alert success">
              Modo offline ativo sem base local completa. Enquanto carrega, a busca continua online.
            </div>
          ) : (
            <div className="alert error">
              Modo offline ativo sem base local. Conecte-se para carregar a base.
            </div>
          )
        ) : null}

        {!preferOfflineMode && !isOnline ? (
          <div className="alert error">
            {isDesktop
              ? "Você está sem internet. No desktop o controle de avarias funciona somente online."
              : "Você está sem internet. Para continuar registrando avarias, ative Trabalhar offline."}
          </div>
        ) : null}

        <div className="coleta-actions-row">
          {!isDesktop ? (
            <button
              type="button"
              className={`btn btn-muted coleta-offline-toggle${preferOfflineMode ? " is-active" : ""}`}
              onClick={() => void onToggleOfflineMode()}
              title={preferOfflineMode ? "Desativar modo offline local" : "Ativar modo offline local"}
              disabled={busyRefresh}
            >
              <span aria-hidden="true"><OfflineModeIcon enabled={!preferOfflineMode} /></span>
              {busyRefresh ? "Carregando base..." : preferOfflineMode ? "Offline local" : "Trabalhar offline"}
            </button>
          ) : null}
          <button type="button" className="btn btn-muted" onClick={() => void refreshSharedState()} disabled={!isOnline || currentCd == null}>
            Atualizar avarias de hoje
          </button>
          <button type="button" className="btn btn-primary coleta-sync-btn" onClick={() => void runSync(false)} disabled={!isOnline || busySync || pendingCount <= 0}>
            <span aria-hidden="true"><UploadIcon /></span>
            {busySync ? "Sincronizando..." : "Sincronizar agora"}
          </button>
          {canSeeReportTools ? (
            <button
              type="button"
              className={`btn btn-muted coleta-report-toggle${showReport ? " is-active" : ""}`}
              aria-pressed={showReport}
              onClick={() => {
                setShowReport((value) => {
                  const next = !value;
                  if (next) {
                    const today = todayIsoBrasilia();
                    setReportDtIni(today);
                    setReportDtFim(today);
                  }
                  return next;
                });
                setReportError(null);
                setReportMessage(null);
                setReportCount(null);
              }}
              title="Buscar avarias para relatório"
            >
              <span className="coleta-report-toggle-icon" aria-hidden="true"><SearchIcon /></span>
              Buscar avarias
            </button>
          ) : null}
        </div>
        {showReport && canSeeReportTools ? (
          <section className="coleta-report-panel">
            <div className="coleta-report-head">
              <h3>Relatório de Avarias (Admin)</h3>
              <p>Busca por período com contagem antes da extração.</p>
            </div>

            {reportError ? <div className="alert error">{reportError}</div> : null}
            {reportMessage ? <div className="alert success">{reportMessage}</div> : null}

            <div className="coleta-report-grid">
              <label>
                Data inicial
                <input
                  type="date"
                  autoComplete="off"
                  value={reportDtIni}
                  onChange={(event) => setReportDtIni(event.target.value)}
                  required
                />
              </label>
              <label>
                Data final
                <input
                  type="date"
                  autoComplete="off"
                  value={reportDtFim}
                  onChange={(event) => setReportDtFim(event.target.value)}
                  required
                />
              </label>
              {isGlobalAdmin ? (
                <label>
                  CD
                  <select value={reportCd} onChange={(event) => setReportCd(event.target.value)}>
                    <option value="">Todos CDs permitidos</option>
                    {cdOptions.map((option) => (
                      <option key={option.cd} value={option.cd}>
                        {cdCodeLabel(option.cd)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  CD
                  <input
                    type="text"
                    value={fixedCd != null ? `CD ${String(fixedCd).padStart(2, "0")}` : "CD não definido"}
                    disabled
                  />
                </label>
              )}
            </div>

            <div className="coleta-report-actions">
              <button type="button" className="btn btn-muted" onClick={() => void runReportSearch()} disabled={reportBusySearch}>
                {reportBusySearch ? "Buscando..." : "Buscar no período"}
              </button>
              <button
                type="button"
                className="btn btn-primary coleta-export-btn"
                onClick={() => void runReportExport()}
                disabled={reportBusyExport || (reportCount ?? 0) <= 0}
              >
                <span aria-hidden="true"><FileIcon /></span>
                {reportBusyExport ? "Gerando Excel..." : "Gerar relatório Excel"}
              </button>
            </div>

            {reportCount != null ? <p className="coleta-report-count">Registros encontrados: {reportCount}</p> : null}
          </section>
        ) : null}

        <form className="coleta-form" onSubmit={onCollectSubmit}>
          <div className="coleta-form-grid">
            <label>
              Código de barras
              <div className="input-icon-wrap with-action">
                <span className={barcodeIconClassName} aria-hidden="true">
                  <BarcodeIcon />
                </span>
                <input
                  ref={barcodeRef}
                  type="text"
                  inputMode={barcodeInputMode}
                  value={barcodeInput}
                  onChange={onBarcodeInputChange}
                  onFocus={enableBarcodeSoftKeyboard}
                  onPointerDown={enableBarcodeSoftKeyboard}
                  onBlur={disableBarcodeSoftKeyboard}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  onKeyDown={onBarcodeKeyDown}
                  placeholder="Bipe ou digite e pressione Enter"
                  required
                />
                <button
                  type="button"
                  className="input-action-btn"
                  onClick={openCameraScanner}
                  title="Ler código pela câmera"
                  aria-label="Ler código pela câmera"
                  disabled={!cameraSupported}
                >
                  <CameraIcon />
                </button>
              </div>
            </label>

            <label>
              Múltiplo
              <div className="input-icon-wrap with-stepper">
                <span className="field-icon" aria-hidden="true">
                  <QuantityIcon />
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  enterKeyHint="done"
                  value={multiploInput}
                  onFocus={onMultiploFocus}
                  onClick={onMultiploClick}
                  onBlur={() => {
                    if (!multiploInput) {
                      setMultiploInput("1");
                    }
                  }}
                  onChange={onMultiploChange}
                />
                <div className="input-stepper-group" aria-hidden="false">
                  <button
                    type="button"
                    className="input-stepper-btn"
                    onClick={() => adjustMultiplo(-1)}
                    aria-label="Diminuir múltiplo"
                    title="Diminuir múltiplo"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="input-stepper-btn"
                    onClick={() => adjustMultiplo(1)}
                    aria-label="Aumentar múltiplo"
                    title="Aumentar múltiplo"
                  >
                    +
                  </button>
                </div>
              </div>
            </label>

            {isGlobalAdmin ? (
              <label>
                Depósito
                <select
                  value={cdAtivo ?? ""}
                  onChange={(event) => setCdAtivo(Number.parseInt(event.target.value, 10))}
                  required
                >
                  <option value="" disabled>Selecione o CD</option>
                  {cdOptions.map((option) => (
                    <option key={option.cd} value={option.cd}>
                      {cdCodeLabel(option.cd)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Causa
              <select
                value={motivoInput}
                onChange={(event) => setMotivoInput(event.target.value as "" | typeof CAUSA_OPTIONS[number])}
                required
              >
                <option value="" disabled>Selecione a causa</option>
                {CAUSA_OPTIONS.map((causa) => (
                  <option key={causa} value={causa}>{causa}</option>
                ))}
              </select>
            </label>

            <label>
              Situação
              <select
                value={situacaoInput}
                onChange={(event) => setSituacaoInput(event.target.value as "" | ControleAvariasSituacao)}
                required
              >
                <option value="" disabled>Selecione a situação</option>
                {SITUACAO_OPTIONS.map((situacao) => (
                  <option key={situacao} value={situacao}>{situacao}</option>
                ))}
              </select>
            </label>

            <label>
              Origem
              <select
                value={origemInput}
                onChange={(event) => setOrigemInput(event.target.value as "" | ControleAvariasOrigem)}
                required
              >
                <option value="" disabled>Selecione a origem</option>
                {ORIGEM_OPTIONS.map((origem) => (
                  <option key={origem} value={origem}>{origem}</option>
                ))}
              </select>
            </label>

            <div className="coleta-inline-fields">
              <label>
                Lote
                <input type="text" value={loteInput} onChange={(event) => setLoteInput(event.target.value)} placeholder="Opcional" />
              </label>

              <label>
                Validade (MM/AA)
                <input
                  type="text"
                  inputMode="numeric"
                  value={validadeInput}
                  onChange={(event) => setValidadeInput(formatValidadeInput(event.target.value))}
                  placeholder="MM/AA"
                  maxLength={5}
                />
              </label>
            </div>
          </div>

          <button
            className="btn btn-primary coleta-submit"
            type="submit"
            disabled={currentCd == null || (!isOnline && dbBarrasCount <= 0)}
          >
            Salvar avaria
          </button>
        </form>

        <div className="coleta-list-head">
          <h3>Avarias de hoje</h3>
          <span>{visibleRows.length} itens</span>
        </div>

        <div className="coleta-list">
          {visibleRows.length === 0 ? (
            <div className="coleta-empty">Nenhuma avaria disponível para hoje neste depósito.</div>
          ) : (
            visibleRows.map((row) => {
              const canManageRow = canManageControleAvariasRow(profile, row);
              const rowOffset = canManageRow ? getRowSwipeOffset(row.local_id) : 0;
              const isDraggingRow = swipeDrag?.rowId === row.local_id;
              const isSwipeVisible = isDraggingRow || swipeOpen?.rowId === row.local_id;
              return (
                <article key={row.local_id} className={`coleta-row-card${expandedRowId === row.local_id ? " is-expanded" : ""}`}>
                  <div className={`coleta-row-swipe${isSwipeVisible ? " is-swipe-visible" : ""}`}>
                    {canManageRow ? (
                      <div className="coleta-row-actions" aria-hidden="true">
                        <button
                          type="button"
                          className="coleta-row-action edit"
                          onClick={() => openQuickEdit(row)}
                          title="Editar quantidade"
                          aria-label="Editar quantidade"
                        >
                          <span aria-hidden="true"><PencilIcon /></span>
                          <span>Editar</span>
                        </button>
                        <button
                          type="button"
                          className="coleta-row-action delete"
                          onClick={() => onSwipeActionDelete(row)}
                          title="Apagar item"
                          aria-label="Apagar item"
                        >
                          <span aria-hidden="true"><XMarkIcon /></span>
                          <span>Apagar</span>
                        </button>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      className={`coleta-row-line${canManageRow ? " is-swipeable" : ""}${isDraggingRow ? " is-dragging" : ""}`}
                      style={canManageRow ? { transform: `translate3d(${rowOffset}px, 0, 0)` } : undefined}
                      onTouchStart={(event) => onRowTouchStart(event, row.local_id, canManageRow)}
                      onTouchMove={(event) => onRowTouchMove(event, row.local_id, canManageRow)}
                      onTouchEnd={() => onRowTouchEnd(row.local_id)}
                      onTouchCancel={() => onRowTouchEnd(row.local_id)}
                      onClick={() => {
                        if (suppressRowClickRef.current === row.local_id) {
                          suppressRowClickRef.current = null;
                          return;
                        }
                        setSwipeOpen(null);
                        setExpandedRowId((current) => {
                          const next = current === row.local_id ? null : row.local_id;
                          if (next !== editingRowId) {
                            setEditingRowId(null);
                            setEditDraft(null);
                          }
                          return next;
                        });
                      }}
                    >
                      <div className="coleta-row-line-main">
                        <strong>{row.descricao}</strong>
                        <p>Barras: {row.barras} | CODDV: {row.coddv}</p>
                        <p>Qtd: {row.qtd}</p>
                        <p>Origem: {row.origem}</p>
                        <p>Causa: {row.motivo || "-"}</p>
                        <p>Situação: {row.situacao || "-"}</p>
                        <p>Registrado em {formatDateTime(row.data_hr)}</p>
                        {hasRowChangeAfterCollect(row) ? (
                          <p>Última alteração em {formatDateTime(row.updated_at)}</p>
                        ) : null}
                      </div>

                      <div className="coleta-row-line-right">
                        <span className={`coleta-row-status ${asStatusClass(row.sync_status)}`} title={row.sync_error ?? undefined}>
                          {asStatusLabel(row.sync_status)}
                        </span>
                        <span className="coleta-row-expand" aria-hidden="true">
                          <ChevronIcon open={expandedRowId === row.local_id} />
                        </span>
                      </div>
                    </button>
                  </div>

                  {expandedRowId === row.local_id ? (
                    <div className="coleta-row-edit-card">
                      {canManageRow && editingRowId === row.local_id && editDraft ? (
                        <div className="coleta-row-edit-grid">
                          <label>
                            Qtd
                            <input
                              ref={(element) => {
                                quantityInputRefs.current[row.local_id] = element;
                              }}
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoComplete="off"
                              enterKeyHint="done"
                              value={editDraft.qtd}
                              onFocus={(event) => event.currentTarget.select()}
                              onClick={(event) => event.currentTarget.select()}
                              onChange={(event) => {
                                const digits = event.target.value.replace(/\D/g, "");
                                setEditDraft((current) => (current ? { ...current, qtd: digits } : current));
                              }}
                            />
                          </label>

                          <label>
                            Etiqueta
                            <input
                              type="text"
                              value={editDraft.etiqueta}
                              onChange={(event) => {
                                const value = event.target.value;
                                setEditDraft((current) => (current ? { ...current, etiqueta: value } : current));
                              }}
                            />
                          </label>

                          <label>
                            Causa
                            <select
                              value={editDraft.motivo}
                              onChange={(event) => {
                                const next = event.target.value as "" | typeof CAUSA_OPTIONS[number];
                                setEditDraft((current) => (current ? { ...current, motivo: next } : current));
                              }}
                            >
                              <option value="" disabled>Selecione a causa</option>
                              {CAUSA_OPTIONS.map((causa) => (
                                <option key={causa} value={causa}>{causa}</option>
                              ))}
                            </select>
                          </label>

                          <label>
                            Situação
                            <select
                              value={editDraft.situacao}
                              onChange={(event) => {
                                const next = event.target.value as "" | ControleAvariasSituacao;
                                setEditDraft((current) => (current ? { ...current, situacao: next } : current));
                              }}
                            >
                              <option value="" disabled>Selecione a situação</option>
                              {SITUACAO_OPTIONS.map((situacao) => (
                                <option key={situacao} value={situacao}>{situacao}</option>
                              ))}
                            </select>
                          </label>

                          <label>
                            Origem
                            <select
                              value={editDraft.origem}
                              onChange={(event) => {
                                const next = event.target.value as "" | ControleAvariasOrigem;
                                setEditDraft((current) => (current ? { ...current, origem: next } : current));
                              }}
                            >
                              <option value="" disabled>Selecione a origem</option>
                              {ORIGEM_OPTIONS.map((origem) => (
                                <option key={origem} value={origem}>{origem}</option>
                              ))}
                            </select>
                          </label>

                          <label>
                            Lote
                            <input
                              type="text"
                              value={editDraft.lote}
                              onChange={(event) => {
                                const value = event.target.value;
                                setEditDraft((current) => (current ? { ...current, lote: value } : current));
                              }}
                            />
                          </label>

                          <label>
                            Validade
                            <input
                              type="text"
                              inputMode="numeric"
                              value={editDraft.validade}
                              maxLength={5}
                              onChange={(event) => {
                                const value = formatValidadeInput(event.target.value);
                                setEditDraft((current) => (current ? { ...current, validade: value } : current));
                              }}
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="coleta-row-detail-grid">
                          <div className="coleta-row-detail">
                            <span>Qtd</span>
                            <strong>{row.qtd}</strong>
                          </div>
                          <div className="coleta-row-detail">
                            <span>Etiqueta</span>
                            <strong>{row.etiqueta ?? "-"}</strong>
                          </div>
                          <div className="coleta-row-detail">
                            <span>Origem</span>
                            <strong>{row.origem}</strong>
                          </div>
                          <div className="coleta-row-detail">
                            <span>Causa</span>
                            <strong>{row.motivo || "-"}</strong>
                          </div>
                          <div className="coleta-row-detail">
                            <span>Situação</span>
                            <strong>{row.situacao || "-"}</strong>
                          </div>
                          <div className="coleta-row-detail">
                            <span>Lote</span>
                            <strong>{row.lote ?? "-"}</strong>
                          </div>
                          <div className="coleta-row-detail">
                            <span>Validade</span>
                            <strong>{formatValidade(row.val_mmaa) || "-"}</strong>
                          </div>
                        </div>
                      )}

                      <div className="coleta-row-footer">
                        <span>
                          Auditor: {row.nome_aud} ({row.mat_aud})
                        </span>
                        {canManageRow ? (
                          editingRowId === row.local_id ? (
                            <div className="coleta-row-footer-actions">
                              <button className="btn btn-muted" type="button" onClick={cancelRowEdit}>
                                Cancelar
                              </button>
                              <button className="btn btn-primary" type="button" onClick={() => void saveRowEdit(row)}>
                                Salvar alterações
                              </button>
                            </div>
                          ) : (
                            <div className="coleta-row-footer-actions">
                              <button className="btn btn-muted" type="button" onClick={() => startRowEdit(row)}>
                                Editar
                              </button>
                              <button className="btn btn-muted coleta-delete-btn" type="button" onClick={() => requestDeleteRow(row)}>
                                <span aria-hidden="true"><TrashIcon /></span>
                                Excluir
                              </button>
                            </div>
                          )
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>

        {scannerOpen && typeof document !== "undefined"
          ? createPortal(
              <div className="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="scanner-title" onClick={closeCameraScanner}>
                <div className="scanner-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                  <div className="scanner-head">
                    <h3 id="scanner-title">Scanner de barras</h3>
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
                          <FlashIcon on={torchEnabled} />
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
                        <CloseIcon />
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

        {blockingAlert && typeof document !== "undefined"
          ? createPortal(
              <div
                className="confirm-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="coleta-blocking-alert-title"
                aria-describedby="coleta-blocking-alert-message"
              >
                <div className="confirm-dialog surface-enter">
                  <h3 id="coleta-blocking-alert-title">{blockingAlert.title}</h3>
                  <p id="coleta-blocking-alert-message">{blockingAlert.message}</p>
                  <div className="confirm-actions">
                    <button className="btn btn-primary" type="button" onClick={closeBlockingAlert}>
                      OK
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}

        {deleteTarget && typeof document !== "undefined"
          ? createPortal(
              <div
                className="confirm-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="coleta-delete-title"
                onClick={closeDeleteConfirm}
              >
                <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                  <h3 id="coleta-delete-title">Excluir avaria registrada</h3>
                  <p>Deseja excluir "{deleteTarget.descricao}" do controle de avarias?</p>
                  <div className="confirm-actions">
                    <button className="btn btn-muted" type="button" onClick={closeDeleteConfirm}>
                      Cancelar
                    </button>
                    <button className="btn btn-danger" type="button" onClick={() => void confirmDeleteRow()}>
                      Excluir
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}
      </section>
    </>
  );
}
