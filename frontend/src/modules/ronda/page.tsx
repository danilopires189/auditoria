import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { formatDateTimeBrasilia, monthStartIsoBrasilia } from "../../shared/brasilia-datetime";
import { getModuleByKeyOrThrow } from "../registry";
import {
  fetchRondaQualidadeAddressOptions,
  fetchRondaQualidadeMonthOptions,
  fetchRondaQualidadeOccurrenceHistory,
  fetchRondaQualidadeZoneDetail,
  fetchRondaQualidadeZoneList,
  setRondaQualidadeOccurrenceCorrection,
  submitRondaQualidadeAudit,
  deleteRondaQualidadeOccurrence
} from "./sync";
import {
  RONDA_QUALIDADE_MOTIVOS_PUL,
  RONDA_QUALIDADE_MOTIVOS_SEP,
  type RondaQualidadeCorrectionStatus,
  type RondaQualidadeAddressOption,
  type RondaQualidadeMonthOption,
  type RondaQualidadeModuleProfile,
  type RondaQualidadeOccurrenceDraft,
  type RondaQualidadeOccurrenceHistoryRow,
  type RondaQualidadeZoneDetail,
  type RondaQualidadeZoneSummary,
  type RondaQualidadeZoneType
} from "./types";

interface RondaQualidadePageProps {
  isOnline: boolean;
  profile: RondaQualidadeModuleProfile;
}

interface RondaOfflineMeta {
  updated_at: string | null;
  zone_count: number;
  month_count: number;
}

interface RondaConfirmState {
  title: string;
  message: string;
  helper?: string;
  confirmLabel: string;
  confirmTone?: "primary" | "danger";
}

interface RondaAuditTarget {
  zoneType: RondaQualidadeZoneType;
  zona: string;
  coluna: number | null;
}

interface RondaActiveAuditSession extends RondaAuditTarget {
  startedAt: string;
}

const MODULE_DEF = getModuleByKeyOrThrow("ronda");
const HISTORY_ALL_TYPES = "TODOS";
const HISTORY_LIMIT = 200;
const PT_BR_COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function searchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" />
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

function historyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 7v5l3 2" />
      <path d="M5 5v4h4" />
      <path d="M6.5 16a7 7 0 1 0-.9-8" />
    </svg>
  );
}

function plusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function checkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4 4 10-10" />
    </svg>
  );
}

function auditStartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function auditResumeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15.36-5.64" />
      <path d="M21 3v5h-5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M10.5 10.5l3 1.5-3 1.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function separacaoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M12 6v12" />
      <path d="M7 10h0" />
      <path d="M7 14h0" />
      <path d="M17 10h0" />
      <path d="M17 14h0" />
    </svg>
  );
}

function pulmaoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 4v16" />
      <path d="M10 4v16" />
      <path d="M14 4v16" />
      <path d="M18 4v16" />
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

function chevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: RondaQualidadeModuleProfile): number | null {
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

function resolveCdLabel(profile: RondaQualidadeModuleProfile, cd: number | null): string {
  const raw = typeof profile.cd_nome === "string" ? profile.cd_nome.trim().replace(/\s+/g, " ") : "";
  if (raw) return raw;
  if (cd != null) return `CD ${String(cd).padStart(2, "0")}`;
  return "CD não definido";
}

function formatMonthLabel(value: string): string {
  const normalized = value.trim().slice(0, 7);
  const matched = /^(\d{4})-(\d{2})$/.exec(normalized);
  if (!matched) return value;
  const year = Number.parseInt(matched[1], 10);
  const month = Number.parseInt(matched[2], 10);
  const date = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(date);
}

function formatCompactMonthLabel(value: string): string {
  const normalized = value.trim().slice(0, 7);
  const matched = /^(\d{4})-(\d{2})$/.exec(normalized);
  if (!matched) return value;
  const year = Number.parseInt(matched[1], 10);
  const month = Number.parseInt(matched[2], 10);
  const date = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const shortMonth = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" })
    .format(date)
    .replace(".", "")
    .toLocaleLowerCase("pt-BR");
  return `${shortMonth} ${year}`;
}

function readStorageValue<T>(key: string | null, fallback: T): T {
  if (typeof window === "undefined" || !key) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorageValue<T>(key: string | null, value: T): void {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore local cache write errors.
  }
}

function filterZoneRows(rows: RondaQualidadeZoneSummary[], search: string): RondaQualidadeZoneSummary[] {
  const normalized = search.trim().toUpperCase();
  if (!normalized) return rows;
  return rows.filter((row) => row.zona.toUpperCase().includes(normalized));
}

function formatMonthFromDate(value: string): string {
  return value.slice(0, 7);
}

function ensureCurrentMonthOption(
  options: RondaQualidadeMonthOption[],
  currentMonthStart: string
): RondaQualidadeMonthOption[] {
  if (options.some((option) => option.month_start === currentMonthStart)) return options;
  return [
    {
      month_start: currentMonthStart,
      month_label: formatMonthLabel(currentMonthStart)
    },
    ...options
  ].sort((left, right) => right.month_start.localeCompare(left.month_start));
}

function formatDateTime(value: string | null): string {
  return formatDateTimeBrasilia(value, {
    includeSeconds: true,
    emptyFallback: "-",
    invalidFallback: "-"
  });
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);
}

function formatCount(value: number, singular: string, plural: string): string {
  return `${formatInteger(value)} ${value === 1 ? singular : plural}`;
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number.isFinite(value) ? value : 0)}%`;
}

function zoneTypeLabel(value: RondaQualidadeZoneType): string {
  return value === "SEP" ? "Separação" : "Pulmão";
}

function zoneTypeLabelLower(value: RondaQualidadeZoneType): string {
  return zoneTypeLabel(value).toLocaleLowerCase("pt-BR");
}

function emptyDraft(): RondaQualidadeOccurrenceDraft {
  return {
    motivo: "",
    endereco: "",
    observacao: "",
    nivel: "",
    enderecoManual: false
  };
}

function correctionStatusLabel(value: RondaQualidadeCorrectionStatus): string {
  return value === "corrigido" ? "Corrigido" : "Não corrigido";
}

function auditResultLabel(value: "sem_ocorrencia" | "com_ocorrencia"): string {
  return value === "sem_ocorrencia" ? "Sem ocorrência" : "Com ocorrência";
}

function addressOptionLabel(option: RondaQualidadeAddressOption): string {
  return option.endereco;
}

function normalizeAddressValue(value: string): string {
  return value.trim().toLocaleUpperCase("pt-BR");
}

function formatDurationClock(totalSeconds: number): string {
  const normalized = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const seconds = normalized % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatElapsedSince(startedAt: string | null, nowMs: number): string {
  if (!startedAt) return "00:00:00";
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return "00:00:00";
  return formatDurationClock(Math.floor((nowMs - startedMs) / 1000));
}

function describeAuditTarget(target: RondaAuditTarget): string {
  return target.zoneType === "PUL" && target.coluna != null
    ? `coluna ${target.coluna} da zona ${target.zona}`
    : `zona ${target.zona}`;
}

function auditActionLabel(auditedInMonth: boolean): string {
  return auditedInMonth ? "Retomar auditoria" : "Iniciar auditoria";
}

function RondaStartButton(props: {
  active: boolean;
  auditedInMonth: boolean;
  disabled: boolean;
  onClick: () => void;
  ariaLabel: string;
  title: string;
}) {
  const { active, auditedInMonth, disabled, onClick, ariaLabel, title } = props;
  return (
    <button
      type="button"
      className={`ronda-start-btn${active ? " is-active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      <span className="ronda-inline-icon" aria-hidden="true">
        {auditedInMonth ? auditResumeIcon() : auditStartIcon()}
      </span>
    </button>
  );
}

function sameAuditTarget(left: RondaAuditTarget | null, right: RondaAuditTarget | null): boolean {
  if (!left || !right) return false;
  return left.zoneType === right.zoneType
    && left.zona === right.zona
    && (left.zoneType !== "PUL" || left.coluna === right.coluna);
}

function filterAddressOptions(options: RondaQualidadeAddressOption[], search: string, levelFilter: string): RondaQualidadeAddressOption[] {
  const normalizedSearch = search.trim().toLocaleUpperCase("pt-BR");
  const normalizedLevel = levelFilter.trim().toLocaleUpperCase("pt-BR");
  return options.filter((option) => {
    if (normalizedLevel && option.nivel?.toLocaleUpperCase("pt-BR") !== normalizedLevel) return false;
    if (!normalizedSearch) return true;
    return [
      option.endereco,
      option.nivel ?? "",
      option.produto_label
    ].some((value) => value.toLocaleUpperCase("pt-BR").includes(normalizedSearch));
  });
}

function compareAddressLevel(left: string, right: string): number {
  const leftTrimmed = left.trim();
  const rightTrimmed = right.trim();
  const leftStartsWithNumber = /^\d/.test(leftTrimmed);
  const rightStartsWithNumber = /^\d/.test(rightTrimmed);
  if (leftStartsWithNumber !== rightStartsWithNumber) return leftStartsWithNumber ? 1 : -1;
  return leftTrimmed.localeCompare(rightTrimmed, "pt-BR", { numeric: true, sensitivity: "base" });
}

function renderZoneCardDetails(row: RondaQualidadeZoneSummary, expanded: boolean) {
  if (!expanded) return null;

  return (
    <div className="ronda-zone-card-details">
      {row.zone_type === "PUL" ? (
        <>
          {row.total_auditorias > 0 ? <span>{formatCount(row.total_auditorias, "auditoria em coluna", "auditorias em colunas")}</span> : null}
          {row.total_colunas > 0 ? <span>{formatCount(row.total_colunas, "coluna", "colunas")}</span> : null}
        </>
      ) : (
        <>
          {row.total_enderecos > 0 ? <span>{formatCount(row.total_enderecos, "endereço", "endereços")}</span> : null}
          {row.audited_in_month ? <span>{formatPercent(row.percentual_conformidade)}</span> : null}
        </>
      )}
      {row.last_started_at ? <small>{`Início: ${formatDateTime(row.last_started_at)}`}</small> : null}
      {row.last_finished_at ? <small>{`Fim: ${formatDateTime(row.last_finished_at)}`}</small> : null}
    </div>
  );
}

function zoneCardMetricLabel(row: RondaQualidadeZoneSummary): string {
  return row.zone_type === "PUL"
    ? formatCount(row.total_colunas, "coluna", "colunas")
    : formatCount(row.total_enderecos, "endereço", "endereços");
}

function zoneCardBadgeLabel(row: RondaQualidadeZoneSummary): string {
  if (row.zone_type === "PUL" && row.total_auditorias > 0 && !row.audited_in_month) return "Parcial";
  return row.audited_in_month ? "Auditada" : "Pendente";
}

function zoneCardBadgeClass(row: RondaQualidadeZoneSummary): string {
  if (row.zone_type === "PUL" && row.total_auditorias > 0 && !row.audited_in_month) return "is-partial";
  return row.audited_in_month ? "is-audited" : "is-pending";
}

function compareOccurrenceReason(
  left: { motivo: string; endereco?: string },
  right: { motivo: string; endereco?: string }
): number {
  return PT_BR_COLLATOR.compare(left.motivo, right.motivo)
    || PT_BR_COLLATOR.compare(left.endereco ?? "", right.endereco ?? "");
}

function hasNoOccurrenceAudit(
  detail: RondaQualidadeZoneDetail | null,
  zoneType: RondaQualidadeZoneType | null,
  selectedPulColumn: number | null
): boolean {
  if (!detail || !zoneType) return false;
  return detail.history_rows.some((session) => (
    session.audit_result === "sem_ocorrencia"
    && (zoneType !== "PUL" || session.coluna === selectedPulColumn)
  ));
}

export default function RondaQualidadePage({ isOnline, profile }: RondaQualidadePageProps) {
  const currentMonthStart = useMemo(() => monthStartIsoBrasilia(), []);
  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const currentCdLabel = useMemo(() => resolveCdLabel(profile, activeCd), [activeCd, profile]);
  const [selectedMonthStart, setSelectedMonthStart] = useState(currentMonthStart);
  const [monthOptions, setMonthOptions] = useState<RondaQualidadeMonthOption[]>([]);
  const [zoneType, setZoneType] = useState<RondaQualidadeZoneType | null>(null);
  const [zoneSearch, setZoneSearch] = useState("");
  const [zoneRows, setZoneRows] = useState<RondaQualidadeZoneSummary[]>([]);
  const [zonesBusy, setZonesBusy] = useState(false);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [selectedPulColumn, setSelectedPulColumn] = useState<number | null>(null);
  const [detail, setDetail] = useState<RondaQualidadeZoneDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [drafts, setDrafts] = useState<RondaQualidadeOccurrenceDraft[]>([emptyDraft()]);
  const [addressOptions, setAddressOptions] = useState<RondaQualidadeAddressOption[]>([]);
  const [addressesBusy, setAddressesBusy] = useState(false);
  const [addressPickerIndex, setAddressPickerIndex] = useState<number | null>(null);
  const [addressPickerSearch, setAddressPickerSearch] = useState("");
  const [addressLevelFilter, setAddressLevelFilter] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyRows, setHistoryRows] = useState<RondaQualidadeOccurrenceHistoryRow[]>([]);
  const [historyMonth, setHistoryMonth] = useState("");
  const [historyStatus, setHistoryStatus] = useState<"todos" | RondaQualidadeCorrectionStatus>("todos");
  const [historySearch, setHistorySearch] = useState("");
  const [historyZoneType, setHistoryZoneType] = useState<typeof HISTORY_ALL_TYPES | RondaQualidadeZoneType>(HISTORY_ALL_TYPES);
  const [updatingOccurrenceId, setUpdatingOccurrenceId] = useState<string | null>(null);
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [offlineMeta, setOfflineMeta] = useState<RondaOfflineMeta>({ updated_at: null, zone_count: 0, month_count: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<RondaConfirmState | null>(null);
  const [activeAuditSession, setActiveAuditSession] = useState<RondaActiveAuditSession | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [deletingOccurrenceId, setDeletingOccurrenceId] = useState<string | null>(null);
  const confirmActionRef = useRef<(() => void | Promise<void>) | null>(null);

  const isAdmin = useMemo(() => profile.role === "admin", [profile.role]);

  const sortedHistoryRows = useMemo(
    () => [...historyRows].sort(compareOccurrenceReason),
    [historyRows]
  );
  const historyCounts = useMemo(() => {
    let corrigido = 0;
    let nao_corrigido = 0;
    for (const r of historyRows) {
      if (r.correction_status === "corrigido") corrigido++;
      else nao_corrigido++;
    }
    return { corrigido, nao_corrigido };
  }, [historyRows]);

  const selectedMonthRef = selectedMonthStart;
  const selectedMonthLabel = useMemo(() => formatMonthLabel(selectedMonthStart), [selectedMonthStart]);
  const offlineStoragePrefix = useMemo(
    () => (activeCd == null ? null : `auditoria.ronda.offline.v1:${profile.user_id}:${activeCd}`),
    [activeCd, profile.user_id]
  );
  const isCurrentMonthSelected = selectedMonthStart === currentMonthStart;
  const readOnlyCorrectionMode = !isCurrentMonthSelected;
  const shouldUseOfflineData = preferOfflineMode || !isOnline;
  const reasonOptions = useMemo(
    () => [...(zoneType === "PUL" ? RONDA_QUALIDADE_MOTIVOS_PUL : RONDA_QUALIDADE_MOTIVOS_SEP)].sort((left, right) => PT_BR_COLLATOR.compare(left, right)),
    [zoneType]
  );
  const unauditedZones = useMemo(() => zoneRows.filter((row) => !row.audited_in_month), [zoneRows]);
  const auditedZones = useMemo(() => zoneRows.filter((row) => row.audited_in_month), [zoneRows]);
  const totalPulColumns = useMemo(() => zoneRows.reduce((total, row) => total + row.total_colunas, 0), [zoneRows]);
  const auditedPulColumns = useMemo(() => zoneRows.reduce((total, row) => total + Math.min(row.total_colunas_auditadas, row.total_colunas), 0), [zoneRows]);
  const completionPercent = useMemo(
    () => {
      if (zoneType === "PUL") return totalPulColumns > 0 ? (auditedPulColumns / totalPulColumns) * 100 : 0;
      return zoneRows.length > 0 ? (auditedZones.length / zoneRows.length) * 100 : 0;
    },
    [auditedPulColumns, auditedZones.length, totalPulColumns, zoneRows.length, zoneType]
  );
  const progressTitle = zoneType ? `Concluído ${zoneTypeLabel(zoneType)}` : "Concluído";
  const selectedColumnStat = useMemo(
    () => (selectedPulColumn == null ? null : detail?.column_stats.find((row) => row.coluna === selectedPulColumn) ?? null),
    [detail?.column_stats, selectedPulColumn]
  );
  const selectedAuditTarget = useMemo<RondaAuditTarget | null>(() => {
    if (!zoneType || !selectedZone) return null;
    return {
      zoneType,
      zona: selectedZone,
      coluna: zoneType === "PUL" ? selectedPulColumn : null
    };
  }, [selectedPulColumn, selectedZone, zoneType]);
  const activeAuditMatchesSelection = useMemo(
    () => sameAuditTarget(activeAuditSession, selectedAuditTarget),
    [activeAuditSession, selectedAuditTarget]
  );
  const activeAuditElapsedLabel = useMemo(
    () => formatElapsedSince(activeAuditMatchesSelection ? activeAuditSession?.startedAt ?? null : null, clockNow),
    [activeAuditMatchesSelection, activeAuditSession?.startedAt, clockNow]
  );
  const activeAuditLabel = useMemo(
    () => (activeAuditSession ? describeAuditTarget(activeAuditSession) : ""),
    [activeAuditSession]
  );
  const noOccurrenceAlreadyRegistered = useMemo(
    () => hasNoOccurrenceAudit(detail, zoneType, selectedPulColumn),
    [detail, selectedPulColumn, zoneType]
  );
  const noOccurrenceDisabledReason = useMemo(() => {
    if (readOnlyCorrectionMode) return "Meses anteriores ficam apenas para consulta e correção.";
    if (!activeAuditMatchesSelection) return "Clique em Iniciar para liberar o registro desta auditoria.";
    if (zoneType === "PUL" && selectedPulColumn == null) return "Selecione uma coluna para registrar sem ocorrência.";
    if (noOccurrenceAlreadyRegistered) {
      return zoneType === "PUL"
        ? "Esta coluna já foi registrada sem ocorrência neste mês."
        : "Esta zona já foi registrada sem ocorrência neste mês.";
    }
    return undefined;
  }, [activeAuditMatchesSelection, noOccurrenceAlreadyRegistered, readOnlyCorrectionMode, selectedPulColumn, zoneType]);
  const occurrenceActionDisabledReason = useMemo(() => {
    if (readOnlyCorrectionMode) return "Meses anteriores ficam apenas para consulta e correção.";
    if (!activeAuditMatchesSelection) return "Clique em Iniciar para liberar o lançamento de ocorrências.";
    if (zoneType === "PUL" && selectedPulColumn == null) return "Selecione uma coluna para adicionar ocorrência.";
    return undefined;
  }, [activeAuditMatchesSelection, readOnlyCorrectionMode, selectedPulColumn, zoneType]);
  const cancelAuditDisabledReason = useMemo(() => {
    if (!activeAuditMatchesSelection) return "Nenhuma auditoria em andamento para esta seleção.";
    return undefined;
  }, [activeAuditMatchesSelection]);
  const addressLevelOptions = useMemo(
    () => Array.from(new Set(addressOptions.map((option) => option.nivel).filter((nivel): nivel is string => Boolean(nivel)))).sort(compareAddressLevel),
    [addressOptions]
  );
  const offlineManifestInfo = useMemo(() => {
    const updatedText = offlineMeta.updated_at ? ` | Atualização: ${formatDateTime(offlineMeta.updated_at)}` : " | Sem atualização ainda";
    if (offlineMeta.zone_count <= 0) {
      return `Sem base local da Ronda de Qualidade. Zonas locais: ${formatCount(0, "item", "itens")}${updatedText}`;
    }
    return `Base local da Ronda de Qualidade. Zonas locais: ${formatCount(offlineMeta.zone_count, "item", "itens")}${updatedText}`;
  }, [offlineMeta]);

  const monthsCacheKey = useMemo(() => (offlineStoragePrefix ? `${offlineStoragePrefix}:months` : null), [offlineStoragePrefix]);
  const offlineMetaKey = useMemo(() => (offlineStoragePrefix ? `${offlineStoragePrefix}:meta` : null), [offlineStoragePrefix]);
  const offlineModeKey = useMemo(() => (offlineStoragePrefix ? `${offlineStoragePrefix}:prefer-offline` : null), [offlineStoragePrefix]);
  const zoneCacheKey = useCallback(
    (monthStart: string, type: RondaQualidadeZoneType) => (offlineStoragePrefix ? `${offlineStoragePrefix}:zones:${monthStart}:${type}` : null),
    [offlineStoragePrefix]
  );
  const detailCacheKey = useCallback(
    (monthStart: string, type: RondaQualidadeZoneType, zona: string) => (offlineStoragePrefix ? `${offlineStoragePrefix}:detail:${monthStart}:${type}:${zona}` : null),
    [offlineStoragePrefix]
  );
  const historyCacheKey = useCallback(
    (monthStart: string | null, type: typeof HISTORY_ALL_TYPES | RondaQualidadeZoneType, status: string, search: string) =>
      (offlineStoragePrefix ? `${offlineStoragePrefix}:history:${monthStart ?? "all"}:${type}:${status}:${search.trim().toUpperCase() || "all"}` : null),
    [offlineStoragePrefix]
  );
  const resetComposerState = useCallback(() => {
    setComposerOpen(false);
    setDrafts([emptyDraft()]);
    setAddressLevelFilter("");
    setAddressOptions([]);
    setAddressPickerIndex(null);
    setAddressPickerSearch("");
  }, []);
  const clearActiveAuditSession = useCallback(() => {
    setActiveAuditSession(null);
    resetComposerState();
  }, [resetComposerState]);
  const closeConfirmDialog = useCallback(() => {
    if (auditBusy) return;
    confirmActionRef.current = null;
    setConfirmState(null);
  }, [auditBusy]);
  const openConfirmDialog = useCallback((state: RondaConfirmState, action: () => void | Promise<void>) => {
    confirmActionRef.current = action;
    setConfirmState(state);
  }, []);
  const confirmDialogAction = useCallback(async () => {
    const action = confirmActionRef.current;
    if (!action) return;
    await action();
  }, []);
  const runWithDiscardedActiveAudit = useCallback((
    action: () => void,
    options?: {
      title?: string;
      message?: string;
      helper?: string;
      confirmLabel?: string;
    }
  ) => {
    if (!activeAuditSession) {
      action();
      return;
    }

    openConfirmDialog(
      {
        title: options?.title ?? "Descartar auditoria em andamento",
        message: options?.message ?? `A auditoria da ${activeAuditLabel} será descartada se você continuar.`,
        helper: options?.helper ?? "As ocorrências preenchidas apenas nesta tela serão perdidas.",
        confirmLabel: options?.confirmLabel ?? "Descartar e continuar",
        confirmTone: "danger"
      },
      () => {
        clearActiveAuditSession();
        setConfirmState(null);
        confirmActionRef.current = null;
        action();
      }
    );
  }, [activeAuditLabel, activeAuditSession, clearActiveAuditSession, openConfirmDialog]);

  const loadMonthOptions = useCallback(async () => {
    if (activeCd == null) {
      setMonthOptions(ensureCurrentMonthOption([], currentMonthStart));
      return;
    }
    if (shouldUseOfflineData) {
      const cached = ensureCurrentMonthOption(readStorageValue<RondaQualidadeMonthOption[]>(monthsCacheKey, []), currentMonthStart);
      setMonthOptions(cached);
      if (!cached.some((option) => option.month_start === selectedMonthStart)) {
        setSelectedMonthStart(currentMonthStart);
      }
      return;
    }
    try {
      const rows = await fetchRondaQualidadeMonthOptions(activeCd);
      const nextOptions = ensureCurrentMonthOption(rows, currentMonthStart);
      setMonthOptions(nextOptions);
      writeStorageValue(monthsCacheKey, nextOptions);
      if (!nextOptions.some((option) => option.month_start === selectedMonthStart)) {
        setSelectedMonthStart(currentMonthStart);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar os meses disponíveis.");
      setMonthOptions(ensureCurrentMonthOption([], currentMonthStart));
    }
  }, [activeCd, currentMonthStart, monthsCacheKey, selectedMonthStart, shouldUseOfflineData]);

  const loadZones = useCallback(async () => {
    if (!zoneType || activeCd == null) {
      setZoneRows([]);
      return;
    }
    if (shouldUseOfflineData) {
      const cached = readStorageValue<RondaQualidadeZoneSummary[]>(zoneCacheKey(selectedMonthStart, zoneType), []);
      setZoneRows(filterZoneRows(cached, zoneSearch));
      return;
    }
    setZonesBusy(true);
    try {
      const rows = await fetchRondaQualidadeZoneList({
        cd: activeCd,
        zoneType,
        monthRef: selectedMonthRef,
        search: zoneSearch.trim() || null
      });
      setZoneRows(rows);
      if (zoneSearch.trim() === "") {
        writeStorageValue(zoneCacheKey(selectedMonthStart, zoneType), rows);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar zonas.");
    } finally {
      setZonesBusy(false);
    }
  }, [activeCd, selectedMonthRef, selectedMonthStart, shouldUseOfflineData, zoneCacheKey, zoneSearch, zoneType]);

  const loadDetail = useCallback(async (zona: string) => {
    if (!zoneType || activeCd == null) {
      setDetail(null);
      return;
    }
    if (shouldUseOfflineData) {
      const cached = readStorageValue<RondaQualidadeZoneDetail | null>(detailCacheKey(selectedMonthStart, zoneType, zona), null);
      setDetail(cached);
      return;
    }
    setDetailBusy(true);
    try {
      const nextDetail = await fetchRondaQualidadeZoneDetail({
        cd: activeCd,
        zoneType,
        zona,
        monthRef: selectedMonthRef
      });
      setDetail(nextDetail);
      writeStorageValue(detailCacheKey(selectedMonthStart, zoneType, zona), nextDetail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar a zona.";
      setErrorMessage(message === "Zona não encontrada."
        ? "A zona selecionada não possui mais produtos com estoque disponível."
        : message);
      setDetail(null);
      if (message === "Zona não encontrada.") {
        setSelectedZone(null);
        setSelectedPulColumn(null);
        resetComposerState();
      }
    } finally {
      setDetailBusy(false);
    }
  }, [activeCd, detailCacheKey, resetComposerState, selectedMonthRef, selectedMonthStart, shouldUseOfflineData, zoneType]);

  const loadHistory = useCallback(async () => {
    if (activeCd == null) {
      setHistoryRows([]);
      return;
    }
    if (shouldUseOfflineData) {
      const cached = readStorageValue<RondaQualidadeOccurrenceHistoryRow[]>(
        historyCacheKey(historyMonth || null, historyZoneType, historyStatus, historySearch),
        []
      );
      setHistoryRows(cached);
      return;
    }
    setHistoryBusy(true);
    try {
      const rows = await fetchRondaQualidadeOccurrenceHistory({
        cd: activeCd,
        zoneType: historyZoneType === HISTORY_ALL_TYPES ? null : historyZoneType,
        monthRef: historyMonth || null,
        status: historyStatus,
        search: historySearch.trim() || null,
        limit: HISTORY_LIMIT
      });
      setHistoryRows(rows);
      writeStorageValue(historyCacheKey(historyMonth || null, historyZoneType, historyStatus, historySearch), rows);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar o histórico.");
    } finally {
      setHistoryBusy(false);
    }
  }, [activeCd, historyCacheKey, historyMonth, historySearch, historyStatus, historyZoneType, shouldUseOfflineData]);

  const loadAddressOptions = useCallback(async () => {
    if (!composerOpen || activeCd == null || !zoneType || !selectedZone) {
      setAddressOptions([]);
      return;
    }
    if (zoneType === "PUL" && selectedPulColumn == null) {
      setAddressOptions([]);
      return;
    }
    setAddressesBusy(true);
    try {
      const rows = await fetchRondaQualidadeAddressOptions({
        cd: activeCd,
        zoneType,
        zona: selectedZone,
        coluna: zoneType === "PUL" ? selectedPulColumn : null,
        limit: 1000
      });
      setAddressOptions(rows);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar endereços da zona.");
      setAddressOptions([]);
    } finally {
      setAddressesBusy(false);
    }
  }, [activeCd, composerOpen, selectedPulColumn, selectedZone, zoneType]);

  useEffect(() => {
    void loadZones();
  }, [loadZones]);

  useEffect(() => {
    setPreferOfflineMode(readStorageValue<boolean>(offlineModeKey, false));
    setOfflineMeta(readStorageValue<RondaOfflineMeta>(offlineMetaKey, { updated_at: null, zone_count: 0, month_count: 0 }));
  }, [offlineMetaKey, offlineModeKey]);

  useEffect(() => {
    writeStorageValue(offlineModeKey, preferOfflineMode);
  }, [offlineModeKey, preferOfflineMode]);

  useEffect(() => {
    if (!errorMessage && !statusMessage) return;
    const timer = window.setTimeout(() => {
      setErrorMessage(null);
      setStatusMessage(null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [errorMessage, statusMessage]);

  useEffect(() => {
    void loadMonthOptions();
  }, [loadMonthOptions]);

  useEffect(() => {
    if (!activeAuditSession) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeAuditSession]);

  useEffect(() => {
    if (zoneType !== "PUL" || !activeAuditSession || activeAuditSession.zoneType !== "PUL") return;
    if (selectedZone !== activeAuditSession.zona) return;
    if (selectedPulColumn != null || activeAuditSession.coluna == null) return;
    setSelectedPulColumn(activeAuditSession.coluna);
  }, [activeAuditSession, selectedPulColumn, selectedZone, zoneType]);

  useEffect(() => {
    if (!selectedZone) {
      setDetail(null);
      setSelectedPulColumn(null);
      return;
    }
    void loadDetail(selectedZone);
  }, [loadDetail, selectedZone]);

  useEffect(() => {
    if (!historyOpen) return;
    void loadHistory();
  }, [historyOpen, loadHistory]);

  useEffect(() => {
    void loadAddressOptions();
  }, [loadAddressOptions]);

  useEffect(() => {
    if (!selectedZone || zoneSearch.trim() !== "") return;
    if (zoneRows.some((row) => row.zona === selectedZone)) return;
    setSelectedZone(null);
    setSelectedPulColumn(null);
    setDetail(null);
    resetComposerState();
  }, [resetComposerState, selectedZone, zoneRows, zoneSearch]);

  useEffect(() => {
    setHistoryMonth(selectedMonthStart);
  }, [selectedMonthStart]);

  useEffect(() => {
    if (zoneType !== "PUL" || selectedPulColumn == null || detail == null) return;
    if (detail.column_stats.some((row) => row.coluna === selectedPulColumn)) return;
    setSelectedPulColumn(null);
    resetComposerState();
  }, [detail, resetComposerState, selectedPulColumn, zoneType]);

  useEffect(() => {
    setSelectedZone(null);
    setDetail(null);
    setZoneSearch("");
    setSelectedPulColumn(null);
    resetComposerState();
  }, [resetComposerState, zoneType]);

  useEffect(() => {
    const onFocus = () => {
      void loadMonthOptions();
      void loadZones();
      if (selectedZone) void loadDetail(selectedZone);
      if (historyOpen) void loadHistory();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [historyOpen, loadDetail, loadHistory, loadMonthOptions, loadZones, selectedZone]);

  const openHistory = useCallback(() => {
    if (!isOnline && offlineMeta.zone_count <= 0) return;
    setHistoryZoneType(zoneType ?? HISTORY_ALL_TYPES);
    setHistoryMonth(selectedMonthStart);
    setHistoryOpen(true);
  }, [isOnline, offlineMeta.zone_count, selectedMonthStart, zoneType]);

  const selectZoneType = useCallback((nextType: RondaQualidadeZoneType | null) => {
    if (nextType === zoneType) return;
    runWithDiscardedActiveAudit(() => {
      setZoneType(nextType);
    });
  }, [runWithDiscardedActiveAudit, zoneType]);

  const selectZone = useCallback((nextZone: string | null) => {
    if (nextZone === selectedZone) return;
    runWithDiscardedActiveAudit(() => {
      setSelectedZone(nextZone);
      setSelectedPulColumn(null);
    });
  }, [runWithDiscardedActiveAudit, selectedZone]);

  const selectPulColumn = useCallback((nextColumn: number | null) => {
    if (nextColumn === selectedPulColumn) return;
    runWithDiscardedActiveAudit(() => {
      setSelectedPulColumn(nextColumn);
    });
  }, [runWithDiscardedActiveAudit, selectedPulColumn]);

  const startAuditSession = useCallback((target: RondaAuditTarget, alreadyAudited: boolean) => {
    if (!isOnline || readOnlyCorrectionMode) return;

    const applyStart = () => {
      const startedAt = new Date().toISOString();
      setSelectedZone(target.zona);
      setSelectedPulColumn(target.zoneType === "PUL" ? target.coluna : null);
      resetComposerState();
      setActiveAuditSession({
        ...target,
        startedAt
      });
      setErrorMessage(null);
      setStatusMessage(
        alreadyAudited
          ? `Nova auditoria iniciada para a ${describeAuditTarget(target)}.`
          : `Auditoria iniciada para a ${describeAuditTarget(target)}.`
      );
      setConfirmState(null);
      confirmActionRef.current = null;
    };

    if (sameAuditTarget(activeAuditSession, target)) {
      setSelectedZone(target.zona);
      setSelectedPulColumn(target.zoneType === "PUL" ? target.coluna : null);
      setStatusMessage(`A auditoria da ${describeAuditTarget(target)} já está em andamento.`);
      setErrorMessage(null);
      return;
    }

    const openStartConfirm = () => openConfirmDialog(
      {
        title: alreadyAudited ? "Reiniciar auditoria" : "Iniciar auditoria",
        message: alreadyAudited
          ? `A ${describeAuditTarget(target)} já possui histórico no mês. Deseja iniciar uma nova auditoria?`
          : `A auditoria da ${describeAuditTarget(target)} será iniciada agora. Deseja continuar?`,
        helper: "Ao confirmar, o cronômetro começa a contar e você poderá concluir com ou sem ocorrência.",
        confirmLabel: alreadyAudited ? "Reiniciar auditoria" : "Iniciar auditoria",
        confirmTone: "primary"
      },
      applyStart
    );

    if (activeAuditSession) {
      openConfirmDialog(
        {
          title: "Trocar auditoria em andamento",
          message: `A auditoria da ${activeAuditLabel} será descartada para iniciar a ${describeAuditTarget(target)}.`,
          helper: "Os dados locais da auditoria atual serão perdidos ao continuar.",
          confirmLabel: alreadyAudited ? "Descartar e reiniciar" : "Descartar e iniciar",
          confirmTone: "danger"
        },
        () => {
          clearActiveAuditSession();
          applyStart();
        }
      );
      return;
    }

    openStartConfirm();
  }, [activeAuditLabel, activeAuditSession, clearActiveAuditSession, isOnline, openConfirmDialog, readOnlyCorrectionMode, resetComposerState]);

  const cancelActiveAudit = useCallback(() => {
    if (!activeAuditSession) return;
    openConfirmDialog(
      {
        title: "Cancelar auditoria em andamento",
        message: `A auditoria da ${activeAuditLabel} será cancelada e todos os dados lançados nesta tela serão descartados. Deseja continuar?`,
        helper: "Ao cancelar, a referência continua com o status que já possuía antes desta tentativa.",
        confirmLabel: "Cancelar auditoria",
        confirmTone: "danger"
      },
      () => {
        clearActiveAuditSession();
        setErrorMessage(null);
        setStatusMessage("Auditoria cancelada. Os dados locais foram descartados.");
        setConfirmState(null);
        confirmActionRef.current = null;
      }
    );
  }, [activeAuditLabel, activeAuditSession, clearActiveAuditSession, openConfirmDialog]);

  const openComposer = useCallback(() => {
    if (!activeAuditMatchesSelection) {
      setErrorMessage("Clique em Iniciar antes de adicionar ocorrência.");
      return;
    }
    if (zoneType === "PUL" && selectedPulColumn == null) {
      setErrorMessage("Selecione uma coluna do Pulmão antes de adicionar ocorrência.");
      return;
    }
    setErrorMessage(null);
    setComposerOpen(true);
  }, [activeAuditMatchesSelection, selectedPulColumn, zoneType]);

  const closeComposer = useCallback(() => {
    if (auditBusy) return;
    setComposerOpen(false);
  }, [auditBusy]);

  const syncOfflineBase = useCallback(async () => {
    if (!isOnline || activeCd == null) return;
    setBusySync(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const nextMonths = ensureCurrentMonthOption(await fetchRondaQualidadeMonthOptions(activeCd), currentMonthStart);
      writeStorageValue(monthsCacheKey, nextMonths);
      setMonthOptions(nextMonths);

      let zoneCount = 0;
      let activeRows: RondaQualidadeZoneSummary[] | null = null;
      for (const type of ["SEP", "PUL"] as const) {
        const rows = await fetchRondaQualidadeZoneList({
          cd: activeCd,
          zoneType: type,
          monthRef: selectedMonthStart,
          search: null
        });
        writeStorageValue(zoneCacheKey(selectedMonthStart, type), rows);
        zoneCount += rows.length;
        if (zoneType === type) activeRows = rows;
      }

      if (zoneType && activeRows) {
        setZoneRows(filterZoneRows(activeRows, zoneSearch));
      }

      if (zoneType && selectedZone) {
        try {
          const nextDetail = await fetchRondaQualidadeZoneDetail({
            cd: activeCd,
            zoneType,
            zona: selectedZone,
            monthRef: selectedMonthStart
          });
          writeStorageValue(detailCacheKey(selectedMonthStart, zoneType, selectedZone), nextDetail);
          setDetail(nextDetail);
        } catch {
          // Ignore detail sync failures during base sync.
        }
      }

      const nextMeta: RondaOfflineMeta = {
        updated_at: new Date().toISOString(),
        zone_count: zoneCount,
        month_count: nextMonths.length
      };
      writeStorageValue(offlineMetaKey, nextMeta);
      setOfflineMeta(nextMeta);
      setStatusMessage("Base local da Ronda de Qualidade sincronizada.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao sincronizar a base local.");
    } finally {
      setBusySync(false);
    }
  }, [
    activeCd,
    currentMonthStart,
    detailCacheKey,
    isOnline,
    monthsCacheKey,
    offlineMetaKey,
    selectedMonthStart,
    selectedZone,
    zoneCacheKey,
    zoneSearch,
    zoneType
  ]);

  const handleToggleOffline = useCallback(async () => {
    const next = !preferOfflineMode;
    if (next && offlineMeta.zone_count <= 0) {
      setErrorMessage("Sem base local da Ronda de Qualidade. Conecte-se e sincronize antes de usar offline.");
      return;
    }
    setPreferOfflineMode(next);
    setStatusMessage(next ? "Modo offline ativado." : "Modo offline desativado.");
    setErrorMessage(null);
  }, [offlineMeta.zone_count, preferOfflineMode]);

  const handleSubmitNoOccurrence = useCallback(async () => {
    if (!isOnline) {
      setErrorMessage("Conecte-se à internet para registrar a auditoria.");
      return;
    }
    if (readOnlyCorrectionMode) {
      setErrorMessage("Meses anteriores ficam apenas para consulta e correção.");
      return;
    }
    if (!zoneType || !selectedZone || activeCd == null) {
      setErrorMessage("Selecione a zona antes de concluir a auditoria.");
      return;
    }
    if (!activeAuditMatchesSelection || !activeAuditSession) {
      setErrorMessage("Clique em Iniciar antes de concluir a auditoria.");
      return;
    }
    if (zoneType === "PUL" && selectedPulColumn == null) {
      setErrorMessage("Selecione uma coluna do Pulmão antes de registrar a auditoria.");
      return;
    }
    if (noOccurrenceAlreadyRegistered) {
      setErrorMessage(zoneType === "PUL"
        ? `A coluna ${selectedPulColumn} da zona ${selectedZone} já foi registrada sem ocorrência neste mês.`
        : `A zona ${selectedZone} já foi registrada sem ocorrência neste mês.`);
      return;
    }

    const targetLabel = zoneType === "PUL"
      ? `coluna ${selectedPulColumn} da zona ${selectedZone}`
      : `zona ${selectedZone}`;
    openConfirmDialog(
      {
        title: "Registrar auditoria sem ocorrência",
        message: zoneType === "PUL"
          ? `Confirma que a ${targetLabel} de pulmão foi auditada sem ocorrência?`
          : `Confirma que a ${targetLabel} de separação foi auditada sem ocorrência?`,
        helper: "Essa confirmação pode ser feita apenas uma vez no mês para esta referência. Se encontrar erro depois, use Adicionar ocorrência.",
        confirmLabel: "Confirmar sem ocorrência",
        confirmTone: "primary"
      },
      async () => {
        if (!isOnline || readOnlyCorrectionMode || !zoneType || !selectedZone || activeCd == null) return;
        if (!activeAuditMatchesSelection || !activeAuditSession) {
          closeConfirmDialog();
          setErrorMessage("Clique em Iniciar antes de concluir a auditoria.");
          return;
        }
        if (zoneType === "PUL" && selectedPulColumn == null) {
          closeConfirmDialog();
          setErrorMessage("Selecione uma coluna do Pulmão antes de registrar a auditoria.");
          return;
        }
        if (noOccurrenceAlreadyRegistered) {
          closeConfirmDialog();
          setErrorMessage(zoneType === "PUL"
            ? `A coluna ${selectedPulColumn} da zona ${selectedZone} já foi registrada sem ocorrência neste mês.`
            : `A zona ${selectedZone} já foi registrada sem ocorrência neste mês.`);
          return;
        }
        setAuditBusy(true);
        setErrorMessage(null);
        setStatusMessage(null);
        try {
          closeConfirmDialog();
          await submitRondaQualidadeAudit({
            cd: activeCd,
            zoneType,
            zona: selectedZone,
            coluna: zoneType === "PUL" ? selectedPulColumn : null,
            auditResult: "sem_ocorrencia",
            startedAt: activeAuditSession.startedAt
          });
          clearActiveAuditSession();
          setStatusMessage(zoneType === "PUL"
            ? `Coluna ${selectedPulColumn} da zona ${selectedZone} registrada sem ocorrência.`
            : `Zona ${selectedZone} registrada sem ocorrência.`);
          await loadMonthOptions();
          await loadZones();
          await loadDetail(selectedZone);
          if (historyOpen) await loadHistory();
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "Falha ao registrar a auditoria.");
        } finally {
          setAuditBusy(false);
        }
      }
    );
  }, [activeAuditMatchesSelection, activeAuditSession, activeCd, clearActiveAuditSession, closeConfirmDialog, historyOpen, isOnline, loadDetail, loadHistory, loadMonthOptions, loadZones, noOccurrenceAlreadyRegistered, openConfirmDialog, readOnlyCorrectionMode, selectedPulColumn, selectedZone, zoneType]);

  const handleSaveOccurrences = useCallback(async () => {
    if (!isOnline) {
      setErrorMessage("Conecte-se à internet para salvar a auditoria.");
      return;
    }
    if (readOnlyCorrectionMode) {
      setErrorMessage("Meses anteriores ficam apenas para consulta e correção.");
      return;
    }
    if (!zoneType || !selectedZone || activeCd == null) {
      setErrorMessage("Selecione a zona antes de salvar a auditoria.");
      return;
    }
    if (!activeAuditMatchesSelection || !activeAuditSession) {
      setErrorMessage("Clique em Iniciar antes de salvar a auditoria.");
      return;
    }
    if (zoneType === "PUL" && selectedPulColumn == null) {
      setErrorMessage("Selecione uma coluna do Pulmão antes de adicionar ocorrências.");
      return;
    }

    const invalidDraft = drafts.find((draft) => (
      !draft.motivo.trim()
      || !draft.endereco.trim()
    ));

    if (invalidDraft) {
      setErrorMessage("Preencha motivo e endereço em todas as ocorrências.");
      return;
    }

    setAuditBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await submitRondaQualidadeAudit({
        cd: activeCd,
        zoneType,
        zona: selectedZone,
        coluna: zoneType === "PUL" ? selectedPulColumn : null,
        auditResult: "com_ocorrencia",
        occurrences: drafts,
        startedAt: activeAuditSession.startedAt
      });
      clearActiveAuditSession();
      setStatusMessage(zoneType === "PUL"
        ? `Auditoria salva com ${formatCount(result.occurrence_count, "ocorrência", "ocorrências")} na coluna ${selectedPulColumn} da zona ${selectedZone}.`
        : `Auditoria salva com ${formatCount(result.occurrence_count, "ocorrência", "ocorrências")} na zona ${selectedZone}.`);
      await loadMonthOptions();
      await loadZones();
      await loadDetail(selectedZone);
      if (historyOpen) await loadHistory();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar as ocorrências.");
    } finally {
      setAuditBusy(false);
    }
  }, [activeAuditMatchesSelection, activeAuditSession, activeCd, clearActiveAuditSession, drafts, historyOpen, isOnline, loadDetail, loadHistory, loadMonthOptions, loadZones, readOnlyCorrectionMode, selectedPulColumn, selectedZone, zoneType]);

  const handleToggleCorrection = useCallback(async (occurrenceId: string, currentStatus: RondaQualidadeCorrectionStatus) => {
    if (!isOnline) return;
    const nextStatus: RondaQualidadeCorrectionStatus = currentStatus === "corrigido" ? "nao_corrigido" : "corrigido";
    setUpdatingOccurrenceId(occurrenceId);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await setRondaQualidadeOccurrenceCorrection({
        occurrenceId,
        correctionStatus: nextStatus
      });
      if (selectedZone) await loadDetail(selectedZone);
      if (historyOpen) await loadHistory();
      setStatusMessage(`Ocorrência marcada como ${correctionStatusLabel(nextStatus).toLocaleLowerCase("pt-BR")}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao atualizar o status da ocorrência.");
    } finally {
      setUpdatingOccurrenceId(null);
    }
  }, [historyOpen, isOnline, loadDetail, loadHistory, selectedZone]);

  const handleDeleteOccurrence = useCallback((occurrenceId: string) => {
    if (!isOnline || !isAdmin) return;
    openConfirmDialog(
      {
        title: "Excluir ocorrência",
        message: "Tem certeza que deseja excluir esta ocorrência? Esta ação não pode ser desfeita.",
        confirmLabel: "Excluir",
        confirmTone: "danger"
      },
      async () => {
        setAuditBusy(true);
        setErrorMessage(null);
        setStatusMessage(null);
        try {
          await deleteRondaQualidadeOccurrence({ occurrenceId });
          setConfirmState(null);
          confirmActionRef.current = null;
          if (selectedZone) await loadDetail(selectedZone);
          if (historyOpen) await loadHistory();
          setStatusMessage("Ocorrência excluída com sucesso.");
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "Falha ao excluir a ocorrência.");
        } finally {
          setAuditBusy(false);
        }
      }
    );
  }, [historyOpen, isAdmin, isOnline, loadDetail, loadHistory, openConfirmDialog, selectedZone]);

  const currentZoneSummary = detail ?? (selectedZone ? zoneRows.find((row) => row.zona === selectedZone) ?? null : null);
  const closeAddressPicker = useCallback(() => {
    setAddressPickerIndex(null);
    setAddressPickerSearch("");
  }, []);
  const openAddressPicker = useCallback((index: number) => {
    setAddressPickerIndex(index);
    setAddressPickerSearch("");
  }, []);
  const getAddressOptionsForPicker = useCallback((search: string) => (
    filterAddressOptions(addressOptions, search, zoneType === "PUL" ? addressLevelFilter : "")
  ), [addressLevelFilter, addressOptions, zoneType]);

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

      <section className="modules-shell">
        <article className="module-screen surface-enter">
          <div className="module-screen-body module-screen-body-large ronda-page">
            <div className="ronda-head">
              <h2>Olá, {displayUserName}</h2>
              <p>Para trabalhar offline, sincronize a base da Ronda de Qualidade.</p>
              <p className="ronda-meta-line">{offlineManifestInfo}</p>
            </div>

            <div className="ronda-actions-row">
              <button type="button" className="btn btn-muted ronda-sync-btn" onClick={() => void syncOfflineBase()} disabled={!isOnline || busySync}>
                <span className="ronda-inline-icon" aria-hidden="true">{refreshIcon()}</span>
                {busySync ? "Sincronizando..." : "Sincronizar"}
              </button>
              <button
                type="button"
                className={`btn btn-muted ronda-offline-toggle${preferOfflineMode ? " is-active" : ""}`}
                onClick={() => void handleToggleOffline()}
                disabled={busySync}
              >
                {preferOfflineMode ? "📦 Off-Line" : "📶 Off-Line"}
              </button>
              <button type="button" className="btn btn-muted ronda-history-button" onClick={openHistory} disabled={!isOnline && offlineMeta.zone_count <= 0}>
                <span className="ronda-inline-icon" aria-hidden="true">{historyIcon()}</span>
                Ocorrências
              </button>
            </div>

            {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
            {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
            {readOnlyCorrectionMode ? (
              <div className="ronda-month-rule">
                {`Mês de ${selectedMonthLabel} em modo de acompanhamento. Novas auditorias ficam bloqueadas e as ocorrências antigas podem ser consultadas e marcadas como corrigidas ou não corrigidas.`}
              </div>
            ) : null}

            <section className="ronda-type-grid">
              {(["SEP", "PUL"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`ronda-type-card${zoneType === type ? " is-active" : ""}`}
                  aria-pressed={zoneType === type}
                  onClick={() => selectZoneType(zoneType === type ? null : type)}
                >
                  <div className="ronda-type-card-head">
                    <strong>
                      <span className="ronda-type-icon" aria-hidden="true">
                        {type === "SEP" ? separacaoIcon() : pulmaoIcon()}
                      </span>
                      {zoneTypeLabel(type)}
                    </strong>
                    {zoneType === type ? (
                      <span className="ronda-type-selected-dot" aria-label="Selecionado" title="Selecionado" />
                    ) : (
                      <span>Abrir</span>
                    )}
                  </div>
                  <p>
                    {type === "SEP"
                      ? "Auditoria por zona de separação."
                      : "Auditoria por zona e coluna do pulmão."}
                  </p>
                </button>
              ))}
            </section>

            {zoneType ? (
              <div className="pvps-progress-card" role="status" aria-live="polite">
                <div className="pvps-progress-head">
                  <strong>{progressTitle}</strong>
                  <span>{formatPercent(completionPercent)}</span>
                </div>
                <div className="pvps-progress-track" aria-hidden="true">
                  <span
                    className={`pvps-progress-fill${completionPercent < 100 ? " is-pending" : ""}`}
                    style={{ width: `${Math.max(0, Math.min(completionPercent, 100))}%` }}
                  />
                </div>
                <small>
                  {zoneType === "PUL"
                    ? `${formatCount(auditedPulColumns, "coluna auditada", "colunas auditadas")} de ${formatCount(totalPulColumns, "coluna", "colunas")} na base ${shouldUseOfflineData ? "local atual" : "online atual"}.`
                    : `${formatCount(auditedZones.length, "zona auditada", "zonas auditadas")} de ${formatCount(zoneRows.length, "zona", "zonas")} na base ${shouldUseOfflineData ? "local atual" : "online atual"}.`}
                </small>
              </div>
            ) : null}

            {zoneType ? (
              <div className={`ronda-layout${selectedZone ? " has-zone" : ""}`}>
                <section className="ronda-zones-panel">
                  <div className="ronda-panel-head">
                    <div>
                      <h3>{`Zonas de ${zoneTypeLabel(zoneType)}`}</h3>
                      <span>{zonesBusy ? "Atualizando..." : `${formatCount(zoneRows.length, "zona carregada", "zonas carregadas")}`}</span>
                    </div>
                  </div>

                  <label className="ronda-search-field" aria-label="Buscar zona">
                    <span className="ronda-search-icon" aria-hidden="true">{searchIcon()}</span>
                    <input
                      type="text"
                      value={zoneSearch}
                      onChange={(event) => setZoneSearch(event.target.value)}
                      placeholder={`Buscar zona de ${zoneTypeLabelLower(zoneType)}...`}
                      inputMode="search"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="ronda-search-clear"
                      onClick={() => setZoneSearch("")}
                      disabled={zoneSearch.trim() === ""}
                      title="Limpar busca"
                    >
                      {closeIcon()}
                    </button>
                  </label>

                  <div className="ronda-zone-section">
                    <div className="ronda-zone-section-head">
                      <strong>Não auditadas no mês</strong>
                      <span>{formatInteger(unauditedZones.length)}</span>
                    </div>
                    {unauditedZones.length === 0 ? (
                      <div className="ronda-empty-card">Nenhuma zona pendente para este mês.</div>
                    ) : (
                      <div className="ronda-zone-list">
                        {unauditedZones.map((row) => (
                          <article
                            key={`${row.zone_type}:${row.zona}`}
                            className={`ronda-zone-card${selectedZone === row.zona ? " is-active" : ""}`}
                          >
                            <div className="ronda-zone-card-main">
                              <button type="button" className="ronda-zone-card-trigger" onClick={() => selectZone(row.zona)}>
                                <span className="ronda-zone-name">{row.zona}</span>
                              </button>
                              <RondaStartButton
                                active={sameAuditTarget(activeAuditSession, { zoneType: row.zone_type, zona: row.zona, coluna: null })}
                                auditedInMonth={row.audited_in_month}
                                onClick={() => startAuditSession({ zoneType: row.zone_type, zona: row.zona, coluna: null }, row.audited_in_month)}
                                disabled={!isOnline || readOnlyCorrectionMode || sameAuditTarget(activeAuditSession, { zoneType: row.zone_type, zona: row.zona, coluna: null })}
                                ariaLabel={sameAuditTarget(activeAuditSession, { zoneType: row.zone_type, zona: row.zona, coluna: null })
                                  ? "Auditoria em andamento"
                                  : auditActionLabel(row.audited_in_month)}
                                title={readOnlyCorrectionMode
                                  ? "Meses anteriores ficam apenas para consulta e correção."
                                  : sameAuditTarget(activeAuditSession, { zoneType: row.zone_type, zona: row.zona, coluna: null })
                                  ? "Esta auditoria já está em andamento."
                                  : auditActionLabel(row.audited_in_month)}
                              />
                            </div>
                            <div className="ronda-zone-card-info">
                              <span className="ronda-zone-metric">{zoneCardMetricLabel(row)}</span>
                              <span className={`ronda-zone-badge ${zoneCardBadgeClass(row)}`}>{zoneCardBadgeLabel(row)}</span>
                            </div>
                            {renderZoneCardDetails(row, selectedZone === row.zona)}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="ronda-zone-section">
                    <div className="ronda-zone-section-head">
                      <strong>Auditadas no mês</strong>
                      <span>{formatInteger(auditedZones.length)}</span>
                    </div>
                    {auditedZones.length === 0 ? (
                      <div className="ronda-empty-card">Nenhuma zona auditada neste mês.</div>
                    ) : (
                      <div className="ronda-zone-list">
                        {auditedZones.map((row) => (
                          <article
                            key={`${row.zone_type}:${row.zona}`}
                            className={`ronda-zone-card is-audited${selectedZone === row.zona ? " is-active" : ""}`}
                          >
                            <div className="ronda-zone-card-main">
                              <button type="button" className="ronda-zone-card-trigger" onClick={() => selectZone(row.zona)}>
                                <span className="ronda-zone-name">{row.zona}</span>
                              </button>
                              <RondaStartButton
                                active={sameAuditTarget(activeAuditSession, { zoneType: row.zone_type, zona: row.zona, coluna: null })}
                                auditedInMonth={true}
                                onClick={() => startAuditSession({ zoneType: row.zone_type, zona: row.zona, coluna: null }, true)}
                                disabled={!isOnline || readOnlyCorrectionMode || sameAuditTarget(activeAuditSession, { zoneType: row.zone_type, zona: row.zona, coluna: null })}
                                ariaLabel={sameAuditTarget(activeAuditSession, { zoneType: row.zone_type, zona: row.zona, coluna: null })
                                  ? "Auditoria em andamento"
                                  : auditActionLabel(true)}
                                title={readOnlyCorrectionMode
                                  ? "Meses anteriores ficam apenas para consulta e correção."
                                  : sameAuditTarget(activeAuditSession, { zoneType: row.zone_type, zona: row.zona, coluna: null })
                                    ? "Esta auditoria já está em andamento."
                                    : auditActionLabel(true)}
                              />
                            </div>
                            <div className="ronda-zone-card-info">
                              <span className="ronda-zone-metric">{zoneCardMetricLabel(row)}</span>
                              <span className={`ronda-zone-badge ${zoneCardBadgeClass(row)}`}>{zoneCardBadgeLabel(row)}</span>
                            </div>
                            {renderZoneCardDetails(row, selectedZone === row.zona)}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <section className="ronda-detail-panel">
                  {selectedZone ? (
                    <button
                      type="button"
                      className="ronda-back-btn"
                      onClick={() => selectZone(null)}
                      aria-label="Voltar para lista de zonas"
                    >
                      <span className="ronda-inline-icon" aria-hidden="true">{chevronLeftIcon()}</span>
                      <span>Zonas</span>
                    </button>
                  ) : null}
                  {selectedZone == null ? (
                    <div className="ronda-empty-card ronda-detail-empty">
                      Selecione uma zona para visualizar os detalhes da auditoria.
                    </div>
                  ) : detailBusy && detail == null ? (
                    <div className="ronda-empty-card ronda-detail-empty">Carregando detalhes da zona...</div>
                  ) : currentZoneSummary ? (
                    <>
                      <div className="ronda-panel-head">
                        <div>
                          <div className="ronda-title-row">
                            <h3>{selectedZone}</h3>
                            {zoneType === "SEP" || (zoneType === "PUL" && selectedColumnStat) ? (
                              <RondaStartButton
                                active={activeAuditMatchesSelection}
                                auditedInMonth={zoneType === "SEP"
                                  ? currentZoneSummary.audited_in_month
                                  : selectedColumnStat?.audited_in_month ?? false}
                                onClick={() => startAuditSession(
                                  zoneType === "SEP"
                                    ? { zoneType: "SEP", zona: selectedZone, coluna: null }
                                    : { zoneType: "PUL", zona: selectedZone, coluna: selectedColumnStat?.coluna ?? null },
                                  zoneType === "SEP"
                                    ? currentZoneSummary.audited_in_month
                                    : selectedColumnStat?.audited_in_month ?? false
                                )}
                                disabled={!isOnline || readOnlyCorrectionMode || activeAuditMatchesSelection}
                                ariaLabel={activeAuditMatchesSelection
                                  ? "Auditoria em andamento"
                                  : auditActionLabel(zoneType === "SEP"
                                    ? currentZoneSummary.audited_in_month
                                    : selectedColumnStat?.audited_in_month ?? false)}
                                title={readOnlyCorrectionMode
                                  ? "Meses anteriores ficam apenas para consulta e correção."
                                  : activeAuditMatchesSelection
                                    ? "Esta auditoria já está em andamento."
                                    : auditActionLabel(zoneType === "SEP"
                                      ? currentZoneSummary.audited_in_month
                                      : selectedColumnStat?.audited_in_month ?? false)}
                              />
                            ) : null}
                          </div>
                          <span>{zoneTypeLabel(zoneType)}</span>
                        </div>
                        <div className="ronda-detail-actions">
                          {activeAuditMatchesSelection && activeAuditSession ? (
                            <div className="ronda-active-audit-card">
                              <strong>Auditoria em andamento</strong>
                              <span>{`Tempo: ${activeAuditElapsedLabel}`}</span>
                              <small>{`Início: ${formatDateTime(activeAuditSession.startedAt)}`}</small>
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-muted"
                            onClick={openComposer}
                            disabled={auditBusy || !isOnline || occurrenceActionDisabledReason != null}
                            title={occurrenceActionDisabledReason}
                          >
                            <span className="ronda-inline-icon" aria-hidden="true">{plusIcon()}</span>
                            Adicionar ocorrência
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => void handleSubmitNoOccurrence()}
                            disabled={auditBusy || !isOnline || noOccurrenceDisabledReason != null}
                            title={noOccurrenceDisabledReason}
                          >
                            <span className="ronda-inline-icon" aria-hidden="true">{checkIcon()}</span>
                            Sem ocorrência
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={cancelActiveAudit}
                            disabled={auditBusy || cancelAuditDisabledReason != null}
                            title={cancelAuditDisabledReason}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>

                      <div className="ronda-summary-grid">
                        {zoneType === "SEP" ? (
                          <>
                            <article className="ronda-summary-card"><span>Endereços</span><strong>{formatInteger(currentZoneSummary.total_enderecos)}</strong></article>
                            <article className="ronda-summary-card"><span>Endereços com ocorrência</span><strong>{formatInteger(currentZoneSummary.enderecos_com_ocorrencia)}</strong></article>
                            {currentZoneSummary.audited_in_month ? (
                              <article className="ronda-summary-card"><span>% conformidade</span><strong>{formatPercent(currentZoneSummary.percentual_conformidade)}</strong></article>
                            ) : null}
                            <article className="ronda-summary-card"><span>Auditorias no mês</span><strong>{formatInteger(currentZoneSummary.total_auditorias)}</strong></article>
                            <article className="ronda-summary-card"><span>Último início</span><strong>{formatDateTime(currentZoneSummary.last_started_at)}</strong></article>
                            <article className="ronda-summary-card"><span>Último fim</span><strong>{formatDateTime(currentZoneSummary.last_finished_at)}</strong></article>
                          </>
                        ) : (
                          <>
                            <article className="ronda-summary-card"><span>Colunas</span><strong>{formatInteger(currentZoneSummary.total_colunas)}</strong></article>
                            <article className="ronda-summary-card"><span>Produtos únicos</span><strong>{formatInteger(currentZoneSummary.produtos_unicos)}</strong></article>
                            <article className="ronda-summary-card"><span>Auditorias em colunas</span><strong>{formatInteger(currentZoneSummary.total_auditorias)}</strong></article>
                            <article className="ronda-summary-card"><span>Último início</span><strong>{formatDateTime(currentZoneSummary.last_started_at)}</strong></article>
                            <article className="ronda-summary-card"><span>Último fim</span><strong>{formatDateTime(currentZoneSummary.last_finished_at)}</strong></article>
                          </>
                        )}
                      </div>

                      {zoneType === "PUL" ? (
                        <div className="ronda-pul-grid">
                          <section className="ronda-stat-block">
                            <div className="ronda-stat-block-head">
                              <h4>Produtos por coluna</h4>
                              <span>{formatCount(detail?.total_colunas ?? currentZoneSummary.total_colunas, "coluna", "colunas")}</span>
                            </div>
                            {detail?.column_stats.length ? (
                              <div className="ronda-mini-card-grid">
                                {detail.column_stats
                                  .filter((row) => selectedPulColumn == null || selectedPulColumn === row.coluna)
                                  .map((row) => (
                                  <article
                                    key={row.coluna}
                                    className={`ronda-mini-card ronda-column-card${selectedPulColumn === row.coluna ? " is-active" : ""}`}
                                  >
                                    <button
                                      type="button"
                                      className="ronda-column-card-trigger"
                                      onClick={() => selectPulColumn(selectedPulColumn === row.coluna ? null : row.coluna)}
                                    >
                                      <strong>{`Coluna ${row.coluna}`}</strong>
                                      <span>{formatCount(row.produtos_unicos, "produto", "produtos")}</span>
                                      {row.audited_in_month ? <small>{formatPercent(row.percentual_conformidade)}</small> : null}
                                      {row.last_started_at ? <small>{`Início: ${formatDateTime(row.last_started_at)}`}</small> : null}
                                      {row.last_finished_at ? <small>{`Fim: ${formatDateTime(row.last_finished_at)}`}</small> : null}
                                    </button>
                                    <div className="ronda-zone-card-actions">
                                      <RondaStartButton
                                        active={sameAuditTarget(activeAuditSession, { zoneType: "PUL", zona: selectedZone, coluna: row.coluna })}
                                        auditedInMonth={row.audited_in_month}
                                        onClick={() => startAuditSession({ zoneType: "PUL", zona: selectedZone, coluna: row.coluna }, row.audited_in_month)}
                                        disabled={!isOnline || readOnlyCorrectionMode || sameAuditTarget(activeAuditSession, { zoneType: "PUL", zona: selectedZone, coluna: row.coluna })}
                                        ariaLabel={sameAuditTarget(activeAuditSession, { zoneType: "PUL", zona: selectedZone, coluna: row.coluna })
                                          ? "Auditoria em andamento"
                                          : auditActionLabel(row.audited_in_month)}
                                        title={readOnlyCorrectionMode
                                          ? "Meses anteriores ficam apenas para consulta e correção."
                                          : sameAuditTarget(activeAuditSession, { zoneType: "PUL", zona: selectedZone, coluna: row.coluna })
                                            ? "Esta auditoria já está em andamento."
                                            : auditActionLabel(row.audited_in_month)}
                                      />
                                      <span className={`ronda-zone-badge ${row.audited_in_month ? "is-audited" : "is-pending"}`}>
                                        {row.audited_in_month ? "Auditada" : "Pendente"}
                                      </span>
                                    </div>
                                  </article>
                                ))}
                              </div>
                            ) : <div className="ronda-empty-card">Sem colunas identificadas nesta zona.</div>}
                          </section>

                          <section className="ronda-stat-block ronda-column-audit-panel">
                            <div className="ronda-stat-block-head">
                              <div>
                                <h4>{selectedColumnStat ? `Auditoria da coluna ${selectedColumnStat.coluna}` : "Selecione uma coluna"}</h4>
                                <span>
                                  {selectedColumnStat
                                    ? `${formatCount(selectedColumnStat.produtos_unicos, "produto", "produtos")} | ${selectedColumnStat.audited_in_month ? formatPercent(selectedColumnStat.percentual_conformidade) : "Pendente"}`
                                    : "As ocorrências do Pulmão são registradas dentro da coluna."}
                                </span>
                              </div>
                            </div>
                            <div className="ronda-detail-actions">
                              {activeAuditMatchesSelection && activeAuditSession ? (
                                <div className="ronda-active-audit-card">
                                  <strong>Auditoria em andamento</strong>
                                  <span>{`Tempo: ${activeAuditElapsedLabel}`}</span>
                                  <small>{`Início: ${formatDateTime(activeAuditSession.startedAt)}`}</small>
                                </div>
                              ) : null}
                              <button
                                type="button"
                                className="btn btn-muted"
                                onClick={openComposer}
                                disabled={auditBusy || !isOnline || occurrenceActionDisabledReason != null}
                                title={occurrenceActionDisabledReason}
                              >
                                <span className="ronda-inline-icon" aria-hidden="true">{plusIcon()}</span>
                                Adicionar ocorrência
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => void handleSubmitNoOccurrence()}
                                disabled={auditBusy || !isOnline || noOccurrenceDisabledReason != null}
                                title={noOccurrenceDisabledReason}
                              >
                                <span className="ronda-inline-icon" aria-hidden="true">{checkIcon()}</span>
                                Sem ocorrência
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger"
                                onClick={cancelActiveAudit}
                                disabled={auditBusy || cancelAuditDisabledReason != null}
                                title={cancelAuditDisabledReason}
                              >
                                Cancelar
                              </button>
                            </div>
                          </section>
                        </div>
                      ) : null}

                      <section className="ronda-history-section">
                        <div className="ronda-stat-block-head">
                          <h4>Histórico do mês</h4>
                          <span>{formatCount(detail?.history_rows.length ?? 0, "auditoria", "auditorias")}</span>
                        </div>
                        {detail?.history_rows.length ? (
                          <div className="ronda-session-list">
                            {detail.history_rows.map((session) => (
                              <article key={session.audit_id} className="ronda-session-card">
                                <div className="ronda-session-head">
                                  <div>
                                    <strong>{auditResultLabel(session.audit_result)}</strong>
                                    <span>
                                      {zoneType === "PUL" && session.coluna != null
                                        ? `Coluna ${session.coluna} | ${session.auditor_nome} | MAT ${session.auditor_mat}`
                                        : `${session.auditor_nome} | MAT ${session.auditor_mat}`}
                                    </span>
                                  </div>
                                  <small>{`Início: ${formatDateTime(session.started_at)} | Fim: ${formatDateTime(session.finished_at)}`}</small>
                                </div>

                                {session.occurrences.length === 0 ? (
                                  <div className="ronda-session-empty">
                                    Nenhuma ocorrência registrada nesta auditoria.
                                  </div>
                                ) : (
                                  <div className="ronda-occurrence-list">
                                    {[...session.occurrences].sort(compareOccurrenceReason).map((occurrence) => (
                                      <article key={occurrence.occurrence_id} className="ronda-occurrence-card">
                                        <div className="ronda-occurrence-head">
                                          <strong>{occurrence.motivo}</strong>
                                          <span className={`ronda-correction-pill is-${occurrence.correction_status}`}>
                                            {correctionStatusLabel(occurrence.correction_status)}
                                          </span>
                                        </div>
                                        <div className="ronda-occurrence-meta">
                                          {zoneType === "PUL" && occurrence.nivel ? <span>{`Nível: ${occurrence.nivel}`}</span> : null}
                                          <span>{`Endereço: ${occurrence.endereco}`}</span>
                                          {zoneType === "PUL" && occurrence.coluna != null ? <span>{`Coluna: ${occurrence.coluna}`}</span> : null}
                                          <span>{`Registro: ${formatDateTime(occurrence.created_at)}`}</span>
                                        </div>
                                        <p>{occurrence.observacao}</p>
                                        <div className="ronda-occurrence-footer">
                                          <small>
                                            {occurrence.correction_updated_at
                                              ? `Último check: ${correctionStatusLabel(occurrence.correction_status)} por ${occurrence.correction_updated_nome ?? "Usuário"} em ${formatDateTime(occurrence.correction_updated_at)}`
                                              : "Aguardando check de correção."}
                                          </small>
                                          <button
                                            type="button"
                                            className="btn btn-muted"
                                            onClick={() => void handleToggleCorrection(occurrence.occurrence_id, occurrence.correction_status)}
                                            disabled={!isOnline || updatingOccurrenceId === occurrence.occurrence_id}
                                          >
                                            {updatingOccurrenceId === occurrence.occurrence_id
                                              ? "Salvando..."
                                              : occurrence.correction_status === "corrigido"
                                                ? "Marcar não corrigido"
                                                : "Marcar corrigido"}
                                          </button>
                                          {isAdmin ? (
                                            <button
                                              type="button"
                                              className="btn btn-danger"
                                              onClick={() => handleDeleteOccurrence(occurrence.occurrence_id)}
                                              disabled={!isOnline || auditBusy}
                                            >
                                              Excluir
                                            </button>
                                          ) : null}
                                        </div>
                                      </article>
                                    ))}
                                  </div>
                                )}
                              </article>
                            ))}
                          </div>
                        ) : (
                          <div className="ronda-empty-card">Nenhuma auditoria registrada nesta zona no mês atual.</div>
                        )}
                      </section>
                    </>
                  ) : (
                    <div className="ronda-empty-card ronda-detail-empty">
                      Não foi possível carregar os dados desta zona agora.
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <div className="ronda-empty-card ronda-intro-card">
                <strong>Selecione o tipo de zona</strong>
                <p>
                  Escolha <strong>Separação</strong> ou <strong>Pulmão</strong> para carregar as zonas do mês.
                </p>
              </div>
            )}
          </div>
        </article>
      </section>

      {confirmState && typeof document !== "undefined"
        ? createPortal(
            <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="ronda-confirm-title" onClick={closeConfirmDialog}>
              <div className="confirm-dialog ronda-confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="ronda-confirm-title">{confirmState.title}</h3>
                <p>{confirmState.message}</p>
                {confirmState.helper ? <small>{confirmState.helper}</small> : null}
                <div className="confirm-actions">
                  <button className="btn btn-muted" type="button" onClick={closeConfirmDialog} disabled={auditBusy}>
                    Cancelar
                  </button>
                  <button
                    className={confirmState.confirmTone === "danger" ? "btn btn-danger" : "btn btn-primary"}
                    type="button"
                    onClick={() => void confirmDialogAction()}
                    disabled={auditBusy}
                  >
                    {auditBusy ? "Processando..." : confirmState.confirmLabel}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {composerOpen && selectedZone && zoneType && typeof document !== "undefined"
        ? createPortal(
            <div className="ronda-overlay" onClick={closeComposer}>
              <div className="ronda-sheet ronda-composer-sheet surface-enter" onClick={(event) => event.stopPropagation()}>

                {/* Cabeçalho do composer */}
                <div className="ronda-composer-head">
                  <div className="ronda-composer-head-info">
                    <span className={`ronda-composer-zone-badge is-${zoneType.toLowerCase()}`}>
                      {zoneType === "PUL" ? pulmaoIcon() : separacaoIcon()}
                      {zoneType === "PUL" && selectedPulColumn != null
                        ? `${zoneTypeLabel(zoneType)} · Col. ${selectedPulColumn}`
                        : zoneTypeLabel(zoneType)}
                    </span>
                    <h3 className="ronda-composer-zone-title">{`Zona ${selectedZone}`}</h3>
                    <p className="ronda-composer-zone-sub">
                      {`${drafts.length} ocorrência${drafts.length !== 1 ? "s" : ""} em rascunho`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="ronda-close-btn"
                    onClick={closeComposer}
                    disabled={auditBusy}
                    aria-label="Fechar janela de ocorrências"
                  >
                    {closeIcon()}
                  </button>
                </div>

                {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
                {statusMessage ? <div className="alert success">{statusMessage}</div> : null}

                {/* Filtro de nível (Pulmão) */}
                {zoneType === "PUL" && addressLevelOptions.length > 0 ? (
                  <div className="ronda-composer-level-filter">
                    <span className="ronda-composer-level-label">Nível da coluna</span>
                    <div className="ronda-composer-level-chips">
                      <button
                        type="button"
                        className={`ronda-composer-level-chip${addressLevelFilter === "" ? " is-active" : ""}`}
                        onClick={() => setAddressLevelFilter("")}
                        disabled={auditBusy || addressesBusy}
                      >
                        Todos
                      </button>
                      {addressLevelOptions.map((nivel) => (
                        <button
                          key={nivel}
                          type="button"
                          className={`ronda-composer-level-chip${addressLevelFilter === nivel ? " is-active" : ""}`}
                          onClick={() => setAddressLevelFilter(nivel)}
                          disabled={auditBusy || addressesBusy}
                        >
                          {nivel}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {addressesBusy ? (
                  <div className="ronda-composer-loading">
                    <div className="ronda-hist-spinner" aria-hidden="true" />
                    <span>Carregando endereços…</span>
                  </div>
                ) : null}

                {/* Lista de rascunhos */}
                <div className="ronda-draft-list">
                  {drafts.map((draft, index) => (
                    <article key={`draft-${index}`} className="ronda-draft-card">

                      <div className="ronda-draft-head">
                        <div className="ronda-draft-head-left">
                          <span className="ronda-draft-number">{index + 1}</span>
                          <strong className="ronda-draft-label">
                            {draft.motivo || "Ocorrência sem motivo"}
                          </strong>
                        </div>
                        {drafts.length > 1 ? (
                          <button
                            type="button"
                            className="ronda-draft-remove-btn"
                            onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}
                            disabled={auditBusy}
                            aria-label={`Remover ocorrência ${index + 1}`}
                            title="Remover esta ocorrência"
                          >
                            {closeIcon()}
                          </button>
                        ) : null}
                      </div>

                      <div className="ronda-draft-fields">
                        <label className="field">
                          <span>Motivo</span>
                          <select
                            value={draft.motivo}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setDrafts((current) => current.map((item, itemIndex) => (
                                itemIndex === index ? { ...item, motivo: nextValue } : item
                              )));
                            }}
                            disabled={auditBusy}
                          >
                            <option value="">Selecione o motivo</option>
                            {reasonOptions.map((reason) => (
                              <option key={reason} value={reason}>{reason}</option>
                            ))}
                          </select>
                        </label>

                        <label className="field">
                          <span>Endereço</span>
                          <div className="input-icon-wrap with-action ronda-address-input-wrap">
                            <input
                              type="text"
                              value={draft.endereco}
                              onChange={(event) => {
                                const nextValue = event.target.value.toLocaleUpperCase("pt-BR");
                                const normalizedNextValue = normalizeAddressValue(nextValue);
                                const selectedAddress = addressOptions.find((option) => (
                                  normalizeAddressValue(option.endereco) === normalizedNextValue
                                ));
                                if (nextValue.trim() !== "") closeAddressPicker();
                                setDrafts((current) => current.map((item, itemIndex) => (
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        endereco: selectedAddress?.endereco ?? nextValue,
                                        nivel: selectedAddress?.nivel ?? item.nivel,
                                        enderecoManual: normalizedNextValue !== "" && !selectedAddress
                                      }
                                    : item
                                )));
                              }}
                              placeholder="Informe ou busque o endereço"
                              inputMode="search"
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              disabled={auditBusy || addressesBusy}
                            />
                            {draft.endereco.trim() === "" ? (
                              <button
                                type="button"
                                className="input-action-btn ronda-address-search-btn"
                                onClick={() => {
                                  if (addressPickerIndex === index) { closeAddressPicker(); return; }
                                  openAddressPicker(index);
                                }}
                                disabled={auditBusy || addressesBusy || addressOptions.length === 0}
                                title="Buscar endereço na lista"
                                aria-label="Buscar endereço na lista"
                              >
                                {searchIcon()}
                              </button>
                            ) : null}
                          </div>
                          {addressPickerIndex === index && draft.endereco.trim() === "" ? (
                            <div className="ronda-address-picker">
                              <div className="ronda-address-picker-search">
                                <span className="ronda-address-picker-search-icon" aria-hidden="true">{searchIcon()}</span>
                                <input
                                  type="text"
                                  value={addressPickerSearch}
                                  onChange={(event) => setAddressPickerSearch(event.target.value)}
                                  placeholder="Buscar endereço disponível"
                                  inputMode="search"
                                  autoComplete="off"
                                  autoCorrect="off"
                                  spellCheck={false}
                                  disabled={auditBusy || addressesBusy}
                                />
                                <button
                                  type="button"
                                  className="ronda-address-picker-close"
                                  onClick={closeAddressPicker}
                                  aria-label="Fechar busca de endereços"
                                >
                                  {closeIcon()}
                                </button>
                              </div>
                              <div className="ronda-address-picker-list">
                                {getAddressOptionsForPicker(addressPickerSearch).length > 0 ? (
                                  getAddressOptionsForPicker(addressPickerSearch).map((option) => (
                                    <button
                                      key={`${option.endereco}:${option.nivel ?? "sem-nivel"}`}
                                      type="button"
                                      className="ronda-address-picker-option"
                                      onClick={() => {
                                        setDrafts((current) => current.map((item, itemIndex) => (
                                          itemIndex === index
                                            ? { ...item, endereco: option.endereco, nivel: option.nivel ?? "", enderecoManual: false }
                                            : item
                                        )));
                                        closeAddressPicker();
                                      }}
                                    >
                                      <strong>{addressOptionLabel(option)}</strong>
                                      <span>{option.nivel ? `Nível ${option.nivel}` : "Sem nível"}</span>
                                    </button>
                                  ))
                                ) : (
                                  <div className="ronda-address-picker-empty">Nenhum endereço encontrado.</div>
                                )}
                              </div>
                            </div>
                          ) : null}
                          {addressOptions.length === 0 && !addressesBusy ? (
                            <small>Nenhum endereço disponível para a zona selecionada.</small>
                          ) : null}
                          {draft.endereco ? (
                            <small>
                              {draft.enderecoManual ? `✏️ Digitado manualmente` : `✓ ${draft.endereco}`}
                            </small>
                          ) : null}
                        </label>

                        <label className="field">
                          <span>Observação <em>(opcional)</em></span>
                          <textarea
                            rows={3}
                            value={draft.observacao}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setDrafts((current) => current.map((item, itemIndex) => (
                                itemIndex === index ? { ...item, observacao: nextValue } : item
                              )));
                            }}
                            placeholder="Descreva a ocorrência encontrada, se necessário."
                            disabled={auditBusy}
                          />
                        </label>
                      </div>
                    </article>
                  ))}
                </div>

                {/* Botão adicionar ocorrência */}
                <button
                  type="button"
                  className="ronda-composer-add-btn"
                  onClick={() => setDrafts((current) => [...current, emptyDraft()])}
                  disabled={auditBusy}
                >
                  <span className="ronda-inline-icon" aria-hidden="true">{plusIcon()}</span>
                  Adicionar ocorrência
                </button>

                {/* Barra de ação — salvar */}
                <div className="ronda-composer-footer">
                  <button
                    type="button"
                    className="ronda-composer-save-btn"
                    onClick={() => void handleSaveOccurrences()}
                    disabled={auditBusy}
                  >
                    {auditBusy ? (
                      <>
                        <div className="ronda-hist-spinner" aria-hidden="true" />
                        Salvando…
                      </>
                    ) : (
                      <>
                        {checkIcon()}
                        Salvar auditoria
                      </>
                    )}
                  </button>
                </div>

              </div>
            </div>,
            document.body
          )
        : null}

      {historyOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="ronda-overlay" onClick={() => setHistoryOpen(false)}>
              <div className="ronda-sheet ronda-sheet-wide surface-enter" onClick={(event) => event.stopPropagation()}>
                <div className="ronda-sheet-head">
                  <div>
                    <h3>Acompanhamento de ocorrências</h3>
                    <span>Histórico consolidado · check de correção em tempo real</span>
                  </div>
                  <button
                    type="button"
                    className="ronda-close-btn"
                    onClick={() => setHistoryOpen(false)}
                    aria-label="Fechar acompanhamento de ocorrências"
                  >
                    {closeIcon()}
                  </button>
                </div>

                <div className="ronda-hist-toolbar">
                  <div className="ronda-hist-selects">
                    <div className="ronda-hist-select-wrap">
                      <span className="ronda-hist-select-label">Tipo</span>
                      <select
                        className="ronda-hist-select"
                        value={historyZoneType}
                        onChange={(event) => setHistoryZoneType(event.target.value as typeof HISTORY_ALL_TYPES | RondaQualidadeZoneType)}
                      >
                        <option value={HISTORY_ALL_TYPES}>Todos</option>
                        <option value="SEP">Separação</option>
                        <option value="PUL">Pulmão</option>
                      </select>
                    </div>

                    <div className="ronda-hist-select-wrap">
                      <span className="ronda-hist-select-label">Mês</span>
                      <select
                        className="ronda-hist-select"
                        value={historyMonth}
                        onChange={(event) => setHistoryMonth(event.target.value)}
                      >
                        <option value="">Todos os meses</option>
                        {monthOptions.map((option) => (
                          <option key={`history:${option.month_start}`} value={option.month_start}>
                            {formatCompactMonthLabel(option.month_start)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="ronda-hist-select-wrap">
                      <span className="ronda-hist-select-label">Status</span>
                      <select
                        className="ronda-hist-select"
                        value={historyStatus}
                        onChange={(event) => setHistoryStatus(event.target.value as "todos" | RondaQualidadeCorrectionStatus)}
                      >
                        <option value="todos">Todos</option>
                        <option value="nao_corrigido">Não corrigido</option>
                        <option value="corrigido">Corrigido</option>
                      </select>
                    </div>
                  </div>

                  <div className="ronda-hist-search-wrap">
                    <span className="ronda-hist-search-icon" aria-hidden="true">{searchIcon()}</span>
                    <input
                      className="ronda-hist-search-input"
                      type="text"
                      value={historySearch}
                      onChange={(event) => setHistorySearch(event.target.value)}
                      placeholder="Zona, endereço, motivo ou observação…"
                      inputMode="search"
                      autoComplete="off"
                    />
                    {historySearch ? (
                      <button
                        type="button"
                        className="ronda-search-clear"
                        onClick={() => setHistorySearch("")}
                        aria-label="Limpar busca"
                      >
                        {closeIcon()}
                      </button>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className="ronda-hist-refresh-btn"
                    onClick={() => void loadHistory()}
                    disabled={historyBusy || !isOnline}
                    aria-label="Atualizar"
                    title="Atualizar"
                  >
                    <span aria-hidden="true">{refreshIcon()}</span>
                    <span>Atualizar</span>
                  </button>
                </div>

                {!historyBusy && historyRows.length > 0 ? (
                  <div className="ronda-hist-count-bar">
                    <span className="ronda-hist-count-total">
                      {`${historyRows.length} ocorrência${historyRows.length !== 1 ? "s" : ""}`}
                    </span>
                    <span className="ronda-hist-count-pill is-nao_corrigido">
                      {`${historyCounts.nao_corrigido} não corrigidas`}
                    </span>
                    <span className="ronda-hist-count-pill is-corrigido">
                      {`${historyCounts.corrigido} corrigidas`}
                    </span>
                  </div>
                ) : null}

                {historyBusy ? (
                  <div className="ronda-hist-loading">
                    <div className="ronda-hist-spinner" aria-hidden="true" />
                    <span>Carregando histórico…</span>
                  </div>
                ) : null}

                {!historyBusy && historyRows.length === 0 ? (
                  <div className="ronda-hist-empty">
                    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.35-4.35" />
                      <path d="M8 11h6" />
                    </svg>
                    <strong>Nenhuma ocorrência encontrada</strong>
                    <span>Tente ajustar os filtros ou a busca.</span>
                  </div>
                ) : null}

                {!historyBusy && historyRows.length > 0 ? (
                  <div className="ronda-hist-list">
                    {sortedHistoryRows.map((row) => (
                      <article key={row.occurrence_id} className={`ronda-hist-card is-${row.correction_status}`}>
                        <div className="ronda-hist-card-accent" aria-hidden="true" />
                        <div className="ronda-hist-card-body">
                          <div className="ronda-hist-card-header">
                            <strong className="ronda-hist-card-motivo">{row.motivo}</strong>
                            <div className="ronda-hist-card-badges">
                              <span className={`ronda-hist-type-badge is-${row.zone_type.toLowerCase()}`}>
                                {zoneTypeLabel(row.zone_type)}
                              </span>
                              <span className={`ronda-correction-pill is-${row.correction_status}`}>
                                {correctionStatusLabel(row.correction_status)}
                              </span>
                            </div>
                          </div>
                          <div className="ronda-hist-chips">
                            <span className="ronda-hist-chip ronda-hist-chip-loc">{`Zona ${row.zona}`}</span>
                            <span className="ronda-hist-chip ronda-hist-chip-loc">{`End. ${row.endereco}`}</span>
                            {row.nivel ? (
                              <span className="ronda-hist-chip ronda-hist-chip-loc">{`Nível ${row.nivel}`}</span>
                            ) : null}
                            {row.coluna != null ? (
                              <span className="ronda-hist-chip ronda-hist-chip-loc">{`Col. ${row.coluna}`}</span>
                            ) : null}
                          </div>
                          <div className="ronda-hist-chips">
                            <span className="ronda-hist-chip">{`${row.auditor_nome} · ${row.auditor_mat}`}</span>
                            <span className="ronda-hist-chip">{formatDateTime(row.created_at)}</span>
                            <span className="ronda-hist-chip">{formatMonthLabel(formatMonthFromDate(row.month_ref))}</span>
                          </div>
                          {row.observacao ? (
                            <p className="ronda-hist-card-obs">{row.observacao}</p>
                          ) : null}
                          <div className="ronda-hist-card-footer">
                            <span className="ronda-hist-check-info">
                              {row.correction_updated_at
                                ? `Último check: ${correctionStatusLabel(row.correction_status)} por ${row.correction_updated_nome ?? "Usuário"} em ${formatDateTime(row.correction_updated_at)}`
                                : "Sem check de correção registrado."}
                            </span>
                            <div className="ronda-hist-card-actions">
                              <button
                                type="button"
                                className={`ronda-hist-action-btn${row.correction_status === "corrigido" ? " is-undo" : " is-check"}`}
                                onClick={() => void handleToggleCorrection(row.occurrence_id, row.correction_status)}
                                disabled={!isOnline || updatingOccurrenceId === row.occurrence_id}
                              >
                                {updatingOccurrenceId === row.occurrence_id
                                  ? "Salvando…"
                                  : row.correction_status === "corrigido"
                                    ? "Desfazer correção"
                                    : "Marcar corrigido"}
                              </button>
                              {isAdmin ? (
                                <button
                                  type="button"
                                  className="ronda-hist-action-btn is-delete"
                                  onClick={() => handleDeleteOccurrence(row.occurrence_id)}
                                  disabled={!isOnline || auditBusy}
                                  aria-label="Excluir ocorrência"
                                >
                                  Excluir
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}

              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
