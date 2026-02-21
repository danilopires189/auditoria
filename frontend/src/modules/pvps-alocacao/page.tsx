import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import { getModuleByKeyOrThrow } from "../registry";
import {
  createAdminRule,
  fetchAlocacaoCompletedItemsDayAll,
  fetchAdminRulesActive,
  fetchAdminRulesHistory,
  fetchAlocacaoManifest,
  fetchPvpsCompletedItemsDayAll,
  fetchPvpsManifest,
  fetchPvpsPulItems,
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
  };

const MODULE_DEF = getModuleByKeyOrThrow("pvps-alocacao");
const FEED_ACTIVE_CODDV_LIMIT = 50;
const FEED_NEXT_PREVIEW_LIMIT = 5;
const ADMIN_HISTORY_VIEW_LIMIT = 20;
const ENDERECO_COLLATOR = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function keyOfPvps(row: PvpsManifestRow): string {
  return `${row.coddv}|${row.end_sep}`;
}

function keyOfPvpsByValues(coddv: number, endSep: string): string {
  return `${Math.trunc(coddv)}|${endSep.trim().toUpperCase()}`;
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
    pulBySepKey[sepKey] = Array.isArray(items) ? [...items] : [];
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

function formatAndar(value: string | null): string {
  const normalized = (value ?? "").trim();
  if (!normalized) return "-";
  if (normalized.toLowerCase() === "t") return "T";
  return normalized;
}

function zoneFromEndereco(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) return "SEM ZONA";
  return normalized.slice(0, 4);
}

function compareEndereco(a: string | null | undefined, b: string | null | undefined): number {
  return ENDERECO_COLLATOR.compare((a ?? "").trim().toUpperCase(), (b ?? "").trim().toUpperCase());
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

function ruleKindLabel(value: PvpsRuleKind): string {
  return value === "blacklist" ? "Blacklist" : "Prioridade";
}

function moduloLabel(value: PvpsModulo): string {
  if (value === "pvps") return "PVPS";
  if (value === "alocacao") return "Alocação";
  return "Ambos";
}

function ruleTargetLabel(targetType: PvpsRuleTargetType, targetValue: string): string {
  return targetType === "zona" ? `Zona ${targetValue}` : `CODDV ${targetValue}`;
}

function historyActionLabel(value: "create" | "remove"): string {
  return value === "create" ? "Criação" : "Remoção";
}

function applyModeLabel(value: PvpsRuleApplyMode | null): string | null {
  if (value == null) return null;
  return value === "apply_now" ? "Agir agora" : "Próximas inclusões";
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
  const [showZoneFilterPopup, setShowZoneFilterPopup] = useState(false);
  const [zoneSearch, setZoneSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [pvpsRows, setPvpsRows] = useState<PvpsManifestRow[]>([]);
  const [alocRows, setAlocRows] = useState<AlocacaoManifestRow[]>([]);
  const [pvpsCompletedRows, setPvpsCompletedRows] = useState<PvpsCompletedRow[]>([]);
  const [alocCompletedRows, setAlocCompletedRows] = useState<AlocacaoCompletedRow[]>([]);
  const [todayBrt, setTodayBrt] = useState<string>(() => brtDayKey());

  const [activePvpsKey, setActivePvpsKey] = useState<string | null>(null);
  const activePvps = useMemo(
    () => pvpsRows.find((row) => keyOfPvps(row) === activePvpsKey) ?? null,
    [pvpsRows, activePvpsKey]
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
    () => (activePvpsMode === "pul" ? (activePulItem?.end_pul ?? activePvps?.end_sep ?? "") : (activePvps?.end_sep ?? "")),
    [activePvpsMode, activePulItem, activePvps]
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
  const [alocFeedback, setAlocFeedback] = useState<{ tone: PulFeedbackTone; text: string; queueId: string; zone: string | null } | null>(null);
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

  async function downloadOfflineBase(): Promise<void> {
    if (activeCd == null) {
      throw new Error("CD ativo obrigatório para preparar base offline.");
    }
    const [pvpsManifest, alocManifest] = await Promise.all([
      fetchPvpsManifest({ p_cd: activeCd, zona: null }),
      fetchAlocacaoManifest({ p_cd: activeCd, zona: null })
    ]);
    const pulBySepKey: Record<string, PvpsPulItemRow[]> = {};
    for (const row of pvpsManifest) {
      const rowKey = keyOfPvps(row);
      try {
        pulBySepKey[rowKey] = await fetchPvpsPulItems(row.coddv, row.end_sep, activeCd);
      } catch {
        pulBySepKey[rowKey] = [];
      }
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
          setStatusMessage(`${result.discarded} endereço(s) já concluído(s) por outro usuário e descartado(s).`);
        } else if (result.failed > 0 && result.remaining > 0) {
          setStatusMessage(`Sincronização parcial: ${result.failed} evento(s) com erro para nova tentativa.`);
        } else if (result.synced > 0) {
          setStatusMessage(`Sincronização concluída: ${result.synced} evento(s) enviado(s).`);
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
        if (!localData.pvpsRows.some((row) => keyOfPvps(row) === activePvpsKey)) {
          setActivePvpsKey(localData.pvpsRows[0] ? keyOfPvps(localData.pvpsRows[0]) : null);
          if (!localData.pvpsRows[0]) closePvpsPopup();
        }
        if (!localData.alocRows.some((row) => row.queue_id === activeAlocQueue)) {
          setActiveAlocQueue(localData.alocRows[0]?.queue_id ?? null);
          if (!localData.alocRows[0]) setShowAlocPopup(false);
        }
        return;
      }

      if (tab === "pvps") {
        const [rows, completed] = await Promise.all([
          fetchPvpsManifest({ p_cd: activeCd, zona: null }),
          fetchPvpsCompletedItemsDayAll({ p_cd: activeCd, p_ref_date_brt: todayBrt })
        ]);
        setPvpsRows(rows);
        setPvpsCompletedRows(completed);
        if (!rows.some((row) => keyOfPvps(row) === activePvpsKey)) {
          setActivePvpsKey(rows[0] ? keyOfPvps(rows[0]) : null);
          if (!rows[0]) closePvpsPopup();
        }
      } else {
        const [rows, completed] = await Promise.all([
          fetchAlocacaoManifest({ p_cd: activeCd, zona: null }),
          fetchAlocacaoCompletedItemsDayAll({ p_cd: activeCd, p_ref_date_brt: todayBrt })
        ]);
        setAlocRows(rows);
        setAlocCompletedRows(completed);
        if (!rows.some((row) => row.queue_id === activeAlocQueue)) {
          setActiveAlocQueue(rows[0]?.queue_id ?? null);
          if (!rows[0]) setShowAlocPopup(false);
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
    setActivePvpsMode("sep");
    setActivePulEnd(null);
    setPvpsCompletedPulByAuditId({});
    setPvpsCompletedPulLoading({});
  }, [activeCd]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, activeCd]);

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
    }, 10000);
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
    if (!activePvps) {
      setPulItems([]);
      setPulInputs({});
      setPulEndSits({});
      setShowSepOccurrence(false);
      setShowPulOccurrence(false);
      return;
    }

    setEndSit(activePvps.end_sit ?? "");
    setValSep(activePvps.val_sep?.replace("/", "") ?? "");
    setShowSepOccurrence(false);

    if (activeCd != null && (activePvps.val_sep || activePvps.end_sit)) {
      void upsertOfflineSepCache({
        user_id: profile.user_id,
        cd: activeCd,
        coddv: activePvps.coddv,
        end_sep: activePvps.end_sep,
        end_sit: activePvps.end_sit ?? null,
        val_sep: normalizeMmaa(activePvps.val_sep)
      }).catch(() => {
        // Cache offline é best-effort; não deve interromper o fluxo principal.
      });
    }

    if (activePvps.status === "pendente_sep") {
      setPulItems([]);
      setPulInputs({});
      setPulEndSits({});
      return;
    }

    if (!isOnline && preferOfflineMode) {
      const cachedItems = feedPulBySepKey[keyOfPvps(activePvps)] ?? [];
      setPulItems(cachedItems);
      const mapped: Record<string, string> = {};
      const mappedEndSit: Record<string, PvpsEndSit | ""> = {};
      for (const item of cachedItems) {
        mapped[item.end_pul] = item.val_pul?.replace("/", "") ?? "";
        mappedEndSit[item.end_pul] = item.end_sit ?? "";
      }
      setPulInputs(mapped);
      setPulEndSits(mappedEndSit);
      return;
    }

    setPulBusy(true);
    void fetchPvpsPulItems(activePvps.coddv, activePvps.end_sep, activeCd)
      .then((items) => {
        setFeedPulBySepKey((current) => ({ ...current, [keyOfPvps(activePvps)]: items }));
        setPulItems(items);
        const mapped: Record<string, string> = {};
        const mappedEndSit: Record<string, PvpsEndSit | ""> = {};
        for (const item of items) {
          mapped[item.end_pul] = item.val_pul?.replace("/", "") ?? "";
          mappedEndSit[item.end_pul] = item.end_sit ?? "";
        }
        setPulInputs(mapped);
        setPulEndSits(mappedEndSit);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar Pulmão.");
      })
      .finally(() => setPulBusy(false));
  }, [activePvps, activeCd, feedPulBySepKey, isOnline, preferOfflineMode, profile.user_id]);

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

  const sortedPvpsAllRows = useMemo(
    () => [...pvpsRows].sort((a, b) => {
      const byPriority = a.priority_score - b.priority_score;
      if (byPriority !== 0) return byPriority;
      const byZone = a.zona.localeCompare(b.zona);
      if (byZone !== 0) return byZone;
      const byEndereco = compareEndereco(a.end_sep, b.end_sep);
      if (byEndereco !== 0) return byEndereco;
      const byCoddv = a.coddv - b.coddv;
      if (byCoddv !== 0) return byCoddv;
      return dateSortValue(b.dat_ult_compra) - dateSortValue(a.dat_ult_compra);
    }),
    [pvpsRows]
  );

  const sortedAlocAllRows = useMemo(
    () => [...alocRows].sort((a, b) => {
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
      const pulItemsByRow = feedPulBySepKey[baseKey];
      if (!pulItemsByRow) continue;
      const pendingPulItems = pulItemsByRow.filter((item) => !item.auditado);
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
          endPul: item.end_pul
        });
      }
    }
    return items;
  }, [sortedPvpsAllRows, feedPulBySepKey]);

  const pvpsQueueProducts = useMemo(() => {
    const byCoddv = new Map<number, { coddv: number; descricao: string; dat_ult_compra: string; maxTs: number; minPriority: number }>();
    for (const row of sortedPvpsAllRows) {
      const ts = dateSortValue(row.dat_ult_compra);
      const current = byCoddv.get(row.coddv);
      if (!current) {
        byCoddv.set(row.coddv, {
          coddv: row.coddv,
          descricao: row.descricao,
          dat_ult_compra: row.dat_ult_compra,
          maxTs: ts,
          minPriority: row.priority_score
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
        minPriority: nextMinPriority
      });
    }
    return Array.from(byCoddv.values()).sort((a, b) => (a.minPriority - b.minPriority) || (b.maxTs - a.maxTs) || (a.coddv - b.coddv));
  }, [sortedPvpsAllRows]);

  const alocQueueProducts = useMemo(() => {
    const byCoddv = new Map<number, { coddv: number; descricao: string; dat_ult_compra: string; maxTs: number; minPriority: number }>();
    for (const row of sortedAlocAllRows) {
      const ts = dateSortValue(row.dat_ult_compra);
      const current = byCoddv.get(row.coddv);
      if (!current) {
        byCoddv.set(row.coddv, {
          coddv: row.coddv,
          descricao: row.descricao,
          dat_ult_compra: row.dat_ult_compra,
          maxTs: ts,
          minPriority: row.priority_score
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
        minPriority: nextMinPriority
      });
    }
    return Array.from(byCoddv.values()).sort((a, b) => (a.minPriority - b.minPriority) || (b.maxTs - a.maxTs) || (a.coddv - b.coddv));
  }, [sortedAlocAllRows]);

  const pvpsEligibleCoddv = useMemo(() => {
    if (!selectedZones.length) return new Set(pvpsQueueProducts.map((item) => item.coddv));
    const eligible = new Set<number>();
    for (const item of pvpsFeedItemsAll) {
      if (zoneFilterSet.has(item.zone)) {
        eligible.add(item.row.coddv);
      }
    }
    return eligible;
  }, [selectedZones, pvpsQueueProducts, pvpsFeedItemsAll, zoneFilterSet]);

  const alocEligibleCoddv = useMemo(() => {
    if (!selectedZones.length) return new Set(alocQueueProducts.map((item) => item.coddv));
    const eligible = new Set<number>();
    for (const row of sortedAlocAllRows) {
      if (zoneFilterSet.has(row.zona)) {
        eligible.add(row.coddv);
      }
    }
    return eligible;
  }, [selectedZones, alocQueueProducts, sortedAlocAllRows, zoneFilterSet]);

  const pvpsActiveCoddvList = useMemo(() => {
    const list: number[] = [];
    for (const item of pvpsQueueProducts) {
      if (!pvpsEligibleCoddv.has(item.coddv)) continue;
      list.push(item.coddv);
      if (list.length >= FEED_ACTIVE_CODDV_LIMIT) break;
    }
    return list;
  }, [pvpsQueueProducts, pvpsEligibleCoddv]);

  const alocActiveCoddvList = useMemo(() => {
    const list: number[] = [];
    for (const item of alocQueueProducts) {
      if (!alocEligibleCoddv.has(item.coddv)) continue;
      list.push(item.coddv);
      if (list.length >= FEED_ACTIVE_CODDV_LIMIT) break;
    }
    return list;
  }, [alocQueueProducts, alocEligibleCoddv]);

  const pvpsActiveCoddvSet = useMemo(() => new Set(pvpsActiveCoddvList), [pvpsActiveCoddvList]);
  const alocActiveCoddvSet = useMemo(() => new Set(alocActiveCoddvList), [alocActiveCoddvList]);

  const pvpsFeedItems = useMemo<PvpsFeedItem[]>(() => {
    return pvpsFeedItemsAll
      .filter((item) => pvpsActiveCoddvSet.has(item.row.coddv))
      .filter((item) => !selectedZones.length || zoneFilterSet.has(item.zone))
      .sort((a, b) => {
        const byPriority = a.row.priority_score - b.row.priority_score;
        if (byPriority !== 0) return byPriority;
        const byZone = a.zone.localeCompare(b.zone);
        if (byZone !== 0) return byZone;
        if (a.kind !== b.kind) return a.kind === "sep" ? -1 : 1;
        return compareEndereco(a.endereco, b.endereco);
      });
  }, [pvpsFeedItemsAll, pvpsActiveCoddvSet, selectedZones, zoneFilterSet]);

  const visibleAlocRows = useMemo(() => {
    const coddvOrder = new Map<number, number>();
    alocActiveCoddvList.forEach((coddv, index) => coddvOrder.set(coddv, index));
    const deduped = new Map<string, AlocacaoManifestRow>();
    for (const row of sortedAlocAllRows) {
      if (!deduped.has(row.queue_id)) deduped.set(row.queue_id, row);
    }
    return Array.from(deduped.values())
      .filter((row) => alocActiveCoddvSet.has(row.coddv))
      .filter((row) => !selectedZones.length || zoneFilterSet.has(row.zona))
      .sort((a, b) => {
        const byPriority = a.priority_score - b.priority_score;
        if (byPriority !== 0) return byPriority;
        const byZone = a.zona.localeCompare(b.zona);
        if (byZone !== 0) return byZone;
        const byEndereco = compareEndereco(a.endereco, b.endereco);
        if (byEndereco !== 0) return byEndereco;
        return (coddvOrder.get(a.coddv) ?? 999) - (coddvOrder.get(b.coddv) ?? 999);
      });
  }, [sortedAlocAllRows, alocActiveCoddvSet, selectedZones, zoneFilterSet, alocActiveCoddvList]);

  const zones = useMemo(() => {
    if (feedView === "pendentes") {
      if (tab === "pvps") {
        return Array.from(
          new Set(
            pvpsFeedItemsAll
              .filter((item) => pvpsActiveCoddvSet.has(item.row.coddv))
              .map((item) => item.zone)
          )
        ).sort((a, b) => a.localeCompare(b));
      }
      return Array.from(
        new Set(
          sortedAlocAllRows
            .filter((row) => alocActiveCoddvSet.has(row.coddv))
            .map((row) => row.zona)
        )
      ).sort((a, b) => a.localeCompare(b));
    }
    if (tab === "pvps") {
      return Array.from(new Set(pvpsCompletedRows.map((row) => row.zona))).sort((a, b) => a.localeCompare(b));
    }
    return Array.from(new Set(alocCompletedRows.map((row) => row.zona))).sort((a, b) => a.localeCompare(b));
  }, [
    feedView,
    tab,
    pvpsFeedItemsAll,
    pvpsActiveCoddvSet,
    sortedAlocAllRows,
    alocActiveCoddvSet,
    pvpsCompletedRows,
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
    if (!selectedZones.length) return pvpsCompletedRows;
    return pvpsCompletedRows.filter((row) => zoneFilterSet.has(row.zona));
  }, [pvpsCompletedRows, selectedZones, zoneFilterSet]);

  const filteredAlocCompletedRows = useMemo(() => {
    if (!selectedZones.length) return alocCompletedRows;
    return alocCompletedRows.filter((row) => zoneFilterSet.has(row.zona));
  }, [alocCompletedRows, selectedZones, zoneFilterSet]);

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

  useEffect(() => {
    if (tab !== "pvps" || feedView !== "pendentes" || activeCd == null || !isOnline) return;
    const activeCoddvSet = new Set(pvpsActiveCoddvList);
    const pendingPulRows = sortedPvpsAllRows.filter(
      (row) => row.status === "pendente_pul" && activeCoddvSet.has(row.coddv)
    );
    const missingRows = pendingPulRows.filter((row) => feedPulBySepKey[keyOfPvps(row)] == null);
    if (!missingRows.length) return;

    let cancelled = false;
    const loadMissing = async () => {
      const updates: Record<string, PvpsPulItemRow[]> = {};
      // Avoid overloading RPC; load a small batch and retry remaining on next cycle.
      for (const row of missingRows.slice(0, 20)) {
        if (cancelled) return;
        try {
          const items = await fetchPvpsPulItems(row.coddv, row.end_sep, activeCd);
          updates[keyOfPvps(row)] = items;
        } catch {
          // Keep row as "missing" to retry automatically.
        }
      }
      if (cancelled || !Object.keys(updates).length) return;
      setFeedPulBySepKey((current) => ({ ...current, ...updates }));
    };
    void loadMissing();
    return () => {
      cancelled = true;
    };
  }, [tab, feedView, sortedPvpsAllRows, pvpsActiveCoddvList, activeCd, feedPulBySepKey, isOnline]);

  useEffect(() => {
    if (tab === "pvps") {
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
  }, [tab, pvpsFeedItems, visibleAlocRows, activePvpsKey, activeAlocQueue]);

  const nextQueueItems = useMemo(() => {
    if (tab === "pvps") {
      return pvpsQueueProducts
        .filter((item) => pvpsEligibleCoddv.has(item.coddv))
        .slice(FEED_ACTIVE_CODDV_LIMIT, FEED_ACTIVE_CODDV_LIMIT + FEED_NEXT_PREVIEW_LIMIT)
        .map((item) => ({
          key: `pvps-next:${item.coddv}`,
          coddv: item.coddv,
          descricao: item.descricao,
          dat_ult_compra: item.dat_ult_compra
        }));
    }
    return alocQueueProducts
      .filter((item) => alocEligibleCoddv.has(item.coddv))
      .slice(FEED_ACTIVE_CODDV_LIMIT, FEED_ACTIVE_CODDV_LIMIT + FEED_NEXT_PREVIEW_LIMIT)
      .map((item) => ({
        key: `aloc-next:${item.coddv}`,
        coddv: item.coddv,
        descricao: item.descricao,
        dat_ult_compra: item.dat_ult_compra
      }));
  }, [tab, pvpsQueueProducts, pvpsEligibleCoddv, alocQueueProducts, alocEligibleCoddv]);

  async function openPvpsPopup(row: PvpsManifestRow): Promise<void> {
    setPulFeedback(null);
    setShowSepOccurrence(false);
    setShowPulOccurrence(false);
    if (row.status === "pendente_pul") {
      const rowKey = keyOfPvps(row);
      const cachedPulItems = feedPulBySepKey[rowKey];
      let pulItemsByRow: PvpsPulItemRow[] | null = Array.isArray(cachedPulItems) ? cachedPulItems : null;
      if (!pulItemsByRow && isOnline && activeCd != null) {
        try {
          pulItemsByRow = await fetchPvpsPulItems(row.coddv, row.end_sep, activeCd);
          setFeedPulBySepKey((current) => ({ ...current, [rowKey]: pulItemsByRow ?? [] }));
        } catch {
          pulItemsByRow = null;
        }
      }
      const pendingPulItems = (pulItemsByRow ?? []).filter((item) => !item.auditado);
      const firstPendingPul = pendingPulItems[0];
      if (firstPendingPul) {
        openPvpsPulPopup(row, firstPendingPul.end_pul);
        return;
      }
    }
    setEditingPvpsCompleted(null);
    setActivePvpsMode("sep");
    setActivePulEnd(null);
    setActivePvpsKey(keyOfPvps(row));
    setShowPvpsPopup(true);
  }

  function openPvpsPulPopup(row: PvpsManifestRow, endPul: string): void {
    setPulFeedback(null);
    setShowSepOccurrence(false);
    setShowPulOccurrence(false);
    setEditingPvpsCompleted(null);
    setActivePvpsMode("pul");
    setActivePulEnd(endPul);
    setActivePvpsKey(keyOfPvps(row));
    setShowPvpsPopup(true);
  }

  function openAlocPopup(row: AlocacaoManifestRow): void {
    setAlocFeedback(null);
    setEditingAlocCompleted(null);
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
    setActivePvpsMode("sep");
    setActivePulEnd(null);
    setShowPvpsPopup(false);
  }

  function canEditAudit(auditorId: string): boolean {
    return isAdmin || auditorId === profile.user_id;
  }

  function toggleExpandedPvps(key: string): void {
    setExpandedPvps((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleExpandedAloc(key: string): void {
    setExpandedAloc((prev) => ({ ...prev, [key]: !prev[key] }));
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
    setExpandedPvpsCompleted((prev) => ({ ...prev, [key]: !prev[key] }));
    if (willOpen && row.pul_auditados > 0 && !pvpsCompletedPulByAuditId[key] && !pvpsCompletedPulLoading[key]) {
      void loadPvpsCompletedPulItems(row);
    }
  }

  function toggleExpandedAlocCompleted(key: string): void {
    setExpandedAlocCompleted((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function openPvpsCompletedEdit(row: PvpsCompletedRow): void {
    if (!canEditAudit(row.auditor_id)) return;
    setShowSepOccurrence(false);
    setShowPulOccurrence(false);
    setEditingPvpsCompleted(row);
    setActivePvpsMode("sep");
    setActivePulEnd(null);
    const key = `${row.coddv}|${row.end_sep}`;
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
        priority_score: 9999
      }, ...current];
    });
    setActivePvpsKey(key);
    setShowPvpsPopup(true);
  }

  function openAlocCompletedEdit(row: AlocacaoCompletedRow): void {
    if (!canEditAudit(row.auditor_id)) return;
    setAlocFeedback(null);
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
        priority_score: 9999
      }, ...current];
    });
    setActiveAlocQueue(row.queue_id);
    setShowAlocPopup(true);
  }

  function openNextPvpsFrom(currentFeedKey: string): void {
    const index = pvpsFeedItems.findIndex((item) => item.feedKey === currentFeedKey);
    const startAt = index >= 0 ? index + 1 : 0;
    const next = pvpsFeedItems.find((_, itemIndex) => itemIndex >= startAt);
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
    const sepItems = pvpsFeedItems.filter((item): item is Extract<PvpsFeedItem, { kind: "sep" }> => item.kind === "sep");
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
    setEditingPvpsCompleted(null);
    setShowSepOccurrence(false);
    setActivePvpsMode("sep");
    setActivePulEnd(null);
    setActivePvpsKey(keyOfPvps(next.row));
    setShowPvpsPopup(true);
  }

  function openNextAlocacaoFrom(currentQueueId: string, currentZone?: string | null): void {
    const index = visibleAlocRows.findIndex((row) => row.queue_id === currentQueueId);
    const fallbackZone = index >= 0 ? visibleAlocRows[index]?.zona ?? null : null;
    const targetZone = currentZone ?? fallbackZone;
    const startAt = index >= 0 ? index + 1 : 0;
    let next: AlocacaoManifestRow | undefined;
    if (targetZone) {
      next = visibleAlocRows.find((row, rowIndex) => rowIndex >= startAt && row.zona === targetZone);
    }
    if (next) {
      setActiveAlocQueue(next.queue_id);
      setShowAlocPopup(true);
    } else {
      setShowAlocPopup(false);
    }
  }

  async function handleSubmitSep(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!activePvps) return;
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
    const currentKey = keyOfPvps(activePvps);
    const currentFeedKey = `sep:${currentKey}`;
    const isEditingCompleted = Boolean(editingPvpsCompleted);
    if (!isOnline) {
      if (!preferOfflineMode) {
        setErrorMessage("Sem internet no momento. Ative 'Trabalhar offline' para usar a base local.");
        return;
      }
      if (!manifestReady) {
        setErrorMessage("Base offline indisponível. Conecte-se e baixe a base antes de auditar sem rede.");
        return;
      }
      try {
        await saveOfflineSepEvent({
          user_id: profile.user_id,
          cd: activeCd,
          coddv: activePvps.coddv,
          end_sep: activePvps.end_sep,
          end_sit: endSit || null,
          val_sep: hasOcorrencia ? null : normalizedValSep
        });
        await upsertOfflineSepCache({
          user_id: profile.user_id,
          cd: activeCd,
          coddv: activePvps.coddv,
          end_sep: activePvps.end_sep,
          end_sit: endSit || null,
          val_sep: hasOcorrencia ? null : normalizedValSep
        });
        await refreshPendingState();
        if (hasOcorrencia) {
          setPvpsRows((current) => current.filter((row) => keyOfPvps(row) !== currentKey));
          setStatusMessage("Separação com ocorrência salva offline. Item retirado localmente e será sincronizado ao reconectar.");
          openNextPvpsSepFrom(currentFeedKey);
        } else {
          const localVal = `${normalizedValSep.slice(0, 2)}/${normalizedValSep.slice(2)}`;
          setPvpsRows((current) => current.map((row) => (
            keyOfPvps(row) === currentKey
              ? { ...row, status: "pendente_pul", val_sep: localVal, end_sit: null }
              : row
          )));
          setStatusMessage("Separação salva offline. Pulmão ficará pendente para auditoria separada.");
          openNextPvpsSepFrom(currentFeedKey);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar Separação offline.");
      }
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await submitPvpsSep({
        p_cd: activeCd,
        coddv: activePvps.coddv,
        end_sep: activePvps.end_sep,
        end_sit: endSit || null,
        val_sep: hasOcorrencia ? null : normalizedValSep
      });
      if (result.end_sit === "vazio" || result.end_sit === "obstruido") {
        setStatusMessage("Separação com ocorrência. Item removido do feed e não será enviado ao frontend.");
      } else {
        setStatusMessage(`Separação salva. Pulmão liberado e ficará pendente para auditoria separada (${result.pul_auditados}/${result.pul_total} auditados).`);
      }
      await upsertOfflineSepCache({
        user_id: profile.user_id,
        cd: activeCd,
        coddv: activePvps.coddv,
        end_sep: activePvps.end_sep,
        end_sit: result.end_sit,
        val_sep: normalizeMmaa(result.val_sep ?? normalizedValSep)
      });
      await loadCurrent();
      if (isEditingCompleted) {
        setEditingPvpsCompleted(null);
        closePvpsPopup();
      } else {
        openNextPvpsSepFrom(currentFeedKey);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar etapa de Separação.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitPul(endPul: string): Promise<void> {
    if (!activePvps) return;
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
    const currentKey = keyOfPvps(activePvps);
    const currentFeedKey = `pul:${currentKey}:${endPul}`;
    const valPul = hasPulOcorrencia ? null : normalizeMmaaText(value);

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

    if (!isOnline) {
      if (!preferOfflineMode) {
        setErrorMessage("Sem internet no momento. Ative 'Trabalhar offline' para usar a base local.");
        return;
      }
      if (!manifestReady) {
        setErrorMessage("Base offline indisponível. Conecte-se e baixe a base antes de auditar sem rede.");
        return;
      }
      let hasSep = await hasOfflineSepCache(profile.user_id, activeCd, activePvps.coddv, activePvps.end_sep);
      if (!hasSep && (activePvps.val_sep || activePvps.end_sit)) {
        await upsertOfflineSepCache({
          user_id: profile.user_id,
          cd: activeCd,
          coddv: activePvps.coddv,
          end_sep: activePvps.end_sep,
          end_sit: activePvps.end_sit ?? null,
          val_sep: normalizeMmaa(activePvps.val_sep)
        });
        hasSep = true;
      }
      if (!hasSep) {
        setErrorMessage("Para informar Pulmão offline, salve primeiro a linha de Separação no mesmo endereço.");
        return;
      }
      try {
        await saveOfflinePulEvent({
          user_id: profile.user_id,
          cd: activeCd,
          coddv: activePvps.coddv,
          end_sep: activePvps.end_sep,
          end_pul: endPul,
          end_sit: hasPulOcorrencia ? pulEndSit : null,
          val_pul: hasPulOcorrencia ? null : value.trim(),
          audit_id: activePvps.audit_id
        });
        await refreshPendingState();
        applyLocalPulSave();
        const feedbackText = hasPulOcorrencia
          ? "Pulmão com ocorrência salvo (offline). Use o ícone à direita para ir ao próximo."
          : "Pulmão salvo (offline). Use o ícone à direita para ir ao próximo.";
        setPulFeedback({ tone: "warn", text: feedbackText, feedKey: currentFeedKey });
        setStatusMessage(feedbackText);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar Pulmão offline.");
      }
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    const isEditingCompleted = Boolean(editingPvpsCompleted);
    try {
      let auditId = activePvps.audit_id;
      if (!auditId) {
        const rows = await fetchPvpsManifest({ p_cd: activeCd, zona: null });
        auditId = rows.find((row) => row.coddv === activePvps.coddv && row.end_sep === activePvps.end_sep)?.audit_id ?? null;
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
      let feedbackTone: PulFeedbackTone = "warn";
      let feedbackText = "";
      if (result.status === "concluido") {
        feedbackTone = "ok";
        feedbackText = "PVPS concluído com conformidade. Use o ícone à direita para ir ao próximo.";
      } else if (result.status === "nao_conforme") {
        feedbackTone = "bad";
        feedbackText = "PVPS concluído sem conformidade. Use o ícone à direita para ir ao próximo.";
      } else {
        feedbackTone = "warn";
        feedbackText = hasPulOcorrencia
          ? `Pulmão com ocorrência salvo (${result.pul_auditados}/${result.pul_total}). Use o ícone à direita para ir ao próximo.`
          : `Pulmão salvo (${result.pul_auditados}/${result.pul_total}). Use o ícone à direita para ir ao próximo.`;
      }
      setPulFeedback({ tone: feedbackTone, text: feedbackText, feedKey: currentFeedKey });
      setStatusMessage(feedbackText);
      if (isEditingCompleted) {
        setEditingPvpsCompleted(null);
        closePvpsPopup();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar etapa de Pulmão.");
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
    if (!hasOcorrencia && normalizedValConf.length !== 4) {
      setErrorMessage("Validade do Produto obrigatória (MMAA) quando não houver ocorrência.");
      return;
    }

    if (!isOnline) {
      if (isEditingCompleted) {
        setErrorMessage("Edição de concluído requer conexão com o servidor.");
        return;
      }
      if (!preferOfflineMode) {
        setErrorMessage("Sem internet no momento. Ative 'Trabalhar offline' para usar a base local.");
        return;
      }
      if (!manifestReady) {
        setErrorMessage("Base offline indisponível. Conecte-se e baixe a base antes de auditar sem rede.");
        return;
      }
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
        const feedbackText = hasOcorrencia
          ? "Alocação com ocorrência salva offline. Use o ícone à direita para ir ao próximo."
          : "Alocação salva offline. Use o ícone à direita para ir ao próximo.";
        setStatusMessage(feedbackText);
        setAlocFeedback({ tone: "warn", text: feedbackText, queueId: currentQueueId, zone: currentZone });
        setAlocResult(null);
        setAlocEndSit("");
        setAlocValConf("");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar alocação offline.");
      }
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
      let feedbackTone: PulFeedbackTone = "warn";
      let feedbackText = "";
      if (result.aud_sit === "conforme") {
        feedbackTone = "ok";
        feedbackText = "Alocação auditada conforme. Use o ícone à direita para ir ao próximo.";
      } else if (result.aud_sit === "nao_conforme") {
        feedbackTone = "bad";
        feedbackText = "Alocação auditada não conforme. Use o ícone à direita para ir ao próximo.";
      } else {
        feedbackTone = "warn";
        feedbackText = "Alocação auditada com ocorrência. Use o ícone à direita para ir ao próximo.";
      }
      setStatusMessage(feedbackText);
      setEditingAlocCompleted(null);
      setAlocEndSit("");
      setAlocValConf("");
      if (isEditingCompleted) {
        setAlocFeedback(null);
        await loadCurrent();
        setShowAlocPopup(false);
      } else {
        setAlocFeedback({ tone: feedbackTone, text: feedbackText, queueId: currentQueueId, zone: currentZone });
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar auditoria de alocação.");
    } finally {
      setBusy(false);
    }
  }

  function handleAlocGoNext(): void {
    if (!alocFeedback) return;
    const { queueId, zone } = alocFeedback;
    setAlocFeedback(null);
    setAlocResult(null);
    openNextAlocacaoFrom(queueId, zone);
    void loadCurrent({ silent: true });
  }

  async function executeCreateAdminRule(draft: AdminRuleDraft, applyMode: PvpsRuleApplyMode): Promise<void> {
    const normalizedTarget = draft.target_type === "zona"
      ? draft.target_value.trim().toUpperCase()
      : draft.target_value.replace(/\D/g, "");
    if (!normalizedTarget) {
      setErrorMessage(draft.target_type === "zona" ? "Zona obrigatória para criar regra." : "CODDV obrigatório para criar regra.");
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
      const targetLabel = `${draft.target_type === "zona" ? "Zona" : "CODDV"} ${normalizedTarget}`;
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
      setErrorMessage(adminDraft.target_type === "zona" ? "Zona obrigatória para criar regra." : "CODDV obrigatório para criar regra.");
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
                  className={`btn btn-muted${showAdminPanel ? " is-active" : ""}`}
                  onClick={() => setShowAdminPanel((prev) => !prev)}
                >
                  {showAdminPanel ? "Ocultar Gestão" : "Admin: Gestão de Regras"}
                </button>
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
                      <option value="coddv">CODDV</option>
                    </select>
                  </label>
                  <label>
                    {adminDraft.target_type === "zona" ? "Zona" : "CODDV"}
                    <input
                      value={adminDraft.target_value}
                      onChange={(event) => setAdminDraft((current) => ({
                        ...current,
                        target_value: current.target_type === "zona"
                          ? event.target.value.toUpperCase()
                          : event.target.value.replace(/\D/g, "")
                      }))}
                      placeholder={adminDraft.target_type === "zona" ? "Ex.: PG01" : "Código"}
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
                  const active = item.kind === "pul"
                    ? (activePvpsMode === "pul" && keyOfPvps(item.row) === activePvpsKey && activePulEnd === item.endPul)
                    : (activePvpsMode === "sep" && keyOfPvps(item.row) === activePvpsKey);
                  const open = Boolean(expandedPvps[itemKey]);
                  const previous = index > 0 ? pvpsFeedItems[index - 1] : null;
                  const showZoneHeader = !previous || previous.zone !== item.zone;
                  const row = item.row;
                  return (
                    <div key={itemKey} className="pvps-zone-group">
                      {showZoneHeader ? <div className="pvps-zone-divider">Zona {item.zone}</div> : null}
                      <div className={`pvps-row${active ? " is-active" : ""}`}>
                        <div className="pvps-row-head">
                          <div className="pvps-row-main">
                            <strong>{item.endereco}</strong>
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
                      </div>
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
              </div>
            ) : null}

            {feedView === "pendentes" && tab === "alocacao" ? (
              <div className="pvps-list">
                {visibleAlocRows.length === 0 ? <p>Nenhum item de Alocação pendente para os filtros atuais.</p> : null}
                {visibleAlocRows.map((row, index) => {
                  const open = Boolean(expandedAloc[row.queue_id]);
                  const previous = index > 0 ? visibleAlocRows[index - 1] : null;
                  const showZoneHeader = !previous || previous.zona !== row.zona;
                  return (
                    <div key={row.queue_id} className="pvps-zone-group">
                      {showZoneHeader ? <div className="pvps-zone-divider">Zona {row.zona}</div> : null}
                      <div className={`pvps-row${row.queue_id === activeAlocQueue ? " is-active" : ""}`}>
                        <div className="pvps-row-head">
                          <div className="pvps-row-main">
                            <strong>{row.endereco}</strong>
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
                            <small>Última compra: {formatDate(row.dat_ult_compra)}</small>
                          </div>
                        ) : null}
                      </div>
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
              </div>
            ) : null}

            {feedView === "concluidos" && tab === "pvps" ? (
              <div className="pvps-list">
                {sortedPvpsCompletedRows.length === 0 ? <p>Sem itens concluídos hoje para o CD ativo.</p> : null}
                {sortedPvpsCompletedRows.map((row, index) => {
                  const open = Boolean(expandedPvpsCompleted[row.audit_id]);
                  const previous = index > 0 ? sortedPvpsCompletedRows[index - 1] : null;
                  const showZoneHeader = !previous || previous.zona !== row.zona;
                  const canEdit = canEditAudit(row.auditor_id);
                  const statusInfo = pvpsHistoryStatus(row);
                  const pulItemsCompleted = pvpsCompletedPulByAuditId[row.audit_id] ?? [];
                  const pulItemsLoading = Boolean(pvpsCompletedPulLoading[row.audit_id]);
                  return (
                    <div key={row.audit_id} className="pvps-zone-group">
                      {showZoneHeader ? <div className="pvps-zone-divider">Zona {row.zona}</div> : null}
                      <div className="pvps-row">
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
                            <small>Pulmão auditados: {row.pul_auditados}/{row.pul_total}</small>
                            {row.pul_auditados > 0 ? (
                              <div className="pvps-pul-completed-group">
                                <small className="pvps-pul-completed-title">Pulmões auditados</small>
                                {pulItemsLoading ? <small>Carregando endereços de Pulmão...</small> : null}
                                {!pulItemsLoading ? [...pulItemsCompleted].sort((a, b) => a.end_pul.localeCompare(b.end_pul)).map((item) => (
                                  <small key={`${row.audit_id}:${item.end_pul}`} className="pvps-pul-completed-item">
                                    {item.end_pul} | Validade {item.val_pul ?? "-"}{item.end_sit ? ` | Ocorrência ${formatOcorrenciaLabel(item.end_sit)}` : ""}
                                  </small>
                                )) : null}
                              </div>
                            ) : null}
                            {row.pul_has_lower ? (
                              <small>
                                Pulmão com validade menor: {row.pul_lower_end ?? "-"} ({row.pul_lower_val ?? "-"})
                              </small>
                            ) : null}
                            <small>Auditor: {row.auditor_nome}</small>
                            <small>Concluído em: {formatDateTime(row.dt_hr)}</small>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {feedView === "concluidos" && tab === "alocacao" ? (
              <div className="pvps-list">
                {sortedAlocCompletedRows.length === 0 ? <p>Sem itens concluídos hoje para o CD ativo.</p> : null}
                {sortedAlocCompletedRows.map((row, index) => {
                  const open = Boolean(expandedAlocCompleted[row.audit_id]);
                  const previous = index > 0 ? sortedAlocCompletedRows[index - 1] : null;
                  const showZoneHeader = !previous || previous.zona !== row.zona;
                  const canEdit = canEditAudit(row.auditor_id);
                  const statusInfo = alocHistoryStatus(row);
                  return (
                    <div key={row.audit_id} className="pvps-zone-group">
                      {showZoneHeader ? <div className="pvps-zone-divider">Zona {row.zona}</div> : null}
                      <div className="pvps-row">
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
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </article>
      </section>

      {showPvpsPopup && activePvps && typeof document !== "undefined"
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
            <div className="confirm-dialog surface-enter pvps-popup-card" onClick={(event) => event.stopPropagation()}>
              <h3 id="pvps-inform-title">
                {editingPvpsCompleted
                  ? "PVPS - Edição concluída"
                  : activePvpsMode === "pul"
                    ? "PVPS - Pulmão"
                    : "PVPS - Separação"}
              </h3>
              <p><strong>{activePvpsEnderecoAuditado}</strong></p>
              <p>{activePvps.coddv} - {activePvps.descricao}</p>
              <p>Zona: <strong>{activePvpsZonaAuditada}</strong></p>
              {editingPvpsCompleted ? <p>Última auditoria: <strong>{formatDateTime(editingPvpsCompleted.dt_hr)}</strong></p> : null}

              {activePvpsMode === "sep" ? (
                <form className="form-grid" onSubmit={(event) => void handleSubmitSep(event)}>
                  <label>
                    Validade do Produto
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
                          autoFocus
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
                        <option value="">— sem ocorrência</option>
                        <option value="vazio">Vazio</option>
                        <option value="obstruido">Obstruído</option>
                      </select>
                    ) : null}
                  </label>
                  <button className="btn btn-primary" type="submit" disabled={busy}>Salvar</button>
                </form>
              ) : null}

              {activePvpsMode === "pul" ? (
                <div className="pvps-pul-box">
                  <p>Endereço separação: <strong>{activePvps.end_sep}</strong></p>
                  <p>Validade Separação: <strong>{activePvps.val_sep ?? "-"}</strong></p>
                  {activePvps.end_sit ? <p>Ocorrência linha: <strong>{formatOcorrenciaLabel(activePvps.end_sit)}</strong></p> : null}
                  {pulBusy ? <p>Carregando endereços de Pulmão...</p> : null}
                  {!pulBusy && !activePulItem ? <p>Endereço de Pulmão não encontrado no feed atual.</p> : null}
                  {activePulItem ? (
                    <div className="pvps-pul-row">
                      <div>
                        <strong>{activePulItem.end_pul}</strong>
                        <small>{activePulItem.auditado ? "Auditado" : "Pendente"}</small>
                      </div>
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
                            <option value="">— sem ocorrência</option>
                            <option value="vazio">Vazio</option>
                            <option value="obstruido">Obstruído</option>
                          </select>
                        ) : null}
                      </label>
                      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void handleSubmitPul(activePulItem.end_pul)}>
                        Salvar
                      </button>
                    </div>
                  ) : null}
                  {pulFeedback ? (
                    <div className={`pvps-pul-feedback pvps-result-chip ${pulFeedback.tone === "ok" ? "ok" : pulFeedback.tone === "bad" ? "bad" : "warn"}`}>
                      <span>{pulFeedback.text}</span>
                      <button
                        className="btn btn-primary pvps-icon-btn pvps-pul-next-btn"
                        type="button"
                        onClick={handlePulGoNext}
                        title="Ir para o próximo"
                      >
                        {nextIcon()}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="confirm-actions">
                <button className="btn btn-muted" type="button" disabled={busy} onClick={() => {
                  setEditingPvpsCompleted(null);
                  closePvpsPopup();
                }}>
                  Fechar
                </button>
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
              setAlocFeedback(null);
              setShowAlocPopup(false);
            }}
          >
            <div className="confirm-dialog surface-enter pvps-popup-card" onClick={(event) => event.stopPropagation()}>
              <h3 id="aloc-inform-title">{editingAlocCompleted ? "Alocação - Edição concluída" : "Alocação"}</h3>
              <p><strong>{activeAloc.endereco}</strong></p>
              <p>{activeAloc.coddv} - {activeAloc.descricao}</p>
              <p>Zona: <strong>{activeAloc.zona}</strong> | Andar: <strong>{formatAndar(activeAloc.nivel)}</strong></p>
              {editingAlocCompleted ? <p>Última auditoria: <strong>{formatDateTime(editingAlocCompleted.dt_hr)}</strong></p> : null}

              {!alocFeedback ? (
                <form className="form-grid" onSubmit={(event) => void handleSubmitAlocacao(event)}>
                  <label>
                    Validade do Produto
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
                          autoFocus
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
                        <option value="">— sem ocorrência</option>
                        <option value="vazio">Vazio</option>
                        <option value="obstruido">Obstruído</option>
                      </select>
                    ) : null}
                  </label>
                  <button className="btn btn-primary" type="submit" disabled={busy}>
                    Salvar
                  </button>
                </form>
              ) : null}

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
              {alocFeedback ? (
                <div className={`pvps-pul-feedback pvps-result-chip ${alocFeedback.tone === "ok" ? "ok" : alocFeedback.tone === "bad" ? "bad" : "warn"}`}>
                  <span>{alocFeedback.text}</span>
                  <button
                    className="btn btn-primary pvps-icon-btn pvps-pul-next-btn"
                    type="button"
                    onClick={handleAlocGoNext}
                    title="Ir para o próximo"
                  >
                    {nextIcon()}
                  </button>
                </div>
              ) : null}

              <div className="confirm-actions">
                <button className="btn btn-muted" type="button" disabled={busy} onClick={() => {
                  setEditingAlocCompleted(null);
                  setAlocResult(null);
                  setAlocFeedback(null);
                  setShowAlocPopup(false);
                }}>
                  Fechar
                </button>
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
                    : `CODDV ${pendingRulePreview.draft.target_value}`}
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
