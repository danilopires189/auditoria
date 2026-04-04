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
import { BackIcon, ModuleIcon } from "../../ui/icons";
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
  fetchLinhaRetiradaList,
  fetchPulRetiradaList,
  flushControleValidadeOfflineQueue,
  getOfflineQueueStats,
  loadProjectedOfflineRows,
  normalizeControleValidadeError,
  resolveLinhaColetaProduto
} from "./sync";
import type {
  ControleValidadeModuleProfile,
  LinhaColetaLookupResult,
  LinhaRetiradaRow,
  PulRetiradaRow,
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

export default function ControleValidadePage({ isOnline, profile }: ControleValidadePageProps) {
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
  const [statusFilter, setStatusFilter] = useState<RetiradaStatusFilter>("pendente");

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

  const [linhaRows, setLinhaRows] = useState<LinhaRetiradaRow[]>([]);
  const [pulRows, setPulRows] = useState<PulRetiradaRow[]>([]);
  const [linhaQtyInputs, setLinhaQtyInputs] = useState<Record<string, string>>({});
  const [pulQtyInputs, setPulQtyInputs] = useState<Record<string, string>>({});

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
        setLinhaRows(projected.linha_rows);
        setPulRows(projected.pul_rows);
        return;
      }

      const [linhaOnline, pulOnline] = await Promise.all([
        fetchLinhaRetiradaList({ cd: activeCd, status: "todos" }),
        fetchPulRetiradaList({ cd: activeCd, status: "todos" })
      ]);
      setLinhaRows(linhaOnline);
      setPulRows(pulOnline);

      await saveOfflineSnapshot({
        user_id: profile.user_id,
        cd: activeCd,
        linha_rows: linhaOnline,
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

      setProgressMessage("Atualizando snapshot de retiradas...");
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
          endereco_sep: selectedEnderecoSep,
          val_mmaa: valMmaa,
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
    const parsed = Number.parseInt((linhaQtyInputs[key] || "1").replace(/\D/g, ""), 10);
    const qtd = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

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
          qtd_retirada: qtd,
          data_hr: new Date().toISOString()
        }
      });
      await refreshQueueStats();
      setStatusMessage(`Retirada da Linha registrada (${qtd}).`);
      if (isOnline) {
        await flushQueue(false);
      }
      await loadRows();
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
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
      await refreshQueueStats();
      setStatusMessage(`Retirada do Pulmão registrada (${qtd}).`);
      if (isOnline) {
        await flushQueue(false);
      }
      await loadRows();
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
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

  const linhaRowsFiltered = useMemo(() => {
    if (statusFilter === "todos") return linhaRows;
    return linhaRows.filter((row) => row.status === statusFilter);
  }, [linhaRows, statusFilter]);

  const pulRowsFiltered = useMemo(() => {
    if (statusFilter === "todos") return pulRows;
    return pulRows.filter((row) => row.status === statusFilter);
  }, [pulRows, statusFilter]);

  const hasBarcodeInput = barcodeInput.trim().length > 0;

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

            <label className="controle-validade-tabs" htmlFor="controle-validade-tipo">
              <span>Tipo de Validade</span>
              <select
                id="controle-validade-tipo"
                value={mainTab}
                onChange={(event) => setMainTab(event.target.value as MainTab)}
              >
                <option value="Separação">Separação</option>
                <option value="Pulmão">Pulmão</option>
              </select>
            </label>

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
                        className={`btn btn-muted${statusFilter === "pendente" ? " is-active" : ""}`}
                        onClick={() => setStatusFilter("pendente")}
                      >
                        Pendentes
                      </button>
                      <button
                        type="button"
                        className={`btn btn-muted${statusFilter === "concluido" ? " is-active" : ""}`}
                        onClick={() => setStatusFilter("concluido")}
                      >
                        Concluídos
                      </button>
                    </div>
                  ) : null}
                </div>

                {linhaSubTab === "coleta" ? (
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
                ) : (
                  <div className="controle-validade-list-area">
                    {busyLoadRows ? <p>Carregando retiradas da Linha...</p> : null}
                    {!busyLoadRows && linhaRowsFiltered.length === 0 ? (
                      <p>Nenhum item na Linha para o filtro atual.</p>
                    ) : null}
                    <div className="controle-validade-list">
                      {linhaRowsFiltered.map((row) => {
                        const key = `${row.coddv}|${row.endereco_sep}|${row.val_mmaa}|${row.ref_coleta_mes}`;
                        const isPending = row.status === "pendente";
                        return (
                          <article key={key} className="controle-validade-row-card">
                            <div className="controle-validade-row-head">
                              <strong>{row.descricao}</strong>
                              <span className={`controle-validade-status ${row.status}`}>
                                {row.status === "pendente" ? "Pendente" : "Concluído"}
                              </span>
                            </div>
                            <div className="controle-validade-row-grid">
                              <span>CODDV: {row.coddv}</span>
                              <span>Endereço: {row.endereco_sep}</span>
                              <span>Validade: {row.val_mmaa}</span>
                              <span>Regra: {row.regra_aplicada === "al_lt_3m" ? "AL < 3 meses" : "Até 5 meses"}</span>
                              <span>Coletado: {row.qtd_coletada}</span>
                              <span>Retirado: {row.qtd_retirada}</span>
                              <span>Pendente: {row.qtd_pendente}</span>
                              <span>Última coleta: {formatDateTime(row.dt_ultima_coleta)}</span>
                            </div>
                            {isPending ? (
                              <div className="controle-validade-row-actions">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={linhaQtyInputs[key] ?? "1"}
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
                                >
                                  Registrar retirada
                                </button>
                              </div>
                            ) : null}
                          </article>
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
                    className={`btn btn-muted${statusFilter === "pendente" ? " is-active" : ""}`}
                    onClick={() => setStatusFilter("pendente")}
                  >
                    Pendentes
                  </button>
                  <button
                    type="button"
                    className={`btn btn-muted${statusFilter === "concluido" ? " is-active" : ""}`}
                    onClick={() => setStatusFilter("concluido")}
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
                    const qtyValue = pulQtyInputs[key] ?? "";
                    const parsedQty = Number.parseInt(qtyValue.replace(/\D/g, ""), 10);
                    const canSubmit = Number.isFinite(parsedQty) && parsedQty > 0;
                    return (
                      <div key={key} className="pvps-zone-group">
                        {showZoneHeader ? <div className="pvps-zone-divider">Zona {row.zona}</div> : null}
                        <article className="controle-validade-row-card">
                          <div className="controle-validade-row-head">
                            <strong>{row.descricao}</strong>
                            <span className={`controle-validade-status ${row.status}`}>
                              {row.status === "pendente" ? "Pendente" : "Concluído"}
                            </span>
                          </div>
                          <div className="controle-validade-row-grid">
                            <span>CODDV: {row.coddv}</span>
                            <span>Endereço PUL: {row.endereco_pul}</span>
                            <span>Andar: {row.andar ?? "-"}</span>
                            <span>Validade: {row.val_mmaa}</span>
                            <span>Estoque disponível: {row.qtd_est_disp}</span>
                            <span>Alvo: {row.qtd_alvo}</span>
                            <span>Retirado: {row.qtd_retirada}</span>
                            <span>Pendente: {row.qtd_pendente}</span>
                            {!isPending ? <span>Usuário retirada: {row.auditor_nome_ultima_retirada ?? "Aguardando sincronização"}</span> : null}
                            {!isPending ? <span>Data/hora local: {formatDateTime(row.dt_ultima_retirada)}</span> : null}
                          </div>
                          {isPending ? (
                            <div className="controle-validade-row-actions">
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
