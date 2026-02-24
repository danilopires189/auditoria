import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { IScannerControls } from "@zxing/browser";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { getDbBarrasMeta } from "../../shared/db-barras/storage";
import { refreshDbBarrasCacheSmart } from "../../shared/db-barras/sync";
import { getDbEndMeta } from "../../shared/db-end/storage";
import { enderecoMatchesForCompare, refreshDbEndCacheSmart } from "../../shared/db-end/sync";
import { useOnDemandSoftKeyboard } from "../../shared/use-on-demand-soft-keyboard";
import { useScanFeedback } from "../../shared/use-scan-feedback";
import { getModuleByKeyOrThrow } from "../registry";
import { getValidarEnderecamentoPreferences, saveValidarEnderecamentoPreferences } from "./storage";
import {
  enqueueValidarEnderecamentoAudit,
  flushPendingValidarEnderecamentoAudits,
  normalizeLookupError,
  resolveProdutoForValidacao
} from "./sync";
import type {
  ValidarEnderecamentoLookupResult,
  ValidarEnderecamentoModuleProfile
} from "./types";

interface ValidarEnderecamentoPageProps {
  isOnline: boolean;
  profile: ValidarEnderecamentoModuleProfile;
}

type BarcodeValidationState = "idle" | "validating" | "valid" | "invalid";
type AddressValidationState = "idle" | "validating" | "valid" | "invalid";
type ScannerInputTarget = "produto" | "endereco";
type PopupTone = "success" | "error";

interface ValidationPopupState {
  id: number;
  tone: PopupTone;
  title: string;
  detail: string | null;
  sepList: string[];
  manualClose: boolean;
}

interface ScannerInputState {
  lastInputAt: number;
  lastLength: number;
  burstChars: number;
  timerId: number | null;
  lastSubmittedValue: string;
  lastSubmittedAt: number;
}

const MODULE_DEF = getModuleByKeyOrThrow("validar-enderecamento");
const SCANNER_INPUT_MAX_INTERVAL_MS = 45;
const SCANNER_INPUT_MIN_BURST_CHARS = 5;
const SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS = 90;
const SCANNER_INPUT_SUBMIT_COOLDOWN_MS = 600;
const POPUP_SUCCESS_MS = 2600;
const SUCCESS_CHIME_DURATION_MS = 420;
const AUDIT_FLUSH_INTERVAL_MS = 15000;
const STATUS_MESSAGE_AUTO_HIDE_MS = 2800;

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

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: ValidarEnderecamentoModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) {
    return Math.trunc(profile.cd_default);
  }
  return parseCdFromLabel(profile.cd_nome);
}

function normalizeEnderecoDisplay(value: string): string {
  return String(value ?? "").trim().toUpperCase();
}

function playSuccessChime(): void {
  if (typeof window === "undefined") return;
  const audioCtor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!audioCtor) return;

  try {
    const ctx = new audioCtor();
    const start = ctx.currentTime + 0.01;
    const end = start + 0.35;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(0.5, start + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, end);
    master.connect(ctx.destination);

    const toneA = ctx.createOscillator();
    toneA.type = "sine";
    toneA.frequency.setValueAtTime(760, start);
    toneA.connect(master);
    toneA.start(start);
    toneA.stop(start + 0.14);

    const toneB = ctx.createOscillator();
    toneB.type = "triangle";
    toneB.frequency.setValueAtTime(980, start + 0.11);
    toneB.connect(master);
    toneB.start(start + 0.11);
    toneB.stop(end);

    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, SUCCESS_CHIME_DURATION_MS);
  } catch {
    // Browser pode bloquear audio programatico.
  }
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

function addressIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.4" />
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

function refreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 5v5h-5" />
      <path d="M4 19v-5h5" />
      <path d="M6.5 9A7 7 0 0 1 19 10" />
      <path d="M17.5 15A7 7 0 0 1 5 14" />
    </svg>
  );
}

function asLookupSummary(result: ValidarEnderecamentoLookupResult): string {
  return `${result.descricao || `CODDV ${result.coddv}`} | CODDV ${result.coddv}`;
}

function pickMainBarcode(result: ValidarEnderecamentoLookupResult): string {
  const direct = String(result.barras ?? "").replace(/\s+/g, "").trim();
  if (direct) return direct;

  for (const value of result.barras_lista) {
    const normalized = String(value ?? "").replace(/\s+/g, "").trim();
    if (normalized) return normalized;
  }
  return "";
}

export default function ValidarEnderecamentoPage({ isOnline, profile }: ValidarEnderecamentoPageProps) {
  const produtoRef = useRef<HTMLInputElement | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerTrackRef = useRef<MediaStreamTrack | null>(null);
  const scannerTorchModeRef = useRef<"none" | "controls" | "track">("none");
  const scannerInputStateRef = useRef<Record<ScannerInputTarget, ScannerInputState>>({
    produto: createScannerInputState(),
    endereco: createScannerInputState()
  });
  const popupTimerRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const resolveScanFeedbackAnchor = useCallback(() => produtoRef.current, []);
  const { triggerScanErrorAlert } = useScanFeedback(resolveScanFeedbackAnchor);
  const {
    inputMode: produtoInputMode,
    enableSoftKeyboard: enableProdutoSoftKeyboard,
    disableSoftKeyboard: disableProdutoSoftKeyboard
  } = useOnDemandSoftKeyboard("numeric");
  const {
    inputMode: enderecoInputMode,
    enableSoftKeyboard: enableEnderecoSoftKeyboard,
    disableSoftKeyboard: disableEnderecoSoftKeyboard
  } = useOnDemandSoftKeyboard("text");

  const [produtoInput, setProdutoInput] = useState("");
  const [enderecoInput, setEnderecoInput] = useState("");
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [dbBarrasCount, setDbBarrasCount] = useState(0);
  const [dbEndCount, setDbEndCount] = useState(0);
  const [offlineMetaReady, setOfflineMetaReady] = useState(false);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  const [produtoValidationState, setProdutoValidationState] = useState<BarcodeValidationState>("idle");
  const [enderecoValidationState, setEnderecoValidationState] = useState<AddressValidationState>("idle");
  const [currentProduct, setCurrentProduct] = useState<ValidarEnderecamentoLookupResult | null>(null);
  const [validationPopup, setValidationPopup] = useState<ValidationPopupState | null>(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<ScannerInputTarget>("produto");
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 980px)").matches;
  });

  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const currentCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const cameraSupported = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }, []);
  const activeInputTarget: ScannerInputTarget = currentProduct ? "endereco" : "produto";
  const activeInputValue = activeInputTarget === "produto" ? produtoInput : enderecoInput;
  const activeValidationState = activeInputTarget === "produto" ? produtoValidationState : enderecoValidationState;
  const activeInputMode = activeInputTarget === "produto" ? produtoInputMode : enderecoInputMode;
  const activeFieldLabel = activeInputTarget === "produto" ? "Produto (código de barras)" : "Endereço";
  const activeFieldPlaceholder = activeInputTarget === "produto"
    ? "Leia produto pelo coletor ou câmera"
    : "Leia endereço pelo coletor ou câmera";
  const activeEnterKeyHint: "next" | "done" = activeInputTarget === "produto" ? "next" : "done";
  const activeIconClassName = `field-icon validation-status${activeValidationState === "validating" ? " is-validating" : ""}${activeValidationState === "valid" ? " is-valid" : ""}${activeValidationState === "invalid" ? " is-invalid" : ""}`;

  const clearPopupTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    if (popupTimerRef.current != null) {
      window.clearTimeout(popupTimerRef.current);
      popupTimerRef.current = null;
    }
  }, []);

  const clearStatusTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    if (statusTimerRef.current != null) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, []);

  const focusProduto = useCallback(() => {
    disableProdutoSoftKeyboard();
    window.requestAnimationFrame(() => {
      produtoRef.current?.focus();
    });
  }, [disableProdutoSoftKeyboard]);

  const refreshOfflineMeta = useCallback(async () => {
    if (currentCd == null || currentCd <= 0) {
      setDbBarrasCount(0);
      setDbEndCount(0);
      setOfflineMetaReady(true);
      return;
    }

    try {
      const [barrasMeta, endMeta] = await Promise.all([
        getDbBarrasMeta(),
        getDbEndMeta(currentCd)
      ]);
      setDbBarrasCount(barrasMeta.row_count);
      setDbEndCount(endMeta.row_count);
    } catch {
      setErrorMessage((current) => current ?? "Falha ao ler base local. Tente atualizar a página.");
    } finally {
      setOfflineMetaReady(true);
    }
  }, [currentCd]);

  const clearValidationCycle = useCallback(() => {
    setCurrentProduct(null);
    setProdutoInput("");
    setEnderecoInput("");
    setProdutoValidationState("idle");
    setEnderecoValidationState("idle");
    focusProduto();
  }, [focusProduto]);

  const showValidationPopup = useCallback((params: {
    tone: PopupTone;
    title: string;
    detail: string | null;
    sepList: string[];
    durationMs?: number;
    manualClose?: boolean;
  }) => {
    const popupId = Math.trunc(Date.now() + Math.random() * 1000);
    clearPopupTimer();
    setValidationPopup({
      id: popupId,
      tone: params.tone,
      title: params.title,
      detail: params.detail,
      sepList: params.sepList,
      manualClose: Boolean(params.manualClose)
    });
    if (params.manualClose) return;
    if (typeof window === "undefined") return;
    const durationMs = params.durationMs ?? POPUP_SUCCESS_MS;
    popupTimerRef.current = window.setTimeout(() => {
      setValidationPopup((current) => (current?.id === popupId ? null : current));
      popupTimerRef.current = null;
      clearValidationCycle();
    }, durationMs);
  }, [clearPopupTimer, clearValidationCycle]);

  const closeValidationPopup = useCallback(() => {
    clearPopupTimer();
    setValidationPopup(null);
    clearValidationCycle();
  }, [clearPopupTimer, clearValidationCycle]);

  const queueValidationAudit = useCallback((params: {
    product: ValidarEnderecamentoLookupResult;
    enderecoInformado: string;
    endCorreto: string;
    validado: boolean;
  }) => {
    const barras = pickMainBarcode(params.product);
    if (!barras) return;

    void enqueueValidarEnderecamentoAudit({
      userId: profile.user_id,
      isOnline,
      payload: {
        cd: params.product.cd > 0 ? params.product.cd : (currentCd ?? 0),
        barras,
        coddv: params.product.coddv,
        descricao: params.product.descricao,
        end_infor: params.enderecoInformado,
        end_corret: params.endCorreto,
        validado: params.validado,
        data_hr: new Date().toISOString()
      }
    }).catch(() => undefined);
  }, [currentCd, isOnline, profile.user_id]);

  const runOfflineSync = useCallback(async () => {
    if (!isOnline) {
      setErrorMessage("Sem internet para sincronizar a base offline.");
      return;
    }
    if (currentCd == null || currentCd <= 0) {
      setErrorMessage("CD não definido para este usuário.");
      return;
    }

    setBusySync(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setProgressMessage("Iniciando sincronização de bases offline...");

    let barrasError: string | null = null;
    let endError: string | null = null;

    try {
      try {
        await refreshDbBarrasCacheSmart((progress) => {
          setProgressMessage(`db_barras: ${progress.rowsFetched} itens (${progress.percent}%)`);
        }, { allowFullReconcile: true });
      } catch (error) {
        barrasError = normalizeLookupError(error);
      }

      try {
        await refreshDbEndCacheSmart(currentCd, (progress) => {
          setProgressMessage(`db_end: ${progress.rowsFetched} itens (${progress.percent}%)`);
        }, { allowFullReconcile: true });
      } catch (error) {
        endError = normalizeLookupError(error);
      }

      await refreshOfflineMeta();
      setProgressMessage(null);

      if (!barrasError && !endError) {
        setStatusMessage("Bases offline atualizadas com sucesso.");
        return;
      }

      if (!barrasError && endError) {
        setStatusMessage("db_barras sincronizada.");
        setErrorMessage(`Falha ao sincronizar db_end: ${endError}`);
        return;
      }

      if (barrasError && !endError) {
        setStatusMessage("db_end sincronizada.");
        setErrorMessage(`Falha ao sincronizar db_barras: ${barrasError}`);
        return;
      }

      setErrorMessage(`Falha ao sincronizar bases. db_barras: ${barrasError} | db_end: ${endError}`);
    } finally {
      setBusySync(false);
    }
  }, [currentCd, isOnline, refreshOfflineMeta]);

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

  const closeCameraScanner = useCallback(() => {
    stopCameraScanner();
    setScannerOpen(false);
    setScannerError(null);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTrackRef.current = null;
    scannerTorchModeRef.current = "none";
  }, [stopCameraScanner]);

  const openCameraScanner = useCallback((target: ScannerInputTarget) => {
    if (!cameraSupported) {
      setErrorMessage("Câmera não disponível neste navegador/dispositivo.");
      return;
    }
    setScannerTarget(target);
    setScannerError(null);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTrackRef.current = null;
    scannerTorchModeRef.current = "none";
    setScannerOpen(true);
  }, [cameraSupported]);

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

  const commitProdutoInput = useCallback(async (rawValue: string) => {
    const value = String(rawValue ?? "").trim();
    if (!value) return;
    if (currentCd == null || currentCd <= 0) {
      setErrorMessage("CD não definido para este usuário.");
      setProdutoValidationState("invalid");
      focusProduto();
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    setProdutoValidationState("validating");
    setEnderecoValidationState("idle");

    try {
      const resolved = await resolveProdutoForValidacao({
        cd: currentCd,
        rawInput: value,
        isOnline,
        preferOfflineMode
      });

      setCurrentProduct(resolved);
      setProdutoValidationState("valid");
      setProdutoInput("");
      setEnderecoInput("");
      setStatusMessage(null);
      focusProduto();
    } catch (error) {
      setCurrentProduct(null);
      setProdutoValidationState("invalid");
      setErrorMessage(normalizeLookupError(error));
      focusProduto();
    }
  }, [currentCd, focusProduto, isOnline, preferOfflineMode]);

  const commitEnderecoInput = useCallback(async (rawValue: string) => {
    const endereco = normalizeEnderecoDisplay(rawValue);
    if (!endereco) return;
    if (!currentProduct) {
      setEnderecoValidationState("invalid");
      setErrorMessage("Informe um produto antes de validar o endereço.");
      triggerScanErrorAlert("Produto não informado.");
      focusProduto();
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    setEnderecoValidationState("validating");

    const sepList = currentProduct.enderecos_sep;
    const matchedSep = sepList.find((item) => enderecoMatchesForCompare(endereco, item, { cd: currentProduct.cd }));

    if (matchedSep) {
      setEnderecoValidationState("valid");
      queueValidationAudit({
        product: currentProduct,
        enderecoInformado: endereco,
        endCorreto: matchedSep,
        validado: true
      });
      playSuccessChime();
      showValidationPopup({
        tone: "success",
        title: "Endereçamento confirmado",
        detail: `${asLookupSummary(currentProduct)} | Endereço ${endereco}`,
        sepList: [],
        durationMs: POPUP_SUCCESS_MS
      });
      return;
    }

    setEnderecoValidationState("invalid");
    queueValidationAudit({
      product: currentProduct,
      enderecoInformado: endereco,
      endCorreto: sepList.length > 0 ? sepList.join(" | ") : "SEM ENDERECO SEP",
      validado: false
    });
    triggerScanErrorAlert("Endereço inválido.");
    showValidationPopup({
      tone: "error",
      title: "Endereço não pertence ao produto",
      detail: `${asLookupSummary(currentProduct)} | Informado: ${endereco}`,
      sepList,
      manualClose: true
    });
  }, [currentProduct, focusProduto, queueValidationAudit, showValidationPopup, triggerScanErrorAlert]);

  const clearScannerInputTimer = useCallback((target: ScannerInputTarget) => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current[target];
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const commitScannerInput = useCallback(async (target: ScannerInputTarget, rawValue: string) => {
    const normalized = target === "produto"
      ? String(rawValue ?? "").replace(/\s+/g, "").trim()
      : normalizeEnderecoDisplay(rawValue);
    if (!normalized) return;

    const state = scannerInputStateRef.current[target];
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (
      state.lastSubmittedValue === normalized
      && now - state.lastSubmittedAt < SCANNER_INPUT_SUBMIT_COOLDOWN_MS
    ) {
      return;
    }

    clearScannerInputTimer(target);
    state.lastSubmittedValue = normalized;
    state.lastSubmittedAt = now;
    state.lastInputAt = 0;
    state.lastLength = 0;
    state.burstChars = 0;

    if (target === "produto") {
      setProdutoInput(normalized);
      await commitProdutoInput(normalized);
      return;
    }

    setEnderecoInput(normalized);
    await commitEnderecoInput(normalized);
  }, [clearScannerInputTimer, commitEnderecoInput, commitProdutoInput]);

  const scheduleScannerInputAutoSubmit = useCallback((target: ScannerInputTarget, value: string) => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current[target];
    clearScannerInputTimer(target);
    state.timerId = window.setTimeout(() => {
      state.timerId = null;
      void commitScannerInput(target, value);
    }, SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS);
  }, [clearScannerInputTimer, commitScannerInput]);

  const handleScannerInputChange = useCallback((target: ScannerInputTarget, value: string) => {
    const state = scannerInputStateRef.current[target];
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsed = state.lastInputAt > 0 ? now - state.lastInputAt : Number.POSITIVE_INFINITY;
    const lengthDelta = Math.max(value.length - state.lastLength, 0);

    if (lengthDelta > 0 && elapsed <= SCANNER_INPUT_MAX_INTERVAL_MS) {
      state.burstChars += lengthDelta;
    } else {
      state.burstChars = lengthDelta;
    }
    state.lastInputAt = now;
    state.lastLength = value.length;

    if (!value) {
      state.burstChars = 0;
      clearScannerInputTimer(target);
      return;
    }

    if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) {
      scheduleScannerInputAutoSubmit(target, value);
      return;
    }

    clearScannerInputTimer(target);
  }, [clearScannerInputTimer, scheduleScannerInputAutoSubmit]);

  const shouldHandleScannerTab = useCallback((target: ScannerInputTarget, value: string): boolean => {
    if (!value.trim()) return false;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const state = scannerInputStateRef.current[target];
    if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) return true;
    if (state.lastInputAt <= 0) return false;
    return now - state.lastInputAt <= SCANNER_INPUT_MAX_INTERVAL_MS * 2;
  }, []);

  const onScanInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    if (activeInputTarget === "produto") {
      setProdutoInput(nextValue);
      setProdutoValidationState("idle");
    } else {
      setEnderecoInput(nextValue);
      setEnderecoValidationState("idle");
    }
    handleScannerInputChange(activeInputTarget, nextValue);
  };

  const onScanSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void commitScannerInput(activeInputTarget, activeInputValue);
  };

  const onScanKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !shouldHandleScannerTab(activeInputTarget, activeInputValue)) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    void commitScannerInput(activeInputTarget, activeInputValue);
  };

  useEffect(() => {
    focusProduto();
  }, [focusProduto]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(min-width: 980px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadPreferences = async () => {
      const prefs = await getValidarEnderecamentoPreferences(profile.user_id);
      if (!mounted) return;
      setPreferOfflineMode(Boolean(prefs.prefer_offline_mode));
      setPreferencesReady(true);
    };
    void loadPreferences();
    return () => {
      mounted = false;
    };
  }, [profile.user_id]);

  useEffect(() => {
    if (!preferencesReady) return;
    void saveValidarEnderecamentoPreferences(profile.user_id, {
      prefer_offline_mode: preferOfflineMode
    });
  }, [preferencesReady, preferOfflineMode, profile.user_id]);

  useEffect(() => {
    setOfflineMetaReady(false);
    void refreshOfflineMeta();
  }, [refreshOfflineMeta]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!navigator.storage || typeof navigator.storage.persist !== "function") return;
    void navigator.storage.persist().catch(() => undefined);
  }, []);

  useEffect(() => {
    clearStatusTimer();
    if (!statusMessage) return;
    if (typeof window === "undefined") return;
    statusTimerRef.current = window.setTimeout(() => {
      setStatusMessage((current) => (current === statusMessage ? null : current));
      statusTimerRef.current = null;
    }, STATUS_MESSAGE_AUTO_HIDE_MS);
    return () => {
      clearStatusTimer();
    };
  }, [clearStatusTimer, statusMessage]);

  useEffect(() => {
    if (!isOnline) return;
    void flushPendingValidarEnderecamentoAudits(profile.user_id).catch(() => undefined);
  }, [isOnline, profile.user_id]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const silentFlush = () => {
      const browserOnline = typeof navigator === "undefined" ? true : navigator.onLine;
      if (!isOnline && !browserOnline) return;
      void flushPendingValidarEnderecamentoAudits(profile.user_id).catch(() => undefined);
    };

    const intervalId = window.setInterval(silentFlush, AUDIT_FLUSH_INTERVAL_MS);
    window.addEventListener("online", silentFlush);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("online", silentFlush);
    };
  }, [isOnline, profile.user_id]);

  useEffect(() => {
    return () => {
      clearPopupTimer();
      clearStatusTimer();
      if (typeof window === "undefined") return;
      const state = scannerInputStateRef.current;
      for (const target of ["produto", "endereco"] as const) {
        if (state[target].timerId != null) {
          window.clearTimeout(state[target].timerId);
          state[target].timerId = null;
        }
      }
    };
  }, [clearPopupTimer, clearStatusTimer]);

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
                const scannedRaw = String(first?.rawValue ?? "");
                if (scannedRaw.trim()) {
                  setScannerOpen(false);
                  stopCameraScanner();
                  setTorchEnabled(false);
                  setTorchSupported(false);
                  void commitScannerInput(scannerTarget, scannedRaw);
                  return;
                }
              } catch {
                // Mantem polling enquanto camera busca foco.
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
              const scanned = String(scanResult.getText() ?? "").trim();
              if (!scanned) return;

              setScannerOpen(false);
              stopCameraScanner();
              setTorchEnabled(false);
              setTorchSupported(false);
              void commitScannerInput(scannerTarget, scanned);
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
  }, [commitScannerInput, resolveScannerTrack, scannerOpen, scannerTarget, stopCameraScanner, supportsTrackTorch]);

  const onToggleOfflineMode = async () => {
    if (!offlineMetaReady) {
      setStatusMessage("Carregando base local, aguarde alguns segundos.");
      return;
    }

    const next = !preferOfflineMode;
    setPreferOfflineMode(next);
    setErrorMessage(null);
    setStatusMessage(null);
    const hasLocalBase = dbBarrasCount > 0 && dbEndCount > 0;

    if (next) {
      if (!isOnline) {
        if (hasLocalBase) {
          setStatusMessage("Modo offline ativado com base local existente.");
        } else {
          setErrorMessage("Sem base local completa. Conecte-se para sincronizar db_barras e db_end.");
        }
        return;
      }

      if (hasLocalBase) {
        setStatusMessage("Modo offline ativado com base local já sincronizada.");
        return;
      }

      setStatusMessage("Modo offline ativado. Sincronizando base local...");
      await runOfflineSync();
      return;
    }

    setStatusMessage("Modo offline desativado.");
  };
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

      <section className="modules-shell validar-end-shell">
        <div className="validar-end-head">
          <h2>Olá, {displayUserName}</h2>
        </div>

        {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
        {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
        {progressMessage ? <div className="alert success">{progressMessage}</div> : null}
        {!offlineMetaReady ? <div className="alert success">Carregando base local...</div> : null}

        {preferOfflineMode && dbBarrasCount <= 0 && dbEndCount <= 0 ? (
          isOnline ? (
            <div className="alert success">
              Base local ainda em carga. Durante isso, a consulta online continua ativa.
            </div>
          ) : (
            <div className="alert error">
              Modo offline sem base local completa. Conecte-se para sincronizar.
            </div>
          )
        ) : null}

        <div className="validar-end-actions-row">
          {!isDesktop ? (
            <button
              type="button"
              className={`btn btn-muted validar-end-offline-toggle${preferOfflineMode ? " is-active" : ""}`}
              onClick={() => void onToggleOfflineMode()}
              disabled={busySync || !offlineMetaReady}
            >
              {preferOfflineMode ? "📦 Offline ativo" : "📶 Trabalhar offline"}
            </button>
          ) : null}
          <button
            className="btn btn-primary validar-end-sync-btn"
            type="button"
            onClick={() => void runOfflineSync()}
            disabled={!isOnline || busySync || !offlineMetaReady}
          >
            <span aria-hidden="true">{refreshIcon()}</span>
            {busySync ? "Sincronizando..." : "Sincronizar base"}
          </button>
        </div>

        <form className="coleta-form validar-end-form" onSubmit={onScanSubmit}>
          <div className="coleta-form-grid validar-end-form-grid">
            <label>
              {activeFieldLabel}
              <div className="input-icon-wrap with-action">
                <span className={activeIconClassName} aria-hidden="true">
                  {activeInputTarget === "produto" ? barcodeIcon() : addressIcon()}
                </span>
                <input
                  ref={produtoRef}
                  type="text"
                  inputMode={activeInputMode}
                  value={activeInputValue}
                  onChange={onScanInputChange}
                  onKeyDown={onScanKeyDown}
                  onFocus={() => {
                    if (activeInputTarget === "produto") {
                      enableProdutoSoftKeyboard();
                    } else {
                      enableEnderecoSoftKeyboard();
                    }
                  }}
                  onPointerDown={() => {
                    if (activeInputTarget === "produto") {
                      enableProdutoSoftKeyboard();
                    } else {
                      enableEnderecoSoftKeyboard();
                    }
                  }}
                  onBlur={() => {
                    disableProdutoSoftKeyboard();
                    disableEnderecoSoftKeyboard();
                  }}
                  autoComplete="off"
                  autoCapitalize={activeInputTarget === "produto" ? "none" : "characters"}
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint={activeEnterKeyHint}
                  placeholder={activeFieldPlaceholder}
                  required
                />
                <button
                  type="button"
                  className="input-action-btn"
                  onClick={() => openCameraScanner(activeInputTarget)}
                  title={activeInputTarget === "produto" ? "Ler produto pela câmera" : "Ler endereço pela câmera"}
                  aria-label={activeInputTarget === "produto" ? "Ler produto pela câmera" : "Ler endereço pela câmera"}
                  disabled={!cameraSupported || busySync}
                >
                  {cameraIcon()}
                </button>
              </div>
            </label>
          </div>
        </form>

        {currentProduct ? (
          <article className="validar-end-product-card">
            <h3>Produto em validação</h3>
            <p><strong>Descrição:</strong> {currentProduct.descricao || "-"}</p>
            <p><strong>CODDV:</strong> {currentProduct.coddv}</p>
            <p><strong>Barras:</strong> {currentProduct.barras_lista.length > 0 ? currentProduct.barras_lista.join(" | ") : "-"}</p>
            <p><strong>SEPs disponíveis:</strong> {currentProduct.enderecos_sep.length}</p>
            <div className="validar-end-sep-list">
              {currentProduct.enderecos_sep.length > 0
                ? currentProduct.enderecos_sep.map((endereco) => <span key={endereco}>{endereco}</span>)
                : <span>Nenhum endereço SEP encontrado.</span>}
            </div>
          </article>
        ) : null}

        {validationPopup && typeof document !== "undefined"
          ? createPortal(
              <div className="validar-end-popup-overlay" role="dialog" aria-modal="true" aria-labelledby="validar-end-popup-title">
                <div className={`validar-end-popup validar-end-popup-${validationPopup.tone}`}>
                  <h3 id="validar-end-popup-title">{validationPopup.title}</h3>
                  {validationPopup.detail ? <p>{validationPopup.detail}</p> : null}
                  {validationPopup.tone === "error" ? (
                    <div className="validar-end-popup-sep-wrap">
                      <strong>Endereços SEP corretos:</strong>
                      {validationPopup.sepList.length > 0 ? (
                        <ul>
                          {validationPopup.sepList.map((end) => <li key={end}>{end}</li>)}
                        </ul>
                      ) : (
                        <p>Nenhum endereço SEP disponível para este produto.</p>
                      )}
                    </div>
                  ) : null}
                  {validationPopup.manualClose ? (
                    <button
                      type="button"
                      className="btn btn-danger validar-end-popup-close-btn"
                      onClick={closeValidationPopup}
                    >
                      Fechar
                    </button>
                  ) : null}
                </div>
              </div>,
              document.body
            )
          : null}

        {scannerOpen && typeof document !== "undefined"
          ? createPortal(
              <div className="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="validar-end-scanner-title" onClick={closeCameraScanner}>
                <div className="scanner-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                  <div className="scanner-head">
                    <h3 id="validar-end-scanner-title">
                      {scannerTarget === "produto" ? "Scanner do produto" : "Scanner do endereço"}
                    </h3>
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
                  <p className="scanner-hint">
                    {scannerTarget === "produto"
                      ? "Aponte para o código do produto."
                      : "Aponte para o código do endereço."}
                  </p>
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
