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
import { PendingSyncDialog } from "../../ui/pending-sync-dialog";
import { formatDateOnlyPtBR, formatDateTimeBrasilia } from "../../shared/brasilia-datetime";
import { useScanFeedback } from "../../shared/use-scan-feedback";
import { getModuleByKeyOrThrow } from "../registry";
import {
  CLV_ETAPA_LABELS,
  CLV_FRACIONADO_TIPO_LABELS,
  CLV_INVALID_KNAPP_MESSAGE,
  CLV_MAX_LENGTH,
  canAccessClv,
  clampEtiquetaInput,
  etapaCountKey,
  etapaPendingKey,
  isAllowedEtiquetaLength,
  normalizeEtiquetaInput,
  normalizeFracionadoTipo,
  normalizeSearchText,
  parseClvEtiqueta,
  requiresKnappId,
  toDisplayName
} from "./logic";
import {
  countClvPendingOperations,
  getClvPreferences,
  listClvPendingOperations,
  removeClvPendingOperation,
  saveClvPendingOperation,
  saveClvPreferences
} from "./storage";
import {
  deleteClvMovimento,
  fetchCdOptions,
  fetchClvPedidoManifest,
  fetchClvTodayFeed,
  scanClvRecebimento,
  scanClvStage,
  syncPendingClvOperations,
  toClvErrorMessage
} from "./sync";
import type {
  CdOption,
  ClvEtapa,
  ClvFeedRow,
  ClvFracionadoTipo,
  ClvMovimento,
  ClvPendingOperation,
  ClvStageEtapa,
  ControleLogisticoVolumeModuleProfile
} from "./types";
import type { ModuleIconName, ModuleTone } from "../types";

interface ControleLogisticoVolumePageProps {
  isOnline: boolean;
  profile: ControleLogisticoVolumeModuleProfile;
}

const MODULE_DEF = getModuleByKeyOrThrow("controle-logistico-volume");
const SYNC_INTERVAL_MS = 45_000;
const SCANNER_INPUT_MAX_INTERVAL_MS = 45;
const SCANNER_INPUT_MIN_BURST_CHARS = 5;
const SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS = 90;
const SCANNER_INPUT_SUBMIT_COOLDOWN_MS = 600;
const NOT_FOUND_CHIME_DURATION_MS = 420;
let sharedClvAudioContext: AudioContext | null = null;

const CLV_STAGE_META: Record<ClvEtapa, { title: string; description: string; icon: ModuleIconName; tone: ModuleTone; tag: string }> = {
  recebimento_cd: {
    title: "Recebimento CD",
    description: "Bipe o primeiro volume da loja e informe o total.",
    icon: "volume",
    tone: "green",
    tag: "Início da loja"
  },
  entrada_galpao: {
    title: "Entrada no galpão",
    description: "Confirme volumes recebidos para entrada operacional.",
    icon: "barcode",
    tone: "teal",
    tag: "Conferência interna"
  },
  saida_galpao: {
    title: "Saída do galpão",
    description: "Registre volumes liberados para rota.",
    icon: "truck",
    tone: "amber",
    tag: "Expedição"
  },
  entrega_filial: {
    title: "Entrega na filial",
    description: "Confirme a entrega dos volumes na filial.",
    icon: "location",
    tone: "blue",
    tag: "Finalização"
  }
};

const CLV_STAGE_ORDER = Object.keys(CLV_STAGE_META) as ClvEtapa[];

interface ScannerInputState {
  lastInputAt: number;
  lastLength: number;
  burstChars: number;
  timerId: number | null;
  lastSubmittedValue: string;
  lastSubmittedAt: number;
}

interface KnappModalState {
  etiqueta: string;
}

interface ReceiptContextModalState {
  action: "start" | "switch";
}

interface FractionModalDraft {
  quantidade: string;
  tipo: ClvFracionadoTipo;
}

interface DeleteMovimentoConfirm {
  movId: string;
  etiqueta: string;
  volume: string | null;
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

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h3l1.4-2h4.2L15 7h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <circle cx="12" cy="13" r="3.2" />
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

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8l8-4 8 4-8 4-8-4z" />
      <path d="M4 8v8l8 4 8-4V8" />
      <path d="M12 12v8" />
    </svg>
  );
}

function TypeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 7h12" />
      <path d="M6 12h12" />
      <path d="M6 17h12" />
      <path d="M4 7h.01" />
      <path d="M4 12h.01" />
      <path d="M4 17h.01" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={open ? "is-open" : ""}>
      <path d="M8 10l4 4 4-4" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 18L17 6" />
      <text x="8" y="10" textAnchor="middle" fontSize="7" fontWeight="800" fill="currentColor" stroke="none">1</text>
      <text x="16" y="19" textAnchor="middle" fontSize="7" fontWeight="800" fill="currentColor" stroke="none">2</text>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function safeUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const audioCtor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!audioCtor) return null;
  if (!sharedClvAudioContext) {
    sharedClvAudioContext = new audioCtor();
  }
  return sharedClvAudioContext;
}

function runWithAudioContext(play: (ctx: AudioContext) => void): void {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  const run = () => {
    try {
      play(ctx);
    } catch {
      // Browser pode bloquear audio programatico.
    }
  };
  if (ctx.state === "suspended") {
    void ctx.resume().then(run).catch(() => undefined);
    return;
  }
  run();
}

function playNotFoundChime(): void {
  runWithAudioContext((ctx) => {
    const start = ctx.currentTime + 0.005;
    const end = start + (NOT_FOUND_CHIME_DURATION_MS / 1000);
    const mid = start + ((NOT_FOUND_CHIME_DURATION_MS / 1000) * 0.52);
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(0.28, start + 0.025);
    master.gain.exponentialRampToValueAtTime(0.2, mid);
    master.gain.exponentialRampToValueAtTime(0.0001, end);
    master.connect(ctx.destination);

    const toneA = ctx.createOscillator();
    toneA.type = "triangle";
    toneA.frequency.setValueAtTime(700, start);
    toneA.frequency.exponentialRampToValueAtTime(560, mid);
    toneA.connect(master);
    toneA.start(start);
    toneA.stop(mid + 0.03);

    const toneB = ctx.createOscillator();
    toneB.type = "sawtooth";
    toneB.frequency.setValueAtTime(430, mid);
    toneB.frequency.exponentialRampToValueAtTime(310, end);
    toneB.connect(master);
    toneB.start(mid);
    toneB.stop(end);
  });
}

function getEtiquetaTipoLabel(etiqueta: string): string {
  const length = etiqueta.length;
  if (length === 17 || length === 18) return "Knapp";
  if (length === 23) return "Termolábeis/Alimentos";
  if (length === 25) return "Pedido direto";
  if (length === 26) return "Pulmão";
  if (length === 27) return "Separação";
  return "-";
}

function isInvalidEtiquetaMessage(message: string): boolean {
  return /etiqueta inválida|etiqueta invalida|tamanho inválido|tamanho invalido/i.test(message);
}

function isDuplicateEtiquetaMessage(message: string): boolean {
  return /repetid|já foi informado|ja foi informado|já foi confirmado|ja foi confirmado|duplic/i.test(message);
}

function compareMovimentoAsc(a: ClvMovimento, b: ClvMovimento): number {
  const aTime = Date.parse(a.data_hr || "");
  const bTime = Date.parse(b.data_hr || "");
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
  return (a.mov_id || "").localeCompare(b.mov_id || "");
}

function formatMovimentoOperador(row: ClvFeedRow): string | null {
  const mov = [...row.movimentos].sort(compareMovimentoAsc).find((item) => item.nome_operador || item.mat_operador);
  if (!mov) return null;
  const name = mov.nome_operador ? toDisplayName(mov.nome_operador) : "Operador";
  return mov.mat_operador ? `${name} (${mov.mat_operador})` : name;
}

function formatDateTime(value: string | null | undefined): string {
  return formatDateTimeBrasilia(value ?? "", {
    includeSeconds: true,
    emptyFallback: "-",
    invalidFallback: "-"
  });
}

function cdCodeLabel(cd: number | null): string {
  return cd == null ? "CD não definido" : `CD ${String(cd).padStart(2, "0")}`;
}

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: ControleLogisticoVolumeModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) {
    return Math.trunc(profile.cd_default);
  }
  return parseCdFromLabel(profile.cd_nome);
}

function isGlobalAdmin(profile: ControleLogisticoVolumeModuleProfile): boolean {
  return profile.role === "admin" && profile.cd_default == null;
}

function movementFromPending(operation: ClvPendingOperation): ClvMovimento {
  return {
    mov_id: operation.local_id,
    etapa: operation.kind === "recebimento" ? "recebimento_cd" : operation.payload.etapa,
    etiqueta: operation.parsed.etiqueta,
    id_knapp: operation.parsed.id_knapp,
    volume: operation.parsed.volume,
    volume_key: operation.parsed.volume_key,
    fracionado: operation.kind === "recebimento" ? operation.payload.fracionado : false,
    fracionado_qtd: operation.kind === "recebimento" ? operation.payload.fracionado_qtd : null,
    fracionado_tipo: operation.kind === "recebimento" ? operation.payload.fracionado_tipo : null,
    mat_operador: "",
    nome_operador: "Pendente local",
    data_hr: operation.payload.data_hr,
    is_local: true
  };
}

function emptyLocalRow(operation: ClvPendingOperation): ClvFeedRow {
  const parsed = operation.parsed;
  const total = operation.kind === "recebimento" ? operation.payload.volume_total_informado : 0;
  return {
    lote_id: `local:${operation.local_id}`,
    cd: operation.payload.cd,
    pedido: parsed.pedido,
    data_pedido: parsed.data_pedido,
    dv: parsed.dv,
    filial: parsed.filial,
    filial_nome: null,
    rota: "Sem rota",
    volume_total_informado: total,
    recebido_count: 0,
    entrada_count: 0,
    saida_count: 0,
    entrega_count: 0,
    pendente_recebimento: total,
    pendente_entrada: 0,
    pendente_saida: 0,
    pendente_entrega: 0,
    updated_at: operation.updated_at,
    movimentos: [],
    is_local: true
  };
}

function recomputePending(row: ClvFeedRow): ClvFeedRow {
  return {
    ...row,
    pendente_recebimento: Math.max(row.volume_total_informado - row.recebido_count, 0),
    pendente_entrada: Math.max(row.recebido_count - row.entrada_count, 0),
    pendente_saida: Math.max(row.recebido_count - row.saida_count, 0),
    pendente_entrega: Math.max(row.recebido_count - row.entrega_count, 0)
  };
}

function applyPendingOperations(rows: ClvFeedRow[], operations: ClvPendingOperation[], cd: number | null): ClvFeedRow[] {
  const map = new Map<string, ClvFeedRow>();

  for (const row of rows) {
    map.set(`${row.cd}:${row.pedido}:${row.filial}`, {
      ...row,
      movimentos: [...row.movimentos]
    });
  }

  for (const operation of operations) {
    if (cd != null && operation.payload.cd !== cd) continue;
    const key = `${operation.payload.cd}:${operation.parsed.pedido}:${operation.parsed.filial}`;
    const current = map.get(key) ?? emptyLocalRow(operation);
    const etapa = operation.kind === "recebimento" ? "recebimento_cd" : operation.payload.etapa;
    if (current.movimentos.some((mov) => mov.etapa === etapa && mov.volume_key === operation.parsed.volume_key)) {
      map.set(key, current);
      continue;
    }

    const countKey = etapaCountKey(etapa);
    const next: ClvFeedRow = {
      ...current,
      volume_total_informado: operation.kind === "recebimento"
        ? Math.max(current.volume_total_informado, operation.payload.volume_total_informado)
        : current.volume_total_informado,
      [countKey]: current[countKey] + 1,
      updated_at: operation.updated_at,
      movimentos: [movementFromPending(operation), ...current.movimentos]
    };
    map.set(key, recomputePending(next));
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.volume_total_informado !== b.volume_total_informado) return a.volume_total_informado - b.volume_total_informado;
    if (a.filial !== b.filial) return a.filial - b.filial;
    if (a.pedido !== b.pedido) return a.pedido - b.pedido;
    return (a.filial_nome ?? "").localeCompare(b.filial_nome ?? "", "pt-BR");
  });
}

function mergeRow(rows: ClvFeedRow[], nextRow: ClvFeedRow): ClvFeedRow[] {
  const replaced = rows.some((row) => row.lote_id === nextRow.lote_id);
  const next = replaced ? rows.map((row) => (row.lote_id === nextRow.lote_id ? nextRow : row)) : [nextRow, ...rows];
  return next.sort((a, b) => {
    if (a.volume_total_informado !== b.volume_total_informado) return a.volume_total_informado - b.volume_total_informado;
    if (a.filial !== b.filial) return a.filial - b.filial;
    if (a.pedido !== b.pedido) return a.pedido - b.pedido;
    return (a.filial_nome ?? "").localeCompare(b.filial_nome ?? "", "pt-BR");
  });
}

function findRowForParsed(rows: ClvFeedRow[], parsed: { pedido: number; filial: number }): ClvFeedRow | null {
  return rows.find((row) => row.pedido === parsed.pedido && row.filial === parsed.filial) ?? null;
}

function rowContainsVolume(row: ClvFeedRow, volumeKey: string, etapa: ClvEtapa): boolean {
  return row.movimentos.some((mov) => mov.etapa === etapa && mov.volume_key === volumeKey);
}

function hasEtapaVolume(rows: ClvFeedRow[], etapa: ClvEtapa, volumeKey: string): boolean {
  return rows.some((row) => rowContainsVolume(row, volumeKey, etapa));
}

function stageReadyMessage(etapa: ClvEtapa, row: ClvFeedRow): string {
  const countKey = etapaCountKey(etapa);
  const pendingKey = etapaPendingKey(etapa);
  return `${row[countKey]}/${row.recebido_count || row.volume_total_informado} volumes | Pendentes ${row[pendingKey]}`;
}

export default function ControleLogisticoVolumePage({ isOnline, profile }: ControleLogisticoVolumePageProps) {
  const allowed = canAccessClv(profile.mat);
  const globalAdmin = isGlobalAdmin(profile);
  const fixedCd = fixedCdFromProfile(profile);
  const etiquetaRef = useRef<HTMLInputElement | null>(null);
  const knappInputRef = useRef<HTMLInputElement | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerInputStateRef = useRef<ScannerInputState>(createScannerInputState());
  const knappInputStateRef = useRef<ScannerInputState>(createScannerInputState());
  const { triggerScanErrorAlert } = useScanFeedback(() => etiquetaRef.current);

  const [etapa, setEtapa] = useState<ClvEtapa | null>(null);
  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [cdAtivo, setCdAtivo] = useState<number | null>(fixedCd);
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [feedRows, setFeedRows] = useState<ClvFeedRow[]>([]);
  const [manifestRows, setManifestRows] = useState<ClvFeedRow[]>([]);
  const [pendingOps, setPendingOps] = useState<ClvPendingOperation[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingErrors, setPendingErrors] = useState(0);
  const [showPendingSyncModal, setShowPendingSyncModal] = useState(false);
  const [showStagePicker, setShowStagePicker] = useState(true);
  const [busyPendingDiscard, setBusyPendingDiscard] = useState(false);
  const [busyRefresh, setBusyRefresh] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [busySubmit, setBusySubmit] = useState(false);
  const [receiptArmed, setReceiptArmed] = useState(false);
  const [activeReceiptRow, setActiveReceiptRow] = useState<ClvFeedRow | null>(null);
  const [activeDeliveryRow, setActiveDeliveryRow] = useState<ClvFeedRow | null>(null);
  const [pedidoInput, setPedidoInput] = useState("");
  const [loadedPedido, setLoadedPedido] = useState<number | null>(null);
  const [etiquetaInput, setEtiquetaInput] = useState("");
  const [idKnappInput, setIdKnappInput] = useState("");
  const [volumeTotalInput, setVolumeTotalInput] = useState("");
  const [fracionado, setFracionado] = useState(false);
  const [fracionadoQtd, setFracionadoQtd] = useState("");
  const [fracionadoTipo, setFracionadoTipo] = useState<ClvFracionadoTipo>("pedido_direto");
  const [feedSearch, setFeedSearch] = useState("");
  const [expandedLoteId, setExpandedLoteId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [knappModalState, setKnappModalState] = useState<KnappModalState | null>(null);
  const [receiptContextModalState, setReceiptContextModalState] = useState<ReceiptContextModalState | null>(null);
  const [fractionModalDraft, setFractionModalDraft] = useState<FractionModalDraft | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [deleteMovConfirm, setDeleteMovConfirm] = useState<DeleteMovimentoConfirm | null>(null);
  const [busyDeleteMov, setBusyDeleteMov] = useState(false);
  const [manualTyping, setManualTyping] = useState(false);

  const currentCd = globalAdmin ? cdAtivo : fixedCd;

  const visibleBaseRows = etapa === "recebimento_cd" ? feedRows : manifestRows;
  const recebimentoRows = useMemo(
    () => applyPendingOperations(feedRows, pendingOps, currentCd),
    [currentCd, feedRows, pendingOps]
  );
  const visibleRows = useMemo(
    () => applyPendingOperations(visibleBaseRows, pendingOps, currentCd),
    [currentCd, pendingOps, visibleBaseRows]
  );
  const filteredRows = useMemo(() => {
    const query = normalizeSearchText(feedSearch);
    if (!query) return visibleRows;
    return visibleRows.filter((row) => {
      const haystack = normalizeSearchText([
        row.pedido,
        row.filial,
        row.filial_nome ?? "",
        row.rota ?? "",
        row.movimentos.map((mov) => `${mov.etiqueta} ${mov.volume ?? ""}`).join(" ")
      ].join(" "));
      return haystack.includes(query);
    });
  }, [feedSearch, visibleRows]);

  const hasRecebimentoForCurrentCd = useMemo(
    () => recebimentoRows.some((row) => row.recebido_count > 0 || row.volume_total_informado > 0),
    [recebimentoRows]
  );

  const loadPending = useCallback(async () => {
    const [ops, summary] = await Promise.all([
      listClvPendingOperations(profile.user_id),
      countClvPendingOperations(profile.user_id)
    ]);
    setPendingOps(ops);
    setPendingCount(summary.pending_count);
    setPendingErrors(summary.error_count);
  }, [profile.user_id]);

  const refreshFeed = useCallback(async () => {
    if (!allowed || !isOnline || currentCd == null) return;
    setBusyRefresh(true);
    try {
      const rows = await fetchClvTodayFeed(currentCd);
      setFeedRows(rows);
      if (loadedPedido != null && etapa && etapa !== "recebimento_cd") {
        const manifest = await fetchClvPedidoManifest(currentCd, loadedPedido, etapa);
        setManifestRows(manifest);
      }
    } catch (error) {
      setErrorMessage(toClvErrorMessage(error));
    } finally {
      setBusyRefresh(false);
    }
  }, [allowed, currentCd, etapa, isOnline, loadedPedido]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  useEffect(() => {
    let cancelled = false;
    async function loadPrefs() {
      const prefs = await getClvPreferences(profile.user_id);
      if (cancelled) return;
      setPreferOfflineMode(prefs.prefer_offline_mode);
      if (globalAdmin && prefs.cd_ativo != null) setCdAtivo(prefs.cd_ativo);
    }
    void loadPrefs();
    return () => { cancelled = true; };
  }, [globalAdmin, profile.user_id]);

  useEffect(() => {
    if (!allowed || !globalAdmin || !isOnline) return;
    let cancelled = false;
    async function loadOptions() {
      try {
        const options = await fetchCdOptions();
        if (!cancelled) setCdOptions(options);
      } catch {
        if (!cancelled) setCdOptions([]);
      }
    }
    void loadOptions();
    return () => { cancelled = true; };
  }, [allowed, globalAdmin, isOnline]);

  useEffect(() => {
    if (!allowed) return;
    void saveClvPreferences(profile.user_id, {
      cd_ativo: currentCd,
      prefer_offline_mode: preferOfflineMode
    });
  }, [allowed, currentCd, preferOfflineMode, profile.user_id]);

  useEffect(() => {
    void refreshFeed();
  }, [refreshFeed]);

  const runSync = useCallback(async (quiet = false) => {
    if (!allowed || !isOnline || busySync) return;
    setBusySync(true);
    if (!quiet) {
      setErrorMessage(null);
      setStatusMessage(null);
    }
    try {
      const result = await syncPendingClvOperations(profile.user_id);
      await loadPending();
      await refreshFeed();
      if (!quiet && result.processed > 0) {
        setStatusMessage(`${result.synced} pendências sincronizadas. Restantes: ${result.pending}.`);
      }
    } catch (error) {
      if (!quiet) setErrorMessage(toClvErrorMessage(error));
    } finally {
      setBusySync(false);
    }
  }, [allowed, busySync, isOnline, loadPending, profile.user_id, refreshFeed]);

  useEffect(() => {
    if (!allowed || !isOnline || pendingCount <= 0) return;
    if (syncTimerRef.current != null) window.clearInterval(syncTimerRef.current);
    syncTimerRef.current = window.setInterval(() => {
      void runSync(true);
    }, SYNC_INTERVAL_MS);
    return () => {
      if (syncTimerRef.current != null) window.clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    };
  }, [allowed, isOnline, pendingCount, runSync]);

  useEffect(() => {
    if (isOnline && pendingCount > 0) void runSync(true);
  }, [isOnline, pendingCount, runSync]);

  const queueOperation = useCallback(async (operation: ClvPendingOperation) => {
    await saveClvPendingOperation(operation);
    await loadPending();
    setStatusMessage("Leitura salva localmente. Será enviada quando houver conexão.");
  }, [loadPending]);

  const clearScanInputs = useCallback(() => {
    setEtiquetaInput("");
    setIdKnappInput("");
    setFracionado(false);
    setFracionadoQtd("");
    setFracionadoTipo("pedido_direto");
    setManualTyping(false);
    window.requestAnimationFrame(() => etiquetaRef.current?.focus({ preventScroll: true }));
  }, []);

  const playScanErrorByMessage = useCallback((message: string) => {
    if (isDuplicateEtiquetaMessage(message)) {
      triggerScanErrorAlert(message);
      return;
    }
    if (isInvalidEtiquetaMessage(message)) {
      playNotFoundChime();
    }
  }, [triggerScanErrorAlert]);

  const reportScanError = useCallback((error: unknown) => {
    const message = toClvErrorMessage(error);
    setErrorMessage(message);
    playScanErrorByMessage(message);
  }, [playScanErrorByMessage]);

  const chooseStage = useCallback((nextEtapa: ClvEtapa) => {
    if (nextEtapa !== "recebimento_cd" && !hasRecebimentoForCurrentCd) {
      setErrorMessage("Recebimento CD precisa acontecer primeiro para liberar as demais etapas.");
      return;
    }
    setEtapa(nextEtapa);
    setShowStagePicker(false);
    setErrorMessage(null);
    setStatusMessage(null);
    setLoadedPedido(null);
    setManifestRows([]);
    setActiveDeliveryRow(null);
    setActiveReceiptRow(null);
    setReceiptArmed(false);
    setPedidoInput("");
    setVolumeTotalInput("");
    setFeedSearch("");
    setExpandedLoteId(null);
    setKnappModalState(null);
    setReceiptContextModalState(null);
    setFractionModalDraft(null);
    clearScanInputs();
  }, [clearScanInputs, hasRecebimentoForCurrentCd]);

  const loadPedidoManifest = useCallback(async () => {
    if (!etapa || etapa === "recebimento_cd") return;
    if (!hasRecebimentoForCurrentCd) {
      setErrorMessage("Recebimento CD precisa acontecer primeiro para liberar as demais etapas.");
      return;
    }
    if (currentCd == null) {
      setErrorMessage("Selecione o CD antes de carregar o pedido.");
      return;
    }
    const pedido = Number.parseInt(pedidoInput.replace(/\D/g, ""), 10);
    if (!Number.isFinite(pedido)) {
      setErrorMessage("Informe o número do pedido.");
      return;
    }
    if (!isOnline) {
      setErrorMessage("Conecte-se para carregar os volumes do pedido.");
      return;
    }
    setBusyRefresh(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const rows = await fetchClvPedidoManifest(currentCd, pedido, etapa);
      setManifestRows(rows);
      setLoadedPedido(pedido);
      setActiveDeliveryRow(null);
      setStatusMessage(rows.length > 0 ? `${rows.length} ${rows.length === 1 ? "loja carregada" : "lojas carregadas"} para o pedido ${pedido}.` : "Nenhum volume recebido para este pedido.");
    } catch (error) {
      setErrorMessage(toClvErrorMessage(error));
    } finally {
      setBusyRefresh(false);
    }
  }, [currentCd, etapa, hasRecebimentoForCurrentCd, isOnline, pedidoInput]);

  const validateCommonScan = useCallback((rawEtiqueta: string, rawKnappId?: string | null) => {
    if (!etapa) throw new Error("Selecione uma etapa.");
    if (currentCd == null) throw new Error("Selecione o CD antes de continuar.");
    const parsed = parseClvEtiqueta(rawEtiqueta, rawKnappId, { currentCd });
    if (requiresKnappId(parsed.length) && !parsed.id_knapp) throw new Error(CLV_INVALID_KNAPP_MESSAGE);
    return { parsed, cd: currentCd };
  }, [currentCd, etapa]);

  const submitRecebimento = useCallback(async (rawEtiqueta: string, rawKnappId?: string | null) => {
    if (!receiptArmed) {
      setErrorMessage("Clique em Iniciar loja ou Trocar loja antes de bipar.");
      return;
    }
    const { parsed, cd } = validateCommonScan(rawEtiqueta, rawKnappId);
    const total = Number.parseInt(volumeTotalInput.replace(/\D/g, ""), 10);
    if (!Number.isFinite(total) || total <= 0) throw new Error("Informe a quantidade total de volumes da loja.");
    if (activeReceiptRow && (activeReceiptRow.pedido !== parsed.pedido || activeReceiptRow.filial !== parsed.filial)) {
      throw new Error("Volume pertence a outra loja ou pedido. Clique em Trocar loja para alterar.");
    }
    if (activeReceiptRow && total < activeReceiptRow.recebido_count + 1) {
      throw new Error("Total informado menor que o volume já bipado.");
    }
    if (hasEtapaVolume(visibleRows, "recebimento_cd", parsed.volume_key)) {
      throw new Error("Este volume já foi informado no recebimento.");
    }
    const fractionType = normalizeFracionadoTipo(fracionadoTipo);
    const fractionQty = fracionado ? Number.parseInt(fracionadoQtd.replace(/\D/g, ""), 10) : null;
    if (fracionado && (!Number.isFinite(fractionQty) || (fractionQty ?? 0) <= 0)) {
      throw new Error("Informe a quantidade fracionada.");
    }
    if (fracionado && !fractionType) throw new Error("Selecione Pedido Direto ou Termolábeis.");

    const nowIso = new Date().toISOString();
    const payload = {
      cd,
      etiqueta: parsed.etiqueta,
      id_knapp: parsed.id_knapp,
      volume_total_informado: total,
      fracionado,
      fracionado_qtd: fracionado ? fractionQty : null,
      fracionado_tipo: fracionado ? fractionType : null,
      data_hr: nowIso
    };

    if (!isOnline || preferOfflineMode) {
      const localOperation: ClvPendingOperation = {
        local_id: safeUuid(),
        user_id: profile.user_id,
        kind: "recebimento",
        payload,
        parsed,
        sync_status: "pending",
        sync_error: null,
        created_at: nowIso,
        updated_at: nowIso
      };
      await queueOperation({
        ...localOperation
      });
      setActiveReceiptRow((current) => {
        const row = current ?? emptyLocalRow(localOperation);
        return recomputePending({
          ...row,
          volume_total_informado: total,
          recebido_count: row.recebido_count + 1,
          updated_at: nowIso,
          movimentos: [movementFromPending(localOperation), ...row.movimentos]
        });
      });
      setReceiptArmed(true);
      clearScanInputs();
      return;
    }

    const row = await scanClvRecebimento(payload);
    setFeedRows((current) => mergeRow(current, row));
    setActiveReceiptRow(row);
    setReceiptArmed(true);
    setVolumeTotalInput(String(row.volume_total_informado));
    setExpandedLoteId(row.lote_id);
    setStatusMessage(`Recebimento registrado: filial ${row.filial} | pedido ${row.pedido}.`);
    clearScanInputs();
  }, [
    activeReceiptRow,
    clearScanInputs,
    fracionado,
    fracionadoQtd,
    fracionadoTipo,
    isOnline,
    preferOfflineMode,
    profile.user_id,
    queueOperation,
    receiptArmed,
    validateCommonScan,
    visibleRows,
    volumeTotalInput
  ]);

  const submitStage = useCallback(async (rawEtiqueta: string, rawKnappId?: string | null) => {
    if (!etapa || etapa === "recebimento_cd") return;
    if (!hasRecebimentoForCurrentCd) {
      throw new Error("Recebimento CD precisa acontecer primeiro para liberar as demais etapas.");
    }
    const { parsed, cd } = validateCommonScan(rawEtiqueta, rawKnappId);
    if (loadedPedido == null || parsed.pedido !== loadedPedido) {
      throw new Error("Carregue o pedido antes de confirmar volumes.");
    }
    const targetRow = findRowForParsed(visibleRows, parsed);
    if (!targetRow) throw new Error("Volume não encontrado no recebimento inicial.");
    if (!rowContainsVolume(targetRow, parsed.volume_key, "recebimento_cd")) {
      throw new Error("Volume não encontrado no recebimento inicial.");
    }
    if (hasEtapaVolume(visibleRows, etapa, parsed.volume_key)) {
      throw new Error("Este volume já foi confirmado nesta etapa.");
    }
    if (etapa === "entrega_filial") {
      if (!activeDeliveryRow) throw new Error("Inicie a entrega de uma filial antes de bipar.");
      if (activeDeliveryRow.pedido !== parsed.pedido || activeDeliveryRow.filial !== parsed.filial) {
        throw new Error("Volume pertence a outra filial. Troque a filial ativa para continuar.");
      }
    }

    const nowIso = new Date().toISOString();
    const payload = {
      cd,
      etapa: etapa as ClvStageEtapa,
      etiqueta: parsed.etiqueta,
      id_knapp: parsed.id_knapp,
      lote_id: etapa === "entrega_filial" ? activeDeliveryRow?.lote_id ?? null : targetRow.lote_id,
      data_hr: nowIso
    };

    if (!isOnline || preferOfflineMode) {
      await queueOperation({
        local_id: safeUuid(),
        user_id: profile.user_id,
        kind: "stage",
        payload,
        parsed,
        sync_status: "pending",
        sync_error: null,
        created_at: nowIso,
        updated_at: nowIso
      });
      clearScanInputs();
      return;
    }

    const row = await scanClvStage(payload);
    setManifestRows((current) => mergeRow(current, row));
    setExpandedLoteId(row.lote_id);
    setStatusMessage(`${CLV_ETAPA_LABELS[etapa]}: volume confirmado para filial ${row.filial}.`);
    clearScanInputs();
  }, [
    activeDeliveryRow,
    clearScanInputs,
    etapa,
    hasRecebimentoForCurrentCd,
    isOnline,
    loadedPedido,
    preferOfflineMode,
    profile.user_id,
    queueOperation,
    validateCommonScan,
    visibleRows
  ]);

  const submitScanByValues = useCallback(async (rawEtiqueta: string, rawKnappId?: string | null) => {
    const normalizedEtiqueta = clampEtiquetaInput(rawEtiqueta);
    const normalizedKnapp = String(rawKnappId ?? "").replace(/\D/g, "");

    if (!normalizedEtiqueta) {
      throw new Error("Informe a etiqueta para continuar.");
    }
    if (!isAllowedEtiquetaLength(normalizedEtiqueta.length)) {
      throw new Error("Etiqueta inválida, revise e tente novamente!");
    }
    if (requiresKnappId(normalizedEtiqueta) && !normalizedKnapp) {
      setEtiquetaInput(normalizedEtiqueta);
      setIdKnappInput("");
      setKnappModalState({ etiqueta: normalizedEtiqueta });
      setStatusMessage("Informe o ID Knapp para concluir a leitura.");
      return;
    }

    if (etapa === "recebimento_cd") {
      await submitRecebimento(normalizedEtiqueta, normalizedKnapp);
      return;
    }
    await submitStage(normalizedEtiqueta, normalizedKnapp);
  }, [etapa, submitRecebimento, submitStage]);

  const onSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (busySubmit) return;
    setBusySubmit(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await submitScanByValues(etiquetaInput, idKnappInput);
    } catch (error) {
      reportScanError(error);
    } finally {
      setBusySubmit(false);
    }
  }, [busySubmit, etiquetaInput, idKnappInput, reportScanError, submitScanByValues]);

  const clearScannerInputTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current;
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const clearKnappInputTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    const state = knappInputStateRef.current;
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const commitScannerInput = useCallback(async (rawValue: string) => {
    const normalized = clampEtiquetaInput(rawValue);
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

    setEtiquetaInput(normalized);
    setBusySubmit(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await submitScanByValues(normalized);
    } catch (error) {
      reportScanError(error);
    } finally {
      setBusySubmit(false);
    }
  }, [clearScannerInputTimer, reportScanError, submitScanByValues]);

  const scheduleScannerInputAutoSubmit = useCallback((value: string) => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current;
    clearScannerInputTimer();
    state.timerId = window.setTimeout(() => {
      state.timerId = null;
      void commitScannerInput(value);
    }, SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS);
  }, [clearScannerInputTimer, commitScannerInput]);

  const commitKnappInput = useCallback(async (rawValue: string) => {
    const normalized = rawValue.replace(/\D/g, "");
    if (!normalized) return;

    const state = knappInputStateRef.current;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (state.lastSubmittedValue === normalized && now - state.lastSubmittedAt < SCANNER_INPUT_SUBMIT_COOLDOWN_MS) {
      return;
    }

    clearKnappInputTimer();
    state.lastSubmittedValue = normalized;
    state.lastSubmittedAt = now;
    state.lastInputAt = 0;
    state.lastLength = 0;
    state.burstChars = 0;

    setIdKnappInput(normalized);
    if (!knappModalState) return;

    setBusySubmit(true);
    setErrorMessage(null);
    try {
      await submitScanByValues(knappModalState.etiqueta, normalized);
      setKnappModalState(null);
    } catch (error) {
      reportScanError(error);
    } finally {
      setBusySubmit(false);
    }
  }, [clearKnappInputTimer, knappModalState, reportScanError, submitScanByValues]);

  const scheduleKnappInputAutoSubmit = useCallback((value: string) => {
    if (typeof window === "undefined") return;
    const state = knappInputStateRef.current;
    clearKnappInputTimer();
    state.timerId = window.setTimeout(() => {
      state.timerId = null;
      void commitKnappInput(value);
    }, SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS);
  }, [clearKnappInputTimer, commitKnappInput]);

  const closeScanner = useCallback(() => {
    setScannerOpen(false);
    setScannerError(null);
  }, []);

  const openReceiptContextModal = useCallback((action: "start" | "switch") => {
    setReceiptContextModalState({ action });
    setErrorMessage(null);
    setStatusMessage(null);
  }, []);

  const submitReceiptContextModal = useCallback(() => {
    const total = Number.parseInt(volumeTotalInput.replace(/\D/g, ""), 10);
    if (!Number.isFinite(total) || total <= 0) {
      setErrorMessage("Informe a quantidade total de volumes da loja.");
      return;
    }

    setReceiptArmed(true);
    setActiveReceiptRow(null);
    setReceiptContextModalState(null);
    clearScanInputs();
    setStatusMessage("Loja armada. Bipe o primeiro volume para iniciar o recebimento.");
  }, [clearScanInputs, volumeTotalInput]);

  const openFractionModal = useCallback(() => {
    if (etapa !== "recebimento_cd") return;
    setFractionModalDraft({
      quantidade: fracionadoQtd,
      tipo: fracionadoTipo
    });
  }, [etapa, fracionadoQtd, fracionadoTipo]);

  const confirmFractionModal = useCallback(() => {
    if (!fractionModalDraft) return;
    const qty = fractionModalDraft.quantidade.replace(/\D/g, "");
    const type = normalizeFracionadoTipo(fractionModalDraft.tipo);
    if (!qty || Number.parseInt(qty, 10) <= 0) {
      setErrorMessage("Informe a quantidade fracionada.");
      return;
    }
    if (!type) {
      setErrorMessage("Selecione Pedido Direto ou Termolábeis.");
      return;
    }
    setFracionado(true);
    setFracionadoQtd(qty);
    setFracionadoTipo(type);
    setFractionModalDraft(null);
    window.requestAnimationFrame(() => etiquetaRef.current?.focus({ preventScroll: true }));
  }, [fractionModalDraft]);

  const clearFractionState = useCallback(() => {
    setFracionado(false);
    setFracionadoQtd("");
    setFracionadoTipo("pedido_direto");
    setFractionModalDraft(null);
  }, []);

  const discardPending = useCallback(async (localId: string) => {
    setBusyPendingDiscard(true);
    try {
      await removeClvPendingOperation(localId);
      await loadPending();
    } finally {
      setBusyPendingDiscard(false);
    }
  }, [loadPending]);

  const discardAllPending = useCallback(async () => {
    setBusyPendingDiscard(true);
    try {
      for (const operation of pendingOps) {
        await removeClvPendingOperation(operation.local_id);
      }
      await loadPending();
      setShowPendingSyncModal(false);
    } finally {
      setBusyPendingDiscard(false);
    }
  }, [loadPending, pendingOps]);

  const confirmDeleteMovimento = useCallback(async () => {
    if (!deleteMovConfirm) return;
    setBusyDeleteMov(true);
    try {
      await deleteClvMovimento(deleteMovConfirm.movId);
      setDeleteMovConfirm(null);
      await refreshFeed();
    } catch (error) {
      setErrorMessage(toClvErrorMessage(error));
      setDeleteMovConfirm(null);
    } finally {
      setBusyDeleteMov(false);
    }
  }, [deleteMovConfirm, refreshFeed]);

  useEffect(() => {
    if (!knappModalState) return;
    const frameId = window.requestAnimationFrame(() => {
      knappInputRef.current?.focus({ preventScroll: true });
      knappInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [knappModalState]);

  useEffect(() => {
    if (!scannerError) return undefined;
    const timerId = window.setTimeout(() => setScannerError(null), 3200);
    return () => window.clearTimeout(timerId);
  }, [scannerError]);

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

            if (result) {
              const scanned = normalizeEtiquetaInput(result.getText() ?? "");
              if (!scanned) return;
              controls.stop();
              scannerControlsRef.current = null;
              setScannerOpen(false);
              setScannerError(null);
              void commitScannerInput(scanned);
              return;
            }

            const errorName = (error as { name?: string } | null)?.name;
            if (
              error
              && errorName !== "NotFoundException"
              && errorName !== "ChecksumException"
              && errorName !== "FormatException"
            ) {
              setScannerError("Nao foi possivel ler a etiqueta. Ajuste foco ou distancia e tente novamente.");
            }
          }
        );

        if (cancelled) {
          controls.stop();
          return;
        }

        scannerControlsRef.current = controls;
      } catch (error) {
        setScannerError(error instanceof Error ? error.message : "Falha ao iniciar câmera.");
      }
    };

    void start();
    return () => {
      cancelled = true;
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [commitScannerInput, scannerOpen]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      const scannerState = scannerInputStateRef.current;
      if (scannerState.timerId != null) {
        window.clearTimeout(scannerState.timerId);
        scannerState.timerId = null;
      }
      const knappState = knappInputStateRef.current;
      if (knappState.timerId != null) {
        window.clearTimeout(knappState.timerId);
        knappState.timerId = null;
      }
    };
  }, []);

  const currentStageMeta = etapa ? CLV_STAGE_META[etapa] : null;
  const moduleHeader = (
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
            title="Pendências locais"
            onClick={pendingCount > 0 || pendingErrors > 0 ? () => setShowPendingSyncModal(true) : undefined}
          />
          <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
            {isOnline ? "🟢 Online" : "🔴 Offline"}
          </span>
        </div>
      </div>

      <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
        <span className="module-icon" aria-hidden="true">
          <ModuleIcon name={currentStageMeta?.icon ?? MODULE_DEF.icon} />
        </span>
        <span className="module-title clv-module-title">
          <span>{currentStageMeta?.title ?? MODULE_DEF.title}</span>
          {allowed && currentStageMeta ? (
            <button
              type="button"
              className="clv-header-stage-change"
              onClick={() => setShowStagePicker(true)}
              aria-label="Trocar etapa"
              title="Trocar etapa"
            >
              🔄
            </button>
          ) : null}
        </span>
      </div>
    </header>
  );

  if (!allowed) {
    return (
      <>
        {moduleHeader}

        <section className="modules-shell clv-shell">
          <div className="coleta-head">
            <h2>Acesso indisponível</h2>
            <p>Módulo disponível apenas para a matrícula 88885.</p>
          </div>
        </section>
      </>
    );
  }

  const stageNeedsPedido = etapa != null && etapa !== "recebimento_cd";
  const scanDisabled = currentCd == null
    || busySubmit
    || etapa == null
    || (etapa === "recebimento_cd" && !receiptArmed)
    || (stageNeedsPedido && loadedPedido == null)
    || (etapa === "entrega_filial" && !activeDeliveryRow);

  return (
    <>
      {moduleHeader}

      <section className="modules-shell clv-shell">
        <div className="coleta-head">
          <h2>Controle Logístico</h2>
          <p>Fluxo de volumes por loja, pedido e etapa logística.</p>
        </div>

        <div className="coleta-actions-row clv-toolbar">
          <button className="btn btn-muted coleta-sync-btn" type="button" onClick={() => void refreshFeed()} disabled={!isOnline || busyRefresh}>
            <span aria-hidden="true">🔄</span>
            {busyRefresh ? "Atualizando..." : "Atualizar"}
          </button>
          <button
            className={`btn btn-muted termo-offline-toggle${preferOfflineMode ? " is-active" : ""}`}
            type="button"
            onClick={() => setPreferOfflineMode((value) => !value)}
            title={preferOfflineMode ? "Desativar modo offline local" : "Ativar modo offline local"}
          >
            {preferOfflineMode ? "📦 Offline ativo" : "📶 Trabalhar offline"}
          </button>
        </div>

        {globalAdmin ? (
          <div className="coleta-form clv-cd-panel">
            <label>
              Depósito
              <select value={cdAtivo ?? ""} onChange={(event) => setCdAtivo(event.target.value ? Number.parseInt(event.target.value, 10) : null)}>
                <option value="" disabled>Selecione o CD</option>
                {cdOptions.map((option) => (
                  <option key={option.cd} value={option.cd}>{cdCodeLabel(option.cd)}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {etapa && currentStageMeta ? (
          <>
            {stageNeedsPedido ? (
              <div className="coleta-form clv-pedido-panel">
                <label>
                  Pedido
                  <input
                    type="text"
                    inputMode="numeric"
                    value={pedidoInput}
                    onChange={(event) => setPedidoInput(event.target.value.replace(/\D/g, ""))}
                    placeholder="Número do pedido"
                  />
                </label>
                <button className="btn btn-primary" type="button" onClick={() => void loadPedidoManifest()} disabled={currentCd == null || busyRefresh}>
                  {busyRefresh ? "Carregando..." : "Carregar pedido"}
                </button>
              </div>
            ) : null}

            {etapa === "recebimento_cd" ? (
              <div className="aud-caixa-store-context-bar">
                <button
                  type="button"
                  className={`aud-caixa-store-context-btn${receiptArmed ? " is-active" : ""}`}
                  onClick={() => openReceiptContextModal(receiptArmed || activeReceiptRow ? "switch" : "start")}
                  disabled={currentCd == null}
                >
                  <span aria-hidden="true"><ModuleIcon name="volume" /></span>
                  {receiptArmed || activeReceiptRow ? "Trocar loja" : "Iniciar loja"}
                </button>
                <span className={`aud-caixa-store-context-pill${receiptArmed || activeReceiptRow ? " is-active" : ""}`}>
                  {receiptArmed && activeReceiptRow
                    ? `Loja ativa: filial ${activeReceiptRow.filial} | pedido ${activeReceiptRow.pedido} | informado ${activeReceiptRow.volume_total_informado}`
                    : receiptArmed
                    ? `Aguardando primeiro bip da loja | total ${volumeTotalInput || "-"}`
                    : activeReceiptRow
                    ? `Última loja: filial ${activeReceiptRow.filial} | pedido ${activeReceiptRow.pedido}`
                    : "Nenhuma loja iniciada"}
                </span>
              </div>
            ) : null}

            {etapa === "entrega_filial" && loadedPedido != null ? (
              <div className="clv-delivery-picker">
                {visibleRows.map((row) => (
                  <button
                    key={row.lote_id}
                    type="button"
                    className={`clv-delivery-chip${activeDeliveryRow?.lote_id === row.lote_id ? " is-active" : ""}`}
                    onClick={() => {
                      setActiveDeliveryRow(row);
                      setStatusMessage(`Entrega iniciada: filial ${row.filial} | pedido ${row.pedido}.`);
                    }}
                  >
                    Filial {row.filial} · {stageReadyMessage("entrega_filial", row)}
                  </button>
                ))}
              </div>
            ) : null}

            {etapa !== "recebimento_cd" || receiptArmed ? (
              <form className="coleta-form clv-scan-form" onSubmit={onSubmit}>
                <div className="coleta-form-grid aud-caixa-form-grid">
                  <label>
                    Etiqueta de volume
                    <div className={`input-icon-wrap with-action clv-input-wrap${etapa === "recebimento_cd" ? " clv-input-wrap-has-dual" : ""}`}>
                      <span className="field-icon" aria-hidden="true"><ModuleIcon name="volume" /></span>
                      <input
                        ref={etiquetaRef}
                        type="text"
                        inputMode="numeric"
                        value={etiquetaInput}
                        onChange={(event: ReactChangeEvent<HTMLInputElement>) => {
                          const nextValue = clampEtiquetaInput(event.target.value);
                          setEtiquetaInput(nextValue);

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
                            setManualTyping(false);
                            clearScannerInputTimer();
                            return;
                          }

                          if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) {
                            setManualTyping(false);
                            scheduleScannerInputAutoSubmit(nextValue);
                            return;
                          }

                          setManualTyping(true);
                          clearScannerInputTimer();
                        }}
                        onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                          if (event.key === "Escape") {
                            clearScanInputs();
                            return;
                          }
                          if (event.key !== "Enter" && event.key !== "Tab") return;
                          event.preventDefault();
                          if (busySubmit || scanDisabled) return;
                          setBusySubmit(true);
                          setErrorMessage(null);
                          setStatusMessage(null);
                          void submitScanByValues(etiquetaInput, idKnappInput)
                            .catch((error) => {
                              reportScanError(error);
                            })
                            .finally(() => {
                              setBusySubmit(false);
                            });
                        }}
                        maxLength={CLV_MAX_LENGTH}
                        placeholder="Bipe, digite ou use a câmera"
                        disabled={scanDisabled}
                        autoComplete="off"
                      />
                      <div className="clv-input-actions">
                        {manualTyping ? (
                          <button
                            className="input-action-btn clv-input-action clv-input-action-validate"
                            type="submit"
                            disabled={scanDisabled || busySubmit}
                            aria-label="Validar etiqueta"
                            title="Validar etiqueta"
                          >
                            <CheckIcon />
                          </button>
                        ) : (
                          <>
                            {etapa === "recebimento_cd" ? (
                              <button
                                className={`input-action-btn clv-input-action${fracionado ? " is-active" : ""}`}
                                type="button"
                                onClick={fracionado ? clearFractionState : openFractionModal}
                                disabled={scanDisabled}
                                aria-label={fracionado ? "Limpar volume fracionado" : "Marcar próximo volume como fracionado"}
                                title={fracionado ? "Limpar volume fracionado" : "Volume fracionado"}
                              >
                                <SplitIcon />
                              </button>
                            ) : null}
                            <button
                              className="input-action-btn clv-input-action"
                              type="button"
                              onClick={() => setScannerOpen(true)}
                              disabled={scanDisabled}
                              aria-label="Ler etiqueta pela câmera"
                              title="Ler etiqueta pela câmera"
                            >
                              <CameraIcon />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {fracionado && etapa === "recebimento_cd" ? (
                      <small className="clv-inline-hint">
                        Próximo volume fracionado: {fracionadoQtd} - {CLV_FRACIONADO_TIPO_LABELS[fracionadoTipo]}
                      </small>
                    ) : null}
                  </label>
                </div>

              </form>
            ) : null}

            {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
            {statusMessage ? <div className="alert success">{statusMessage}</div> : null}

            <div className="coleta-list-head">
              <h3>{etapa === "recebimento_cd" ? "Feed de recebimento" : loadedPedido ? `Pedido ${loadedPedido}` : "Volumes do pedido"}</h3>
              <span>{filteredRows.length} {filteredRows.length === 1 ? "loja" : "lojas"}</span>
            </div>

            <div className="input-icon-wrap aud-caixa-feed-search">
              <span className="field-icon" aria-hidden="true"><ModuleIcon name="search" /></span>
              <input
                type="text"
                value={feedSearch}
                onChange={(event) => setFeedSearch(event.target.value)}
                placeholder="Buscar por filial, pedido, rota ou etiqueta..."
                autoComplete="off"
              />
            </div>

            <div className="aud-caixa-feed clv-feed">
              {filteredRows.length === 0 ? (
                <div className="coleta-empty">
                  {stageNeedsPedido ? "Carregue um pedido para visualizar as lojas." : "Nenhum volume registrado para este CD."}
                </div>
              ) : filteredRows.map((row) => {
                const countKey = etapaCountKey(etapa);
                const pendingKey = etapaPendingKey(etapa);
                const expanded = expandedLoteId === row.lote_id;
const progressDone = row[countKey];
                const progressTotal = etapa === "recebimento_cd" ? row.volume_total_informado : row.recebido_count;
                const progressComplete = progressTotal > 0 && progressDone >= progressTotal;
                const rowOperador = formatMovimentoOperador(row);
                const movimentosDaEtapa = row.movimentos
                  .filter((mov) => mov.etapa === etapa)
                  .sort((a, b) => {
                    const aVol = Number(a.volume ?? Number.MAX_SAFE_INTEGER);
                    const bVol = Number(b.volume ?? Number.MAX_SAFE_INTEGER);
                    if (aVol !== bVol) return aVol - bVol;
                    return compareMovimentoAsc(a, b);
                  });
                return (
                  <article key={row.lote_id} className={`coleta-row-card clv-row-card${row[pendingKey] > 0 ? " has-pending" : ""}`}>
                    <button
                      type="button"
                      className="coleta-row-line"
                      onClick={() => setExpandedLoteId(expanded ? null : row.lote_id)}
                    >
                      <div className="coleta-row-line-main">
                        <strong>Filial {row.filial}{row.filial_nome ? ` · ${row.filial_nome}` : ""}</strong>
                        <p>Pedido {row.pedido}{row.data_pedido ? ` · ${formatDateOnlyPtBR(row.data_pedido)}` : ""} · {row.rota ?? "Sem rota"}</p>
                        {rowOperador ? <small className="clv-row-operator">{rowOperador}</small> : null}
                      </div>
                      <div className={`clv-row-progress${progressComplete ? " is-complete" : ""}`}>
                        <ModuleIcon name="volume" />
                        <span>{progressDone} de {progressTotal}</span>
                      </div>
                      <div className="clv-row-expand" aria-label={expanded ? "Recolher volumes" : "Expandir volumes"}>
                        <ChevronIcon open={expanded} />
                      </div>
                    </button>
                    {expanded ? (
                      <div className="coleta-row-edit-card">
                        <div className="clv-mov-list">
                          {movimentosDaEtapa.map((mov) => (
                            <div key={`${mov.mov_id}:${mov.etapa}`} className={`clv-mov-item${mov.is_local ? " is-local" : ""}${mov.fracionado ? " is-fracionado" : ""}`}>
                              <div className="clv-mov-item-header">
                                <strong>{mov.etiqueta} · Vol {mov.volume ?? "-"}</strong>
                                {!mov.is_local && mov.mat_operador === profile.mat ? (
                                  <button
                                    type="button"
                                    className="clv-mov-delete-btn"
                                    aria-label="Excluir leitura"
                                    title="Excluir leitura"
                                    onClick={() => setDeleteMovConfirm({ movId: mov.mov_id, etiqueta: mov.etiqueta, volume: mov.volume })}
                                  >
                                    <TrashIcon />
                                  </button>
                                ) : null}
                              </div>
                              <span className="clv-mov-tipo">{getEtiquetaTipoLabel(mov.etiqueta)}</span>
                              {mov.fracionado ? (
                                <span className="clv-badge-fracionado">Fracionado · qtd {mov.fracionado_qtd ?? "-"} · {mov.fracionado_tipo ? CLV_FRACIONADO_TIPO_LABELS[mov.fracionado_tipo] : "-"}</span>
                              ) : null}
                              <small>{mov.is_local ? "Pendente local" : formatDateTime(mov.data_hr)}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="coleta-empty clv-stage-empty">
            Escolha uma etapa para iniciar o controle logístico.
          </div>
        )}
      </section>

      {showStagePicker ? (
        <div className="confirm-overlay clv-stage-modal-backdrop" role="presentation">
          <div
            className="confirm-dialog clv-stage-modal surface-enter"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clv-stage-modal-title"
          >
            <div className="clv-stage-modal-head">
              <div>
                <h3 id="clv-stage-modal-title">Escolha a etapa</h3>
                <p>Escolha o ponto do fluxo logístico que o funcionário vai operar agora.</p>
              </div>
              {etapa ? (
                <button type="button" className="clv-stage-modal-close" onClick={() => setShowStagePicker(false)} aria-label="Fechar escolha de etapa">
                  x
                </button>
              ) : null}
            </div>
            <div className="clv-stage-picker" aria-label="Etapas do controle logístico">
              {CLV_STAGE_ORDER.map((item, index) => {
                const meta = CLV_STAGE_META[item];
                const disabled = item !== "recebimento_cd" && !hasRecebimentoForCurrentCd;
                return (
                  <button
                    key={item}
                    type="button"
                    className={`clv-stage-card tone-${meta.tone}${etapa === item ? " is-active" : ""}${disabled ? " is-disabled" : ""}`}
                    onClick={() => chooseStage(item)}
                    disabled={disabled}
                  >
                    <span className="clv-stage-card-index">0{index + 1}</span>
                    <span className={`clv-stage-card-icon clv-stage-card-icon--${item}`} aria-hidden="true"><ModuleIcon name={meta.icon} /></span>
                    <span className="clv-stage-card-copy">
                      <small className="clv-stage-card-tag">{meta.tag}</small>
                      <strong>{meta.title}</strong>
                      <small>{disabled ? "Liberado somente apos o Recebimento CD." : meta.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {knappModalState && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="clv-knapp-title"
              onClick={() => {
                setKnappModalState(null);
                setIdKnappInput("");
                window.requestAnimationFrame(() => etiquetaRef.current?.focus({ preventScroll: true }));
              }}
            >
              <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="clv-knapp-title">Informe o ID Knapp</h3>
                <p>Etiqueta {knappModalState.etiqueta}. Informe o ID Knapp para concluir e voltar ao próximo bip.</p>
                <label>
                  ID Knapp
                  <div className="input-icon-wrap">
                    <span className="field-icon" aria-hidden="true">
                      <TagIcon />
                    </span>
                    <input
                      ref={knappInputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={idKnappInput}
                      onChange={(event: ReactChangeEvent<HTMLInputElement>) => {
                        const nextValue = event.target.value.replace(/\D/g, "");
                        setIdKnappInput(nextValue);

                        const state = knappInputStateRef.current;
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
                          clearKnappInputTimer();
                          return;
                        }

                        if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) {
                          scheduleKnappInputAutoSubmit(nextValue);
                          return;
                        }

                        clearKnappInputTimer();
                      }}
                      onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setKnappModalState(null);
                          setIdKnappInput("");
                          return;
                        }
                        if (event.key !== "Enter" && event.key !== "Tab") return;
                        event.preventDefault();
                        void commitKnappInput(idKnappInput);
                      }}
                      placeholder="8 dígitos"
                    />
                  </div>
                </label>
                <div className="confirm-actions">
                  <button
                    className="btn btn-muted"
                    type="button"
                    onClick={() => {
                      setKnappModalState(null);
                      setIdKnappInput("");
                    }}
                  >
                    Cancelar
                  </button>
                  <button className="btn btn-primary" type="button" onClick={() => void commitKnappInput(idKnappInput)}>
                    Validar ID Knapp
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {receiptContextModalState && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="clv-receipt-context-title"
              onClick={() => setReceiptContextModalState(null)}
            >
              <div className="confirm-dialog clv-context-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="clv-receipt-context-title">
                  {receiptContextModalState.action === "switch" ? "Trocar loja" : "Iniciar loja"}
                </h3>
                <p>Informe a quantidade total de volumes da filial. Esse total será a referência das próximas etapas.</p>
                <label>
                  Total de volumes
                  <div className="input-icon-wrap">
                    <span className="field-icon" aria-hidden="true">
                      <ModuleIcon name="volume" />
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={volumeTotalInput}
                      onChange={(event) => setVolumeTotalInput(event.target.value.replace(/\D/g, ""))}
                      placeholder="Quantidade total"
                      autoFocus
                    />
                  </div>
                </label>
                <div className="confirm-actions">
                  <button className="btn btn-muted" type="button" onClick={() => setReceiptContextModalState(null)}>
                    Cancelar
                  </button>
                  <button className="btn btn-primary" type="button" onClick={submitReceiptContextModal}>
                    Confirmar total
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {fractionModalDraft && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="clv-fracionado-title"
              onClick={() => setFractionModalDraft(null)}
            >
              <div className="confirm-dialog clv-context-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="clv-fracionado-title">Volume fracionado</h3>
                <p>Personalize apenas o próximo volume antes de informar a etiqueta.</p>
                <div className="coleta-form-grid">
                  <label>
                    Quantidade
                    <div className="input-icon-wrap">
                      <span className="field-icon" aria-hidden="true">
                        <SplitIcon />
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={fractionModalDraft.quantidade}
                        onChange={(event) => setFractionModalDraft((current) => (
                          current ? { ...current, quantidade: event.target.value.replace(/\D/g, "") } : current
                        ))}
                        placeholder="Qtd. fracionada"
                        autoFocus
                      />
                    </div>
                  </label>
                  <label>
                    Tipo
                    <div className="input-icon-wrap">
                      <span className="field-icon" aria-hidden="true">
                        <TypeIcon />
                      </span>
                      <select
                        value={fractionModalDraft.tipo}
                        onChange={(event) => setFractionModalDraft((current) => (
                          current ? { ...current, tipo: event.target.value as ClvFracionadoTipo } : current
                        ))}
                      >
                        {Object.entries(CLV_FRACIONADO_TIPO_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                  </label>
                </div>
                <div className="confirm-actions">
                  <button className="btn btn-muted" type="button" onClick={() => setFractionModalDraft(null)}>
                    Cancelar
                  </button>
                  <button className="btn btn-primary" type="button" onClick={confirmFractionModal}>
                    Aplicar ao próximo volume
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {scannerOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="scanner-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="clv-scanner-title"
              onClick={closeScanner}
            >
              <div className="scanner-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <div className="scanner-head">
                  <h3 id="clv-scanner-title">Scanner de etiqueta</h3>
                  <div className="scanner-head-actions">
                    <button className="scanner-close-btn" type="button" onClick={closeScanner} aria-label="Fechar scanner">
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
                <p className="scanner-hint">Aponte a câmera para leitura automática.</p>
                {scannerError ? <div className="alert error">{scannerError}</div> : null}
              </div>
            </div>,
            document.body
          )
        : null}

      {deleteMovConfirm && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="clv-delete-mov-title"
              onClick={() => setDeleteMovConfirm(null)}
            >
              <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="clv-delete-mov-title">Excluir leitura?</h3>
                <p>
                  A etiqueta <strong>{deleteMovConfirm.etiqueta}</strong>
                  {deleteMovConfirm.volume ? ` · Vol ${deleteMovConfirm.volume}` : ""} será removida permanentemente desta etapa.
                  Esta ação não pode ser desfeita.
                </p>
                <div className="confirm-actions">
                  <button className="btn btn-muted" type="button" disabled={busyDeleteMov} onClick={() => setDeleteMovConfirm(null)}>
                    Cancelar
                  </button>
                  <button className="btn btn-danger" type="button" disabled={busyDeleteMov} onClick={() => void confirmDeleteMovimento()}>
                    {busyDeleteMov ? "Excluindo..." : "Sim, excluir"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      <PendingSyncDialog
        isOpen={showPendingSyncModal}
        title="Pendências de sincronização"
        items={pendingOps.map((operation) => ({
          id: operation.local_id,
          title: operation.kind === "recebimento" ? "Recebimento" : CLV_ETAPA_LABELS[operation.payload.etapa],
          subtitle: `Etiqueta ${operation.parsed.etiqueta}`,
          detail: `Pedido ${operation.parsed.pedido} | Filial ${operation.parsed.filial}`,
          error: operation.sync_error,
          updatedAt: formatDateTime(operation.updated_at),
          onDiscard: () => void discardPending(operation.local_id)
        }))}
        emptyText="Nenhuma pendência encontrada."
        busy={busyPendingDiscard}
        onClose={() => setShowPendingSyncModal(false)}
        onDiscardAll={pendingOps.length > 0 ? () => void discardAllPending() : undefined}
      />
    </>
  );
}
