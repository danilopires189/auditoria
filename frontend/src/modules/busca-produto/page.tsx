import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { IScannerControls } from "@zxing/browser";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { normalizeBarcode } from "../../shared/db-barras/sync";
import { useOnDemandSoftKeyboard } from "../../shared/use-on-demand-soft-keyboard";
import { getModuleByKeyOrThrow } from "../registry";
import { lookupProduto } from "./sync";
import type { BuscaProdutoAddressRow, BuscaProdutoExcludedAddressRow, BuscaProdutoLookupResult, BuscaProdutoModuleProfile } from "./types";

interface BuscaProdutoPageProps {
  isOnline: boolean;
  profile: BuscaProdutoModuleProfile;
}

type BarcodeValidationState = "idle" | "validating" | "valid" | "invalid";

const MODULE_DEF = getModuleByKeyOrThrow("busca-produto");
const SCANNER_INPUT_MAX_INTERVAL_MS = 45;
const SCANNER_INPUT_MIN_BURST_CHARS = 5;
const SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS = 90;
const SCANNER_INPUT_SUBMIT_COOLDOWN_MS = 600;
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "short",
  year: "numeric"
});

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

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Erro inesperado.";
}

function formatShortDate(value: string | null): string {
  if (!value) return "-";
  const compact = value.trim();
  if (!compact) return "-";

  if (/^\d{4}-\d{2}-\d{2}$/.test(compact)) {
    const [year, month, day] = compact.split("-").map((part) => Number.parseInt(part, 10));
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      return SHORT_DATE_FORMATTER.format(date).replace(/\./g, "");
    }
  }

  const parsed = new Date(compact);
  if (Number.isNaN(parsed.getTime())) return "-";
  return SHORT_DATE_FORMATTER.format(parsed).replace(/\./g, "");
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

function renderAddressList(rows: BuscaProdutoAddressRow[], emptyLabel: string) {
  if (rows.length === 0) return <div className="coleta-empty">{emptyLabel}</div>;
  return (
    <ul className="busca-produto-address-list">
      {rows.map((row, index) => (
        <li key={`${row.endereco}-${index}`}>
          <span className="busca-produto-address-main">{row.endereco}</span>
          <span className="busca-produto-address-meta">
            Andar: {row.andar ?? "-"} | Validade: {row.validade ?? "-"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function renderExcludedAddressList(rows: BuscaProdutoExcludedAddressRow[]) {
  if (rows.length === 0) return <div className="coleta-empty">Nenhum endereço excluído.</div>;
  return (
    <ul className="busca-produto-address-list">
      {rows.map((row, index) => (
        <li key={`${row.endereco}-${row.exclusao ?? "null"}-${index}`}>
          <span className="busca-produto-address-main">{row.endereco}</span>
          <span className="busca-produto-address-meta">Exclusão: {formatShortDate(row.exclusao)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function BuscaProdutoPage({ isOnline, profile }: BuscaProdutoPageProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerTrackRef = useRef<MediaStreamTrack | null>(null);
  const scannerTorchModeRef = useRef<"none" | "controls" | "track">("none");
  const scannerInputStateRef = useRef<ScannerInputState>(createScannerInputState());
  const {
    inputMode: searchInputMode,
    enableSoftKeyboard: enableSearchSoftKeyboard,
    disableSoftKeyboard: disableSearchSoftKeyboard
  } = useOnDemandSoftKeyboard("numeric");

  const [searchInput, setSearchInput] = useState("");
  const [busySearch, setBusySearch] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [barcodeValidationState, setBarcodeValidationState] = useState<BarcodeValidationState>("idle");
  const [result, setResult] = useState<BuscaProdutoLookupResult | null>(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const cameraSupported = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }, []);
  const barcodeIconClassName = `field-icon validation-status${barcodeValidationState === "validating" ? " is-validating" : ""}${barcodeValidationState === "valid" ? " is-valid" : ""}${barcodeValidationState === "invalid" ? " is-invalid" : ""}`;

  const focusSearch = useCallback(() => {
    disableSearchSoftKeyboard();
    window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
  }, [disableSearchSoftKeyboard]);

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
    focusSearch();
  }, [focusSearch, stopCameraScanner]);

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
    const original = rawValue.trim();
    const barras = normalizeBarcode(original);
    if (!barras) {
      setErrorMessage("Informe código de barras ou Código e Dígito (CODDV).");
      setStatusMessage(null);
      setBarcodeValidationState("invalid");
      setResult(null);
      focusSearch();
      return;
    }

    setBusySearch(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setBarcodeValidationState("validating");

    try {
      let found: BuscaProdutoLookupResult | null = null;
      try {
        found = await lookupProduto({ barras });
      } catch (error) {
        const errMsg = asErrorMessage(error);
        if (!errMsg.toUpperCase().includes("PRODUTO NÃO ENCONTRADO") && !errMsg.toUpperCase().includes("PRODUTO_NAO_ENCONTRADO")) {
          throw error;
        }
      }

      if (!found && /^\d+$/.test(original)) {
        const parsedCoddv = Number.parseInt(original, 10);
        if (Number.isFinite(parsedCoddv) && parsedCoddv > 0) {
          found = await lookupProduto({ coddv: parsedCoddv });
        }
      }

      if (!found) {
        setResult(null);
        setErrorMessage("Produto não encontrado.");
        setBarcodeValidationState("invalid");
        focusSearch();
        return;
      }

      setSearchInput(found.barras || barras);
      setResult(found);
      setStatusMessage("Produto localizado com sucesso.");
      setBarcodeValidationState("valid");
      focusSearch();
    } catch (error) {
      setResult(null);
      setErrorMessage(asErrorMessage(error));
      setBarcodeValidationState("invalid");
      focusSearch();
    } finally {
      setBusySearch(false);
    }
  }, [focusSearch]);

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

    setSearchInput(normalized);
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

  const onSearchInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setSearchInput(nextValue);
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

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void commitScannerInput(searchInput);
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !shouldHandleScannerTab(searchInput)) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    void commitScannerInput(searchInput);
  };

  useEffect(() => {
    focusSearch();
  }, [focusSearch]);

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
                  setSearchInput(scanned);
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

              setSearchInput(scanned);
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

      <section className="modules-shell busca-produto-shell">
        <div className="busca-produto-head">
          <h2>Olá, {displayUserName}</h2>
          <p>Busque por código de barras ou Código e Dígito (CODDV).</p>
        </div>

        {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
        {statusMessage ? <div className="alert success">{statusMessage}</div> : null}

        <form className="coleta-form busca-produto-form" onSubmit={onSubmit}>
          <div className="coleta-form-grid busca-produto-form-grid">
            <label>
              Busca por produto
              <div className="input-icon-wrap with-action">
                <span className={barcodeIconClassName} aria-hidden="true">
                  {barcodeIcon()}
                </span>
                <input
                  ref={searchRef}
                  type="text"
                  inputMode={searchInputMode}
                  value={searchInput}
                  onChange={onSearchInputChange}
                  onKeyDown={onSearchKeyDown}
                  onFocus={enableSearchSoftKeyboard}
                  onPointerDown={enableSearchSoftKeyboard}
                  onBlur={disableSearchSoftKeyboard}
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
                  className="input-action-btn"
                  onClick={openCameraScanner}
                  title="Ler código pela câmera"
                  aria-label="Ler código pela câmera"
                  disabled={!cameraSupported || busySearch}
                >
                  {cameraIcon()}
                </button>
              </div>
            </label>
          </div>

          <button className="btn btn-primary busca-produto-search-btn" type="submit" disabled={busySearch}>
            <span aria-hidden="true">{searchIcon()}</span>
            {busySearch ? "Buscando..." : "Buscar produto"}
          </button>
        </form>

        {result ? (
          <div className="busca-produto-result-grid">
            <article className="busca-produto-card">
              <h3>Resumo do Produto</h3>
              <p><strong>Descrição:</strong> {result.descricao || "-"}</p>
              <p><strong>SKU/CODDV:</strong> {result.coddv}</p>
              <p><strong>Barras:</strong> {result.barras || "-"}</p>
              <p><strong>CD:</strong> {String(result.cd).padStart(2, "0")}</p>
              <p><strong>Estoque disponível:</strong> {result.qtd_est_disp}</p>
              <p><strong>Estoque atual:</strong> {result.qtd_est_atual}</p>
              <p><strong>Última atualização do estoque:</strong> {formatShortDate(result.estoque_updated_at)}</p>
              <p><strong>Última compra:</strong> {formatShortDate(result.dat_ult_compra)}</p>
            </article>

            <article className="busca-produto-card">
              <h3>Endereços SEP ({result.enderecos_sep.length})</h3>
              {renderAddressList(result.enderecos_sep, "Nenhum endereço SEP.")}
            </article>

            <article className="busca-produto-card">
              <h3>Endereços PUL ({result.enderecos_pul.length})</h3>
              {renderAddressList(result.enderecos_pul, "Nenhum endereço PUL.")}
            </article>

            <article className="busca-produto-card">
              <h3>Endereços Excluídos ({result.enderecos_excluidos.length})</h3>
              {renderExcludedAddressList(result.enderecos_excluidos)}
            </article>
          </div>
        ) : null}

        {scannerOpen && typeof document !== "undefined"
          ? createPortal(
              <div className="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="busca-produto-scanner-title" onClick={closeCameraScanner}>
                <div className="scanner-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                  <div className="scanner-head">
                    <h3 id="busca-produto-scanner-title">Scanner de barras</h3>
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
      </section>
    </>
  );
}
