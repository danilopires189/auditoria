import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import {
  formatDateOnlyPtBR,
  formatDateTimeBrasilia,
  todayIsoBrasilia
} from "../../shared/brasilia-datetime";
import { shouldTriggerQueuedBackgroundSync } from "../../shared/offline/queue-policy";
import { useOnDemandSoftKeyboard } from "../../shared/use-on-demand-soft-keyboard";
import { useScanFeedback } from "../../shared/use-scan-feedback";
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import { getModuleByKeyOrThrow } from "../registry";
import {
  normalizeOccurrenceInput,
  normalizeEtiquetaInput,
  parseAuditoriaCaixaEtiqueta,
  requiresKnappId,
  toDisplayName,
  normalizeSearchText
} from "./logic";
import {
  cleanupExpiredAuditoriaCaixaRows,
  getAuditoriaCaixaPreferences,
  getDbRotasByFilial,
  getDbRotasMeta,
  getUserAuditoriaCaixaRows,
  removeAuditoriaCaixaRow,
  saveAuditoriaCaixaPreferences,
  upsertAuditoriaCaixaRow
} from "./storage";
import {
  countAuditoriaCaixaReportRows,
  fetchAuditoriaCaixaReportRows,
  fetchCdOptions,
  fetchTodaySharedAuditoriaCaixaRows,
  refreshDbRotasCache,
  syncPendingAuditoriaCaixaRows
} from "./sync";
import {
  AUDITORIA_CAIXA_OCCURRENCIAS,
  type AuditoriaCaixaModuleProfile,
  type AuditoriaCaixaOccurrence,
  type AuditoriaCaixaReportFilters,
  type AuditoriaCaixaRow,
  type CdOption
} from "./types";

interface AuditoriaCaixaPageProps {
  isOnline: boolean;
  profile: AuditoriaCaixaModuleProfile;
}

type EditDraft = {
  etiqueta: string;
  id_knapp: string;
  ocorrencia: "" | Exclude<AuditoriaCaixaOccurrence, null>;
};

type OccurrenceModalTarget =
  | { kind: "form" }
  | { kind: "edit"; rowId: string };

interface ScannerInputState {
  lastInputAt: number;
  lastLength: number;
  burstChars: number;
  timerId: number | null;
  lastSubmittedValue: string;
  lastSubmittedAt: number;
}

interface FeedFilialGroup {
  key: string;
  filial: number;
  filial_nome: string | null;
  rows: AuditoriaCaixaRow[];
}

interface FeedRouteGroup {
  key: string;
  rota: string;
  rowsCount: number;
  filiais: FeedFilialGroup[];
}

const MODULE_DEF = getModuleByKeyOrThrow("auditoria-caixa");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const QUICK_SYNC_THROTTLE_MS = 2500;
const ROUTE_CACHE_REFRESH_COOLDOWN_MS = 45_000;
const SCANNER_INPUT_MAX_INTERVAL_MS = 45;
const SCANNER_INPUT_MIN_BURST_CHARS = 5;
const SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS = 90;
const SCANNER_INPUT_SUBMIT_COOLDOWN_MS = 600;
const PENDING_SYNC_STATUSES = new Set<AuditoriaCaixaRow["sync_status"]>([
  "pending_insert",
  "pending_update",
  "pending_delete",
  "error"
]);

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

function cdCodeLabel(cd: number | null): string {
  if (cd == null) return "CD não definido";
  return `CD ${String(cd).padStart(2, "0")}`;
}

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function roleIsGlobalAdmin(profile: AuditoriaCaixaModuleProfile): boolean {
  return profile.role === "admin" && profile.cd_default == null;
}

function fixedCdFromProfile(profile: AuditoriaCaixaModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) {
    return Math.trunc(profile.cd_default);
  }
  return parseCdFromLabel(profile.cd_nome);
}

function canManageAuditoriaCaixaRow(profile: AuditoriaCaixaModuleProfile, row: AuditoriaCaixaRow): boolean {
  return row.user_id === profile.user_id;
}

function formatDateTime(value: string): string {
  return formatDateTimeBrasilia(value, {
    includeSeconds: true,
    emptyFallback: "-",
    invalidFallback: "-"
  });
}

function isTodayFeedRow(value: string | null | undefined): boolean {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return todayIsoBrasilia(parsed) === todayIsoBrasilia();
}

function asStatusLabel(status: AuditoriaCaixaRow["sync_status"]): string {
  if (status === "pending_insert") return "Pendente envio";
  if (status === "pending_update") return "Pendente atualização";
  if (status === "pending_delete") return "Pendente exclusão";
  if (status === "error") return "Erro de sync";
  return "Sincronizado";
}

function asStatusClass(status: AuditoriaCaixaRow["sync_status"]): string {
  if (status === "synced") return "synced";
  if (status === "error") return "error";
  return "pending";
}

function sortRows(rows: AuditoriaCaixaRow[]): AuditoriaCaixaRow[] {
  return [...rows].sort((a, b) => {
    const aTime = Date.parse(a.data_hr || a.updated_at || a.created_at || "");
    const bTime = Date.parse(b.data_hr || b.updated_at || b.created_at || "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return bTime - aTime;
    }
    return (b.updated_at || "").localeCompare(a.updated_at || "");
  });
}

function safeUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toPendingLocalId(row: AuditoriaCaixaRow): string {
  if (row.remote_id) {
    return row.local_id.startsWith("pending:") ? row.local_id : `pending:${row.remote_id}`;
  }
  return row.local_id;
}

function buildRouteKey(rota: string | null | undefined): string {
  return (String(rota ?? "Sem rota").trim() || "Sem rota");
}

function buildStoreKey(rota: string | null | undefined, filial: number, filialNome: string | null | undefined): string {
  return `${buildRouteKey(rota)}::${filial}::${filialNome ?? ""}`;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7a2 2 0 0 1 2-2h6l8 8-7 7-8-8z" />
      <circle cx="9" cy="9" r="1.4" />
    </svg>
  );
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none" }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20l4.5-1 10-10-3.5-3.5-10 10z" />
      <path d="M14.5 5.5l3.5 3.5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M7 7l1 13h8l1-13" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function OfflineModeIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10a12 12 0 0 1 16 0" />
      <path d="M7 13a8 8 0 0 1 10 0" />
      <path d="M10 16a4 4 0 0 1 4 0" />
      <circle cx="12" cy="19" r="1.5" />
      {!enabled ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
      <path d="M10 12h6" />
      <path d="M10 16h6" />
    </svg>
  );
}

function buildEditDraft(row: AuditoriaCaixaRow): EditDraft {
  return {
    etiqueta: row.etiqueta,
    id_knapp: row.id_knapp ?? "",
    ocorrencia: (row.ocorrencia ?? "") as EditDraft["ocorrencia"]
  };
}

export default function AuditoriaCaixaPage({ isOnline, profile }: AuditoriaCaixaPageProps) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [cdAtivo, setCdAtivo] = useState<number | null>(null);
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [etiquetaInput, setEtiquetaInput] = useState("");
  const [idKnappInput, setIdKnappInput] = useState("");
  const [ocorrenciaInput, setOcorrenciaInput] = useState<EditDraft["ocorrencia"]>("");
  const [localRows, setLocalRows] = useState<AuditoriaCaixaRow[]>([]);
  const [sharedTodayRows, setSharedTodayRows] = useState<AuditoriaCaixaRow[]>([]);
  const [dbRotasCount, setDbRotasCount] = useState(0);
  const [dbRotasLastSyncAt, setDbRotasLastSyncAt] = useState<string | null>(null);
  const [busyRefresh, setBusyRefresh] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportDtIni, setReportDtIni] = useState(todayIsoBrasilia());
  const [reportDtFim, setReportDtFim] = useState(todayIsoBrasilia());
  const [reportCd, setReportCd] = useState<string>("");
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [reportBusySearch, setReportBusySearch] = useState(false);
  const [reportBusyExport, setReportBusyExport] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AuditoriaCaixaRow | null>(null);
  const [occurrenceModalTarget, setOccurrenceModalTarget] = useState<OccurrenceModalTarget | null>(null);
  const [occurrenceSearch, setOccurrenceSearch] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);

  const etiquetaRef = useRef<HTMLInputElement | null>(null);
  const collectInFlightRef = useRef(false);
  const lastQuickSyncAtRef = useRef(0);
  const lastRouteRefreshAtRef = useRef(0);
  const scannerInputStateRef = useRef<ScannerInputState>(createScannerInputState());
  const {
    inputMode: etiquetaInputMode,
    enableSoftKeyboard: enableEtiquetaSoftKeyboard,
    disableSoftKeyboard: disableEtiquetaSoftKeyboard
  } = useOnDemandSoftKeyboard("text");

  const { scanFeedback, scanFeedbackTop, showScanFeedback, triggerScanErrorAlert } = useScanFeedback(
    () => etiquetaRef.current
  );

  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const isGlobalAdmin = useMemo(() => roleIsGlobalAdmin(profile), [profile]);
  const fixedCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const currentCd = isGlobalAdmin ? cdAtivo : fixedCd;
  const canSeeReportTools = isDesktop && profile.role === "admin";
  const offlineReady = !isDesktop && preferOfflineMode && dbRotasCount > 0;
  const canOperate = isOnline || offlineReady;
  const etiquetaRequiresKnapp = useMemo(
    () => requiresKnappId(etiquetaInput) || Boolean(idKnappInput.trim()),
    [etiquetaInput, idKnappInput]
  );

  const visibleRows = useMemo(() => {
    if (currentCd == null) return [];

    const localCurrent = localRows.filter(
      (row) => row.cd === currentCd && row.sync_status !== "synced" && isTodayFeedRow(row.data_hr)
    );
    const pendingByRemoteId = new Map<string, AuditoriaCaixaRow>();
    const pendingDeleteIds = new Set<string>();
    const pendingNewRows: AuditoriaCaixaRow[] = [];

    for (const row of localCurrent) {
      if (row.remote_id) {
        if (row.sync_status === "pending_delete") {
          pendingDeleteIds.add(row.remote_id);
        } else {
          pendingByRemoteId.set(row.remote_id, row);
        }
      } else if (row.sync_status !== "pending_delete") {
        pendingNewRows.push(row);
      }
    }

    const remoteIds = new Set<string>();
    const mergedRemote = sharedTodayRows
      .filter((row) => row.cd === currentCd && row.remote_id)
      .filter((row) => {
        if (!row.remote_id) return true;
        remoteIds.add(row.remote_id);
        return !pendingDeleteIds.has(row.remote_id);
      })
      .map((row) => {
        if (!row.remote_id) return row;
        return pendingByRemoteId.get(row.remote_id) ?? row;
      });

    const pendingOrphans = localCurrent.filter(
      (row) => row.remote_id && !remoteIds.has(row.remote_id) && row.sync_status !== "pending_delete"
    );

    return sortRows([...pendingNewRows, ...pendingOrphans, ...mergedRemote]);
  }, [currentCd, localRows, sharedTodayRows]);

  const groupedFeed = useMemo<FeedRouteGroup[]>(() => {
    const routeMap = new Map<string, { rota: string; filiais: Map<string, FeedFilialGroup> }>();

    for (const row of visibleRows) {
      const rota = buildRouteKey(row.rota);
      const routeEntry = routeMap.get(rota) ?? { rota, filiais: new Map<string, FeedFilialGroup>() };
      const filialKey = buildStoreKey(rota, row.filial, row.filial_nome);
      const filialEntry = routeEntry.filiais.get(filialKey) ?? {
        key: filialKey,
        filial: row.filial,
        filial_nome: row.filial_nome,
        rows: []
      };
      filialEntry.rows.push(row);
      routeEntry.filiais.set(filialKey, filialEntry);
      routeMap.set(rota, routeEntry);
    }

    return Array.from(routeMap.values())
      .map((route) => {
        const filiais = Array.from(route.filiais.values())
          .map((filial) => ({
            ...filial,
            rows: sortRows(filial.rows)
          }))
          .sort((a, b) => {
            if (a.filial !== b.filial) return a.filial - b.filial;
            return (a.filial_nome ?? "").localeCompare(b.filial_nome ?? "", "pt-BR");
          });

        return {
          key: route.rota,
          rota: route.rota,
          rowsCount: filiais.reduce((sum, item) => sum + item.rows.length, 0),
          filiais
        };
      })
      .sort((a, b) => a.rota.localeCompare(b.rota, "pt-BR", { sensitivity: "base" }));
  }, [visibleRows]);

  useEffect(() => {
    if (!expandedRowId) return;
    if (!visibleRows.some((row) => row.local_id === expandedRowId)) {
      setExpandedRowId(null);
    }
  }, [expandedRowId, visibleRows]);

  useEffect(() => {
    if (!editingRowId) return;
    if (!visibleRows.some((row) => row.local_id === editingRowId)) {
      setEditingRowId(null);
      setEditDraft(null);
    }
  }, [editingRowId, visibleRows]);

  const filteredOccurrences = useMemo(() => {
    const query = normalizeSearchText(occurrenceSearch);
    if (!query) return AUDITORIA_CAIXA_OCCURRENCIAS;
    return AUDITORIA_CAIXA_OCCURRENCIAS.filter((item) => normalizeSearchText(item).includes(query));
  }, [occurrenceSearch]);

  const refreshLocalState = useCallback(async () => {
    const nextRows = await getUserAuditoriaCaixaRows(profile.user_id);
    const nextPending = nextRows.reduce((count, row) => (
      PENDING_SYNC_STATUSES.has(row.sync_status) ? count + 1 : count
    ), 0);
    setLocalRows(nextRows);
    setPendingCount(nextPending);

    if (currentCd == null) {
      setDbRotasCount(0);
      setDbRotasLastSyncAt(null);
      return;
    }

    const nextMeta = await getDbRotasMeta(profile.user_id, currentCd);
    setDbRotasCount(nextMeta.row_count);
    setDbRotasLastSyncAt(nextMeta.last_sync_at);
  }, [currentCd, profile.user_id]);

  const refreshSharedState = useCallback(async () => {
    if (!isOnline || currentCd == null) return;
    try {
      const rows = await fetchTodaySharedAuditoriaCaixaRows(currentCd);
      setSharedTodayRows(rows);
    } catch {
      // Mantém o feed atual se a consulta falhar.
    }
  }, [currentCd, isOnline]);

  const focusEtiqueta = useCallback(() => {
    disableEtiquetaSoftKeyboard();
    window.requestAnimationFrame(() => {
      etiquetaRef.current?.focus();
    });
  }, [disableEtiquetaSoftKeyboard]);

  const buildKnownRows = useCallback((): AuditoriaCaixaRow[] => {
    if (currentCd == null) return [];
    return [
      ...localRows.filter((row) => row.cd === currentCd),
      ...sharedTodayRows.filter((row) => row.cd === currentCd)
    ];
  }, [currentCd, localRows, sharedTodayRows]);

  const getDuplicateError = useCallback((params: {
    etiqueta: string;
    idKnapp: string | null;
    length: number;
    ignoreLocalId?: string | null;
  }): string | null => {
    const knownRows = buildKnownRows()
      .filter((row) => row.local_id !== params.ignoreLocalId)
      .filter((row) => row.etiqueta === params.etiqueta);

    if (params.length === 17 || params.length === 18) {
      if (knownRows.length > 0 && !params.idKnapp) {
        return "Esta etiqueta já existe no feed conhecido. Informe o ID knapp para continuar.";
      }

      if (params.idKnapp && knownRows.some((row) => (row.id_knapp ?? "") === params.idKnapp)) {
        return "Esta etiqueta com o mesmo ID knapp já foi informada.";
      }

      return null;
    }

    if (knownRows.length > 0) {
      return "Esta etiqueta já foi informada.";
    }

    return null;
  }, [buildKnownRows]);

  const resolveRouteData = useCallback(async (filial: number, fallback?: AuditoriaCaixaRow | null) => {
    if (currentCd == null) {
      return {
        rota: fallback?.rota ?? "Sem rota",
        filial_nome: fallback?.filial_nome ?? null,
        uf: fallback?.uf ?? null
      };
    }

    const cached = await getDbRotasByFilial(profile.user_id, currentCd, filial);
    return {
      rota: cached?.rota ?? fallback?.rota ?? "Sem rota",
      filial_nome: cached?.nome ?? fallback?.filial_nome ?? null,
      uf: cached?.uf ?? fallback?.uf ?? null
    };
  }, [currentCd, profile.user_id]);

  const clearForm = useCallback(() => {
    setEtiquetaInput("");
    setIdKnappInput("");
    setOcorrenciaInput("");
  }, []);

  const runDbRotasRefresh = useCallback(async (showMessages = true) => {
    if (!isOnline || currentCd == null) return;
    const nowMs = Date.now();
    if (!showMessages && nowMs - lastRouteRefreshAtRef.current < ROUTE_CACHE_REFRESH_COOLDOWN_MS) {
      return;
    }
    lastRouteRefreshAtRef.current = nowMs;
    setBusyRefresh(true);
    if (showMessages) {
      setProgressMessage("Atualizando base local de rotas...");
      setStatusMessage(null);
      setErrorMessage(null);
    }

    try {
      const result = await refreshDbRotasCache(profile.user_id, currentCd, (progress) => {
        if (!showMessages) return;
        setProgressMessage(
          `Atualizando rotas... ${progress.percent}% (${progress.rowsFetched}/${Math.max(progress.totalRows, progress.rowsFetched)})`
        );
      });
      await refreshLocalState();
      if (showMessages) {
        setStatusMessage(`Base local de rotas atualizada (${result.rows} filiais).`);
      }
    } catch (error) {
      if (showMessages) {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao atualizar base local de rotas.");
      }
    } finally {
      setBusyRefresh(false);
      setProgressMessage(null);
    }
  }, [currentCd, isOnline, profile.user_id, refreshLocalState]);

  const runSync = useCallback(async (quiet = false) => {
    if (!isOnline || busySync) return;
    setBusySync(true);
    if (!quiet) {
      setErrorMessage(null);
      setStatusMessage(null);
    }

    try {
      const result = await syncPendingAuditoriaCaixaRows(profile.user_id);
      await refreshLocalState();
      await refreshSharedState();

      if (!quiet) {
        if (result.discarded > 0) {
          setStatusMessage(`${result.synced} sincronizadas e ${result.discarded} descartadas por duplicidade.`);
        } else if (result.failed > 0) {
          setStatusMessage(`${result.synced} sincronizadas e ${result.failed} com erro.`);
        } else if (result.processed > 0) {
          setStatusMessage(`${result.synced} pendências sincronizadas com sucesso.`);
        }
      } else if (result.discarded > 0) {
        setStatusMessage(
          `${result.discarded} leitura(s) offline foram descartadas porque outra leitura válida chegou primeiro.`
        );
      }
    } catch (error) {
      if (!quiet) {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao sincronizar pendências.");
      }
    } finally {
      setBusySync(false);
    }
  }, [busySync, isOnline, profile.user_id, refreshLocalState, refreshSharedState]);

  const toggleOfflineMode = useCallback(async () => {
    setErrorMessage(null);
    setStatusMessage(null);

    if (isDesktop) {
      setPreferOfflineMode(false);
      setStatusMessage("No desktop a auditoria de caixa funciona somente online.");
      return;
    }

    if (preferOfflineMode) {
      setPreferOfflineMode(false);
      setStatusMessage("Modo online ativado.");
      return;
    }

    if (!isOnline && dbRotasCount <= 0) {
      setErrorMessage("Sem base local de rotas. Conecte-se para atualizar antes de trabalhar offline.");
      return;
    }

    setPreferOfflineMode(true);
    if (dbRotasCount > 0) {
      setStatusMessage("Modo offline local ativado.");
      return;
    }

    setStatusMessage("Modo offline local ativado. Atualizando base de rotas para uso sem internet.");
    await runDbRotasRefresh(true);
  }, [dbRotasCount, isDesktop, isOnline, preferOfflineMode, runDbRotasRefresh]);

  const applyOccurrence = useCallback((value: AuditoriaCaixaOccurrence) => {
    if (!occurrenceModalTarget) return;
    if (occurrenceModalTarget.kind === "form") {
      setOcorrenciaInput((value ?? "") as EditDraft["ocorrencia"]);
    } else {
      setEditDraft((current) => (current ? { ...current, ocorrencia: (value ?? "") as EditDraft["ocorrencia"] } : current));
    }
    setOccurrenceModalTarget(null);
    setOccurrenceSearch("");
  }, [occurrenceModalTarget]);

  const clearScannerInputTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current;
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const handleCollect = useCallback(async (overrideEtiqueta?: string) => {
    if (collectInFlightRef.current) return;
    collectInFlightRef.current = true;
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      if (currentCd == null) {
        setErrorMessage("CD não definido para a auditoria atual.");
        return;
      }

      if (!isOnline && isDesktop) {
        setErrorMessage("Você está sem internet. No desktop a auditoria de caixa funciona somente online.");
        return;
      }

      if (!isOnline && !preferOfflineMode) {
        setErrorMessage("Você está sem internet. Ative Trabalhar offline para continuar.");
        return;
      }

      if (!isOnline && dbRotasCount <= 0) {
        setErrorMessage("Sem base local de rotas. Conecte-se para atualizar antes de trabalhar offline.");
        return;
      }

      const parsed = parseAuditoriaCaixaEtiqueta(overrideEtiqueta ?? etiquetaInput, idKnappInput);
      const duplicateError = getDuplicateError({
        etiqueta: parsed.etiqueta,
        idKnapp: parsed.id_knapp,
        length: parsed.length
      });
      if (duplicateError) {
        setErrorMessage(duplicateError);
        triggerScanErrorAlert(duplicateError);
        return;
      }

      const routeData = await resolveRouteData(parsed.filial, null);
      const nowIso = new Date().toISOString();
      const nextRow: AuditoriaCaixaRow = {
        local_id: safeUuid(),
        remote_id: null,
        user_id: profile.user_id,
        cd: currentCd,
        etiqueta: parsed.etiqueta,
        id_knapp: parsed.id_knapp,
        pedido: parsed.pedido,
        data_pedido: parsed.data_pedido,
        dv: parsed.dv,
        filial: parsed.filial,
        filial_nome: routeData.filial_nome,
        uf: routeData.uf,
        rota: routeData.rota,
        volume: parsed.volume,
        ocorrencia: normalizeOccurrenceInput(ocorrenciaInput),
        mat_aud: profile.mat,
        nome_aud: profile.nome,
        data_hr: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
        sync_status: "pending_insert",
        sync_error: null
      };

      await upsertAuditoriaCaixaRow(nextRow);
      await refreshLocalState();
      setExpandedRowId(nextRow.local_id);
      clearForm();

      if (shouldTriggerQueuedBackgroundSync(isOnline)) {
        const nowMs = Date.now();
        if (nowMs - lastQuickSyncAtRef.current >= QUICK_SYNC_THROTTLE_MS) {
          lastQuickSyncAtRef.current = nowMs;
          void runSync(true);
        }
        setStatusMessage("Etiqueta registrada e enviada para sincronização.");
      } else {
        setStatusMessage("Etiqueta registrada localmente. A pendência será enviada quando houver internet.");
      }

      showScanFeedback("success", `Etiqueta ${parsed.etiqueta}`, `Filial ${parsed.filial}`);
      focusEtiqueta();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao registrar etiqueta.";
      setErrorMessage(message);
      triggerScanErrorAlert(message);
      focusEtiqueta();
    } finally {
      collectInFlightRef.current = false;
    }
  }, [
    clearForm,
    currentCd,
    dbRotasCount,
    etiquetaInput,
    focusEtiqueta,
    getDuplicateError,
    idKnappInput,
    isDesktop,
    isOnline,
    ocorrenciaInput,
    preferOfflineMode,
    profile.mat,
    profile.nome,
    profile.user_id,
    refreshLocalState,
    resolveRouteData,
    runSync,
    showScanFeedback,
    triggerScanErrorAlert
  ]);

  const commitScannerInput = useCallback(async (rawValue: string) => {
    const normalized = normalizeEtiquetaInput(rawValue);
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
    await handleCollect(normalized);
  }, [clearScannerInputTimer, handleCollect]);

  const scheduleScannerInputAutoSubmit = useCallback((value: string) => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current;
    clearScannerInputTimer();
    state.timerId = window.setTimeout(() => {
      state.timerId = null;
      void commitScannerInput(value);
    }, SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS);
  }, [clearScannerInputTimer, commitScannerInput]);

  const saveRowEdit = useCallback(async (row: AuditoriaCaixaRow) => {
    if (!editDraft) return;
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      if (!canOperate) {
        setErrorMessage("Sem conexão ativa para salvar alterações neste momento.");
        return;
      }

      const parsed = parseAuditoriaCaixaEtiqueta(editDraft.etiqueta, editDraft.id_knapp);
      const duplicateError = getDuplicateError({
        etiqueta: parsed.etiqueta,
        idKnapp: parsed.id_knapp,
        length: parsed.length,
        ignoreLocalId: row.local_id
      });
      if (duplicateError) {
        setErrorMessage(duplicateError);
        return;
      }

      const routeData = await resolveRouteData(parsed.filial, row);
      const updatedAt = new Date().toISOString();
      const nextRow: AuditoriaCaixaRow = {
        ...row,
        local_id: toPendingLocalId(row),
        etiqueta: parsed.etiqueta,
        id_knapp: parsed.id_knapp,
        pedido: parsed.pedido,
        data_pedido: parsed.data_pedido,
        dv: parsed.dv,
        filial: parsed.filial,
        filial_nome: routeData.filial_nome,
        uf: routeData.uf,
        rota: routeData.rota,
        volume: parsed.volume,
        ocorrencia: normalizeOccurrenceInput(editDraft.ocorrencia),
        updated_at: updatedAt,
        sync_status: row.remote_id ? "pending_update" : "pending_insert",
        sync_error: null
      };

      if (nextRow.local_id !== row.local_id) {
        await removeAuditoriaCaixaRow(row.local_id);
      }
      await upsertAuditoriaCaixaRow(nextRow);
      await refreshLocalState();
      setEditingRowId(null);
      setEditDraft(null);
      setExpandedRowId(nextRow.local_id);
      setStatusMessage("Alterações salvas localmente.");

      if (shouldTriggerQueuedBackgroundSync(isOnline)) {
        void runSync(true);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar alterações.");
    }
  }, [canOperate, editDraft, getDuplicateError, isOnline, refreshLocalState, resolveRouteData, runSync]);

  const confirmDeleteRow = useCallback(async () => {
    if (!deleteTarget) return;

    const target = deleteTarget;
    setDeleteTarget(null);
    setExpandedRowId((current) => (current === target.local_id ? null : current));
    setEditingRowId((current) => (current === target.local_id ? null : current));
    setEditDraft(null);

    if (!target.remote_id) {
      await removeAuditoriaCaixaRow(target.local_id);
      await refreshLocalState();
      setStatusMessage("Registro removido localmente.");
      return;
    }

    if (!canOperate) {
      setErrorMessage("Sem conexão ativa para excluir este registro agora.");
      return;
    }

    await upsertAuditoriaCaixaRow({
      ...target,
      local_id: toPendingLocalId(target),
      sync_status: "pending_delete",
      sync_error: null,
      updated_at: new Date().toISOString()
    });
    if (target.local_id !== toPendingLocalId(target)) {
      await removeAuditoriaCaixaRow(target.local_id);
    }
    await refreshLocalState();
    setStatusMessage("Registro marcado para exclusão.");

    if (shouldTriggerQueuedBackgroundSync(isOnline)) {
      void runSync(true);
    }
  }, [canOperate, deleteTarget, isOnline, refreshLocalState, runSync]);

  const runReportSearch = useCallback(async () => {
    if (!canSeeReportTools) return;
    setReportError(null);
    setReportMessage(null);
    setReportCount(null);

    if (!reportDtIni || !reportDtFim) {
      setReportError("Informe data inicial e final.");
      return;
    }

    const dtIni = new Date(reportDtIni);
    const dtFim = new Date(reportDtFim);
    if (Number.isNaN(dtIni.getTime()) || Number.isNaN(dtFim.getTime())) {
      setReportError("Período inválido.");
      return;
    }
    if (dtFim < dtIni) {
      setReportError("A data final não pode ser menor que a data inicial.");
      return;
    }

    const parsedCd = reportCd ? Number.parseInt(reportCd, 10) : Number.NaN;
    const filters: AuditoriaCaixaReportFilters = {
      dtIni: reportDtIni,
      dtFim: reportDtFim,
      cd: Number.isFinite(parsedCd) ? parsedCd : null
    };

    setReportBusySearch(true);
    try {
      const count = await countAuditoriaCaixaReportRows(filters);
      setReportCount(count);
      setReportMessage(count > 0 ? `Foram encontradas ${count} auditorias no período.` : "Nenhuma auditoria encontrada no período informado.");
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Falha ao buscar auditorias para relatório.");
    } finally {
      setReportBusySearch(false);
    }
  }, [canSeeReportTools, reportCd, reportDtFim, reportDtIni]);

  const runReportExport = useCallback(async () => {
    if (!canSeeReportTools || !reportCount || reportCount <= 0) return;
    setReportError(null);
    setReportBusyExport(true);

    try {
      const parsedCd = reportCd ? Number.parseInt(reportCd, 10) : Number.NaN;
      const filters: AuditoriaCaixaReportFilters = {
        dtIni: reportDtIni,
        dtFim: reportDtFim,
        cd: Number.isFinite(parsedCd) ? parsedCd : null
      };

      const rows = await fetchAuditoriaCaixaReportRows(filters, 50000);
      if (rows.length === 0) {
        setReportMessage("Nenhuma auditoria disponível para exportação.");
        return;
      }

      const XLSX = await import("xlsx");
      const exportRows = rows.map((row) => ({
        "Data/Hora": formatDateTime(row.data_hr),
        CD: row.cd,
        Etiqueta: row.etiqueta,
        "Id knapp": row.id_knapp ?? "",
        Pedido: row.pedido,
        "Data do pedido": formatDateOnlyPtBR(row.data_pedido),
        DV: row.dv ?? "",
        Filial: row.filial,
        "Filial nome": row.filial_nome ?? "",
        UF: row.uf ?? "",
        Rota: row.rota ?? "Sem rota",
        Volume: row.volume ?? "",
        Ocorrência: row.ocorrencia ?? "",
        "Matrícula auditor": row.mat_aud,
        "Nome auditor": row.nome_aud
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "AuditoriaCaixa");
      const suffix = filters.cd == null ? "todos-cds" : `cd-${filters.cd}`;
      XLSX.writeFile(workbook, `relatorio-auditoria-caixa-${reportDtIni}-${reportDtFim}-${suffix}.xlsx`, { compression: true });
      setReportMessage(`Relatório gerado com sucesso (${rows.length} linhas).`);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Falha ao gerar relatório Excel.");
    } finally {
      setReportBusyExport(false);
    }
  }, [canSeeReportTools, reportCd, reportCount, reportDtFim, reportDtIni]);

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
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const prefs = await getAuditoriaCaixaPreferences(profile.user_id);
        if (cancelled) return;

        if (isOnline) {
          try {
            const nextCdOptions = await fetchCdOptions();
            if (!cancelled) setCdOptions(nextCdOptions);
          } catch {
            if (!cancelled) setCdOptions([]);
          }
        } else {
          setCdOptions([]);
        }

        setPreferOfflineMode(isDesktop ? false : prefs.prefer_offline_mode);
        setCdAtivo((isGlobalAdmin ? prefs.cd_ativo : fixedCd) ?? fixedCd ?? null);
        await cleanupExpiredAuditoriaCaixaRows(profile.user_id, ONE_DAY_MS);
        if (!cancelled) {
          setPreferencesReady(true);
          setRefreshNonce((value) => value + 1);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar o módulo Auditoria de Caixa.");
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [fixedCd, isDesktop, isGlobalAdmin, isOnline, profile.user_id]);

  useEffect(() => {
    void refreshLocalState();
  }, [refreshLocalState, refreshNonce]);

  useEffect(() => {
    void refreshSharedState();
  }, [refreshSharedState, refreshNonce]);

  useEffect(() => {
    if (!preferencesReady || currentCd == null || !isOnline) return;
    void runDbRotasRefresh(false);
  }, [currentCd, isOnline, preferencesReady, runDbRotasRefresh]);

  useEffect(() => {
    if (!preferencesReady) return;
    const payloadCd = isGlobalAdmin ? cdAtivo : fixedCd;
    void saveAuditoriaCaixaPreferences(profile.user_id, {
      cd_ativo: payloadCd,
      prefer_offline_mode: preferOfflineMode
    });
  }, [cdAtivo, fixedCd, isGlobalAdmin, preferOfflineMode, preferencesReady, profile.user_id]);

  useEffect(() => {
    if (!isDesktop || !preferOfflineMode) return;
    setPreferOfflineMode(false);
    setStatusMessage("Modo online ativado no desktop.");
  }, [isDesktop, preferOfflineMode]);

  useEffect(() => {
    if (!isOnline || pendingCount <= 0) return;
    const intervalId = window.setInterval(() => {
      void runSync(true);
    }, 15_000);

    void runSync(true);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isOnline, pendingCount, runSync]);

  useEffect(() => {
    if (!showReport) return;
    const baseCd = isGlobalAdmin ? currentCd : fixedCd;
    setReportCd(baseCd != null ? String(baseCd) : "");
  }, [currentCd, fixedCd, isGlobalAdmin, showReport]);

  useEffect(() => {
    focusEtiqueta();
  }, [focusEtiqueta]);

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

  const onEtiquetaInputChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
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
      clearScannerInputTimer();
      return;
    }

    if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) {
      scheduleScannerInputAutoSubmit(nextValue);
      return;
    }

    clearScannerInputTimer();
  };

  const shouldHandleScannerTab = (value: string): boolean => {
    if (!value.trim()) return false;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const state = scannerInputStateRef.current;
    if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) return true;
    if (state.lastInputAt <= 0) return false;
    return now - state.lastInputAt <= SCANNER_INPUT_MAX_INTERVAL_MS * 2;
  };

  const onEtiquetaKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !shouldHandleScannerTab(etiquetaInput)) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    void commitScannerInput(etiquetaInput);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void commitScannerInput(etiquetaInput);
  };

  const occurrenceModalValue = occurrenceModalTarget?.kind === "form"
    ? normalizeOccurrenceInput(ocorrenciaInput)
    : normalizeOccurrenceInput(editDraft?.ocorrencia ?? "");

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
            <PendingSyncBadge pendingCount={pendingCount} title="Etiquetas pendentes de envio" />
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

      <section className="modules-shell coleta-shell aud-caixa-shell">
        <div className="coleta-head">
          <h2>Olá, {displayUserName}</h2>
          <p>Bipe a etiqueta de volume e acompanhe o feed do dia agrupado por rota e filial.</p>
          <p className="coleta-meta-line">
            CD atual: <strong>{cdCodeLabel(currentCd)}</strong>
            {" | "}Base local de rotas: <strong>{dbRotasCount}</strong> filiais
            {dbRotasLastSyncAt ? ` | Atualizada em ${formatDateTime(dbRotasLastSyncAt)}` : " | Sem atualização ainda"}
          </p>
        </div>

        {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
        {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
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

        {preferOfflineMode ? (
          <div className="alert success">
            Modo offline ativo: as etiquetas ficam locais até a sincronização.
          </div>
        ) : null}

        {preferOfflineMode && dbRotasCount <= 0 ? (
          isOnline ? (
            <div className="alert success">
              Modo offline ativo sem base local completa. Atualize as rotas antes de ficar sem internet.
            </div>
          ) : (
            <div className="alert error">
              Modo offline ativo sem base local. Conecte-se para carregar as rotas do CD.
            </div>
          )
        ) : null}

        {!preferOfflineMode && !isOnline ? (
          <div className="alert error">
            {isDesktop
              ? "Você está sem internet. No desktop a auditoria de caixa funciona somente online."
              : "Você está sem internet. Para continuar auditando, ative Trabalhar offline."}
          </div>
        ) : null}

        <div className="coleta-actions-row">
          {!isDesktop ? (
            <button
              type="button"
              className={`btn btn-muted coleta-offline-toggle${preferOfflineMode ? " is-active" : ""}`}
              onClick={() => void toggleOfflineMode()}
              disabled={busyRefresh}
              title={preferOfflineMode ? "Desativar modo offline local" : "Ativar modo offline local"}
            >
              <span aria-hidden="true"><OfflineModeIcon enabled={!preferOfflineMode} /></span>
              {busyRefresh ? "Carregando base..." : preferOfflineMode ? "Offline local" : "Trabalhar offline"}
            </button>
          ) : null}

          <button
            type="button"
            className="btn btn-muted"
            onClick={() => void refreshSharedState()}
            disabled={!isOnline || currentCd == null}
          >
            Atualizar feed do dia
          </button>

          <button
            type="button"
            className="btn btn-muted coleta-sync-btn"
            onClick={() => void runDbRotasRefresh(true)}
            disabled={!isOnline || currentCd == null || busyRefresh}
          >
            <span aria-hidden="true"><SyncIcon /></span>
            {busyRefresh ? "Atualizando rotas..." : "Atualizar rotas"}
          </button>

          <button
            type="button"
            className="btn btn-primary coleta-sync-btn"
            onClick={() => void runSync(false)}
            disabled={!isOnline || busySync || pendingCount <= 0}
          >
            <span aria-hidden="true"><SyncIcon /></span>
            {busySync ? "Sincronizando..." : "Sincronizar agora"}
          </button>

          {canSeeReportTools ? (
            <button
              type="button"
              className={`btn btn-muted coleta-report-toggle${showReport ? " is-active" : ""}`}
              aria-pressed={showReport}
              onClick={() => {
                setShowReport((value) => {
                  const next = !value;
                  if (next) {
                    const today = todayIsoBrasilia();
                    setReportDtIni(today);
                    setReportDtFim(today);
                  }
                  return next;
                });
                setReportError(null);
                setReportMessage(null);
                setReportCount(null);
              }}
              title="Buscar auditorias para relatório"
            >
              <span className="coleta-report-toggle-icon" aria-hidden="true"><SearchIcon /></span>
              Buscar auditorias
            </button>
          ) : null}
        </div>

        {showReport && canSeeReportTools ? (
          <section className="coleta-report-panel">
            <div className="coleta-report-head">
              <h3>Relatório de Auditoria de Caixa (Admin)</h3>
              <p>Consulte o período e exporte os dados da coleta com ocorrência quando houver.</p>
            </div>

            {reportError ? <div className="alert error">{reportError}</div> : null}
            {reportMessage ? <div className="alert success">{reportMessage}</div> : null}

            <div className="coleta-report-grid">
              <label>
                Data inicial
                <input
                  type="date"
                  autoComplete="off"
                  value={reportDtIni}
                  onChange={(event) => setReportDtIni(event.target.value)}
                  required
                />
              </label>

              <label>
                Data final
                <input
                  type="date"
                  autoComplete="off"
                  value={reportDtFim}
                  onChange={(event) => setReportDtFim(event.target.value)}
                  required
                />
              </label>

              {isGlobalAdmin ? (
                <label>
                  CD
                  <select value={reportCd} onChange={(event) => setReportCd(event.target.value)}>
                    <option value="">Todos CDs permitidos</option>
                    {cdOptions.map((option) => (
                      <option key={option.cd} value={option.cd}>
                        {cdCodeLabel(option.cd)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  CD
                  <input
                    type="text"
                    value={fixedCd != null ? `CD ${String(fixedCd).padStart(2, "0")}` : "CD não definido"}
                    disabled
                  />
                </label>
              )}
            </div>

            <div className="coleta-report-actions">
              <button type="button" className="btn btn-muted" onClick={() => void runReportSearch()} disabled={reportBusySearch}>
                {reportBusySearch ? "Buscando..." : "Buscar no período"}
              </button>
              <button
                type="button"
                className="btn btn-primary coleta-export-btn"
                onClick={() => void runReportExport()}
                disabled={reportBusyExport || (reportCount ?? 0) <= 0}
              >
                <span aria-hidden="true"><FileIcon /></span>
                {reportBusyExport ? "Gerando Excel..." : "Gerar relatório Excel"}
              </button>
            </div>

            {reportCount != null ? <p className="coleta-report-count">Registros encontrados: {reportCount}</p> : null}
          </section>
        ) : null}
        <form className="coleta-form aud-caixa-form" onSubmit={onSubmit}>
          <div className="coleta-form-grid aud-caixa-form-grid">
            <label>
              Etiqueta de volume
              <div className="input-icon-wrap">
                <span className="field-icon" aria-hidden="true">
                  <TagIcon />
                </span>
                <input
                  ref={etiquetaRef}
                  type="text"
                  inputMode={etiquetaInputMode}
                  value={etiquetaInput}
                  onChange={onEtiquetaInputChange}
                  onFocus={enableEtiquetaSoftKeyboard}
                  onPointerDown={enableEtiquetaSoftKeyboard}
                  onBlur={disableEtiquetaSoftKeyboard}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  onKeyDown={onEtiquetaKeyDown}
                  placeholder="Bipe a etiqueta e pressione Enter"
                  required
                />
              </div>
            </label>

            {etiquetaRequiresKnapp ? (
              <label>
                ID knapp
                <div className="input-icon-wrap">
                  <span className="field-icon" aria-hidden="true">
                    <TagIcon />
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    value={idKnappInput}
                    onChange={(event) => setIdKnappInput(event.target.value.replace(/\D/g, "").slice(0, 8))}
                    placeholder="8 dígitos"
                    maxLength={8}
                  />
                </div>
              </label>
            ) : null}

            {isGlobalAdmin ? (
              <label>
                Depósito
                <select
                  value={cdAtivo ?? ""}
                  onChange={(event) => setCdAtivo(event.target.value ? Number.parseInt(event.target.value, 10) : null)}
                  required
                >
                  <option value="" disabled>Selecione o CD</option>
                  {cdOptions.map((option) => (
                    <option key={option.cd} value={option.cd}>
                      {cdCodeLabel(option.cd)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="aud-caixa-occurrence-field">
              <span>Ocorrência</span>
              <button
                type="button"
                className={`aud-caixa-occurrence-btn${ocorrenciaInput ? " is-filled" : ""}`}
                onClick={() => {
                  setOccurrenceSearch("");
                  setOccurrenceModalTarget({ kind: "form" });
                }}
              >
                <span className="aud-caixa-occurrence-btn-icon" aria-hidden="true">
                  <TagIcon />
                </span>
                <span>{ocorrenciaInput || "Sem ocorrência"}</span>
              </button>
            </label>
          </div>

          <p className="aud-caixa-hint">
            {etiquetaRequiresKnapp
              ? "Para etiquetas com 17 ou 18 caracteres repetidas, informe o ID knapp com 8 dígitos."
              : "Ocorrência é opcional. Filial e volume são gravados sem zeros à esquerda."}
          </p>

          <button className="btn btn-primary coleta-submit" type="submit" disabled={currentCd == null || !canOperate}>
            Salvar auditoria
          </button>
        </form>

        <div className="coleta-list-head">
          <h3>Feed de hoje</h3>
          <span>{visibleRows.length} etiquetas</span>
        </div>

        <div className="aud-caixa-feed">
          {groupedFeed.length === 0 ? (
            <div className="coleta-empty">Nenhuma etiqueta registrada hoje para este CD.</div>
          ) : (
            groupedFeed.map((routeGroup) => (
              <section key={routeGroup.key} className="aud-caixa-route-group">
                <header className="aud-caixa-route-head">
                  <div>
                    <strong>{routeGroup.rota}</strong>
                    <span>{routeGroup.rowsCount} etiqueta(s) no feed</span>
                  </div>
                </header>

                <div className="aud-caixa-route-body">
                  {routeGroup.filiais.map((filialGroup) => (
                    <div key={filialGroup.key} className="aud-caixa-store-group">
                      <div className="aud-caixa-store-head">
                        <strong>
                          Filial {filialGroup.filial}
                          {filialGroup.filial_nome ? ` - ${filialGroup.filial_nome}` : ""}
                        </strong>
                        <span>{filialGroup.rows.length} etiqueta(s)</span>
                      </div>

                      <div className="coleta-list">
                        {filialGroup.rows.map((row) => {
                          const canManageRow = canManageAuditoriaCaixaRow(profile, row);
                          const isExpanded = expandedRowId === row.local_id;
                          const isEditing = canManageRow && editingRowId === row.local_id && editDraft != null;
                          let parsedPreview: ReturnType<typeof parseAuditoriaCaixaEtiqueta> | null = null;
                          let previewError: string | null = null;

                          if (isEditing && editDraft) {
                            try {
                              parsedPreview = parseAuditoriaCaixaEtiqueta(editDraft.etiqueta, editDraft.id_knapp);
                            } catch (error) {
                              previewError = error instanceof Error ? error.message : "Falha ao interpretar a etiqueta.";
                            }
                          }

                          return (
                            <article key={row.local_id} className={`coleta-row-card${isExpanded ? " is-expanded" : ""}`}>
                              <button
                                type="button"
                                className="coleta-row-line"
                                onClick={() => {
                                  setExpandedRowId((current) => {
                                    const next = current === row.local_id ? null : row.local_id;
                                    if (next !== row.local_id) {
                                      setEditingRowId(null);
                                      setEditDraft(null);
                                    }
                                    return next;
                                  });
                                }}
                              >
                                <div className="coleta-row-line-main">
                                  <strong>{row.etiqueta}</strong>
                                  <p>Pedido {row.pedido} | DV {row.dv ?? "-"}</p>
                                  <p>Volume {row.volume ?? "-"} | Coletado em {formatDateTime(row.data_hr)}</p>
                                  {row.ocorrencia ? <p>Ocorrência: {row.ocorrencia}</p> : null}
                                </div>

                                <div className="coleta-row-line-right">
                                  <span className={`coleta-row-status ${asStatusClass(row.sync_status)}`} title={row.sync_error ?? undefined}>
                                    {asStatusLabel(row.sync_status)}
                                  </span>
                                  <span className="coleta-row-expand" aria-hidden="true">
                                    <ChevronIcon open={isExpanded} />
                                  </span>
                                </div>
                              </button>

                              {isExpanded ? (
                                <div className="coleta-row-edit-card">
                                  {isEditing && editDraft ? (
                                    <>
                                      <div className="coleta-row-edit-grid aud-caixa-row-edit-grid">
                                        <label>
                                          Etiqueta
                                          <input
                                            type="text"
                                            value={editDraft.etiqueta}
                                            onChange={(event) => {
                                              const value = event.target.value;
                                              setEditDraft((current) => (current ? { ...current, etiqueta: value } : current));
                                            }}
                                          />
                                        </label>

                                        {requiresKnappId(editDraft.etiqueta) || Boolean(editDraft.id_knapp.trim()) ? (
                                          <label>
                                            ID knapp
                                            <input
                                              type="text"
                                              inputMode="numeric"
                                              pattern="[0-9]*"
                                              value={editDraft.id_knapp}
                                              onChange={(event) => {
                                                const value = event.target.value.replace(/\D/g, "").slice(0, 8);
                                                setEditDraft((current) => (current ? { ...current, id_knapp: value } : current));
                                              }}
                                              maxLength={8}
                                            />
                                          </label>
                                        ) : null}

                                        <label className="aud-caixa-occurrence-field aud-caixa-occurrence-field--edit">
                                          <span>Ocorrência</span>
                                          <button
                                            type="button"
                                            className={`aud-caixa-occurrence-btn${editDraft.ocorrencia ? " is-filled" : ""}`}
                                            onClick={() => {
                                              setOccurrenceSearch("");
                                              setOccurrenceModalTarget({ kind: "edit", rowId: row.local_id });
                                            }}
                                          >
                                            <span className="aud-caixa-occurrence-btn-icon" aria-hidden="true">
                                              <TagIcon />
                                            </span>
                                            <span>{editDraft.ocorrencia || "Sem ocorrência"}</span>
                                          </button>
                                        </label>
                                      </div>

                                      {previewError ? <div className="alert error">{previewError}</div> : null}

                                      <div className="coleta-row-detail-grid">
                                        <div className="coleta-row-detail">
                                          <span>Pedido</span>
                                          <strong>{parsedPreview?.pedido ?? row.pedido}</strong>
                                        </div>
                                        <div className="coleta-row-detail">
                                          <span>Filial</span>
                                          <strong>{parsedPreview?.filial ?? row.filial}</strong>
                                        </div>
                                        <div className="coleta-row-detail">
                                          <span>Volume</span>
                                          <strong>{parsedPreview?.volume ?? row.volume ?? "-"}</strong>
                                        </div>
                                        <div className="coleta-row-detail">
                                          <span>Rota</span>
                                          <strong>{row.rota ?? "Sem rota"}</strong>
                                        </div>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="coleta-row-detail-grid">
                                      <div className="coleta-row-detail">
                                        <span>Pedido</span>
                                        <strong>{row.pedido}</strong>
                                      </div>
                                      <div className="coleta-row-detail">
                                        <span>Data do pedido</span>
                                        <strong>{formatDateOnlyPtBR(row.data_pedido)}</strong>
                                      </div>
                                      <div className="coleta-row-detail">
                                        <span>DV</span>
                                        <strong>{row.dv ?? "-"}</strong>
                                      </div>
                                      <div className="coleta-row-detail">
                                        <span>Filial</span>
                                        <strong>{row.filial}</strong>
                                      </div>
                                      <div className="coleta-row-detail">
                                        <span>Volume</span>
                                        <strong>{row.volume ?? "-"}</strong>
                                      </div>
                                      <div className="coleta-row-detail">
                                        <span>Rota</span>
                                        <strong>{row.rota ?? "Sem rota"}</strong>
                                      </div>
                                      <div className="coleta-row-detail">
                                        <span>Ocorrência</span>
                                        <strong>{row.ocorrencia ?? "-"}</strong>
                                      </div>
                                      <div className="coleta-row-detail">
                                        <span>ID knapp</span>
                                        <strong>{row.id_knapp ?? "-"}</strong>
                                      </div>
                                    </div>
                                  )}

                                  {row.sync_error ? <div className="alert error">{row.sync_error}</div> : null}

                                  <div className="coleta-row-footer">
                                    <span>
                                      Auditor: {toDisplayName(row.nome_aud)} ({row.mat_aud}) | {formatDateTime(row.updated_at)}
                                    </span>
                                    {canManageRow ? (
                                      isEditing && editDraft ? (
                                        <div className="coleta-row-footer-actions">
                                          <button
                                            className="btn btn-muted"
                                            type="button"
                                            onClick={() => {
                                              setEditingRowId(null);
                                              setEditDraft(null);
                                              setOccurrenceModalTarget((current) => (
                                                current?.kind === "edit" && current.rowId === row.local_id ? null : current
                                              ));
                                              setOccurrenceSearch("");
                                            }}
                                          >
                                            Cancelar
                                          </button>
                                          <button
                                            className="btn btn-primary"
                                            type="button"
                                            onClick={() => void saveRowEdit(row)}
                                            disabled={!canOperate}
                                          >
                                            Salvar alterações
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="coleta-row-footer-actions">
                                          <button
                                            className="btn btn-muted"
                                            type="button"
                                            onClick={() => {
                                              setEditingRowId(row.local_id);
                                              setEditDraft(buildEditDraft(row));
                                              setExpandedRowId(row.local_id);
                                            }}
                                          >
                                            Editar
                                          </button>
                                          <button
                                            className="btn btn-muted coleta-delete-btn"
                                            type="button"
                                            onClick={() => setDeleteTarget(row)}
                                            disabled={!canOperate && Boolean(row.remote_id)}
                                          >
                                            <span aria-hidden="true"><TrashIcon /></span>
                                            Excluir
                                          </button>
                                        </div>
                                      )
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
        {occurrenceModalTarget && typeof document !== "undefined"
          ? createPortal(
              <div
                className="confirm-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="aud-caixa-occurrence-title"
                onClick={() => {
                  setOccurrenceModalTarget(null);
                  setOccurrenceSearch("");
                }}
              >
                <div className="confirm-dialog aud-caixa-occurrence-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                  <div className="aud-caixa-occurrence-dialog-head">
                    <h3 id="aud-caixa-occurrence-title">Selecione o tipo de não conformidade</h3>
                    <p>Escolha uma ocorrência ou finalize sem selecionar para manter o campo vazio.</p>
                  </div>

                  <div className="input-icon-wrap aud-caixa-occurrence-search">
                    <span className="field-icon" aria-hidden="true">
                      <SearchIcon />
                    </span>
                    <input
                      type="text"
                      value={occurrenceSearch}
                      onChange={(event) => setOccurrenceSearch(event.target.value)}
                      placeholder="Pesquisar"
                      autoFocus
                    />
                  </div>

                  <div className="aud-caixa-occurrence-list" role="listbox" aria-label="Ocorrências disponíveis">
                    <button
                      type="button"
                      className={`aud-caixa-occurrence-option${occurrenceModalValue == null ? " is-active" : ""}`}
                      onClick={() => applyOccurrence(null)}
                    >
                      <span className="aud-caixa-occurrence-check" aria-hidden="true" />
                      <span>Sem ocorrência</span>
                    </button>

                    {filteredOccurrences.length > 0 ? (
                      filteredOccurrences.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className={`aud-caixa-occurrence-option${occurrenceModalValue === item ? " is-active" : ""}`}
                          onClick={() => applyOccurrence(item)}
                        >
                          <span className="aud-caixa-occurrence-check" aria-hidden="true" />
                          <span>{item}</span>
                        </button>
                      ))
                    ) : (
                      <div className="coleta-empty">Nenhuma ocorrência encontrada para a busca informada.</div>
                    )}
                  </div>

                  <div className="confirm-actions aud-caixa-occurrence-actions">
                    <button className="btn btn-muted" type="button" onClick={() => applyOccurrence(null)}>
                      Limpar
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => {
                        setOccurrenceModalTarget(null);
                        setOccurrenceSearch("");
                      }}
                    >
                      Feito
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}

        {deleteTarget && typeof document !== "undefined"
          ? createPortal(
              <div
                className="confirm-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="aud-caixa-delete-title"
                onClick={() => setDeleteTarget(null)}
              >
                <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                  <h3 id="aud-caixa-delete-title">Excluir etiqueta do feed</h3>
                  <p>Deseja excluir a etiqueta {deleteTarget.etiqueta} da auditoria de hoje?</p>
                  <div className="confirm-actions">
                    <button className="btn btn-muted" type="button" onClick={() => setDeleteTarget(null)}>
                      Cancelar
                    </button>
                    <button className="btn btn-danger" type="button" onClick={() => void confirmDeleteRow()}>
                      Excluir
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}
      </section>
    </>
  );
}
