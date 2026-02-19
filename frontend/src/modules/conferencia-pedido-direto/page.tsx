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
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import {
  getDbBarrasByBarcode,
  getDbBarrasMeta,
  upsertDbBarrasCacheRow
} from "../../shared/db-barras/storage";
import {
  fetchDbBarrasByBarcodeOnline,
  refreshDbBarrasCacheSmart
} from "../../shared/db-barras/sync";
import { useOnDemandSoftKeyboard } from "../../shared/use-on-demand-soft-keyboard";
import { useScanFeedback } from "../../shared/use-scan-feedback";
import { getModuleByKeyOrThrow } from "../registry";
import {
  buildPedidoDiretoVolumeKey,
  cleanupExpiredPedidoDiretoVolumes,
  getLocalVolume,
  getManifestItemsByEtiqueta,
  getManifestMetaLocal,
  getPendingSummary,
  getRouteOverviewLocal,
  getPedidoDiretoPreferences,
  listUserLocalVolumes,
  saveLocalVolume,
  saveManifestSnapshot,
  saveRouteOverviewLocal,
  savePedidoDiretoPreferences,
  removeLocalVolume
} from "./storage";
import {
  cancelVolume,
  fetchCdOptions,
  fetchActiveVolume,
  fetchManifestBundle,
  fetchManifestMeta,
  fetchRouteOverview,
  fetchVolumeItems,
  finalizeVolume,
  normalizeBarcode,
  normalizeIdVol,
  openVolume,
  scanBarcode,
  setItemQtd,
  syncPendingPedidoDiretoVolumes
} from "./sync";
import type {
  CdOption,
  PedidoDiretoDivergenciaTipo,
  PedidoDiretoItemRow,
  PedidoDiretoLocalItem,
  PedidoDiretoLocalVolume,
  PedidoDiretoManifestItemRow,
  PedidoDiretoRouteOverviewRow,
  PedidoDiretoVolumeRow,
  PedidoDiretoModuleProfile
} from "./types";

interface ConferenciaPedidoDiretoPageProps {
  isOnline: boolean;
  profile: PedidoDiretoModuleProfile;
}

type PedidoDiretoStoreStatus = "pendente" | "em_andamento" | "concluido";
type PedidoDiretoRouteStatus = "pendente" | "iniciado" | "concluido";
type BarcodeValidationState = "idle" | "validating" | "valid" | "invalid";

interface PedidoDiretoRouteGroup {
  rota: string;
  lojas_total: number;
  lojas_conferidas: number;
  etiquetas_total: number;
  etiquetas_conferidas: number;
  status: PedidoDiretoRouteStatus;
  filiais: PedidoDiretoRouteOverviewRow[];
  route_blob: string;
  search_blob: string;
}

interface PedidoDiretoRouteGroupView extends PedidoDiretoRouteGroup {
  visible_filiais: PedidoDiretoRouteOverviewRow[];
  force_open: boolean;
}

type DialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
};

const MODULE_DEF = getModuleByKeyOrThrow("conferencia-pedido-direto");
const PREFERRED_SYNC_DELAY_MS = 800;
const SCANNER_INPUT_MAX_INTERVAL_MS = 45;
const SCANNER_INPUT_MIN_BURST_CHARS = 5;
const SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS = 90;
const SCANNER_INPUT_SUBMIT_COOLDOWN_MS = 600;

type ScannerInputTarget = "etiqueta" | "barras";

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

function fixedCdFromProfile(profile: PedidoDiretoModuleProfile): number | null {
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

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  let bestIso: string | null = null;
  let bestTs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) continue;
    if (parsed > bestTs) {
      bestTs = parsed;
      bestIso = value;
    }
  }
  return bestIso;
}

function buildManifestInfoLine(params: {
  termoRows: number;
  barrasRows: number;
  termoUpdatedAt?: string | null;
  barrasUpdatedAt?: string | null;
  hasPedidoDiretoBase: boolean;
}): string {
  const updatedAt = latestTimestamp([params.termoUpdatedAt, params.barrasUpdatedAt]);
  const updatedText = updatedAt ? ` | Atualizada em ${formatDateTime(updatedAt)}` : " | Sem atualização ainda";

  if (params.hasPedidoDiretoBase) {
    return `Base local: Pedido Direto ${params.termoRows} item(ns) | Barras ${params.barrasRows} item(ns)${updatedText}`;
  }

  return `Sem base local do Pedido Direto. Barras local: ${params.barrasRows} item(ns)${updatedText}`;
}

function withDivergencia(item: PedidoDiretoLocalItem): {
  item: PedidoDiretoLocalItem;
  divergencia: PedidoDiretoDivergenciaTipo;
  qtd_falta: number;
  qtd_sobra: number;
} {
  const qtdFalta = Math.max(item.qtd_esperada - item.qtd_conferida, 0);
  const qtdSobra = Math.max(item.qtd_conferida - item.qtd_esperada, 0);
  const divergencia: PedidoDiretoDivergenciaTipo = qtdFalta > 0 ? "falta" : qtdSobra > 0 ? "sobra" : "correto";
  return { item, divergencia, qtd_falta: qtdFalta, qtd_sobra: qtdSobra };
}

function itemSort(a: PedidoDiretoLocalItem, b: PedidoDiretoLocalItem): number {
  const byDesc = a.descricao.localeCompare(b.descricao);
  if (byDesc !== 0) return byDesc;
  return a.coddv - b.coddv;
}

function createLocalVolumeFromRemote(
  profile: PedidoDiretoModuleProfile,
  volume: PedidoDiretoVolumeRow,
  items: PedidoDiretoItemRow[]
): PedidoDiretoLocalVolume {
  const confDate = volume.conf_date || todayIsoBrasilia();
  const localKey = buildPedidoDiretoVolumeKey(profile.user_id, volume.cd, confDate, volume.id_vol);
  const localItems: PedidoDiretoLocalItem[] = items.map((item) => ({
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
    id_vol: volume.id_vol,
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
    pending_cancel: false,
    sync_error: null,
    last_synced_at: new Date().toISOString()
  };
}

function createLocalVolumeFromManifest(
  profile: PedidoDiretoModuleProfile,
  cd: number,
  idEtiqueta: string,
  manifestItems: PedidoDiretoManifestItemRow[]
): PedidoDiretoLocalVolume {
  const nowIso = new Date().toISOString();
  const confDate = todayIsoBrasilia();
  const first = manifestItems[0];
  const localKey = buildPedidoDiretoVolumeKey(profile.user_id, cd, confDate, idEtiqueta);
  const items: PedidoDiretoLocalItem[] = manifestItems.map((row) => ({
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
    id_vol: idEtiqueta,
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
    pending_cancel: false,
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

function checkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" />
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
  if (value.includes("ID_VOL_OBRIGATORIO")) return "Informe o PedidoSeq para abrir o volume.";
  if (value.includes("ID_VOL_NAO_ENCONTRADO")) return "PedidoSeq não encontrado na base do dia.";
  if (value.includes("ID_VOL_INVALIDO")) return "PedidoSeq inválido. Use apenas números (pedido+seq).";
  if (value.includes("ID_VOL_AMBIGUO")) return "PedidoSeq ambíguo na base. Valide pedido/seq com o suporte.";
  if (value.includes("VOLUME_EM_USO")) return "Este volume já está em conferência por outro usuário.";
  if (value.includes("VOLUME_JA_CONFERIDO_OUTRO_USUARIO")) return "Volume já conferido por outro usuário hoje.";
  if (value.includes("PRODUTO_FORA_DO_VOLUME")) return "Produto fora do volume em conferência.";
  if (value.includes("BARRAS_NAO_ENCONTRADA")) return "Código de barras inválido. Ele não existe na base db_barras.";
  if (value.includes("SOBRA_PENDENTE")) return "Existem sobras. Corrija antes de finalizar.";
  if (value.includes("FALTA_MOTIVO_OBRIGATORIO")) return "Informe o motivo da falta para finalizar.";
  if (value.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Entre novamente.";
  if (value.includes("CD_SEM_ACESSO")) return "Usuário sem acesso ao CD informado.";
  if (value.includes("BASE_PEDIDO_DIRETO_VAZIA")) return "A base de Pedido Direto está vazia para este CD.";
  if (value.includes("CONFERENCIA_EM_ABERTO_OUTRO_ID_VOL")) {
    return "Já existe uma conferência em andamento para sua matrícula. Finalize o PedidoSeq atual para iniciar outro.";
  }
  if (value.includes("CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA")) {
    return "Esta conferência não existe mais ou já foi finalizada. Abra um novo PedidoSeq.";
  }
  return value;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function buildRouteSearchBlob(group: {
  rota: string;
  status: PedidoDiretoRouteStatus;
  lojas_conferidas: number;
  lojas_total: number;
  etiquetas_conferidas: number;
  etiquetas_total: number;
}): string {
  return normalizeSearchText([
    group.rota,
    routeStatusLabel(group.status),
    `${group.lojas_conferidas}/${group.lojas_total}`,
    `${group.etiquetas_conferidas}/${group.etiquetas_total}`
  ].join(" "));
}

function buildStoreSearchBlob(item: PedidoDiretoRouteOverviewRow): string {
  return normalizeSearchText([
    item.filial_nome ?? "",
    item.filial != null ? String(item.filial) : "",
    item.pedidos_seq ?? "",
    `${item.conferidas}/${item.total_etiquetas}`,
    routeStatusLabel(item.status),
    item.tem_falta ? "falta" : "",
    item.colaborador_nome ?? "",
    item.colaborador_mat ?? ""
  ].join(" "));
}

function resolveIdVolFromPedidosSeq(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  for (const chunk of raw.split(",")) {
    const token = chunk.trim();
    if (!token) continue;

    const slashMatch = /^(\d+)\s*\/\s*(\d+)$/.exec(token);
    if (slashMatch) {
      try {
        const pedido = BigInt(slashMatch[1]);
        const seq = BigInt(slashMatch[2]);
        return `${pedido.toString()}${seq.toString()}`;
      } catch {
        // segue para outras tentativas
      }
    }

    const digitsOnly = token.replace(/\D+/g, "");
    if (!digitsOnly) continue;
    const normalized = digitsOnly.replace(/^0+/, "");
    return normalized || "0";
  }

  return null;
}

function normalizeStoreStatus(value: string | null | undefined): PedidoDiretoStoreStatus {
  const normalized = String(value ?? "").toLowerCase();
  if (
    normalized === "concluido"
    || normalized === "conferido"
    || normalized === "finalizado_ok"
    || normalized === "finalizado_falta"
  ) return "concluido";
  if (normalized === "em_andamento" || normalized === "em_conferencia" || normalized === "iniciado") return "em_andamento";
  return "pendente";
}

function resolveRouteGroupStatus(filiais: PedidoDiretoRouteOverviewRow[]): PedidoDiretoRouteStatus {
  if (filiais.length === 0) return "pendente";
  const allPendente = filiais.every((item) => normalizeStoreStatus(item.status) === "pendente");
  if (allPendente) return "pendente";
  const allConcluido = filiais.every((item) => normalizeStoreStatus(item.status) === "concluido");
  if (allConcluido) return "concluido";
  return "iniciado";
}

function routeStatusLabel(status: PedidoDiretoRouteStatus | PedidoDiretoStoreStatus | string): string {
  if (status === "concluido" || status === "conferido") return "Concluído";
  if (status === "em_andamento" || status === "em_conferencia") return "Em andamento";
  if (status === "iniciado") return "Iniciado";
  return "Pendente";
}

function routeStatusClass(status: PedidoDiretoRouteStatus | PedidoDiretoStoreStatus | string): "correto" | "andamento" | "falta" {
  if (status === "concluido" || status === "conferido") return "correto";
  if (status === "em_andamento" || status === "em_conferencia" || status === "iniciado") return "andamento";
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

export default function ConferenciaPedidoDiretoPage({ isOnline, profile }: ConferenciaPedidoDiretoPageProps) {
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerTrackRef = useRef<MediaStreamTrack | null>(null);
  const scannerTorchModeRef = useRef<"none" | "controls" | "track">("none");
  const etiquetaRef = useRef<HTMLInputElement | null>(null);
  const barrasRef = useRef<HTMLInputElement | null>(null);
  const scannerInputStateRef = useRef<Record<ScannerInputTarget, ScannerInputState>>({
    etiqueta: createScannerInputState(),
    barras: createScannerInputState()
  });
  const resolveScanFeedbackAnchor = useCallback(() => barrasRef.current, []);
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
  } = useOnDemandSoftKeyboard("text");

  const [isDesktop, setIsDesktop] = useState<boolean>(() => isBrowserDesktop());
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [manifestReady, setManifestReady] = useState(false);
  const [manifestInfo, setManifestInfo] = useState<string>("");
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingErrors, setPendingErrors] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [routeRows, setRouteRows] = useState<PedidoDiretoRouteOverviewRow[]>([]);

  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [cdAtivo, setCdAtivo] = useState<number | null>(null);

  const [etiquetaInput, setEtiquetaInput] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeValidationState, setBarcodeValidationState] = useState<BarcodeValidationState>("idle");
  const [multiploInput, setMultiploInput] = useState("1");

  const [activeVolume, setActiveVolume] = useState<PedidoDiretoLocalVolume | null>(null);
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
  const [busyCancel, setBusyCancel] = useState(false);
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
  const hasOpenConference = Boolean(activeVolume && activeVolume.status === "em_conferencia" && !activeVolume.is_read_only);

  const cameraSupported = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }, []);
  const barcodeIconClassName = `field-icon validation-status${barcodeValidationState === "validating" ? " is-validating" : ""}${barcodeValidationState === "valid" ? " is-valid" : ""}${barcodeValidationState === "invalid" ? " is-invalid" : ""}`;

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

  const hasAnyItemInformed = useMemo(() => (
    Boolean(activeVolume?.items.some((item) => item.qtd_conferida > 0))
  ), [activeVolume]);

  const routeGroups = useMemo<PedidoDiretoRouteGroup[]>(() => {
    if (routeRows.length === 0) return [];

    const grouped = new Map<string, Omit<PedidoDiretoRouteGroup, "search_blob" | "route_blob">>();

    for (const row of routeRows) {
      const rota = (row.rota || "SEM ROTA").trim() || "SEM ROTA";
      const lojaStatus = normalizeStoreStatus(row.status);
      const current = grouped.get(rota);

      if (!current) {
        grouped.set(rota, {
          rota,
          lojas_total: 1,
          lojas_conferidas: lojaStatus === "concluido" ? 1 : 0,
          etiquetas_total: row.total_etiquetas,
          etiquetas_conferidas: row.conferidas,
          status: lojaStatus === "concluido" ? "concluido" : lojaStatus === "pendente" ? "pendente" : "iniciado",
          filiais: [row]
        });
        continue;
      }

      current.lojas_total += 1;
      current.lojas_conferidas += lojaStatus === "concluido" ? 1 : 0;
      current.etiquetas_total += row.total_etiquetas;
      current.etiquetas_conferidas += row.conferidas;
      current.filiais.push(row);
    }

    return Array.from(grouped.values())
      .map((group) => {
        const filiaisOrdenadas = [...group.filiais].sort((a, b) => {
          const byFilial = (a.filial ?? Number.MAX_SAFE_INTEGER) - (b.filial ?? Number.MAX_SAFE_INTEGER);
          if (byFilial !== 0) return byFilial;
          return (a.filial_nome ?? "").localeCompare(b.filial_nome ?? "", "pt-BR");
        });

        const routeStatus = resolveRouteGroupStatus(filiaisOrdenadas);
        const routeBlob = buildRouteSearchBlob({
          rota: group.rota,
          status: routeStatus,
          lojas_conferidas: group.lojas_conferidas,
          lojas_total: group.lojas_total,
          etiquetas_conferidas: group.etiquetas_conferidas,
          etiquetas_total: group.etiquetas_total
        });

        const searchBlob = normalizeSearchText([
          routeBlob,
          ...filiaisOrdenadas.map((item) => buildStoreSearchBlob(item))
        ].join(" "));

        return {
          ...group,
          status: routeStatus,
          filiais: filiaisOrdenadas,
          route_blob: routeBlob,
          search_blob: searchBlob
        };
      })
      .sort((a, b) => a.rota.localeCompare(b.rota, "pt-BR"));
  }, [routeRows]);

  const filteredRouteGroups = useMemo<PedidoDiretoRouteGroupView[]>(() => {
    const query = normalizeSearchText(routeSearchInput);
    if (!query) {
      return routeGroups.map((group) => ({
        ...group,
        visible_filiais: group.filiais,
        force_open: false
      }));
    }

    const mapped: Array<PedidoDiretoRouteGroupView | null> = routeGroups.map((group) => {
      const routeMatches = group.route_blob.includes(query);
      const matchedFiliais = group.filiais.filter((item) => buildStoreSearchBlob(item).includes(query));
      if (!routeMatches && matchedFiliais.length === 0) return null;

      return {
        ...group,
        visible_filiais: routeMatches ? group.filiais : matchedFiliais,
        force_open: true
      };
    });

    return mapped.filter((group): group is PedidoDiretoRouteGroupView => group !== null);
  }, [routeGroups, routeSearchInput]);

  const focusBarras = useCallback(() => {
    disableBarcodeSoftKeyboard();
    window.requestAnimationFrame(() => {
      barrasRef.current?.focus();
    });
  }, [disableBarcodeSoftKeyboard]);

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
    const current = await getPedidoDiretoPreferences(profile.user_id);
    await savePedidoDiretoPreferences(profile.user_id, {
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
      const message = "Câmera não disponível neste dispositivo.";
      setErrorMessage(message);
      triggerScanErrorAlert(message);
      return;
    }
    setScannerTarget(target);
    setScannerError(null);
    setScannerOpen(true);
    setTorchEnabled(false);
    setTorchSupported(false);
  }, [cameraSupported, triggerScanErrorAlert]);

  const runPendingSync = useCallback(async (silent = false) => {
    if (!isOnline) return;
    if (busySync) return;
    setBusySync(true);
    if (!silent) {
      setStatusMessage(null);
      setErrorMessage(null);
    }
    try {
      const result = await syncPendingPedidoDiretoVolumes(profile.user_id);
      await refreshPendingState();
      if (activeVolume) {
        const refreshed = await getLocalVolume(profile.user_id, activeVolume.cd, activeVolume.conf_date, activeVolume.id_vol);
        if (refreshed) {
          setActiveVolume(refreshed);
        } else {
          setActiveVolume(null);
          setEtiquetaInput("");
        }
      }
      if (!silent) {
        if (result.failed > 0) {
          setErrorMessage(`${result.failed} pendência(s) de Pedido Direto falharam na sincronização.`);
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

  const prepareOfflineManifest = useCallback(async (forceRefresh: boolean, background = false) => {
    if (currentCd == null) throw new Error("Selecione um CD antes de trabalhar offline.");

    setBusyManifest(true);
    setProgressMessage(null);
    if (!background) {
      setErrorMessage(null);
      setStatusMessage(null);
    }

    try {
      const [localMeta, localBarrasMeta] = await Promise.all([
        getManifestMetaLocal(profile.user_id, currentCd),
        getDbBarrasMeta()
      ]);

      if (!isOnline) {
        if (!localMeta || localMeta.row_count <= 0) {
          throw new Error("Sem base local de Pedido Direto. Conecte-se e sincronize antes de usar offline.");
        }
        if (localBarrasMeta.row_count <= 0) {
          throw new Error("Sem base local de barras. Conecte-se e ative o modo offline para sincronizar.");
        }
        const localRoutes = await getRouteOverviewLocal(profile.user_id, currentCd);
        setRouteRows(localRoutes);
        setManifestReady(true);
        setManifestInfo(
          buildManifestInfoLine({
            termoRows: localMeta.row_count,
            barrasRows: localBarrasMeta.row_count,
            termoUpdatedAt: localMeta.cached_at ?? localMeta.generated_at,
            barrasUpdatedAt: localBarrasMeta.last_sync_at,
            hasPedidoDiretoBase: true
          })
        );
        return;
      }

      const remoteMeta = await fetchManifestMeta(currentCd);
      const sameHash = localMeta && localMeta.manifest_hash === remoteMeta.manifest_hash;
      const shouldDownload = forceRefresh || !sameHash || (localMeta?.row_count ?? 0) <= 0;
      let termoRowCount = remoteMeta.row_count;

      if (shouldDownload) {
        const bundle = await fetchManifestBundle(currentCd, (progress) => {
          if (progress.step === "items") {
            if (progress.total > 0) {
              setProgressMessage(
                `Atualizando base de Pedido Direto... ${progress.percent}% (${progress.rows}/${progress.total})`
              );
              return;
            }
            setProgressMessage(`Atualizando base de Pedido Direto... ${progress.percent}%`);
            return;
          }
          if (progress.step === "routes") {
            setProgressMessage(`Atualizando rotas/filiais... ${progress.percent}% (${progress.rows} rota(s))`);
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

      let barrasTotal = localBarrasMeta.row_count;
      if (forceRefresh || localBarrasMeta.row_count <= 0) {
        const barrasSync = await refreshDbBarrasCacheSmart((progress) => {
          if (progress.totalRows > 0) {
            setProgressMessage(
              `Atualizando base de barras... ${progress.percent}% (${progress.rowsFetched}/${progress.totalRows})`
            );
            return;
          }
          setProgressMessage(`Atualizando base de barras... ${progress.percent}%`);
        });
        barrasTotal = barrasSync.total;
      }

      const [metaAfterSync, barrasMetaAfterSync] = await Promise.all([
        getManifestMetaLocal(profile.user_id, currentCd),
        getDbBarrasMeta()
      ]);

      setManifestInfo(
        buildManifestInfoLine({
          termoRows: metaAfterSync?.row_count ?? termoRowCount,
          barrasRows: barrasMetaAfterSync.row_count || barrasTotal,
          termoUpdatedAt: metaAfterSync?.cached_at ?? metaAfterSync?.generated_at ?? remoteMeta.generated_at,
          barrasUpdatedAt: barrasMetaAfterSync.last_sync_at,
          hasPedidoDiretoBase: (metaAfterSync?.row_count ?? termoRowCount) > 0
        })
      );

      setManifestReady(true);
      if (!background) {
        setStatusMessage("Base do Pedido Direto pronta para trabalho offline.");
      }
    } finally {
      setBusyManifest(false);
      setProgressMessage(null);
    }
  }, [currentCd, isOnline, profile.user_id]);

  const applyVolumeUpdate = useCallback(async (nextVolume: PedidoDiretoLocalVolume, focusInput = true) => {
    await saveLocalVolume(nextVolume);
    setActiveVolume(nextVolume);
    await refreshPendingState();
    if (focusInput) focusBarras();
  }, [focusBarras, refreshPendingState]);

  const resumeRemoteActiveVolume = useCallback(async (silent = false): Promise<PedidoDiretoLocalVolume | null> => {
    if (!isOnline) return null;

    const remoteActive = await fetchActiveVolume();
    if (!remoteActive || remoteActive.status !== "em_conferencia") return null;

    if (isGlobalAdmin && cdAtivo !== remoteActive.cd) {
      setCdAtivo(remoteActive.cd);
    }

    const remoteItems = await fetchVolumeItems(remoteActive.conf_id);
    const localVolume = createLocalVolumeFromRemote(profile, remoteActive, remoteItems);
    await saveLocalVolume(localVolume);
    setActiveVolume(localVolume);
    setEtiquetaInput(localVolume.id_vol);

    if (!silent) {
      setStatusMessage(`Conferência retomada automaticamente: PedidoSeq ${localVolume.id_vol}.`);
    }

    return localVolume;
  }, [cdAtivo, isGlobalAdmin, isOnline, profile]);

  const openVolumeFromEtiqueta = useCallback(async (rawEtiqueta: string) => {
    const etiqueta = normalizeIdVol(rawEtiqueta);
    if (!etiqueta) {
      setErrorMessage("Informe o PedidoSeq para abrir o volume.");
      return;
    }
    if (currentCd == null) {
      setErrorMessage("CD não definido para esta conferência.");
      return;
    }
    if (hasOpenConference && activeVolume && activeVolume.id_vol !== etiqueta) {
      setErrorMessage("Existe uma conferência em andamento para sua matrícula. Finalize o PedidoSeq atual para iniciar outro.");
      setStatusMessage(`Conferência ativa: PedidoSeq ${activeVolume.id_vol}.`);
      setEtiquetaInput(activeVolume.id_vol);
      return;
    }

    setBusyOpenVolume(true);
    setStatusMessage(null);
    setErrorMessage(null);
    let etiquetaFinal = etiqueta;

    try {
      const today = todayIsoBrasilia();
      const waitingOfflineBase = preferOfflineMode && !manifestReady;

      if (preferOfflineMode) {
        if (!manifestReady) {
          if (!isOnline) {
            await prepareOfflineManifest(false);
          } else if (!busyManifest) {
            void prepareOfflineManifest(false, true).catch((error) => {
              const message = error instanceof Error ? error.message : "Falha ao preparar base offline.";
              setErrorMessage(normalizeRpcErrorMessage(message));
            });
          }
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
          etiquetaFinal = existingToday.id_vol;
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
          etiquetaFinal = localVolume.id_vol;
          setStatusMessage(
            remoteVolume.is_read_only
              ? "Volume já finalizado. Aberto em leitura."
              : waitingOfflineBase
                ? "Volume aberto online enquanto a base offline é sincronizada em segundo plano."
                : "Volume aberto para conferência."
          );
          return;
        }

        const manifestItems = await getManifestItemsByEtiqueta(profile.user_id, currentCd, etiqueta);
        if (!manifestItems.length) {
          showDialog({
            title: "PedidoSeq inválido",
            message: "PedidoSeq não encontrado na base local do Pedido Direto para este CD."
          });
          return;
        }

        const offlineVolume = createLocalVolumeFromManifest(profile, currentCd, etiqueta, manifestItems);
        await saveLocalVolume(offlineVolume);
        setActiveVolume(offlineVolume);
        etiquetaFinal = offlineVolume.id_vol;
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
      etiquetaFinal = localVolume.id_vol;

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
      if (message.includes("CONFERENCIA_EM_ABERTO_OUTRO_ID_VOL")) {
        try {
          const resumed = await resumeRemoteActiveVolume(true);
          if (resumed) {
            etiquetaFinal = resumed.id_vol;
            setErrorMessage(null);
            setStatusMessage(`Conferência retomada automaticamente: PedidoSeq ${resumed.id_vol}.`);
            return;
          }
        } catch {
          // Se falhar ao retomar remoto, mantém tratamento padrão abaixo.
        }
      }
      setErrorMessage(normalizeRpcErrorMessage(message));
    } finally {
      setBusyOpenVolume(false);
      setExpandedCoddv(null);
      setEditingCoddv(null);
      setEditQtdInput("0");
      setEtiquetaInput(etiquetaFinal);
      focusBarras();
    }
  }, [
    activeVolume,
    closeDialog,
    currentCd,
    focusBarras,
    hasOpenConference,
    isOnline,
    busyManifest,
    manifestReady,
    preferOfflineMode,
    prepareOfflineManifest,
    profile,
    resumeRemoteActiveVolume,
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

    const nextVolume: PedidoDiretoLocalVolume = {
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

  const clearConferenceScreen = useCallback(() => {
    setShowFinalizeModal(false);
    setFinalizeMotivo("");
    setFinalizeError(null);
    setExpandedCoddv(null);
    setEditingCoddv(null);
    setEditQtdInput("0");
    setBarcodeInput("");
    setActiveVolume(null);
    setEtiquetaInput("");
    window.requestAnimationFrame(() => {
      etiquetaRef.current?.focus();
    });
  }, []);

  const handleClosedConferenceError = useCallback(async (rawMessage: string): Promise<boolean> => {
    if (!rawMessage.includes("CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA")) {
      return false;
    }
    if (isOnline && activeVolume) {
      try {
        const remoteVolume = await openVolume(activeVolume.id_vol, activeVolume.cd);
        const remoteItems = await fetchVolumeItems(remoteVolume.conf_id);
        const localVolume = createLocalVolumeFromRemote(profile, remoteVolume, remoteItems);
        await saveLocalVolume(localVolume);
        setActiveVolume(localVolume);
        setEtiquetaInput(localVolume.id_vol);
        await refreshPendingState();
        setShowFinalizeModal(false);
        setFinalizeError(null);
        if (localVolume.is_read_only || localVolume.status !== "em_conferencia") {
          setStatusMessage("Conferência atualizada: este volume já foi finalizado em outro dispositivo.");
        } else {
          setStatusMessage("Conferência retomada automaticamente neste dispositivo.");
        }
        setErrorMessage(null);
        return true;
      } catch {
        // Se não conseguir retomar do servidor, segue fluxo de limpeza local abaixo.
      }
    }
    try {
      if (activeVolume?.local_key) {
        await removeLocalVolume(activeVolume.local_key);
      }
    } catch {
      // Ignora falha local de limpeza.
    }
    await refreshPendingState();
    clearConferenceScreen();
    setShowFinalizeModal(false);
    setFinalizeError(null);
    setStatusMessage(null);
    setErrorMessage(normalizeRpcErrorMessage(rawMessage));
    return true;
  }, [activeVolume, clearConferenceScreen, isOnline, profile, refreshPendingState]);

  const handleCollectBarcode = useCallback(async (value: string) => {
    if (!activeVolume) {
      setErrorMessage("Abra um volume para iniciar a conferência.");
      setBarcodeValidationState("invalid");
      triggerScanErrorAlert("Abra um volume para iniciar a conferência.");
      return;
    }
    if (activeVolume.is_read_only || !canEditActiveVolume) {
      setErrorMessage("Volume em modo leitura. Não é possível alterar.");
      setBarcodeValidationState("invalid");
      triggerScanErrorAlert("Volume em modo leitura.");
      return;
    }

    const barras = normalizeBarcode(value);
    if (!barras) {
      setBarcodeValidationState("invalid");
      triggerScanErrorAlert("Código de barras obrigatório.");
      return;
    }

    const qtd = parsePositiveInteger(multiploInput, 1);
    let produtoRegistrado = "";
    let barrasRegistrada = barras;
    let registroRemoto = false;
    setStatusMessage(null);
    setErrorMessage(null);
    setBarcodeValidationState("validating");

    try {
      if (preferOfflineMode || !isOnline || !activeVolume.remote_conf_id) {
        const lookup = await resolveBarcodeProduct(barras);
        if (!lookup) {
          showDialog({
            title: "Código de barras inválido",
            message: `O código de barras "${barras}" é inválido. Ele não existe na base db_barras.`
          });
          setBarcodeValidationState("invalid");
          triggerScanErrorAlert("Código de barras inválido.");
          return;
        }
        const target = activeVolume.items.find((item) => item.coddv === lookup.coddv);
        if (!target) {
          const produtoNome = `CODDV ${lookup.coddv} - ${lookup.descricao?.trim() || "Sem descrição"}`;
          showDialog({
            title: "Produto fora do volume",
            message: `Produto "${produtoNome}" não faz parte do volume em conferência.`,
            confirmLabel: "OK"
          });
          setBarcodeValidationState("invalid");
          triggerScanErrorAlert("Produto fora do volume.");
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
        const nextVolume: PedidoDiretoLocalVolume = {
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
      showScanFeedback("success", descricao, `+ ${qtd}`);
      setBarcodeValidationState("valid");
      focusBarras();
    } catch (error) {
      setBarcodeValidationState("invalid");
      const message = error instanceof Error ? error.message : "Falha ao registrar leitura.";
      if (await handleClosedConferenceError(message)) return;
      if (message.includes("BARRAS_NAO_ENCONTRADA")) {
        showDialog({
          title: "Código de barras inválido",
          message: `O código de barras "${barras}" é inválido. Ele não existe na base db_barras.`,
          confirmLabel: "OK"
        });
        triggerScanErrorAlert("Código de barras inválido.");
        return;
      }
      if (message.includes("PRODUTO_FORA_DO_VOLUME")) {
        const lookup = await resolveBarcodeProduct(barras);
        const produtoNome = lookup
          ? `CODDV ${lookup.coddv} - ${lookup.descricao?.trim() || "Sem descrição"}`
          : `Código de barras ${barras}`;
        showDialog({
          title: "Produto fora do volume",
          message: `Produto "${produtoNome}" não faz parte do volume em conferência.`,
          confirmLabel: "OK"
        });
        triggerScanErrorAlert("Produto fora do volume.");
        return;
      }
      const normalizedError = normalizeRpcErrorMessage(message);
      setErrorMessage(normalizedError);
      triggerScanErrorAlert(normalizedError);
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
    showScanFeedback,
    triggerScanErrorAlert,
    updateItemQtyLocal,
    handleClosedConferenceError
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
        const nextVolume: PedidoDiretoLocalVolume = {
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
      if (await handleClosedConferenceError(message)) return;
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
    updateItemQtyLocal,
    handleClosedConferenceError
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
              const nextVolume: PedidoDiretoLocalVolume = {
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
            if (await handleClosedConferenceError(message)) return;
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
    updateItemQtyLocal,
    handleClosedConferenceError
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
        const nextVolume: PedidoDiretoLocalVolume = {
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
        setStatusMessage("Conferência finalizada localmente. Você já pode iniciar outro PedidoSeq.");
      } else {
        await finalizeVolume(activeVolume.remote_conf_id, falta > 0 ? motivo : null);
        await removeLocalVolume(activeVolume.local_key);
        await refreshPendingState();
        setStatusMessage("Conferência finalizada com sucesso. Você já pode iniciar outro PedidoSeq.");
      }
      clearConferenceScreen();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao finalizar.";
      if (await handleClosedConferenceError(message)) return;
      setFinalizeError(normalizeRpcErrorMessage(message));
    } finally {
      setBusyFinalize(false);
    }
  }, [
    activeVolume,
    applyVolumeUpdate,
    canEditActiveVolume,
    clearConferenceScreen,
    divergenciaTotals.falta,
    divergenciaTotals.sobra,
    finalizeMotivo,
    isOnline,
    preferOfflineMode,
    refreshPendingState,
    handleClosedConferenceError
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

  const markStorePendingAfterCancel = useCallback(async (volume: PedidoDiretoLocalVolume) => {
    if (volume.filial == null) return;
    if (routeRows.length === 0) return;

    const nextRows = routeRows.map((row) => {
      if (row.filial !== volume.filial) return row;
      const totalEtiquetas = Math.max(row.total_etiquetas, 0);
      const adjustedConferidas =
        totalEtiquetas > 0 && row.conferidas >= totalEtiquetas
          ? Math.max(totalEtiquetas - 1, 0)
          : Math.max(row.conferidas, 0);
      const adjustedPendentes = Math.max(totalEtiquetas - adjustedConferidas, 0);

      return {
        ...row,
        conferidas: adjustedConferidas,
        pendentes: adjustedPendentes,
        status: "pendente" as const,
        tem_falta: false,
        colaborador_nome: null,
        colaborador_mat: null,
        status_at: null
      };
    });

    setRouteRows(nextRows);
    if (currentCd === volume.cd) {
      await saveRouteOverviewLocal(profile.user_id, volume.cd, nextRows);
    }
  }, [currentCd, profile.user_id, routeRows]);

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
        await cleanupExpiredPedidoDiretoVolumes(profile.user_id);
        const prefs = await getPedidoDiretoPreferences(profile.user_id);
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
        const message = error instanceof Error ? error.message : "Falha ao carregar módulo Pedido Direto.";
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
        buildManifestInfoLine({
          termoRows: localMeta?.row_count ?? 0,
          barrasRows: barrasMeta.row_count,
          termoUpdatedAt: localMeta?.cached_at ?? localMeta?.generated_at,
          barrasUpdatedAt: barrasMeta.last_sync_at,
          hasPedidoDiretoBase: Boolean(localMeta && localMeta.row_count > 0)
        })
      );
      setRouteRows(localRoutes);

      const latestOpen = volumes.find((row) => row.status === "em_conferencia" && !row.is_read_only) ?? null;
      if (latestOpen) {
        if (isGlobalAdmin && latestOpen.cd !== currentCd) {
          setCdAtivo(latestOpen.cd);
          return;
        }
        if (latestOpen.cd === currentCd) {
          setActiveVolume(latestOpen);
          setEtiquetaInput(latestOpen.id_vol);
          return;
        }
      }

      const today = todayIsoBrasilia();
      const latestToday = volumes.find(
        (row) => row.cd === currentCd
          && row.conf_date === today
          && (row.status === "em_conferencia" || row.pending_snapshot || row.pending_finalize || row.pending_cancel)
      );
      if (latestToday) {
        setActiveVolume(latestToday);
        setEtiquetaInput(latestToday.id_vol);
      } else {
        setActiveVolume(null);
        setEtiquetaInput("");
      }

      if (!isOnline) return;

      try {
        const resumed = await resumeRemoteActiveVolume(true);
        if (cancelled || !resumed) return;
        if (isGlobalAdmin && resumed.cd !== currentCd) {
          setCdAtivo(resumed.cd);
          return;
        }
        if (resumed.cd === currentCd) {
          setActiveVolume(resumed);
          setEtiquetaInput(resumed.id_vol);
        }
      } catch {
        // Mantém apenas contexto local quando não for possível retomar remoto.
      }
    };

    void loadLocalContext();
    return () => {
      cancelled = true;
    };
  }, [currentCd, isGlobalAdmin, isOnline, profile.user_id, resumeRemoteActiveVolume]);

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
    let decodeErrorAlerted = false;
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
          const message = "Falha ao abrir visualização da câmera.";
          setScannerError(message);
          triggerScanErrorAlert(message);
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
              const message = "Não foi possível ler o código. Ajuste foco/distância e tente novamente.";
              setScannerError(message);
              if (!decodeErrorAlerted) {
                decodeErrorAlerted = true;
                triggerScanErrorAlert(message);
              }
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
        const message = error instanceof Error ? error.message : "Falha ao iniciar câmera.";
        setScannerError(message);
        triggerScanErrorAlert(message);
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      if (torchProbeTimer != null) window.clearTimeout(torchProbeTimer);
      stopScanner();
    };
  }, [handleCollectBarcode, openVolumeFromEtiqueta, resolveScannerTrack, scannerOpen, scannerTarget, stopScanner, supportsTrackTorch, triggerScanErrorAlert]);

  const toggleTorch = async () => {
    const controls = scannerControlsRef.current;
    const track = scannerTrackRef.current ?? resolveScannerTrack();
    if (!controls?.switchTorch && scannerTorchModeRef.current !== "track") {
      const message = "Flash não disponível neste dispositivo.";
      setScannerError(message);
      triggerScanErrorAlert(message);
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
      const message = "Não foi possível alternar o flash.";
      setScannerError(message);
      triggerScanErrorAlert(message);
    }
  };

  const clearScannerInputTimer = useCallback((target: ScannerInputTarget) => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current[target];
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const commitScannerInput = useCallback(async (target: ScannerInputTarget, rawValue: string) => {
    const normalized = target === "etiqueta" ? normalizeIdVol(rawValue) : normalizeBarcode(rawValue);
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

    if (target === "etiqueta") {
      setEtiquetaInput(normalized);
      await openVolumeFromEtiqueta(normalized);
      return;
    }

    setBarcodeInput(normalized);
    await handleCollectBarcode(normalized);
  }, [clearScannerInputTimer, handleCollectBarcode, openVolumeFromEtiqueta]);

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

  const onSubmitEtiqueta = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await commitScannerInput("etiqueta", etiquetaInput);
  };

  const onSubmitBarras = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await commitScannerInput("barras", barcodeInput);
  };

  const onEtiquetaInputChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setEtiquetaInput(nextValue);
    handleScannerInputChange("etiqueta", nextValue);
  };

  const onBarcodeInputChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setBarcodeInput(nextValue);
    setBarcodeValidationState("idle");
    handleScannerInputChange("barras", nextValue);
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

  const shouldHandleScannerTab = (target: ScannerInputTarget, value: string): boolean => {
    if (!value.trim()) return false;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const state = scannerInputStateRef.current[target];
    if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) return true;
    if (state.lastInputAt <= 0) return false;
    return now - state.lastInputAt <= SCANNER_INPUT_MAX_INTERVAL_MS * 2;
  };

  const onEtiquetaKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !shouldHandleScannerTab("etiqueta", etiquetaInput)) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    void commitScannerInput("etiqueta", etiquetaInput);
  };

  const onBarcodeKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !shouldHandleScannerTab("barras", barcodeInput)) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    void commitScannerInput("barras", barcodeInput);
  };

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      const state = scannerInputStateRef.current;
      for (const target of ["etiqueta", "barras"] as const) {
        if (state[target].timerId != null) {
          window.clearTimeout(state[target].timerId);
          state[target].timerId = null;
        }
      }
    };
  }, []);

  const handleToggleOffline = async () => {
    const next = !preferOfflineMode;
    setPreferOfflineMode(next);
    await persistPreferences({ prefer_offline_mode: next });
    if (next) {
      if (isOnline) {
        setStatusMessage("Modo offline ativado. A base será sincronizada em segundo plano.");
        if (!busyManifest) {
          void prepareOfflineManifest(false, true).catch((error) => {
            const message = error instanceof Error ? error.message : "Falha ao preparar base offline.";
            setErrorMessage(normalizeRpcErrorMessage(message));
          });
        }
      } else if (manifestReady) {
        setStatusMessage("Modo offline ativado com base local existente.");
      } else {
        setErrorMessage("Sem base local do Pedido Direto. Conecte-se para sincronizar a base offline.");
      }
      return;
    }
    setStatusMessage("Modo online ativado.");
  };

  const requestFinalize = () => {
    if (!activeVolume || !hasAnyItemInformed) return;
    setFinalizeError(null);
    setFinalizeMotivo(activeVolume.falta_motivo ?? "");
    setShowFinalizeModal(true);
  };

  const requestCancelConference = useCallback(() => {
    if (!activeVolume || !canEditActiveVolume) return;

    showDialog({
      title: "Cancelar conferência",
      message: `A conferência do PedidoSeq ${activeVolume.id_vol} será cancelada e todos os dados lançados serão perdidos. Deseja continuar?`,
      confirmLabel: "Cancelar conferência",
      cancelLabel: "Voltar",
      onConfirm: () => {
        void (async () => {
          closeDialog();
          setBusyCancel(true);
          setErrorMessage(null);
          setStatusMessage(null);

          try {
            if (activeVolume.remote_conf_id && isOnline) {
              await cancelVolume(activeVolume.remote_conf_id);
              await removeLocalVolume(activeVolume.local_key);
              await markStorePendingAfterCancel(activeVolume);
              await refreshPendingState();
              clearConferenceScreen();
              setStatusMessage("Conferência cancelada. Os dados foram descartados.");
              await syncRouteOverview();
              return;
            }

            if (activeVolume.remote_conf_id && !isOnline) {
              const nowIso = new Date().toISOString();
              const nextVolume: PedidoDiretoLocalVolume = {
                ...activeVolume,
                pending_cancel: true,
                pending_snapshot: false,
                pending_finalize: false,
                pending_finalize_reason: null,
                sync_error: null,
                updated_at: nowIso
              };
              await saveLocalVolume(nextVolume);
              await markStorePendingAfterCancel(activeVolume);
              await refreshPendingState();
              clearConferenceScreen();
              setStatusMessage("Conferência cancelada localmente. A remoção no banco ocorrerá ao reconectar.");
              return;
            }

            await removeLocalVolume(activeVolume.local_key);
            await markStorePendingAfterCancel(activeVolume);
            await refreshPendingState();
            clearConferenceScreen();
            setStatusMessage("Conferência cancelada. Os dados locais foram descartados.");
          } catch (error) {
            const message = error instanceof Error ? error.message : "Falha ao cancelar conferência.";
            if (await handleClosedConferenceError(message)) return;
            setErrorMessage(normalizeRpcErrorMessage(message));
          } finally {
            setBusyCancel(false);
          }
        })();
      }
    });
  }, [
    activeVolume,
    canEditActiveVolume,
    clearConferenceScreen,
    closeDialog,
    isOnline,
    markStorePendingAfterCancel,
    refreshPendingState,
    showDialog,
    syncRouteOverview,
    handleClosedConferenceError
  ]);

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
            <PendingSyncBadge
              pendingCount={pendingCount}
              errorCount={pendingErrors}
              title="Conferências pendentes de envio"
            />
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
          <h2>Olá, {displayUserName}</h2>
          <p>Para trabalhar offline, sincronize a base do pedido de Pedido Direto.</p>
          {manifestInfo ? <p className="termo-meta-line">{manifestInfo}</p> : null}
        </div>

        <div className="termo-actions-row">
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

        {!hasOpenConference ? (
          <form className="termo-form termo-open-form" onSubmit={onSubmitEtiqueta}>
            <h3>Abertura de volume</h3>
            <label>
              PedidoSeq
              <div className="input-icon-wrap with-action">
                <span className="field-icon" aria-hidden="true">{barcodeIcon()}</span>
                <input
                  ref={etiquetaRef}
                  type="text"
                  value={etiquetaInput}
                  onChange={onEtiquetaInputChange}
                  onKeyDown={onEtiquetaKeyDown}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Informe o PedidoSeq do volume"
                  required
                />
                <button
                  type="button"
                  className="input-action-btn"
                  onClick={() => openScannerFor("etiqueta")}
                  title="Ler PedidoSeq pela câmera"
                  aria-label="Ler PedidoSeq pela câmera"
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
        ) : null}

        {activeVolume ? (
          <article className="termo-volume-card">
            <div className="termo-volume-head">
              <div>
                <h3>PedidoSeq {activeVolume.id_vol}</h3>
                <p>
                  Rota: {activeVolume.rota ?? "SEM ROTA"} | Filial: {activeVolume.filial_nome ?? "-"}
                  {activeVolume.filial != null ? (
                    <>
                      {" "}(
                      <strong>{activeVolume.filial}</strong>
                      )
                    </>
                  ) : null}
                </p>
                <p>
                  Status: {activeVolume.status === "em_conferencia" ? "Em conferência" : activeVolume.status === "finalizado_ok" ? "Finalizado sem divergência" : "Finalizado com falta"}
                </p>
              </div>
              <div className="termo-volume-head-right">
                <span className={`coleta-row-status ${activeVolume.sync_error ? "error" : activeVolume.pending_snapshot || activeVolume.pending_finalize || activeVolume.pending_cancel ? "pending" : "synced"}`}>
                  {activeVolume.sync_error ? "Erro de sync" : activeVolume.pending_snapshot || activeVolume.pending_finalize || activeVolume.pending_cancel ? "Pendente sync" : "Sincronizado"}
                </span>
                {canEditActiveVolume ? (
                  <div className="termo-volume-actions">
                    <button
                      className="btn btn-danger termo-cancel-btn"
                      type="button"
                      onClick={requestCancelConference}
                      disabled={busyCancel || busyFinalize}
                      title="Cancelar conferência"
                    >
                      <span aria-hidden="true">{closeIcon()}</span>
                      {busyCancel ? "Cancelando..." : "Cancelar"}
                    </button>
                    {hasAnyItemInformed ? (
                      <button
                        className="btn btn-primary termo-finalize-btn"
                        type="button"
                        onClick={requestFinalize}
                        disabled={busyCancel || busyFinalize}
                      >
                        <span aria-hidden="true">{checkIcon()}</span>
                        Finalizar
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <form className="termo-form termo-scan-form" onSubmit={onSubmitBarras}>
              <h4>Conferência de produtos</h4>
              <div className="termo-scan-grid">
                <label>
                  Código de barras
                  <div className="input-icon-wrap with-action">
                    <span className={barcodeIconClassName} aria-hidden="true">{barcodeIcon()}</span>
                    <input
                      ref={barrasRef}
                      type="text"
                      inputMode={barcodeInputMode}
                      value={barcodeInput}
                      onChange={onBarcodeInputChange}
                      onKeyDown={onBarcodeKeyDown}
                      onPointerDown={enableBarcodeSoftKeyboard}
                      onBlur={disableBarcodeSoftKeyboard}
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
            Nenhum volume ativo. Informe um PedidoSeq para iniciar a conferência.
          </div>
        )}
      </section>

      {showRoutesModal && typeof document !== "undefined"
        ? createPortal(
            <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="termo-rotas-title" onClick={() => setShowRoutesModal(false)}>
              <div className="confirm-dialog termo-routes-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="termo-rotas-title">Rota/Pedido do dia</h3>
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
                    {filteredRouteGroups.map((group, index) => {
                      const routeKey = `${group.rota}::${index}`;
                      const isOpen = group.force_open || expandedRoute === routeKey;
                      const groupStatus = group.status;
                      const canToggle = !group.force_open;
                      const toggleRoute = () => {
                        if (!canToggle) return;
                        setExpandedRoute((current) => current === routeKey ? null : routeKey);
                      };
                      return (
                        <div key={routeKey} className={`termo-route-group${isOpen ? " is-open" : ""}`}>
                          <div
                            role="button"
                            tabIndex={canToggle ? 0 : -1}
                            className="termo-route-row-button"
                            onPointerUp={(event) => {
                              if (!canToggle) return;
                              event.stopPropagation();
                              toggleRoute();
                            }}
                            onKeyDown={(event) => {
                              if (!canToggle) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleRoute();
                              }
                            }}
                            aria-expanded={isOpen}
                          >
                            <span className="termo-route-main">
                              <span className="termo-route-title">{group.rota}</span>
                              <span className="termo-route-sub">
                                Lojas: {group.lojas_conferidas}/{group.lojas_total} conferidas
                                {" | "}
                                Volumes: {group.etiquetas_conferidas}/{group.etiquetas_total}
                              </span>
                              <span className="termo-route-sub">Status da rota: {routeStatusLabel(groupStatus)}</span>
                            </span>
                            <span className="termo-route-metrics">
                              <span>{group.lojas_conferidas}/{group.lojas_total}</span>
                              <span className={`termo-divergencia ${routeStatusClass(groupStatus)}`}>
                                {routeStatusLabel(groupStatus)}
                              </span>
                              {canToggle ? (
                                <span className="coleta-row-expand" aria-hidden="true">{chevronIcon(isOpen)}</span>
                              ) : null}
                            </span>
                          </div>
                          {isOpen ? (
                            <div className="termo-route-stores">
                              {group.visible_filiais.map((row) => {
                                const lojaStatus = normalizeStoreStatus(row.status);
                                const lojaConcluidaComFalta = lojaStatus === "concluido" && row.tem_falta;
                                const colaboradorNome = row.colaborador_nome?.trim() || "";
                                const colaboradorMat = row.colaborador_mat?.trim() || "";
                                const idVolFromRoute = resolveIdVolFromPedidosSeq(row.pedidos_seq);
                                return (
                                  <div key={`${group.rota}-${row.filial ?? "na"}`} className="termo-route-store-row">
                                    <div>
                                      <strong>{row.filial_nome}{row.filial != null ? ` (${row.filial})` : ""}</strong>
                                      <p>Volumes: {row.conferidas}/{row.total_etiquetas}</p>
                                      <p>Pedidos/Seq: {row.pedidos_seq ?? "-"}</p>
                                      <p>Status da loja: {routeStatusLabel(lojaStatus)}</p>
                                      <button
                                        className="btn btn-primary"
                                        type="button"
                                        onClick={() => {
                                          if (!idVolFromRoute) return;
                                          setShowRoutesModal(false);
                                          void openVolumeFromEtiqueta(idVolFromRoute);
                                        }}
                                        disabled={!idVolFromRoute}
                                      >
                                        {lojaStatus === "pendente" ? "Iniciar conferência" : "Retomar conferência"}
                                      </button>
                                      {lojaStatus === "em_andamento" && colaboradorNome ? (
                                        <p>Em andamento por: {colaboradorNome}{colaboradorMat ? ` (${colaboradorMat})` : ""}</p>
                                      ) : null}
                                      {lojaStatus === "concluido" && colaboradorNome ? (
                                        <p>Concluído por: {colaboradorNome}{colaboradorMat ? ` (${colaboradorMat})` : ""}</p>
                                      ) : null}
                                      {lojaStatus === "em_andamento" && row.status_at ? (
                                        <p>Iniciado em: {formatDateTime(row.status_at)}</p>
                                      ) : null}
                                      {lojaStatus === "concluido" && row.status_at ? (
                                        <p>Concluído em: {formatDateTime(row.status_at)}</p>
                                      ) : null}
                                    </div>
                                    <div className="termo-route-store-status">
                                      <span className={`termo-divergencia ${routeStatusClass(lojaStatus)}`}>
                                        {routeStatusLabel(lojaStatus)}
                                      </span>
                                      {lojaConcluidaComFalta ? (
                                        <span className="termo-route-store-note-falta">Falta</span>
                                      ) : null}
                                    </div>
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

      {showFinalizeModal && activeVolume && hasAnyItemInformed && typeof document !== "undefined"
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
                    {scannerTarget === "etiqueta" ? "Scanner de PedidoSeq" : "Scanner de barras"}
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
