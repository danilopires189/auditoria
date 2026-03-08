import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { formatCountLabel } from "../../shared/inflection";
import { shouldTriggerQueuedBackgroundSync } from "../../shared/offline/queue-policy";
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import { getModuleByKeyOrThrow } from "../registry";
import {
  countVwAuditoriasReportRows,
  createAdminRule,
  fetchAlocacaoCompletedItemsDayAll,
  fetchAdminRulesActive,
  fetchAdminRulesHistory,
  fetchAlocacaoManifest,
  fetchPvpsCompletedItemsDayAll,
  fetchPvpsManifest,
  fetchPvpsPulItems,
  fetchPvpsReportPulItems,
  fetchVwAuditoriasReportRows,
  previewAdminRuleImpact,
  removeAdminRule,
  submitAlocacao,
  submitAlocacaoCompletedEdit,
  submitPvpsPul,
  submitPvpsSep
} from "./sync";
import { syncPvpsOfflineQueue } from "./offline-sync";
import {
  countErrorOfflineEvents,
  countPendingOfflineEvents,
  getPvpsAlocPrefs,
  hasOfflineSnapshot,
  hasOfflineSepCache,
  listPendingOfflineEvents,
  loadOfflineSnapshot,
  saveOfflineAlocacaoEvent,
  saveOfflineSnapshot,
  savePvpsAlocPrefs,
  saveOfflinePulEvent,
  saveOfflineSepEvent,
  upsertOfflineSepCache
} from "./storage";
import type {
  AlocacaoCompletedRow,
  AlocacaoManifestRow,
  AlocacaoSubmitResult,
  PvpsAuditoriasReportFilters,
  PvpsAuditoriasReportRow,
  PvpsAdminRuleActiveRow,
  PvpsAdminRuleHistoryRow,
  PvpsCompletedRow,
  PvpsRuleApplyMode,
  PvpsRuleKind,
  PvpsRuleTargetType,
  PvpsAlocOfflineEventRow,
  PvpsEndSit,
  PvpsManifestRow,
  PvpsModulo,
  PvpsAlocacaoModuleProfile,
  PvpsPulItemRow
} from "./types";

interface PvpsAlocacaoPageProps {
  isOnline: boolean;
  profile: PvpsAlocacaoModuleProfile;
}

type ModuleTab = "pvps" | "alocacao";
type FeedView = "pendentes" | "concluidos";
type AdminRulesView = "active" | "history";
type PendingAddressSortDirection = "asc" | "desc";

interface AdminRuleDraft {
  modulo: PvpsModulo;
  rule_kind: PvpsRuleKind;
  target_type: PvpsRuleTargetType;
  target_value: string;
  priority_value: string;
}

interface AdminRuleApplyPreview {
  draft: AdminRuleDraft;
  affected_pvps: number;
  affected_alocacao: number;
  affected_total: number;
}

interface AnimatedFeedRevealProps {
  cardKey: string;
  className: string;
  children: ReactNode;
}

type PvpsFeedItem =
  | {
    kind: "sep";
    feedKey: string;
    row: PvpsManifestRow;
    zone: string;
    endereco: string;
  }
  | {
    kind: "pul";
    feedKey: string;
    row: PvpsManifestRow;
    zone: string;
    endereco: string;
    endPul: string;
    nivel: string | null;
  };

const MODULE_DEF = getModuleByKeyOrThrow("pvps-alocacao");
const FEED_NEXT_PREVIEW_LIMIT = 5;
const ADMIN_HISTORY_VIEW_LIMIT = 20;
const ENDERECO_COLLATOR = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

function AnimatedFeedReveal({ cardKey, className, children }: AnimatedFeedRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (visible) return;
    if (typeof window === "undefined" || typeof window.IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {
        threshold: 0.18,
        rootMargin: "0px 0px -10% 0px"
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [cardKey, visible]);

  return (
    <div
      ref={ref}
      className={`${className} pvps-card-reveal${visible ? " is-visible" : ""}`}
    >
      {children}
    </div>
  );
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

function keyOfPvps(row: { coddv: number; end_sep: string }): string {
  return keyOfPvpsByValues(row.coddv, row.end_sep);
}

function keyOfPvpsByValues(coddv: number, endSep: string): string {
  return `${Math.trunc(coddv)}|${endSep.trim().toUpperCase()}`;
}

function normalizePulCacheKey(rawKey: string): string {
  const separatorIndex = rawKey.indexOf("|");
  if (separatorIndex <= 0) return rawKey.trim().toUpperCase();
  const coddvPart = rawKey.slice(0, separatorIndex).trim();
  const endSepPart = rawKey.slice(separatorIndex + 1);
  const coddv = Number.parseInt(coddvPart, 10);
  if (!Number.isFinite(coddv)) return rawKey.trim().toUpperCase();
  return keyOfPvpsByValues(coddv, endSepPart);
}

function getPulItemsByRowKey(
  cache: Record<string, PvpsPulItemRow[]>,
  coddv: number,
  endSep: string
): PvpsPulItemRow[] {
  const rawKey = `${Math.trunc(coddv)}|${endSep}`;
  const normalizedKey = keyOfPvpsByValues(coddv, endSep);
  if (Array.isArray(cache[rawKey])) return cache[rawKey];
  if (Array.isArray(cache[normalizedKey])) return cache[normalizedKey];
  return [];
}

function expectedPendingPulCount(
  row: Pick<PvpsManifestRow, "status" | "pul_total" | "pul_auditados">
): number {
  if (row.status !== "pendente_pul") return 0;
  const total = Math.max(0, row.pul_total);
  const audited = Math.max(0, row.pul_auditados);
  return Math.max(total - audited, 0);
}

function hasUsablePulCacheForRow(
  row: Pick<PvpsManifestRow, "status" | "pul_total" | "pul_auditados">,
  items: PvpsPulItemRow[] | null | undefined
): boolean {
  const list = Array.isArray(items) ? items : [];
  const expectedPending = expectedPendingPulCount(row);
  if (!list.length) return expectedPending === 0;
  if (expectedPending === 0) return true;
  const pendingInCache = list.reduce((count, item) => count + (item.auditado ? 0 : 1), 0);
  return pendingInCache > 0;
}

function formatMmaaDigits(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "").slice(0, 4);
  if (digits.length !== 4) return null;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function applyPendingEventsToOfflineData(input: {
  pvpsRows: PvpsManifestRow[];
  alocRows: AlocacaoManifestRow[];
  pulBySepKey: Record<string, PvpsPulItemRow[]>;
  events: PvpsAlocOfflineEventRow[];
}): {
  pvpsRows: PvpsManifestRow[];
  alocRows: AlocacaoManifestRow[];
  pulBySepKey: Record<string, PvpsPulItemRow[]>;
} {
  const pvpsRows = [...input.pvpsRows];
  const alocRows = [...input.alocRows];
  const pulBySepKey: Record<string, PvpsPulItemRow[]> = {};
  for (const [sepKey, items] of Object.entries(input.pulBySepKey)) {
    pulBySepKey[normalizePulCacheKey(sepKey)] = Array.isArray(items) ? [...items] : [];
  }

  for (const event of input.events) {
    if (event.kind === "sep") {
      if (!event.end_sep) continue;
      const rowKey = keyOfPvpsByValues(event.coddv, event.end_sep);
      const rowIndex = pvpsRows.findIndex((row) => keyOfPvps(row) === rowKey);
      if (rowIndex < 0) continue;
      const hasOcorrencia = event.end_sit === "vazio" || event.end_sit === "obstruido";
      if (hasOcorrencia) {
        pvpsRows.splice(rowIndex, 1);
        delete pulBySepKey[rowKey];
      } else {
        const current = pvpsRows[rowIndex];
        pvpsRows[rowIndex] = {
          ...current,
          status: "pendente_pul",
          end_sit: null,
          val_sep: formatMmaaDigits(event.val_sep) ?? current.val_sep
        };
      }
      continue;
    }

    if (event.kind === "pul") {
      if (!event.end_sep || !event.end_pul) continue;
      const rowKey = keyOfPvpsByValues(event.coddv, event.end_sep);
      const cachedPul = pulBySepKey[rowKey];
      if (Array.isArray(cachedPul) && cachedPul.length > 0) {
        const normalizedValPul = formatMmaaDigits(event.val_pul);
        const normalizedEndSit = event.end_sit === "vazio" || event.end_sit === "obstruido" ? event.end_sit : null;
        pulBySepKey[rowKey] = cachedPul.map((item) => (
          item.end_pul === event.end_pul
            ? { ...item, auditado: true, end_sit: normalizedEndSit, val_pul: normalizedEndSit ? null : normalizedValPul }
            : item
        ));
      }

      const rowIndex = pvpsRows.findIndex((row) => keyOfPvps(row) === rowKey);
      if (rowIndex >= 0) {
        const row = pvpsRows[rowIndex];
        const currentPul = pulBySepKey[rowKey] ?? [];
        const auditedCount = currentPul.filter((item) => item.auditado).length;
        if (auditedCount >= Math.max(row.pul_total, 1)) {
          pvpsRows.splice(rowIndex, 1);
          delete pulBySepKey[rowKey];
        } else {
          pvpsRows[rowIndex] = {
            ...row,
            status: "pendente_pul",
            pul_auditados: Math.max(row.pul_auditados, auditedCount)
          };
        }
      }
      continue;
    }

    if (event.kind === "alocacao" && event.queue_id) {
      const rowIndex = alocRows.findIndex((row) => row.queue_id === event.queue_id);
      if (rowIndex >= 0) {
        alocRows.splice(rowIndex, 1);
      }
    }
  }

  return { pvpsRows, alocRows, pulBySepKey };
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(parsed);
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(parsed);
}

function formatTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || "-";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(parsed);
}

function reportValue(row: PvpsAuditoriasReportRow, ...keys: string[]): string {
  const rowEntries = Object.entries(row);
  for (const key of keys) {
    const directValue = row[key];
    if (directValue != null) {
      const normalized = String(directValue).trim();
      if (normalized) return normalized;
    }
    const normalizedKey = key.trim().toLowerCase();
    const matchedEntry = rowEntries.find(([entryKey]) => entryKey.trim().toLowerCase() === normalizedKey);
    if (!matchedEntry) continue;
    const normalized = String(matchedEntry[1] ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function validadeRank(value: string): number | null {
  const normalized = normalizeMmaa(value);
  if (!normalized) return null;
  const month = Number.parseInt(normalized.slice(0, 2), 10);
  const year = Number.parseInt(normalized.slice(2, 4), 10);
  if (!Number.isFinite(month) || !Number.isFinite(year)) return null;
  return year * 100 + month;
}

function normalizeMmaa(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "").slice(0, 4);
  return digits.length === 4 ? digits : null;
}

function brtDayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function brtMonthStartKey(now = new Date()): string {
  const dayKey = brtDayKey(now);
  return `${dayKey.slice(0, 8)}01`;
}

function formatAndar(value: string | null): string {
  const normalized = (value ?? "").trim();
  if (!normalized) return "-";
  if (normalized.toLowerCase() === "t") return "T";
  return normalized;
}

function resolveFeedAndar(nivel: string | null): string | null {
  const formattedNivel = formatAndar(nivel);
  return formattedNivel === "-" ? null : formattedNivel;
}

function zoneFromEndereco(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) return "SEM ZONA";
  return normalized.slice(0, 4);
}

function compareEndereco(a: string | null | undefined, b: string | null | undefined): number {
  return ENDERECO_COLLATOR.compare((a ?? "").trim().toUpperCase(), (b ?? "").trim().toUpperCase());
}

function compareEnderecoWithDirection(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: PendingAddressSortDirection
): number {
  const result = compareEndereco(a, b);
  return direction === "desc" ? -result : result;
}

function dateSortValue(value: string | null | undefined): number {
  const parsed = new Date(value ?? "").getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeMmaaText(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "").slice(0, 4);
  if (digits.length !== 4) return null;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function occurrenceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <path d="M12 9v4" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </svg>
  );
}

function playIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M10 8l6 4-6 4z" />
    </svg>
  );
}

function refreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M1 4v6h6" />
      <path d="M23 20v-6h-6" />
      <path d="M20.49 9A9 9 0 005.64 5.64L1 10" />
      <path d="M3.51 15A9 9 0 0018.36 18.36L23 14" />
    </svg>
  );
}

function listIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <circle cx="4" cy="6" r="1" fill="currentColor" />
      <circle cx="4" cy="12" r="1" fill="currentColor" />
      <circle cx="4" cy="18" r="1" fill="currentColor" />
    </svg>
  );
}

function filterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

function editIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
      <path d="M15 5l4 4" />
    </svg>
  );
}

function chevronIcon(open: boolean) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {open ? <path d="M18 15l-6-6-6 6" /> : <path d="M6 9l6 6 6-6" />}
    </svg>
  );
}

function doneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function nextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8l4 4-4 4" />
      <path d="M8 12h8" />
    </svg>
  );
}

function clearSelectionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
      <path d="M5 6l1 13a2 2 0 002 2h8a2 2 0 002-2l1-13" />
    </svg>
  );
}

function selectFilteredIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" ry="3" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function searchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function closeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function pendingSortIcon(direction: PendingAddressSortDirection) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {direction === "asc" ? (
        <>
          <path d="M8 17V7" />
          <path d="M5 10l3-3 3 3" />
          <path d="M13 8h6" />
          <path d="M13 12h4" />
          <path d="M13 16h2" />
        </>
      ) : (
        <>
          <path d="M8 7v10" />
          <path d="M5 14l3 3 3-3" />
          <path d="M13 8h2" />
          <path d="M13 12h4" />
          <path d="M13 16h6" />
        </>
      )}
    </svg>
  );
}

function reportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M15 3v3h3" />
      <path d="M9 11h6" />
      <path d="M9 15h6" />
      <path d="M9 19h4" />
    </svg>
  );
}

function floorLevelIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 13.25h10" />
      <path d="M4.75 9.5h6.5" />
      <path d="M6.5 5.75h3" />
    </svg>
  );
}

type HistoryStatusTone = "ok" | "bad" | "warn" | "wait";
type PulFeedbackTone = "ok" | "bad" | "warn";

function formatOcorrenciaLabel(value: PvpsEndSit | null): string {
  if (value === "vazio") return "Vazio";
  if (value === "obstruido") return "Obstruído";
  return "Não informada";
}

function pvpsHistoryStatus(row: PvpsCompletedRow): { label: string; emoticon: string; tone: HistoryStatusTone } {
  if (row.end_sit === "vazio" || row.end_sit === "obstruido") {
    return { label: `Ocorrência: ${formatOcorrenciaLabel(row.end_sit)}`, emoticon: "⚠️", tone: "warn" };
  }
  if (row.pul_auditados < 1) {
    return { label: "Aguardando validade Pulmão", emoticon: "⏳", tone: "wait" };
  }
  if (row.pul_has_lower || row.status === "nao_conforme") {
    return { label: "Não conforme", emoticon: "❌", tone: "bad" };
  }
  return { label: "Conforme", emoticon: "✅", tone: "ok" };
}

function alocHistoryStatus(row: AlocacaoCompletedRow): { label: string; emoticon: string; tone: HistoryStatusTone } {
  if (row.aud_sit === "ocorrencia") {
    return { label: `Ocorrência: ${formatOcorrenciaLabel(row.end_sit)}`, emoticon: "⚠️", tone: "warn" };
  }
  if (row.aud_sit === "nao_conforme") {
    return { label: "Não conforme", emoticon: "❌", tone: "bad" };
  }
  return { label: "Conforme", emoticon: "✅", tone: "ok" };
}

function pvpsStatusLabel(status: PvpsManifestRow["status"]): string {
  if (status === "pendente_sep") return "Pendente Separação";
  if (status === "pendente_pul") return "Pendente Pulmão";
  if (status === "nao_conforme") return "Não conforme";
  return "Concluído";
}

function shouldRefreshAfterAlreadyAudited(message: string): boolean {
  const normalized = message.toUpperCase();
  return (
    normalized.includes("ITEM_PVPS_AUDITADO_POR_OUTRO_USUARIO")
    || normalized.includes("ITEM_PVPS_AUDITADO_PELO_USUARIO")
    || normalized.includes("ITEM_ALOCACAO_AUDITADO_POR_OUTRO_USUARIO")
    || normalized.includes("ITEM_ALOCACAO_AUDITADO_PELO_USUARIO")
    || normalized.includes("ITEM_ALOCACAO_JA_AUDITADO")
  );
}

function ruleKindLabel(value: PvpsRuleKind): string {
  return value === "blacklist" ? "Blacklist" : "Prioridade";
}

function moduloLabel(value: PvpsModulo): string {
  if (value === "pvps") return "PVPS";
  if (value === "alocacao") return "Alocação";
  return "Ambos";
}

function ruleTargetLabel(targetType: PvpsRuleTargetType, targetValue: string): string {
  return targetType === "zona" ? `Zona ${targetValue}` : `SKU ${targetValue}`;
}

function historyActionLabel(value: "create" | "remove"): string {
  return value === "create" ? "Criação" : "Remoção";
}

function applyModeLabel(value: PvpsRuleApplyMode | null): string | null {
  if (value == null) return null;
  return value === "apply_now" ? "Agir agora" : "Próximas inclusões";
}

function completionPercent(completed: number, total: number): number {
  const safeCompleted = Math.max(0, completed);
  const safeTotal = Math.max(0, total);
  if (safeTotal <= 0) return 0;
  const raw = (safeCompleted / safeTotal) * 100;
  return Number(Math.min(100, raw).toFixed(1));
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value)}%`;
}

function reportColumnLabel(key: string): string {
  const normalized = key.trim();
  if (!normalized) return "Coluna";
  if (normalized.toUpperCase() === normalized && normalized.length <= 5) return normalized;
  return normalized
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function reportFieldIsDateLike(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("dt")
    || normalized.includes("data")
    || normalized.includes("hora")
    || normalized.endsWith("_at")
    || normalized.endsWith("at");
}

function reportCellToExcelValue(key: string, value: PvpsAuditoriasReportRow[string]): string | number | boolean {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return value;
  if (reportFieldIsDateLike(key)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDateTime(value);
    }
  }
  return value;
}

export default function PvpsAlocacaoPage({ isOnline, profile }: PvpsAlocacaoPageProps) {
  const displayUserName = toDisplayName(profile.nome);
  const isAdmin = profile.role === "admin";

  const [tab, setTab] = useState<ModuleTab>(() => {
    try {
      const saved = window.localStorage.getItem("pvps-alocacao:tab");
      return saved === "alocacao" ? "alocacao" : "pvps";
    } catch {
      return "pvps";
    }
  });
  const [feedView, setFeedView] = useState<FeedView>("pendentes");
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [pendingAddressSortDirection, setPendingAddressSortDirection] = useState<PendingAddressSortDirection>("asc");
  const [showZoneFilterPopup, setShowZoneFilterPopup] = useState(false);
  const [zoneSearch, setZoneSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastPendingReviewAt, setLastPendingReviewAt] = useState<Record<ModuleTab, string | null>>({
    pvps: null,
    alocacao: null
  });

  const [pvpsRows, setPvpsRows] = useState<PvpsManifestRow[]>([]);
  const [alocRows, setAlocRows] = useState<AlocacaoManifestRow[]>([]);
  const [pvpsCompletedRows, setPvpsCompletedRows] = useState<PvpsCompletedRow[]>([]);
  const [alocCompletedRows, setAlocCompletedRows] = useState<AlocacaoCompletedRow[]>([]);
  const [sepConcludedDayByKey, setSepConcludedDayByKey] = useState<Record<string, string>>({});
  const [todayBrt, setTodayBrt] = useState<string>(() => brtDayKey());
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 980px)").matches;
  });
  const [showAuditoriasReportModal, setShowAuditoriasReportModal] = useState(false);
  const [reportDtIni, setReportDtIni] = useState<string>(() => brtMonthStartKey());
  const [reportDtFim, setReportDtFim] = useState<string>(() => brtDayKey());
  const [reportCdMode, setReportCdMode] = useState<"active_cd" | "all_cds">("active_cd");
  const [reportModulo, setReportModulo] = useState<PvpsModulo>("ambos");
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [reportBusySearch, setReportBusySearch] = useState(false);
  const [reportBusyExport, setReportBusyExport] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const [activePvpsKey, setActivePvpsKey] = useState<string | null>(null);
  const activePvps = useMemo(
    () => pvpsRows.find((row) => keyOfPvps(row) === activePvpsKey) ?? null,
    [pvpsRows, activePvpsKey]
  );
  const [pvpsPopupRow, setPvpsPopupRow] = useState<PvpsManifestRow | null>(null);
  const editorPvpsRow = useMemo(
    () => pvpsPopupRow ?? activePvps,
    [pvpsPopupRow, activePvps]
  );
  const [activePvpsMode, setActivePvpsMode] = useState<"sep" | "pul">("sep");
  const [activePulEnd, setActivePulEnd] = useState<string | null>(null);
  const [feedPulBySepKey, setFeedPulBySepKey] = useState<Record<string, PvpsPulItemRow[]>>({});

  const [pulItems, setPulItems] = useState<PvpsPulItemRow[]>([]);
  const [pulBusy, setPulBusy] = useState(false);
  const activePulItem = useMemo(
    () => (activePulEnd ? pulItems.find((item) => item.end_pul === activePulEnd) ?? null : null),
    [pulItems, activePulEnd]
  );
  const activePvpsEnderecoAuditado = useMemo(
    () => (activePvpsMode === "pul" ? (activePulItem?.end_pul ?? editorPvpsRow?.end_sep ?? "") : (editorPvpsRow?.end_sep ?? "")),
    [activePvpsMode, activePulItem, editorPvpsRow]
  );
  const activePvpsZonaAuditada = useMemo(
    () => zoneFromEndereco(activePvpsEnderecoAuditado),
    [activePvpsEnderecoAuditado]
  );

  const [endSit, setEndSit] = useState<PvpsEndSit | "">("");
  const [valSep, setValSep] = useState("");
  const [pulInputs, setPulInputs] = useState<Record<string, string>>({});
  const [pulEndSits, setPulEndSits] = useState<Record<string, PvpsEndSit | "">>({});
  const [pulFeedback, setPulFeedback] = useState<{ tone: PulFeedbackTone; text: string; feedKey: string } | null>(null);

  const [activeAlocQueue, setActiveAlocQueue] = useState<string | null>(null);
  const activeAloc = useMemo(
    () => alocRows.find((row) => row.queue_id === activeAlocQueue) ?? null,
    [alocRows, activeAlocQueue]
  );
  const [alocEndSit, setAlocEndSit] = useState<PvpsEndSit | "">("");
  const [alocValConf, setAlocValConf] = useState("");
  const [alocResult, setAlocResult] = useState<AlocacaoSubmitResult | null>(null);
  const [showSepOccurrence, setShowSepOccurrence] = useState(false);
  const [showPulOccurrence, setShowPulOccurrence] = useState(false);
  const [showAlocOccurrence, setShowAlocOccurrence] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [busyOfflineBase, setBusyOfflineBase] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingErrors, setPendingErrors] = useState(0);
  const [manifestReady, setManifestReady] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [offlineDiscardedInSession, setOfflineDiscardedInSession] = useState(0);
  const [progressBaselinePvps, setProgressBaselinePvps] = useState<{ key: string; total: number }>({ key: "", total: 0 });
  const [progressBaselineAloc, setProgressBaselineAloc] = useState<{ key: string; total: number }>({ key: "", total: 0 });
  const [adminDraft, setAdminDraft] = useState<AdminRuleDraft>({
    modulo: "ambos",
    rule_kind: "blacklist",
    target_type: "zona",
    target_value: "",
    priority_value: ""
  });
  const [adminApplyMode, setAdminApplyMode] = useState<PvpsRuleApplyMode>("apply_now");
  const [pendingRulePreview, setPendingRulePreview] = useState<AdminRuleApplyPreview | null>(null);
  const [adminRulesView, setAdminRulesView] = useState<AdminRulesView>("active");
  const [activeRuleRows, setActiveRuleRows] = useState<PvpsAdminRuleActiveRow[]>([]);
  const [historyRuleRows, setHistoryRuleRows] = useState<PvpsAdminRuleHistoryRow[]>([]);
  const [showPvpsPopup, setShowPvpsPopup] = useState(false);
  const [showAlocPopup, setShowAlocPopup] = useState(false);
  const [expandedPvps, setExpandedPvps] = useState<Record<string, boolean>>({});
  const [expandedAloc, setExpandedAloc] = useState<Record<string, boolean>>({});
  const [expandedPvpsCompleted, setExpandedPvpsCompleted] = useState<Record<string, boolean>>({});
  const [expandedAlocCompleted, setExpandedAlocCompleted] = useState<Record<string, boolean>>({});
  const [pvpsCompletedPulByAuditId, setPvpsCompletedPulByAuditId] = useState<Record<string, PvpsPulItemRow[]>>({});
  const [pvpsCompletedPulLoading, setPvpsCompletedPulLoading] = useState<Record<string, boolean>>({});
  const [editingPvpsCompleted, setEditingPvpsCompleted] = useState<PvpsCompletedRow | null>(null);
  const [editingAlocCompleted, setEditingAlocCompleted] = useState<AlocacaoCompletedRow | null>(null);
  const silentRefreshInFlightRef = useRef(false);
  const activeCd = profile.cd_default ?? null;
  const canUseAuditoriasReport = isAdmin && isDesktop;

  function rememberSepConcludedAt(coddv: number, endSep: string, dtHr?: string | null): void {
    const rowKey = keyOfPvpsByValues(coddv, endSep);
    const parsed = dtHr ? new Date(dtHr).getTime() : Number.NaN;
    const safeTimestamp = Number.isNaN(parsed) ? new Date().toISOString() : (dtHr as string);
    setSepConcludedDayByKey((current) => {
      if (current[rowKey]) return current;
      return { ...current, [rowKey]: safeTimestamp };
    });
  }

  async function loadAdminData(): Promise<void> {
    if (!isAdmin) return;
    setAdminBusy(true);
    try {
      const [activeRows, historyRows] = await Promise.all([
        fetchAdminRulesActive("ambos", activeCd),
        fetchAdminRulesHistory({ p_cd: activeCd, modulo: "ambos", limit: ADMIN_HISTORY_VIEW_LIMIT, offset: 0 })
      ]);
      setActiveRuleRows(activeRows);
      setHistoryRuleRows(historyRows.slice(0, ADMIN_HISTORY_VIEW_LIMIT));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar dados administrativos.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function refreshPendingState(): Promise<void> {
    if (activeCd == null) {
      setPendingCount(0);
      setPendingErrors(0);
      return;
    }
    try {
      const [pending, errors] = await Promise.all([
        countPendingOfflineEvents(profile.user_id, activeCd),
        countErrorOfflineEvents(profile.user_id, activeCd)
      ]);
      setPendingCount(pending);
      setPendingErrors(errors);
    } catch {
      setPendingCount(0);
      setPendingErrors(0);
    }
  }

  async function hydratePulCacheForRows(rows: PvpsManifestRow[]): Promise<Record<string, PvpsPulItemRow[]>> {
    if (!isOnline || activeCd == null) return {};
    const missingRows = rows.filter((row) => {
      if (row.status !== "pendente_pul") return false;
      const cachedItems = getPulItemsByRowKey(feedPulBySepKey, row.coddv, row.end_sep);
      return !hasUsablePulCacheForRow(row, cachedItems);
    });
    if (!missingRows.length) return {};

    const updates: Record<string, PvpsPulItemRow[]> = {};
    let cursor = 0;
    const concurrency = Math.max(8, Math.min(24, Math.ceil(missingRows.length / 12)));

    const worker = async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= missingRows.length) return;

        const row = missingRows[index];
        try {
          const items = await fetchPvpsPulItems(row.coddv, row.end_sep, activeCd);
          if (hasUsablePulCacheForRow(row, items)) {
            updates[keyOfPvps(row)] = items;
          }
        } catch {
          // Keep row as "missing" to retry automatically.
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return updates;
  }

  async function downloadOfflineBase(): Promise<void> {
    if (activeCd == null) {
      throw new Error("CD ativo obrigatório para preparar base offline.");
    }
    setStatusMessage("Preparando base offline...");
    const [pvpsManifest, alocManifest] = await Promise.all([
      fetchPvpsManifest({ p_cd: activeCd, zona: null }),
      fetchAlocacaoManifest({ p_cd: activeCd, zona: null })
    ]);

    const previousSnapshot = await loadOfflineSnapshot(profile.user_id, activeCd).catch(() => null);
    const pulBySepKey: Record<string, PvpsPulItemRow[]> = {};
    const rowsToFetch: PvpsManifestRow[] = [];

    for (const row of pvpsManifest) {
      const rowKey = keyOfPvps(row);
      const cached = previousSnapshot
        ? getPulItemsByRowKey(previousSnapshot.pul_by_sep_key, row.coddv, row.end_sep)
        : [];
      if (Array.isArray(cached) && cached.length > 0) {
        pulBySepKey[rowKey] = cached;
      } else {
        rowsToFetch.push(row);
      }
    }

    if (rowsToFetch.length > 0) {
      const total = rowsToFetch.length;
      let done = 0;
      let cursor = 0;
      const concurrency = Math.max(6, Math.min(20, Math.ceil(total / 20)));

      const worker = async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= total) return;
          const row = rowsToFetch[index];
          const rowKey = keyOfPvps(row);
          try {
            pulBySepKey[rowKey] = await fetchPvpsPulItems(row.coddv, row.end_sep, activeCd);
          } catch {
            pulBySepKey[rowKey] = [];
          } finally {
            done += 1;
            if (done === total || done % 25 === 0) {
              setStatusMessage(`Baixando base offline... ${done}/${total} endereços de Pulmão.`);
            }
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    }

    await saveOfflineSnapshot({
      user_id: profile.user_id,
      cd: activeCd,
      pvps_rows: pvpsManifest,
      aloc_rows: alocManifest,
      pul_by_sep_key: pulBySepKey
    });
    setManifestReady(true);
  }

  async function runPendingSync(options?: { manual?: boolean }): Promise<void> {
    if (busySync || activeCd == null) return;
    if (!isOnline) {
      if (options?.manual) {
        setErrorMessage("Sem internet para sincronizar agora.");
      }
      return;
    }

    setBusySync(true);
    try {
      const result = await syncPvpsOfflineQueue({
        user_id: profile.user_id,
        cd: activeCd
      });
      await refreshPendingState();

      if (result.discarded > 0) {
        setOfflineDiscardedInSession((current) => current + result.discarded);
      }

      if (result.synced > 0 || result.discarded > 0) {
        await loadCurrent({ silent: true });
      }

      if (options?.manual || result.synced > 0 || result.failed > 0 || result.discarded > 0) {
        if (result.discarded > 0) {
          setStatusMessage(`${formatCountLabel(result.discarded, "endereço já concluído por outro usuário e descartado", "endereços já concluídos por outro usuário e descartados")}.`);
        } else if (result.failed > 0 && result.remaining > 0) {
          setStatusMessage(`Sincronização parcial: ${formatCountLabel(result.failed, "evento", "eventos")} com erro para nova tentativa.`);
        } else if (result.synced > 0) {
          setStatusMessage(`Sincronização concluída: ${formatCountLabel(result.synced, "evento enviado", "eventos enviados")}.`);
        } else {
          setStatusMessage("Sem pendências para sincronizar.");
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha na sincronização offline.");
    } finally {
      setBusySync(false);
    }
  }

  async function loadCurrent(options?: { silent?: boolean }): Promise<void> {
    const silent = options?.silent === true;
    if (!silent) {
      setBusy(true);
      setErrorMessage(null);
    }
    try {
      if (!isOnline) {
        if (!preferOfflineMode) {
          throw new Error("Sem internet no momento. Ative 'Trabalhar offline' para usar a base local.");
        }
        if (activeCd == null) {
          throw new Error("CD ativo obrigatório para uso offline.");
        }
        const snapshot = await loadOfflineSnapshot(profile.user_id, activeCd);
        if (!snapshot) {
          setManifestReady(false);
          throw new Error("Base offline ainda não foi baixada. Conecte-se e clique em 'Trabalhar offline'.");
        }

        const pendingEvents = await listPendingOfflineEvents(profile.user_id, activeCd);
        const localData = applyPendingEventsToOfflineData({
          pvpsRows: snapshot.pvps_rows,
          alocRows: snapshot.aloc_rows,
          pulBySepKey: snapshot.pul_by_sep_key,
          events: pendingEvents
        });
        setManifestReady(true);
        setFeedPulBySepKey(localData.pulBySepKey);
        setPvpsRows(localData.pvpsRows);
        setAlocRows(localData.alocRows);
        setPvpsCompletedRows([]);
        setAlocCompletedRows([]);
        if (!showPvpsPopup && !localData.pvpsRows.some((row) => keyOfPvps(row) === activePvpsKey)) {
          setActivePvpsKey(localData.pvpsRows[0] ? keyOfPvps(localData.pvpsRows[0]) : null);
          if (!localData.pvpsRows[0]) closePvpsPopup();
        }
        if (!localData.alocRows.some((row) => row.queue_id === activeAlocQueue)) {
          setActiveAlocQueue(localData.alocRows[0]?.queue_id ?? null);
          if (!localData.alocRows[0]) {
            setShowAlocPopup(false);
          }
        }
        return;
      }

      if (tab === "pvps") {
        const [rows, completed] = await Promise.all([
          fetchPvpsManifest({ p_cd: activeCd, zona: null }),
          fetchPvpsCompletedItemsDayAll({ p_cd: activeCd, p_ref_date_brt: todayBrt })
        ]);
        setLastPendingReviewAt((current) => ({ ...current, pvps: new Date().toISOString() }));
        if (!silent && feedView === "pendentes") {
          const updates = await hydratePulCacheForRows(rows);
          if (Object.keys(updates).length > 0) {
            setFeedPulBySepKey((current) => ({ ...current, ...updates }));
          }
        }
        setPvpsRows(rows);
        setPvpsCompletedRows(completed);
        setSepConcludedDayByKey((current) => {
          const next = { ...current };
          for (const item of completed) {
            if (item.status !== "pendente_pul") continue;
            const rowKey = keyOfPvpsByValues(item.coddv, item.end_sep);
            if (!next[rowKey]) next[rowKey] = item.dt_hr;
          }
          return next;
        });
        if (!showPvpsPopup && !rows.some((row) => keyOfPvps(row) === activePvpsKey)) {
          setActivePvpsKey(rows[0] ? keyOfPvps(rows[0]) : null);
          if (!rows[0]) closePvpsPopup();
        }
      } else {
        const [rows, completed] = await Promise.all([
          fetchAlocacaoManifest({ p_cd: activeCd, zona: null }),
          fetchAlocacaoCompletedItemsDayAll({ p_cd: activeCd, p_ref_date_brt: todayBrt })
        ]);
        setLastPendingReviewAt((current) => ({ ...current, alocacao: new Date().toISOString() }));
        setAlocRows(rows);
        setAlocCompletedRows(completed);
        if (!rows.some((row) => row.queue_id === activeAlocQueue)) {
          setActiveAlocQueue(rows[0]?.queue_id ?? null);
          if (!rows[0]) {
            setShowAlocPopup(false);
          }
        }
      }
    } catch (error) {
      if (!silent) {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar dados.");
      }
    } finally {
      if (!silent) {
        setBusy(false);
      }
    }
  }

  function resolveReportFilters(): PvpsAuditoriasReportFilters | null {
    if (!reportDtIni || !reportDtFim) {
      setReportError("Informe data inicial e final.");
      return null;
    }

    const dtIni = new Date(reportDtIni);
    const dtFim = new Date(reportDtFim);
    if (Number.isNaN(dtIni.getTime()) || Number.isNaN(dtFim.getTime())) {
      setReportError("Período inválido.");
      return null;
    }
    if (dtFim < dtIni) {
      setReportError("A data final não pode ser menor que a data inicial.");
      return null;
    }

    if (reportCdMode === "active_cd" && activeCd == null) {
      setReportError("CD ativo não definido para gerar o relatório.");
      return null;
    }

    return {
      dtIni: reportDtIni,
      dtFim: reportDtFim,
      cd: reportCdMode === "all_cds" ? null : activeCd,
      modulo: reportModulo
    };
  }

  async function runAuditoriasReportSearch(): Promise<void> {
    if (!canUseAuditoriasReport) return;
    setReportError(null);
    setReportMessage(null);
    setReportCount(null);

    const filters = resolveReportFilters();
    if (!filters) return;

    setReportBusySearch(true);
    try {
      const count = await countVwAuditoriasReportRows(filters);
      setReportCount(count);
      if (count > 0) {
        setReportMessage(`Foram encontradas ${count} auditorias em ${moduloLabel(reportModulo)} no período.`);
      } else {
        setReportMessage("Nenhuma auditoria encontrada no período informado.");
      }
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Falha ao consultar relatório.");
    } finally {
      setReportBusySearch(false);
    }
  }

  async function runAuditoriasReportExport(): Promise<void> {
    if (!canUseAuditoriasReport) return;
    setReportError(null);
    setReportMessage(null);

    const filters = resolveReportFilters();
    if (!filters) return;

    setReportBusyExport(true);
    try {
      const rows = await fetchVwAuditoriasReportRows(filters);
      if (rows.length === 0) {
        setReportCount(0);
        setReportMessage("Nenhuma auditoria disponível para exportação.");
        return;
      }

      const preferredKeys = [
        "dt_hr",
        "cd",
        "modulo",
        "coddv",
        "descricao",
        "zona",
        "endereco",
        "auditor_mat",
        "auditor_nome",
        "aud_sit",
        "status",
        "end_sit",
        "val_sep",
        "val_pul",
        "val_conf",
        "val_sist"
      ];
      const keySet = new Set<string>();
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          keySet.add(key);
        }
      }
      const orderedKeys = [
        ...preferredKeys.filter((key) => keySet.has(key)),
        ...Array.from(keySet).filter((key) => !preferredKeys.includes(key)).sort((a, b) => a.localeCompare(b))
      ];

      const XLSX = await import("xlsx");
      const suffix = filters.cd == null ? "todos-cds" : `cd-${filters.cd}`;
      const periodSuffix = `${filters.dtIni}-a-${filters.dtFim}`;
      const buildExportRows = (sourceRows: PvpsAuditoriasReportRow[]) => sourceRows.map((row) => {
        const output: Record<string, string | number | boolean> = {};
        for (const key of orderedKeys) {
          output[reportColumnLabel(key)] = reportCellToExcelValue(key, row[key] ?? null);
        }
        return output;
      });
      const writeWorkbook = (sourceRows: PvpsAuditoriasReportRow[], modulo: "pvps" | "alocacao") => {
        const exportRows = buildExportRows(sourceRows);
        if (exportRows.length === 0) return 0;
        let worksheet;
        if (modulo === "pvps") {
          throw new Error("PVPS_EXPORT_REQUIRES_ASYNC");
        } else if (modulo === "alocacao") {
          const headers = [
            "CD",
            "MODULO",
            "CODDV",
            "DESCRICAO",
            "ZONA",
            "ENDERECO",
            "NIVEL",
            "END_SITUACAO",
            "VAL_SISTEMA",
            "VAL_CONF",
            "SIT_AUD",
            "AUDITOR_NOM",
            "AUDITOR_MAT",
            "DATA",
            "HORA"
          ];
          const rowsAoA = sourceRows.map((row) => {
            const dtHr = String(row.dt_hr ?? "");
            const data = dtHr ? formatDate(dtHr) : "";
            const hora = dtHr ? formatTime(dtHr) : "";
            const valColeta = reportValue(
              row,
              "val_auditada",
              "val_conf",
              "val_coleta",
              "validade_coleta",
              "validade_informada",
              "val_informada"
            );
            return [
              reportValue(row, "cd"),
              reportValue(row, "modulo").toUpperCase(),
              reportValue(row, "coddv"),
              reportValue(row, "descricao"),
              reportValue(row, "zona"),
              reportValue(row, "endereco"),
              reportValue(row, "nivel"),
              reportValue(row, "end_sit"),
              reportValue(row, "val_sist", "val_sistema"),
              valColeta,
              reportValue(row, "aud_sit", "sit_aud"),
              reportValue(row, "auditor_nome", "auditor_nom"),
              reportValue(row, "auditor_mat", "autoritor_mat", "autitor_mat"),
              data,
              hora
            ];
          });
          worksheet = XLSX.utils.aoa_to_sheet([headers, ...rowsAoA]);
          worksheet["!cols"] = headers.map((header, columnIndex) => {
            let maxLen = header.length;
            for (let index = 0; index < Math.min(rowsAoA.length, 300); index += 1) {
              const length = String(rowsAoA[index][columnIndex] ?? "").length;
              if (length > maxLen) maxLen = length;
            }
            return { wch: Math.max(10, Math.min(maxLen + 2, 62)) };
          });
        } else {
          worksheet = XLSX.utils.json_to_sheet(exportRows);
          worksheet["!cols"] = orderedKeys.map((key) => {
            const header = reportColumnLabel(key);
            let maxLen = header.length;
            for (let index = 0; index < Math.min(exportRows.length, 300); index += 1) {
              const value = exportRows[index][header];
              const length = String(value ?? "").length;
              if (length > maxLen) maxLen = length;
            }
            return { wch: Math.max(10, Math.min(maxLen + 2, 62)) };
          });
        }
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Auditorias");
        const fileName = `relatorio-${modulo}-${periodSuffix}-${suffix}.xlsx`;
        XLSX.writeFile(workbook, fileName, { compression: true });
        return exportRows.length;
      };

      const writePvpsWorkbook = async (sourceRows: PvpsAuditoriasReportRow[]) => {
        if (sourceRows.length === 0) return 0;
        const auditIds = sourceRows
          .map((row) => reportValue(row, "audit_id"))
          .filter((auditId) => auditId.length > 0);
        const pulItems = await fetchPvpsReportPulItems(auditIds);
        const pulByAuditId = new Map<string, Array<{ end_pul: string; val_pul: string | null; end_sit: string | null }>>();
        for (const item of pulItems) {
          const current = pulByAuditId.get(item.audit_id) ?? [];
          current.push({
            end_pul: item.end_pul,
            val_pul: item.val_pul,
            end_sit: item.end_sit
          });
          pulByAuditId.set(item.audit_id, current);
        }
        const headers = [
          "CD",
          "MODULO",
          "CODDV",
          "DESCRICAO",
          "ZONA",
          "ENDERECO_SEP",
          "ENDERECO_PUL",
          "END_SITUACAO",
          "VAL_CONF_SEP",
          "VAL_CONF_PUL",
          "SIT_AUD",
          "AUDITOR_NOM",
          "AUDITOR_MAT",
          "DATA",
          "HORA"
        ];
        const rowsAoA: string[][] = [];
        for (const row of sourceRows) {
          const auditId = reportValue(row, "audit_id");
          const dtHr = reportValue(row, "dt_hr");
          const data = dtHr ? formatDate(dtHr) : "";
          const hora = dtHr ? formatTime(dtHr) : "";
          const endSep = reportValue(row, "end_sep", "endereco_sep", "endereco");
          const sepSituacao = reportValue(row, "end_sit", "end_situacao");
          const valSep = reportValue(row, "val_sep", "val_conf_sep", "val_auditada");
          const valSepRank = validadeRank(valSep);
          const pulList = [...(pulByAuditId.get(auditId) ?? [])].sort((a, b) => a.end_pul.localeCompare(b.end_pul));
          if (pulList.length === 0) {
            const sitAud =
              sepSituacao === "vazio" || sepSituacao === "obstruido"
                ? "ocorrencia"
                : "pendente_pul";
            rowsAoA.push([
              reportValue(row, "cd"),
              reportValue(row, "modulo").toUpperCase(),
              reportValue(row, "coddv"),
              reportValue(row, "descricao"),
              reportValue(row, "zona"),
              endSep,
              "",
              sepSituacao,
              valSep,
              "",
              sitAud,
              reportValue(row, "auditor_nome", "auditor_nom"),
              reportValue(row, "auditor_mat"),
              data,
              hora
            ]);
            continue;
          }
          for (const pulItem of pulList) {
            const pulSituacao = pulItem.end_sit ?? null;
            const pulRank = validadeRank(pulItem.val_pul ?? "");
            const sitAud =
              pulSituacao === "vazio" || pulSituacao === "obstruido" || sepSituacao === "vazio" || sepSituacao === "obstruido"
                ? "ocorrencia"
                : (valSepRank != null && pulRank != null && pulRank < valSepRank ? "nao_conforme" : "conforme");
            rowsAoA.push([
              reportValue(row, "cd"),
              reportValue(row, "modulo").toUpperCase(),
              reportValue(row, "coddv"),
              reportValue(row, "descricao"),
              reportValue(row, "zona"),
              endSep,
              pulItem.end_pul,
              pulItem.end_sit ?? sepSituacao,
              valSep,
              pulItem.val_pul ?? "",
              sitAud,
              reportValue(row, "auditor_nome", "auditor_nom"),
              reportValue(row, "auditor_mat"),
              data,
              hora
            ]);
          }
        }
        const worksheetPvps = XLSX.utils.aoa_to_sheet([headers, ...rowsAoA]);
        worksheetPvps["!cols"] = headers.map((header, columnIndex) => {
          let maxLen = header.length;
          for (let index = 0; index < Math.min(rowsAoA.length, 300); index += 1) {
            const length = String(rowsAoA[index][columnIndex] ?? "").length;
            if (length > maxLen) maxLen = length;
          }
          return { wch: Math.max(10, Math.min(maxLen + 2, 62)) };
        });
        const workbookPvps = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbookPvps, worksheetPvps, "Auditorias");
        const fileName = `relatorio-pvps-${periodSuffix}-${suffix}.xlsx`;
        XLSX.writeFile(workbookPvps, fileName, { compression: true });
        return rowsAoA.length;
      };

      let exportedCount = 0;
      if (filters.modulo === "ambos") {
        const pvpsRowsOnly = rows.filter((row) => String(row.modulo ?? "").toLowerCase() === "pvps");
        const alocRowsOnly = rows.filter((row) => String(row.modulo ?? "").toLowerCase() === "alocacao");
        const exportedPvps = await writePvpsWorkbook(pvpsRowsOnly);
        const exportedAloc = writeWorkbook(alocRowsOnly, "alocacao");
        exportedCount = exportedPvps + exportedAloc;
        setReportCount(exportedCount);
        setReportMessage(
          `Relatórios gerados com sucesso. PVPS: ${exportedPvps} linhas | Alocação: ${exportedAloc} linhas.`
        );
        return;
      }

      exportedCount = filters.modulo === "pvps"
        ? await writePvpsWorkbook(rows)
        : writeWorkbook(rows, filters.modulo);
      setReportCount(exportedCount);
      setReportMessage(`Relatório gerado com sucesso (${exportedCount} linhas).`);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Falha ao gerar relatório Excel.");
    } finally {
      setReportBusyExport(false);
    }
  }

  async function handleToggleOfflineMode(): Promise<void> {
    const nextMode = !preferOfflineMode;
    if (activeCd == null) {
      setErrorMessage("CD ativo obrigatório para modo offline.");
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    if (!nextMode) {
      setPreferOfflineMode(false);
      setStatusMessage("Modo offline desativado.");
      return;
    }

    if (!isOnline) {
      const hasSnapshot = await hasOfflineSnapshot(profile.user_id, activeCd);
      if (!hasSnapshot) {
        setManifestReady(false);
        setErrorMessage("Sem internet e sem base local. Conecte-se e clique em 'Trabalhar offline' para baixar a base.");
        return;
      }
      setPreferOfflineMode(true);
      setManifestReady(true);
      setStatusMessage("Offline ativo usando base local já baixada.");
      return;
    }

    setBusyOfflineBase(true);
    try {
      await downloadOfflineBase();
      setPreferOfflineMode(true);
      setStatusMessage("Offline ativo. Base local de PVPS e Alocação foi baixada neste dispositivo.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao baixar base offline.");
    } finally {
      setBusyOfflineBase(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const loadPreferences = async () => {
      setPreferencesReady(false);
      if (activeCd == null) {
        setPreferOfflineMode(false);
        setManifestReady(false);
        setPreferencesReady(true);
        setPendingCount(0);
        setPendingErrors(0);
        return;
      }
      try {
        const [prefs, snapshotReady] = await Promise.all([
          getPvpsAlocPrefs(profile.user_id),
          hasOfflineSnapshot(profile.user_id, activeCd)
        ]);
        if (cancelled) return;
        setPreferOfflineMode(Boolean(prefs.prefer_offline_mode));
        setManifestReady(snapshotReady);
      } catch {
        if (cancelled) return;
        setPreferOfflineMode(false);
        setManifestReady(false);
      } finally {
        if (!cancelled) {
          setPreferencesReady(true);
          void refreshPendingState();
        }
      }
    };
    void loadPreferences();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.user_id, activeCd]);

  useEffect(() => {
    if (!preferencesReady) return;
    void savePvpsAlocPrefs(profile.user_id, {
      prefer_offline_mode: preferOfflineMode
    }).catch(() => {
      // Preferência local é best effort.
    });
  }, [preferencesReady, profile.user_id, preferOfflineMode]);

  useEffect(() => {
    if (!preferencesReady) return;
    void loadCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeCd, todayBrt, isOnline, preferOfflineMode, preferencesReady]);

  useEffect(() => {
    setFeedPulBySepKey({});
    setPvpsPopupRow(null);
    setActivePvpsMode("sep");
    setActivePulEnd(null);
    setPvpsCompletedPulByAuditId({});
    setPvpsCompletedPulLoading({});
    setSepConcludedDayByKey({});
  }, [activeCd]);

  useEffect(() => {
    setSepConcludedDayByKey({});
  }, [todayBrt]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, activeCd]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 980px)");
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(media.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (canUseAuditoriasReport) return;
    if (!showAuditoriasReportModal) return;
    setShowAuditoriasReportModal(false);
  }, [canUseAuditoriasReport, showAuditoriasReportModal]);

  useEffect(() => {
    if (!showAuditoriasReportModal) return;
    setReportDtIni(brtMonthStartKey());
    setReportDtFim(todayBrt);
    setReportCdMode("active_cd");
    setReportModulo("ambos");
    setReportCount(null);
    setReportMessage(null);
    setReportError(null);
  }, [showAuditoriasReportModal, todayBrt]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const next = brtDayKey();
      setTodayBrt((current) => (current === next ? current : next));
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    const refreshSilently = () => {
      if (document.visibilityState !== "visible") return;
      if (showPvpsPopup || showAlocPopup) return;
      if (silentRefreshInFlightRef.current) return;
      silentRefreshInFlightRef.current = true;
      void loadCurrent({ silent: true }).finally(() => {
        silentRefreshInFlightRef.current = false;
      });
    };
    const interval = window.setInterval(() => {
      refreshSilently();
    }, 30000);
    const onFocus = () => { refreshSilently(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshSilently();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, tab, activeCd, todayBrt, feedView, showPvpsPopup, showAlocPopup, preferOfflineMode]);

  useEffect(() => {
    void refreshPendingState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCd]);

  useEffect(() => {
    if (!isOnline || activeCd == null || busySync || pendingCount <= 0) return;
    let cancelled = false;
    const runAutoSync = async () => {
      await runPendingSync({ manual: false });
      if (cancelled) return;
    };
    void runAutoSync();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, activeCd, pendingCount]);

  useEffect(() => {
    const currentPvps = editorPvpsRow;
    if (!currentPvps) {
      setPulItems([]);
      setPulInputs({});
      setPulEndSits({});
      setShowSepOccurrence(false);
      setShowPulOccurrence(false);
      setPulBusy(false);
      return;
    }

    setEndSit(currentPvps.end_sit ?? "");
    setValSep(currentPvps.val_sep?.replace("/", "") ?? "");
    setShowSepOccurrence(false);

    if (activeCd != null && (currentPvps.val_sep || currentPvps.end_sit)) {
      void upsertOfflineSepCache({
        user_id: profile.user_id,
        cd: activeCd,
        coddv: currentPvps.coddv,
        end_sep: currentPvps.end_sep,
        end_sit: currentPvps.end_sit ?? null,
        val_sep: normalizeMmaa(currentPvps.val_sep)
      }).catch(() => {
        // Cache offline é best-effort; não deve interromper o fluxo principal.
      });
    }

    if (currentPvps.status === "pendente_sep") {
      setPulItems([]);
      setPulInputs({});
      setPulEndSits({});
      setPulBusy(false);
      return;
    }

    const activeKey = keyOfPvps(currentPvps);
    const applyPulState = (items: PvpsPulItemRow[]) => {
      setPulItems(items);
      const mapped: Record<string, string> = {};
      const mappedEndSit: Record<string, PvpsEndSit | ""> = {};
      for (const item of items) {
        mapped[item.end_pul] = item.val_pul?.replace("/", "") ?? "";
        mappedEndSit[item.end_pul] = item.end_sit ?? "";
      }
      setPulInputs(mapped);
      setPulEndSits(mappedEndSit);
    };
    const cachedItems = feedPulBySepKey[activeKey] ?? [];
    if (hasUsablePulCacheForRow(currentPvps, cachedItems)) {
      applyPulState(cachedItems);
      setPulBusy(false);
      return;
    }

    if (!isOnline && preferOfflineMode) {
      applyPulState(cachedItems);
      setPulBusy(false);
      return;
    }

    if (activeCd == null) {
      setPulBusy(false);
      return;
    }

    let cancelled = false;
    setPulBusy(true);
    void fetchPvpsPulItems(currentPvps.coddv, currentPvps.end_sep, activeCd)
      .then((items) => {
        if (cancelled) return;
        if (hasUsablePulCacheForRow(currentPvps, items)) {
          setFeedPulBySepKey((current) => ({ ...current, [activeKey]: items }));
        }
        applyPulState(items);
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar Pulmão.");
      })
      .finally(() => {
        if (!cancelled) setPulBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editorPvpsRow, activeCd, isOnline, preferOfflineMode, profile.user_id, feedPulBySepKey]);

  useEffect(() => {
    if (activePvpsMode !== "pul") return;
    if (!pulItems.length) return;
    if (activePulEnd && pulItems.some((item) => item.end_pul === activePulEnd)) return;
    const next = pulItems.find((item) => !item.auditado) ?? pulItems[0];
    setActivePulEnd(next?.end_pul ?? null);
    setShowPulOccurrence(false);
  }, [activePvpsMode, pulItems, activePulEnd]);

  useEffect(() => {
    setShowAlocOccurrence(false);
    setAlocEndSit("");
    setAlocValConf("");
  }, [activeAlocQueue]);

  const zoneFilterSet = useMemo(() => new Set(selectedZones), [selectedZones]);
  const effectivePendingAddressSortDirection = selectedZones.length > 0 ? pendingAddressSortDirection : "asc";

  const sortedPvpsAllRows = useMemo(
    () => [...pvpsRows].sort((a, b) => {
      if (a.is_window_active !== b.is_window_active) return a.is_window_active ? -1 : 1;
      const byPriority = a.priority_score - b.priority_score;
      if (byPriority !== 0) return byPriority;
      const byDate = dateSortValue(b.dat_ult_compra) - dateSortValue(a.dat_ult_compra);
      if (byDate !== 0) return byDate;
      const byZone = a.zona.localeCompare(b.zona);
      if (byZone !== 0) return byZone;
      const byEndereco = compareEndereco(a.end_sep, b.end_sep);
      if (byEndereco !== 0) return byEndereco;
      const byCoddv = a.coddv - b.coddv;
      return byCoddv;
    }),
    [pvpsRows]
  );

  const sortedAlocAllRows = useMemo(
    () => [...alocRows].sort((a, b) => {
      if (a.is_window_active !== b.is_window_active) return a.is_window_active ? -1 : 1;
      const byPriority = a.priority_score - b.priority_score;
      if (byPriority !== 0) return byPriority;
      const byDate = dateSortValue(b.dat_ult_compra) - dateSortValue(a.dat_ult_compra);
      if (byDate !== 0) return byDate;
      const byCoddv = a.coddv - b.coddv;
      if (byCoddv !== 0) return byCoddv;
      const byZone = a.zona.localeCompare(b.zona);
      if (byZone !== 0) return byZone;
      return compareEndereco(a.endereco, b.endereco);
    }),
    [alocRows]
  );

  const pvpsFeedItemsAll = useMemo<PvpsFeedItem[]>(() => {
    const items: PvpsFeedItem[] = [];
    const seen = new Set<string>();
    for (const row of sortedPvpsAllRows) {
      const baseKey = keyOfPvps(row);
      if (row.status === "pendente_sep") {
        const feedKey = `sep:${baseKey}`;
        if (seen.has(feedKey)) continue;
        seen.add(feedKey);
        items.push({
          kind: "sep",
          feedKey,
          row,
          zone: row.zona,
          endereco: row.end_sep
        });
        continue;
      }
      const pulItemsByRow = getPulItemsByRowKey(feedPulBySepKey, row.coddv, row.end_sep);
      if (!pulItemsByRow.length) {
        // Preserve visibility when PUL cache is not available yet.
        const feedKey = `sep:${baseKey}`;
        if (seen.has(feedKey)) continue;
        seen.add(feedKey);
        items.push({
          kind: "sep",
          feedKey,
          row,
          zone: row.zona,
          endereco: row.end_sep
        });
        continue;
      }
      const pendingPulItems = pulItemsByRow.filter((item) => !item.auditado);
      if (!pendingPulItems.length) {
        const feedKey = `sep:${baseKey}`;
        if (seen.has(feedKey)) continue;
        seen.add(feedKey);
        items.push({
          kind: "sep",
          feedKey,
          row,
          zone: row.zona,
          endereco: row.end_sep
        });
        continue;
      }
      for (const item of pendingPulItems) {
        const feedKey = `pul:${baseKey}:${item.end_pul}`;
        if (seen.has(feedKey)) continue;
        seen.add(feedKey);
        items.push({
          kind: "pul",
          feedKey,
          row,
          zone: zoneFromEndereco(item.end_pul),
          endereco: item.end_pul,
          endPul: item.end_pul,
          nivel: item.nivel
        });
      }
    }
    return items;
  }, [sortedPvpsAllRows, feedPulBySepKey]);

  const pvpsQueueProducts = useMemo(() => {
    const byCoddv = new Map<number, { coddv: number; descricao: string; dat_ult_compra: string; maxTs: number; minPriority: number; is_window_active: boolean }>();
    for (const row of sortedPvpsAllRows) {
      const ts = dateSortValue(row.dat_ult_compra);
      const current = byCoddv.get(row.coddv);
      if (!current) {
        byCoddv.set(row.coddv, {
          coddv: row.coddv,
          descricao: row.descricao,
          dat_ult_compra: row.dat_ult_compra,
          maxTs: ts,
          minPriority: row.priority_score,
          is_window_active: row.is_window_active
        });
        continue;
      }
      const nextMaxTs = Math.max(current.maxTs, ts);
      const nextMinPriority = Math.min(current.minPriority, row.priority_score);
      byCoddv.set(row.coddv, {
        coddv: row.coddv,
        descricao: ts >= current.maxTs ? row.descricao : current.descricao,
        dat_ult_compra: ts >= current.maxTs ? row.dat_ult_compra : current.dat_ult_compra,
        maxTs: nextMaxTs,
        minPriority: nextMinPriority,
        is_window_active: current.is_window_active || row.is_window_active
      });
    }
    return Array.from(byCoddv.values()).sort((a, b) => {
      if (a.is_window_active !== b.is_window_active) return a.is_window_active ? -1 : 1;
      return (a.minPriority - b.minPriority) || (b.maxTs - a.maxTs) || (a.coddv - b.coddv);
    });
  }, [sortedPvpsAllRows]);

  const alocQueueProducts = useMemo(() => {
    const byCoddv = new Map<number, { coddv: number; descricao: string; dat_ult_compra: string; maxTs: number; minPriority: number; is_window_active: boolean }>();
    for (const row of sortedAlocAllRows) {
      const ts = dateSortValue(row.dat_ult_compra);
      const current = byCoddv.get(row.coddv);
      if (!current) {
        byCoddv.set(row.coddv, {
          coddv: row.coddv,
          descricao: row.descricao,
          dat_ult_compra: row.dat_ult_compra,
          maxTs: ts,
          minPriority: row.priority_score,
          is_window_active: row.is_window_active
        });
        continue;
      }
      const nextMaxTs = Math.max(current.maxTs, ts);
      const nextMinPriority = Math.min(current.minPriority, row.priority_score);
      byCoddv.set(row.coddv, {
        coddv: row.coddv,
        descricao: ts >= current.maxTs ? row.descricao : current.descricao,
        dat_ult_compra: ts >= current.maxTs ? row.dat_ult_compra : current.dat_ult_compra,
        maxTs: nextMaxTs,
        minPriority: nextMinPriority,
        is_window_active: current.is_window_active || row.is_window_active
      });
    }
    return Array.from(byCoddv.values()).sort((a, b) => {
      if (a.is_window_active !== b.is_window_active) return a.is_window_active ? -1 : 1;
      return (a.minPriority - b.minPriority) || (b.maxTs - a.maxTs) || (a.coddv - b.coddv);
    });
  }, [sortedAlocAllRows]);

  const pvpsFeedItems = useMemo<PvpsFeedItem[]>(() => {
    return pvpsFeedItemsAll
      .filter((item) => item.row.is_window_active)
      .filter((item) => !selectedZones.length || zoneFilterSet.has(item.zone))
      .sort((a, b) => {
        const byZone = a.zone.localeCompare(b.zone);
        if (byZone !== 0) return byZone;
        const byEndereco = compareEnderecoWithDirection(a.endereco, b.endereco, effectivePendingAddressSortDirection);
        if (byEndereco !== 0) return byEndereco;
        const byPriority = a.row.priority_score - b.row.priority_score;
        if (byPriority !== 0) return byPriority;
        const byDate = dateSortValue(b.row.dat_ult_compra) - dateSortValue(a.row.dat_ult_compra);
        if (byDate !== 0) return byDate;
        const byCoddv = a.row.coddv - b.row.coddv;
        if (byCoddv !== 0) return byCoddv;
        if (a.kind !== b.kind) return a.kind === "sep" ? -1 : 1;
        return a.feedKey.localeCompare(b.feedKey);
      });
  }, [pvpsFeedItemsAll, selectedZones, zoneFilterSet, effectivePendingAddressSortDirection]);

  const visibleAlocRows = useMemo(() => {
    const deduped = new Map<string, AlocacaoManifestRow>();
    for (const row of sortedAlocAllRows) {
      if (!deduped.has(row.queue_id)) deduped.set(row.queue_id, row);
    }
    return Array.from(deduped.values())
      .filter((row) => row.is_window_active)
      .filter((row) => !selectedZones.length || zoneFilterSet.has(row.zona))
      .sort((a, b) => {
        const byZone = a.zona.localeCompare(b.zona);
        if (byZone !== 0) return byZone;
        const byEndereco = compareEnderecoWithDirection(a.endereco, b.endereco, effectivePendingAddressSortDirection);
        if (byEndereco !== 0) return byEndereco;
        const byPriority = a.priority_score - b.priority_score;
        if (byPriority !== 0) return byPriority;
        const byDate = dateSortValue(b.dat_ult_compra) - dateSortValue(a.dat_ult_compra);
        if (byDate !== 0) return byDate;
        return a.coddv - b.coddv;
      });
  }, [sortedAlocAllRows, selectedZones, zoneFilterSet, effectivePendingAddressSortDirection]);

  const pvpsCompletedRowsForView = useMemo(() => {
    const byRowKey = new Set<string>();
    const rows = [...pvpsCompletedRows];
    for (const row of pvpsCompletedRows) {
      byRowKey.add(keyOfPvpsByValues(row.coddv, row.end_sep));
    }

    for (const row of pvpsRows) {
      if (row.status !== "pendente_pul") continue;
      const pendingPulCount = expectedPendingPulCount(row);
      if (pendingPulCount < 1) continue;
      const rowKey = keyOfPvps(row);
      if (byRowKey.has(rowKey)) continue;
      const sepDtHr = sepConcludedDayByKey[rowKey];
      if (!sepDtHr) continue;
      rows.push({
        audit_id: `sep-day:${rowKey}`,
        auditor_id: profile.user_id,
        cd: row.cd,
        zona: row.zona,
        coddv: row.coddv,
        descricao: row.descricao,
        end_sep: row.end_sep,
        status: "pendente_pul",
        end_sit: row.end_sit,
        val_sep: row.val_sep,
        pul_total: row.pul_total,
        pul_auditados: row.pul_auditados,
        pul_has_lower: false,
        pul_lower_end: null,
        pul_lower_val: null,
        dt_hr: sepDtHr,
        auditor_nome: profile.nome || "USUARIO"
      });
      byRowKey.add(rowKey);
    }

    return rows;
  }, [pvpsCompletedRows, pvpsRows, sepConcludedDayByKey, profile.user_id, profile.nome]);

  const zones = useMemo(() => {
    if (feedView === "pendentes") {
      if (tab === "pvps") {
        return Array.from(
          new Set(
            pvpsFeedItemsAll
              .filter((item) => item.row.is_window_active)
              .map((item) => item.zone)
          )
        ).sort((a, b) => a.localeCompare(b));
      }
      return Array.from(
        new Set(
          sortedAlocAllRows
            .filter((row) => row.is_window_active)
            .map((row) => row.zona)
        )
      ).sort((a, b) => a.localeCompare(b));
    }
    if (tab === "pvps") {
      return Array.from(new Set(pvpsCompletedRowsForView.map((row) => row.zona))).sort((a, b) => a.localeCompare(b));
    }
    return Array.from(new Set(alocCompletedRows.map((row) => row.zona))).sort((a, b) => a.localeCompare(b));
  }, [
    feedView,
    tab,
    pvpsFeedItemsAll,
    sortedAlocAllRows,
    pvpsCompletedRowsForView,
    alocCompletedRows
  ]);

  useEffect(() => {
    if (!selectedZones.length) return;
    const allowed = new Set(zones);
    setSelectedZones((previous) => {
      const next = previous.filter((zone) => allowed.has(zone));
      if (next.length === previous.length) return previous;
      return next;
    });
  }, [zones, selectedZones.length]);

  const filteredZones = useMemo(() => {
    const q = zoneSearch.trim().toLocaleLowerCase("pt-BR");
    if (!q) return zones;
    return zones.filter((zone) => zone.toLocaleLowerCase("pt-BR").includes(q));
  }, [zones, zoneSearch]);

  const filteredPvpsCompletedRows = useMemo(() => {
    if (!selectedZones.length) return pvpsCompletedRowsForView;
    return pvpsCompletedRowsForView.filter((row) => zoneFilterSet.has(row.zona));
  }, [pvpsCompletedRowsForView, selectedZones, zoneFilterSet]);

  const filteredAlocCompletedRows = useMemo(() => {
    if (!selectedZones.length) return alocCompletedRows;
    return alocCompletedRows.filter((row) => zoneFilterSet.has(row.zona));
  }, [alocCompletedRows, selectedZones, zoneFilterSet]);

  const filteredPvpsPendingRows = useMemo(() => {
    const activeRows = sortedPvpsAllRows.filter((row) => row.is_window_active);
    if (!selectedZones.length) return activeRows;
    return activeRows.filter((row) => zoneFilterSet.has(row.zona));
  }, [sortedPvpsAllRows, selectedZones, zoneFilterSet]);

  const filteredAlocPendingRows = useMemo(() => {
    const activeRows = sortedAlocAllRows.filter((row) => row.is_window_active);
    if (!selectedZones.length) return activeRows;
    return activeRows.filter((row) => zoneFilterSet.has(row.zona));
  }, [sortedAlocAllRows, selectedZones, zoneFilterSet]);

  const sortedPvpsCompletedRows = useMemo(
    () => [...filteredPvpsCompletedRows].sort((a, b) => {
      const byZone = a.zona.localeCompare(b.zona);
      if (byZone !== 0) return byZone;
      const byEndereco = compareEndereco(a.end_sep, b.end_sep);
      if (byEndereco !== 0) return byEndereco;
      return new Date(a.dt_hr).getTime() - new Date(b.dt_hr).getTime();
    }),
    [filteredPvpsCompletedRows]
  );

  const sortedAlocCompletedRows = useMemo(
    () => [...filteredAlocCompletedRows].sort((a, b) => {
      const byZone = a.zona.localeCompare(b.zona);
      if (byZone !== 0) return byZone;
      const byEndereco = compareEndereco(a.endereco, b.endereco);
      if (byEndereco !== 0) return byEndereco;
      return new Date(a.dt_hr).getTime() - new Date(b.dt_hr).getTime();
    }),
    [filteredAlocCompletedRows]
  );

  const zoneScopeKey = useMemo(
    () => selectedZones.slice().sort((a, b) => a.localeCompare(b)).join(","),
    [selectedZones]
  );
  const showPendingZoneSortToggle = feedView === "pendentes" && selectedZones.length > 0;

  function togglePendingAddressSortDirection(): void {
    setPendingAddressSortDirection((current) => (current === "asc" ? "desc" : "asc"));
  }

  function renderZoneHeader(scope: string, zone: string) {
    if (!showPendingZoneSortToggle) {
      return (
        <AnimatedFeedReveal className="pvps-zone-divider-reveal" cardKey={`${scope}:${zone}`}>
          <div className="pvps-zone-divider">Zona {zone}</div>
        </AnimatedFeedReveal>
      );
    }

    const nextDirectionLabel = pendingAddressSortDirection === "asc" ? "decrescente" : "crescente";
    return (
      <AnimatedFeedReveal className="pvps-zone-divider-reveal" cardKey={`${scope}:${zone}`}>
        <div className="pvps-zone-divider-row">
          <div className="pvps-zone-divider">Zona {zone}</div>
          <button
            className="btn btn-muted pvps-zone-sort-btn"
            type="button"
            onClick={togglePendingAddressSortDirection}
            title={`Ordenar endereços em ${nextDirectionLabel}`}
            aria-label={`Ordenar endereços em ${nextDirectionLabel}`}
          >
            {pendingSortIcon(pendingAddressSortDirection)}
          </button>
        </div>
      </AnimatedFeedReveal>
    );
  }

  useEffect(() => {
    const scopeKey = `${activeCd ?? "no-cd"}|${todayBrt}|${zoneScopeKey}`;
    const currentTotal = filteredPvpsPendingRows.length + sortedPvpsCompletedRows.length;
    setProgressBaselinePvps((prev) => {
      const nextTotal = Math.max(currentTotal, 0);
      if (prev.key !== scopeKey) return { key: scopeKey, total: nextTotal };
      if (isOnline) return { key: scopeKey, total: nextTotal };
      if (prev.total <= 0 && nextTotal > 0) return { key: scopeKey, total: nextTotal };
      return prev;
    });
  }, [activeCd, todayBrt, zoneScopeKey, filteredPvpsPendingRows.length, sortedPvpsCompletedRows.length, isOnline]);

  useEffect(() => {
    const scopeKey = `${activeCd ?? "no-cd"}|${todayBrt}|${zoneScopeKey}`;
    const currentTotal = filteredAlocPendingRows.length + sortedAlocCompletedRows.length;
    setProgressBaselineAloc((prev) => {
      const nextTotal = Math.max(currentTotal, 0);
      if (prev.key !== scopeKey) return { key: scopeKey, total: nextTotal };
      if (isOnline) return { key: scopeKey, total: nextTotal };
      if (prev.total <= 0 && nextTotal > 0) return { key: scopeKey, total: nextTotal };
      return prev;
    });
  }, [activeCd, todayBrt, zoneScopeKey, filteredAlocPendingRows.length, sortedAlocCompletedRows.length, isOnline]);

  const pvpsStats = useMemo(() => {
    const total = progressBaselinePvps.total;
    const completed = sortedPvpsCompletedRows.length;
    return {
      percent: completionPercent(completed, total),
      total,
      completed
    };
  }, [progressBaselinePvps.total, sortedPvpsCompletedRows.length]);

  const alocStats = useMemo(() => {
    const total = progressBaselineAloc.total;
    const completed = sortedAlocCompletedRows.length;
    return {
      percent: completionPercent(completed, total),
      total,
      completed
    };
  }, [progressBaselineAloc.total, sortedAlocCompletedRows.length]);

  useEffect(() => {
    if (tab !== "pvps" || feedView !== "pendentes" || activeCd == null || !isOnline) return;
    let cancelled = false;
    const loadMissing = async () => {
      const updates = await hydratePulCacheForRows(sortedPvpsAllRows);
      if (cancelled || !Object.keys(updates).length) return;
      setFeedPulBySepKey((current) => ({ ...current, ...updates }));
    };
    void loadMissing();
    return () => {
      cancelled = true;
    };
  }, [tab, feedView, sortedPvpsAllRows, activeCd, feedPulBySepKey, isOnline]);

  useEffect(() => {
    if (tab === "pvps") {
      if (showPvpsPopup) return;
      const visibleKeys = new Set(pvpsFeedItems.map((item) => keyOfPvps(item.row)));
      if (activePvpsKey && !visibleKeys.has(activePvpsKey)) {
        setActivePvpsKey(null);
        setActivePvpsMode("sep");
        setActivePulEnd(null);
      }
      return;
    }
    if (activeAlocQueue && !visibleAlocRows.some((row) => row.queue_id === activeAlocQueue)) {
      setActiveAlocQueue(null);
    }
  }, [tab, pvpsFeedItems, visibleAlocRows, activePvpsKey, activeAlocQueue, showPvpsPopup]);

  const nextQueueItems = useMemo(() => {
    if (tab === "pvps") {
      return pvpsQueueProducts
        .filter((item) => !item.is_window_active)
        .slice(0, FEED_NEXT_PREVIEW_LIMIT)
        .map((item) => ({
          key: `pvps-next:${item.coddv}`,
          coddv: item.coddv,
          descricao: item.descricao,
          dat_ult_compra: item.dat_ult_compra
        }));
    }
    return alocQueueProducts
      .filter((item) => !item.is_window_active)
      .slice(0, FEED_NEXT_PREVIEW_LIMIT)
      .map((item) => ({
        key: `aloc-next:${item.coddv}`,
        coddv: item.coddv,
        descricao: item.descricao,
        dat_ult_compra: item.dat_ult_compra
      }));
  }, [tab, pvpsQueueProducts, alocQueueProducts]);

  const pendingReviewLabel = useMemo(() => {
    const value = lastPendingReviewAt[tab];
    return value ? formatDateTime(value) : null;
  }, [lastPendingReviewAt, tab]);

  async function openPvpsPopup(row: PvpsManifestRow, options?: { motion?: "default" | "next" }): Promise<void> {
    setPulFeedback(null);
    setShowSepOccurrence(false);
    setShowPulOccurrence(false);
    if (row.status === "pendente_pul") {
      const rowKey = keyOfPvps(row);
      const cachedPulItems = getPulItemsByRowKey(feedPulBySepKey, row.coddv, row.end_sep);
      let pulItemsByRow: PvpsPulItemRow[] | null = hasUsablePulCacheForRow(row, cachedPulItems) ? cachedPulItems : null;
      if (!pulItemsByRow && isOnline && activeCd != null) {
        try {
          const fetchedItems = await fetchPvpsPulItems(row.coddv, row.end_sep, activeCd);
          pulItemsByRow = fetchedItems;
          if (hasUsablePulCacheForRow(row, fetchedItems)) {
            setFeedPulBySepKey((current) => ({ ...current, [rowKey]: fetchedItems }));
          }
        } catch {
          pulItemsByRow = null;
        }
      }
      const pendingPulItems = (pulItemsByRow ?? []).filter((item) => !item.auditado);
      const firstPendingPul = pendingPulItems[0];
      if (firstPendingPul) {
        openPvpsPulPopup(row, firstPendingPul.end_pul, options);
        return;
      }
    }
    setEditingPvpsCompleted(null);
    setPvpsPopupRow({ ...row });
    setActivePvpsMode("sep");
    setActivePulEnd(null);
    setActivePvpsKey(keyOfPvps(row));
    setShowPvpsPopup(true);
  }

  function openPvpsPulPopup(row: PvpsManifestRow, endPul: string, options?: { motion?: "default" | "next" }): void {
    setPulFeedback(null);
    setShowSepOccurrence(false);
    setShowPulOccurrence(false);
    setEditingPvpsCompleted(null);
    setPvpsPopupRow({ ...row });
    setActivePvpsMode("pul");
    setActivePulEnd(endPul);
    setActivePvpsKey(keyOfPvps(row));
    setShowPvpsPopup(true);
  }

  function openAlocPopup(row: AlocacaoManifestRow): void {
    setEditingAlocCompleted(null);
    setShowAlocOccurrence(false);
    setActiveAlocQueue(row.queue_id);
    setAlocEndSit("");
    setAlocValConf("");
    setAlocResult(null);
    setShowAlocPopup(true);
  }

  function closePvpsPopup(): void {
    setPulFeedback(null);
    setShowSepOccurrence(false);
    setShowPulOccurrence(false);
    setPvpsPopupRow(null);
    setActivePvpsMode("sep");
    setActivePulEnd(null);
    setShowPvpsPopup(false);
  }

  function canEditAudit(auditorId: string): boolean {
    return isAdmin || auditorId === profile.user_id;
  }

  function toggleExpandedPvps(key: string): void {
    setExpandedPvps((prev) => (prev[key] ? {} : { [key]: true }));
  }

  function toggleExpandedAloc(key: string): void {
    setExpandedAloc((prev) => (prev[key] ? {} : { [key]: true }));
  }

  async function loadPvpsCompletedPulItems(row: PvpsCompletedRow): Promise<void> {
    const key = row.audit_id;
    if (pvpsCompletedPulLoading[key] || pvpsCompletedPulByAuditId[key]) return;
    if (!isOnline) return;
    setPvpsCompletedPulLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const items = await fetchPvpsPulItems(row.coddv, row.end_sep, activeCd ?? row.cd);
      const onlyAudited = items.filter((item) => item.auditado);
      setPvpsCompletedPulByAuditId((prev) => ({ ...prev, [key]: onlyAudited }));
    } catch {
      setPvpsCompletedPulByAuditId((prev) => ({ ...prev, [key]: [] }));
    } finally {
      setPvpsCompletedPulLoading((prev) => ({ ...prev, [key]: false }));
    }
  }

  function toggleExpandedPvpsCompleted(row: PvpsCompletedRow): void {
    const key = row.audit_id;
    const willOpen = !expandedPvpsCompleted[key];
    setExpandedPvpsCompleted((prev) => (prev[key] ? {} : { [key]: true }));
    if (willOpen && row.pul_auditados > 0 && !pvpsCompletedPulByAuditId[key] && !pvpsCompletedPulLoading[key]) {
      void loadPvpsCompletedPulItems(row);
    }
  }

  function toggleExpandedAlocCompleted(key: string): void {
    setExpandedAlocCompleted((prev) => (prev[key] ? {} : { [key]: true }));
  }

  function openPvpsCompletedEdit(row: PvpsCompletedRow): void {
    if (!canEditAudit(row.auditor_id)) return;
    setShowSepOccurrence(false);
    setShowPulOccurrence(false);
    setEditingPvpsCompleted(row);
    setActivePvpsMode("sep");
    setActivePulEnd(null);
    const key = keyOfPvps(row);
    setPvpsRows((current) => {
      const existing = current.find((item) => keyOfPvps(item) === key);
      if (existing) {
        return current.map((item) => keyOfPvps(item) === key ? {
          ...item,
          audit_id: row.audit_id,
          end_sit: row.end_sit,
          val_sep: row.val_sep,
          status: row.status,
          pul_total: row.pul_total,
          pul_auditados: row.pul_auditados
        } : item);
      }
      return [{
        cd: row.cd,
        zona: row.zona,
        coddv: row.coddv,
        descricao: row.descricao,
        end_sep: row.end_sep,
        pul_total: row.pul_total,
        pul_auditados: row.pul_auditados,
        status: row.status,
        end_sit: row.end_sit,
        val_sep: row.val_sep,
        audit_id: row.audit_id,
        dat_ult_compra: "",
        qtd_est_disp: 0,
        priority_score: 9999,
        is_window_active: true
      }, ...current];
    });
    setPvpsPopupRow({
      cd: row.cd,
      zona: row.zona,
      coddv: row.coddv,
      descricao: row.descricao,
      end_sep: row.end_sep,
      pul_total: row.pul_total,
      pul_auditados: row.pul_auditados,
      status: row.status,
      end_sit: row.end_sit,
      val_sep: row.val_sep,
      audit_id: row.audit_id,
      dat_ult_compra: "",
      qtd_est_disp: 0,
      priority_score: 9999,
      is_window_active: true
    });
    setActivePvpsKey(key);
    setShowPvpsPopup(true);
  }

  function openAlocCompletedEdit(row: AlocacaoCompletedRow): void {
    if (!canEditAudit(row.auditor_id)) return;
    setShowAlocOccurrence(false);
    setEditingAlocCompleted(row);
    setAlocEndSit(row.end_sit ?? "");
    setAlocValConf(row.val_conf?.replace("/", "") ?? "");
    setAlocResult(null);
    setAlocRows((current) => {
      const existing = current.find((item) => item.queue_id === row.queue_id);
      if (existing) return current;
      return [{
        queue_id: row.queue_id,
        cd: row.cd,
        zona: row.zona,
        coddv: row.coddv,
        descricao: row.descricao,
        endereco: row.endereco,
        nivel: row.nivel,
        val_sist: row.val_sist,
        dat_ult_compra: "",
        qtd_est_disp: 0,
        priority_score: 9999,
        is_window_active: true
      }, ...current];
    });
    setActiveAlocQueue(row.queue_id);
    setShowAlocPopup(true);
  }

  function openNextPvpsFrom(currentFeedKey: string, currentZone?: string | null): void {
    const index = pvpsFeedItems.findIndex((item) => item.feedKey === currentFeedKey);
    const startAt = index >= 0 ? index + 1 : 0;
    const fallbackZone = index >= 0 ? pvpsFeedItems[index]?.zone ?? null : null;
    const targetZone = currentZone ?? fallbackZone;
    const candidates = pvpsFeedItems.filter((item) => item.feedKey !== currentFeedKey);
    let next: PvpsFeedItem | undefined;
    if (targetZone) {
      next = pvpsFeedItems.find((item, itemIndex) => itemIndex >= startAt && item.feedKey !== currentFeedKey && item.zone === targetZone);
    }
    if (!next) {
      next = pvpsFeedItems.find((item, itemIndex) => itemIndex >= startAt && item.feedKey !== currentFeedKey);
    }
    if (!next) {
      next = candidates[0];
    }
    if (!next) {
      closePvpsPopup();
      return;
    }
    if (next.kind === "pul") {
      openPvpsPulPopup(next.row, next.endPul);
      return;
    }
    void openPvpsPopup(next.row);
  }

  function openNextPvpsSepFrom(currentFeedKey: string): void {
    const sepItems = pvpsFeedItems.filter(
      (item): item is Extract<PvpsFeedItem, { kind: "sep" }> => item.kind === "sep" && item.row.status === "pendente_sep"
    );
    if (!sepItems.length) {
      closePvpsPopup();
      return;
    }
    const index = sepItems.findIndex((item) => item.feedKey === currentFeedKey);
    const next = index >= 0 ? sepItems[index + 1] : sepItems[0];
    if (!next) {
      closePvpsPopup();
      return;
    }
    void openPvpsPopup(next.row);
  }

  function openNextAlocacaoFrom(currentQueueId: string, currentZone?: string | null): void {
    const index = visibleAlocRows.findIndex((row) => row.queue_id === currentQueueId);
    const fallbackZone = index >= 0 ? visibleAlocRows[index]?.zona ?? null : null;
    const targetZone = currentZone ?? fallbackZone;
    const startAt = index >= 0 ? index + 1 : 0;
    let next: AlocacaoManifestRow | undefined;
    if (targetZone) {
      next = visibleAlocRows.find((row, rowIndex) => rowIndex >= startAt && row.queue_id !== currentQueueId && row.zona === targetZone);
    }
    if (!next) {
      next = visibleAlocRows.find((row, rowIndex) => rowIndex >= startAt && row.queue_id !== currentQueueId);
    }
    // Se chegou ao fim da lista, volta para o primeiro pendente disponível.
    if (!next) {
      next = visibleAlocRows.find((row) => row.queue_id !== currentQueueId);
    }
    if (next) {
      setEditingAlocCompleted(null);
      setShowAlocOccurrence(false);
      setAlocEndSit("");
      setAlocValConf("");
      setAlocResult(null);
      setActiveAlocQueue(next.queue_id);
      setShowAlocPopup(true);
    } else {
      setShowAlocPopup(false);
    }
  }

  async function handleSubmitSep(event: FormEvent): Promise<void> {
    event.preventDefault();
    const currentPvps = editorPvpsRow;
    if (!currentPvps) return;
    if (activeCd == null) {
      setErrorMessage("CD ativo obrigatório para auditoria PVPS.");
      return;
    }

    const hasOcorrencia = endSit === "vazio" || endSit === "obstruido";
    const normalizedValSep = valSep.trim();
    if (!hasOcorrencia && normalizedValSep.length !== 4) {
      setErrorMessage("Validade do Produto obrigatória (MMAA) quando não houver ocorrência.");
      return;
    }
    const currentKey = keyOfPvps(currentPvps);
    const currentFeedKey = `sep:${currentKey}`;
    const isEditingCompleted = Boolean(editingPvpsCompleted);
    const syncTail = shouldTriggerQueuedBackgroundSync(isOnline) ? "em segundo plano." : "ao reconectar.";

    if (!isEditingCompleted) {
      setBusy(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        await saveOfflineSepEvent({
          user_id: profile.user_id,
          cd: activeCd,
          coddv: currentPvps.coddv,
          end_sep: currentPvps.end_sep,
          end_sit: hasOcorrencia ? endSit : null,
          val_sep: hasOcorrencia ? null : normalizedValSep
        });
        await upsertOfflineSepCache({
          user_id: profile.user_id,
          cd: activeCd,
          coddv: currentPvps.coddv,
          end_sep: currentPvps.end_sep,
          end_sit: hasOcorrencia ? endSit : null,
          val_sep: hasOcorrencia ? null : normalizedValSep
        });
        await refreshPendingState();
        if (hasOcorrencia) {
          setPvpsRows((current) => current.filter((row) => keyOfPvps(row) !== currentKey));
          setStatusMessage(`Separação com ocorrência salva na fila. Item retirado localmente e será sincronizado ${syncTail}`);
        } else {
          const localVal = `${normalizedValSep.slice(0, 2)}/${normalizedValSep.slice(2)}`;
          rememberSepConcludedAt(currentPvps.coddv, currentPvps.end_sep);
          setPvpsRows((current) => current.map((row) => (
            keyOfPvps(row) === currentKey
              ? { ...row, status: "pendente_pul", val_sep: localVal, end_sit: null }
              : row
          )));
          setStatusMessage(`Separação salva na fila. Pulmão ficará pendente para auditoria separada e será sincronizado ${syncTail}`);
        }
        openNextPvpsSepFrom(currentFeedKey);
        if (shouldTriggerQueuedBackgroundSync(isOnline)) {
          void runPendingSync({ manual: false });
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar Separação na fila local.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!isOnline) {
      setErrorMessage("Edição de concluído requer conexão com o servidor.");
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await submitPvpsSep({
        p_cd: activeCd,
        coddv: currentPvps.coddv,
        end_sep: currentPvps.end_sep,
        end_sit: endSit || null,
        val_sep: hasOcorrencia ? null : normalizedValSep
      });
      const normalizedResultValSep = normalizeMmaa(result.val_sep ?? normalizedValSep);
      if (!(result.end_sit === "vazio" || result.end_sit === "obstruido")) {
        rememberSepConcludedAt(currentPvps.coddv, currentPvps.end_sep);
      }
      if (result.end_sit === "vazio" || result.end_sit === "obstruido") {
        setStatusMessage("Separação com ocorrência. Item removido do feed e não será enviado ao frontend.");
      } else {
        setStatusMessage(`Separação salva. Pulmão liberado e ficará pendente para auditoria separada (${result.pul_auditados}/${result.pul_total} auditados).`);
      }
      await upsertOfflineSepCache({
        user_id: profile.user_id,
        cd: activeCd,
        coddv: currentPvps.coddv,
        end_sep: currentPvps.end_sep,
        end_sit: result.end_sit,
        val_sep: normalizedResultValSep
      });
      await loadCurrent();
      setEditingPvpsCompleted(null);
      closePvpsPopup();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao salvar etapa de Separação.";
      setErrorMessage(message);
      if (isOnline && shouldRefreshAfterAlreadyAudited(message)) {
        await loadCurrent({ silent: true });
        setStatusMessage("Item já auditado por outro usuário. Lista atualizada; confira a aba de concluídos.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitPul(endPul: string): Promise<void> {
    const currentPvps = editorPvpsRow;
    if (!currentPvps) return;
    if (activeCd == null) {
      setErrorMessage("CD ativo obrigatório para auditoria PVPS.");
      return;
    }
    const pulEndSit = pulEndSits[endPul] ?? "";
    const hasPulOcorrencia = pulEndSit === "vazio" || pulEndSit === "obstruido";
    const value = pulInputs[endPul] ?? "";
    if (!hasPulOcorrencia && value.trim().length !== 4) {
      setErrorMessage("Validade do Produto obrigatória (MMAA).");
      return;
    }
    const currentKey = keyOfPvps(currentPvps);
    const currentFeedKey = `pul:${currentKey}:${endPul}`;
    const valPul = hasPulOcorrencia ? null : normalizeMmaaText(value);
    const isEditingCompleted = Boolean(editingPvpsCompleted);
    const syncTail = shouldTriggerQueuedBackgroundSync(isOnline) ? "em segundo plano." : "ao reconectar.";

    const applyLocalPulSave = (params?: {
      status?: PvpsManifestRow["status"];
      pul_total?: number;
      pul_auditados?: number;
    }): void => {
      setPulItems((current) => current.map((item) => (
        item.end_pul === endPul
          ? { ...item, auditado: true, end_sit: hasPulOcorrencia ? pulEndSit : null, val_pul: valPul }
          : item
      )));
      setFeedPulBySepKey((current) => {
        const source = current[currentKey] ?? pulItems;
        if (!source.length) return current;
        const nextItems = source.map((item) => (
          item.end_pul === endPul
            ? { ...item, auditado: true, end_sit: hasPulOcorrencia ? pulEndSit : null, val_pul: valPul }
            : item
        ));
        return { ...current, [currentKey]: nextItems };
      });
      setPvpsRows((current) => current.map((row) => {
        if (keyOfPvps(row) !== currentKey) return row;
        return {
          ...row,
          status: params?.status ?? row.status,
          pul_total: params?.pul_total ?? row.pul_total,
          pul_auditados: params?.pul_auditados ?? Math.min(row.pul_auditados + 1, Math.max(row.pul_total, row.pul_auditados + 1))
        };
      }));
      setPulInputs((prev) => ({ ...prev, [endPul]: "" }));
      setPulEndSits((prev) => ({ ...prev, [endPul]: "" }));
    };

    if (!isEditingCompleted) {
      let hasSep = await hasOfflineSepCache(profile.user_id, activeCd, currentPvps.coddv, currentPvps.end_sep);
      if (!hasSep && (currentPvps.val_sep || currentPvps.end_sit)) {
        await upsertOfflineSepCache({
          user_id: profile.user_id,
          cd: activeCd,
          coddv: currentPvps.coddv,
          end_sep: currentPvps.end_sep,
          end_sit: currentPvps.end_sit ?? null,
          val_sep: normalizeMmaa(currentPvps.val_sep)
        });
        hasSep = true;
      }
      if (!hasSep) {
        setErrorMessage("Para informar Pulmão offline, salve primeiro a linha de Separação no mesmo endereço.");
        return;
      }
      setBusy(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        await saveOfflinePulEvent({
          user_id: profile.user_id,
          cd: activeCd,
          coddv: currentPvps.coddv,
          end_sep: currentPvps.end_sep,
          end_pul: endPul,
          end_sit: hasPulOcorrencia ? pulEndSit : null,
          val_pul: hasPulOcorrencia ? null : value.trim(),
          audit_id: currentPvps.audit_id
        });
        await refreshPendingState();
        applyLocalPulSave();
        setPulFeedback(null);
        setStatusMessage(
          hasPulOcorrencia
            ? `Pulmão com ocorrência salvo na fila. Avançando e sincronizando ${syncTail}`
            : `Pulmão salvo na fila. Avançando e sincronizando ${syncTail}`
        );
        openNextPvpsFrom(currentFeedKey, zoneFromEndereco(endPul));
        if (shouldTriggerQueuedBackgroundSync(isOnline)) {
          void runPendingSync({ manual: false });
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar Pulmão na fila local.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!isOnline) {
      setErrorMessage("Edição de concluído requer conexão com o servidor.");
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      let auditId = currentPvps.audit_id;
      if (!auditId) {
        const rows = await fetchPvpsManifest({ p_cd: activeCd, zona: null });
        auditId = rows.find((row) => row.coddv === currentPvps.coddv && row.end_sep === currentPvps.end_sep)?.audit_id ?? null;
      }
      if (!auditId) {
        setErrorMessage("AUDIT_ID_PVPS_NAO_DISPONIVEL. Sincronize a Separação antes de salvar Pulmão online.");
        return;
      }
      const result = await submitPvpsPul({
        p_cd: activeCd,
        audit_id: auditId,
        end_pul: endPul,
        end_sit: hasPulOcorrencia ? pulEndSit : null,
        val_pul: hasPulOcorrencia ? null : value
      });
      applyLocalPulSave({
        status: result.status,
        pul_total: result.pul_total,
        pul_auditados: result.pul_auditados
      });
      let feedbackText = "";
      if (result.status === "concluido") {
        feedbackText = "PVPS concluído com conformidade. Avançando para o próximo.";
      } else if (result.status === "nao_conforme") {
        feedbackText = "PVPS concluído sem conformidade. Avançando para o próximo.";
      } else {
        feedbackText = hasPulOcorrencia
          ? `Pulmão com ocorrência salvo (${result.pul_auditados}/${result.pul_total}). Avançando para o próximo.`
          : `Pulmão salvo (${result.pul_auditados}/${result.pul_total}). Avançando para o próximo.`;
      }
      setPulFeedback(null);
      setStatusMessage(feedbackText);
      setEditingPvpsCompleted(null);
      closePvpsPopup();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao salvar etapa de Pulmão.";
      setErrorMessage(message);
      if (isOnline && shouldRefreshAfterAlreadyAudited(message)) {
        await loadCurrent({ silent: true });
        setStatusMessage("Item já auditado por outro usuário. Lista atualizada; confira a aba de concluídos.");
      }
    } finally {
      setBusy(false);
    }
  }

  function handlePulGoNext(): void {
    if (!pulFeedback) return;
    const currentFeedKey = pulFeedback.feedKey;
    setPulFeedback(null);
    openNextPvpsFrom(currentFeedKey);
    void loadCurrent({ silent: true });
  }

  async function handleSubmitAlocacao(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!activeAloc) return;
    const currentQueueId = activeAloc.queue_id;
    const currentZone = activeAloc.zona;
    const isEditingCompleted = Boolean(editingAlocCompleted);
    const hasOcorrencia = alocEndSit === "vazio" || alocEndSit === "obstruido";
    const normalizedValConf = alocValConf.trim();
    const syncTail = shouldTriggerQueuedBackgroundSync(isOnline) ? "em segundo plano." : "ao reconectar.";
    if (!hasOcorrencia && normalizedValConf.length !== 4) {
      setErrorMessage("Validade do Produto obrigatória (MMAA) quando não houver ocorrência.");
      return;
    }

    if (!isEditingCompleted) {
      setBusy(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        await saveOfflineAlocacaoEvent({
          user_id: profile.user_id,
          cd: activeCd ?? activeAloc.cd,
          queue_id: activeAloc.queue_id,
          coddv: activeAloc.coddv,
          zona: activeAloc.zona,
          end_sit: hasOcorrencia ? alocEndSit : null,
          val_conf: hasOcorrencia ? null : normalizedValConf
        });
        await refreshPendingState();
        setAlocRows((current) => current.filter((row) => row.queue_id !== currentQueueId));
        setStatusMessage(
          hasOcorrencia
            ? `Alocação com ocorrência salva na fila. Avançando e sincronizando ${syncTail}`
            : `Alocação salva na fila. Avançando e sincronizando ${syncTail}`
        );
        setAlocResult(null);
        setShowAlocOccurrence(false);
        setAlocEndSit("");
        setAlocValConf("");
        openNextAlocacaoFrom(currentQueueId, currentZone);
        if (shouldTriggerQueuedBackgroundSync(isOnline)) {
          void runPendingSync({ manual: false });
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar alocação na fila local.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!isOnline) {
      setErrorMessage("Edição de concluído requer conexão com o servidor.");
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = editingAlocCompleted
        ? await submitAlocacaoCompletedEdit({
          p_cd: activeCd,
          audit_id: editingAlocCompleted.audit_id,
          end_sit: alocEndSit || null,
          val_conf: hasOcorrencia ? null : normalizedValConf
        })
        : await submitAlocacao({
          p_cd: activeCd,
          queue_id: activeAloc.queue_id,
          end_sit: alocEndSit || null,
          val_conf: hasOcorrencia ? null : normalizedValConf
        });
      setAlocResult(result);
      let feedbackText = "";
      if (result.aud_sit === "conforme") {
        feedbackText = "Alocação auditada conforme. Avançando para o próximo.";
      } else if (result.aud_sit === "nao_conforme") {
        feedbackText = "Alocação auditada não conforme. Avançando para o próximo.";
      } else {
        feedbackText = "Alocação auditada com ocorrência. Avançando para o próximo.";
      }
      setStatusMessage(feedbackText);
      setEditingAlocCompleted(null);
      setShowAlocOccurrence(false);
      setAlocEndSit("");
      setAlocValConf("");
      if (isEditingCompleted) {
        await loadCurrent();
        setShowAlocPopup(false);
      } else {
        setAlocResult(null);
        setAlocRows((current) => current.filter((row) => row.queue_id !== currentQueueId));
        openNextAlocacaoFrom(currentQueueId, currentZone);
        void loadCurrent({ silent: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao salvar auditoria de alocação.";
      setErrorMessage(message);
      if (isOnline && shouldRefreshAfterAlreadyAudited(message)) {
        await loadCurrent({ silent: true });
        setStatusMessage("Item já auditado por outro usuário. Lista atualizada; confira a aba de concluídos.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function executeCreateAdminRule(draft: AdminRuleDraft, applyMode: PvpsRuleApplyMode): Promise<void> {
    const normalizedTarget = draft.target_type === "zona"
      ? draft.target_value.trim().toUpperCase()
      : draft.target_value.replace(/\D/g, "");
    if (!normalizedTarget) {
      setErrorMessage(draft.target_type === "zona" ? "Zona obrigatória para criar regra." : "SKU obrigatório para criar regra.");
      return;
    }
    const priorityValue = draft.rule_kind === "priority"
      ? Number.parseInt(draft.priority_value.replace(/\D/g, ""), 10)
      : null;
    if (draft.rule_kind === "priority" && (!Number.isFinite(priorityValue) || priorityValue == null || priorityValue <= 0)) {
      setErrorMessage("Prioridade obrigatória e deve ser maior que zero.");
      return;
    }

    setAdminBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const created = await createAdminRule({
        p_cd: activeCd,
        modulo: draft.modulo,
        rule_kind: draft.rule_kind,
        target_type: draft.target_type,
        target_value: normalizedTarget,
        priority_value: priorityValue,
        apply_mode: applyMode
      });
      setPendingRulePreview(null);
      await loadAdminData();
      await loadCurrent();
      const createdLabel = created.rule_kind === "blacklist" ? "Blacklist" : "Regra";
      const targetLabel = `${draft.target_type === "zona" ? "Zona" : "SKU"} ${normalizedTarget}`;
      const effectLabel = applyMode === "next_inclusions"
        ? "Somente próximas inclusões serão afetadas; pendentes atuais foram preservados."
        : (created.rule_kind === "blacklist"
          ? "Pendentes afetados foram removidos da fila imediatamente."
          : "Pendentes afetados foram reordenados imediatamente.");
      setStatusMessage(
        `${createdLabel} criada em ${targetLabel}. ` +
        `${effectLabel} Impacto: PVPS ${created.affected_pvps}, Alocação ${created.affected_alocacao}.`
      );
      setAdminDraft((current) => ({ ...current, target_value: "", priority_value: current.rule_kind === "priority" ? current.priority_value : "" }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao criar regra administrativa.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleAdminPreviewCreate(): Promise<void> {
    const normalizedTarget = adminDraft.target_type === "zona"
      ? adminDraft.target_value.trim().toUpperCase()
      : adminDraft.target_value.replace(/\D/g, "");
    if (!normalizedTarget) {
      setErrorMessage(adminDraft.target_type === "zona" ? "Zona obrigatória para criar regra." : "SKU obrigatório para criar regra.");
      return;
    }
    const priorityValue = adminDraft.rule_kind === "priority"
      ? Number.parseInt(adminDraft.priority_value.replace(/\D/g, ""), 10)
      : null;
    if (adminDraft.rule_kind === "priority" && (!Number.isFinite(priorityValue) || priorityValue == null || priorityValue <= 0)) {
      setErrorMessage("Prioridade obrigatória e deve ser maior que zero.");
      return;
    }

    setAdminBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const preview = await previewAdminRuleImpact({
        p_cd: activeCd,
        modulo: adminDraft.modulo,
        rule_kind: adminDraft.rule_kind,
        target_type: adminDraft.target_type,
        target_value: normalizedTarget,
        priority_value: priorityValue
      });
      if (preview.affected_total > 0) {
        setPendingRulePreview({
          draft: {
            ...adminDraft,
            target_value: normalizedTarget,
            priority_value: priorityValue == null ? adminDraft.priority_value : String(priorityValue)
          },
          affected_pvps: preview.affected_pvps,
          affected_alocacao: preview.affected_alocacao,
          affected_total: preview.affected_total
        });
        setAdminApplyMode("apply_now");
      } else {
        await executeCreateAdminRule({
          ...adminDraft,
          target_value: normalizedTarget,
          priority_value: priorityValue == null ? adminDraft.priority_value : String(priorityValue)
        }, "apply_now");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao calcular impacto da regra.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleConfirmCreateRuleFromPreview(): Promise<void> {
    if (!pendingRulePreview) return;
    await executeCreateAdminRule(pendingRulePreview.draft, adminApplyMode);
  }

  async function handleRemoveRule(ruleId: string): Promise<void> {
    setAdminBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const removed = await removeAdminRule({ p_cd: activeCd, rule_id: ruleId });
      if (!removed) {
        setStatusMessage("Regra já estava inativa.");
      } else {
        setStatusMessage("Regra removida. O fluxo normal volta a valer para novas inclusões.");
      }
      await loadAdminData();
      await loadCurrent();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao remover regra.");
    } finally {
      setAdminBusy(false);
    }
  }

  function toggleZone(zone: string): void {
    setSelectedZones((previous) => (
      previous.includes(zone) ? previous.filter((z) => z !== zone) : [...previous, zone]
    ));
  }

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
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>{isOnline ? "🟢 Online" : "🔴 Offline"}</span>
          </div>
        </div>
        <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
          <span className="module-icon" aria-hidden="true">
            <ModuleIcon name={MODULE_DEF.icon} />
          </span>
          <span className="module-title">Auditoria de PVPS e Alocação</span>
        </div>
      </header>

      <section className="modules-shell">
        <article className="module-screen surface-enter pvps-module-shell">
          <div className="module-screen-header">
            <div className="module-screen-title-row">
              <div className="module-screen-title">
                <h2>Olá, {displayUserName}</h2>
              </div>
              <button type="button" className="btn btn-muted pvps-toolbar-btn" onClick={() => void loadCurrent()} disabled={busy} aria-label="Atualizar dados">
                <span className="pvps-btn-icon" aria-hidden="true">{refreshIcon()}</span>
                <span>{busy ? "Atualizando..." : "Atualizar"}</span>
              </button>
            </div>

            <div className="pvps-toolbar-group">
              <small className="pvps-toolbar-label">Offline</small>
              <div className="pvps-actions">
                <button
                  type="button"
                  className="btn btn-muted termo-sync-btn"
                  onClick={() => void runPendingSync({ manual: true })}
                  disabled={!isOnline || busySync}
                >
                  <span aria-hidden="true">{refreshIcon()}</span>
                  {busySync ? "Sincronizando..." : "Sincronizar agora"}
                </button>
                <button
                  type="button"
                  className={`btn btn-muted termo-offline-toggle${preferOfflineMode ? " is-active" : ""}`}
                  onClick={() => void handleToggleOfflineMode()}
                  disabled={busyOfflineBase}
                >
                  {busyOfflineBase ? "Baixando base..." : preferOfflineMode ? "📦 Offline ativo" : "📶 Trabalhar offline"}
                </button>
              </div>
            </div>

            <div className="pvps-toolbar">
              <div className="pvps-toolbar-group">
                <small className="pvps-toolbar-label">Ações</small>
                <nav className="pvps-actions" aria-label="Módulo de auditoria">
                  <button
                    type="button"
                    className={`btn btn-muted pvps-toolbar-btn${tab === "pvps" ? " is-active" : ""}`}
                    onClick={() => { setTab("pvps"); try { window.localStorage.setItem("pvps-alocacao:tab", "pvps"); } catch { /**/ } }}
                    disabled={busy}
                    aria-pressed={tab === "pvps"}
                  >
                    <span className="pvps-btn-icon" aria-hidden="true">{playIcon()}</span>
                    <span>Iniciar PVPS</span>
                  </button>
                  <button
                    type="button"
                    className={`btn btn-muted pvps-toolbar-btn${tab === "alocacao" ? " is-active" : ""}`}
                    onClick={() => { setTab("alocacao"); try { window.localStorage.setItem("pvps-alocacao:tab", "alocacao"); } catch { /**/ } }}
                    disabled={busy}
                    aria-pressed={tab === "alocacao"}
                  >
                    <span className="pvps-btn-icon" aria-hidden="true">{playIcon()}</span>
                    <span>Iniciar Alocação</span>
                  </button>
                </nav>
              </div>
            </div>

            <div className="pvps-toolbar-group">
              <small className="pvps-toolbar-label">Visualização</small>
              <nav className="pvps-tabs" aria-label="Visualização">
                <button
                  type="button"
                  className={`btn btn-muted pvps-toolbar-btn${feedView === "pendentes" ? " is-active" : ""}`}
                  onClick={() => setFeedView("pendentes")}
                  aria-pressed={feedView === "pendentes"}
                >
                  <span className="pvps-btn-icon" aria-hidden="true">{listIcon()}</span>
                  <span>Pendentes</span>
                </button>
                <button
                  type="button"
                  className={`btn btn-muted pvps-toolbar-btn${feedView === "concluidos" ? " is-active" : ""}`}
                  onClick={() => setFeedView("concluidos")}
                  aria-pressed={feedView === "concluidos"}
                >
                  <span className="pvps-btn-icon" aria-hidden="true">{doneIcon()}</span>
                  <span>Concluídos do dia</span>
                </button>
              </nav>
            </div>

            {isAdmin ? (
              <div className="pvps-tabs">
                <button
                  type="button"
                  className={`btn btn-muted pvps-toolbar-btn${showAdminPanel ? " is-active" : ""}`}
                  onClick={() => setShowAdminPanel((prev) => !prev)}
                >
                  {showAdminPanel ? "Ocultar Gestão" : "Admin: Gestão de Regras"}
                </button>
                {canUseAuditoriasReport ? (
                  <button
                    type="button"
                    className={`btn btn-muted pvps-toolbar-btn${showAuditoriasReportModal ? " is-active" : ""}`}
                    onClick={() => setShowAuditoriasReportModal(true)}
                  >
                    <span className="pvps-btn-icon" aria-hidden="true">{reportIcon()}</span>
                    <span>Relatório Excel</span>
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="pvps-toolbar-group pvps-filter-row">
              <small className="pvps-toolbar-label">Filtro</small>
              <button
                className={`btn btn-muted pvps-toolbar-btn${selectedZones.length > 0 || showZoneFilterPopup ? " is-active" : ""}`}
                type="button"
                onClick={() => setShowZoneFilterPopup(true)}
              >
                <span className="pvps-btn-icon" aria-hidden="true">{filterIcon()}</span>
                <span>Filtrar zonas {selectedZones.length > 0 ? `(${selectedZones.length})` : "(todas)"}</span>
              </button>
            </div>

            {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
            {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
            {preferOfflineMode && !manifestReady ? (
              <div className="alert error">Modo offline ativo sem base local. Conecte-se para baixar a base.</div>
            ) : null}
            {offlineDiscardedInSession > 0 ? (
              <div className="alert success">
                Descartes por conflito nesta sessão: {offlineDiscardedInSession}.
              </div>
            ) : null}
            {isAdmin && showAdminPanel ? (
              <div className="pvps-admin-panel">
                <h3>Gestão de Regras</h3>
                <div className="pvps-admin-grid">
                  <label>
                    Módulo
                    <select
                      value={adminDraft.modulo}
                      onChange={(event) => setAdminDraft((current) => ({ ...current, modulo: event.target.value as PvpsModulo }))}
                    >
                      <option value="ambos">Ambos</option>
                      <option value="pvps">PVPS</option>
                      <option value="alocacao">Alocação</option>
                    </select>
                  </label>
                  <label>
                    Tipo da regra
                    <select
                      value={adminDraft.rule_kind}
                      onChange={(event) => setAdminDraft((current) => ({ ...current, rule_kind: event.target.value as PvpsRuleKind }))}
                    >
                      <option value="blacklist">Blacklist</option>
                      <option value="priority">Prioridade</option>
                    </select>
                  </label>
                  <label>
                    Alvo
                    <select
                      value={adminDraft.target_type}
                      onChange={(event) => setAdminDraft((current) => ({ ...current, target_type: event.target.value as PvpsRuleTargetType }))}
                    >
                      <option value="zona">Zona</option>
                      <option value="coddv">SKU</option>
                    </select>
                  </label>
                  <label>
                    {adminDraft.target_type === "zona" ? "Zona" : "SKU"}
                    <input
                      value={adminDraft.target_value}
                      onChange={(event) => setAdminDraft((current) => ({
                        ...current,
                        target_value: current.target_type === "zona"
                          ? event.target.value.toUpperCase()
                          : event.target.value.replace(/\D/g, "")
                      }))}
                      placeholder={adminDraft.target_type === "zona" ? "Ex.: PG01" : "SKU"}
                    />
                  </label>
                  {adminDraft.rule_kind === "priority" ? (
                    <label>
                      Prioridade
                      <input
                        value={adminDraft.priority_value}
                        onChange={(event) => setAdminDraft((current) => ({ ...current, priority_value: event.target.value.replace(/\D/g, "") }))}
                        placeholder="1 = mais alta"
                      />
                    </label>
                  ) : null}
                </div>
                <div className="pvps-actions">
                  <button className="btn btn-primary" type="button" disabled={adminBusy} onClick={() => void handleAdminPreviewCreate()}>
                    {adminBusy ? "Processando..." : "Criar regra"}
                  </button>
                </div>
                <div className="pvps-tabs">
                  <button
                    type="button"
                    className={`btn btn-muted pvps-toolbar-btn${adminRulesView === "active" ? " is-active" : ""}`}
                    onClick={() => setAdminRulesView("active")}
                  >
                    Regras ativas ({activeRuleRows.length})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-muted pvps-toolbar-btn${adminRulesView === "history" ? " is-active" : ""}`}
                    onClick={() => setAdminRulesView("history")}
                  >
                    Histórico ({historyRuleRows.length})
                  </button>
                </div>
                {adminRulesView === "active" ? (
                  <div className="pvps-admin-lists">
                    <div>
                      <h4>Ativas</h4>
                      {activeRuleRows.length === 0 ? <p>Nenhuma regra ativa.</p> : null}
                      {activeRuleRows.map((row) => (
                        <div key={row.rule_id} className="pvps-admin-row">
                          <div className="pvps-admin-row-body">
                            <strong className="pvps-admin-row-title">
                              {ruleKindLabel(row.rule_kind)} | {ruleTargetLabel(row.target_type, row.target_value)}
                              {row.rule_kind === "priority" ? ` | nível ${row.priority_value ?? 9999}` : ""}
                            </strong>
                            <small className="pvps-admin-row-meta">
                              {moduloLabel(row.modulo)} | {row.created_by_mat ?? "-"} - {row.created_by_nome ?? "-"} | {formatDateTime(row.created_at)}
                            </small>
                          </div>
                          <button className="btn btn-muted" type="button" disabled={adminBusy} onClick={() => void handleRemoveRule(row.rule_id)}>
                            Remover
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="pvps-admin-lists">
                    <div>
                      <h4>Solicitações (últimos 20)</h4>
                      {historyRuleRows.length === 0 ? <p>Sem histórico.</p> : null}
                      {historyRuleRows.map((row) => (
                        <div key={row.history_id} className="pvps-admin-row">
                          <div className="pvps-admin-row-body">
                            <strong className="pvps-admin-row-title">
                              {historyActionLabel(row.action_type)} | {ruleKindLabel(row.rule_kind)} | {ruleTargetLabel(row.target_type, row.target_value)}
                              {row.rule_kind === "priority" ? ` | nível ${row.priority_value ?? 9999}` : ""}
                            </strong>
                            <small className="pvps-admin-row-meta">
                              {moduloLabel(row.modulo)}
                              {applyModeLabel(row.apply_mode) ? ` | ${applyModeLabel(row.apply_mode)}` : ""}
                              {" | "}
                              {row.actor_user_mat ?? "-"} - {row.actor_user_nome ?? "-"} | {formatDateTime(row.created_at)}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="module-screen-body pvps-module-body">
            {feedView === "pendentes" && tab === "pvps" ? (
              <div className="pvps-list">
                {pvpsFeedItems.length === 0
                  ? (sortedPvpsAllRows.length === 0
                    ? <p>Nenhum item PVPS pendente para os filtros atuais.</p>
                    : <p>Carregando endereços de Pulmão pendentes...</p>)
                  : null}
                {pvpsFeedItems.map((item, index) => {
                  const itemKey = item.feedKey;
                  const open = Boolean(expandedPvps[itemKey]);
                  const previous = index > 0 ? pvpsFeedItems[index - 1] : null;
                  const showZoneHeader = !previous || previous.zone !== item.zone;
                  const row = item.row;
                  const feedAndar = item.kind === "pul" ? resolveFeedAndar(item.nivel) : null;
                  return (
                    <div key={itemKey} className="pvps-zone-group">
                      {showZoneHeader ? renderZoneHeader(`pending-pvps-${feedView}-${tab}`, item.zone) : null}
                      <AnimatedFeedReveal className={`pvps-row${open ? " is-open" : ""}`} cardKey={itemKey}>
                        <div className="pvps-row-head">
                          <div className="pvps-row-main">
                            <strong className="pvps-row-address-line">
                              <span className="pvps-row-address-text">{item.endereco}</span>
                              {feedAndar ? (
                                <span className="pvps-row-floor-indicator" title={`Andar ${feedAndar}`}>
                                  {floorLevelIcon()}
                                  {feedAndar}
                                </span>
                              ) : null}
                            </strong>
                            <span>{row.coddv} - {row.descricao}</span>
                            {item.kind === "pul" ? <small>Pulmão pendente</small> : null}
                          </div>
                          <div className="pvps-row-actions">
                            <button
                              className="btn btn-primary pvps-icon-btn"
                              type="button"
                              onClick={() => {
                                if (item.kind === "pul") {
                                  openPvpsPulPopup(row, item.endPul);
                                } else {
                                  void openPvpsPopup(row);
                                }
                              }}
                              title="Editar"
                            >
                              {editIcon()}
                            </button>
                            <button className="btn btn-muted pvps-icon-btn" type="button" onClick={() => toggleExpandedPvps(itemKey)} title="Expandir">
                              {chevronIcon(open)}
                            </button>
                          </div>
                        </div>
                        {open ? (
                          <div className="pvps-row-details">
                            {item.kind === "pul" ? (
                              <>
                                <small>Endereço separação: {row.end_sep}</small>
                                <small>Validade separação: {row.val_sep ?? "-"}</small>
                              </>
                            ) : (
                              <small>Status {pvpsStatusLabel(row.status)} | Pulmão {row.pul_auditados}/{row.pul_total}</small>
                            )}
                            {item.kind === "pul" ? (
                              row.end_sit ? <small>Ocorrência linha: {formatOcorrenciaLabel(row.end_sit)}</small> : null
                            ) : null}
                            <small>Última compra: {formatDate(row.dat_ult_compra)}</small>
                          </div>
                        ) : null}
                      </AnimatedFeedReveal>
                    </div>
                  );
                })}
                <div className="pvps-recent-box">
                  <h4>Próximos a entrar na lista</h4>
                  {nextQueueItems.length === 0 ? <p>Não há próximos itens para a fila atual.</p> : nextQueueItems.map((item) => (
                    <div key={item.key} className="pvps-recent-row">
                      <span>{item.coddv} - {item.descricao}</span>
                      <small>Última compra: {formatDate(item.dat_ult_compra)}</small>
                    </div>
                  ))}
                </div>
                <div className="pvps-review-box">
                  <small>{pendingReviewLabel ? `Revisão da fila: ${pendingReviewLabel}` : "Revisão da fila ainda não disponível."}</small>
                </div>
              </div>
            ) : null}

            {feedView === "pendentes" && tab === "alocacao" ? (
              <div className="pvps-list">
                {visibleAlocRows.length === 0 ? <p>Nenhum item de Alocação pendente para os filtros atuais.</p> : null}
                {visibleAlocRows.map((row, index) => {
                  const open = Boolean(expandedAloc[row.queue_id]);
                  const previous = index > 0 ? visibleAlocRows[index - 1] : null;
                  const showZoneHeader = !previous || previous.zona !== row.zona;
                  const feedAndar = resolveFeedAndar(row.nivel);
                  return (
                    <div key={row.queue_id} className="pvps-zone-group">
                      {showZoneHeader ? renderZoneHeader(`pending-alocacao-${feedView}-${tab}`, row.zona) : null}
                      <AnimatedFeedReveal className={`pvps-row${open ? " is-open" : ""}`} cardKey={row.queue_id}>
                        <div className="pvps-row-head">
                          <div className="pvps-row-main">
                            <strong className="pvps-row-address-line">
                              <span className="pvps-row-address-text">{row.endereco}</span>
                              {feedAndar ? (
                                <span className="pvps-row-floor-indicator" title={`Andar ${feedAndar}`}>
                                  {floorLevelIcon()}
                                  {feedAndar}
                                </span>
                              ) : null}
                            </strong>
                            <span>{row.coddv} - {row.descricao}</span>
                          </div>
                          <div className="pvps-row-actions">
                            <button className="btn btn-primary pvps-icon-btn" type="button" onClick={() => openAlocPopup(row)} title="Editar">
                              {editIcon()}
                            </button>
                            <button className="btn btn-muted pvps-icon-btn" type="button" onClick={() => toggleExpandedAloc(row.queue_id)} title="Expandir">
                              {chevronIcon(open)}
                            </button>
                          </div>
                        </div>
                        {open ? (
                          <div className="pvps-row-details">
                            <small>Andar {formatAndar(row.nivel)}</small>
                            <small>Validade sistema: {row.val_sist}</small>
                            <small>Última compra: {formatDate(row.dat_ult_compra)}</small>
                          </div>
                        ) : null}
                      </AnimatedFeedReveal>
                    </div>
                  );
                })}
                <div className="pvps-recent-box">
                  <h4>Próximos a entrar na lista</h4>
                  {nextQueueItems.length === 0 ? <p>Não há próximos itens para a fila atual.</p> : nextQueueItems.map((item) => (
                    <div key={item.key} className="pvps-recent-row">
                      <span>{item.coddv} - {item.descricao}</span>
                      <small>Última compra: {formatDate(item.dat_ult_compra)}</small>
                    </div>
                  ))}
                </div>
                <div className="pvps-review-box">
                  <small>{pendingReviewLabel ? `Revisão da fila: ${pendingReviewLabel}` : "Revisão da fila ainda não disponível."}</small>
                </div>
              </div>
            ) : null}

            {feedView === "concluidos" && tab === "pvps" ? (
              <div className="pvps-list">
                <div className="pvps-progress-card" role="status" aria-live="polite">
                  <div className="pvps-progress-head">
                    <strong>Concluído PVPS</strong>
                    <span>{formatPercent(pvpsStats.percent)}</span>
                  </div>
                  <div className="pvps-progress-track" aria-hidden="true">
                    <span
                      className="pvps-progress-fill"
                      style={{ width: `${Math.max(0, Math.min(pvpsStats.percent, 100))}%` }}
                    />
                  </div>
                  <small>
                    {pvpsStats.completed} {pvpsStats.completed === 1 ? "SKU conferido" : "SKUs conferidos"} de {pvpsStats.total} {pvpsStats.total === 1 ? "SKU" : "SKUs"} na base {isOnline ? "online atual" : "local atual"}.
                  </small>
                </div>
                {sortedPvpsCompletedRows.length === 0 ? <p>Sem itens concluídos hoje para o CD ativo.</p> : null}
                {sortedPvpsCompletedRows.map((row, index) => {
                  const open = Boolean(expandedPvpsCompleted[row.audit_id]);
                  const previous = index > 0 ? sortedPvpsCompletedRows[index - 1] : null;
                  const showZoneHeader = !previous || previous.zona !== row.zona;
                  const isSyntheticSepPending = row.audit_id.startsWith("sep-day:");
                  const canEdit = !isSyntheticSepPending && canEditAudit(row.auditor_id);
                  const statusInfo = pvpsHistoryStatus(row);
                  const pulItemsCompleted = pvpsCompletedPulByAuditId[row.audit_id] ?? [];
                  const pulItemsLoading = Boolean(pvpsCompletedPulLoading[row.audit_id]);
                  return (
                    <div key={row.audit_id} className="pvps-zone-group">
                      {showZoneHeader ? (
                        <AnimatedFeedReveal className="pvps-zone-divider-reveal" cardKey={`completed-pvps-zone:${row.zona}`}>
                          <div className="pvps-zone-divider">Zona {row.zona}</div>
                        </AnimatedFeedReveal>
                      ) : null}
                      <AnimatedFeedReveal className={`pvps-row${open ? " is-open" : ""}`} cardKey={row.audit_id}>
                        <div className="pvps-row-head">
                          <div className="pvps-row-main">
                            <strong>{row.end_sep}</strong>
                            <span>{row.coddv} - {row.descricao}</span>
                            <span className={`pvps-history-status ${statusInfo.tone}`}>
                              {statusInfo.emoticon} {statusInfo.label}
                            </span>
                          </div>
                          <div className="pvps-row-actions">
                            <button className="btn btn-primary pvps-icon-btn" type="button" onClick={() => openPvpsCompletedEdit(row)} disabled={!canEdit} title="Editar concluído">
                              {doneIcon()}
                            </button>
                            <button className="btn btn-muted pvps-icon-btn" type="button" onClick={() => toggleExpandedPvpsCompleted(row)} title="Expandir">
                              {chevronIcon(open)}
                            </button>
                          </div>
                        </div>
                        {open ? (
                          <div className="pvps-row-details">
                            <div className="pvps-completed-section">
                              <div className="pvps-completed-section-head">
                                <strong>Separação</strong>
                              </div>
                              <div className="pvps-completed-meta-grid">
                                <small><span>Endereço</span><strong>{row.end_sep}</strong></small>
                                <small><span>Validade informada</span><strong>{row.val_sep ?? "-"}</strong></small>
                                <small><span>Auditor</span><strong>{row.auditor_nome}</strong></small>
                                <small><span>Data</span><strong>{formatDateTime(row.dt_hr)}</strong></small>
                                <small><span>Status</span><strong>{statusInfo.label}</strong></small>
                              </div>
                            </div>
                            {row.pul_auditados > 0 ? (
                              <div className="pvps-completed-section pvps-pul-completed-group">
                                <div className="pvps-completed-section-head">
                                  <strong>Pulmões auditados</strong>
                                  <span>{row.pul_auditados}/{row.pul_total}</span>
                                </div>
                                {pulItemsLoading ? <small>Carregando endereços de Pulmão...</small> : null}
                                {!pulItemsLoading ? (
                                  <div className="pvps-pul-completed-list">
                                    {[...pulItemsCompleted].sort((a, b) => a.end_pul.localeCompare(b.end_pul)).map((item) => (
                                      <div
                                        key={`${row.audit_id}:${item.end_pul}`}
                                        className={`pvps-pul-completed-item${item.is_lower || row.pul_lower_end === item.end_pul ? " is-lower" : ""}`}
                                      >
                                        <div className="pvps-pul-completed-item-head">
                                          <strong>{item.end_pul}</strong>
                                          {item.is_lower || row.pul_lower_end === item.end_pul ? (
                                            <span className="pvps-pul-lower-badge">Nao conforme</span>
                                          ) : null}
                                          <span>{formatDateTime(item.dt_hr ?? row.dt_hr)}</span>
                                        </div>
                                        <div className="pvps-pul-completed-item-meta">
                                          <small>Validade: <strong>{item.val_pul ?? "-"}</strong></small>
                                          {item.end_sit ? <small>Ocorrência: <strong>{formatOcorrenciaLabel(item.end_sit)}</strong></small> : null}
                                          <small>Auditor: <strong>{item.auditor_nome ?? row.auditor_nome}</strong></small>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            {row.pul_has_lower ? (
                              <small className="pvps-completed-note">
                                Pulmão com validade menor: {row.pul_lower_end ?? "-"} ({row.pul_lower_val ?? "-"})
                              </small>
                            ) : null}
                            <small className="pvps-completed-note">{isSyntheticSepPending ? "Separação concluída no dia com Pulmão pendente." : `Concluído em: ${formatDateTime(row.dt_hr)}`}</small>
                          </div>
                        ) : null}
                      </AnimatedFeedReveal>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {feedView === "concluidos" && tab === "alocacao" ? (
              <div className="pvps-list">
                <div className="pvps-progress-card" role="status" aria-live="polite">
                  <div className="pvps-progress-head">
                    <strong>Concluído Alocação</strong>
                    <span>{formatPercent(alocStats.percent)}</span>
                  </div>
                  <div className="pvps-progress-track" aria-hidden="true">
                    <span
                      className="pvps-progress-fill"
                      style={{ width: `${Math.max(0, Math.min(alocStats.percent, 100))}%` }}
                    />
                  </div>
                  <small>
                    {alocStats.completed} {alocStats.completed === 1 ? "SKU conferido" : "SKUs conferidos"} de {alocStats.total} {alocStats.total === 1 ? "SKU" : "SKUs"} na base {isOnline ? "online atual" : "local atual"}.
                  </small>
                </div>
                {sortedAlocCompletedRows.length === 0 ? <p>Sem itens concluídos hoje para o CD ativo.</p> : null}
                {sortedAlocCompletedRows.map((row, index) => {
                  const open = Boolean(expandedAlocCompleted[row.audit_id]);
                  const previous = index > 0 ? sortedAlocCompletedRows[index - 1] : null;
                  const showZoneHeader = !previous || previous.zona !== row.zona;
                  const canEdit = canEditAudit(row.auditor_id);
                  const statusInfo = alocHistoryStatus(row);
                  return (
                    <div key={row.audit_id} className="pvps-zone-group">
                      {showZoneHeader ? (
                        <AnimatedFeedReveal className="pvps-zone-divider-reveal" cardKey={`completed-aloc-zone:${row.zona}`}>
                          <div className="pvps-zone-divider">Zona {row.zona}</div>
                        </AnimatedFeedReveal>
                      ) : null}
                      <AnimatedFeedReveal className={`pvps-row${open ? " is-open" : ""}`} cardKey={row.audit_id}>
                        <div className="pvps-row-head">
                          <div className="pvps-row-main">
                            <strong>{row.endereco}</strong>
                            <span>{row.coddv} - {row.descricao}</span>
                            <span className={`pvps-history-status ${statusInfo.tone}`}>
                              {statusInfo.emoticon} {statusInfo.label}
                            </span>
                          </div>
                          <div className="pvps-row-actions">
                            <button className="btn btn-primary pvps-icon-btn" type="button" onClick={() => openAlocCompletedEdit(row)} disabled={!canEdit} title="Editar concluído">
                              {doneIcon()}
                            </button>
                            <button className="btn btn-muted pvps-icon-btn" type="button" onClick={() => toggleExpandedAlocCompleted(row.audit_id)} title="Expandir">
                              {chevronIcon(open)}
                            </button>
                          </div>
                        </div>
                        {open ? (
                          <div className="pvps-row-details">
                            <small>Andar {formatAndar(row.nivel)} | Auditor: {row.auditor_nome}</small>
                            <small>Validade Sistema: {row.val_sist}</small>
                            <small>Informada: {row.val_conf ?? "-"}</small>
                            <small>Concluído em: {formatDateTime(row.dt_hr)}</small>
                          </div>
                        ) : null}
                      </AnimatedFeedReveal>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </article>
      </section>

      {showPvpsPopup && editorPvpsRow && typeof document !== "undefined"
        ? createPortal(
          <div
            className="confirm-overlay pvps-popup-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pvps-inform-title"
            onClick={() => {
              if (busy) return;
              setEditingPvpsCompleted(null);
              closePvpsPopup();
            }}
          >
            <div
              className="confirm-dialog pvps-popup-card"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="pvps-editor-popup">
                <div className="pvps-editor-popup-header">
                  <div className="pvps-editor-popup-heading">
                    <h3 id="pvps-inform-title">{activePvpsMode === "pul" ? "Auditar Pulmao" : "Auditar Separacao"}</h3>
                  </div>
                  <button
                    className="btn btn-muted pvps-editor-close-icon"
                    type="button"
                    disabled={busy}
                    aria-label="Fechar"
                    onClick={() => {
                      setEditingPvpsCompleted(null);
                      closePvpsPopup();
                    }}
                  >
                    {closeIcon()}
                  </button>
                </div>

                <div className="pvps-editor-summary">
                  <div className="pvps-editor-summary-address">
                    <strong>{activePvpsEnderecoAuditado}</strong>
                    <span>{editorPvpsRow.coddv} - {editorPvpsRow.descricao}</span>
                  </div>
                  <div className="pvps-editor-summary-chips">
                    <span className="pvps-editor-chip">Zona {activePvpsZonaAuditada}</span>
                    <span className="pvps-editor-chip">{activePvpsMode === "pul" ? "Pulmao" : "Separacao"}</span>
                  </div>
                </div>

                <div className="pvps-editor-panel">
                  {activePvpsMode === "sep" ? (
                    <>
                      {editingPvpsCompleted ? (
                        <div className="pvps-editor-info-grid">
                          <div className="pvps-editor-info-card">
                            <small>Ultima auditoria</small>
                            <strong>{formatDateTime(editingPvpsCompleted.dt_hr)}</strong>
                          </div>
                        </div>
                      ) : null}

                      <form className="form-grid pvps-editor-form" onSubmit={(event) => void handleSubmitSep(event)}>
                        <label>
                          Validade do produto
                          <div className="pvps-validity-row">
                            <button
                              type="button"
                              className={`pvps-occurrence-toggle${showSepOccurrence || endSit ? " is-open" : ""}`}
                              onClick={() => {
                                if (!showSepOccurrence) {
                                  setShowSepOccurrence(true);
                                  if (!endSit) { setEndSit("vazio"); setValSep(""); }
                                } else {
                                  setShowSepOccurrence(false);
                                }
                              }}
                              title="Registrar ocorrência"
                              aria-label="Registrar ocorrência"
                            >
                              ⚠️
                            </button>
                            {endSit !== "vazio" && endSit !== "obstruido" ? (
                              <input
                                value={valSep}
                                onChange={(event) => setValSep(event.target.value.replace(/\D/g, "").slice(0, 4))}
                                placeholder="MMAA"
                                maxLength={4}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                required
                              />
                            ) : !showSepOccurrence ? (
                              <span className="pvps-occurrence-badge">{formatOcorrenciaLabel(endSit as PvpsEndSit)}</span>
                            ) : null}
                          </div>
                          {showSepOccurrence ? (
                            <select
                              className="pvps-occurrence-select-minimal"
                              value={endSit}
                              aria-label="Ocorrência do endereço"
                              onChange={(event) => {
                                const next = event.target.value;
                                const parsed = next === "vazio" || next === "obstruido" ? next : "";
                                setEndSit(parsed);
                                if (parsed) setValSep("");
                                if (!parsed) setShowSepOccurrence(false);
                              }}
                            >
                              <option value="">Sem ocorrência</option>
                              <option value="vazio">Vazio</option>
                              <option value="obstruido">Obstruído</option>
                            </select>
                          ) : null}
                        </label>

                        <div className="pvps-editor-actions">
                          <button className="btn btn-primary" type="submit" disabled={busy}>Salvar</button>
                          <button
                            className="btn btn-muted"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEditingPvpsCompleted(null);
                              closePvpsPopup();
                            }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    </>
                  ) : null}

                  {activePvpsMode === "pul" ? (
                    <>
                      <div className="pvps-editor-info-grid">
                        <div className="pvps-editor-info-card">
                          <small>Validade da Separacao</small>
                          <strong>{editorPvpsRow.val_sep ?? "-"}</strong>
                        </div>
                        {editorPvpsRow.end_sit ? (
                          <div className="pvps-editor-info-card">
                            <small>Ocorrencia da linha</small>
                            <strong>{formatOcorrenciaLabel(editorPvpsRow.end_sit)}</strong>
                          </div>
                        ) : null}
                      </div>

                      {pulBusy ? <p className="pvps-editor-muted">Carregando endereços de Pulmão...</p> : null}
                      {!pulBusy && !activePulItem ? <p className="pvps-editor-muted">Endereço de Pulmão não encontrado no feed atual.</p> : null}

                      {activePulItem ? (
                        <div className="pvps-editor-form">
                          <label>
                            Validade do Pulmão
                            <div className="pvps-validity-row">
                              <button
                                type="button"
                                className={`pvps-occurrence-toggle${showPulOccurrence || pulEndSits[activePulItem.end_pul] ? " is-open" : ""}`}
                                onClick={() => {
                                  if (!showPulOccurrence) {
                                    setShowPulOccurrence(true);
                                    if (!pulEndSits[activePulItem.end_pul]) {
                                      setPulEndSits((prev) => ({ ...prev, [activePulItem.end_pul]: "vazio" }));
                                      setPulInputs((prev) => ({ ...prev, [activePulItem.end_pul]: "" }));
                                    }
                                  } else {
                                    setShowPulOccurrence(false);
                                  }
                                }}
                                title="Registrar ocorrência"
                                aria-label="Registrar ocorrência"
                              >
                                ⚠️
                              </button>
                              {(pulEndSits[activePulItem.end_pul] ?? "") !== "vazio" && (pulEndSits[activePulItem.end_pul] ?? "") !== "obstruido" ? (
                                <input
                                  value={pulInputs[activePulItem.end_pul] ?? ""}
                                  onChange={(event) => setPulInputs((prev) => ({ ...prev, [activePulItem.end_pul]: event.target.value.replace(/\D/g, "").slice(0, 4) }))}
                                  placeholder="MMAA"
                                  maxLength={4}
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                />
                              ) : !showPulOccurrence ? (
                                <span className="pvps-occurrence-badge">{formatOcorrenciaLabel(pulEndSits[activePulItem.end_pul] as PvpsEndSit)}</span>
                              ) : null}
                            </div>
                            {showPulOccurrence ? (
                              <select
                                className="pvps-occurrence-select-minimal"
                                value={pulEndSits[activePulItem.end_pul] ?? ""}
                                aria-label="Ocorrência do endereço"
                                onChange={(event) => {
                                  const next = event.target.value;
                                  const parsed = next === "vazio" || next === "obstruido" ? next : "";
                                  setPulEndSits((prev) => ({ ...prev, [activePulItem.end_pul]: parsed }));
                                  if (parsed) {
                                    setPulInputs((prev) => ({ ...prev, [activePulItem.end_pul]: "" }));
                                  }
                                  if (!parsed) setShowPulOccurrence(false);
                                }}
                              >
                                <option value="">Sem ocorrência</option>
                                <option value="vazio">Vazio</option>
                                <option value="obstruido">Obstruído</option>
                              </select>
                            ) : null}
                          </label>

                          <div className="pvps-editor-actions">
                            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void handleSubmitPul(activePulItem.end_pul)}>
                              Salvar
                            </button>
                            <button
                              className="btn btn-muted"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setEditingPvpsCompleted(null);
                                closePvpsPopup();
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {pulFeedback ? (
                        <div className={`pvps-result-chip ${pulFeedback.tone === "ok" ? "ok" : pulFeedback.tone === "bad" ? "bad" : "warn"}`}>
                          <div>{pulFeedback.text}</div>
                          <div className="pvps-editor-actions">
                            <button className="btn btn-primary" type="button" onClick={handlePulGoNext}>Próximo</button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

      {showAlocPopup && activeAloc && typeof document !== "undefined"
        ? createPortal(
          <div
            className="confirm-overlay pvps-popup-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="aloc-inform-title"
            onClick={() => {
              if (busy) return;
              setEditingAlocCompleted(null);
              setAlocResult(null);
              setShowAlocOccurrence(false);
              setShowAlocPopup(false);
            }}
          >
            <div
              className="confirm-dialog pvps-popup-card"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="pvps-editor-popup">
                <div className="pvps-editor-popup-header">
                  <div className="pvps-editor-popup-heading">
                    <h3 id="aloc-inform-title">Auditar Alocação</h3>
                  </div>
                  <button
                    className="btn btn-muted pvps-editor-close-icon"
                    type="button"
                    disabled={busy}
                    aria-label="Fechar"
                    onClick={() => {
                      setEditingAlocCompleted(null);
                      setAlocResult(null);
                      setShowAlocOccurrence(false);
                      setShowAlocPopup(false);
                    }}
                  >
                    {closeIcon()}
                  </button>
                </div>

                <div className="pvps-editor-summary">
                  <div className="pvps-editor-summary-address">
                    <strong>{activeAloc.endereco}</strong>
                    <span>{activeAloc.coddv} - {activeAloc.descricao}</span>
                  </div>
                  <div className="pvps-editor-summary-chips">
                    <span className="pvps-editor-chip">Zona {activeAloc.zona}</span>
                    <span className="pvps-editor-chip">Andar {formatAndar(activeAloc.nivel)}</span>
                  </div>
                </div>

                <div className="pvps-editor-panel">
                  <div className="pvps-editor-info-grid">
                    <div className="pvps-editor-info-card">
                      <small>Validade do sistema</small>
                      <strong>{activeAloc.val_sist}</strong>
                    </div>
                    {editingAlocCompleted ? (
                      <div className="pvps-editor-info-card">
                        <small>Ultima auditoria</small>
                        <strong>{formatDateTime(editingAlocCompleted.dt_hr)}</strong>
                      </div>
                    ) : null}
                  </div>

                  <form className="form-grid pvps-editor-form" onSubmit={(event) => void handleSubmitAlocacao(event)}>
                    <label>
                      Validade do produto
                      <div className="pvps-validity-row">
                        <button
                          type="button"
                          className={`pvps-occurrence-toggle${showAlocOccurrence || alocEndSit ? " is-open" : ""}`}
                          onClick={() => {
                            if (!showAlocOccurrence) {
                              setShowAlocOccurrence(true);
                              if (!alocEndSit) { setAlocEndSit("vazio"); setAlocValConf(""); }
                            } else {
                              setShowAlocOccurrence(false);
                            }
                          }}
                          title="Registrar ocorrência"
                          aria-label="Registrar ocorrência"
                        >
                          ⚠️
                        </button>
                        {alocEndSit !== "vazio" && alocEndSit !== "obstruido" ? (
                          <input
                            value={alocValConf}
                            onChange={(event) => setAlocValConf(event.target.value.replace(/\D/g, "").slice(0, 4))}
                            placeholder="MMAA"
                            maxLength={4}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            required
                          />
                        ) : !showAlocOccurrence ? (
                          <span className="pvps-occurrence-badge">{formatOcorrenciaLabel(alocEndSit as PvpsEndSit)}</span>
                        ) : null}
                      </div>
                      {showAlocOccurrence ? (
                        <select
                          className="pvps-occurrence-select-minimal"
                          value={alocEndSit}
                          aria-label="Ocorrência do endereço"
                          onChange={(event) => {
                            const next = event.target.value;
                            const parsed = next === "vazio" || next === "obstruido" ? next : "";
                            setAlocEndSit(parsed);
                            if (parsed) setAlocValConf("");
                            if (!parsed) setShowAlocOccurrence(false);
                          }}
                        >
                          <option value="">Sem ocorrência</option>
                          <option value="vazio">Vazio</option>
                          <option value="obstruido">Obstruído</option>
                        </select>
                      ) : null}
                    </label>

                    <div className="pvps-editor-actions">
                      <button className="btn btn-primary" type="submit" disabled={busy}>Salvar</button>
                      <button
                        className="btn btn-muted"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditingAlocCompleted(null);
                          setAlocResult(null);
                          setShowAlocOccurrence(false);
                          setShowAlocPopup(false);
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>

                  {alocResult ? (
                    <div className={`pvps-result-chip ${alocResult.aud_sit === "conforme" ? "ok" : alocResult.aud_sit === "ocorrencia" ? "warn" : "bad"}`}>
                      <div>Resultado: {alocResult.aud_sit === "conforme" ? "Conforme" : alocResult.aud_sit === "ocorrencia" ? "Ocorrência" : "Não conforme"}</div>
                      {alocResult.aud_sit === "ocorrencia" ? null : (
                        <>
                          <div>Sistema: {alocResult.val_sist}</div>
                          <div>Informada: {alocResult.val_conf ?? "-"}</div>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

      {pendingRulePreview && typeof document !== "undefined"
        ? createPortal(
          <div
            className="confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pvps-rule-apply-title"
            onClick={() => {
              if (adminBusy) return;
              setPendingRulePreview(null);
            }}
          >
            <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
              <h3 id="pvps-rule-apply-title">Aplicação da nova regra</h3>
              <p>
                Regra proposta: <strong>{pendingRulePreview.draft.rule_kind === "blacklist" ? "Blacklist" : "Prioridade"}</strong>{" "}
                em <strong>{pendingRulePreview.draft.modulo.toUpperCase()}</strong>, alvo{" "}
                <strong>
                  {pendingRulePreview.draft.target_type === "zona"
                    ? `ZONA ${pendingRulePreview.draft.target_value}`
                    : `SKU ${pendingRulePreview.draft.target_value}`}
                </strong>.
              </p>
              <p>
                Impacto atual: PVPS <strong>{pendingRulePreview.affected_pvps}</strong>, Alocação{" "}
                <strong>{pendingRulePreview.affected_alocacao}</strong>.
              </p>
              <div className="pvps-admin-grid">
                <label>
                  Aplicar regra em
                  <select value={adminApplyMode} onChange={(event) => setAdminApplyMode(event.target.value as PvpsRuleApplyMode)}>
                    <option value="apply_now">Agir agora (fila atual)</option>
                    <option value="next_inclusions">Somente próximas inclusões</option>
                  </select>
                </label>
              </div>
              <div className="confirm-actions">
                <button
                  className="btn btn-muted"
                  type="button"
                  disabled={adminBusy}
                  onClick={() => setPendingRulePreview(null)}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={adminBusy}
                  onClick={() => void handleConfirmCreateRuleFromPreview()}
                >
                  {adminBusy ? "Aplicando..." : "Confirmar regra"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

      {showAuditoriasReportModal && canUseAuditoriasReport && typeof document !== "undefined"
        ? createPortal(
          <div
            className="confirm-overlay pvps-popup-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pvps-auditorias-report-title"
            onClick={() => {
              if (reportBusySearch || reportBusyExport) return;
              setShowAuditoriasReportModal(false);
            }}
          >
            <div className="confirm-dialog pvps-report-popup-card" onClick={(event) => event.stopPropagation()}>
              <div className="pvps-zone-popup-header">
                <div className="pvps-zone-popup-title">
                  <span className="pvps-zone-popup-icon" aria-hidden="true">{reportIcon()}</span>
                  <h3 id="pvps-auditorias-report-title">Relatório Excel - vw_auditorias</h3>
                </div>
                <button
                  className="btn btn-muted pvps-zone-close-btn"
                  type="button"
                  onClick={() => setShowAuditoriasReportModal(false)}
                  disabled={reportBusySearch || reportBusyExport}
                  aria-label="Fechar relatório"
                >
                  <span aria-hidden="true">{closeIcon()}</span>
                </button>
              </div>

              <p className="pvps-report-note">
                Selecione o período e o CD para exportar os dados do relatório.
              </p>

              <form
                className="pvps-report-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runAuditoriasReportSearch();
                }}
              >
                <label>
                  Data inicial
                  <input
                    type="date"
                    value={reportDtIni}
                    onChange={(event) => setReportDtIni(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Data final
                  <input
                    type="date"
                    value={reportDtFim}
                    onChange={(event) => setReportDtFim(event.target.value)}
                    required
                  />
                </label>
                <label>
                  CD
                  <select value={reportCdMode} onChange={(event) => setReportCdMode(event.target.value as "active_cd" | "all_cds")}>
                    {activeCd != null ? <option value="active_cd">{`CD ${String(activeCd).padStart(2, "0")} (ativo)`}</option> : null}
                    <option value="all_cds">Todos CDs com acesso</option>
                  </select>
                </label>
                <label>
                  Módulo
                  <select value={reportModulo} onChange={(event) => setReportModulo(event.target.value as PvpsModulo)}>
                    <option value="pvps">PVPS</option>
                    <option value="alocacao">Alocação</option>
                    <option value="ambos">Ambos (2 arquivos)</option>
                  </select>
                </label>
              </form>

              <div className="pvps-actions pvps-report-actions">
                <button
                  type="button"
                  className="btn btn-muted pvps-toolbar-btn"
                  onClick={() => void runAuditoriasReportSearch()}
                  disabled={reportBusySearch || reportBusyExport}
                >
                  <span className="pvps-btn-icon" aria-hidden="true">{searchIcon()}</span>
                  <span>{reportBusySearch ? "Buscando..." : "Buscar"}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary pvps-toolbar-btn"
                  onClick={() => void runAuditoriasReportExport()}
                  disabled={reportBusyExport || reportBusySearch || reportCount === 0}
                >
                  <span className="pvps-btn-icon" aria-hidden="true">{reportIcon()}</span>
                  <span>{reportBusyExport ? "Exportando..." : "Exportar Excel"}</span>
                </button>
              </div>

              {reportCount != null ? (
                <p className="pvps-report-count">
                  Registros encontrados: <strong>{reportCount}</strong>
                </p>
              ) : null}
              {reportError ? <div className="alert error">{reportError}</div> : null}
              {reportMessage ? <div className="alert success">{reportMessage}</div> : null}
            </div>
          </div>,
          document.body
        ) : null}

      {showZoneFilterPopup && typeof document !== "undefined"
        ? createPortal(
          <div
            className="confirm-overlay pvps-popup-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pvps-zone-filter-title"
            onClick={() => {
              if (adminBusy) return;
              setShowZoneFilterPopup(false);
            }}
          >
            <div className="confirm-dialog pvps-zone-popup-card" onClick={(event) => event.stopPropagation()}>
              <div className="pvps-zone-popup-header">
                <div className="pvps-zone-popup-title-row">
                  <div className="pvps-zone-popup-title">
                    <span className="pvps-zone-popup-icon" aria-hidden="true">{filterIcon()}</span>
                    <h3 id="pvps-zone-filter-title">Filtro de zonas</h3>
                  </div>
                  <span className="pvps-zone-popup-badge">{tab.toUpperCase()}</span>
                </div>
                <button
                  className="btn btn-muted pvps-zone-close-btn"
                  type="button"
                  onClick={() => setShowZoneFilterPopup(false)}
                  aria-label="Fechar filtro"
                >
                  <span aria-hidden="true">{closeIcon()}</span>
                </button>
              </div>

              <div className="pvps-zone-search-wrap">
                <span className="pvps-zone-search-icon" aria-hidden="true">{searchIcon()}</span>
                <input
                  className="pvps-zone-search-input"
                  value={zoneSearch}
                  onChange={(event) => setZoneSearch(event.target.value.toUpperCase())}
                  placeholder="Buscar zona... ex.: A001"
                  autoFocus
                />
              </div>

              <div className="pvps-zone-picker-actions">
                <button
                  className="btn btn-muted pvps-zone-action-btn"
                  type="button"
                  onClick={() => setSelectedZones([])}
                  title="Limpar seleção"
                  aria-label="Limpar seleção"
                >
                  <span className="pvps-zone-action-icon pvps-zone-action-clear" aria-hidden="true">{clearSelectionIcon()}</span>
                  <span className="pvps-zone-action-label">Limpar</span>
                </button>
                <button
                  className="btn btn-muted pvps-zone-action-btn"
                  type="button"
                  onClick={() => setSelectedZones(filteredZones)}
                  title="Selecionar todas"
                  aria-label="Selecionar todas"
                >
                  <span className="pvps-zone-action-icon pvps-zone-action-select" aria-hidden="true">{selectFilteredIcon()}</span>
                  <span className="pvps-zone-action-label">Selecionar todas</span>
                </button>
              </div>

              {selectedZones.length > 0 ? (
                <div className="pvps-zone-selected-count">
                  <strong>{selectedZones.length}</strong> de <strong>{zones.length}</strong> zonas selecionadas
                </div>
              ) : null}

              <div className="pvps-zone-list">
                {filteredZones.length === 0 ? <p>Sem zonas para este filtro.</p> : null}
                {filteredZones.map((zone) => {
                  const checked = selectedZones.includes(zone);
                  return (
                    <label key={zone} className={`pvps-zone-item${checked ? " is-checked" : ""}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleZone(zone)} />
                      <span className="pvps-zone-item-label">{zone}</span>
                      {checked ? <span className="pvps-zone-check-mark" aria-hidden="true">{doneIcon()}</span> : null}
                    </label>
                  );
                })}
              </div>

              <div className="pvps-zone-popup-footer">
                <button className="btn btn-primary pvps-zone-footer-btn" type="button" onClick={() => setShowZoneFilterPopup(false)}>
                  Aplicar filtro{selectedZones.length > 0 ? ` (${selectedZones.length})` : ""}
                </button>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

    </>
  );
}
