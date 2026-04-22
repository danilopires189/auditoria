import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import {
  formatDateOnlyPtBR,
  formatDateTimeBrasilia,
  todayIsoBrasilia
} from "../../shared/brasilia-datetime";
import { getModuleByKeyOrThrow } from "../registry";
import {
  getAllCaixaTermicaBoxes,
  getCaixaTermicaBoxByCodigo,
  getCaixaTermicaPrefs,
  getMovsByBox,
  saveCaixaTermicaPrefs,
  upsertCaixaTermicaBox,
  countPendingCaixaTermicaBoxes
} from "./storage";
import {
  fetchAndCacheCaixaTermicaBoxes,
  fetchCaixaTermicaFeedDiario,
  fetchCaixaTermicaHistorico,
  lookupCaixaTermicaByCodigo as lookupRemoteCaixaTermicaByCodigo,
  rpcDeleteCaixaTermica,
  rpcExpedirCaixaTermica,
  rpcInsertCaixaTermica,
  rpcReceberCaixaTermica,
  rpcUpdateCaixaTermica,
  syncPendingCaixaTermicaBoxes
} from "./sync";
import {
  parseAuditoriaCaixaEtiqueta
} from "../auditoria-caixa/logic";
import {
  getDbRotasByFilial,
  getDbRotasMeta
} from "../auditoria-caixa/storage";
import {
  refreshDbRotasCache
} from "../auditoria-caixa/sync";
import type {
  CaixaTermicaBox,
  CaixaTermicaFeedRow,
  CaixaTermicaMarca,
  CaixaTermicaModuleProfile,
  CaixaTermicaMov,
  CaixaTermicaView,
  EditarCaixaDraft,
  ExpedicaoDraft,
  NovaCaixaDraft,
  RecebimentoDraft
} from "./types";

// ── Constants ────────────────────────────────────────────────

const MODULE_DEF = getModuleByKeyOrThrow("registro-embarque-caixa-termica");
const SCANNER_INPUT_MAX_INTERVAL_MS = 50;
const SCANNER_INPUT_MIN_BURST_CHARS = 12;
const SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS = 90;
const QUICK_SYNC_THROTTLE_MS = 2500;
const FEED_REFRESH_INTERVAL_MS = 60_000;
const ROUTE_CACHE_REFRESH_COOLDOWN_MS = 45_000;
const PLATE_RE = /^[A-Z]{3}-?(?:\d{4}|\d[A-Z]\d{2})$/i;
const CAIXA_TERMICA_TITLE = "Caixa Térmica";
const CAIXA_TERMICA_MARCAS: CaixaTermicaMarca[] = ["Ecobox", "Coleman", "Isopor genérica"];
const EMPTY_REGISTER_DRAFT: NovaCaixaDraft = {
  codigo: "",
  descricao: "",
  capacidadeLitros: "",
  marca: "",
  observacoes: ""
};

function cdCodeLabel(cd: number | null): string {
  if (cd == null) return "CD não definido";
  return `CD ${String(cd).padStart(2, "0")}`;
}

function SyncIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M7.5 9A6 6 0 0 1 18 7" />
      <path d="M16.5 15A6 6 0 0 1 6 17" />
    </svg>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function isValidBrazilianPlate(v: string): boolean {
  return PLATE_RE.test(v.replace(/\s/g, ""));
}

function normalizePlateInput(v: string): string {
  return v.replace(/[^A-Za-z0-9-]/g, "").toUpperCase().slice(0, 8);
}

function formatTransitTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatOptionalDate(value: string | null): string | null {
  return value ? formatDateOnlyPtBR(value) : null;
}

function formatPedidoSemDv(value: string | number | null | undefined): string {
  const compact = String(value ?? "").trim();
  if (!compact) return "-";
  return compact.length > 1 ? compact.slice(0, -1) : compact;
}

function scannerQrIcon() {
  return <ModuleIcon name="qr" />;
}

function toDisplayName(nome: string): string {
  const compact = nome.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function safeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Scanner input state ──────────────────────────────────────

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

// ── Props ────────────────────────────────────────────────────

interface RegistroEmbarqueCaixaTermicaPageProps {
  isOnline: boolean;
  profile: CaixaTermicaModuleProfile;
}

// ── Component ────────────────────────────────────────────────

export default function RegistroEmbarqueCaixaTermicaPage({
  isOnline,
  profile
}: RegistroEmbarqueCaixaTermicaPageProps) {
  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const isGlobalAdmin = useMemo(
    () => profile.role === "admin" && profile.cd_default == null,
    [profile.cd_default, profile.role]
  );

  // ── CD resolution ──
  const [activeCd, setActiveCd] = useState<number | null>(null);
  const currentCd = activeCd ?? profile.cd_default;
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [dbRotasCount, setDbRotasCount] = useState(0);
  const [dbRotasLastSyncAt, setDbRotasLastSyncAt] = useState<string | null>(null);
  const [busyRefresh, setBusyRefresh] = useState(false);
  const [busySync, setBusySync] = useState(false);

  // ── View ──
  const [view, setView] = useState<CaixaTermicaView>("list");

  // ── Box list ──
  const [boxes, setBoxes] = useState<CaixaTermicaBox[]>([]);
  const [loadingBoxes, setLoadingBoxes] = useState(false);
  const [boxesError, setBoxesError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [expandedBoxIds, setExpandedBoxIds] = useState<Set<string>>(() => new Set());
  const [expandedSection, setExpandedSection] = useState<"disponiveis" | "emTransito" | null>(null);

  // ── Search ──
  const [searchInput, setSearchInput] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchScannerState = useRef<ScannerInputState>(createScannerInputState());

  // ── Pending sync ──
  const [pendingCount, setPendingCount] = useState(0);
  const lastQuickSyncAtRef = useRef(0);
  const lastRouteRefreshAtRef = useRef(0);

  // ── Alerts ──
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [offlineErrorMessage, setOfflineErrorMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Scanner (camera) ──
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<"search" | "register" | "expedicao">("search");
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scanActionBox, setScanActionBox] = useState<CaixaTermicaBox | null>(null);
  const [scanActionBusy, setScanActionBusy] = useState(false);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);

  const cameraSupported = useMemo(
    () => typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function",
    []
  );

  // ── Modal: Register new box ──
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerDraft, setRegisterDraft] = useState<NovaCaixaDraft>(EMPTY_REGISTER_DRAFT);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // ── Modal: Admin edit/delete ──
  const [editDraft, setEditDraft] = useState<EditarCaixaDraft | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CaixaTermicaBox | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Modal: Expedition ──
  const [expedicaoOpen, setExpedicaoOpen] = useState(false);
  const [expedicaoDraft, setExpedicaoDraft] = useState<ExpedicaoDraft | null>(null);
  const [expedicaoBusy, setExpedicaoBusy] = useState(false);
  const [expedicaoError, setExpedicaoError] = useState<string | null>(null);
  const [etiquetaLookupBusy, setEtiquetaLookupBusy] = useState(false);

  // ── Modal: Reception ──
  const [recebimentoOpen, setRecebimentoOpen] = useState(false);
  const [recebimentoDraft, setRecebimentoDraft] = useState<RecebimentoDraft | null>(null);
  const [recebimentoBusy, setRecebimentoBusy] = useState(false);
  const [recebimentoError, setRecebimentoError] = useState<string | null>(null);

  // ── Modal: History ──
  const [historicoOpen, setHistoricoOpen] = useState(false);
  const [historicoCaixa, setHistoricoCaixa] = useState<{ id: string; codigo: string } | null>(null);
  const [historicoMovs, setHistoricoMovs] = useState<CaixaTermicaMov[]>([]);
  const [historicoLoading, setHistoricoLoading] = useState(false);
  const [historicoError, setHistoricoError] = useState<string | null>(null);

  // ── Feed ──
  const [feedRows, setFeedRows] = useState<CaixaTermicaFeedRow[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  // ── Derived state ──
  const filteredBoxes = useMemo(() => {
    if (!searchInput.trim()) return boxes;
    const q = searchInput.trim().toUpperCase();
    return boxes.filter(
      (b) =>
        b.codigo.toUpperCase().includes(q) ||
        b.descricao.toUpperCase().includes(q)
    );
  }, [boxes, searchInput]);

  const disponiveisBoxes = useMemo(
    () => filteredBoxes.filter((b) => b.status === "disponivel"),
    [filteredBoxes]
  );
  const emTransitoBoxes = useMemo(
    () => filteredBoxes.filter((b) => b.status === "em_transito"),
    [filteredBoxes]
  );
  const canAdminEdit = useMemo(
    () => (profile.role === "admin" || isGlobalAdmin) && isOnline,
    [isGlobalAdmin, isOnline, profile.role]
  );
  const offlineReady = preferOfflineMode && dbRotasCount > 0;
  const anyOverlayOpen = Boolean(
    scanActionBox ||
    registerOpen ||
    expedicaoOpen ||
    recebimentoOpen ||
    editDraft ||
    deleteTarget ||
    historicoOpen ||
    scannerOpen
  );

  // ── Load CD prefs ──
  useEffect(() => {
    if (!profile.user_id) return;
    setPreferencesReady(false);
    getCaixaTermicaPrefs(profile.user_id).then((prefs) => {
      if (prefs.cd_ativo != null) setActiveCd(prefs.cd_ativo);
      setPreferOfflineMode(Boolean(prefs.prefer_offline_mode));
    }).catch(() => {/* ignore */}).finally(() => setPreferencesReady(true));
  }, [profile.user_id]);

  useEffect(() => {
    if (!profile.user_id || !preferencesReady) return;
    void saveCaixaTermicaPrefs(profile.user_id, {
      cd_ativo: activeCd,
      prefer_offline_mode: preferOfflineMode
    }).catch(() => undefined);
  }, [activeCd, preferOfflineMode, preferencesReady, profile.user_id]);

  const refreshRouteMeta = useCallback(async () => {
    if (!currentCd) {
      setDbRotasCount(0);
      setDbRotasLastSyncAt(null);
      return;
    }
    const meta = await getDbRotasMeta(profile.user_id, currentCd);
    setDbRotasCount(meta.row_count);
    setDbRotasLastSyncAt(meta.last_sync_at);
  }, [currentCd, profile.user_id]);

  // ── Load boxes ──
  useEffect(() => {
    if (!currentCd) return;
    let cancelled = false;
    setLoadingBoxes(true);
    setBoxesError(null);

    (async () => {
      try {
        // Immediate local render
        const local = await getAllCaixaTermicaBoxes(profile.user_id, currentCd);
        if (!cancelled) setBoxes(local);

        // Background remote fetch
        if (isOnline) {
          const remote = await fetchAndCacheCaixaTermicaBoxes(profile.user_id, currentCd);
          if (!cancelled) setBoxes(remote);
        }

        const pending = await countPendingCaixaTermicaBoxes(profile.user_id);
        if (!cancelled) setPendingCount(pending);
        if (!cancelled) await refreshRouteMeta();
      } catch (err) {
        if (!cancelled) setBoxesError(err instanceof Error ? err.message : "Erro ao carregar caixas.");
      } finally {
        if (!cancelled) setLoadingBoxes(false);
      }
    })();

    return () => { cancelled = true; };
  }, [refreshNonce, currentCd, profile.user_id, isOnline, refreshRouteMeta]);

  // ── Feed loader ──
  useEffect(() => {
    if (view !== "feed" || !currentCd) return;
    let cancelled = false;

    const loadFeed = async () => {
      setFeedLoading(true);
      setFeedError(null);
      try {
        const rows = await fetchCaixaTermicaFeedDiario(currentCd, todayIsoBrasilia());
        if (!cancelled) setFeedRows(rows);
      } catch (err) {
        if (!cancelled) setFeedError(err instanceof Error ? err.message : "Erro ao carregar feed.");
      } finally {
        if (!cancelled) setFeedLoading(false);
      }
    };

    void loadFeed();
    const interval = setInterval(() => { if (isOnline) void loadFeed(); }, FEED_REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [view, currentCd, isOnline]);

  useEffect(() => {
    if (!anyOverlayOpen || typeof document === "undefined") return;

    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousHtmlOverflow = documentElement.style.overflow;
    const previousHtmlOverscroll = documentElement.style.overscrollBehavior;

    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    documentElement.style.overflow = "hidden";
    documentElement.style.overscrollBehavior = "none";

    return () => {
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      documentElement.style.overflow = previousHtmlOverflow;
      documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, [anyOverlayOpen]);

  // ── Success toast ──
  const showSuccess = useCallback((msg: string) => {
    setSuccessMessage(msg);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setSuccessMessage(null), 4000);
  }, []);

  // ── Background sync trigger ──
  const triggerQuickSync = useCallback(() => {
    const now = Date.now();
    if (now - lastQuickSyncAtRef.current < QUICK_SYNC_THROTTLE_MS) return;
    if (!isOnline) return;
    lastQuickSyncAtRef.current = now;
    setBusySync(true);
    syncPendingCaixaTermicaBoxes(profile.user_id).then(({ pending }) => {
      setPendingCount(pending);
      if (pending === 0) setRefreshNonce((n) => n + 1);
    }).catch(() => {/* silent */}).finally(() => setBusySync(false));
  }, [isOnline, profile.user_id]);

  const runDbRotasRefresh = useCallback(async (showMessages = true) => {
    if (!isOnline || !currentCd) return;
    const nowMs = Date.now();
    if (!showMessages && nowMs - lastRouteRefreshAtRef.current < ROUTE_CACHE_REFRESH_COOLDOWN_MS) {
      return;
    }

    lastRouteRefreshAtRef.current = nowMs;
    setBusyRefresh(true);
    if (showMessages) {
      setOfflineErrorMessage(null);
      setProgressMessage("Atualizando base local de rotas...");
    }

    try {
      const result = await refreshDbRotasCache(profile.user_id, currentCd, (progress) => {
        if (!showMessages) return;
        setProgressMessage(
          `Atualizando rotas... ${progress.percent}% (${progress.rowsFetched}/${Math.max(progress.totalRows, progress.rowsFetched)})`
        );
      });
      await refreshRouteMeta();
      if (showMessages) {
        showSuccess(`Base local de rotas atualizada (${result.rows} filiais).`);
      }
    } catch (err) {
      if (showMessages) {
        setOfflineErrorMessage(err instanceof Error ? err.message : "Falha ao atualizar base local de rotas.");
      }
    } finally {
      setBusyRefresh(false);
      setProgressMessage(null);
    }
  }, [currentCd, isOnline, profile.user_id, refreshRouteMeta, showSuccess]);

  const runManualSync = useCallback(async () => {
    if (!isOnline || !currentCd || busyRefresh || busySync) return;
    setBusySync(true);
    setOfflineErrorMessage(null);

    try {
      await runDbRotasRefresh(true);
      const pendingResult = await syncPendingCaixaTermicaBoxes(profile.user_id);
      const remote = await fetchAndCacheCaixaTermicaBoxes(profile.user_id, currentCd);
      setBoxes(remote);
      setPendingCount(pendingResult.pending);
      setRefreshNonce((n) => n + 1);

      if (pendingResult.failed > 0) {
        showSuccess(`${pendingResult.synced} cadastro(s) sincronizado(s) e ${pendingResult.failed} com erro.`);
      } else if (pendingResult.processed > 0) {
        showSuccess(`${pendingResult.synced} cadastro(s) sincronizado(s).`);
      } else {
        showSuccess("Cadastro, situações das caixas e rotas atualizados.");
      }
    } catch (err) {
      setOfflineErrorMessage(err instanceof Error ? err.message : "Falha ao sincronizar dados locais.");
    } finally {
      setBusySync(false);
    }
  }, [busyRefresh, busySync, currentCd, isOnline, profile.user_id, runDbRotasRefresh, showSuccess]);

  const toggleOfflineMode = useCallback(async () => {
    setOfflineErrorMessage(null);
    setProgressMessage(null);

    if (preferOfflineMode) {
      setPreferOfflineMode(false);
      showSuccess("Modo online ativado.");
      return;
    }

    if (!isOnline && dbRotasCount <= 0) {
      setOfflineErrorMessage("Sem base local de rotas. Conecte-se para atualizar antes de trabalhar offline.");
      return;
    }

    setPreferOfflineMode(true);
    if (isOnline) {
      showSuccess("Modo offline local ativado. Preparando rotas, cadastros e situações das caixas.");
      await runManualSync();
      return;
    }

    showSuccess("Modo offline local ativado.");
  }, [dbRotasCount, isOnline, preferOfflineMode, runManualSync, showSuccess]);

  const toggleBoxExpanded = useCallback((boxKey: string) => {
    setExpandedBoxIds((current) => {
      const next = new Set(current);
      if (next.has(boxKey)) next.delete(boxKey);
      else next.add(boxKey);
      return next;
    });
  }, []);

  async function handleScannedSearchCode(rawText: string) {
    if (!currentCd) return;
    const codigo = rawText.trim().toUpperCase();
    if (!codigo) return;

    setSearchInput(codigo);
    setScanActionBusy(true);
    setOfflineErrorMessage(null);

    try {
      const loaded = boxes.find((box) => box.codigo.toUpperCase() === codigo);
      const local = loaded ?? await getCaixaTermicaBoxByCodigo(profile.user_id, currentCd, codigo);
      const box = local ?? await lookupRemoteCaixaTermicaByCodigo(profile.user_id, currentCd, codigo, isOnline);

      if (!box) {
        setOfflineErrorMessage(`Caixa ${codigo} não encontrada neste CD.`);
        return;
      }

      setScanActionBox(box);
    } catch (err) {
      setOfflineErrorMessage(err instanceof Error ? err.message : "Erro ao buscar caixa bipada.");
    } finally {
      setScanActionBusy(false);
    }
  }

  // ── Camera scanner lifecycle ──
  useEffect(() => {
    if (!scannerOpen) return undefined;
    let cancelled = false;
    setScannerError(null);

    const start = async () => {
      const videoEl = scannerVideoRef.current;
      if (!videoEl) return;
      try {
        const zxing = await import("@zxing/browser");
        const reader = new zxing.BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          videoEl,
          (result, error) => {
            if (cancelled) return;
            if (error) return;
            if (!result) return;
            const text = result.getText()?.trim() ?? "";
            if (!text) return;
            controls.stop();
            scannerControlsRef.current = null;
            setScannerOpen(false);
            handleScannerResult(text);
          }
        );
        if (!cancelled) scannerControlsRef.current = controls;
      } catch (err) {
        if (!cancelled) {
          setScannerError(err instanceof Error ? err.message : "Erro ao iniciar câmera.");
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen]);

  const closeScanner = useCallback(() => {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    setScannerOpen(false);
    setScannerError(null);
  }, []);

  const handleScannerResult = useCallback((text: string) => {
    if (scannerTarget === "register") {
      setRegisterDraft((d) => ({ ...d, codigo: text.toUpperCase() }));
    } else if (scannerTarget === "expedicao") {
      handleEtiquetaVolumeChange(text);
    } else {
      void handleScannedSearchCode(text);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerTarget]);

  // ── Barcode gun input detection ──
  const handleSearchInputChange = useCallback((value: string) => {
    const state = searchScannerState.current;
    const now = Date.now();
    const elapsed = now - state.lastInputAt;

    if (elapsed <= SCANNER_INPUT_MAX_INTERVAL_MS) {
      state.burstChars += Math.abs(value.length - state.lastLength);
    } else {
      state.burstChars = value.length;
    }

    state.lastInputAt = now;
    state.lastLength = value.length;
    setSearchInput(value.toUpperCase());

    if (state.timerId !== null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) {
      state.timerId = window.setTimeout(() => {
        const submitted = value.trim().toUpperCase();
        state.timerId = null;
        state.burstChars = 0;
        if (
          submitted &&
          (
            submitted !== state.lastSubmittedValue ||
            Date.now() - state.lastSubmittedAt > 1200
          )
        ) {
          state.lastSubmittedValue = submitted;
          state.lastSubmittedAt = Date.now();
          void handleScannedSearchCode(submitted);
        } else {
          triggerQuickSync();
        }
      }, SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS);
    }
  }, [triggerQuickSync]);

  // ── Open expedition ──
  const openExpedicao = useCallback((box: CaixaTermicaBox) => {
    if (box.status !== "disponivel") {
      setExpedicaoError("Esta caixa não está disponível para expedição.");
      return;
    }
    setExpedicaoDraft({
      caixaId: box.id,
      codigo: box.codigo,
      descricao: box.descricao,
      observacoes: box.observacoes,
      etiquetaVolume: "",
      filial: null,
      filialNome: null,
      rota: null,
      pedido: null,
      dataPedido: null,
      placa: "",
      placaError: null
    });
    setExpedicaoError(null);
    setExpedicaoOpen(true);
  }, []);

  // ── Open reception ──
  const openRecebimento = useCallback((box: CaixaTermicaBox) => {
    if (box.status !== "em_transito") {
      setRecebimentoError("Esta caixa não está em trânsito.");
      return;
    }
    setRecebimentoDraft({
      caixaId: box.id,
      codigo: box.codigo,
      descricao: box.descricao,
      observacoes: box.observacoes,
      obsRecebimento: "",
      semAvarias: false
    });
    setRecebimentoError(null);
    setRecebimentoOpen(true);
  }, []);

  const confirmScanAction = useCallback(() => {
    if (!scanActionBox) return;
    const box = scanActionBox;
    setScanActionBox(null);
    if (box.status === "disponivel") {
      openExpedicao(box);
      return;
    }
    openRecebimento(box);
  }, [openExpedicao, openRecebimento, scanActionBox]);

  // ── Open history ──
  const openHistorico = useCallback(async (box: CaixaTermicaBox) => {
    setHistoricoCaixa({ id: box.id, codigo: box.codigo });
    setHistoricoMovs([]);
    setHistoricoError(null);
    setHistoricoLoading(true);
    setHistoricoOpen(true);

    try {
      // Local first
      const local = await getMovsByBox(box.id);
      setHistoricoMovs(local);

      if (isOnline) {
        const remote = await fetchCaixaTermicaHistorico(box.id);
        setHistoricoMovs(remote);
      }
    } catch (err) {
      setHistoricoError(err instanceof Error ? err.message : "Erro ao carregar histórico.");
    } finally {
      setHistoricoLoading(false);
    }
  }, [isOnline]);

  const openEditCaixa = useCallback((box: CaixaTermicaBox) => {
    setEditDraft({
      caixaId: box.id,
      codigoOriginal: box.codigo,
      codigo: box.codigo,
      descricao: box.descricao,
      capacidadeLitros: box.capacidade_litros ? String(box.capacidade_litros) : "",
      marca: box.marca ?? "",
      observacoes: box.observacoes ?? ""
    });
    setEditError(null);
  }, []);

  const confirmEditCaixa = useCallback(async () => {
    if (!editDraft || !currentCd) return;
    const parsedCapacidade = Number.parseInt(editDraft.capacidadeLitros, 10);

    if (!editDraft.codigo.trim()) { setEditError("Informe o código da caixa."); return; }
    if (!editDraft.descricao.trim()) { setEditError("Informe a descrição da caixa."); return; }
    if (!Number.isFinite(parsedCapacidade) || parsedCapacidade <= 0) {
      setEditError("Informe a capacidade da caixa em litros.");
      return;
    }
    if (!editDraft.marca) { setEditError("Informe a marca da caixa."); return; }

    setEditBusy(true);
    setEditError(null);
    try {
      await rpcUpdateCaixaTermica({
        caixaId: editDraft.caixaId,
        cd: currentCd,
        codigo: editDraft.codigo.trim().toUpperCase(),
        descricao: editDraft.descricao.trim(),
        observacoes: editDraft.observacoes.trim() || null,
        capacidadeLitros: parsedCapacidade,
        marca: editDraft.marca,
        userId: profile.user_id,
        mat: profile.mat,
        nome: profile.nome
      });
      setEditDraft(null);
      setRefreshNonce((n) => n + 1);
      showSuccess("Caixa atualizada com sucesso.");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Erro ao editar caixa.");
    } finally {
      setEditBusy(false);
    }
  }, [currentCd, editDraft, profile, showSuccess]);

  const openDeleteCaixa = useCallback((box: CaixaTermicaBox) => {
    setDeleteTarget(box);
    setDeleteError(null);
  }, []);

  const confirmDeleteCaixa = useCallback(async () => {
    if (!deleteTarget || !currentCd) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await rpcDeleteCaixaTermica({
        box: deleteTarget,
        cd: currentCd,
        userId: profile.user_id,
        mat: profile.mat,
        nome: profile.nome
      });
      setBoxes((current) => current.filter((box) => box.local_id !== deleteTarget.local_id));
      setDeleteTarget(null);
      setRefreshNonce((n) => n + 1);
      showSuccess("Caixa inativada com sucesso.");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Erro ao excluir caixa.");
    } finally {
      setDeleteBusy(false);
    }
  }, [currentCd, deleteTarget, profile, showSuccess]);

  // ── Etiqueta volume → filial/rota lookup ──
  const handleEtiquetaVolumeChange = useCallback(async (value: string) => {
    setExpedicaoDraft((d) => d ? {
      ...d,
      etiquetaVolume: value,
      filial: null,
      filialNome: null,
      rota: null,
      pedido: null,
      dataPedido: null
    } : d);

    if (value.length < 17 || !currentCd) return;

    try {
      setEtiquetaLookupBusy(true);
      const parsed = parseAuditoriaCaixaEtiqueta(value, null, { currentCd });
      const rotaRow = await getDbRotasByFilial(profile.user_id, currentCd, parsed.filial);
      setExpedicaoDraft((d) => d ? {
        ...d,
        filial: parsed.filial,
        filialNome: rotaRow?.nome ?? null,
        rota: rotaRow?.rota ?? "Sem rota",
        pedido: parsed.pedido,
        dataPedido: parsed.data_pedido
      } : d);
    } catch {
      // Etiqueta inválida — clear silently, expedição pode prosseguir sem rota
    } finally {
      setEtiquetaLookupBusy(false);
    }
  }, [currentCd, profile.user_id]);

  // ── Confirm register ──
  const confirmRegister = useCallback(async () => {
    if (!currentCd) return;
    const { codigo, descricao, capacidadeLitros, marca, observacoes } = registerDraft;
    const parsedCapacidade = Number.parseInt(capacidadeLitros, 10);

    if (!codigo.trim()) { setRegisterError("Informe o código da caixa."); return; }
    if (!descricao.trim()) { setRegisterError("Informe a descrição da caixa."); return; }
    if (!Number.isFinite(parsedCapacidade) || parsedCapacidade <= 0) {
      setRegisterError("Informe a capacidade da caixa em litros.");
      return;
    }
    if (!marca) { setRegisterError("Informe a marca da caixa."); return; }

    // Duplicate check
    const existing = await getCaixaTermicaBoxByCodigo(profile.user_id, currentCd, codigo.trim());
    if (existing) { setRegisterError("Já existe uma caixa com este código neste CD."); return; }

    setRegisterBusy(true);
    setRegisterError(null);

    try {
      if (isOnline) {
        await rpcInsertCaixaTermica({
          cd: currentCd,
          codigo: codigo.trim().toUpperCase(),
          descricao: descricao.trim(),
          observacoes: observacoes.trim() || null,
          capacidadeLitros: parsedCapacidade,
          marca,
          userId: profile.user_id,
          mat: profile.mat,
          nome: profile.nome
        });
      } else {
        // Offline: save locally
        const localId = `local:${safeUuid()}`;
        const now = new Date().toISOString();
        await upsertCaixaTermicaBox({
          id: localId,
          local_id: localId,
          remote_id: null,
          cd: currentCd,
          codigo: codigo.trim().toUpperCase(),
          descricao: descricao.trim(),
          observacoes: observacoes.trim() || null,
          capacidade_litros: parsedCapacidade,
          marca,
          status: "disponivel",
          created_at: now,
          created_by: profile.user_id,
          created_mat: profile.mat,
          created_nome: profile.nome,
          updated_at: now,
          updated_by: null,
          updated_mat: null,
          updated_nome: null,
          deleted_at: null,
          deleted_by: null,
          deleted_mat: null,
          deleted_nome: null,
          sync_status: "pending_insert",
          sync_error: null,
          last_mov_tipo: null,
          last_mov_data_hr: null,
          last_mov_placa: null,
          last_mov_rota: null,
          last_mov_filial: null,
          last_mov_filial_nome: null,
          last_mov_pedido: null,
          last_mov_data_pedido: null,
          last_mov_mat_resp: null,
          last_mov_nome_resp: null
        });
      }

      setRegisterOpen(false);
      setRegisterDraft(EMPTY_REGISTER_DRAFT);
      setRefreshNonce((n) => n + 1);
      showSuccess("Caixa cadastrada com sucesso.");
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : "Erro ao cadastrar caixa.");
    } finally {
      setRegisterBusy(false);
    }
  }, [currentCd, registerDraft, profile, isOnline, showSuccess]);

  // ── Confirm expedition ──
  const confirmExpedicao = useCallback(async () => {
    if (!expedicaoDraft || !currentCd) return;

    if (!expedicaoDraft.placa.trim()) {
      setExpedicaoError("Informe a placa do veículo.");
      return;
    }
    if (!isValidBrazilianPlate(expedicaoDraft.placa)) {
      setExpedicaoError("Placa inválida. Use o formato ABC-1234 ou ABC1D23.");
      return;
    }
    if (!isOnline) {
      setExpedicaoError("A expedição requer conexão com a internet.");
      return;
    }

    setExpedicaoBusy(true);
    setExpedicaoError(null);

    try {
      await rpcExpedirCaixaTermica({
        caixaId: expedicaoDraft.caixaId,
        cd: currentCd,
        etiquetaVolume: expedicaoDraft.etiquetaVolume.trim() || null,
        filial: expedicaoDraft.filial,
        filialNome: expedicaoDraft.filialNome,
        rota: expedicaoDraft.rota,
        placa: expedicaoDraft.placa.trim().toUpperCase(),
        mat: profile.mat,
        nome: profile.nome,
        userId: profile.user_id
      });

      setExpedicaoOpen(false);
      setExpedicaoDraft(null);
      setRefreshNonce((n) => n + 1);
      showSuccess(`Caixa ${expedicaoDraft.codigo} expedida com sucesso.`);
      triggerQuickSync();
    } catch (err) {
      setExpedicaoError(err instanceof Error ? err.message : "Erro ao expedir caixa.");
    } finally {
      setExpedicaoBusy(false);
    }
  }, [expedicaoDraft, currentCd, isOnline, profile, showSuccess, triggerQuickSync]);

  // ── Confirm reception ──
  const confirmRecebimento = useCallback(async () => {
    if (!recebimentoDraft || !currentCd) return;

    if (!recebimentoDraft.semAvarias && !recebimentoDraft.obsRecebimento.trim()) {
      setRecebimentoError("Marque 'Recebido sem avarias' ou descreva as avarias encontradas.");
      return;
    }
    if (!isOnline) {
      setRecebimentoError("O recebimento requer conexão com a internet.");
      return;
    }

    setRecebimentoBusy(true);
    setRecebimentoError(null);

    try {
      await rpcReceberCaixaTermica({
        caixaId: recebimentoDraft.caixaId,
        cd: currentCd,
        obsRecebimento: recebimentoDraft.semAvarias
          ? null
          : recebimentoDraft.obsRecebimento.trim() || null,
        mat: profile.mat,
        nome: profile.nome,
        userId: profile.user_id
      });

      setRecebimentoOpen(false);
      setRecebimentoDraft(null);
      setRefreshNonce((n) => n + 1);
      showSuccess(`Caixa ${recebimentoDraft.codigo} recebida com sucesso.`);
      triggerQuickSync();
    } catch (err) {
      setRecebimentoError(err instanceof Error ? err.message : "Erro ao receber caixa.");
    } finally {
      setRecebimentoBusy(false);
    }
  }, [recebimentoDraft, currentCd, isOnline, profile, showSuccess, triggerQuickSync]);

  // ── Render ────────────────────────────────────────────────

  return (
    <>
      {/* ── TOPBAR ── */}
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link
            to="/inicio"
            className="module-home-btn"
            aria-label="Voltar para o Início"
            title="Voltar para o Início"
          >
            <span className="module-back-icon" aria-hidden="true">
              <BackIcon />
            </span>
            <span>Início</span>
          </Link>
          <div className="module-topbar-user-side">
            <PendingSyncBadge
              pendingCount={pendingCount}
              title="Cadastros pendentes de sincronização"
              onClick={pendingCount > 0 ? () => triggerQuickSync() : undefined}
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
          <span className="module-title">{CAIXA_TERMICA_TITLE}</span>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <section className="modules-shell coleta-shell caixa-termica-shell">
        <div className="coleta-head">
          <h2>Olá, {displayUserName}</h2>
          <p>Cadastre caixas térmicas, acompanhe a situação e consulte rotas no cache local.</p>
          <p className="coleta-meta-line">
            CD atual: <strong>{cdCodeLabel(currentCd)}</strong>
            {" | "}Base local de rotas: <strong>{dbRotasCount}</strong> filiais
            {dbRotasLastSyncAt ? ` | Atualizada em ${formatDateTimeBrasilia(dbRotasLastSyncAt)}` : " | Sem atualização ainda"}
          </p>
        </div>

        {/* Success toast */}
        {successMessage && (
          <div className="alert success">{successMessage}</div>
        )}
        {offlineErrorMessage ? <div className="alert error">{offlineErrorMessage}</div> : null}
        {progressMessage ? <div className="alert success">{progressMessage}</div> : null}
        {scanActionBusy ? <div className="alert success">Buscando caixa bipada...</div> : null}
        {offlineReady ? (
          <div className="alert success">
            Modo offline ativo: rotas, cadastros e situações das caixas serão usados do cache local.
          </div>
        ) : null}
        {preferOfflineMode && dbRotasCount <= 0 ? (
          <div className={isOnline ? "alert success" : "alert error"}>
            {isOnline
              ? "Modo offline ativo sem base local completa. Sincronize antes de ficar sem internet."
              : "Modo offline ativo sem base local. Conecte-se para carregar rotas, cadastros e situações das caixas."}
          </div>
        ) : null}
        {!preferOfflineMode && !isOnline ? (
          <div className="alert error">
            Você está sem internet. Para consultar o cache local, ative Trabalhar offline.
          </div>
        ) : null}

        <div className="termo-actions-row">
          <button
            type="button"
            className={`btn btn-muted termo-offline-toggle${preferOfflineMode ? " is-active" : ""}`}
            onClick={() => void toggleOfflineMode()}
            disabled={busyRefresh || busySync}
            title={preferOfflineMode ? "Desativar modo offline local" : "Ativar modo offline local"}
          >
            {preferOfflineMode ? "📦 Offline ativo" : "📶 Trabalhar offline"}
          </button>
          <button
            type="button"
            className="btn btn-muted termo-sync-btn"
            onClick={() => void runManualSync()}
            disabled={!isOnline || currentCd == null || busyRefresh || busySync}
          >
            <span aria-hidden="true"><SyncIcon /></span>
            {busyRefresh || busySync ? "Sincronizando..." : "Sincronizar agora"}
          </button>
        </div>

        {/* ── LIST VIEW ── */}
        {view === "list" && (
          <>
            {/* Toolbar */}
            <div className="caixa-termica-toolbar">
              <div className="caixa-input-scan-wrap" style={{ flex: "1 1 160px", minWidth: "120px" }}>
                <input
                  ref={searchRef}
                  type="search"
                  className="caixa-search-input"
                  placeholder="Buscar por código ou descrição..."
                  value={searchInput}
                  onChange={(e) => handleSearchInputChange(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {cameraSupported && (
                  <button
                    type="button"
                    className="caixa-scanner-btn"
                    title="Escanear código via câmera"
                    onClick={() => {
                      setScannerTarget("search");
                      setScannerOpen(true);
                    }}
                  >
                    {scannerQrIcon()}
                  </button>
                )}
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setRegisterDraft(EMPTY_REGISTER_DRAFT);
                  setRegisterError(null);
                  setRegisterOpen(true);
                }}
              >
                + Nova Caixa
              </button>
              <button
                type="button"
                className="btn btn-muted"
                onClick={() => setView("feed")}
              >
                Feed do Dia
              </button>
            </div>

            {/* Error state */}
            {boxesError && (
              <div style={{ padding: "0 16px" }}>
                <div className="alert error">{boxesError}</div>
              </div>
            )}

            {/* Loading state */}
            {loadingBoxes && boxes.length === 0 && (
              <p className="caixa-sem-itens">Carregando caixas...</p>
            )}

            {/* DISPONÍVEL section */}
            <div className="caixa-section">
              <button
                type="button"
                className="caixa-section-title-btn"
                onClick={() => setExpandedSection((prev) => prev === "disponiveis" ? null : "disponiveis")}
                aria-expanded={expandedSection === "disponiveis"}
              >
                <span className="caixa-section-title">
                  ✅ Disponíveis
                  <span className="caixa-section-count">{disponiveisBoxes.length}</span>
                </span>
                <span className="caixa-section-chevron" aria-hidden="true">{expandedSection === "disponiveis" ? "▾" : "▸"}</span>
              </button>
              {expandedSection === "disponiveis" && (
                disponiveisBoxes.length === 0 ? (
                  <p className="caixa-sem-itens">
                    {searchInput ? "Nenhuma caixa disponível para este filtro." : "Nenhuma caixa disponível."}
                  </p>
                ) : (
                  <div className="caixa-cards-list">
                    {disponiveisBoxes.map((box) => (
                      <CaixaCard
                        key={box.local_id}
                        box={box}
                        isExpanded={expandedBoxIds.has(box.local_id)}
                        onToggleExpanded={() => toggleBoxExpanded(box.local_id)}
                        onAction={() => openExpedicao(box)}
                        onHistory={() => void openHistorico(box)}
                        canAdminEdit={canAdminEdit}
                        onEdit={() => openEditCaixa(box)}
                        onDelete={() => openDeleteCaixa(box)}
                      />
                    ))}
                  </div>
                )
              )}
            </div>

            {/* EM TRÂNSITO section */}
            <div className="caixa-section">
              <button
                type="button"
                className="caixa-section-title-btn"
                onClick={() => setExpandedSection((prev) => prev === "emTransito" ? null : "emTransito")}
                aria-expanded={expandedSection === "emTransito"}
              >
                <span className="caixa-section-title">
                  🚚 Em Trânsito
                  <span className="caixa-section-count">{emTransitoBoxes.length}</span>
                </span>
                <span className="caixa-section-chevron" aria-hidden="true">{expandedSection === "emTransito" ? "▾" : "▸"}</span>
              </button>
              {expandedSection === "emTransito" && (
                emTransitoBoxes.length === 0 ? (
                  <p className="caixa-sem-itens">
                    {searchInput ? "Nenhuma caixa em trânsito para este filtro." : "Nenhuma caixa em trânsito."}
                  </p>
                ) : (
                  <div className="caixa-cards-list">
                    {emTransitoBoxes.map((box) => (
                      <CaixaCard
                        key={box.local_id}
                        box={box}
                        isExpanded={expandedBoxIds.has(box.local_id)}
                        onToggleExpanded={() => toggleBoxExpanded(box.local_id)}
                        onAction={() => openRecebimento(box)}
                        onHistory={() => void openHistorico(box)}
                        canAdminEdit={canAdminEdit}
                        onEdit={() => openEditCaixa(box)}
                        onDelete={() => openDeleteCaixa(box)}
                      />
                    ))}
                  </div>
                )
              )}
            </div>
          </>
        )}

        {/* ── FEED VIEW ── */}
        {view === "feed" && (
          <div className="caixa-feed-section">
            <div className="caixa-feed-header">
              <button
                type="button"
                className="btn btn-muted"
                onClick={() => setView("list")}
              >
                ← Voltar
              </button>
              <h2 className="caixa-feed-title">
                Feed do Dia — {formatDateOnlyPtBR(todayIsoBrasilia())}
              </h2>
            </div>

            {feedLoading && <p className="caixa-sem-itens">Carregando feed...</p>}
            {feedError && <div className="alert error">{feedError}</div>}

            {!feedLoading && !feedError && feedRows.length === 0 && (
              <p className="caixa-sem-itens">Nenhuma movimentação registrada hoje.</p>
            )}

            {feedRows.map((row, idx) => (
              <div key={`feed-${idx}`} className="caixa-feed-group">
                <div className="caixa-feed-group-head">
                  <span className="caixa-feed-route-icon" aria-hidden="true">🧭</span>
                  <p className="caixa-feed-group-title">
                    {row.rota ?? "Sem rota"}
                    {row.filial_nome && <span>{row.filial_nome}</span>}
                    {!row.filial_nome && row.filial && <span>Filial {row.filial}</span>}
                  </p>
                </div>
                <div className="caixa-feed-stats">
                  <span className="caixa-feed-stat expedicao">🚚 {row.expedicoes} expediç{row.expedicoes !== 1 ? "ões" : "ão"}</span>
                  <span className="caixa-feed-stat recebimento">✅ {row.recebimentos} recebimento{row.recebimentos !== 1 ? "s" : ""}</span>
                </div>
                <div className="caixa-feed-items">
                  {row.caixas.map((c, ci) => (
                    <div key={ci} className="caixa-feed-item">
                      <span className="caixa-feed-item-codigo">{c.codigo}</span>
                      <span className={`caixa-feed-item-type ${c.tipo}`}>
                        {c.tipo === "expedicao" ? "🚚 Expedição" : "✅ Recebimento"}
                      </span>
                      <div className="caixa-feed-item-details">
                        <span className="caixa-feed-item-detail-line">
                          Data: <strong>{formatDateTimeBrasilia(c.data_hr)}</strong>
                        </span>
                        {(c.mat_resp || c.nome_resp) && (
                          <span className="caixa-feed-item-detail-line caixa-feed-item-detail-user">
                            Responsável: <strong>{[c.mat_resp, c.nome_resp].filter(Boolean).join(" ")}</strong>
                          </span>
                        )}
                        {c.pedido && (
                          <span className="caixa-feed-item-detail-line">
                            Pedido: <strong>{formatPedidoSemDv(c.pedido)}</strong>
                          </span>
                        )}
                      </div>
                      <span className="caixa-feed-item-time">{formatDateTimeBrasilia(c.data_hr)}</span>
                      {(c.mat_resp || c.nome_resp) && (
                        <span className="caixa-feed-item-user">
                          {[c.mat_resp, c.nome_resp].filter(Boolean).join(" ")}
                        </span>
                      )}
                      {c.pedido && <span className="caixa-feed-item-order">Pedido {formatPedidoSemDv(c.pedido)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════
          MODAL: SCANNED SEARCH ACTION
         ══════════════════════════════════════════ */}
      {scanActionBox && typeof document !== "undefined" && createPortal(
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scan-action-modal-title"
          onClick={() => setScanActionBox(null)}
        >
          <div
            className="confirm-dialog surface-enter"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="scan-action-modal-title">
              {scanActionBox.status === "disponivel" ? "Expedir caixa?" : "Receber caixa?"}
            </h3>
            <p>
              Caixa: <strong>{scanActionBox.codigo}</strong> — {scanActionBox.descricao}
            </p>
            <p>
              {scanActionBox.status === "disponivel"
                ? "Esta caixa está disponível. Deseja abrir a expedição agora?"
                : "Esta caixa está em trânsito. Deseja abrir o recebimento agora?"}
            </p>
            <div className="confirm-actions">
              <button
                className="btn btn-muted"
                type="button"
                onClick={() => setScanActionBox(null)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={confirmScanAction}
              >
                {scanActionBox.status === "disponivel" ? "🚚 Expedir" : "✅ Receber"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ══════════════════════════════════════════
          MODAL: REGISTER NEW BOX
         ══════════════════════════════════════════ */}
      {registerOpen && typeof document !== "undefined" && createPortal(
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="register-modal-title"
          onClick={() => { if (!registerBusy) setRegisterOpen(false); }}
        >
          <div
            className="confirm-dialog surface-enter"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="register-modal-title">Registrar Nova Caixa Térmica</h3>

            {registerError && <div className="alert error">{registerError}</div>}

            <div className="caixa-modal-field">
              <label htmlFor="reg-codigo">Código *</label>
              <div className="caixa-input-scan-wrap">
                <input
                  id="reg-codigo"
                  type="text"
                  value={registerDraft.codigo}
                  onChange={(e) =>
                    setRegisterDraft((d) => ({ ...d, codigo: e.target.value.toUpperCase() }))
                  }
                  placeholder="Ex: CX001"
                  autoComplete="off"
                  disabled={registerBusy}
                />
                {cameraSupported && (
                  <button
                    type="button"
                    className="caixa-scanner-btn"
                    title="Escanear via câmera"
                    disabled={registerBusy}
                    onClick={() => {
                      setScannerTarget("register");
                      setScannerOpen(true);
                    }}
                  >
                    {scannerQrIcon()}
                  </button>
                )}
              </div>
            </div>

            <div className="caixa-modal-field">
              <label htmlFor="reg-descricao">Descrição *</label>
              <input
                id="reg-descricao"
                type="text"
                value={registerDraft.descricao}
                onChange={(e) =>
                  setRegisterDraft((d) => ({ ...d, descricao: e.target.value }))
                }
                placeholder="Ex: Caixa grande azul"
                disabled={registerBusy}
              />
            </div>

            <div className="caixa-modal-field">
              <label htmlFor="reg-capacidade">Capacidade (litros) *</label>
              <input
                id="reg-capacidade"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={registerDraft.capacidadeLitros}
                onChange={(e) =>
                  setRegisterDraft((d) => ({ ...d, capacidadeLitros: e.target.value.replace(/\D/g, "") }))
                }
                placeholder="Ex: 45"
                disabled={registerBusy}
              />
            </div>

            <div className="caixa-modal-field">
              <label htmlFor="reg-marca">Marca *</label>
              <select
                id="reg-marca"
                value={registerDraft.marca}
                onChange={(e) =>
                  setRegisterDraft((d) => ({ ...d, marca: e.target.value as CaixaTermicaMarca | "" }))
                }
                disabled={registerBusy}
              >
                <option value="">Selecione</option>
                {CAIXA_TERMICA_MARCAS.map((marca) => (
                  <option key={marca} value={marca}>{marca}</option>
                ))}
              </select>
            </div>

            <div className="caixa-modal-field">
              <label htmlFor="reg-obs">Observações (danos pré-existentes)</label>
              <textarea
                id="reg-obs"
                value={registerDraft.observacoes}
                onChange={(e) =>
                  setRegisterDraft((d) => ({ ...d, observacoes: e.target.value }))
                }
                placeholder="Descreva avarias existentes, se houver..."
                rows={3}
                disabled={registerBusy}
                style={{ resize: "vertical" }}
              />
            </div>

            <div className="confirm-actions">
              <button
                className="btn btn-muted"
                type="button"
                onClick={() => setRegisterOpen(false)}
                disabled={registerBusy}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void confirmRegister()}
                disabled={registerBusy}
              >
                {registerBusy ? "Registrando..." : "Registrar"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ══════════════════════════════════════════
          MODAL: EXPEDITION
         ══════════════════════════════════════════ */}
      {expedicaoOpen && expedicaoDraft && typeof document !== "undefined" && createPortal(
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="expedicao-modal-title"
          onClick={() => { if (!expedicaoBusy) { setExpedicaoOpen(false); setExpedicaoDraft(null); } }}
        >
          <div
            className="confirm-dialog surface-enter"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="expedicao-modal-title">Expedir Caixa</h3>
            <p style={{ fontSize: "0.9rem", color: "#4b5671", marginBottom: "12px" }}>
              Caixa: <strong>{expedicaoDraft.codigo}</strong> — {expedicaoDraft.descricao}
            </p>

            {expedicaoDraft.observacoes && (
              <div className="alert warning" style={{ marginBottom: "12px" }}>
                Danos pré-existentes: {expedicaoDraft.observacoes}
              </div>
            )}

            {expedicaoError && <div className="alert error">{expedicaoError}</div>}

            {/* Etiqueta de Volume */}
            <div className="caixa-modal-field">
              <label htmlFor="exp-etiqueta">Etiqueta de Volume</label>
              <div className="caixa-input-scan-wrap">
                <input
                  id="exp-etiqueta"
                  type="text"
                  value={expedicaoDraft.etiquetaVolume}
                  onChange={(e) => void handleEtiquetaVolumeChange(e.target.value)}
                  placeholder="Bipar ou digitar etiqueta"
                  autoComplete="off"
                  disabled={expedicaoBusy}
                />
                {cameraSupported && (
                  <button
                    type="button"
                    className="caixa-scanner-btn"
                    title="Escanear etiqueta via câmera"
                    disabled={expedicaoBusy}
                    onClick={() => {
                      setScannerTarget("expedicao");
                      setScannerOpen(true);
                    }}
                  >
                    {scannerQrIcon()}
                  </button>
                )}
              </div>
              {etiquetaLookupBusy && (
                <span style={{ fontSize: "0.78rem", color: "#4b5671" }}>Buscando rota...</span>
              )}
              {!etiquetaLookupBusy && expedicaoDraft.rota && (
                <span className="caixa-etiqueta-meta">
                  Rota {expedicaoDraft.rota}
                  {expedicaoDraft.pedido && ` | Pedido ${formatPedidoSemDv(expedicaoDraft.pedido)}`}
                  {expedicaoDraft.dataPedido && ` | ${formatDateOnlyPtBR(expedicaoDraft.dataPedido)}`}
                  {expedicaoDraft.filialNome && ` | ${expedicaoDraft.filialNome}`}
                </span>
              )}
            </div>

            {/* Placa */}
            <div className="caixa-modal-field">
              <label htmlFor="exp-placa">Placa do Veículo *</label>
              <input
                id="exp-placa"
                type="text"
                value={expedicaoDraft.placa}
                onChange={(e) => {
                  const upper = normalizePlateInput(e.target.value);
                  const placaError = upper.length > 0 && !isValidBrazilianPlate(upper)
                    ? "Placa inválida. Use ABC-1234 ou ABC1D23."
                    : null;
                  setExpedicaoDraft((d) => d ? { ...d, placa: upper, placaError } : d);
                }}
                placeholder="Ex: ABC-1234 ou ABC1D23"
                autoComplete="off"
                disabled={expedicaoBusy}
                maxLength={8}
              />
              {expedicaoDraft.placaError && (
                <span className="caixa-placa-error">{expedicaoDraft.placaError}</span>
              )}
            </div>

            <div className="confirm-actions">
              <button
                className="btn btn-muted"
                type="button"
                onClick={() => { setExpedicaoOpen(false); setExpedicaoDraft(null); }}
                disabled={expedicaoBusy}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void confirmExpedicao()}
                disabled={expedicaoBusy || Boolean(expedicaoDraft.placaError)}
              >
                {expedicaoBusy ? "Expedindo..." : "Confirmar Envio"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ══════════════════════════════════════════
          MODAL: RECEPTION
         ══════════════════════════════════════════ */}
      {recebimentoOpen && recebimentoDraft && typeof document !== "undefined" && createPortal(
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="recebimento-modal-title"
          onClick={() => { if (!recebimentoBusy) { setRecebimentoOpen(false); setRecebimentoDraft(null); } }}
        >
          <div
            className="confirm-dialog surface-enter"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="recebimento-modal-title">Receber Caixa</h3>
            <p style={{ fontSize: "0.9rem", color: "#4b5671", marginBottom: "12px" }}>
              Caixa: <strong>{recebimentoDraft.codigo}</strong> — {recebimentoDraft.descricao}
            </p>

            {recebimentoDraft.observacoes ? (
              <div className="alert warning" style={{ marginBottom: "12px" }}>
                Atenção: danos pré-existentes registrados: &ldquo;{recebimentoDraft.observacoes}&rdquo;
              </div>
            ) : (
              <div className="alert success" style={{ marginBottom: "12px" }}>
                ✓ Nenhuma avaria pré-existente registrada.
              </div>
            )}

            {recebimentoError && <div className="alert error">{recebimentoError}</div>}

            {/* Sem avarias toggle */}
            <label className="caixa-checkbox-row">
              <input
                type="checkbox"
                checked={recebimentoDraft.semAvarias}
                onChange={(e) =>
                  setRecebimentoDraft((d) =>
                    d ? {
                      ...d,
                      semAvarias: e.target.checked,
                      obsRecebimento: e.target.checked ? "" : d.obsRecebimento
                    } : d
                  )
                }
                disabled={recebimentoBusy}
              />
              Caixa recebida sem avarias
            </label>

            {/* Damage notes (visible when sem_avarias is false) */}
            {!recebimentoDraft.semAvarias && (
              <div className="caixa-modal-field">
                <label htmlFor="rec-obs">Descreva as avarias encontradas</label>
                <textarea
                  id="rec-obs"
                  value={recebimentoDraft.obsRecebimento}
                  onChange={(e) =>
                    setRecebimentoDraft((d) => d ? { ...d, obsRecebimento: e.target.value } : d)
                  }
                  placeholder="Descreva avarias detectadas no recebimento..."
                  rows={3}
                  disabled={recebimentoBusy}
                  style={{ resize: "vertical" }}
                />
              </div>
            )}

            <div className="confirm-actions">
              <button
                className="btn btn-muted"
                type="button"
                onClick={() => { setRecebimentoOpen(false); setRecebimentoDraft(null); }}
                disabled={recebimentoBusy}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void confirmRecebimento()}
                disabled={recebimentoBusy}
              >
                {recebimentoBusy ? "Recebendo..." : "Confirmar Recebimento"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ══════════════════════════════════════════
          MODAL: ADMIN EDIT
         ══════════════════════════════════════════ */}
      {editDraft && typeof document !== "undefined" && createPortal(
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-modal-title"
          onClick={() => { if (!editBusy) setEditDraft(null); }}
        >
          <div
            className="confirm-dialog surface-enter"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="edit-modal-title">Editar Caixa Térmica</h3>

            {editError && <div className="alert error">{editError}</div>}

            <div className="caixa-modal-field">
              <label htmlFor="edit-codigo">Código *</label>
              <input
                id="edit-codigo"
                type="text"
                value={editDraft.codigo}
                onChange={(e) => setEditDraft((d) => d ? { ...d, codigo: e.target.value.toUpperCase() } : d)}
                disabled={editBusy}
              />
            </div>

            <div className="caixa-modal-field">
              <label htmlFor="edit-descricao">Descrição *</label>
              <input
                id="edit-descricao"
                type="text"
                value={editDraft.descricao}
                onChange={(e) => setEditDraft((d) => d ? { ...d, descricao: e.target.value } : d)}
                disabled={editBusy}
              />
            </div>

            <div className="caixa-modal-field">
              <label htmlFor="edit-capacidade">Capacidade (litros) *</label>
              <input
                id="edit-capacidade"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={editDraft.capacidadeLitros}
                onChange={(e) =>
                  setEditDraft((d) => d ? { ...d, capacidadeLitros: e.target.value.replace(/\D/g, "") } : d)
                }
                disabled={editBusy}
              />
            </div>

            <div className="caixa-modal-field">
              <label htmlFor="edit-marca">Marca *</label>
              <select
                id="edit-marca"
                value={editDraft.marca}
                onChange={(e) =>
                  setEditDraft((d) => d ? { ...d, marca: e.target.value as CaixaTermicaMarca | "" } : d)
                }
                disabled={editBusy}
              >
                <option value="">Selecione</option>
                {CAIXA_TERMICA_MARCAS.map((marca) => (
                  <option key={marca} value={marca}>{marca}</option>
                ))}
              </select>
            </div>

            <div className="caixa-modal-field">
              <label htmlFor="edit-obs">Observações</label>
              <textarea
                id="edit-obs"
                value={editDraft.observacoes}
                onChange={(e) => setEditDraft((d) => d ? { ...d, observacoes: e.target.value } : d)}
                rows={3}
                disabled={editBusy}
                style={{ resize: "vertical" }}
              />
            </div>

            <div className="confirm-actions">
              <button className="btn btn-muted" type="button" onClick={() => setEditDraft(null)} disabled={editBusy}>
                Cancelar
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void confirmEditCaixa()} disabled={editBusy}>
                {editBusy ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ══════════════════════════════════════════
          MODAL: ADMIN DELETE
         ══════════════════════════════════════════ */}
      {deleteTarget && typeof document !== "undefined" && createPortal(
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          onClick={() => { if (!deleteBusy) setDeleteTarget(null); }}
        >
          <div
            className="confirm-dialog surface-enter"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-modal-title">Excluir Caixa Térmica</h3>
            <p style={{ fontSize: "0.9rem", color: "#4b5671", marginBottom: "12px" }}>
              A caixa <strong>{deleteTarget.codigo}</strong> será inativada e sairá da listagem. O histórico continuará salvo no banco.
            </p>
            {deleteTarget.status === "em_transito" && (
              <div className="alert warning">Receba esta caixa antes de excluir/inativar.</div>
            )}
            {deleteError && <div className="alert error">{deleteError}</div>}
            <div className="confirm-actions">
              <button className="btn btn-muted" type="button" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void confirmDeleteCaixa()}
                disabled={deleteBusy || deleteTarget.status === "em_transito"}
              >
                {deleteBusy ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ══════════════════════════════════════════
          MODAL: HISTORY
         ══════════════════════════════════════════ */}
      {historicoOpen && historicoCaixa && typeof document !== "undefined" && createPortal(
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="historico-modal-title"
          onClick={() => setHistoricoOpen(false)}
        >
          <div
            className="confirm-dialog surface-enter caixa-historico-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="historico-modal-title">Histórico — {historicoCaixa.codigo}</h3>

            <div className="caixa-historico-scroll">
              {historicoLoading && (
                <p style={{ fontSize: "0.88rem", color: "#4b5671" }}>Carregando histórico...</p>
              )}
              {historicoError && <div className="alert error">{historicoError}</div>}

              {!historicoLoading && !historicoError && historicoMovs.length === 0 && (
                <p style={{ fontSize: "0.88rem", color: "#4b5671" }}>Nenhuma movimentação registrada.</p>
              )}

              <div className="caixa-historico-timeline">
                {historicoMovs.map((mov) => (
                  <div key={mov.id} className={`caixa-historico-item ${mov.tipo}`}>
                    <span className="caixa-historico-tipo">
                      {mov.tipo === "expedicao" ? "Expedição" : "Recebimento"}
                    </span>
                    <span className="caixa-historico-meta">
                      {formatDateTimeBrasilia(mov.data_hr)}
                    </span>
                    {mov.transit_minutes != null && (
                      <span className="caixa-historico-transit">
                        Tempo em trânsito: {formatTransitTime(mov.transit_minutes)}
                      </span>
                    )}
                    {mov.placa && (
                      <span className="caixa-historico-meta">Placa: {mov.placa}</span>
                    )}
                    {(mov.rota || mov.filial_nome || mov.filial) && (
                      <span className="caixa-historico-meta">
                        Rota: {mov.rota ?? "—"}
                        {mov.filial_nome && ` | ${mov.filial_nome}`}
                        {!mov.filial_nome && mov.filial && ` | Filial ${mov.filial}`}
                      </span>
                    )}
                    {(mov.pedido || mov.data_pedido) && (
                      <span className="caixa-historico-meta">
                        Pedido: {formatPedidoSemDv(mov.pedido)}
                        {mov.data_pedido && ` | ${formatDateOnlyPtBR(mov.data_pedido)}`}
                      </span>
                    )}
                    {mov.obs_recebimento && (
                      <span className="caixa-historico-obs">
                        Avarias: {mov.obs_recebimento}
                      </span>
                    )}
                    <span className="caixa-historico-meta">
                      Responsável: {mov.nome_resp} ({mov.mat_resp})
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="confirm-actions" style={{ marginTop: "16px" }}>
              <button
                className="btn btn-muted"
                type="button"
                onClick={() => setHistoricoOpen(false)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ══════════════════════════════════════════
          CAMERA SCANNER OVERLAY
         ══════════════════════════════════════════ */}
      {scannerOpen && typeof document !== "undefined" && createPortal(
        <div className="scanner-overlay" role="dialog" aria-modal="true">
          <div className="scanner-dialog surface-enter">
            <div className="scanner-head">
              <h3>Escanear código</h3>
              <div className="scanner-head-actions">
                <button
                  type="button"
                  className="btn btn-muted"
                  onClick={closeScanner}
                >
                  Fechar
                </button>
              </div>
            </div>
            <div className="scanner-video-wrap">
              <video
                ref={scannerVideoRef}
                className="scanner-video"
                autoPlay
                muted
                playsInline
              />
              <div className="scanner-frame">
                <span className="scanner-frame-corner top-left" />
                <span className="scanner-frame-corner top-right" />
                <span className="scanner-frame-corner bottom-left" />
                <span className="scanner-frame-corner bottom-right" />
                <span className="scanner-frame-line" />
              </div>
            </div>
            <p className="scanner-hint">Aponte a câmera para leitura automática.</p>
            {scannerError && <div className="alert error">{scannerError}</div>}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── CaixaCard sub-component ──────────────────────────────────

interface CaixaCardProps {
  box: CaixaTermicaBox;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onAction: () => void;
  onHistory: () => void;
  canAdminEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function CaixaCard({
  box,
  isExpanded,
  onToggleExpanded,
  onAction,
  onHistory,
  canAdminEdit,
  onEdit,
  onDelete
}: CaixaCardProps) {
  const syncDotClass =
    box.sync_status === "synced" ? "synced"
    : box.sync_status === "error" ? "error"
    : "pending";
  const statusLabel = box.status === "disponivel" ? "✅ Disponível" : "🚚 Em Trânsito";
  const dataPedido = formatOptionalDate(box.last_mov_data_pedido);
  const pedidoDisplay = formatPedidoSemDv(box.last_mov_pedido);

  return (
    <div className="caixa-card">
      <div className="caixa-card-header">
        <div className="caixa-card-title-block">
          <span className="caixa-card-codigo">{box.codigo}</span>
          <p className="caixa-card-descricao">{box.descricao}</p>
        </div>
        <span className={`caixa-card-status ${box.status}`}>
          {statusLabel}
        </span>
        <span
          className={`caixa-card-sync-dot ${syncDotClass}`}
          title={
            box.sync_status === "synced" ? "Sincronizado"
            : box.sync_status === "error" ? `Erro: ${box.sync_error ?? "desconhecido"}`
            : "Pendente de sincronização"
          }
        />
        <button
          type="button"
          className="caixa-card-expand-btn"
          onClick={onToggleExpanded}
          aria-expanded={isExpanded}
          title={isExpanded ? "Ocultar detalhes" : "Ver detalhes"}
        >
          {isExpanded ? "Ocultar" : "Detalhes"}
        </button>
      </div>

      {isExpanded && (
        <div className="caixa-card-details">
          <div className="caixa-card-meta-grid">
            <span>Capacidade: <strong>{box.capacidade_litros ? `${box.capacidade_litros} L` : "-"}</strong></span>
            <span>Marca: <strong>{box.marca ?? "-"}</strong></span>
            {box.last_mov_data_hr && (
              <span>Último mov.: <strong>{formatDateTimeBrasilia(box.last_mov_data_hr)}</strong></span>
            )}
            {box.last_mov_placa && <span>Placa: <strong>{box.last_mov_placa}</strong></span>}
            {box.last_mov_nome_resp && (
              <span>Responsável: <strong>{box.last_mov_nome_resp}</strong>{box.last_mov_mat_resp && ` (${box.last_mov_mat_resp})`}</span>
            )}
            {(box.last_mov_rota || box.last_mov_filial_nome || box.last_mov_filial) && (
              <span>
                Rota: <strong>{box.last_mov_rota ?? "Sem rota"}</strong>
                {box.last_mov_filial_nome && ` | ${box.last_mov_filial_nome}`}
                {!box.last_mov_filial_nome && box.last_mov_filial && ` | Filial ${box.last_mov_filial}`}
              </span>
            )}
            {(box.last_mov_pedido || dataPedido) && (
              <span>Pedido: <strong>{pedidoDisplay}</strong>{dataPedido && ` | ${dataPedido}`}</span>
            )}
          </div>

          {box.observacoes && (
            <p className="caixa-card-obs">{box.observacoes}</p>
          )}

          <div className="caixa-card-actions">
            <button type="button" className="btn btn-muted" onClick={onHistory}>
              📋 Histórico
            </button>
            <button type="button" className="btn btn-primary" onClick={onAction}>
              {box.status === "disponivel" ? "🚚 Expedir" : "✅ Receber"}
            </button>
            {canAdminEdit && (
              <>
                <button type="button" className="btn btn-muted" onClick={onEdit}>
                  ✏️ Editar
                </button>
                <button type="button" className="btn btn-muted" onClick={onDelete}>
                  🗑️ Excluir
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
