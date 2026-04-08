import { type ChangeEvent, FormEvent, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IScannerControls } from "@zxing/browser";
import { Link } from "react-router-dom";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDateOnlyPtBR, formatDateTimeBrasilia, formatTimeBrasilia, todayIsoBrasilia } from "../../shared/brasilia-datetime";
import { normalizeBarcode } from "../../shared/db-barras/sync";
import { useOnDemandSoftKeyboard } from "../../shared/use-on-demand-soft-keyboard";
import { BackIcon, CalendarIcon, EyeIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import { lookupProduto } from "../busca-produto/sync";
import type { BuscaProdutoLookupResult } from "../busca-produto/types";
import {
  addGestaoEstoqueItem,
  deleteGestaoEstoqueItem,
  fetchGestaoEstoqueAvailableDays,
  fetchGestaoEstoqueDayReviewState,
  fetchGestaoEstoqueEmRecebimentoList,
  fetchGestaoEstoqueList,
  fetchGestaoEstoqueNaoAtendidoList,
  fetchGestaoEstoqueProductHistory,
  fetchGestaoEstoqueStockUpdatedAt,
  normalizeGestaoEstoqueError,
  setGestaoEstoqueDayReviewStatus,
  updateGestaoEstoqueQuantity
} from "./sync";
import type {
  GestaoEstoqueAvailableDay,
  GestaoEstoqueDayReviewState,
  GestaoEstoqueDayReviewStatus,
  GestaoEstoqueEmRecebimentoRow,
  GestaoEstoqueItemRow,
  GestaoEstoqueModuleProfile,
  GestaoEstoqueMovementType,
  GestaoEstoqueNaoAtendidoRow,
  GestaoEstoqueProductHistoryRow
} from "./types";

interface GestaoEstoquePageProps {
  isOnline: boolean;
  profile: GestaoEstoqueModuleProfile;
}

type BarcodeValidationState = "idle" | "validating" | "valid" | "invalid";
type GestaoEstoqueListViewMode = "operacional" | "nao_atendido" | "em_recebimento";

const MODULE_DEF = getModuleByKeyOrThrow("gestao-estoque");
const REFRESH_INTERVAL_MS = 15000;
const SCANNER_INPUT_MAX_INTERVAL_MS = 45;
const SCANNER_INPUT_MIN_BURST_CHARS = 5;
const SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS = 90;
const SCANNER_INPUT_SUBMIT_COOLDOWN_MS = 600;

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

function fixedCdFromProfile(profile: GestaoEstoqueModuleProfile): number | null {
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

function formatInteger(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const isInteger = Math.abs(safe % 1) < 0.000001;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: isInteger ? 0 : 2,
    maximumFractionDigits: isInteger ? 0 : 2
  }).format(safe);
}

function formatCurrency(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `R$ ${formatNumber(value)}`;
}

function toFiniteQuantity(value: number | null): number {
  return value != null && Number.isFinite(value) ? value : 0;
}

function formatUnitQuantity(value: number): string {
  return `${formatNumber(value)} un`;
}

function formatInputCoddv(value: number): string {
  const digits = String(Math.trunc(value)).trim();
  if (digits.length <= 1) return digits;
  return `${digits.slice(0, -1)}-${digits.slice(-1)}`;
}

function formatDate(value: string | null): string {
  return formatDateOnlyPtBR(value, "-", "value");
}

function normalizeUtcTimestamp(value: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}[ t]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/i.test(raw)) {
    return `${raw.replace(" ", "T")}Z`;
  }

  return raw;
}

function formatDateTime(value: string | null): string {
  return formatDateTimeBrasilia(normalizeUtcTimestamp(value), {
    includeSeconds: true,
    emptyFallback: "-",
    invalidFallback: "value"
  });
}

function formatTime(value: string | null): string {
  return formatTimeBrasilia(normalizeUtcTimestamp(value), "-", "value");
}

function movementLabel(value: GestaoEstoqueMovementType): string {
  return value === "entrada" ? "Entrada" : "Baixa";
}

function reviewStatusLabel(value: GestaoEstoqueDayReviewStatus): string {
  return value === "revisado" ? "Revisado" : "Pendente";
}

function resolveCdLabel(profile: GestaoEstoqueModuleProfile, cd: number | null): string {
  const raw = typeof profile.cd_nome === "string" ? profile.cd_nome.trim().replace(/\s+/g, " ") : "";
  if (raw) return raw;
  if (cd != null) return `CD ${String(cd).padStart(2, "0")}`;
  return "CD não definido";
}

function joinAddresses(rows: { endereco: string }[]): string {
  if (!rows.length) return "-";
  return rows.map((row) => row.endereco).join(" | ");
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function sanitizeSearchCode(value: string): string {
  return normalizeBarcode(value).replace(/\D+/g, "");
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function buildRowSearchBlob(row: GestaoEstoqueItemRow): string {
  return normalizeSearchText([
    row.descricao,
    String(row.coddv),
    movementLabel(row.movement_type),
    row.endereco_sep ?? "",
    row.created_nome,
    row.created_mat,
    row.updated_nome,
    row.updated_mat,
    formatDate(row.dat_ult_compra)
  ].join(" "));
}

function buildNaoAtendidoSearchBlob(row: GestaoEstoqueNaoAtendidoRow): string {
  return normalizeSearchText([
    row.descricao,
    String(row.coddv),
    String(row.filial ?? ""),
    row.caixa ?? "",
    row.endereco ?? "",
    row.mat ?? "",
    formatDate(row.dat_ult_compra),
    formatTime(row.ocorrencia)
  ].join(" "));
}

function buildEmRecebimentoSearchBlob(row: GestaoEstoqueEmRecebimentoRow): string {
  return normalizeSearchText([
    row.descricao,
    String(row.coddv),
    String(row.seq_entrada ?? ""),
    row.transportadora,
    formatDateTime(row.dh_consistida),
    formatDateTime(row.dh_liberacao)
  ].join(" "));
}

function compareDateDesc(left: string, right: string): number {
  return right.localeCompare(left, "pt-BR");
}

function buildDayOptions(today: string, availableDays: GestaoEstoqueAvailableDay[]): GestaoEstoqueAvailableDay[] {
  const byDate = new Map<string, GestaoEstoqueAvailableDay>();
  byDate.set(today, {
    movement_date: today,
    item_count: 0,
    updated_at: null,
    is_today: true
  });
  for (const day of availableDays) {
    byDate.set(day.movement_date, day);
  }
  return [...byDate.values()].sort((left, right) => compareDateDesc(left.movement_date, right.movement_date));
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </svg>
  );
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

function checkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  );
}

function notAttendedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M9 9l6 6" />
      <path d="M15 9l-6 6" />
    </svg>
  );
}

function truckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7h12v8H3z" />
      <path d="M15 10h4l2 2v3h-6z" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="18" cy="17" r="2" />
    </svg>
  );
}

function RowTitleMeta({
  coddv,
  movementType
}: {
  coddv: number;
  movementType: GestaoEstoqueMovementType;
}) {
  const label = movementLabel(movementType);
  return (
    <>
      <span className="gestao-op-row-title-code gestao-op-row-title-code-desktop">CODDV {coddv}</span>
      <span className="gestao-op-row-title-code gestao-op-row-title-code-mobile">{coddv}</span>
      <span aria-hidden="true"> • </span>
      <span>{label}</span>
    </>
  );
}

function PreviewLabel({
  desktop,
  mobile
}: {
  desktop: string;
  mobile: string;
}) {
  return (
    <>
      <span className="gestao-op-preview-label-desktop">{desktop}</span>
      <span className="gestao-op-preview-label-mobile">{mobile}</span>
    </>
  );
}

function previewHistoryErrorMessage(error: unknown): string {
  const message = normalizeGestaoEstoqueError(error);
  if (
    message === "Sessão inválida. Faça login novamente." ||
    message === "Sessão expirada. Faça login novamente." ||
    message === "CD não definido para este usuário." ||
    message === "Sem acesso ao CD selecionado."
  ) {
    return message;
  }
  return "Histórico indisponível.";
}

function PreviewHistoryBlock({
  rows,
  loading,
  errorMessage
}: {
  rows: Array<{ data_mov: string; qtd_mov: number }>;
  loading: boolean;
  errorMessage: string | null;
}) {
  let content = null;

  if (loading) {
    content = <p className="gestao-op-preview-history-empty">Carregando...</p>;
  } else if (errorMessage) {
    content = <p className="gestao-op-preview-history-empty">{errorMessage}</p>;
  } else if (rows.length === 0) {
    content = <p className="gestao-op-preview-history-empty">Sem histórico.</p>;
  } else {
    content = (
      <div className="gestao-op-preview-history-list">
        {rows.map((row, index) => (
          <div key={`${row.data_mov}:${index}`} className="gestao-op-preview-history-row">
            <span>{formatDate(row.data_mov)}</span>
            <strong>{formatUnitQuantity(row.qtd_mov)}</strong>
          </div>
        ))}
      </div>
    );
  }

  return <div className="gestao-op-preview-history">{content}</div>;
}

function buildPreviewHistorySummary(rows: GestaoEstoqueProductHistoryRow[]): {
  totalQuantity: number;
  rows: Array<{ data_mov: string; qtd_mov: number }>;
} {
  const quantityByDate = new Map<string, number>();

  for (const row of rows) {
    const movementDate = String(row.data_mov ?? "").trim();
    if (!movementDate) continue;
    quantityByDate.set(movementDate, (quantityByDate.get(movementDate) ?? 0) + toFiniteQuantity(row.qtd_mov));
  }

  const summaryRows = [...quantityByDate.entries()]
    .map(([data_mov, qtd_mov]) => ({ data_mov, qtd_mov }))
    .sort((left, right) => compareDateDesc(left.data_mov, right.data_mov));

  return {
    totalQuantity: summaryRows.reduce((total, row) => total + row.qtd_mov, 0),
    rows: summaryRows
  };
}

export default function GestaoEstoquePage({ isOnline, profile }: GestaoEstoquePageProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocusItemIdRef = useRef<string | null>(null);
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
  const [movementType, setMovementType] = useState<GestaoEstoqueMovementType>("baixa");
  const [listViewMode, setListViewMode] = useState<GestaoEstoqueListViewMode>("operacional");
  const [selectedDate, setSelectedDate] = useState(todayIsoBrasilia());
  const [availableDays, setAvailableDays] = useState<GestaoEstoqueAvailableDay[]>([]);
  const [rows, setRows] = useState<GestaoEstoqueItemRow[]>([]);
  const [naoAtendidoRows, setNaoAtendidoRows] = useState<GestaoEstoqueNaoAtendidoRow[]>([]);
  const [emRecebimentoRows, setEmRecebimentoRows] = useState<GestaoEstoqueEmRecebimentoRow[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [barcodeValidationState, setBarcodeValidationState] = useState<BarcodeValidationState>("idle");
  const [quantidadeInput, setQuantidadeInput] = useState("");
  const [preview, setPreview] = useState<BuscaProdutoLookupResult | null>(null);
  const [previewHistoryRows, setPreviewHistoryRows] = useState<GestaoEstoqueProductHistoryRow[]>([]);
  const [busyPreviewHistory, setBusyPreviewHistory] = useState(false);
  const [previewHistoryError, setPreviewHistoryError] = useState<string | null>(null);
  const [busyLookup, setBusyLookup] = useState(false);
  const [busyList, setBusyList] = useState(false);
  const [busyNaoAtendidoList, setBusyNaoAtendidoList] = useState(false);
  const [busyEmRecebimentoList, setBusyEmRecebimentoList] = useState(false);
  const [busyExport, setBusyExport] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingQuantity, setEditingQuantity] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<GestaoEstoqueItemRow | null>(null);
  const [listSearchInput, setListSearchInput] = useState("");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [actionRow, setActionRow] = useState<GestaoEstoqueItemRow | null>(null);
  const [naoAtendidoActionRow, setNaoAtendidoActionRow] = useState<GestaoEstoqueNaoAtendidoRow | null>(null);
  const [naoAtendidoSendRow, setNaoAtendidoSendRow] = useState<GestaoEstoqueNaoAtendidoRow | null>(null);
  const [naoAtendidoSendQuantidade, setNaoAtendidoSendQuantidade] = useState("");
  const [busyNaoAtendidoSend, setBusyNaoAtendidoSend] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [estoqueUpdatedAt, setEstoqueUpdatedAt] = useState<string | null>(null);
  const [dayReviewState, setDayReviewState] = useState<GestaoEstoqueDayReviewState | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [pendingReviewStatus, setPendingReviewStatus] = useState<GestaoEstoqueDayReviewStatus>("pendente");
  const [busyReview, setBusyReview] = useState(false);
  const [exportChoiceOpen, setExportChoiceOpen] = useState(false);

  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const today = todayIsoBrasilia();
  const isHistorical = selectedDate !== today;
  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const currentCdLabel = useMemo(() => resolveCdLabel(profile, activeCd), [activeCd, profile]);
  const dayOptions = useMemo(() => buildDayOptions(today, availableDays), [availableDays, today]);
  const totalUnique = rows.length;
  const totalQuantidade = useMemo(() => rows.reduce((acc, row) => acc + row.quantidade, 0), [rows]);
  const totalValor = useMemo(() => rows.reduce((acc, row) => acc + row.custo_total, 0), [rows]);
  const listSearchQuery = useMemo(() => normalizeSearchText(listSearchInput), [listSearchInput]);
  const filteredRows = useMemo(() => {
    if (!listSearchQuery) return rows;
    return rows.filter((row) => buildRowSearchBlob(row).includes(listSearchQuery));
  }, [listSearchQuery, rows]);
  const filteredNaoAtendidoRows = useMemo(() => {
    if (!listSearchQuery) return naoAtendidoRows;
    return naoAtendidoRows.filter((row) => buildNaoAtendidoSearchBlob(row).includes(listSearchQuery));
  }, [listSearchQuery, naoAtendidoRows]);
  const filteredEmRecebimentoRows = useMemo(() => {
    if (!listSearchQuery) return emRecebimentoRows;
    return emRecebimentoRows.filter((row) => buildEmRecebimentoSearchBlob(row).includes(listSearchQuery));
  }, [emRecebimentoRows, listSearchQuery]);
  const listPanelTitle = useMemo(() => {
    if (isHistorical) return "Lista de Gestão - Somente leitura";
    if (listViewMode === "nao_atendido") return "Lista de Não Atendido";
    if (listViewMode === "em_recebimento") return "Lista em Recebimento";
    return "Lista da visão atual";
  }, [isHistorical, listViewMode]);
  const activeListCount = useMemo(() => {
    if (isHistorical || listViewMode === "operacional") return rows.length;
    if (listViewMode === "nao_atendido") return naoAtendidoRows.length;
    return emRecebimentoRows.length;
  }, [emRecebimentoRows.length, isHistorical, listViewMode, naoAtendidoRows.length, rows.length]);
  const activeFilteredListCount = useMemo(() => {
    if (isHistorical || listViewMode === "operacional") return filteredRows.length;
    if (listViewMode === "nao_atendido") return filteredNaoAtendidoRows.length;
    return filteredEmRecebimentoRows.length;
  }, [filteredEmRecebimentoRows.length, filteredNaoAtendidoRows.length, filteredRows.length, isHistorical, listViewMode]);
  const listCountLabel = useMemo(() => {
    if (listSearchQuery) {
      return `${formatInteger(activeFilteredListCount)} de ${formatInteger(activeListCount)} registro(s)`;
    }
    return `${formatInteger(activeListCount)} registro(s)`;
  }, [activeFilteredListCount, activeListCount, listSearchQuery]);
  const cameraSupported = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }, []);
  const barcodeIconClassName = `field-icon validation-status${barcodeValidationState === "validating" ? " is-validating" : ""}${barcodeValidationState === "valid" ? " is-valid" : ""}${barcodeValidationState === "invalid" ? " is-invalid" : ""}`;
  const hasSearchInput = searchInput.trim().length > 0;
  const currentReviewStatus = dayReviewState?.review_status ?? "pendente";
  const hasReviewers = (dayReviewState?.reviewers.length ?? 0) > 0;
  const exportDisabled = busyExport || rows.length === 0 || listViewMode !== "operacional";
  const previewEntryHistory = useMemo(
    () => buildPreviewHistorySummary(previewHistoryRows.filter((row) => row.movement_group === "entrada")),
    [previewHistoryRows]
  );
  const previewExitHistory = useMemo(
    () => buildPreviewHistorySummary(previewHistoryRows.filter((row) => row.movement_group === "saida")),
    [previewHistoryRows]
  );

  const focusSearch = useCallback(() => {
    disableSearchSoftKeyboard();
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, [disableSearchSoftKeyboard]);

  const focusRow = useCallback((itemId: string) => {
    pendingFocusItemIdRef.current = itemId;
    window.requestAnimationFrame(() => {
      const node = rowRefs.current.get(itemId);
      if (!node) return;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.focus();
      pendingFocusItemIdRef.current = null;
    });
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

  const refreshDays = useCallback(async () => {
    if (activeCd == null) {
      setAvailableDays([]);
      return;
    }
    const nextDays = await fetchGestaoEstoqueAvailableDays(activeCd);
    setAvailableDays(nextDays);
  }, [activeCd]);

  const refreshRows = useCallback(async () => {
    if (activeCd == null) {
      setRows([]);
      return;
    }
    setBusyList(true);
    try {
      const nextRows = await fetchGestaoEstoqueList({
        cd: activeCd,
        date: selectedDate,
        movementType
      });
      setRows(nextRows);
    } finally {
      setBusyList(false);
    }
  }, [activeCd, movementType, selectedDate]);

  const refreshNaoAtendidoRows = useCallback(async () => {
    if (activeCd == null || isHistorical) {
      setNaoAtendidoRows([]);
      return;
    }
    setBusyNaoAtendidoList(true);
    try {
      const nextRows = await fetchGestaoEstoqueNaoAtendidoList(activeCd);
      setNaoAtendidoRows(nextRows);
    } finally {
      setBusyNaoAtendidoList(false);
    }
  }, [activeCd, isHistorical]);

  const refreshEmRecebimentoRows = useCallback(async () => {
    if (activeCd == null || isHistorical) {
      setEmRecebimentoRows([]);
      return;
    }
    setBusyEmRecebimentoList(true);
    try {
      const nextRows = await fetchGestaoEstoqueEmRecebimentoList(activeCd);
      setEmRecebimentoRows(nextRows);
    } finally {
      setBusyEmRecebimentoList(false);
    }
  }, [activeCd, isHistorical]);

  const refreshStockUpdatedAt = useCallback(async () => {
    if (activeCd == null) {
      setEstoqueUpdatedAt(null);
      return;
    }
    const nextUpdatedAt = await fetchGestaoEstoqueStockUpdatedAt(activeCd);
    setEstoqueUpdatedAt(nextUpdatedAt);
  }, [activeCd]);

  const refreshDayReviewState = useCallback(async () => {
    if (activeCd == null) {
      setDayReviewState(null);
      setPendingReviewStatus("pendente");
      return;
    }
    const nextState = await fetchGestaoEstoqueDayReviewState({
      cd: activeCd,
      date: selectedDate
    });
    setDayReviewState(nextState);
    setPendingReviewStatus(nextState.review_status);
  }, [activeCd, selectedDate]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshDays(), refreshRows(), refreshStockUpdatedAt(), refreshDayReviewState()]);
  }, [refreshDayReviewState, refreshDays, refreshRows, refreshStockUpdatedAt]);

  const clearPreview = useCallback(() => {
    setPreview(null);
    setPreviewHistoryRows([]);
    setPreviewHistoryError(null);
    setBusyPreviewHistory(false);
    setSearchInput("");
    setBarcodeValidationState("idle");
    setQuantidadeInput("");
  }, []);

  const executeLookup = useCallback(async (rawOverride?: string) => {
    const rawValue = sanitizeSearchCode(rawOverride ?? searchInput);
    const normalized = normalizeBarcode(rawValue);
    if (!normalized) {
      setErrorMessage("Informe código de barras ou CODDV.");
      setStatusMessage(null);
      setPreview(null);
      setBarcodeValidationState("invalid");
      focusSearch();
      return;
    }
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      setStatusMessage(null);
      setPreview(null);
      setBarcodeValidationState("invalid");
      return;
    }

    setBusyLookup(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setBarcodeValidationState("validating");

    try {
      let found: BuscaProdutoLookupResult | null = null;
      try {
        found = await lookupProduto({ cd: activeCd, barras: normalized });
      } catch (error) {
        const message = normalizeGestaoEstoqueError(error).toUpperCase();
        if (!message.includes("PRODUTO NÃO ENCONTRADO") && !message.includes("PRODUTO_NAO_ENCONTRADO")) {
          throw error;
        }
      }

      if (!found && /^\d+$/.test(rawValue)) {
        const parsedCoddv = Number.parseInt(rawValue, 10);
        if (Number.isFinite(parsedCoddv) && parsedCoddv > 0) {
          found = await lookupProduto({ cd: activeCd, coddv: parsedCoddv });
        }
      }

      if (!found) {
        setPreview(null);
        setErrorMessage("Produto não encontrado.");
        setBarcodeValidationState("invalid");
        focusSearch();
        return;
      }

      setPreview(found);
      setPreviewHistoryRows([]);
      setPreviewHistoryError(null);
      setStatusMessage("Produto localizado com sucesso.");
      setBarcodeValidationState("valid");
      setQuantidadeInput("");
      focusSearch();
    } catch (error) {
      setPreview(null);
      setErrorMessage(normalizeGestaoEstoqueError(error));
      setBarcodeValidationState("invalid");
      focusSearch();
    } finally {
      setBusyLookup(false);
    }
  }, [activeCd, focusSearch, searchInput]);

  const clearScannerInputTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current;
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const commitScannerInput = useCallback(async (rawValue: string) => {
    const normalized = sanitizeSearchCode(rawValue);
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
    setPreview(null);
    setPreviewHistoryRows([]);
    setPreviewHistoryError(null);
    setErrorMessage(null);
    setStatusMessage(null);
    setBarcodeValidationState("idle");
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
    const nextValue = sanitizeSearchCode(event.target.value);
    setSearchInput(nextValue);
    setPreview(null);
    setPreviewHistoryRows([]);
    setPreviewHistoryError(null);
    setErrorMessage(null);
    setStatusMessage(null);
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

  const onSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !shouldHandleScannerTab(searchInput)) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    void commitScannerInput(searchInput);
  }, [commitScannerInput, searchInput, shouldHandleScannerTab]);

  const startEditingRow = useCallback((row: GestaoEstoqueItemRow) => {
    setEditingItemId(row.id);
    setEditingQuantity(String(row.quantidade));
    setExpandedRowId(row.id);
    focusRow(row.id);
  }, [focusRow]);

  const onSubmitAdd = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (preview == null) {
      await executeLookup();
      return;
    }
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      return;
    }
    if (isHistorical) {
      setErrorMessage("Dias anteriores ficam somente para consulta.");
      return;
    }
    const quantidade = parsePositiveInt(quantidadeInput);
    if (quantidade == null) {
      setErrorMessage("Informe uma quantidade válida.");
      return;
    }
    if (movementType === "baixa" && quantidade > preview.qtd_est_atual) {
      setErrorMessage("A quantidade de baixa excede o estoque atual.");
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await addGestaoEstoqueItem({
        cd: activeCd,
        date: selectedDate,
        movementType,
        coddv: preview.coddv,
        quantidade
      });
      await refreshAll();
      if (result.status === "already_exists") {
        setStatusMessage(result.message);
        startEditingRow(result.row);
        return;
      }

      setStatusMessage(result.message);
      clearPreview();
      focusSearch();
    } catch (error) {
      setErrorMessage(normalizeGestaoEstoqueError(error));
    }
  }, [
    activeCd,
    clearPreview,
    executeLookup,
    focusSearch,
    isHistorical,
    movementType,
    preview,
    quantidadeInput,
    refreshAll,
    selectedDate,
    startEditingRow
  ]);

  const saveEditingRow = useCallback(async (row: GestaoEstoqueItemRow) => {
    const quantidade = parsePositiveInt(editingQuantity);
    if (quantidade == null) {
      setErrorMessage("Informe uma quantidade válida.");
      return;
    }
    try {
      await updateGestaoEstoqueQuantity({
        itemId: row.id,
        quantidade,
        expectedUpdatedAt: row.updated_at
      });
      setStatusMessage("Quantidade atualizada.");
      setErrorMessage(null);
      setEditingItemId(null);
      setEditingQuantity("");
      setExpandedRowId(row.id);
      await refreshAll();
      focusRow(row.id);
    } catch (error) {
      setErrorMessage(normalizeGestaoEstoqueError(error));
    }
  }, [editingQuantity, focusRow, refreshAll]);

  const confirmRemoveRow = useCallback(async () => {
    const row = confirmDeleteRow;
    if (!row || pendingDeleteId) return;
    setPendingDeleteId(row.id);
    try {
      await deleteGestaoEstoqueItem({
        itemId: row.id,
        expectedUpdatedAt: row.updated_at
      });
      setStatusMessage("Item excluído.");
      setErrorMessage(null);
      setEditingItemId((current) => (current === row.id ? null : current));
      setEditingQuantity("");
      setConfirmDeleteRow(null);
      await refreshAll();
      focusSearch();
    } catch (error) {
      setErrorMessage(normalizeGestaoEstoqueError(error));
    } finally {
      setPendingDeleteId(null);
    }
  }, [confirmDeleteRow, focusSearch, pendingDeleteId, refreshAll]);

  const removeRow = useCallback(async (row: GestaoEstoqueItemRow) => {
    if (pendingDeleteId) return;
    setConfirmDeleteRow(row);
  }, [pendingDeleteId]);

  const toggleExpandedRow = useCallback((rowId: string) => {
    setExpandedRowId((current) => (current === rowId ? null : rowId));
  }, []);

  const openRowActions = useCallback((row: GestaoEstoqueItemRow) => {
    setActionRow(row);
  }, []);

  const openNaoAtendidoActions = useCallback((row: GestaoEstoqueNaoAtendidoRow) => {
    if (row.is_em_baixa) return;
    setNaoAtendidoActionRow(row);
  }, []);

  const toggleListViewMode = useCallback((mode: Exclude<GestaoEstoqueListViewMode, "operacional">) => {
    setExpandedRowId(null);
    setListSearchInput("");
    setListViewMode((current) => (current === mode ? "operacional" : mode));
  }, []);

  const openReviewModal = useCallback(() => {
    setPendingReviewStatus(currentReviewStatus);
    setReviewModalOpen(true);
  }, [currentReviewStatus]);

  const openExportChoices = useCallback(() => {
    if (busyExport || rows.length === 0 || listViewMode !== "operacional") return;
    setExportChoiceOpen(true);
  }, [busyExport, listViewMode, rows.length]);

  const submitNaoAtendidoSend = useCallback(async () => {
    if (activeCd == null || naoAtendidoSendRow == null || busyNaoAtendidoSend) return;
    const quantidade = parsePositiveInt(naoAtendidoSendQuantidade);
    if (quantidade == null) {
      setErrorMessage("Informe uma quantidade válida.");
      return;
    }
    if (quantidade > naoAtendidoSendRow.estoque) {
      setErrorMessage("A quantidade de baixa excede o estoque atual.");
      return;
    }

    setBusyNaoAtendidoSend(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await addGestaoEstoqueItem({
        cd: activeCd,
        date: selectedDate,
        movementType: "baixa",
        coddv: naoAtendidoSendRow.coddv,
        quantidade
      });
      await Promise.all([refreshDays(), refreshRows(), refreshNaoAtendidoRows()]);
      setStatusMessage(result.message);
      setNaoAtendidoSendQuantidade("");
      setNaoAtendidoSendRow(null);
      setNaoAtendidoActionRow(null);
    } catch (error) {
      setErrorMessage(normalizeGestaoEstoqueError(error));
    } finally {
      setBusyNaoAtendidoSend(false);
    }
  }, [
    activeCd,
    busyNaoAtendidoSend,
    naoAtendidoSendQuantidade,
    naoAtendidoSendRow,
    refreshDays,
    refreshNaoAtendidoRows,
    refreshRows,
    selectedDate
  ]);

  const saveDayReviewStatus = useCallback(async () => {
    if (activeCd == null || busyReview) return;
    setBusyReview(true);
    try {
      const nextState = await setGestaoEstoqueDayReviewStatus({
        cd: activeCd,
        date: selectedDate,
        status: pendingReviewStatus
      });
      setDayReviewState(nextState);
      setPendingReviewStatus(nextState.review_status);
      setStatusMessage(`Status do dia alterado para ${reviewStatusLabel(nextState.review_status).toLocaleLowerCase("pt-BR")}.`);
      setErrorMessage(null);
      setReviewModalOpen(false);
    } catch (error) {
      setErrorMessage(normalizeGestaoEstoqueError(error));
    } finally {
      setBusyReview(false);
    }
  }, [activeCd, busyReview, pendingReviewStatus, selectedDate]);

  const exportPdf = useCallback(async () => {
    setBusyExport(true);
    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      doc.setFontSize(16);
      doc.text(MODULE_DEF.title, 40, 42);
      doc.setFontSize(10);
      doc.text(`CD: ${currentCdLabel}`, 40, 62);
      doc.text(`Data: ${formatDate(selectedDate)}`, 180, 62);
      doc.text(`Visão: ${movementLabel(movementType)}`, 300, 62);
      doc.text(`Emitido por: ${displayUserName} (${profile.mat || "-"})`, 440, 62);

      autoTable(doc, {
        startY: 78,
        head: [[
          "CodDv",
          "Descrição",
          "Tipo",
          "Quantidade",
          "Últ. compra",
          "Custo unit.",
          "Custo total",
          "End. de Separação",
          "End. de Pulmão",
          "Criado / Editado"
        ]],
        body: rows.map((row) => [
          String(row.coddv),
          row.descricao,
          movementLabel(row.movement_type),
          formatInteger(row.quantidade),
          formatDate(row.dat_ult_compra),
          formatCurrency(row.custo_unitario),
          formatCurrency(row.custo_total),
          row.endereco_sep ?? "-",
          row.endereco_pul ?? "-",
          `${row.created_nome} ${row.created_mat}\n${formatDateTime(row.updated_at)}`
        ]),
        margin: { left: 30, right: 30 },
        styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
        headStyles: { fillColor: [27, 70, 133] }
      });

      doc.save(`gestao-estoque-${movementType}-${selectedDate}.pdf`);
      setStatusMessage("PDF gerado com sucesso.");
      setErrorMessage(null);
      await refreshRows();
    } catch (error) {
      setErrorMessage(normalizeGestaoEstoqueError(error));
    } finally {
      setBusyExport(false);
    }
  }, [currentCdLabel, displayUserName, movementType, profile.mat, refreshRows, rows, selectedDate]);

  const exportXlsx = useCallback(async () => {
    setBusyExport(true);
    try {
      const XLSX = await import("xlsx");
      const exportBaseName = `gestao-estoque-${movementType}-${selectedDate}`;
      const itemRows = rows.map((row) => ({
        Data: formatDate(row.movement_date),
        Tipo: movementLabel(row.movement_type),
        CODDV: row.coddv,
        Descricao: row.descricao,
        Quantidade: row.quantidade,
        QtdEstAtual: row.qtd_est_atual,
        QtdEstDisp: row.qtd_est_disp,
        DataUltCompra: formatDate(row.dat_ult_compra),
        CustoUnitario: row.custo_unitario ?? 0,
        CustoTotal: row.custo_total,
        EnderecoSEP: row.endereco_sep ?? "",
        EnderecoPUL: row.endereco_pul ?? "",
        CriadoPor: `${row.created_nome} (${row.created_mat})`,
        CriadoEm: formatDateTime(row.created_at),
        EditadoPor: `${row.updated_nome} (${row.updated_mat})`,
        EditadoEm: formatDateTime(row.updated_at),
        AtualizadoAoVivoEm: formatDateTime(row.resolved_refreshed_at)
      }));
      const summaryRows = [{
        CD: currentCdLabel,
        Data: formatDate(selectedDate),
        Visao: movementLabel(movementType),
        ItensUnicos: totalUnique,
        QuantidadeTotal: totalQuantidade,
        ValorTotal: totalValor
      }];
      const inputRows = rows.map((row) => [formatInputCoddv(row.coddv), row.quantidade]);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(itemRows), "Itens");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Resumo");

      const inputWorkbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(inputWorkbook, XLSX.utils.aoa_to_sheet(inputRows), "Input");

      XLSX.writeFile(workbook, `${exportBaseName}.xlsx`, { compression: true });
      XLSX.writeFile(inputWorkbook, `${exportBaseName}-input.xlsx`, { compression: true });
      setStatusMessage("2 arquivos Excel gerados com sucesso.");
      setErrorMessage(null);
      await refreshRows();
    } catch (error) {
      setErrorMessage(normalizeGestaoEstoqueError(error));
    } finally {
      setBusyExport(false);
    }
  }, [currentCdLabel, movementType, refreshRows, rows, selectedDate, totalQuantidade, totalUnique, totalValor]);

  useEffect(() => {
    void refreshAll().catch((error) => setErrorMessage(normalizeGestaoEstoqueError(error)));
  }, [refreshAll]);

  useEffect(() => {
    if (isHistorical) {
      setListViewMode("operacional");
      setNaoAtendidoRows([]);
      setEmRecebimentoRows([]);
      setNaoAtendidoActionRow(null);
      setNaoAtendidoSendRow(null);
      setNaoAtendidoSendQuantidade("");
      return;
    }

    if (listViewMode === "nao_atendido") {
      void refreshNaoAtendidoRows().catch((error) => setErrorMessage(normalizeGestaoEstoqueError(error)));
      return;
    }

    if (listViewMode === "em_recebimento") {
      void refreshEmRecebimentoRows().catch((error) => setErrorMessage(normalizeGestaoEstoqueError(error)));
    }
  }, [isHistorical, listViewMode, refreshEmRecebimentoRows, refreshNaoAtendidoRows]);

  useEffect(() => {
    setExpandedRowId(null);
    setEditingItemId(null);
    setEditingQuantity("");
    setActionRow(null);
    setNaoAtendidoActionRow(null);
    setNaoAtendidoSendRow(null);
    setNaoAtendidoSendQuantidade("");
  }, [listViewMode, selectedDate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const scrollToTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    };
    scrollToTop();
    const frameId = window.requestAnimationFrame(scrollToTop);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    const pendingId = pendingFocusItemIdRef.current;
    if (!pendingId) return;
    focusRow(pendingId);
  }, [rows, focusRow]);

  useEffect(() => {
    if (activeCd == null || preview == null) {
      setPreviewHistoryRows([]);
      setPreviewHistoryError(null);
      setBusyPreviewHistory(false);
      return;
    }

    let cancelled = false;
    setBusyPreviewHistory(true);
    setPreviewHistoryError(null);
    setPreviewHistoryRows([]);

    void fetchGestaoEstoqueProductHistory({
      cd: activeCd,
      coddv: preview.coddv
    })
      .then((nextRows) => {
        if (cancelled) return;
        setPreviewHistoryRows(nextRows);
      })
      .catch((error) => {
        if (cancelled) return;
        setPreviewHistoryRows([]);
        setPreviewHistoryError(previewHistoryErrorMessage(error));
      })
      .finally(() => {
        if (cancelled) return;
        setBusyPreviewHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeCd, preview?.coddv]);

  useEffect(() => {
    if (isHistorical) return;
    if (!isOnline) return;

    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      const tasks: Promise<unknown>[] = [refreshRows(), refreshStockUpdatedAt(), refreshDayReviewState()];
      if (listViewMode === "nao_atendido") tasks.push(refreshNaoAtendidoRows());
      if (listViewMode === "em_recebimento") tasks.push(refreshEmRecebimentoRows());
      void Promise.all(tasks).catch((error) => setErrorMessage(normalizeGestaoEstoqueError(error)));
    };

    const timerId = window.setInterval(refreshIfVisible, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timerId);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [isHistorical, isOnline, listViewMode, refreshDayReviewState, refreshEmRecebimentoRows, refreshNaoAtendidoRows, refreshRows, refreshStockUpdatedAt]);

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
          <Link to="/inicio" className="module-back-btn" aria-label="Voltar para o início">
            <span className="module-back-icon" aria-hidden="true"><BackIcon /></span>
            <span>Início</span>
          </Link>
          <div className="module-topbar-user-side">
            <span className="module-user-greeting">Olá, {displayUserName}</span>
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
              {isOnline ? "🟢 Online" : "🔴 Offline"}
            </span>
          </div>
        </div>
        <div
          className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone} gestao-op-header-card gestao-op-header-card--${movementType}`}
        >
          <span className="module-icon" aria-hidden="true"><ModuleIcon name={MODULE_DEF.icon} /></span>
          <div className="gestao-op-header-copy">
            <span className="module-title">{MODULE_DEF.title}</span>
            <span className="gestao-op-header-cd">{currentCdLabel}</span>
          </div>
        </div>
      </header>

      <section className={`module-screen surface-enter gestao-op-screen gestao-op-screen--${movementType}`}>
        <div className="module-screen-header">
          <div className="module-screen-title-row">
            <div className="module-screen-title">
              <h2>Ajuste Diário de Estoque</h2>
            </div>
          </div>
          <div className="gestao-op-header-meta">
            <span className="gestao-op-date-pill">
              Data ativa: {formatDate(selectedDate)} {isHistorical ? "(somente leitura)" : "(dia atual)"}
            </span>
            <span className="gestao-op-date-pill">
              Dados atualizados em: {formatDateTime(estoqueUpdatedAt)}
            </span>
          </div>
        </div>

        <div className="gestao-op-toolbar">
          <div className="gestao-op-toolbar-primary">
            <div className="gestao-op-segmented" role="tablist" aria-label="Tipo de movimentação">
              <button
                type="button"
                className={movementType === "baixa" ? "is-active" : ""}
                onClick={() => setMovementType("baixa")}
              >
                Baixa
              </button>
              <button
                type="button"
                className={movementType === "entrada" ? "is-active" : ""}
                onClick={() => setMovementType("entrada")}
              >
                Entrada
              </button>
            </div>

            <button
              type="button"
              className={`gestao-op-review-trigger is-${currentReviewStatus}`}
              onClick={openReviewModal}
              aria-label={`Status do dia: ${reviewStatusLabel(currentReviewStatus)}. Clique para alterar ou ver detalhes.`}
              title={`Status do dia: ${reviewStatusLabel(currentReviewStatus)}`}
            >
              <span className="gestao-op-review-trigger-icon" aria-hidden="true">
                {checkIcon()}
              </span>
              <span className="gestao-op-review-trigger-copy">
                <span className="gestao-op-review-trigger-label">Status</span>
                <span className="gestao-op-review-trigger-value">{reviewStatusLabel(currentReviewStatus)}</span>
              </span>
            </button>

            {!isHistorical ? (
              <>
                <button
                  type="button"
                  className={`gestao-op-view-trigger gestao-op-view-trigger--desktop${listViewMode === "nao_atendido" ? " is-active" : ""}`}
                  onClick={() => toggleListViewMode("nao_atendido")}
                  title="Visualizar não atendido"
                  aria-label="Visualizar não atendido"
                >
                  <span className="gestao-op-view-trigger-icon" aria-hidden="true">{notAttendedIcon()}</span>
                  <span className="gestao-op-view-trigger-copy">Não Atendido</span>
                </button>

                <button
                  type="button"
                  className={`gestao-op-view-trigger gestao-op-view-trigger--desktop${listViewMode === "em_recebimento" ? " is-active" : ""}`}
                  onClick={() => toggleListViewMode("em_recebimento")}
                  title="Visualizar em recebimento"
                  aria-label="Visualizar em recebimento"
                >
                  <span className="gestao-op-view-trigger-icon" aria-hidden="true">{truckIcon()}</span>
                  <span className="gestao-op-view-trigger-copy">Em Recebimento</span>
                </button>
              </>
            ) : null}
          </div>

          <label className="gestao-op-day-picker">
            <span className="gestao-op-day-icon" aria-hidden="true"><CalendarIcon /></span>
            <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
              {dayOptions.map((day) => (
                <option key={day.movement_date} value={day.movement_date}>
                  {formatDate(day.movement_date)}{day.is_today ? " • Hoje" : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="gestao-op-actions">
            <button className="btn btn-primary gestao-op-export-trigger" type="button" onClick={openExportChoices} disabled={exportDisabled}>
              {busyExport ? "Gerando..." : "Exportar"}
            </button>
          </div>
        </div>

        {statusMessage ? <div className="module-inline-message">{statusMessage}</div> : null}
        {errorMessage ? <div className="module-inline-error">{errorMessage}</div> : null}

        <div className="gestao-op-metrics">
          <article className="module-card module-card-static gestao-op-metric-card">
            <span>Itens únicos</span>
            <strong>{formatInteger(totalUnique)}</strong>
          </article>
          <article className="module-card module-card-static gestao-op-metric-card">
            <span>Quantidade total</span>
            <strong>{formatInteger(totalQuantidade)}</strong>
          </article>
          <article className="module-card module-card-static gestao-op-metric-card">
            <span>Valor total</span>
            <strong>{formatCurrency(totalValor)}</strong>
          </article>
        </div>

        {!isHistorical ? (
          <div className="gestao-op-grid">
            <article className="module-card module-card-static gestao-op-panel">
              <div className="gestao-op-panel-head">
                <h3>Localizar produto</h3>
                <span></span>
              </div>
              <div className="gestao-op-panel-body">
                <form className="gestao-op-search-form" onSubmit={onSubmitAdd}>
                  <div className="gestao-op-field">
                    <label htmlFor="gestao-op-search">Barras ou CODDV</label>
                    <div className="gestao-op-inline-field">
                      <div className="input-icon-wrap with-action gestao-op-mobile-search-wrap">
                        <span className={barcodeIconClassName} aria-hidden="true">
                          {barcodeIcon()}
                        </span>
                        <input
                          id="gestao-op-search"
                          ref={searchInputRef}
                          type="text"
                          value={searchInput}
                          onChange={onSearchInputChange}
                          onKeyDown={onSearchKeyDown}
                          onFocus={enableSearchSoftKeyboard}
                          onPointerDown={enableSearchSoftKeyboard}
                          onBlur={disableSearchSoftKeyboard}
                          placeholder="Bipe, digite ou use câmera"
                          autoComplete="off"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          inputMode={searchInputMode}
                          enterKeyHint="search"
                          disabled={isHistorical}
                        />
                        <button
                          type="button"
                          className="input-action-btn gestao-op-mobile-camera-btn"
                          onClick={hasSearchInput ? () => void executeLookup() : openCameraScanner}
                          title={hasSearchInput ? "Buscar produto" : "Ler código pela câmera"}
                          aria-label={hasSearchInput ? "Buscar produto" : "Ler código pela câmera"}
                          disabled={hasSearchInput ? busyLookup || isHistorical : !cameraSupported || busyLookup || isHistorical}
                        >
                          {hasSearchInput ? searchIcon() : cameraIcon()}
                        </button>
                      </div>
                      <button className="btn btn-muted gestao-op-search-btn" type="button" onClick={() => void executeLookup()} disabled={busyLookup || isHistorical}>
                        {busyLookup ? "Buscando..." : "Buscar"}
                      </button>
                    </div>
                  </div>

                  <div className="gestao-op-field">
                    <label htmlFor="gestao-op-qty">Quantidade</label>
                    <input
                      id="gestao-op-qty"
                      type="number"
                      min={1}
                      max={movementType === "baixa" && preview ? Math.max(preview.qtd_est_atual, 1) : undefined}
                      value={quantidadeInput}
                      onChange={(event) => setQuantidadeInput(event.target.value)}
                      inputMode="numeric"
                      disabled={isHistorical}
                    />
                    {movementType === "baixa" && preview ? (
                      <small>Máximo para baixa: {formatInteger(preview.qtd_est_atual)}</small>
                    ) : (
                      <small>Para entrada não há limitador.</small>
                    )}
                  </div>

                  <button className="btn btn-primary gestao-op-add-btn" type="submit" disabled={preview == null || isHistorical}>
                    Adicionar à lista
                  </button>
                </form>
              </div>
            </article>

            <article className="module-card module-card-static gestao-op-panel">
              <div className="gestao-op-panel-head">
                <h3>Pré-visualização</h3>
                <span>Detalhes</span>
              </div>
              <div className="gestao-op-panel-body gestao-op-panel-body--preview">
                {preview ? (
                  <div className="gestao-op-preview">
                    <div className="gestao-op-preview-head">
                      <div className="gestao-op-preview-head-copy">
                        <strong>{preview.descricao}</strong>
                        <span>CODDV {preview.coddv}</span>
                      </div>
                      <div className="gestao-op-preview-head-meta">
                        <div className="gestao-op-preview-head-chip">
                          <small>Últ. compra</small>
                          <strong>{formatDate(preview.dat_ult_compra)}</strong>
                        </div>
                        <div className="gestao-op-preview-head-chip">
                          <small>R$ unit.</small>
                          <strong>{formatCurrency(preview.custo_unitario)}</strong>
                        </div>
                      </div>
                    </div>
                    <dl>
                      <div className="gestao-op-preview-item gestao-op-preview-item--sep">
                        <dt><PreviewLabel desktop="Endereço de Separação" mobile="End. separação" /></dt>
                        <dd>{joinAddresses(preview.enderecos_sep)}</dd>
                      </div>
                      <div className="gestao-op-preview-item gestao-op-preview-item--pul">
                        <dt><PreviewLabel desktop="Endereço de Pulmão" mobile="End. pulmão" /></dt>
                        <dd>{joinAddresses(preview.enderecos_pul)}</dd>
                      </div>
                      <div className="gestao-op-preview-item gestao-op-preview-item--stock">
                        <dt><PreviewLabel desktop="Estoque atual" mobile="Est. atual" /></dt>
                        <dd>{formatInteger(preview.qtd_est_atual)}</dd>
                      </div>
                      <div className="gestao-op-preview-item gestao-op-preview-item--stock">
                        <dt><PreviewLabel desktop="Estoque disponível" mobile="Est. disponível" /></dt>
                        <dd>{formatInteger(preview.qtd_est_disp)}</dd>
                      </div>
                      <div className="gestao-op-preview-item gestao-op-preview-item--history">
                        <dt><PreviewLabel desktop={`Hist. de Entrada (${formatUnitQuantity(previewEntryHistory.totalQuantity)})`} mobile={`Hist. entrada (${formatUnitQuantity(previewEntryHistory.totalQuantity)})`} /></dt>
                        <dd>
                          <PreviewHistoryBlock
                            rows={previewEntryHistory.rows}
                            loading={busyPreviewHistory}
                            errorMessage={previewHistoryError}
                          />
                        </dd>
                      </div>
                      <div className="gestao-op-preview-item gestao-op-preview-item--history">
                        <dt><PreviewLabel desktop={`Hist. de Saída (${formatUnitQuantity(previewExitHistory.totalQuantity)})`} mobile={`Hist. saída (${formatUnitQuantity(previewExitHistory.totalQuantity)})`} /></dt>
                        <dd>
                          <PreviewHistoryBlock
                            rows={previewExitHistory.rows}
                            loading={busyPreviewHistory}
                            errorMessage={previewHistoryError}
                          />
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : (
                  <div className="coleta-empty gestao-op-preview-empty">Nenhum produto selecionado.</div>
                )}
              </div>
            </article>
          </div>
        ) : null}

        <article className="module-card module-card-static gestao-op-list-panel">
          <div className="gestao-op-panel-head">
            <h3>{listPanelTitle}</h3>
            <span>{listCountLabel}</span>
          </div>
          <div className="gestao-op-list-toolbar">
            <label className="gestao-op-list-search">
              <span>Buscar na lista</span>
              <input
                type="text"
                value={listSearchInput}
                onChange={(event) => setListSearchInput(event.target.value)}
                placeholder="Filtrar por descrição, CODDV, usuário..."
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
          {listViewMode === "nao_atendido" && !isHistorical ? (
            busyNaoAtendidoList && naoAtendidoRows.length === 0 ? (
              <div className="coleta-empty">Carregando não atendido...</div>
            ) : naoAtendidoRows.length === 0 ? (
              <div className="coleta-empty">Nenhum item de não atendido encontrado para o CD atual.</div>
            ) : filteredNaoAtendidoRows.length === 0 ? (
              <div className="coleta-empty">Nenhum item encontrado para o filtro informado.</div>
            ) : (
              <div className="gestao-op-table">
                <div className="gestao-op-table-head is-nao-atendido" role="row">
                  <span>Produto</span>
                  <span>Ocorrência</span>
                  <span>Filial</span>
                  <span>Não Atendido</span>
                  <span>Não Atendido Total</span>
                  <span>Estoque</span>
                  <span className="gestao-op-table-head-actions">Ações</span>
                  <span>Status</span>
                </div>
                {filteredNaoAtendidoRows.map((row, index) => {
                  const rowKey = `nao-atendido:${row.coddv}:${row.ocorrencia ?? "sem-ocorrencia"}:${index}`;
                  const isExpanded = expandedRowId === rowKey;
                  return (
                    <div
                      key={rowKey}
                      ref={(node) => {
                        if (node) rowRefs.current.set(rowKey, node);
                        else rowRefs.current.delete(rowKey);
                      }}
                      className="gestao-op-row is-nao-atendido"
                      tabIndex={-1}
                    >
                      <div className="gestao-op-row-main gestao-op-row-main-table is-nao-atendido">
                        <button
                          className="gestao-op-row-expand"
                          type="button"
                          onClick={() => toggleExpandedRow(rowKey)}
                          aria-expanded={isExpanded}
                        >
                          <span className="gestao-op-row-expand-icon" aria-hidden="true">
                            <EyeIcon open={isExpanded} />
                          </span>
                          <span className="gestao-op-row-title">
                            <strong>{row.descricao}</strong>
                            <span>CODDV {row.coddv}</span>
                          </span>
                        </button>
                        <span className="gestao-op-row-cell">
                          <span className="gestao-op-row-cell-label">Ocorrência</span>
                          <span className="gestao-op-row-cell-value">{formatTime(row.ocorrencia)}</span>
                        </span>
                        <span className="gestao-op-row-cell">
                          <span className="gestao-op-row-cell-label">Filial</span>
                          <span className="gestao-op-row-cell-value">{row.filial != null ? formatInteger(row.filial) : "-"}</span>
                        </span>
                        <span className="gestao-op-row-cell">
                          <span className="gestao-op-row-cell-label">Não Atendido</span>
                          <span className="gestao-op-row-cell-value">{formatInteger(row.dif)}</span>
                        </span>
                        <span className="gestao-op-row-cell">
                          <span className="gestao-op-row-cell-label">Não Atendido Total</span>
                          <span className="gestao-op-row-cell-value">{formatInteger(row.nao_atendido_total)}</span>
                        </span>
                        <span className="gestao-op-row-cell">
                          <span className="gestao-op-row-cell-label">Estoque</span>
                          <span className="gestao-op-row-cell-value">{formatInteger(row.estoque)}</span>
                        </span>
                        <div className="gestao-op-row-actions">
                          {row.is_em_baixa ? null : (
                            <button
                              className="gestao-op-row-more-btn"
                              type="button"
                              onClick={() => openNaoAtendidoActions(row)}
                              aria-label={`Ações para ${row.descricao}`}
                            >
                              <MoreIcon />
                            </button>
                          )}
                        </div>
                        <span className="gestao-op-row-cell gestao-op-row-cell--status">
                          <span className="gestao-op-row-cell-label">Status</span>
                          <span className={`gestao-op-inline-status${row.is_em_baixa ? " is-active" : ""}`}>{row.is_em_baixa ? "Em baixa" : ""}</span>
                        </span>
                      </div>
                      {isExpanded ? (
                        <div className="gestao-op-row-details">
                          <div className="gestao-op-row-detail-grid">
                            <span><b>Caixa:</b> {row.caixa ?? "-"}</span>
                            <span><b>Qtd. caixa:</b> {formatInteger(row.qtd_caixa)}</span>
                            <span><b>Endereço:</b> {row.endereco ?? "-"}</span>
                            <span><b>Mat:</b> {row.mat ?? "-"}</span>
                            <span><b>Dat. últ. compra:</b> {formatDate(row.dat_ult_compra)}</span>
                            <span><b>Qtd. últ. compra:</b> {formatInteger(row.qtd_ult_compra)}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )
          ) : listViewMode === "em_recebimento" && !isHistorical ? (
            busyEmRecebimentoList && emRecebimentoRows.length === 0 ? (
              <div className="coleta-empty">Carregando recebimentos...</div>
            ) : emRecebimentoRows.length === 0 ? (
              <div className="coleta-empty">Nenhum item em recebimento encontrado para o CD atual.</div>
            ) : filteredEmRecebimentoRows.length === 0 ? (
              <div className="coleta-empty">Nenhum item encontrado para o filtro informado.</div>
            ) : (
              <div className="gestao-op-table">
                <div className="gestao-op-table-head is-em-recebimento" role="row">
                  <span>Produto</span>
                  <span>Qtd. cx</span>
                  <span>Qtd. total</span>
                  <span>Seq. entrada</span>
                  <span>Transportadora</span>
                </div>
                {filteredEmRecebimentoRows.map((row, index) => {
                  const rowKey = `em-recebimento:${row.seq_entrada ?? "sem-seq"}:${row.coddv}:${index}`;
                  const isExpanded = expandedRowId === rowKey;
                  return (
                    <div
                      key={rowKey}
                      ref={(node) => {
                        if (node) rowRefs.current.set(rowKey, node);
                        else rowRefs.current.delete(rowKey);
                      }}
                      className="gestao-op-row is-em-recebimento"
                      tabIndex={-1}
                    >
                      <div className="gestao-op-row-main gestao-op-row-main-table is-em-recebimento">
                        <button
                          className="gestao-op-row-expand"
                          type="button"
                          onClick={() => toggleExpandedRow(rowKey)}
                          aria-expanded={isExpanded}
                        >
                          <span className="gestao-op-row-expand-icon" aria-hidden="true">
                            <EyeIcon open={isExpanded} />
                          </span>
                          <span className="gestao-op-row-title">
                            <strong>{row.descricao}</strong>
                            <span>CODDV {row.coddv}</span>
                          </span>
                        </button>
                        <span className="gestao-op-row-cell">
                          <span className="gestao-op-row-cell-label">Qtd. cx</span>
                          <span className="gestao-op-row-cell-value">{formatInteger(row.qtd_cx)}</span>
                        </span>
                        <span className="gestao-op-row-cell">
                          <span className="gestao-op-row-cell-label">Qtd. total</span>
                          <span className="gestao-op-row-cell-value">{formatInteger(row.qtd_total)}</span>
                        </span>
                        <span className="gestao-op-row-cell">
                          <span className="gestao-op-row-cell-label">Seq. entrada</span>
                          <span className="gestao-op-row-cell-value">{row.seq_entrada != null ? formatInteger(row.seq_entrada) : "-"}</span>
                        </span>
                        <span className="gestao-op-row-cell">
                          <span className="gestao-op-row-cell-label">Transportadora</span>
                          <span className="gestao-op-row-cell-value">{row.transportadora}</span>
                        </span>
                      </div>
                      {isExpanded ? (
                        <div className="gestao-op-row-details">
                          <div className="gestao-op-row-detail-grid">
                            <span><b>Dh. consistida:</b> {formatDateTime(row.dh_consistida)}</span>
                            <span><b>Dh. liberação:</b> {formatDateTime(row.dh_liberacao)}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )
          ) : rows.length === 0 ? (
            <div className="coleta-empty">Nenhum item lançado para esta data e visão.</div>
          ) : filteredRows.length === 0 ? (
            <div className="coleta-empty">Nenhum item encontrado para o filtro informado.</div>
          ) : (
            <div className="gestao-op-table">
              <div className={`gestao-op-table-head${isHistorical ? " is-historical" : ""}`} role="row">
                <span>Produto</span>
                <span>{isHistorical ? "Solicitado" : "Qtd"}</span>
                {isHistorical ? <span>Movimentado</span> : <span>Últ. compra</span>}
                {isHistorical ? null : <span>Custo unit.</span>}
                <span>Custo total</span>
                <span>{isHistorical ? "Estoque no dia" : "Estoque"}</span>
                {isHistorical ? null : <span className="gestao-op-table-head-actions">Ações</span>}
              </div>
              {filteredRows.map((row) => {
                const isEditing = editingItemId === row.id;
                const isExpanded = expandedRowId === row.id;
                const isHistoricalMismatch = isHistorical && row.qtd_mov_dia !== row.quantidade;
                const isExpectedEntry = !isHistorical && listViewMode === "operacional" && movementType === "entrada" && row.is_em_recebimento_previsto;
                return (
                  <div
                    key={row.id}
                    ref={(node) => {
                      if (node) rowRefs.current.set(row.id, node);
                      else rowRefs.current.delete(row.id);
                    }}
                    className={`gestao-op-row${isEditing ? " is-editing" : ""}${isHistorical ? " is-historical" : ""}${isHistoricalMismatch ? " is-historical-mismatch" : ""}${isExpectedEntry ? " is-entry-expected" : ""}`}
                    tabIndex={-1}
                  >
                    <div className={`gestao-op-row-main gestao-op-row-main-table${isHistorical ? " is-historical" : ""}`}>
                      <button
                        className="gestao-op-row-expand"
                        type="button"
                        onClick={() => toggleExpandedRow(row.id)}
                        aria-expanded={isExpanded}
                      >
                        <span className="gestao-op-row-expand-icon" aria-hidden="true">
                          <EyeIcon open={isExpanded} />
                        </span>
                        <span className="gestao-op-row-title">
                          <strong>{row.descricao}</strong>
                          <span>
                            <RowTitleMeta coddv={row.coddv} movementType={row.movement_type} />
                          </span>
                        </span>
                      </button>
                      <span className="gestao-op-row-cell gestao-op-row-cell--qty">
                        <span className="gestao-op-row-cell-label">{isHistorical ? "Solicitado" : "Qtd"}</span>
                        <span className="gestao-op-row-cell-value">{formatInteger(row.quantidade)}</span>
                      </span>
                      {isHistorical ? (
                        <span className="gestao-op-row-cell gestao-op-row-cell--fulfilled">
                          <span className="gestao-op-row-cell-label">Movimentado</span>
                          <span className="gestao-op-row-cell-value">{formatInteger(row.qtd_mov_dia)}</span>
                        </span>
                      ) : (
                        <span className="gestao-op-row-cell gestao-op-row-cell--purchase">
                          <span className="gestao-op-row-cell-label">Últ. compra</span>
                          <span className="gestao-op-row-cell-value">{formatDate(row.dat_ult_compra)}</span>
                        </span>
                      )}
                      {isHistorical ? null : (
                        <span className="gestao-op-row-cell gestao-op-row-cell--unit">
                          <span className="gestao-op-row-cell-label">Custo unit.</span>
                          <span className="gestao-op-row-cell-value">{formatCurrency(row.custo_unitario)}</span>
                        </span>
                      )}
                      <span className="gestao-op-row-cell gestao-op-row-cell--total">
                        <span className="gestao-op-row-cell-label">Custo total</span>
                        <span className="gestao-op-row-cell-value">{formatCurrency(isHistorical ? row.valor_mov_dia : row.custo_total)}</span>
                      </span>
                      <span className="gestao-op-row-cell gestao-op-row-cell--stock">
                        <span className="gestao-op-row-cell-label">{isHistorical ? "Estoque no dia" : "Estoque"}</span>
                        <span className="gestao-op-row-cell-value">
                          {isHistorical ? formatInteger(row.qtd_est_atual) : `${formatInteger(row.qtd_est_atual)} atual • ${formatInteger(row.qtd_est_disp)} disp.`}
                        </span>
                      </span>
                    </div>
                    {isHistorical ? null : (
                      <div className="gestao-op-row-actions">
                        <button
                          className="gestao-op-row-more-btn"
                          type="button"
                          onClick={() => openRowActions(row)}
                          aria-label={`Ações para ${row.descricao}`}
                        >
                          <MoreIcon />
                        </button>
                      </div>
                    )}
                    {isExpanded ? (
                      <div className="gestao-op-row-details">
                        {isExpectedEntry ? <div className="gestao-op-row-alert">Produto com entrada prevista.</div> : null}
                        <div className="gestao-op-row-detail-grid">
                          {isHistorical ? (
                            <>
                              <span><b>Solicitado:</b> {formatInteger(row.quantidade)}</span>
                              <span><b>Movimentado:</b> {formatInteger(row.qtd_mov_dia)}</span>
                              <span><b>Custo total:</b> {formatCurrency(row.valor_mov_dia)}</span>
                              <span><b>Estoque no dia:</b> {formatInteger(row.qtd_est_atual)} atual</span>
                            </>
                          ) : (
                            <>
                              <span><b>Quantidade:</b> {formatInteger(row.quantidade)}</span>
                              <span><b>Custo total:</b> {formatCurrency(row.custo_total)}</span>
                              <span><b>Últ. compra:</b> {formatDate(row.dat_ult_compra)}</span>
                              <span><b>Custo unit.:</b> {formatCurrency(row.custo_unitario)}</span>
                              <span><b>Estoque:</b> {formatInteger(row.qtd_est_atual)} atual • {formatInteger(row.qtd_est_disp)} disp.</span>
                            </>
                          )}
                          <span><b>End. Separação:</b> {row.endereco_sep ?? "-"}</span>
                          <span><b>End. Pulmão:</b> {row.endereco_pul ?? "-"}</span>
                          <span><b>Criado por:</b> {row.created_nome} ({row.created_mat}) em {formatDateTime(row.created_at)}</span>
                          <span><b>Editado por:</b> {row.updated_nome} ({row.updated_mat}) em {formatDateTime(row.updated_at)}</span>
                        </div>
                        {isHistorical ? null : isEditing ? (
                          <div className="gestao-op-row-inline-editor">
                            <input
                              type="number"
                              min={1}
                              max={row.movement_type === "baixa" ? Math.max(row.qtd_est_atual, 1) : undefined}
                              value={editingQuantity}
                              onChange={(event) => setEditingQuantity(event.target.value)}
                              inputMode="numeric"
                            />
                            <button className="btn btn-primary" type="button" onClick={() => void saveEditingRow(row)}>
                              Salvar
                            </button>
                            <button
                              className="btn btn-muted"
                              type="button"
                              onClick={() => {
                                setEditingItemId(null);
                                setEditingQuantity("");
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </section>
      {reviewModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gestao-estoque-review-title"
              onClick={() => {
                if (busyReview) return;
                setReviewModalOpen(false);
              }}
            >
              <div className="confirm-dialog surface-enter gestao-op-review-dialog" onClick={(event) => event.stopPropagation()}>
                <h3 id="gestao-estoque-review-title">Status do dia</h3>
                <p>{`${formatDate(selectedDate)} • ${currentCdLabel}`}</p>
                <div className={`gestao-op-review-status-card is-${currentReviewStatus}`}>
                  <span className="gestao-op-review-status-icon" aria-hidden="true">{checkIcon()}</span>
                  <div className="gestao-op-review-status-copy">
                    <strong>{reviewStatusLabel(currentReviewStatus)}</strong>
                    <span>
                      {dayReviewState?.last_reviewed_at
                        ? `Última atualização em ${formatDateTime(dayReviewState.last_reviewed_at)}`
                        : "Nenhuma revisão registrada para este dia."}
                    </span>
                  </div>
                </div>

                <div className="gestao-op-review-picker" role="group" aria-label="Alterar status do dia">
                  <button
                    type="button"
                    className={pendingReviewStatus === "pendente" ? "is-active" : ""}
                    onClick={() => setPendingReviewStatus("pendente")}
                  >
                    Pendente
                  </button>
                  <button
                    type="button"
                    className={pendingReviewStatus === "revisado" ? "is-active" : ""}
                    onClick={() => setPendingReviewStatus("revisado")}
                  >
                    Revisado
                  </button>
                </div>

                <div className="gestao-op-review-history">
                  <strong>Revisões do dia</strong>
                  {hasReviewers ? (
                    <div className="gestao-op-review-history-list">
                      {dayReviewState?.reviewers.map((entry) => (
                        <div key={`${entry.actor_id ?? entry.actor_mat}-${entry.reviewed_at ?? "sem-data"}`} className="gestao-op-review-history-item">
                          <span className={`gestao-op-review-history-badge is-${entry.review_status}`}>{reviewStatusLabel(entry.review_status)}</span>
                          <div className="gestao-op-review-history-copy">
                            <strong>{entry.actor_nome}</strong>
                            <span>{`${entry.actor_mat} • ${formatDateTime(entry.reviewed_at)}`}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="coleta-empty">Nenhuma revisão registrada.</div>
                  )}
                </div>

                <div className="confirm-actions">
                  <button
                    className="btn btn-muted"
                    type="button"
                    onClick={() => setReviewModalOpen(false)}
                    disabled={busyReview}
                  >
                    Fechar
                  </button>
                  <button className="btn btn-primary" type="button" onClick={() => void saveDayReviewStatus()} disabled={busyReview}>
                    {busyReview ? "Salvando..." : "Salvar status"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {exportChoiceOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gestao-estoque-export-title"
              onClick={() => {
                if (busyExport) return;
                setExportChoiceOpen(false);
              }}
            >
              <div className="confirm-dialog surface-enter gestao-op-export-dialog" onClick={(event) => event.stopPropagation()}>
                <h3 id="gestao-estoque-export-title">Exportar lista</h3>
                <p>{`${formatDate(selectedDate)} • ${movementLabel(movementType)}`}</p>
                <div className="gestao-op-choice-actions">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => {
                      setExportChoiceOpen(false);
                      void exportXlsx();
                    }}
                    disabled={busyExport}
                  >
                    {busyExport ? "Gerando..." : "Exportar Excel"}
                  </button>
                  <button
                    className="btn btn-muted"
                    type="button"
                    onClick={() => {
                      setExportChoiceOpen(false);
                      void exportPdf();
                    }}
                    disabled={busyExport}
                  >
                    {busyExport ? "Gerando..." : "Exportar PDF"}
                  </button>
                </div>
                <div className="confirm-actions">
                  <button className="btn btn-muted" type="button" onClick={() => setExportChoiceOpen(false)} disabled={busyExport}>
                    Fechar
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {scannerOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="gestao-estoque-scanner-title" onClick={closeCameraScanner}>
              <div className="scanner-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <div className="scanner-head">
                  <h3 id="gestao-estoque-scanner-title">Scanner de barras</h3>
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
      {confirmDeleteRow && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gestao-estoque-delete-title"
              onClick={() => {
                if (pendingDeleteId) return;
                setConfirmDeleteRow(null);
              }}
            >
              <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="gestao-estoque-delete-title">Excluir item da lista</h3>
                <p>
                  {`Deseja excluir "${confirmDeleteRow.descricao}" (CODDV ${confirmDeleteRow.coddv}) da lista de ${movementLabel(confirmDeleteRow.movement_type).toLocaleLowerCase("pt-BR")}? Essa ação ficará registrada no histórico.`}
                </p>
                <div className="confirm-actions">
                  <button
                    className="btn btn-muted"
                    type="button"
                    onClick={() => setConfirmDeleteRow(null)}
                    disabled={pendingDeleteId === confirmDeleteRow.id}
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={() => void confirmRemoveRow()}
                    disabled={pendingDeleteId === confirmDeleteRow.id}
                  >
                    {pendingDeleteId === confirmDeleteRow.id ? "Excluindo..." : "Excluir"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {actionRow && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gestao-estoque-action-title"
              onClick={() => setActionRow(null)}
            >
              <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="gestao-estoque-action-title">O que deseja fazer?</h3>
                <p>{`${actionRow.descricao} (CODDV ${actionRow.coddv})`}</p>
                <div className="gestao-op-choice-actions">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => {
                      startEditingRow(actionRow);
                      setActionRow(null);
                    }}
                  >
                    Editar quantidade
                  </button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={() => {
                      setActionRow(null);
                      void removeRow(actionRow);
                    }}
                  >
                    Excluir item
                  </button>
                  <button className="btn btn-muted" type="button" onClick={() => setActionRow(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {naoAtendidoActionRow && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gestao-estoque-nao-atendido-action-title"
              onClick={() => {
                if (busyNaoAtendidoSend) return;
                setNaoAtendidoActionRow(null);
              }}
            >
              <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="gestao-estoque-nao-atendido-action-title">O que deseja fazer?</h3>
                <p>{`${naoAtendidoActionRow.descricao} (CODDV ${naoAtendidoActionRow.coddv})`}</p>
                <div className="gestao-op-choice-actions">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => {
                      setNaoAtendidoSendQuantidade(naoAtendidoActionRow.estoque > 0 ? "1" : "");
                      setNaoAtendidoSendRow(naoAtendidoActionRow);
                      setNaoAtendidoActionRow(null);
                    }}
                    disabled={naoAtendidoActionRow.estoque <= 0}
                  >
                    Enviar para baixa
                  </button>
                  <button className="btn btn-muted" type="button" onClick={() => setNaoAtendidoActionRow(null)}>
                    Cancelar
                  </button>
                </div>
                {naoAtendidoActionRow.estoque <= 0 ? <div className="alert warning">Sem estoque disponível para enviar para baixa.</div> : null}
              </div>
            </div>,
            document.body
          )
        : null}
      {naoAtendidoSendRow && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gestao-estoque-nao-atendido-send-title"
              onClick={() => {
                if (busyNaoAtendidoSend) return;
                setNaoAtendidoSendRow(null);
                setNaoAtendidoSendQuantidade("");
              }}
            >
              <div className="confirm-dialog surface-enter gestao-op-send-dialog" onClick={(event) => event.stopPropagation()}>
                <h3 id="gestao-estoque-nao-atendido-send-title">Enviar para baixa</h3>
                <p>{`${naoAtendidoSendRow.descricao} (CODDV ${naoAtendidoSendRow.coddv})`}</p>
                <label className="gestao-op-field gestao-op-send-field">
                  <span>Quantidade</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(naoAtendidoSendRow.estoque, 1)}
                    value={naoAtendidoSendQuantidade}
                    onChange={(event) => setNaoAtendidoSendQuantidade(event.target.value)}
                    inputMode="numeric"
                    autoFocus
                  />
                  <small>{`Estoque disponível: ${formatInteger(naoAtendidoSendRow.estoque)}`}</small>
                </label>
                <div className="confirm-actions">
                  <button
                    className="btn btn-muted"
                    type="button"
                    onClick={() => {
                      setNaoAtendidoSendRow(null);
                      setNaoAtendidoSendQuantidade("");
                    }}
                    disabled={busyNaoAtendidoSend}
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void submitNaoAtendidoSend()}
                    disabled={busyNaoAtendidoSend || naoAtendidoSendRow.estoque <= 0}
                  >
                    {busyNaoAtendidoSend ? "Enviando..." : "Confirmar envio"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
