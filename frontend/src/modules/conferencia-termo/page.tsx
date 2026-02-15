import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent
} from "react";
import type { IScannerControls } from "@zxing/browser";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import {
  buildTermoVolumeKey,
  cleanupExpiredTermoVolumes,
  getLocalVolume,
  getManifestItemsByEtiqueta,
  getManifestMetaLocal,
  getPendingSummary,
  getRouteOverviewLocal,
  getTermoPreferences,
  listUserLocalVolumes,
  saveLocalVolume,
  saveManifestSnapshot,
  saveRouteOverviewLocal,
  saveTermoPreferences
} from "./storage";
import {
  fetchCdOptions,
  fetchManifestBundle,
  fetchManifestMeta,
  fetchRouteOverview,
  fetchVolumeItems,
  finalizeVolume,
  normalizeBarcode,
  openVolume,
  scanBarcode,
  setItemQtd,
  syncPendingTermoVolumes
} from "./sync";
import {
  getDbBarrasByBarcode,
  getDbBarrasMeta,
  upsertDbBarrasCacheRow
} from "../coleta-mercadoria/storage";
import {
  fetchDbBarrasByBarcodeOnline,
  refreshDbBarrasCacheSmart
} from "../coleta-mercadoria/sync";
import type {
  CdOption,
  TermoDivergenciaTipo,
  TermoItemRow,
  TermoLocalItem,
  TermoLocalVolume,
  TermoManifestItemRow,
  TermoRouteOverviewRow,
  TermoVolumeRow,
  TermoModuleProfile
} from "./types";

interface ConferenciaTermoPageProps {
  isOnline: boolean;
  profile: TermoModuleProfile;
}

type TermoRouteStatus = "conferido" | "em_conferencia" | "pendente";

interface TermoRouteGroup {
  rota: string;
  lojas_total: number;
  lojas_conferidas: number;
  etiquetas_total: number;
  etiquetas_conferidas: number;
  status: TermoRouteStatus;
  filiais: TermoRouteOverviewRow[];
  search_blob: string;
}

type DialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
};

const MODULE_DEF = getModuleByKeyOrThrow("conferencia-termo");
const PREFERRED_SYNC_DELAY_MS = 800;

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function todayIsoBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: TermoModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) {
    return Math.trunc(profile.cd_default);
  }
  return parseCdFromLabel(profile.cd_nome);
}

function parsePositiveInteger(value: string, fallback = 1): number {
  const parsed = Number.parseInt(value.replace(/\D/g, ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(parsed);
}

function withDivergencia(item: TermoLocalItem): {
  item: TermoLocalItem;
  divergencia: TermoDivergenciaTipo;
  qtd_falta: number;
  qtd_sobra: number;
} {
  const qtdFalta = Math.max(item.qtd_esperada - item.qtd_conferida, 0);
  const qtdSobra = Math.max(item.qtd_conferida - item.qtd_esperada, 0);
  const divergencia: TermoDivergenciaTipo = qtdFalta > 0 ? "falta" : qtdSobra > 0 ? "sobra" : "correto";
  return { item, divergencia, qtd_falta: qtdFalta, qtd_sobra: qtdSobra };
}

function itemSort(a: TermoLocalItem, b: TermoLocalItem): number {
  const byDesc = a.descricao.localeCompare(b.descricao);
  if (byDesc !== 0) return byDesc;
  return a.coddv - b.coddv;
}

function createLocalVolumeFromRemote(
  profile: TermoModuleProfile,
  volume: TermoVolumeRow,
  items: TermoItemRow[]
): TermoLocalVolume {
  const confDate = volume.conf_date || todayIsoBrasilia();
  const localKey = buildTermoVolumeKey(profile.user_id, volume.cd, confDate, volume.id_etiqueta);
  const localItems: TermoLocalItem[] = items.map((item) => ({
    coddv: item.coddv,
    barras: item.barras ?? null,
    descricao: item.descricao,
    qtd_esperada: item.qtd_esperada,
    qtd_conferida: item.qtd_conferida,
    updated_at: item.updated_at
  }));

  return {
    local_key: localKey,
    user_id: profile.user_id,
    conf_date: confDate,
    cd: volume.cd,
    id_etiqueta: volume.id_etiqueta,
    caixa: volume.caixa,
    pedido: volume.pedido,
    filial: volume.filial,
    filial_nome: volume.filial_nome,
    rota: volume.rota,
    remote_conf_id: volume.conf_id,
    status: volume.status,
    falta_motivo: volume.falta_motivo,
    started_by: volume.started_by,
    started_mat: volume.started_mat,
    started_nome: volume.started_nome,
    started_at: volume.started_at,
    finalized_at: volume.finalized_at,
    updated_at: volume.updated_at,
    is_read_only: volume.is_read_only,
    items: localItems.sort(itemSort),
    pending_snapshot: false,
    pending_finalize: false,
    pending_finalize_reason: null,
    sync_error: null,
    last_synced_at: new Date().toISOString()
  };
}

function createLocalVolumeFromManifest(
  profile: TermoModuleProfile,
  cd: number,
  idEtiqueta: string,
  manifestItems: TermoManifestItemRow[]
): TermoLocalVolume {
  const nowIso = new Date().toISOString();
  const confDate = todayIsoBrasilia();
  const first = manifestItems[0];
  const localKey = buildTermoVolumeKey(profile.user_id, cd, confDate, idEtiqueta);
  const items: TermoLocalItem[] = manifestItems.map((row) => ({
    coddv: row.coddv,
    barras: null,
    descricao: row.descricao,
    qtd_esperada: row.qtd_esperada,
    qtd_conferida: 0,
    updated_at: nowIso
  }));

  return {
    local_key: localKey,
    user_id: profile.user_id,
    conf_date: confDate,
    cd,
    id_etiqueta: idEtiqueta,
    caixa: first?.caixa ?? null,
    pedido: first?.pedido ?? null,
    filial: first?.filial ?? null,
    filial_nome: first?.filial_nome ?? null,
    rota: first?.rota ?? null,
    remote_conf_id: null,
    status: "em_conferencia",
    falta_motivo: null,
    started_by: profile.user_id,
    started_mat: profile.mat || "",
    started_nome: profile.nome || "Usuário",
    started_at: nowIso,
    finalized_at: null,
    updated_at: nowIso,
    is_read_only: false,
    items: items.sort(itemSort),
    pending_snapshot: true,
    pending_finalize: false,
    pending_finalize_reason: null,
    sync_error: null,
    last_synced_at: null
  };
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

function quantityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 8h12" />
      <path d="M12 4v16" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
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

function closeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function flashIcon(on: boolean) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 2h10l-4 7h5l-9 13 2-9H6z" />
      {!on ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function chevronIcon(open: boolean) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {open ? <path d="M6 14l6-6 6 6" /> : <path d="M6 10l6 6 6-6" />}
    </svg>
  );
}

function normalizeRpcErrorMessage(value: string): string {
  if (value.includes("ETIQUETA_NAO_ENCONTRADA")) return "Etiqueta não encontrada na base do dia.";
  if (value.includes("VOLUME_EM_USO")) return "Este volume já está em conferência por outro usuário.";
  if (value.includes("VOLUME_JA_CONFERIDO_OUTRO_USUARIO")) return "Volume já conferido por outro usuário hoje.";
  if (value.includes("PRODUTO_FORA_DO_VOLUME")) return "Produto fora do volume em conferência.";
  if (value.includes("BARRAS_NAO_ENCONTRADA")) return "Código de barras não encontrado na base.";
  if (value.includes("SOBRA_PENDENTE")) return "Existem sobras. Corrija antes de finalizar.";
  if (value.includes("FALTA_MOTIVO_OBRIGATORIO")) return "Informe o motivo da falta para finalizar.";
  if (value.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Entre novamente.";
  if (value.includes("CD_SEM_ACESSO")) return "Usuário sem acesso ao CD informado.";
  if (value.includes("BASE_TERMO_VAZIA")) return "A base do termo está vazia para este CD.";
  return value;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function resolveRouteStatus(conferidas: number, total: number): TermoRouteStatus {
  if (total > 0 && conferidas >= total) return "conferido";
  if (conferidas > 0) return "em_conferencia";
  return "pendente";
}

function routeStatusLabel(status: TermoRouteStatus): string {
  if (status === "conferido") return "Conferido";
  if (status === "em_conferencia") return "Em conferência";
  return "Pendente";
}

function routeStatusClass(status: TermoRouteStatus): "correto" | "andamento" | "falta" {
  if (status === "conferido") return "correto";
  if (status === "em_conferencia") return "andamento";
  return "falta";
}

function isBrowserDesktop(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(min-width: 980px)").matches;
}

function searchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.7-3.7" />
    </svg>
  );
}

export default function ConferenciaTermoPage({ isOnline, profile }: ConferenciaTermoPageProps) {
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerTrackRef = useRef<MediaStreamTrack | null>(null);
  const scannerTorchModeRef = useRef<"none" | "controls" | "track">("none");
  const etiquetaRef = useRef<HTMLInputElement | null>(null);
  const barrasRef = useRef<HTMLInputElement | null>(null);

  const [isDesktop, setIsDesktop] = useState<boolean>(() => isBrowserDesktop());
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [manifestReady, setManifestReady] = useState(false);
  const [manifestInfo, setManifestInfo] = useState<string>("");
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingErrors, setPendingErrors] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [routeRows, setRouteRows] = useState<TermoRouteOverviewRow[]>([]);

  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [cdAtivo, setCdAtivo] = useState<number | null>(null);

  const [etiquetaInput, setEtiquetaInput] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [multiploInput, setMultiploInput] = useState("1");

  const [activeVolume, setActiveVolume] = useState<TermoLocalVolume | null>(null);
  const [expandedCoddv, setExpandedCoddv] = useState<number | null>(null);
  const [editingCoddv, setEditingCoddv] = useState<number | null>(null);
  const [editQtdInput, setEditQtdInput] = useState("0");

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<"etiqueta" | "barras">("barras");
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  const [showRoutesModal, setShowRoutesModal] = useState(false);
  const [routeSearchInput, setRouteSearchInput] = useState("");
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [finalizeMotivo, setFinalizeMotivo] = useState("");
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const [busyManifest, setBusyManifest] = useState(false);
  const [busyOpenVolume, setBusyOpenVolume] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [busyFinalize, setBusyFinalize] = useState(false);
  const [dialogState, setDialogState] = useState<DialogState | null>(null);

  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const isGlobalAdmin = useMemo(() => profile.role === "admin" && profile.cd_default == null, [profile]);
  const fixedCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const currentCd = isGlobalAdmin ? cdAtivo : fixedCd;
  const canEditActiveVolume = Boolean(
    activeVolume
    && !activeVolume.is_read_only
    && activeVolume.started_by === profile.user_id
  );

  const cameraSupported = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }, []);

  const groupedItems = useMemo(() => {
    const empty = {
      falta: [] as Array<ReturnType<typeof withDivergencia>>,
      sobra: [] as Array<ReturnType<typeof withDivergencia>>,
      correto: [] as Array<ReturnType<typeof withDivergencia>>
    };
    if (!activeVolume) return empty;

    const mapped = activeVolume.items.map((item) => withDivergencia(item));
    for (const row of mapped) {
      if (row.divergencia === "falta") empty.falta.push(row);
      else if (row.divergencia === "sobra") empty.sobra.push(row);
      else empty.correto.push(row);
    }

    const sorter = (a: ReturnType<typeof withDivergencia>, b: ReturnType<typeof withDivergencia>) =>
      itemSort(a.item, b.item);
    empty.falta.sort(sorter);
    empty.sobra.sort(sorter);
    empty.correto.sort(sorter);

    return empty;
  }, [activeVolume]);

  const divergenciaTotals = useMemo(() => {
    if (!activeVolume) {
      return { falta: 0, sobra: 0, correto: 0 };
    }
    return {
      falta: groupedItems.falta.length,
      sobra: groupedItems.sobra.length,
      correto: groupedItems.correto.length
    };
  }, [activeVolume, groupedItems]);

  const routeGroups = useMemo<TermoRouteGroup[]>(() => {
    if (routeRows.length === 0) return [];

    const grouped = new Map<string, Omit<TermoRouteGroup, "search_blob">>();

    for (const row of routeRows) {
      const rota = (row.rota || "SEM ROTA").trim() || "SEM ROTA";
      const filialStatus = resolveRouteStatus(row.conferidas, row.total_etiquetas);
      const current = grouped.get(rota);

      if (!current) {
        grouped.set(rota, {
          rota,
          lojas_total: 1,
          lojas_conferidas: filialStatus === "conferido" ? 1 : 0,
          etiquetas_total: row.total_etiquetas,
          etiquetas_conferidas: row.conferidas,
          status: filialStatus,
          filiais: [row]
        });
        continue;
      }

      current.lojas_total += 1;
      current.lojas_conferidas += filialStatus === "conferido" ? 1 : 0;
      current.etiquetas_total += row.total_etiquetas;
      current.etiquetas_conferidas += row.conferidas;
      current.status = resolveRouteStatus(current.etiquetas_conferidas, current.etiquetas_total);
      current.filiais.push(row);
    }

    return Array.from(grouped.values())
      .map((group) => {
        const filiaisOrdenadas = [...group.filiais].sort((a, b) => {
          const byFilial = (a.filial ?? Number.MAX_SAFE_INTEGER) - (b.filial ?? Number.MAX_SAFE_INTEGER);
          if (byFilial !== 0) return byFilial;
          return (a.filial_nome ?? "").localeCompare(b.filial_nome ?? "", "pt-BR");
        });

        const searchBlob = normalizeSearchText([
          group.rota,
          routeStatusLabel(group.status),
          `${group.lojas_conferidas}/${group.lojas_total}`,
          `${group.etiquetas_conferidas}/${group.etiquetas_total}`,
          ...filiaisOrdenadas.map((item) => [
            item.filial_nome ?? "",
            item.filial != null ? String(item.filial) : "",
            `${item.conferidas}/${item.total_etiquetas}`,
            routeStatusLabel(resolveRouteStatus(item.conferidas, item.total_etiquetas))
          ].join(" "))
        ].join(" "));

        return {
          ...group,
          filiais: filiaisOrdenadas,
          search_blob: searchBlob
        };
      })
      .sort((a, b) => a.rota.localeCompare(b.rota, "pt-BR"));
  }, [routeRows]);

  const filteredRouteGroups = useMemo(() => {
    const query = normalizeSearchText(routeSearchInput);
    if (!query) return routeGroups;
    return routeGroups.filter((group) => group.search_blob.includes(query));
  }, [routeGroups, routeSearchInput]);

  const focusBarras = useCallback(() => {
    window.requestAnimationFrame(() => {
      barrasRef.current?.focus();
    });
  }, []);

  const showDialog = useCallback((payload: DialogState) => {
    setDialogState(payload);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogState(null);
  }, []);

  const refreshPendingState = useCallback(async () => {
    const pending = await getPendingSummary(profile.user_id);
    setPendingCount(pending.pending_count);
    setPendingErrors(pending.errors_count);
  }, [profile.user_id]);

  const persistPreferences = useCallback(async (next: {
    prefer_offline_mode?: boolean;
    multiplo_padrao?: number;
    cd_ativo?: number | null;
  }) => {
    const current = await getTermoPreferences(profile.user_id);
    await saveTermoPreferences(profile.user_id, {
      prefer_offline_mode: next.prefer_offline_mode ?? current.prefer_offline_mode,
      multiplo_padrao: next.multiplo_padrao ?? current.multiplo_padrao,
      cd_ativo: next.cd_ativo ?? current.cd_ativo
    });
  }, [profile.user_id]);

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

  const stopScanner = useCallback(() => {
    const controls = scannerControlsRef.current;
    const activeTrack = scannerTrackRef.current ?? resolveScannerTrack();
    if (controls) {
      if (controls.switchTorch && torchEnabled && scannerTorchModeRef.current === "controls") {
        void controls.switchTorch(false).catch(() => {
          // Ignore unsupported torch shutdown.
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
            // Ignore unsupported torch shutdown.
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
    setTorchEnabled(false);
    setTorchSupported(false);
  }, [resolveScannerTrack, torchEnabled]);

  const closeScanner = useCallback(() => {
    stopScanner();
    setScannerOpen(false);
    setScannerError(null);
    focusBarras();
  }, [focusBarras, stopScanner]);

  const openScannerFor = useCallback((target: "etiqueta" | "barras") => {
    if (!cameraSupported) {
      setErrorMessage("Câmera não disponível neste dispositivo.");
      return;
    }
    setScannerTarget(target);
    setScannerError(null);
    setScannerOpen(true);
    setTorchEnabled(false);
    setTorchSupported(false);
  }, [cameraSupported]);

  const runPendingSync = useCallback(async (silent = false) => {
    if (!isOnline) return;
    if (busySync) return;
    setBusySync(true);
    if (!silent) {
      setStatusMessage(null);
      setErrorMessage(null);
    }
    try {
      const result = await syncPendingTermoVolumes(profile.user_id);
      await refreshPendingState();
      if (activeVolume) {
        const refreshed = await getLocalVolume(profile.user_id, activeVolume.cd, activeVolume.conf_date, activeVolume.id_etiqueta);
        if (refreshed) setActiveVolume(refreshed);
      }
      if (!silent) {
        if (result.failed > 0) {
          setErrorMessage(`${result.failed} pendência(s) do Termo falharam na sincronização.`);
        } else if (result.processed > 0) {
          setStatusMessage(`Sincronização concluída (${result.synced} pendência(s) processada(s)).`);
        } else {
          setStatusMessage("Sem pendências de conferência para sincronizar.");
        }
      }
    } catch (error) {
      if (!silent) {
        const message = error instanceof Error ? error.message : "Falha na sincronização.";
        setErrorMessage(normalizeRpcErrorMessage(message));
      }
    } finally {
      setBusySync(false);
    }
  }, [activeVolume, busySync, isOnline, profile.user_id, refreshPendingState]);

  const prepareOfflineManifest = useCallback(async (forceRefresh: boolean) => {
    if (currentCd == null) throw new Error("Selecione um CD antes de trabalhar offline.");

    setBusyManifest(true);
    setProgressMessage(null);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const [localMeta, localBarrasMeta] = await Promise.all([
        getManifestMetaLocal(profile.user_id, currentCd),
        getDbBarrasMeta()
      ]);

      if (!isOnline) {
        if (!localMeta || localMeta.row_count <= 0) {
          throw new Error("Sem base local do Termo. Conecte-se e sincronize antes de usar offline.");
        }
        if (localBarrasMeta.row_count <= 0) {
          throw new Error("Sem base local de barras. Conecte-se e ative o modo offline para sincronizar.");
        }
        const localRoutes = await getRouteOverviewLocal(profile.user_id, currentCd);
        setRouteRows(localRoutes);
        setManifestReady(true);
        setManifestInfo(
          `Base local pronta: Termo ${localMeta.row_count} item(ns) | Barras ${localBarrasMeta.row_count} item(ns).`
        );
        return;
      }

      const remoteMeta = await fetchManifestMeta(currentCd);
      const sameHash = localMeta && localMeta.manifest_hash === remoteMeta.manifest_hash;
      const shouldDownload = forceRefresh || !sameHash || (localMeta?.row_count ?? 0) <= 0;
      let termoRowCount = remoteMeta.row_count;

      if (shouldDownload) {
        const bundle = await fetchManifestBundle(currentCd, (step, page, rows) => {
          if (step === "items") {
            setProgressMessage(`Atualizando manifesto do Termo... itens página ${page} | linhas ${rows}`);
          } else {
            setProgressMessage(`Atualizando rotas/filiais... ${rows} rota(s).`);
          }
        }, { includeBarras: false });

        await saveManifestSnapshot({
          user_id: profile.user_id,
          cd: currentCd,
          meta: bundle.meta,
          items: bundle.items,
          barras: [],
          routes: bundle.routes
        });

        setRouteRows(bundle.routes);
        termoRowCount = bundle.meta.row_count;
      } else {
        const routes = await fetchRouteOverview(currentCd);
        await saveRouteOverviewLocal(profile.user_id, currentCd, routes);
        setRouteRows(routes);
      }

      const barrasSync = await refreshDbBarrasCacheSmart((pages, rows) => {
        setProgressMessage(`Atualizando base de barras... página ${pages} | linhas ${rows}`);
      });

      setManifestInfo(
        `Base offline pronta: Termo ${termoRowCount} item(ns) | Barras ${barrasSync.total} item(ns).`
      );

      setManifestReady(true);
      setStatusMessage("Base do Termo pronta para trabalho offline.");
    } finally {
      setBusyManifest(false);
      setProgressMessage(null);
    }
  }, [currentCd, isOnline, profile.user_id]);

  const applyVolumeUpdate = useCallback(async (nextVolume: TermoLocalVolume, focusInput = true) => {
    await saveLocalVolume(nextVolume);
    setActiveVolume(nextVolume);
    await refreshPendingState();
    if (focusInput) focusBarras();
  }, [focusBarras, refreshPendingState]);

  const openVolumeFromEtiqueta = useCallback(async (rawEtiqueta: string) => {
    const etiqueta = rawEtiqueta.trim();
    if (!etiqueta) {
      setErrorMessage("Informe a etiqueta para abrir o volume.");
      return;
    }
    if (currentCd == null) {
      setErrorMessage("CD não definido para esta conferência.");
      return;
    }

    setBusyOpenVolume(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const today = todayIsoBrasilia();

      if (preferOfflineMode) {
        if (!manifestReady) {
          await prepareOfflineManifest(false);
        }

        const existingToday = await getLocalVolume(profile.user_id, currentCd, today, etiqueta);
        if (existingToday) {
          if (existingToday.status !== "em_conferencia") {
            showDialog({
              title: "Conferência já finalizada",
              message: "Este volume já foi finalizado por você hoje. Deseja abrir em modo leitura?",
              confirmLabel: "Abrir leitura",
              cancelLabel: "Cancelar",
              onConfirm: () => {
                setActiveVolume(existingToday);
                setExpandedCoddv(null);
                setEditingCoddv(null);
                setEditQtdInput("0");
                setStatusMessage("Volume aberto em modo leitura.");
                closeDialog();
              }
            });
            return;
          }
          setActiveVolume(existingToday);
          setExpandedCoddv(null);
          setEditingCoddv(null);
          setEditQtdInput("0");
          setStatusMessage("Volume retomado do cache local.");
          return;
        }

        if (isOnline) {
          const remoteVolume = await openVolume(etiqueta, currentCd);
          const remoteItems = await fetchVolumeItems(remoteVolume.conf_id);
          const localVolume = createLocalVolumeFromRemote(profile, remoteVolume, remoteItems);
          await saveLocalVolume(localVolume);
          setActiveVolume(localVolume);
          setStatusMessage(remoteVolume.is_read_only ? "Volume já finalizado. Aberto em leitura." : "Volume aberto para conferência.");
          return;
        }

        const manifestItems = await getManifestItemsByEtiqueta(profile.user_id, currentCd, etiqueta);
        if (!manifestItems.length) {
          showDialog({
            title: "Etiqueta inválida",
            message: "Etiqueta não encontrada na base local do Termo para este CD."
          });
          return;
        }

        const offlineVolume = createLocalVolumeFromManifest(profile, currentCd, etiqueta, manifestItems);
        await saveLocalVolume(offlineVolume);
        setActiveVolume(offlineVolume);
        setStatusMessage("Volume aberto offline. Pendências serão sincronizadas ao voltar a conexão.");
        return;
      }

      if (!isOnline) {
        setErrorMessage("Sem internet no momento. Ative 'Trabalhar offline' para usar a base local.");
        return;
      }

      const remoteVolume = await openVolume(etiqueta, currentCd);
      const remoteItems = await fetchVolumeItems(remoteVolume.conf_id);
      const localVolume = createLocalVolumeFromRemote(profile, remoteVolume, remoteItems);
      await saveLocalVolume(localVolume);

      if (remoteVolume.is_read_only) {
        showDialog({
          title: "Volume já conferido",
          message: "Este volume já foi finalizado por você hoje. Deseja abrir em modo leitura?",
          confirmLabel: "Abrir leitura",
          cancelLabel: "Cancelar",
          onConfirm: () => {
            setActiveVolume(localVolume);
            closeDialog();
          }
        });
        return;
      }

      setActiveVolume(localVolume);
      setStatusMessage("Volume aberto para conferência.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao abrir volume.";
      setErrorMessage(normalizeRpcErrorMessage(message));
    } finally {
      setBusyOpenVolume(false);
      setExpandedCoddv(null);
      setEditingCoddv(null);
      setEditQtdInput("0");
      setEtiquetaInput(etiqueta);
      focusBarras();
    }
  }, [
    closeDialog,
    currentCd,
    focusBarras,
    isOnline,
    manifestReady,
    preferOfflineMode,
    prepareOfflineManifest,
    profile,
    showDialog
  ]);

  const updateItemQtyLocal = useCallback(async (coddv: number, qtd: number, barras: string | null = null) => {
    if (!activeVolume) return;
    const nowIso = new Date().toISOString();
    const nextItems = activeVolume.items.map((item) => (
      item.coddv === coddv
        ? {
            ...item,
            barras: barras ?? item.barras ?? null,
            qtd_conferida: Math.max(0, Math.trunc(qtd)),
            updated_at: nowIso
          }
        : item
    ));

    const nextVolume: TermoLocalVolume = {
      ...activeVolume,
      items: nextItems.sort(itemSort),
      pending_snapshot: true,
      updated_at: nowIso,
      sync_error: null
    };
    await applyVolumeUpdate(nextVolume);
  }, [activeVolume, applyVolumeUpdate]);

  const resolveBarcodeProduct = useCallback(async (barras: string) => {
    const normalized = normalizeBarcode(barras);
    if (!normalized) return null;

    const local = await getDbBarrasByBarcode(normalized);
    if (local) return local;

    if (!isOnline) return null;

    try {
      const online = await fetchDbBarrasByBarcodeOnline(normalized);
      if (online) {
        await upsertDbBarrasCacheRow(online);
      }
      return online;
    } catch {
      return null;
    }
  }, [isOnline]);

  const handleCollectBarcode = useCallback(async (value: string) => {
    if (!activeVolume) {
      setErrorMessage("Abra um volume para iniciar a conferência.");
      return;
    }
    if (activeVolume.is_read_only || !canEditActiveVolume) {
      setErrorMessage("Volume em modo leitura. Não é possível alterar.");
      return;
    }

    const barras = normalizeBarcode(value);
    if (!barras) return;

    const qtd = parsePositiveInteger(multiploInput, 1);
    let produtoRegistrado = "";
    let barrasRegistrada = barras;
    let registroRemoto = false;
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      if (preferOfflineMode || !isOnline || !activeVolume.remote_conf_id) {
        const lookup = await resolveBarcodeProduct(barras);
        if (!lookup) {
          showDialog({
            title: "Código não encontrado",
            message: "Código de barras não encontrado na base local."
          });
          return;
        }
        const target = activeVolume.items.find((item) => item.coddv === lookup.coddv);
        if (!target) {
          const produtoNome = lookup.descricao?.trim() || `CODDV ${lookup.coddv}`;
          showDialog({
            title: "Produto fora do volume",
            message: `Produto "${produtoNome}" não faz parte do volume em conferência.`,
            confirmLabel: "OK"
          });
          return;
        }
        produtoRegistrado = target.descricao;
        barrasRegistrada = lookup.barras || barras;
        await updateItemQtyLocal(target.coddv, target.qtd_conferida + qtd, barrasRegistrada);
        if (isOnline) {
          void runPendingSync(true);
        }
      } else {
        const updated = await scanBarcode(activeVolume.remote_conf_id, barras, qtd);
        produtoRegistrado = updated.descricao;
        barrasRegistrada = updated.barras ?? barras;
        registroRemoto = true;
        const nowIso = new Date().toISOString();
        const nextItems = activeVolume.items.map((item) => (
          item.coddv === updated.coddv
            ? {
                ...item,
                barras: updated.barras ?? barras,
                qtd_conferida: updated.qtd_conferida,
                qtd_esperada: updated.qtd_esperada,
                updated_at: updated.updated_at
              }
            : item
        ));
        const nextVolume: TermoLocalVolume = {
          ...activeVolume,
          items: nextItems.sort(itemSort),
          updated_at: nowIso,
          pending_snapshot: false,
          sync_error: null,
          last_synced_at: nowIso
        };
        await applyVolumeUpdate(nextVolume);
      }

      setBarcodeInput("");
      setMultiploInput("1");
      await persistPreferences({ multiplo_padrao: 1 });
      const descricao = produtoRegistrado || "Produto";
      const baseMessage = `${descricao} | Barras: ${barrasRegistrada} | +${qtd}`;
      setStatusMessage(
        registroRemoto
          ? `Produto registrado na conferência: ${baseMessage}`
          : `Produto registrado localmente: ${baseMessage}`
      );
      focusBarras();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao registrar leitura.";
      if (message.includes("PRODUTO_FORA_DO_VOLUME")) {
        const lookup = await resolveBarcodeProduct(barras);
        const produtoNome = lookup?.descricao?.trim() || `Barras ${barras}`;
        showDialog({
          title: "Produto fora do volume",
          message: `Produto "${produtoNome}" não faz parte do volume em conferência.`,
          confirmLabel: "OK"
        });
        return;
      }
      setErrorMessage(normalizeRpcErrorMessage(message));
    }
  }, [
    activeVolume,
    applyVolumeUpdate,
    canEditActiveVolume,
    focusBarras,
    isOnline,
    multiploInput,
    persistPreferences,
    preferOfflineMode,
    resolveBarcodeProduct,
    runPendingSync,
    showDialog,
    updateItemQtyLocal
  ]);

  const handleSaveItemEdit = useCallback(async (coddv: number) => {
    if (!activeVolume) return;
    if (!canEditActiveVolume) return;
    const qtd = parsePositiveInteger(editQtdInput, 0);

    try {
      if (preferOfflineMode || !isOnline || !activeVolume.remote_conf_id) {
        await updateItemQtyLocal(coddv, qtd);
        if (isOnline) void runPendingSync(true);
      } else {
        const updated = await setItemQtd(activeVolume.remote_conf_id, coddv, qtd);
        const nowIso = new Date().toISOString();
        const nextItems = activeVolume.items.map((item) => (
          item.coddv === updated.coddv
            ? {
                ...item,
                barras: updated.barras ?? item.barras ?? null,
                qtd_conferida: updated.qtd_conferida,
                qtd_esperada: updated.qtd_esperada,
                updated_at: updated.updated_at
              }
            : item
        ));
        const nextVolume: TermoLocalVolume = {
          ...activeVolume,
          items: nextItems.sort(itemSort),
          updated_at: nowIso,
          pending_snapshot: false,
          sync_error: null,
          last_synced_at: nowIso
        };
        await applyVolumeUpdate(nextVolume);
      }
      setEditingCoddv(null);
      setEditQtdInput("0");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao salvar item.";
      setErrorMessage(normalizeRpcErrorMessage(message));
    }
  }, [
    activeVolume,
    applyVolumeUpdate,
    canEditActiveVolume,
    editQtdInput,
    isOnline,
    preferOfflineMode,
    runPendingSync,
    updateItemQtyLocal
  ]);

  const requestResetItem = useCallback((coddv: number) => {
    if (!activeVolume || !canEditActiveVolume) return;
    const item = activeVolume.items.find((row) => row.coddv === coddv);
    if (!item) return;
    if (item.qtd_conferida <= 0) return;

    showDialog({
      title: "Limpar conferência do item",
      message: `O produto "${item.descricao}" está com quantidade ${item.qtd_conferida}. Ao confirmar, a quantidade será alterada para 0. Deseja continuar?`,
      confirmLabel: "Limpar",
      cancelLabel: "Cancelar",
      onConfirm: () => {
        void (async () => {
          try {
            if (preferOfflineMode || !isOnline || !activeVolume.remote_conf_id) {
              await updateItemQtyLocal(coddv, 0);
              if (isOnline) void runPendingSync(true);
            } else {
              const updated = await setItemQtd(activeVolume.remote_conf_id, coddv, 0);
              const nowIso = new Date().toISOString();
              const nextItems = activeVolume.items.map((row) => (
                row.coddv === updated.coddv
                  ? {
                      ...row,
                      barras: updated.barras ?? row.barras ?? null,
                      qtd_conferida: updated.qtd_conferida,
                      qtd_esperada: updated.qtd_esperada,
                      updated_at: updated.updated_at
                    }
                  : row
              ));
              const nextVolume: TermoLocalVolume = {
                ...activeVolume,
                items: nextItems.sort(itemSort),
                updated_at: nowIso,
                pending_snapshot: false,
                sync_error: null,
                last_synced_at: nowIso
              };
              await applyVolumeUpdate(nextVolume);
            }
            setEditingCoddv(null);
            setEditQtdInput("0");
          } catch (error) {
            const message = error instanceof Error ? error.message : "Falha ao limpar item.";
            setErrorMessage(normalizeRpcErrorMessage(message));
          } finally {
            closeDialog();
          }
        })();
      }
    });
  }, [
    activeVolume,
    applyVolumeUpdate,
    canEditActiveVolume,
    closeDialog,
    isOnline,
    preferOfflineMode,
    runPendingSync,
    showDialog,
    updateItemQtyLocal
  ]);

  const handleFinalizeVolume = useCallback(async () => {
    if (!activeVolume) return;
    if (!canEditActiveVolume) return;

    setFinalizeError(null);
    const sobra = divergenciaTotals.sobra;
    const falta = divergenciaTotals.falta;

    if (sobra > 0) {
      setFinalizeError("Existem sobras no volume. Corrija antes de finalizar.");
      return;
    }

    const motivo = finalizeMotivo.trim();
    if (falta > 0 && !motivo) {
      setFinalizeError("Informe o motivo de falta para concluir.");
      return;
    }

    setBusyFinalize(true);
    try {
      if (preferOfflineMode || !isOnline || !activeVolume.remote_conf_id) {
        const nowIso = new Date().toISOString();
        const nextStatus = falta > 0 ? "finalizado_falta" : "finalizado_ok";
        const nextVolume: TermoLocalVolume = {
          ...activeVolume,
          status: nextStatus,
          falta_motivo: falta > 0 ? motivo : null,
          finalized_at: nowIso,
          is_read_only: true,
          pending_snapshot: true,
          pending_finalize: true,
          pending_finalize_reason: falta > 0 ? motivo : null,
          updated_at: nowIso,
          sync_error: null
        };
        await applyVolumeUpdate(nextVolume, false);
        setActiveVolume(nextVolume);
        if (isOnline) void runPendingSync(true);
        setStatusMessage("Conferência finalizada localmente. Sincronização pendente.");
      } else {
        const finalized = await finalizeVolume(activeVolume.remote_conf_id, falta > 0 ? motivo : null);
        const nowIso = new Date().toISOString();
        const nextStatus =
          finalized.status === "finalizado_ok" || finalized.status === "finalizado_falta"
            ? finalized.status
            : activeVolume.status;
        const nextVolume: TermoLocalVolume = {
          ...activeVolume,
          status: nextStatus,
          falta_motivo: finalized.falta_motivo,
          finalized_at: finalized.finalized_at,
          is_read_only: true,
          pending_snapshot: false,
          pending_finalize: false,
          pending_finalize_reason: null,
          updated_at: nowIso,
          sync_error: null,
          last_synced_at: nowIso
        };
        await applyVolumeUpdate(nextVolume, false);
        setActiveVolume(nextVolume);
        setStatusMessage("Conferência finalizada com sucesso.");
      }
      setShowFinalizeModal(false);
      setFinalizeMotivo("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao finalizar.";
      setFinalizeError(normalizeRpcErrorMessage(message));
    } finally {
      setBusyFinalize(false);
    }
  }, [
    activeVolume,
    applyVolumeUpdate,
    canEditActiveVolume,
    divergenciaTotals.falta,
    divergenciaTotals.sobra,
    finalizeMotivo,
    isOnline,
    preferOfflineMode,
    runPendingSync
  ]);

  const syncRouteOverview = useCallback(async () => {
    if (currentCd == null) {
      setRouteRows([]);
      return;
    }
    if (!isOnline) {
      const local = await getRouteOverviewLocal(profile.user_id, currentCd);
      setRouteRows(local);
      return;
    }

    try {
      const rows = await fetchRouteOverview(currentCd);
      setRouteRows(rows);
      await saveRouteOverviewLocal(profile.user_id, currentCd, rows);
    } catch {
      const fallback = await getRouteOverviewLocal(profile.user_id, currentCd);
      setRouteRows(fallback);
    }
  }, [currentCd, isOnline, profile.user_id]);

  const openRoutesModal = useCallback(async () => {
    setRouteSearchInput("");
    setExpandedRoute(null);
    setShowRoutesModal(true);
    await syncRouteOverview();
  }, [syncRouteOverview]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 980px)");
    const onChange = () => setIsDesktop(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadInitial = async () => {
      try {
        await cleanupExpiredTermoVolumes(profile.user_id);
        const prefs = await getTermoPreferences(profile.user_id);
        if (cancelled) return;
        setPreferOfflineMode(prefs.prefer_offline_mode);
        setMultiploInput(String(Math.max(1, prefs.multiplo_padrao)));

        if (isGlobalAdmin) {
          if (isOnline) {
            const options = await fetchCdOptions();
            if (cancelled) return;
            setCdOptions(options);
            const preferred = prefs.cd_ativo ?? options[0]?.cd ?? null;
            setCdAtivo(preferred);
          } else {
            setCdAtivo(prefs.cd_ativo ?? null);
          }
        } else {
          setCdAtivo(fixedCd);
        }

        await refreshPendingState();
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Falha ao carregar módulo Termo.";
        setErrorMessage(normalizeRpcErrorMessage(message));
      }
    };

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [fixedCd, isGlobalAdmin, isOnline, profile.user_id, refreshPendingState]);

  useEffect(() => {
    if (currentCd == null) return;
    void persistPreferences({ cd_ativo: currentCd });
  }, [currentCd, persistPreferences]);

  useEffect(() => {
    if (currentCd == null) {
      setManifestReady(false);
      setManifestInfo("");
      setRouteRows([]);
      setActiveVolume(null);
      return;
    }

    let cancelled = false;
    const loadLocalContext = async () => {
      const [localMeta, localRoutes, volumes, barrasMeta] = await Promise.all([
        getManifestMetaLocal(profile.user_id, currentCd),
        getRouteOverviewLocal(profile.user_id, currentCd),
        listUserLocalVolumes(profile.user_id),
        getDbBarrasMeta()
      ]);
      if (cancelled) return;

      setManifestReady(Boolean(localMeta && localMeta.row_count > 0));
      setManifestInfo(
        localMeta
          ? `Base local: Termo ${localMeta.row_count} item(ns) | Barras ${barrasMeta.row_count} item(ns).`
          : `Sem base local do Termo. Barras local: ${barrasMeta.row_count} item(ns).`
      );
      setRouteRows(localRoutes);

      const today = todayIsoBrasilia();
      const latestToday = volumes.find((row) => row.cd === currentCd && row.conf_date === today);
      if (latestToday) {
        setActiveVolume(latestToday);
      } else {
        setActiveVolume(null);
      }
    };

    void loadLocalContext();
    return () => {
      cancelled = true;
    };
  }, [currentCd, profile.user_id]);

  useEffect(() => {
    void refreshPendingState();
  }, [refreshPendingState]);

  useEffect(() => {
    if (!isOnline) return;
    if (pendingCount <= 0) return;
    const timer = window.setTimeout(() => {
      void runPendingSync(true);
    }, PREFERRED_SYNC_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isOnline, pendingCount, runPendingSync]);

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
            video: { facingMode: { ideal: "environment" } }
          },
          videoEl,
          (result, error) => {
            if (cancelled) return;
            if (result) {
              const scanned = normalizeBarcode(result.getText() ?? "");
              if (!scanned) return;
              setScannerOpen(false);
              stopScanner();
              setScannerError(null);
              if (scannerTarget === "etiqueta") {
                setEtiquetaInput(scanned);
                void openVolumeFromEtiqueta(scanned);
              } else {
                setBarcodeInput(scanned);
                void handleCollectBarcode(scanned);
              }
              return;
            }

            const errorName = (error as { name?: string } | null)?.name;
            if (error && errorName !== "NotFoundException" && errorName !== "ChecksumException" && errorName !== "FormatException") {
              setScannerError("Não foi possível ler o código. Ajuste foco/distância e tente novamente.");
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
          if (track) scannerTrackRef.current = track;
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
        setScannerError(error instanceof Error ? error.message : "Falha ao iniciar câmera.");
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      if (torchProbeTimer != null) window.clearTimeout(torchProbeTimer);
      stopScanner();
    };
  }, [handleCollectBarcode, openVolumeFromEtiqueta, resolveScannerTrack, scannerOpen, scannerTarget, stopScanner, supportsTrackTorch]);

  const toggleTorch = async () => {
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
          throw new Error("Flash indisponível");
        }
        await trackWithConstraints.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      }
      setTorchEnabled(next);
      setScannerError(null);
    } catch {
      setScannerError("Não foi possível alternar o flash.");
    }
  };

  const onSubmitEtiqueta = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await openVolumeFromEtiqueta(etiquetaInput);
  };

  const onSubmitBarras = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await handleCollectBarcode(barcodeInput);
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

  const onBarcodeKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void handleCollectBarcode(barcodeInput);
  };

  const handleToggleOffline = async () => {
    const next = !preferOfflineMode;
    if (next) {
      try {
        await prepareOfflineManifest(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao preparar base offline.";
        setErrorMessage(normalizeRpcErrorMessage(message));
        setPreferOfflineMode(false);
        await persistPreferences({ prefer_offline_mode: false });
        return;
      }
    }
    setPreferOfflineMode(next);
    await persistPreferences({ prefer_offline_mode: next });
  };

  const requestFinalize = () => {
    if (!activeVolume) return;
    setFinalizeError(null);
    setFinalizeMotivo(activeVolume.falta_motivo ?? "");
    setShowFinalizeModal(true);
  };

  const showOnlineBadge = (
    <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
      {isOnline ? "🟢 Online" : "🔴 Offline"}
    </span>
  );

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
            <span className="module-user-greeting">Olá, {displayUserName}</span>
            {showOnlineBadge}
          </div>
        </div>

        <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
          <span className="module-icon" aria-hidden="true">
            <ModuleIcon name={MODULE_DEF.icon} />
          </span>
          <span className="module-title">{MODULE_DEF.title}</span>
        </div>
      </header>

      <section className="modules-shell termo-shell">
        <div className="termo-head">
          <h2>Auditoria de Termo por Etiqueta</h2>
          <p>Para trabalhar offline, sincronize a base do Termo deste CD.</p>
          {manifestInfo ? <p className="termo-meta-line">{manifestInfo}</p> : null}
        </div>

        <div className="termo-actions-row">
          <span className="coleta-pending-pill">
            Pendentes: {pendingCount}
            {pendingErrors > 0 ? ` | Erros: ${pendingErrors}` : ""}
          </span>

          <button type="button" className="btn btn-muted termo-sync-btn" onClick={() => void runPendingSync()} disabled={busySync}>
            <span aria-hidden="true">{refreshIcon()}</span>
            {busySync ? "Sincronizando..." : "Sincronizar agora"}
          </button>

          {!isDesktop ? (
            <button
              type="button"
              className={`btn btn-muted termo-offline-toggle${preferOfflineMode ? " is-active" : ""}`}
              onClick={() => void handleToggleOffline()}
              disabled={busyManifest}
            >
              {preferOfflineMode ? "📦 Offline ativo" : "📶 Trabalhar offline"}
            </button>
          ) : null}

          <button type="button" className="btn btn-muted termo-route-btn" onClick={() => void openRoutesModal()}>
            <span aria-hidden="true">{listIcon()}</span>
            Rota/Filial
          </button>
        </div>

        {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
        {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
        {progressMessage ? <div className="alert success">{progressMessage}</div> : null}

        {isGlobalAdmin ? (
          <div className="termo-cd-selector">
            <label>
              CD
              <select
                value={cdAtivo ?? ""}
                onChange={(event) => setCdAtivo(Number.parseInt(event.target.value, 10))}
              >
                <option value="" disabled>Selecione o CD</option>
                {cdOptions.map((option) => (
                  <option key={option.cd} value={option.cd}>
                    {option.cd_nome || `CD ${String(option.cd).padStart(2, "0")}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <form className="termo-form termo-open-form" onSubmit={onSubmitEtiqueta}>
          <h3>Abertura de volume</h3>
          <label>
            ID Etiqueta
            <div className="input-icon-wrap with-action">
              <span className="field-icon" aria-hidden="true">{barcodeIcon()}</span>
              <input
                ref={etiquetaRef}
                type="text"
                value={etiquetaInput}
                onChange={(event) => setEtiquetaInput(event.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Digite ou bip a etiqueta e pressione Enter"
                required
              />
              <button
                type="button"
                className="input-action-btn"
                onClick={() => openScannerFor("etiqueta")}
                title="Ler etiqueta pela câmera"
                aria-label="Ler etiqueta pela câmera"
                disabled={!cameraSupported}
              >
                {cameraIcon()}
              </button>
            </div>
          </label>
          <button className="btn btn-primary" type="submit" disabled={busyOpenVolume || currentCd == null}>
            {busyOpenVolume ? "Abrindo..." : "Abrir volume"}
          </button>
        </form>

        {activeVolume ? (
          <article className="termo-volume-card">
            <div className="termo-volume-head">
              <div>
                <h3>Volume {activeVolume.id_etiqueta}</h3>
                <p>
                  Rota: {activeVolume.rota ?? "SEM ROTA"} | Filial: {activeVolume.filial_nome ?? "-"}
                  {activeVolume.filial != null ? ` (${activeVolume.filial})` : ""}
                </p>
                <p>
                  Status: {activeVolume.status === "em_conferencia" ? "Em conferência" : activeVolume.status === "finalizado_ok" ? "Finalizado sem divergência" : "Finalizado com falta"}
                </p>
              </div>
              <div className="termo-volume-head-right">
                <span className={`coleta-row-status ${activeVolume.sync_error ? "error" : activeVolume.pending_snapshot || activeVolume.pending_finalize ? "pending" : "synced"}`}>
                  {activeVolume.sync_error ? "Erro de sync" : activeVolume.pending_snapshot || activeVolume.pending_finalize ? "Pendente sync" : "Sincronizado"}
                </span>
                {canEditActiveVolume ? (
                  <button className="btn btn-primary" type="button" onClick={requestFinalize}>
                    Finalizar
                  </button>
                ) : null}
              </div>
            </div>

            <form className="termo-form termo-scan-form" onSubmit={onSubmitBarras}>
              <h4>Conferência de produtos</h4>
              <div className="termo-scan-grid">
                <label>
                  Código de barras
                  <div className="input-icon-wrap with-action">
                    <span className="field-icon" aria-hidden="true">{barcodeIcon()}</span>
                    <input
                      ref={barrasRef}
                      type="text"
                      value={barcodeInput}
                      onChange={(event) => setBarcodeInput(event.target.value)}
                      onKeyDown={onBarcodeKeyDown}
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="Bipe, digite ou use câmera"
                      disabled={!canEditActiveVolume}
                    />
                    <button
                      type="button"
                      className="input-action-btn"
                      onClick={() => openScannerFor("barras")}
                      title="Ler barras pela câmera"
                      aria-label="Ler barras pela câmera"
                      disabled={!cameraSupported || !canEditActiveVolume}
                    >
                      {cameraIcon()}
                    </button>
                  </div>
                </label>

                <label>
                  Múltiplo
                  <div className="input-icon-wrap">
                    <span className="field-icon" aria-hidden="true">{quantityIcon()}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={multiploInput}
                      onFocus={(event) => event.currentTarget.select()}
                      onClick={(event) => event.currentTarget.select()}
                      onChange={onMultiploChange}
                      disabled={!canEditActiveVolume}
                    />
                  </div>
                </label>
              </div>
              <button className="btn btn-primary" type="submit" disabled={!canEditActiveVolume}>
                Registrar leitura
              </button>
            </form>

            <div className="termo-list-block">
              <h4>Falta ({groupedItems.falta.length})</h4>
              {groupedItems.falta.length === 0 ? (
                <div className="coleta-empty">Sem itens com falta.</div>
              ) : (
                groupedItems.falta.map(({ item, qtd_falta, qtd_sobra }) => (
                  <article key={`falta-${item.coddv}`} className={`termo-item-card${expandedCoddv === item.coddv ? " is-expanded" : ""}`}>
                    <button type="button" className="termo-item-line" onClick={() => setExpandedCoddv((current) => current === item.coddv ? null : item.coddv)}>
                      <div className="termo-item-main">
                        <strong>{item.descricao}</strong>
                        <p>CODDV: {item.coddv}</p>
                        {item.qtd_conferida > 0 ? (
                          <p>Barras: {item.barras ?? "-"}</p>
                        ) : null}
                        <p>Esperada: {item.qtd_esperada} | Conferida: {item.qtd_conferida}</p>
                      </div>
                      <div className="termo-item-side">
                        <span className="termo-divergencia falta">Falta {qtd_falta}</span>
                        <span className="coleta-row-expand" aria-hidden="true">{chevronIcon(expandedCoddv === item.coddv)}</span>
                      </div>
                    </button>
                    {expandedCoddv === item.coddv ? (
                      <div className="termo-item-detail">
                        <p>Última alteração: {formatDateTime(item.updated_at)}</p>
                        {canEditActiveVolume ? (
                          <div className="termo-item-actions">
                            {editingCoddv === item.coddv && item.qtd_conferida > 0 ? (
                              <>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={editQtdInput}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onClick={(event) => event.currentTarget.select()}
                                  onChange={(event) => setEditQtdInput(event.target.value.replace(/\D/g, ""))}
                                />
                                <button className="btn btn-primary" type="button" onClick={() => void handleSaveItemEdit(item.coddv)}>Salvar</button>
                                <button className="btn btn-muted" type="button" onClick={() => { setEditingCoddv(null); setEditQtdInput("0"); }}>Cancelar</button>
                              </>
                            ) : (
                              <>
                                {item.qtd_conferida > 0 ? (
                                  <button className="btn btn-muted" type="button" onClick={() => { setEditingCoddv(item.coddv); setEditQtdInput(String(item.qtd_conferida)); }}>
                                    Editar
                                  </button>
                                ) : null}
                                {item.qtd_conferida > 0 ? (
                                  <button className="btn btn-muted termo-danger-btn" type="button" onClick={() => requestResetItem(item.coddv)}>
                                    Limpar
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                        {qtd_sobra > 0 ? <p className="termo-inline-note">Sobra detectada: {qtd_sobra}</p> : null}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>

            <div className="termo-list-block">
              <h4>Sobra ({groupedItems.sobra.length})</h4>
              {groupedItems.sobra.length === 0 ? (
                <div className="coleta-empty">Sem itens com sobra.</div>
              ) : (
                groupedItems.sobra.map(({ item, qtd_sobra }) => (
                  <article key={`sobra-${item.coddv}`} className={`termo-item-card${expandedCoddv === item.coddv ? " is-expanded" : ""}`}>
                    <button type="button" className="termo-item-line" onClick={() => setExpandedCoddv((current) => current === item.coddv ? null : item.coddv)}>
                      <div className="termo-item-main">
                        <strong>{item.descricao}</strong>
                        <p>CODDV: {item.coddv}</p>
                        {item.qtd_conferida > 0 ? (
                          <p>Barras: {item.barras ?? "-"}</p>
                        ) : null}
                        <p>Esperada: {item.qtd_esperada} | Conferida: {item.qtd_conferida}</p>
                      </div>
                      <div className="termo-item-side">
                        <span className="termo-divergencia sobra">Sobra {qtd_sobra}</span>
                        <span className="coleta-row-expand" aria-hidden="true">{chevronIcon(expandedCoddv === item.coddv)}</span>
                      </div>
                    </button>
                    {expandedCoddv === item.coddv ? (
                      <div className="termo-item-detail">
                        <p>Última alteração: {formatDateTime(item.updated_at)}</p>
                        {canEditActiveVolume ? (
                          <div className="termo-item-actions">
                            {editingCoddv === item.coddv && item.qtd_conferida > 0 ? (
                              <>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={editQtdInput}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onClick={(event) => event.currentTarget.select()}
                                  onChange={(event) => setEditQtdInput(event.target.value.replace(/\D/g, ""))}
                                />
                                <button className="btn btn-primary" type="button" onClick={() => void handleSaveItemEdit(item.coddv)}>Salvar</button>
                                <button className="btn btn-muted" type="button" onClick={() => { setEditingCoddv(null); setEditQtdInput("0"); }}>Cancelar</button>
                              </>
                            ) : (
                              <>
                                {item.qtd_conferida > 0 ? (
                                  <button className="btn btn-muted" type="button" onClick={() => { setEditingCoddv(item.coddv); setEditQtdInput(String(item.qtd_conferida)); }}>
                                    Editar
                                  </button>
                                ) : null}
                                {item.qtd_conferida > 0 ? (
                                  <button className="btn btn-muted termo-danger-btn" type="button" onClick={() => requestResetItem(item.coddv)}>
                                    Limpar
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>

            <div className="termo-list-block">
              <h4>Correto ({groupedItems.correto.length})</h4>
              {groupedItems.correto.length === 0 ? (
                <div className="coleta-empty">Sem itens corretos ainda.</div>
              ) : (
                groupedItems.correto.map(({ item }) => (
                  <article key={`correto-${item.coddv}`} className={`termo-item-card${expandedCoddv === item.coddv ? " is-expanded" : ""}`}>
                    <button type="button" className="termo-item-line" onClick={() => setExpandedCoddv((current) => current === item.coddv ? null : item.coddv)}>
                      <div className="termo-item-main">
                        <strong>{item.descricao}</strong>
                        <p>CODDV: {item.coddv}</p>
                        {item.qtd_conferida > 0 ? (
                          <p>Barras: {item.barras ?? "-"}</p>
                        ) : null}
                        <p>Esperada: {item.qtd_esperada} | Conferida: {item.qtd_conferida}</p>
                      </div>
                      <div className="termo-item-side">
                        <span className="termo-divergencia correto">Correto</span>
                        <span className="coleta-row-expand" aria-hidden="true">{chevronIcon(expandedCoddv === item.coddv)}</span>
                      </div>
                    </button>
                    {expandedCoddv === item.coddv ? (
                      <div className="termo-item-detail">
                        <p>Última alteração: {formatDateTime(item.updated_at)}</p>
                        {canEditActiveVolume ? (
                          <div className="termo-item-actions">
                            {editingCoddv === item.coddv && item.qtd_conferida > 0 ? (
                              <>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={editQtdInput}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onClick={(event) => event.currentTarget.select()}
                                  onChange={(event) => setEditQtdInput(event.target.value.replace(/\D/g, ""))}
                                />
                                <button className="btn btn-primary" type="button" onClick={() => void handleSaveItemEdit(item.coddv)}>Salvar</button>
                                <button className="btn btn-muted" type="button" onClick={() => { setEditingCoddv(null); setEditQtdInput("0"); }}>Cancelar</button>
                              </>
                            ) : (
                              <>
                                {item.qtd_conferida > 0 ? (
                                  <button className="btn btn-muted" type="button" onClick={() => { setEditingCoddv(item.coddv); setEditQtdInput(String(item.qtd_conferida)); }}>
                                    Editar
                                  </button>
                                ) : null}
                                {item.qtd_conferida > 0 ? (
                                  <button className="btn btn-muted termo-danger-btn" type="button" onClick={() => requestResetItem(item.coddv)}>
                                    Limpar
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </article>
        ) : (
          <div className="coleta-empty">
            Nenhum volume ativo. Informe uma etiqueta para iniciar a conferência.
          </div>
        )}
      </section>

      {showRoutesModal && typeof document !== "undefined"
        ? createPortal(
            <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="termo-rotas-title" onClick={() => setShowRoutesModal(false)}>
              <div className="confirm-dialog termo-routes-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="termo-rotas-title">Rota/Filial do dia</h3>
                <div className="input-icon-wrap termo-routes-search">
                  <span className="field-icon" aria-hidden="true">{searchIcon()}</span>
                  <input
                    type="text"
                    value={routeSearchInput}
                    onChange={(event) => setRouteSearchInput(event.target.value)}
                    placeholder="Buscar rota, filial, loja, status..."
                  />
                </div>
                {filteredRouteGroups.length === 0 ? (
                  <p>Sem dados de rota/filial disponíveis para este CD.</p>
                ) : (
                  <div className="termo-routes-list">
                    {filteredRouteGroups.map((group) => {
                      const isOpen = expandedRoute === group.rota;
                      const groupStatus = group.status;
                      return (
                        <div key={group.rota} className={`termo-route-group${isOpen ? " is-open" : ""}`}>
                          <button
                            type="button"
                            className="termo-route-row termo-route-row-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedRoute((current) => current === group.rota ? null : group.rota);
                            }}
                            aria-expanded={isOpen}
                          >
                            <span className="termo-route-main">
                              <span className="termo-route-title">{group.rota}</span>
                              <span className="termo-route-sub">
                                Lojas: {group.lojas_conferidas}/{group.lojas_total} conferidas
                                {" | "}
                                Etiquetas: {group.etiquetas_conferidas}/{group.etiquetas_total}
                              </span>
                              <span className="termo-route-sub">Status da rota: {routeStatusLabel(groupStatus)}</span>
                            </span>
                            <span className="termo-route-metrics">
                              <span>{group.lojas_conferidas}/{group.lojas_total}</span>
                              <span className={`termo-divergencia ${routeStatusClass(groupStatus)}`}>
                                {routeStatusLabel(groupStatus)}
                              </span>
                              <span className="coleta-row-expand" aria-hidden="true">{chevronIcon(isOpen)}</span>
                            </span>
                          </button>
                          {isOpen ? (
                            <div className="termo-route-stores">
                              {group.filiais.map((row) => {
                                const lojaStatus = resolveRouteStatus(row.conferidas, row.total_etiquetas);
                                return (
                                  <div key={`${group.rota}-${row.filial ?? "na"}`} className="termo-route-store-row">
                                    <div>
                                      <strong>{row.filial_nome}{row.filial != null ? ` (${row.filial})` : ""}</strong>
                                      <p>Etiquetas: {row.conferidas}/{row.total_etiquetas}</p>
                                      <p>Status da loja: {routeStatusLabel(lojaStatus)}</p>
                                    </div>
                                    <span className={`termo-divergencia ${routeStatusClass(lojaStatus)}`}>
                                      {routeStatusLabel(lojaStatus)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="confirm-actions">
                  <button className="btn btn-muted" type="button" onClick={() => setShowRoutesModal(false)}>Fechar</button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {showFinalizeModal && activeVolume && typeof document !== "undefined"
        ? createPortal(
            <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="termo-finalizar-title" onClick={() => setShowFinalizeModal(false)}>
              <div className="confirm-dialog termo-finalize-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="termo-finalizar-title">Finalizar conferência</h3>
                <p>Resumo: Falta {divergenciaTotals.falta} | Sobra {divergenciaTotals.sobra} | Correto {divergenciaTotals.correto}</p>
                {divergenciaTotals.falta > 0 ? (
                  <label>
                    Motivo da falta
                    <textarea
                      value={finalizeMotivo}
                      onChange={(event) => setFinalizeMotivo(event.target.value)}
                      placeholder="Descreva o motivo da falta"
                      rows={3}
                    />
                  </label>
                ) : null}
                {finalizeError ? <div className="alert error">{finalizeError}</div> : null}
                <div className="confirm-actions">
                  <button className="btn btn-muted" type="button" onClick={() => setShowFinalizeModal(false)} disabled={busyFinalize}>
                    Cancelar
                  </button>
                  <button className="btn btn-primary" type="button" onClick={() => void handleFinalizeVolume()} disabled={busyFinalize}>
                    {busyFinalize ? "Finalizando..." : "Confirmar finalização"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {dialogState && typeof document !== "undefined"
        ? createPortal(
            <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="termo-generic-dialog" onClick={closeDialog}>
              <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="termo-generic-dialog">{dialogState.title}</h3>
                <p>{dialogState.message}</p>
                <div className="confirm-actions">
                  {dialogState.onConfirm ? (
                    <>
                      <button className="btn btn-muted" type="button" onClick={closeDialog}>
                        {dialogState.cancelLabel ?? "Cancelar"}
                      </button>
                      <button className="btn btn-primary" type="button" onClick={dialogState.onConfirm}>
                        {dialogState.confirmLabel ?? "Confirmar"}
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-primary" type="button" onClick={closeDialog}>
                      {dialogState.confirmLabel ?? "OK"}
                    </button>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {scannerOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="termo-scanner-title" onClick={closeScanner}>
              <div className="scanner-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <div className="scanner-head">
                  <h3 id="termo-scanner-title">
                    {scannerTarget === "etiqueta" ? "Scanner de etiqueta" : "Scanner de barras"}
                  </h3>
                  <div className="scanner-head-actions">
                    {!isDesktop ? (
                      <button
                        type="button"
                        className={`scanner-flash-btn${torchEnabled ? " is-on" : ""}`}
                        onClick={() => void toggleTorch()}
                        disabled={!torchSupported}
                        title={torchSupported ? (torchEnabled ? "Desligar flash" : "Ligar flash") : "Flash indisponível"}
                      >
                        {flashIcon(torchEnabled)}
                        <span>{torchEnabled ? "Flash on" : "Flash"}</span>
                      </button>
                    ) : null}
                    <button className="scanner-close-btn" type="button" onClick={closeScanner} aria-label="Fechar scanner">
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
                <p className="scanner-hint">Aponte a câmera para leitura automática.</p>
                {scannerError ? <div className="alert error">{scannerError}</div> : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
