import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { IScannerControls } from "@zxing/browser";
import { Link } from "react-router-dom";
import { formatDateTimeBrasilia } from "../../shared/brasilia-datetime";
import { getDbBarrasMeta } from "../../shared/db-barras/storage";
import { normalizeBarcode, refreshDbBarrasCacheSmart } from "../../shared/db-barras/sync";
import { getDbEndMeta } from "../../shared/db-end/storage";
import { refreshDbEndCacheSmart } from "../../shared/db-end/sync";
import { useOnDemandSoftKeyboard } from "../../shared/use-on-demand-soft-keyboard";
import { BackIcon, EyeIcon, ModuleIcon } from "../../ui/icons";
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import { getModuleByKeyOrThrow } from "../registry";
import {
  getControleValidadePrefs,
  hasOfflineSnapshot,
  saveControleValidadePrefs,
  saveOfflineSnapshot
} from "./storage";
import {
  downloadOfflineSnapshot,
  enqueueLinhaColeta,
  enqueueLinhaRetirada,
  enqueuePulRetirada,
  fetchLinhaColetaHistoryList,
  fetchLinhaRetiradaList,
  fetchPulRetiradaList,
  flushControleValidadeOfflineQueue,
  getOfflineQueueStats,
  loadProjectedOfflineRows,
  normalizeControleValidadeError,
  resolveLinhaColetaProduto,
  searchLinhaLastColeta,
  updateLinhaColetaValidadeOnline,
  updateLinhaRetiradaQtdOnline,
  updatePulRetiradaQtdOnline
} from "./sync";
import type {
  ControleValidadeModuleProfile,
  LinhaColetaLookupResult,
  LinhaColetaHistoryRow,
  LinhaRetiradaRow,
  PulRetiradaRow,
  RetiradaStatus,
  RetiradaStatusFilter
} from "./types";

interface ControleValidadePageProps {
  isOnline: boolean;
  profile: ControleValidadeModuleProfile;
}

type MainTab = "linha" | "pulmao";
type LinhaSubTab = "coleta" | "retirada";

const MODULE_DEF = getModuleByKeyOrThrow("controle-validade");
const OFFLINE_FLUSH_INTERVAL_MS = 15000;
const SCANNER_INPUT_MAX_INTERVAL_MS = 45;
const SCANNER_INPUT_MIN_BURST_CHARS = 5;
const SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS = 90;
const SCANNER_INPUT_SUBMIT_COOLDOWN_MS = 600;
const ALL_MONTHS_FILTER = "__all__";

type BarcodeValidationState = "idle" | "validating" | "valid" | "invalid";

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

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: ControleValidadeModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) {
    return Math.trunc(profile.cd_default);
  }
  return parseCdFromLabel(profile.cd_nome);
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

function normalizeValidadeInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length !== 4) throw new Error("Validade deve estar no formato MMAA.");
  const month = Number.parseInt(digits.slice(0, 2), 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) throw new Error("Mês da validade inválido.");
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function formatDateTime(value: string | null): string {
  return formatDateTimeBrasilia(value, { includeSeconds: true, emptyFallback: "-", invalidFallback: "value" });
}

const MONTH_LABELS_PT_BR = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez"
] as const;
const UI_TEXT_COLLATOR = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base"
});

function parseValidadeMonth(value: string): { month: number; year: number; key: string } | null {
  const matched = /^(\d{2})\/(\d{2})$/.exec(String(value ?? "").trim());
  if (!matched) return null;
  const month = Number.parseInt(matched[1], 10);
  const yearTwoDigits = Number.parseInt(matched[2], 10);
  if (!Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(yearTwoDigits)) return null;
  const year = 2000 + yearTwoDigits;
  return {
    month,
    year,
    key: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`
  };
}

function formatValidadeMonthOption(value: string): string {
  if (value === ALL_MONTHS_FILTER) return "Todos os meses";
  const parsed = parseValidadeMonth(value);
  if (!parsed) return value || "Mes invalido";
  return `${MONTH_LABELS_PT_BR[parsed.month - 1]} ${parsed.year}`;
}

function compareUiText(left: string | number | null | undefined, right: string | number | null | undefined): number {
  return UI_TEXT_COLLATOR.compare(String(left ?? ""), String(right ?? ""));
}

function linhaZone(value: string): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return "SEM ZONA";
  const matched = /^([A-Z]{2,4})/.exec(normalized);
  return matched?.[1] ?? (normalized.slice(0, 4) || "SEM ZONA");
}

function formatActorDisplay(matValue: string | null | undefined, nomeValue: string | null | undefined): string {
  const mat = String(matValue ?? "").trim();
  const nome = String(nomeValue ?? "").trim();
  if (mat && nome) return `${mat} - ${nome}`;
  if (nome) return nome;
  if (mat) return mat;
  return "Aguardando sincronizacao";
}

function formatLinhaCollector(row: LinhaRetiradaRow): string {
  return formatActorDisplay(row.auditor_mat_ultima_coleta, row.auditor_nome_ultima_coleta);
}

function formatLinhaHistoryCollector(row: LinhaColetaHistoryRow): string {
  return formatActorDisplay(row.auditor_mat, row.auditor_nome);
}

function normalizeLinhaColetaSearchTerm(value: string): { raw: string; upper: string; digits: string } {
  const raw = String(value ?? "").trim();
  return {
    raw,
    upper: raw.toUpperCase(),
    digits: raw.replace(/\D/g, "")
  };
}

function currentValidadeMonthValue(baseDate = new Date()): string {
  return `${String(baseDate.getMonth() + 1).padStart(2, "0")}/${String(baseDate.getFullYear()).slice(-2)}`;
}

function buildValidadeMonthWindow(baseDate = new Date(), count = 5): string[] {
  const safeCount = Math.max(Math.trunc(count), 1);
  return Array.from({ length: safeCount }, (_, index) => {
    const date = new Date(baseDate.getFullYear(), baseDate.getMonth() + index, 1);
    return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getFullYear()).slice(-2)}`;
  });
}

function safeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function barcodeIcon() {
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
      <path d="M7 2h10l-4 7h5l-9 13 2-9H6z" />
      {!on ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function searchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

function pencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20l4.2-1 9.9-9.9-3.2-3.2L5 15.8 4 20z" />
      <path d="M13.8 5.9l3.2 3.2" />
    </svg>
  );
}

export default function ControleValidadePage({ isOnline, profile }: ControleValidadePageProps) {
  const defaultMonthFilter = useMemo(() => currentValidadeMonthValue(), []);
  const barcodeRef = useRef<HTMLInputElement | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerTrackRef = useRef<MediaStreamTrack | null>(null);
  const scannerTorchModeRef = useRef<"none" | "controls" | "track">("none");
  const scannerInputStateRef = useRef<ScannerInputState>(createScannerInputState());
  const {
    inputMode: barcodeInputMode,
    enableSoftKeyboard: enableBarcodeSoftKeyboard,
    disableSoftKeyboard: disableBarcodeSoftKeyboard
  } = useOnDemandSoftKeyboard("numeric");

  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);

  const [mainTab, setMainTab] = useState<MainTab>("linha");
  const [linhaSubTab, setLinhaSubTab] = useState<LinhaSubTab>("coleta");
  const [linhaStatusFilter, setLinhaStatusFilter] = useState<RetiradaStatus>("pendente");
  const [pulStatusFilter, setPulStatusFilter] = useState<RetiradaStatusFilter>("todos");
  const [monthFilter, setMonthFilter] = useState(ALL_MONTHS_FILTER);

  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingErrors, setPendingErrors] = useState(0);
  const [dbBarrasCount, setDbBarrasCount] = useState(0);
  const [dbEndCount, setDbEndCount] = useState(0);
  const [offlineSnapshotReady, setOfflineSnapshotReady] = useState(false);
  const [busyOfflineBase, setBusyOfflineBase] = useState(false);
  const [busyFlush, setBusyFlush] = useState(false);
  const [busyLoadRows, setBusyLoadRows] = useState(false);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeValidationState, setBarcodeValidationState] = useState<BarcodeValidationState>("idle");
  const [validadeInput, setValidadeInput] = useState("");
  const [coletaLookupBusy, setColetaLookupBusy] = useState(false);
  const [coletaLookup, setColetaLookup] = useState<LinhaColetaLookupResult | null>(null);
  const [selectedEnderecoSep, setSelectedEnderecoSep] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [expandedLinhaCardKey, setExpandedLinhaCardKey] = useState<string | null>(null);
  const [expandedLinhaColetaHistoryKey, setExpandedLinhaColetaHistoryKey] = useState<string | null>(null);
  const [expandedPulCardKey, setExpandedPulCardKey] = useState<string | null>(null);

  const [linhaColetaHistoryRows, setLinhaColetaHistoryRows] = useState<LinhaColetaHistoryRow[]>([]);
  const [linhaRows, setLinhaRows] = useState<LinhaRetiradaRow[]>([]);
  const [pulRows, setPulRows] = useState<PulRetiradaRow[]>([]);
  const [linhaQtyInputs, setLinhaQtyInputs] = useState<Record<string, string>>({});
  const [pulQtyInputs, setPulQtyInputs] = useState<Record<string, string>>({});
  const [editingColetaId, setEditingColetaId] = useState<string | null>(null);
  const [editingColetaValidade, setEditingColetaValidade] = useState("");
  const [editingLinhaRetiradaId, setEditingLinhaRetiradaId] = useState<string | null>(null);
  const [editingLinhaRetiradaQty, setEditingLinhaRetiradaQty] = useState("");
  const [editingPulRetiradaId, setEditingPulRetiradaId] = useState<string | null>(null);
  const [editingPulRetiradaQty, setEditingPulRetiradaQty] = useState("");
  const [busyEdit, setBusyEdit] = useState(false);
  const [lastColetaSearchTerm, setLastColetaSearchTerm] = useState("");
  const [lastColetaSearchBusy, setLastColetaSearchBusy] = useState(false);
  const [lastColetaSearchResult, setLastColetaSearchResult] = useState<LinhaColetaHistoryRow | null>(null);

  const flushBusyRef = useRef(false);
  const isOfflineModeActive = preferOfflineMode || !isOnline;
  const cameraSupported = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }, []);
  const barcodeIconClassName = `field-icon validation-status${barcodeValidationState === "validating" ? " is-validating" : ""}${barcodeValidationState === "valid" ? " is-valid" : ""}${barcodeValidationState === "invalid" ? " is-invalid" : ""}`;

  const refreshQueueStats = useCallback(async () => {
    if (activeCd == null) {
      setPendingCount(0);
      setPendingErrors(0);
      return;
    }
    const stats = await getOfflineQueueStats(profile.user_id, activeCd);
    setPendingCount(stats.pending);
    setPendingErrors(stats.errors);
  }, [activeCd, profile.user_id]);

  const refreshOfflineMeta = useCallback(async () => {
    if (activeCd == null) {
      setDbBarrasCount(0);
      setDbEndCount(0);
      return;
    }
    const [barrasMeta, endMeta] = await Promise.all([
      getDbBarrasMeta(),
      getDbEndMeta(activeCd)
    ]);
    setDbBarrasCount(barrasMeta.row_count);
    setDbEndCount(endMeta.row_count);
  }, [activeCd]);

  const loadRows = useCallback(async () => {
    if (activeCd == null) {
      setLinhaColetaHistoryRows([]);
      setLinhaRows([]);
      setPulRows([]);
      return;
    }

    setBusyLoadRows(true);
    setErrorMessage(null);
    try {
      if (isOfflineModeActive) {
        const projected = await loadProjectedOfflineRows({
          userId: profile.user_id,
          cd: activeCd
        });
        setLinhaColetaHistoryRows(projected.linha_coleta_history);
        setLinhaRows(projected.linha_rows);
        setPulRows(projected.pul_rows);
        return;
      }

      const [linhaOnline, linhaColetaHistoryOnline, pulOnline] = await Promise.all([
        fetchLinhaRetiradaList({ cd: activeCd, status: "todos" }),
        fetchLinhaColetaHistoryList({ cd: activeCd, limit: 1000 }),
        fetchPulRetiradaList({ cd: activeCd, status: "todos" })
      ]);
      setLinhaColetaHistoryRows(linhaColetaHistoryOnline);
      setLinhaRows(linhaOnline);
      setPulRows(pulOnline);

      await saveOfflineSnapshot({
        user_id: profile.user_id,
        cd: activeCd,
        linha_rows: linhaOnline,
        linha_coleta_history: linhaColetaHistoryOnline,
        pul_rows: pulOnline
      });
      setOfflineSnapshotReady(true);
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    } finally {
      setBusyLoadRows(false);
    }
  }, [activeCd, isOfflineModeActive, profile.user_id]);

  const flushQueue = useCallback(async (manual = false): Promise<void> => {
    if (!isOnline || activeCd == null) return;
    if (flushBusyRef.current) return;
    flushBusyRef.current = true;
    setBusyFlush(true);
    setErrorMessage(null);

    try {
      const result = await flushControleValidadeOfflineQueue(profile.user_id, activeCd);
      await refreshQueueStats();
      if (result.discarded_pul_sem_estoque > 0) {
        setStatusMessage(
          `${result.discarded_pul_sem_estoque} evento(s) de Pulmão foram descartados por estoque indisponível (qtd_est_disp <= 0).`
        );
      } else if (manual && result.synced > 0) {
        setStatusMessage(`Sincronização concluída: ${result.synced} evento(s) enviados.`);
      } else if (manual && result.synced === 0 && result.discarded === 0 && result.failed === 0) {
        setStatusMessage("Nenhum evento pendente para sincronizar.");
      }

      if (result.failed > 0) {
        setErrorMessage(`Falha ao sincronizar ${result.failed} evento(s).`);
      }

      if (result.synced > 0 || result.discarded > 0) {
        await downloadOfflineSnapshot(profile.user_id, activeCd);
        setOfflineSnapshotReady(true);
        await loadRows();
      }
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    } finally {
      setBusyFlush(false);
      flushBusyRef.current = false;
    }
  }, [activeCd, isOnline, loadRows, profile.user_id, refreshQueueStats]);

  const syncOfflineBase = useCallback(async (): Promise<boolean> => {
    if (!isOnline) {
      setErrorMessage("Sem internet para baixar base offline.");
      return false;
    }
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      return false;
    }

    setBusyOfflineBase(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setProgressMessage("Iniciando preparação da base offline...");

    try {
      await refreshDbBarrasCacheSmart((progress) => {
        setProgressMessage(`db_barras: ${progress.rowsFetched} registros (${progress.percent}%)`);
      }, { allowFullReconcile: true });

      await refreshDbEndCacheSmart(activeCd, (progress) => {
        setProgressMessage(`db_end: ${progress.rowsFetched} registros (${progress.percent}%)`);
      }, { allowFullReconcile: true });

      setProgressMessage("Atualizando snapshot de coletas e retiradas...");
      await downloadOfflineSnapshot(profile.user_id, activeCd);
      setOfflineSnapshotReady(true);
      await refreshOfflineMeta();
      await loadRows();
      setStatusMessage("Base offline pronta para uso neste dispositivo.");
      return true;
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
      return false;
    } finally {
      setProgressMessage(null);
      setBusyOfflineBase(false);
    }
  }, [activeCd, isOnline, loadRows, profile.user_id, refreshOfflineMeta]);

  const onToggleOfflineMode = useCallback(async () => {
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      return;
    }

    const next = !preferOfflineMode;
    setErrorMessage(null);
    setStatusMessage(null);

    if (!next) {
      setPreferOfflineMode(false);
      setStatusMessage("Modo offline desativado.");
      return;
    }

    if (!isOnline) {
      const snapshotExists = await hasOfflineSnapshot(profile.user_id, activeCd);
      if (!snapshotExists) {
        setErrorMessage("Sem internet e sem snapshot local. Conecte-se e clique em Trabalhar offline.");
        return;
      }
      setPreferOfflineMode(true);
      setStatusMessage("Modo offline ativado usando snapshot local.");
      return;
    }

    const synced = await syncOfflineBase();
    if (synced) {
      setPreferOfflineMode(true);
    }
  }, [activeCd, isOnline, preferOfflineMode, profile.user_id, syncOfflineBase]);

  const focusBarcode = useCallback(() => {
    disableBarcodeSoftKeyboard();
    window.requestAnimationFrame(() => {
      barcodeRef.current?.focus();
    });
  }, [disableBarcodeSoftKeyboard]);

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
        void controls.switchTorch(false).catch(() => undefined);
      }
      controls.stop();
      scannerControlsRef.current = null;
    }
    if (activeTrack && torchEnabled && scannerTorchModeRef.current === "track") {
      const trackWithConstraints = activeTrack as MediaStreamTrack & {
        applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
      };
      if (typeof trackWithConstraints.applyConstraints === "function") {
        void trackWithConstraints.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => undefined);
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

  const executeLookup = useCallback(async (rawValue: string) => {
    const barras = normalizeBarcode(rawValue);
    if (!barras) {
      setErrorMessage("Informe o código de barras.");
      setStatusMessage(null);
      setBarcodeValidationState("invalid");
      setColetaLookup(null);
      setSelectedEnderecoSep("");
      focusBarcode();
      return;
    }
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      setStatusMessage(null);
      setBarcodeValidationState("invalid");
      setColetaLookup(null);
      setSelectedEnderecoSep("");
      focusBarcode();
      return;
    }

    setBarcodeInput(barras);
    setColetaLookupBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setBarcodeValidationState("validating");
    try {
      const result = await resolveLinhaColetaProduto({
        cd: activeCd,
        rawBarcode: barras,
        isOnline,
        preferOfflineMode: isOfflineModeActive
      });
      setColetaLookup(result);
      setSelectedEnderecoSep(result.enderecos_sep[0] ?? "");
      setStatusMessage(`Produto localizado: ${result.descricao}.`);
      setBarcodeValidationState("valid");
      focusBarcode();
    } catch (error) {
      setColetaLookup(null);
      setSelectedEnderecoSep("");
      setErrorMessage(normalizeControleValidadeError(error));
      setBarcodeValidationState("invalid");
      focusBarcode();
    } finally {
      setColetaLookupBusy(false);
    }
  }, [activeCd, focusBarcode, isOfflineModeActive, isOnline]);

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
    if (state.lastSubmittedValue === normalized && now - state.lastSubmittedAt < SCANNER_INPUT_SUBMIT_COOLDOWN_MS) {
      return;
    }

    clearScannerInputTimer();
    state.lastSubmittedValue = normalized;
    state.lastSubmittedAt = now;
    state.lastInputAt = 0;
    state.lastLength = 0;
    state.burstChars = 0;

    await executeLookup(normalized);
  }, [clearScannerInputTimer, executeLookup]);

  const scheduleScannerInputAutoSubmit = useCallback((value: string) => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current;
    clearScannerInputTimer();
    state.timerId = window.setTimeout(() => {
      state.timerId = null;
      void commitScannerInput(value);
    }, SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS);
  }, [clearScannerInputTimer, commitScannerInput]);

  const onBarcodeInputChange = useCallback((nextValue: string) => {
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
  }, [clearScannerInputTimer, scheduleScannerInputAutoSubmit]);

  const shouldHandleScannerTab = useCallback((value: string): boolean => {
    if (!value.trim()) return false;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const state = scannerInputStateRef.current;
    if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) return true;
    if (state.lastInputAt <= 0) return false;
    return now - state.lastInputAt <= SCANNER_INPUT_MAX_INTERVAL_MS * 2;
  }, []);

  const onBarcodeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !shouldHandleScannerTab(barcodeInput)) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    void commitScannerInput(barcodeInput);
  }, [barcodeInput, commitScannerInput, shouldHandleScannerTab]);

  const onLookupProduto = useCallback(async () => {
    await executeLookup(barcodeInput);
  }, [barcodeInput, executeLookup]);

  const onSubmitColeta = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      return;
    }
    if (!coletaLookup) {
      setErrorMessage("Busque o produto antes de salvar a coleta.");
      return;
    }
    if (!selectedEnderecoSep) {
      setErrorMessage("Selecione um endereço da Linha.");
      return;
    }

    try {
      const valMmaa = normalizeValidadeInput(validadeInput);
      await enqueueLinhaColeta({
        userId: profile.user_id,
        cd: activeCd,
        payload: {
          client_event_id: safeUuid(),
          cd: activeCd,
          barras: coletaLookup.barras,
          coddv: coletaLookup.coddv,
          descricao: coletaLookup.descricao,
          endereco_sep: selectedEnderecoSep,
          val_mmaa: valMmaa,
          auditor_mat: profile.mat,
          auditor_nome: profile.nome,
          data_hr: new Date().toISOString()
        }
      });
      await refreshQueueStats();
      setStatusMessage("Coleta da Linha registrada.");
      setBarcodeInput("");
      setBarcodeValidationState("idle");
      setValidadeInput("");
      setColetaLookup(null);
      setSelectedEnderecoSep("");
      if (isOnline) {
        await flushQueue(false);
      } else {
        await loadRows();
      }
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    }
  }, [activeCd, coletaLookup, flushQueue, isOnline, loadRows, profile.user_id, refreshQueueStats, selectedEnderecoSep, validadeInput]);

  const submitLinhaRetirada = useCallback(async (row: LinhaRetiradaRow) => {
    if (activeCd == null) return;
    const key = `${row.coddv}|${row.endereco_sep}|${row.val_mmaa}|${row.ref_coleta_mes}`;
    const parsed = Number.parseInt((linhaQtyInputs[key] ?? "").replace(/\D/g, ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setErrorMessage("Informe a quantidade retirada da Linha.");
      return;
    }
    const qtd = parsed;
    let queued = false;

    try {
      await enqueueLinhaRetirada({
        userId: profile.user_id,
        cd: activeCd,
        payload: {
          client_event_id: safeUuid(),
          cd: activeCd,
          coddv: row.coddv,
          endereco_sep: row.endereco_sep,
          val_mmaa: row.val_mmaa,
          ref_coleta_mes: row.ref_coleta_mes,
          qtd_retirada: qtd,
          data_hr: new Date().toISOString()
        }
      });
      queued = true;
      await refreshQueueStats();
      setStatusMessage(`Retirada da Linha registrada (${qtd}).`);
      setLinhaQtyInputs((current) => ({ ...current, [key]: "" }));
      if (isOnline) {
        await flushQueue(false);
      }
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    } finally {
      if (queued) {
        await loadRows();
      }
    }
  }, [activeCd, flushQueue, isOnline, linhaQtyInputs, loadRows, profile.user_id, refreshQueueStats]);

  const submitPulRetirada = useCallback(async (row: PulRetiradaRow) => {
    if (activeCd == null) return;
    const key = `${row.coddv}|${row.endereco_pul}|${row.val_mmaa}`;
    const parsed = Number.parseInt((pulQtyInputs[key] ?? "").replace(/\D/g, ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setErrorMessage("Informe a quantidade retirada do Pulmão.");
      return;
    }
    const qtd = parsed;
    let queued = false;

    try {
      await enqueuePulRetirada({
        userId: profile.user_id,
        cd: activeCd,
        payload: {
          client_event_id: safeUuid(),
          cd: activeCd,
          coddv: row.coddv,
          endereco_pul: row.endereco_pul,
          val_mmaa: row.val_mmaa,
          qtd_retirada: qtd,
          data_hr: new Date().toISOString()
        }
      });
      queued = true;
      await refreshQueueStats();
      setStatusMessage(`Retirada do Pulmão registrada (${qtd}).`);
      if (isOnline) {
        await flushQueue(false);
      }
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    } finally {
      if (queued) {
        await loadRows();
      }
    }
  }, [activeCd, flushQueue, isOnline, loadRows, profile.user_id, pulQtyInputs, refreshQueueStats]);

  useEffect(() => {
    if (activeCd == null) return;
    const bootstrap = async () => {
      try {
        const prefs = await getControleValidadePrefs(profile.user_id);
        setPreferOfflineMode(Boolean(prefs.prefer_offline_mode));
      } finally {
        setPreferencesReady(true);
      }
      await Promise.all([
        refreshQueueStats(),
        refreshOfflineMeta()
      ]);
      const snapshotExists = await hasOfflineSnapshot(profile.user_id, activeCd);
      setOfflineSnapshotReady(snapshotExists);
    };
    void bootstrap();
  }, [activeCd, profile.user_id, refreshOfflineMeta, refreshQueueStats]);

  useEffect(() => {
    if (!preferencesReady) return;
    void saveControleValidadePrefs(profile.user_id, {
      prefer_offline_mode: preferOfflineMode
    });
  }, [preferencesReady, preferOfflineMode, profile.user_id]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!isOnline || activeCd == null) return;
    const run = () => {
      void flushQueue(false);
    };
    const intervalId = window.setInterval(run, OFFLINE_FLUSH_INTERVAL_MS);
    window.addEventListener("online", run);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("online", run);
    };
  }, [activeCd, flushQueue, isOnline]);

  useEffect(() => {
    if (mainTab !== "linha" || linhaSubTab !== "coleta") return;
    focusBarcode();
  }, [focusBarcode, linhaSubTab, mainTab]);

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
                  void commitScannerInput(scanned);
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
              const trackFromVideo = resolveScannerTrack();
              if (trackFromVideo) scannerTrackRef.current = trackFromVideo;
              if (supportsTrackTorch(trackFromVideo)) {
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
          (scanResult, error) => {
            if (cancelled) return;

            if (scanResult) {
              const formatName = scanResult.getBarcodeFormat?.().toString?.() ?? "";
              if (/QR_CODE/i.test(formatName)) return;
              const scanned = normalizeBarcode(scanResult.getText() ?? "");
              if (!scanned) return;

              setBarcodeInput(scanned);
              setScannerOpen(false);
              stopCameraScanner();
              setTorchEnabled(false);
              setTorchSupported(false);
              void commitScannerInput(scanned);
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
          if (track) scannerTrackRef.current = track;
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
  }, [commitScannerInput, resolveScannerTrack, scannerOpen, stopCameraScanner, supportsTrackTorch]);

  const onSearchLastColeta = useCallback(async () => {
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      return;
    }
    const normalizedTerm = normalizeLinhaColetaSearchTerm(lastColetaSearchTerm);
    if (!normalizedTerm.raw) {
      setErrorMessage("Informe endereço, CODDV ou barras para buscar a última coleta.");
      return;
    }

    setLastColetaSearchBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      if (isOnline) {
        const result = await searchLinhaLastColeta({
          cd: activeCd,
          term: normalizedTerm.raw
        });
        setLastColetaSearchResult(result);
        if (result) {
          setStatusMessage("Última coleta localizada.");
          setExpandedLinhaColetaHistoryKey("last-search-result");
        } else {
          setStatusMessage("Nenhuma coleta encontrada para o termo informado.");
          setExpandedLinhaColetaHistoryKey(null);
        }
        return;
      }

      const localResult = [...linhaColetaHistoryRows]
        .filter((row) => {
          const barrasDigits = normalizeBarcode(row.barras);
          return row.endereco_sep.toUpperCase() === normalizedTerm.upper
            || String(row.coddv) === normalizedTerm.digits
            || (normalizedTerm.digits !== "" && barrasDigits === normalizedTerm.digits);
        })
        .sort((left, right) => compareUiText(String(right.data_coleta ?? ""), String(left.data_coleta ?? "")))[0] ?? null;
      setLastColetaSearchResult(localResult);
      if (localResult) {
        setStatusMessage("Última coleta localizada no histórico local.");
        setExpandedLinhaColetaHistoryKey("last-search-result");
      } else {
        setStatusMessage("Nenhuma coleta encontrada no histórico local.");
        setExpandedLinhaColetaHistoryKey(null);
      }
    } catch (error) {
      setLastColetaSearchResult(null);
      setErrorMessage(normalizeControleValidadeError(error));
    } finally {
      setLastColetaSearchBusy(false);
    }
  }, [activeCd, isOnline, lastColetaSearchTerm, linhaColetaHistoryRows]);

  const canEditColetaRow = useCallback((row: LinhaColetaHistoryRow | null) => {
    return Boolean(isOnline && row?.id && row.auditor_id === profile.user_id);
  }, [isOnline, profile.user_id]);

  const startEditingColeta = useCallback((row: LinhaColetaHistoryRow) => {
    setEditingColetaId(row.id);
    setEditingColetaValidade(row.val_mmaa.replace(/\D/g, ""));
  }, []);

  const cancelEditingColeta = useCallback(() => {
    setEditingColetaId(null);
    setEditingColetaValidade("");
  }, []);

  const saveEditingColeta = useCallback(async (row: LinhaColetaHistoryRow) => {
    if (!canEditColetaRow(row)) return;
    try {
      setBusyEdit(true);
      setErrorMessage(null);
      const updated = await updateLinhaColetaValidadeOnline({
        id: row.id,
        val_mmaa: normalizeValidadeInput(editingColetaValidade)
      });
      setStatusMessage("Validade da coleta atualizada.");
      setLastColetaSearchResult((current) => (current?.id === updated.id ? updated : current));
      cancelEditingColeta();
      await loadRows();
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    } finally {
      setBusyEdit(false);
    }
  }, [canEditColetaRow, cancelEditingColeta, editingColetaValidade, loadRows]);

  const startEditingLinhaRetirada = useCallback((row: LinhaRetiradaRow) => {
    if (!row.editable_retirada_id || row.editable_retirada_qtd == null) return;
    setEditingLinhaRetiradaId(row.editable_retirada_id);
    setEditingLinhaRetiradaQty(String(row.editable_retirada_qtd));
  }, []);

  const cancelEditingLinhaRetirada = useCallback(() => {
    setEditingLinhaRetiradaId(null);
    setEditingLinhaRetiradaQty("");
  }, []);

  const saveEditingLinhaRetirada = useCallback(async (row: LinhaRetiradaRow) => {
    if (!isOnline || !row.editable_retirada_id) return;
    const parsed = Number.parseInt(editingLinhaRetiradaQty.replace(/\D/g, ""), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setErrorMessage("Informe a quantidade da sua retirada.");
      return;
    }
    try {
      setBusyEdit(true);
      setErrorMessage(null);
      await updateLinhaRetiradaQtdOnline({
        id: row.editable_retirada_id,
        qtd_retirada: parsed
      });
      setStatusMessage("Quantidade da retirada da Linha atualizada.");
      cancelEditingLinhaRetirada();
      await loadRows();
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    } finally {
      setBusyEdit(false);
    }
  }, [cancelEditingLinhaRetirada, editingLinhaRetiradaQty, isOnline, loadRows]);

  const startEditingPulRetirada = useCallback((row: PulRetiradaRow) => {
    if (!row.editable_retirada_id || row.editable_retirada_qtd == null) return;
    setEditingPulRetiradaId(row.editable_retirada_id);
    setEditingPulRetiradaQty(String(row.editable_retirada_qtd));
  }, []);

  const cancelEditingPulRetirada = useCallback(() => {
    setEditingPulRetiradaId(null);
    setEditingPulRetiradaQty("");
  }, []);

  const saveEditingPulRetirada = useCallback(async (row: PulRetiradaRow) => {
    if (!isOnline || !row.editable_retirada_id) return;
    const parsed = Number.parseInt(editingPulRetiradaQty.replace(/\D/g, ""), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setErrorMessage("Informe a quantidade da sua retirada.");
      return;
    }
    try {
      setBusyEdit(true);
      setErrorMessage(null);
      await updatePulRetiradaQtdOnline({
        id: row.editable_retirada_id,
        qtd_retirada: parsed
      });
      setStatusMessage("Quantidade da retirada do Pulmão atualizada.");
      cancelEditingPulRetirada();
      await loadRows();
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    } finally {
      setBusyEdit(false);
    }
  }, [cancelEditingPulRetirada, editingPulRetiradaQty, isOnline, loadRows]);

  const activeStatusFilter = mainTab === "pulmao" ? pulStatusFilter : linhaStatusFilter;

  const linhaColetaHistoryGrouped = useMemo(() => {
    return linhaColetaHistoryRows
      .filter((row) => {
        const parsedDate = row.data_coleta ? new Date(row.data_coleta) : null;
        if (!parsedDate || Number.isNaN(parsedDate.getTime())) return false;
        return parsedDate.getFullYear() === new Date().getFullYear()
          && parsedDate.getMonth() === new Date().getMonth();
      })
      .sort((left, right) => {
      const zoneCompare = compareUiText(left.zona, right.zona);
      if (zoneCompare !== 0) return zoneCompare;
      const dateCompare = compareUiText(String(right.data_coleta ?? ""), String(left.data_coleta ?? ""));
      if (dateCompare !== 0) return dateCompare;
      const addressCompare = compareUiText(left.endereco_sep, right.endereco_sep);
      if (addressCompare !== 0) return addressCompare;
      return compareUiText(left.coddv, right.coddv);
    })
      .slice(0, 1000);
  }, [linhaColetaHistoryRows]);

  const linhaRowsFiltered = useMemo(() => {
    const effectiveMonthFilter = linhaStatusFilter === "concluido" ? defaultMonthFilter : monthFilter;
    return linhaRows
      .filter((row) => {
        if (row.status !== linhaStatusFilter) return false;
        if (effectiveMonthFilter !== ALL_MONTHS_FILTER && row.val_mmaa !== effectiveMonthFilter) return false;
        return true;
      })
      .sort((left, right) => {
        const zoneCompare = compareUiText(linhaZone(left.endereco_sep), linhaZone(right.endereco_sep));
        if (zoneCompare !== 0) return zoneCompare;
        const addressCompare = compareUiText(left.endereco_sep, right.endereco_sep);
        if (addressCompare !== 0) return addressCompare;
        const coddvCompare = compareUiText(left.coddv, right.coddv);
        if (coddvCompare !== 0) return coddvCompare;
        return compareUiText(left.descricao, right.descricao);
      });
  }, [defaultMonthFilter, linhaRows, linhaStatusFilter, monthFilter]);

  const pulRowsFiltered = useMemo(() => {
    const effectiveMonthFilter = pulStatusFilter === "concluido" ? defaultMonthFilter : monthFilter;
    return pulRows
      .filter((row) => {
        if (pulStatusFilter !== "todos" && row.status !== pulStatusFilter) return false;
        if (effectiveMonthFilter !== ALL_MONTHS_FILTER && row.val_mmaa !== effectiveMonthFilter) return false;
        return true;
      })
      .sort((left, right) => {
        const zoneCompare = compareUiText(left.zona, right.zona);
        if (zoneCompare !== 0) return zoneCompare;
        const addressCompare = compareUiText(left.endereco_pul, right.endereco_pul);
        if (addressCompare !== 0) return addressCompare;
        const coddvCompare = compareUiText(left.coddv, right.coddv);
        if (coddvCompare !== 0) return coddvCompare;
        return compareUiText(left.descricao, right.descricao);
      });
  }, [defaultMonthFilter, monthFilter, pulRows, pulStatusFilter]);

  const hasBarcodeInput = barcodeInput.trim().length > 0;
  const monthFilterOptions = useMemo(() => {
    return buildValidadeMonthWindow();
  }, []);
  const preferredMonthFilterOptions = useMemo(() => {
    if (activeStatusFilter === "concluido") return [defaultMonthFilter];
    const sourceRows = mainTab === "pulmao" ? pulRows : linhaRows;
    const filteredRows = sourceRows.filter((row) => {
      if (activeStatusFilter === "todos") return true;
      return row.status === activeStatusFilter;
    });
    const availableMonths = monthFilterOptions.filter((month) =>
      filteredRows.some((row) => row.val_mmaa === month)
    );
    const scopedMonths = availableMonths.length > 0 ? availableMonths : monthFilterOptions;
    return [ALL_MONTHS_FILTER, ...scopedMonths];
  }, [activeStatusFilter, defaultMonthFilter, linhaRows, mainTab, monthFilterOptions, pulRows]);
  const displayedMonthFilter = activeStatusFilter === "concluido" ? defaultMonthFilter : monthFilter;

  useEffect(() => {
    if (activeStatusFilter === "concluido") {
      if (monthFilter !== defaultMonthFilter) {
        setMonthFilter(defaultMonthFilter);
      }
      return;
    }
    if (monthFilter === ALL_MONTHS_FILTER) return;
    if (preferredMonthFilterOptions.includes(monthFilter)) return;
    setMonthFilter(ALL_MONTHS_FILTER);
  }, [activeStatusFilter, defaultMonthFilter, monthFilter, preferredMonthFilterOptions]);

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
              title="Eventos offline pendentes de sincronização"
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

      <section className="modules-shell controle-validade-shell">
        <article className="module-screen surface-enter controle-validade-screen">
          <div className="module-screen-header">
            <div className="module-screen-title-row">
              <div className="module-screen-title controle-validade-title">
                <h2>Olá, {displayUserName}</h2>
                <p>Controle de validade por coleta e retirada</p>
                <div className="controle-validade-meta controle-validade-meta-inline">
                  <span>db_barras local: {dbBarrasCount}</span>
                  <span>db_end local: {dbEndCount}</span>
                </div>
              </div>
              <div className="controle-validade-head-actions">
                <button
                  type="button"
                  className={`btn btn-muted${preferOfflineMode ? " is-active" : ""}`}
                  onClick={() => void onToggleOfflineMode()}
                  disabled={busyOfflineBase}
                >
                  {busyOfflineBase ? "Baixando base..." : preferOfflineMode ? "📦 Offline ativo" : "📶 Trabalhar offline"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void flushQueue(true)}
                  disabled={!isOnline || busyFlush}
                >
                  {busyFlush ? "Sincronizando..." : "Sincronizar"}
                </button>
              </div>
            </div>
          </div>

          <div className="module-screen-body controle-validade-body">
            {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
            {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
            {progressMessage ? <div className="alert success">{progressMessage}</div> : null}
            {preferOfflineMode && !offlineSnapshotReady ? (
              <div className="alert error">Modo offline ativo sem snapshot de retirada. Use "Trabalhar offline".</div>
            ) : null}

            <div className="controle-validade-filters-row">
              <label className={`controle-validade-tabs ${mainTab === "pulmao" ? "is-pulmao" : "is-linha"}`} htmlFor="controle-validade-tipo">
                <span className="controle-validade-filter-label">
                  <span className="controle-validade-filter-label-full">Tipo de Validade</span>
                  <span className="controle-validade-filter-label-short">Tipo</span>
                </span>
                <select
                  id="controle-validade-tipo"
                  value={mainTab}
                  onChange={(event) => {
                    const nextTab = event.target.value as MainTab;
                    setMainTab(nextTab);
                    setMonthFilter(ALL_MONTHS_FILTER);
                    if (nextTab === "pulmao") {
                      setPulStatusFilter("todos");
                    }
                  }}
                >
                  <option value="linha">Separacao</option>
                  <option value="pulmao">Pulmao</option>
                </select>
              </label>

              <label className="controle-validade-tabs controle-validade-tabs-date" htmlFor="controle-validade-mes">
                <span className="controle-validade-filter-label">
                  <span className="controle-validade-filter-label-full">Data da Validade</span>
                  <span className="controle-validade-filter-label-short">Data</span>
                </span>
                <select
                  id="controle-validade-mes"
                  value={displayedMonthFilter}
                  onChange={(event) => setMonthFilter(event.target.value)}
                  disabled={activeStatusFilter === "concluido"}
                >
                  {preferredMonthFilterOptions.map((value) => (
                    <option key={value} value={value}>
                      {formatValidadeMonthOption(value)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {mainTab === "linha" ? (
              <div className="controle-validade-pane">
                <div className="controle-validade-linha-controls">
                  <div className="gestao-op-segmented controle-validade-subtabs" role="tablist" aria-label="Fluxo da Linha">
                    <button
                      type="button"
                      className={`controle-validade-subtab-btn is-coleta${linhaSubTab === "coleta" ? " is-active" : ""}`}
                      onClick={() => setLinhaSubTab("coleta")}
                    >
                      Coleta
                    </button>
                    <button
                      type="button"
                      className={`controle-validade-subtab-btn is-retirada${linhaSubTab === "retirada" ? " is-active" : ""}`}
                      onClick={() => setLinhaSubTab("retirada")}
                    >
                      Retirada
                    </button>
                  </div>

                  {linhaSubTab === "retirada" ? (
                    <div className="controle-validade-status-tabs">
                      <button
                        type="button"
                        className={`controle-validade-status-tab is-pendente${linhaStatusFilter === "pendente" ? " is-active" : ""}`}
                        onClick={() => {
                          setLinhaStatusFilter("pendente");
                          setMonthFilter(ALL_MONTHS_FILTER);
                        }}
                        aria-pressed={linhaStatusFilter === "pendente"}
                      >
                        Pendentes
                      </button>
                      <button
                        type="button"
                        className={`controle-validade-status-tab is-concluido${linhaStatusFilter === "concluido" ? " is-active" : ""}`}
                        onClick={() => {
                          setLinhaStatusFilter("concluido");
                          setMonthFilter(defaultMonthFilter);
                        }}
                        aria-pressed={linhaStatusFilter === "concluido"}
                      >
                        Concluídos
                      </button>
                    </div>
                  ) : null}
                </div>

                {linhaSubTab === "coleta" ? (
                  <>
                    <form className="controle-validade-form" onSubmit={onSubmitColeta}>
                      <label>
                        Código de barras
                        <div className="controle-validade-inline-field">
                          <div className="input-icon-wrap with-action controle-validade-mobile-search-wrap">
                            <span className={barcodeIconClassName} aria-hidden="true">
                              {barcodeIcon()}
                            </span>
                            <input
                              ref={barcodeRef}
                              type="text"
                              inputMode={barcodeInputMode}
                              value={barcodeInput}
                              onChange={(event) => onBarcodeInputChange(event.target.value)}
                              onKeyDown={onBarcodeKeyDown}
                              onFocus={enableBarcodeSoftKeyboard}
                              onPointerDown={enableBarcodeSoftKeyboard}
                              onBlur={disableBarcodeSoftKeyboard}
                              autoComplete="off"
                              autoCapitalize="none"
                              autoCorrect="off"
                              spellCheck={false}
                              enterKeyHint="search"
                              placeholder="Bipe, digite ou use câmera"
                              required
                            />
                            <button
                              type="button"
                              className="input-action-btn controle-validade-mobile-search-btn"
                              onClick={hasBarcodeInput ? () => void onLookupProduto() : openCameraScanner}
                              title={hasBarcodeInput ? "Buscar produto" : "Ler código pela câmera"}
                              aria-label={hasBarcodeInput ? "Buscar produto" : "Ler código pela câmera"}
                              disabled={hasBarcodeInput ? coletaLookupBusy || activeCd == null : !cameraSupported || coletaLookupBusy}
                            >
                              {hasBarcodeInput ? searchIcon() : cameraIcon()}
                            </button>
                          </div>
                          <button
                            type="button"
                            className="btn btn-muted controle-validade-search-btn"
                            onClick={() => void onLookupProduto()}
                            disabled={coletaLookupBusy || activeCd == null}
                          >
                            <span aria-hidden="true">{searchIcon()}</span>
                            {coletaLookupBusy ? "Buscando..." : "Buscar"}
                          </button>
                        </div>
                      </label>

                      {coletaLookup ? (
                        <div className="controle-validade-lookup-card">
                          <strong>{coletaLookup.descricao}</strong>
                          <span>CODDV: {coletaLookup.coddv}</span>
                          <span>Barras: {coletaLookup.barras}</span>
                          <label>
                            Endereço Linha (SEP)
                            <select
                              value={selectedEnderecoSep}
                              onChange={(event) => setSelectedEnderecoSep(event.target.value)}
                              required
                            >
                              {coletaLookup.enderecos_sep.map((endereco) => (
                                <option key={endereco} value={endereco}>
                                  {endereco}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ) : null}

                      <label>
                        Validade (MMAA)
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={4}
                          value={validadeInput}
                          onChange={(event) => setValidadeInput(event.target.value.replace(/\D/g, "").slice(0, 4))}
                          placeholder="Ex.: 0426"
                          required
                        />
                      </label>

                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={activeCd == null || !coletaLookup || !selectedEnderecoSep}
                      >
                        Salvar coleta
                      </button>
                    </form>

                    <section className="controle-validade-coleta-extras">
                      <div className="controle-validade-lookup-card controle-validade-coleta-search-card">
                        <label>
                          Buscar última coleta
                          <div className="controle-validade-inline-field controle-validade-search-inline-field">
                            <div className="input-icon-wrap with-action controle-validade-last-search-wrap">
                              <input
                                type="text"
                                value={lastColetaSearchTerm}
                                onChange={(event) => setLastColetaSearchTerm(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter") return;
                                  event.preventDefault();
                                  void onSearchLastColeta();
                                }}
                                autoComplete="off"
                                autoCapitalize="characters"
                                autoCorrect="off"
                                spellCheck={false}
                                placeholder="Endereço, CODDV ou barras"
                              />
                              <button
                                type="button"
                                className="input-action-btn controle-validade-last-search-btn"
                                onClick={() => void onSearchLastColeta()}
                                aria-label="Buscar última coleta"
                                title="Buscar última coleta"
                                disabled={lastColetaSearchBusy || activeCd == null}
                              >
                                {searchIcon()}
                              </button>
                            </div>
                            <button
                              type="button"
                              className="btn btn-muted controle-validade-search-btn"
                              onClick={() => void onSearchLastColeta()}
                              disabled={lastColetaSearchBusy || activeCd == null}
                            >
                              <span aria-hidden="true">{searchIcon()}</span>
                              {lastColetaSearchBusy ? "Buscando..." : "Buscar"}
                            </button>
                          </div>
                        </label>
                      </div>

                      {lastColetaSearchResult ? (
                        <div className="controle-validade-list-area">
                          <div className="controle-validade-section-title">Última coleta encontrada</div>
                          <article className="controle-validade-row-card controle-validade-linha-card">
                            <div className="controle-validade-linha-card-main">
                              <button
                                className="gestao-op-row-expand controle-validade-linha-expand"
                                type="button"
                                onClick={() =>
                                  setExpandedLinhaColetaHistoryKey((current) =>
                                    current === "last-search-result" ? null : "last-search-result"
                                  )
                                }
                                aria-expanded={expandedLinhaColetaHistoryKey === "last-search-result"}
                              >
                                <span className="gestao-op-row-expand-icon" aria-hidden="true">
                                  <EyeIcon open={expandedLinhaColetaHistoryKey === "last-search-result"} />
                                </span>
                                <span className="controle-validade-linha-summary">
                                  <strong>{lastColetaSearchResult.endereco_sep}</strong>
                                  <span>{`${lastColetaSearchResult.coddv} - ${lastColetaSearchResult.descricao}`}</span>
                                </span>
                              </button>
                              <span className="controle-validade-history-zone-badge">{lastColetaSearchResult.zona}</span>
                            </div>

                            {expandedLinhaColetaHistoryKey === "last-search-result" ? (
                              <div className="controle-validade-linha-details">
                                <div className="controle-validade-linha-detail-grid">
                                  <span className="controle-validade-editable-line">
                                    <b>Validade:</b> {lastColetaSearchResult.val_mmaa}
                                    {canEditColetaRow(lastColetaSearchResult) ? (
                                      <button
                                        type="button"
                                        className="controle-validade-edit-trigger"
                                        onClick={() => startEditingColeta(lastColetaSearchResult)}
                                        aria-label="Editar validade da coleta"
                                        title="Editar validade da coleta"
                                        disabled={busyEdit}
                                      >
                                        {pencilIcon()}
                                      </button>
                                    ) : null}
                                  </span>
                                  <span><b>Coleta:</b> {formatDateTime(lastColetaSearchResult.data_coleta)}</span>
                                  <span><b>Usuário coleta:</b> {formatLinhaHistoryCollector(lastColetaSearchResult)}</span>
                                  <span><b>Barras:</b> {lastColetaSearchResult.barras || "-"}</span>
                                </div>
                                {editingColetaId === lastColetaSearchResult.id ? (
                                  <div className="controle-validade-inline-editor">
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      maxLength={4}
                                      value={editingColetaValidade}
                                      onChange={(event) => setEditingColetaValidade(event.target.value.replace(/\D/g, "").slice(0, 4))}
                                      placeholder="MMAA"
                                    />
                                    <button type="button" className="btn btn-primary" onClick={() => void saveEditingColeta(lastColetaSearchResult)} disabled={busyEdit}>
                                      Salvar
                                    </button>
                                    <button type="button" className="btn btn-muted" onClick={cancelEditingColeta} disabled={busyEdit}>
                                      Cancelar
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </article>
                        </div>
                      ) : null}

                      <div className="controle-validade-list-area">
                        <div className="controle-validade-section-title">Últimos 1.000 endereços coletados</div>
                        {!busyLoadRows && linhaColetaHistoryGrouped.length === 0 ? (
                          <p>Nenhuma coleta registrada para este CD.</p>
                        ) : null}
                        <div className="controle-validade-list">
                          {linhaColetaHistoryGrouped.map((row, index) => {
                            const key = `${row.endereco_sep}|${row.coddv}|${row.val_mmaa}|${row.data_coleta ?? "sem-data"}|${index}`;
                            const previousRow = index > 0 ? linhaColetaHistoryGrouped[index - 1] : null;
                            const showZoneHeader = !previousRow || previousRow.zona !== row.zona;
                            const isExpanded = expandedLinhaColetaHistoryKey === key;
                            return (
                              <div key={key} className="pvps-zone-group">
                                {showZoneHeader ? <div className="pvps-zone-divider">Zona {row.zona}</div> : null}
                                <article className="controle-validade-row-card controle-validade-linha-card">
                                  <div className="controle-validade-linha-card-main">
                                    <button
                                      className="gestao-op-row-expand controle-validade-linha-expand"
                                      type="button"
                                      onClick={() => setExpandedLinhaColetaHistoryKey((current) => (current === key ? null : key))}
                                      aria-expanded={isExpanded}
                                    >
                                      <span className="gestao-op-row-expand-icon" aria-hidden="true">
                                        <EyeIcon open={isExpanded} />
                                      </span>
                                      <span className="controle-validade-linha-summary">
                                        <strong>{row.endereco_sep}</strong>
                                        <span>{`${row.coddv} - ${row.descricao}`}</span>
                                      </span>
                                    </button>
                                  </div>

                                  {isExpanded ? (
                                    <div className="controle-validade-linha-details">
                                      <div className="controle-validade-linha-detail-grid">
                                        <span className="controle-validade-editable-line">
                                          <b>Validade:</b> {row.val_mmaa}
                                          {canEditColetaRow(row) ? (
                                            <button
                                              type="button"
                                              className="controle-validade-edit-trigger"
                                              onClick={() => startEditingColeta(row)}
                                              aria-label="Editar validade da coleta"
                                              title="Editar validade da coleta"
                                              disabled={busyEdit}
                                            >
                                              {pencilIcon()}
                                            </button>
                                          ) : null}
                                        </span>
                                        <span><b>Coleta:</b> {formatDateTime(row.data_coleta)}</span>
                                        <span><b>Usuário coleta:</b> {formatLinhaHistoryCollector(row)}</span>
                                        <span><b>Barras:</b> {row.barras || "-"}</span>
                                      </div>
                                      {editingColetaId === row.id ? (
                                        <div className="controle-validade-inline-editor">
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            maxLength={4}
                                            value={editingColetaValidade}
                                            onChange={(event) => setEditingColetaValidade(event.target.value.replace(/\D/g, "").slice(0, 4))}
                                            placeholder="MMAA"
                                          />
                                          <button type="button" className="btn btn-primary" onClick={() => void saveEditingColeta(row)} disabled={busyEdit}>
                                            Salvar
                                          </button>
                                          <button type="button" className="btn btn-muted" onClick={cancelEditingColeta} disabled={busyEdit}>
                                            Cancelar
                                          </button>
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </article>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </section>
                  </>
                ) : (
                  <div className="controle-validade-list-area">
                    {busyLoadRows ? <p>Carregando retiradas da Linha...</p> : null}
                    {!busyLoadRows && linhaRowsFiltered.length === 0 ? (
                      <p>Nenhum item na Linha para o filtro atual.</p>
                    ) : null}
                    <div className="controle-validade-list">
                      {linhaRowsFiltered.map((row, index) => {
                        const key = `${row.coddv}|${row.endereco_sep}|${row.val_mmaa}|${row.ref_coleta_mes}`;
                        const previousRow = index > 0 ? linhaRowsFiltered[index - 1] : null;
                        const zone = linhaZone(row.endereco_sep);
                        const previousZone = previousRow ? linhaZone(previousRow.endereco_sep) : null;
                        const showZoneHeader = previousZone !== zone;
                        const isPending = row.status === "pendente";
                        const isExpanded = expandedLinhaCardKey === key;
                        const qtyValue = linhaQtyInputs[key] ?? "";
                        const parsedQty = Number.parseInt(qtyValue.replace(/\D/g, ""), 10);
                        const canSubmit = Number.isFinite(parsedQty) && parsedQty > 0;
                        return (
                          <div key={key} className="pvps-zone-group">
                            {showZoneHeader ? <div className="pvps-zone-divider">Zona {zone}</div> : null}
                            <article className="controle-validade-row-card controle-validade-linha-card">
                              <div className="controle-validade-linha-card-main">
                                <button
                                  className="gestao-op-row-expand controle-validade-linha-expand"
                                  type="button"
                                  onClick={() => setExpandedLinhaCardKey((current) => (current === key ? null : key))}
                                  aria-expanded={isExpanded}
                                >
                                  <span className="gestao-op-row-expand-icon" aria-hidden="true">
                                    <EyeIcon open={isExpanded} />
                                  </span>
                                  <span className="controle-validade-linha-summary">
                                    <strong>{row.endereco_sep}</strong>
                                    <span>{`${row.coddv} - ${row.descricao}`}</span>
                                  </span>
                                </button>
                                <span className={`controle-validade-status ${row.status}`}>
                                  {row.status === "pendente" ? "Pendente" : "Concluído"}
                                </span>
                              </div>

                              {isExpanded ? (
                                  <div className="controle-validade-linha-details">
                                    <div className="controle-validade-linha-detail-grid">
                                      <span><b>Validade:</b> {row.val_mmaa}</span>
                                      <span><b>Coleta:</b> {formatDateTime(row.dt_ultima_coleta)}</span>
                                      <span><b>Usuário coleta:</b> {formatLinhaCollector(row)}</span>
                                      <span><b>Retirado:</b> {row.qtd_retirada}</span>
                                      <span><b>Pendente:</b> {row.qtd_pendente}</span>
                                      {row.editable_retirada_qtd != null ? (
                                        <span className="controle-validade-editable-line">
                                          <b>Sua retirada:</b> {row.editable_retirada_qtd}
                                          {isOnline ? (
                                            <button
                                              type="button"
                                              className="controle-validade-edit-trigger"
                                              onClick={() => startEditingLinhaRetirada(row)}
                                              aria-label="Editar quantidade da sua retirada"
                                              title="Editar quantidade da sua retirada"
                                              disabled={busyEdit}
                                            >
                                              {pencilIcon()}
                                            </button>
                                          ) : null}
                                        </span>
                                      ) : null}
                                    </div>
                                    {editingLinhaRetiradaId === row.editable_retirada_id && row.editable_retirada_id ? (
                                      <div className="controle-validade-inline-editor">
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          value={editingLinhaRetiradaQty}
                                          onChange={(event) => setEditingLinhaRetiradaQty(event.target.value.replace(/\D/g, "").slice(0, 4))}
                                          placeholder="Qtd"
                                        />
                                        <button type="button" className="btn btn-primary" onClick={() => void saveEditingLinhaRetirada(row)} disabled={busyEdit}>
                                          Salvar
                                        </button>
                                        <button type="button" className="btn btn-muted" onClick={cancelEditingLinhaRetirada} disabled={busyEdit}>
                                          Cancelar
                                        </button>
                                      </div>
                                    ) : null}

                                  {isPending ? (
                                    <div className="controle-validade-row-actions controle-validade-linha-actions">
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        placeholder="Qtd"
                                        value={qtyValue}
                                        onChange={(event) =>
                                          setLinhaQtyInputs((current) => ({
                                            ...current,
                                            [key]: event.target.value.replace(/\D/g, "").slice(0, 4)
                                          }))
                                        }
                                      />
                                      <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={() => void submitLinhaRetirada(row)}
                                        disabled={!canSubmit}
                                      >
                                        Registrar retirada
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </article>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="controle-validade-pane">
                <div className="controle-validade-status-tabs">
                  <button
                    type="button"
                    className={`controle-validade-status-tab is-todos${pulStatusFilter === "todos" ? " is-active" : ""}`}
                    onClick={() => {
                      setPulStatusFilter("todos");
                      setMonthFilter(ALL_MONTHS_FILTER);
                    }}
                    aria-pressed={pulStatusFilter === "todos"}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    className={`controle-validade-status-tab is-pendente${pulStatusFilter === "pendente" ? " is-active" : ""}`}
                    onClick={() => {
                      setPulStatusFilter("pendente");
                      setMonthFilter(ALL_MONTHS_FILTER);
                    }}
                    aria-pressed={pulStatusFilter === "pendente"}
                  >
                    Pendentes
                  </button>
                  <button
                    type="button"
                    className={`controle-validade-status-tab is-concluido${pulStatusFilter === "concluido" ? " is-active" : ""}`}
                    onClick={() => {
                      setPulStatusFilter("concluido");
                      setMonthFilter(defaultMonthFilter);
                    }}
                    aria-pressed={pulStatusFilter === "concluido"}
                  >
                    Concluídos
                  </button>
                </div>

                {busyLoadRows ? <p>Carregando retiradas do Pulmão...</p> : null}
                {!busyLoadRows && pulRowsFiltered.length === 0 ? (
                  <p>Nenhum item de Pulmão para o filtro atual.</p>
                ) : null}
                <div className="controle-validade-list">
                  {pulRowsFiltered.map((row, index) => {
                    const key = `${row.coddv}|${row.endereco_pul}|${row.val_mmaa}`;
                    const prev = index > 0 ? pulRowsFiltered[index - 1] : null;
                    const showZoneHeader = !prev || prev.zona !== row.zona;
                    const isPending = row.status === "pendente";
                    const isExpanded = expandedPulCardKey === key;
                    const qtyValue = pulQtyInputs[key] ?? "";
                    const parsedQty = Number.parseInt(qtyValue.replace(/\D/g, ""), 10);
                    const canSubmit = Number.isFinite(parsedQty) && parsedQty > 0;
                    return (
                      <div key={key} className="pvps-zone-group">
                        {showZoneHeader ? <div className="pvps-zone-divider">Zona {row.zona}</div> : null}
                        <article className="controle-validade-row-card controle-validade-linha-card">
                          <div className="controle-validade-linha-card-main">
                            <button
                              className="gestao-op-row-expand controle-validade-linha-expand"
                              type="button"
                              onClick={() => setExpandedPulCardKey((current) => (current === key ? null : key))}
                              aria-expanded={isExpanded}
                            >
                              <span className="gestao-op-row-expand-icon" aria-hidden="true">
                                <EyeIcon open={isExpanded} />
                              </span>
                              <span className="controle-validade-linha-summary">
                                <strong>{row.endereco_pul}</strong>
                                <span>{`${row.coddv} - ${row.descricao}`}</span>
                              </span>
                            </button>
                            <span className={`controle-validade-status ${row.status}`}>
                              {row.status === "pendente" ? "Pendente" : "Concluído"}
                            </span>
                          </div>

                          {isExpanded ? (
                            <div className="controle-validade-linha-details">
                              <div className="controle-validade-linha-detail-grid">
                                <span><b>Validade:</b> {row.val_mmaa}</span>
                                <span><b>Andar:</b> {row.andar ?? "-"}</span>
                                <span><b>Estoque disponível:</b> {row.qtd_est_disp}</span>
                                <span><b>Retirado:</b> {row.qtd_retirada}</span>
                                <span><b>Pendente:</b> {row.qtd_pendente}</span>
                                {row.editable_retirada_qtd != null ? (
                                  <span className="controle-validade-editable-line">
                                    <b>Sua retirada:</b> {row.editable_retirada_qtd}
                                    {isOnline ? (
                                      <button
                                        type="button"
                                        className="controle-validade-edit-trigger"
                                        onClick={() => startEditingPulRetirada(row)}
                                        aria-label="Editar quantidade da sua retirada"
                                        title="Editar quantidade da sua retirada"
                                        disabled={busyEdit}
                                      >
                                        {pencilIcon()}
                                      </button>
                                    ) : null}
                                  </span>
                                ) : null}
                                {!isPending ? (
                                  <span><b>Data/hora retirada:</b> {formatDateTime(row.dt_ultima_retirada)}</span>
                                ) : null}
                                {!isPending ? (
                                  <span><b>Usuário retirada:</b> {row.auditor_nome_ultima_retirada ?? "Aguardando sincronizacao"}</span>
                                ) : null}
                              </div>
                              {editingPulRetiradaId === row.editable_retirada_id && row.editable_retirada_id ? (
                                <div className="controle-validade-inline-editor">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={editingPulRetiradaQty}
                                    onChange={(event) => setEditingPulRetiradaQty(event.target.value.replace(/\D/g, "").slice(0, 4))}
                                    placeholder="Qtd"
                                  />
                                  <button type="button" className="btn btn-primary" onClick={() => void saveEditingPulRetirada(row)} disabled={busyEdit}>
                                    Salvar
                                  </button>
                                  <button type="button" className="btn btn-muted" onClick={cancelEditingPulRetirada} disabled={busyEdit}>
                                    Cancelar
                                  </button>
                                </div>
                              ) : null}

                              {isPending ? (
                                <div className="controle-validade-row-actions controle-validade-linha-actions">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="Qtd"
                                    value={qtyValue}
                                    onChange={(event) =>
                                      setPulQtyInputs((current) => ({
                                        ...current,
                                        [key]: event.target.value.replace(/\D/g, "").slice(0, 4)
                                      }))
                                    }
                                  />
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => void submitPulRetirada(row)}
                                    disabled={!canSubmit}
                                  >
                                    Registrar retirada
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </article>
      </section>

      {scannerOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="controle-validade-scanner-title" onClick={closeCameraScanner}>
              <div className="scanner-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <div className="scanner-head">
                  <h3 id="controle-validade-scanner-title">Scanner de barras</h3>
                  <div className="scanner-head-actions">
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
                    <button className="scanner-close-btn" type="button" onClick={closeCameraScanner} aria-label="Fechar scanner">
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
    </>
  );
}
