import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import {
  cleanupExpiredColetaRows,
  countPendingRows,
  getColetaPreferences,
  getDbBarrasByBarcode,
  getDbBarrasMeta,
  getUserColetaRows,
  removeColetaRow,
  saveColetaPreferences,
  upsertDbBarrasCacheRow,
  upsertColetaRow
} from "./storage";
import {
  countColetaReportRows,
  fetchDbBarrasByBarcodeOnline,
  fetchCdOptions,
  fetchColetaReportRows,
  fetchTodaySharedColetaRows,
  formatValidade,
  normalizeBarcode,
  normalizeValidadeInput,
  refreshDbBarrasCache,
  syncPendingColetaRows
} from "./sync";
import type {
  CdOption,
  ColetaModuleProfile,
  ColetaReportFilters,
  ColetaRow
} from "./types";

interface ColetaMercadoriaPageProps {
  isOnline: boolean;
  profile: ColetaModuleProfile;
}

const MODULE_DEF = getModuleByKeyOrThrow("coleta-mercadoria");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isWithinAge(value: string | null, maxAgeMs: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed <= maxAgeMs;
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

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function formatDateTime(value: string): string {
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

function asStatusLabel(status: ColetaRow["sync_status"]): string {
  if (status === "pending_insert") return "Pendente envio";
  if (status === "pending_update") return "Pendente atualização";
  if (status === "pending_delete") return "Pendente exclusão";
  if (status === "error") return "Erro de sync";
  return "Sincronizado";
}

function asStatusClass(status: ColetaRow["sync_status"]): string {
  if (status === "synced") return "synced";
  if (status === "error") return "error";
  return "pending";
}

function sortRows(rows: ColetaRow[]): ColetaRow[] {
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

function formatValidadeInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function parseMultiplo(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

function roleIsGlobalAdmin(profile: ColetaModuleProfile): boolean {
  return profile.role === "admin" && profile.cd_default == null;
}

function fixedCdFromProfile(profile: ColetaModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) {
    return Math.trunc(profile.cd_default);
  }
  return parseCdFromLabel(profile.cd_nome);
}

function todayIsoBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function toPendingLocalId(row: ColetaRow): string {
  if (row.remote_id) {
    return row.local_id.startsWith("pending:") ? row.local_id : `pending:${row.remote_id}`;
  }
  return row.local_id;
}

function BarcodeIcon() {
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

function QuantityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 8h12" />
      <path d="M12 4v16" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12l-8 8-9-9V4h7z" />
      <circle cx="7.5" cy="8.5" r="1" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4 20h16" />
    </svg>
  );
}

function OfflineModeIcon({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 8a10 10 0 0 1 16 0" />
        <path d="M7 12a6 6 0 0 1 10 0" />
        <path d="M10 16a2 2 0 0 1 4 0" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8a10 10 0 0 1 16 0" />
      <path d="M7 12a6 6 0 0 1 10 0" />
      <path d="M10 16a2 2 0 0 1 4 0" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M8 7l1 13h6l1-13" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {open ? <path d="M6 14l6-6 6 6" /> : <path d="M6 10l6 6 6-6" />}
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  );
}

export default function ColetaMercadoriaPage({ isOnline, profile }: ColetaMercadoriaPageProps) {
  const barcodeRef = useRef<HTMLInputElement | null>(null);
  const syncInFlightRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const collectInFlightRef = useRef(false);

  const [localRows, setLocalRows] = useState<ColetaRow[]>([]);
  const [sharedTodayRows, setSharedTodayRows] = useState<ColetaRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [dbBarrasCount, setDbBarrasCount] = useState(0);
  const [dbBarrasLastSyncAt, setDbBarrasLastSyncAt] = useState<string | null>(null);

  const [barcodeInput, setBarcodeInput] = useState("");
  const [multiploInput, setMultiploInput] = useState("1");
  const [etiquetaFixa, setEtiquetaFixa] = useState("");
  const [ocorrenciaInput, setOcorrenciaInput] = useState<"" | "Avariado" | "Vencido">("");
  const [loteInput, setLoteInput] = useState("");
  const [validadeInput, setValidadeInput] = useState("");

  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [cdAtivo, setCdAtivo] = useState<number | null>(null);
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);

  const [busyRefresh, setBusyRefresh] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [preferencesReady, setPreferencesReady] = useState(false);

  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 980px)").matches;
  });
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
  const [deleteTarget, setDeleteTarget] = useState<ColetaRow | null>(null);

  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const isGlobalAdmin = useMemo(() => roleIsGlobalAdmin(profile), [profile]);
  const fixedCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const currentCd = isGlobalAdmin ? cdAtivo : fixedCd;

  const canSeeReportTools = isDesktop && profile.role === "admin";

  const visibleRows = useMemo(() => {
    if (currentCd == null) return [];

    const localCurrent = localRows.filter((row) => row.cd === currentCd && row.sync_status !== "synced");
    const pendingByRemoteId = new Map<string, ColetaRow>();
    const pendingDeleteIds = new Set<string>();
    const pendingNewRows: ColetaRow[] = [];

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

  const refreshLocalState = useCallback(async () => {
    const [nextRows, nextPending, nextMeta] = await Promise.all([
      getUserColetaRows(profile.user_id),
      countPendingRows(profile.user_id),
      getDbBarrasMeta()
    ]);
    setLocalRows(nextRows);
    setPendingCount(nextPending);
    setDbBarrasCount(nextMeta.row_count);
    setDbBarrasLastSyncAt(nextMeta.last_sync_at);
  }, [profile.user_id]);

  const refreshSharedState = useCallback(async () => {
    if (!isOnline || currentCd == null) return;
    try {
      const rows = await fetchTodaySharedColetaRows(currentCd);
      setSharedTodayRows(rows);
    } catch {
      // Keep existing shared rows when network call fails.
    }
  }, [currentCd, isOnline]);

  const focusBarcode = useCallback(() => {
    window.requestAnimationFrame(() => {
      barcodeRef.current?.focus();
    });
  }, []);

  const runSync = useCallback(
    async (silent = false) => {
      if (!isOnline || syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      setBusySync(true);
      if (!silent) {
        setErrorMessage(null);
        setStatusMessage(null);
      }

      try {
        const result = await syncPendingColetaRows(profile.user_id);
        await refreshLocalState();
        await refreshSharedState();
        if (!silent) {
          setStatusMessage(
            result.processed === 0
              ? "Sem pendências para sincronizar."
              : `Sincronização concluída: ${result.synced} ok, ${result.failed} com erro.`
          );
        }
      } catch (error) {
        if (!silent) {
          setErrorMessage(error instanceof Error ? error.message : "Falha ao sincronizar pendências.");
        }
      } finally {
        syncInFlightRef.current = false;
        setBusySync(false);
      }
    },
    [isOnline, profile.user_id, refreshLocalState, refreshSharedState]
  );

  const runDbBarrasRefresh = useCallback(
    async (silent = false) => {
      if (!isOnline || refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      setBusyRefresh(true);
      if (!silent) {
        setErrorMessage(null);
        setStatusMessage(null);
      }

      try {
        const result = await refreshDbBarrasCache((pages, rowsFetched) => {
          setProgressMessage(`Atualizando base de barras... páginas ${pages} | linhas ${rowsFetched}`);
        });
        await refreshLocalState();
        if (!silent) {
          setStatusMessage(`Base de barras atualizada: ${result.rows} itens.`);
        }
      } catch (error) {
        if (!silent) {
          setErrorMessage(error instanceof Error ? error.message : "Falha ao atualizar base de barras.");
        }
      } finally {
        refreshInFlightRef.current = false;
        setProgressMessage(null);
        setBusyRefresh(false);
      }
    },
    [isOnline, refreshLocalState]
  );

  const applyRowUpdate = useCallback(
    async (row: ColetaRow, patch: Partial<ColetaRow>) => {
      const nextRow: ColetaRow = {
        ...row,
        ...patch,
        local_id: toPendingLocalId(row),
        sync_status: row.remote_id ? "pending_update" : "pending_insert",
        sync_error: null,
        updated_at: new Date().toISOString()
      };
      await upsertColetaRow(nextRow);
      await refreshLocalState();
      if (isOnline && !preferOfflineMode) {
        void runSync(true);
      }
    },
    [isOnline, preferOfflineMode, refreshLocalState, runSync]
  );

  const executeDeleteRow = useCallback(
    async (row: ColetaRow) => {
      if (row.remote_id) {
        const nextRow: ColetaRow = {
          ...row,
          local_id: toPendingLocalId(row),
          sync_status: "pending_delete",
          sync_error: null,
          updated_at: new Date().toISOString()
        };
        await upsertColetaRow(nextRow);
      } else {
        await removeColetaRow(row.local_id);
      }

      await refreshLocalState();
      if (isOnline && !preferOfflineMode) {
        void runSync(true);
      }
    },
    [isOnline, preferOfflineMode, refreshLocalState, runSync]
  );

  const requestDeleteRow = useCallback((row: ColetaRow) => {
    setDeleteTarget(row);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const confirmDeleteRow = useCallback(async () => {
    if (!deleteTarget) return;
    await executeDeleteRow(deleteTarget);
    setDeleteTarget(null);
    setExpandedRowId((current) => (current === deleteTarget.local_id ? null : current));
  }, [deleteTarget, executeDeleteRow]);
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
    const filters: ColetaReportFilters = {
      dtIni: reportDtIni,
      dtFim: reportDtFim,
      cd: Number.isFinite(parsedCd) ? parsedCd : null
    };

    setReportBusySearch(true);
    try {
      const count = await countColetaReportRows(filters);
      setReportCount(count);
      if (count > 0) {
        setReportMessage(`Foram encontradas ${count} coletas no período.`);
      } else {
        setReportMessage("Nenhuma coleta encontrada no período informado.");
      }
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Falha ao buscar coletas para relatório.");
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
      const filters: ColetaReportFilters = {
        dtIni: reportDtIni,
        dtFim: reportDtFim,
        cd: Number.isFinite(parsedCd) ? parsedCd : null
      };

      const rows = await fetchColetaReportRows(filters, 50000);
      if (rows.length === 0) {
        setReportMessage("Nenhuma coleta disponível para exportação.");
        return;
      }

      const XLSX = await import("xlsx");
      const exportRows = rows.map((row) => ({
        "Data/Hora": formatDateTime(row.data_hr),
        CD: row.cd,
        Etiqueta: row.etiqueta ?? "",
        Barras: row.barras,
        CODDV: row.coddv,
        Descricao: row.descricao,
        Quantidade: row.qtd,
        Ocorrencia: row.ocorrencia ?? "",
        Lote: row.lote ?? "",
        Validade: formatValidade(row.val_mmaa),
        Matricula_Auditor: row.mat_aud,
        Nome_Auditor: row.nome_aud
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      worksheet["!cols"] = [
        { wch: 20 },
        { wch: 8 },
        { wch: 16 },
        { wch: 20 },
        { wch: 10 },
        { wch: 48 },
        { wch: 12 },
        { wch: 14 },
        { wch: 16 },
        { wch: 11 },
        { wch: 18 },
        { wch: 32 }
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Coletas");
      const suffix = filters.cd == null ? "todos-cds" : `cd-${filters.cd}`;
      const fileName = `relatorio-coletas-${reportDtIni}-${reportDtFim}-${suffix}.xlsx`;

      XLSX.writeFile(workbook, fileName, { compression: true });
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
      const prefs = await getColetaPreferences(profile.user_id);
      if (cancelled) return;

      setEtiquetaFixa(prefs.etiqueta_fixa || "");
      setMultiploInput(String(prefs.multiplo_padrao || 1));
      setPreferOfflineMode(Boolean(prefs.prefer_offline_mode));

      const initialCd = prefs.cd_ativo ?? fixedCd;
      setCdAtivo(initialCd ?? null);

      await cleanupExpiredColetaRows(profile.user_id, ONE_DAY_MS);
      await refreshLocalState();
      if (cancelled) return;

      setPreferencesReady(true);
      const meta = await getDbBarrasMeta();
      const hasFreshCache = meta.row_count > 0 && isWithinAge(meta.last_sync_at, ONE_DAY_MS);

      if (isOnline && !prefs.prefer_offline_mode && !hasFreshCache) {
        await runDbBarrasRefresh(true);
      }

      await refreshSharedState();
      if (isOnline && !prefs.prefer_offline_mode) {
        await runSync(true);
      }
      focusBarcode();
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [fixedCd, focusBarcode, isOnline, profile.user_id, refreshLocalState, refreshSharedState, runDbBarrasRefresh, runSync]);

  useEffect(() => {
    if (!preferencesReady) return;
    const payloadCd = isGlobalAdmin ? cdAtivo : fixedCd;
    void saveColetaPreferences(profile.user_id, {
      etiqueta_fixa: etiquetaFixa,
      multiplo_padrao: parseMultiplo(multiploInput),
      cd_ativo: payloadCd,
      prefer_offline_mode: preferOfflineMode
    });
  }, [cdAtivo, etiquetaFixa, fixedCd, isGlobalAdmin, multiploInput, preferOfflineMode, preferencesReady, profile.user_id]);

  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;

    const loadOptions = async () => {
      try {
        const options = await fetchCdOptions();
        if (cancelled) return;
        setCdOptions(options);
        if (isGlobalAdmin && options.length > 0 && (cdAtivo == null || !options.some((item) => item.cd === cdAtivo))) {
          setCdAtivo(options[0].cd);
        }
      } catch {
        if (!cancelled) setCdOptions([]);
      }
    };

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [cdAtivo, isGlobalAdmin, isOnline]);

  useEffect(() => {
    if (!isOnline) return;
    void refreshSharedState();
  }, [isOnline, refreshSharedState]);

  useEffect(() => {
    if (!isOnline || preferOfflineMode) return;
    void runSync(true);
  }, [isOnline, preferOfflineMode, runSync]);

  useEffect(() => {
    if (!showReport) return;
    const baseCd = isGlobalAdmin ? currentCd : fixedCd;
    setReportCd(baseCd != null ? String(baseCd) : "");
  }, [currentCd, fixedCd, isGlobalAdmin, showReport]);

  useEffect(() => {
    focusBarcode();
  }, [focusBarcode]);

  const handleCollect = useCallback(async () => {
    if (collectInFlightRef.current) return;
    collectInFlightRef.current = true;
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const barras = normalizeBarcode(barcodeInput);
      if (!barras) {
        setErrorMessage("Informe o código de barras.");
        focusBarcode();
        return;
      }
      if (currentCd == null) {
        setErrorMessage("CD não definido para a coleta atual.");
        return;
      }
      if (dbBarrasCount <= 0 && (!isOnline || preferOfflineMode)) {
        setErrorMessage("Base local indisponível. Para trabalhar offline, sincronize a base de barras.");
        focusBarcode();
        return;
      }

      const qtd = parseMultiplo(multiploInput);
      let valMmaa: string | null = null;
      try {
        valMmaa = normalizeValidadeInput(validadeInput);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Validade inválida.");
        return;
      }

      let product = await getDbBarrasByBarcode(barras);
      if (!product && isOnline && !preferOfflineMode) {
        product = await fetchDbBarrasByBarcodeOnline(barras);
        if (product) {
          await upsertDbBarrasCacheRow(product);
          setDbBarrasCount((value) => Math.max(value, 1));
          setDbBarrasLastSyncAt(new Date().toISOString());
        }
      }

      if (!product) {
        setErrorMessage("Código de barras não encontrado na base de produtos.");
        focusBarcode();
        return;
      }

      const nowIso = new Date().toISOString();
      const row: ColetaRow = {
        local_id: safeUuid(),
        remote_id: null,
        user_id: profile.user_id,
        etiqueta: etiquetaFixa.trim() || null,
        cd: currentCd,
        barras: product.barras,
        coddv: product.coddv,
        descricao: product.descricao,
        qtd,
        ocorrencia: ocorrenciaInput || null,
        lote: loteInput.trim() || null,
        val_mmaa: valMmaa,
        mat_aud: profile.mat,
        nome_aud: profile.nome,
        data_hr: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
        sync_status: "pending_insert",
        sync_error: null
      };

      await upsertColetaRow(row);
      await refreshLocalState();

      setBarcodeInput("");
      setOcorrenciaInput("");
      setLoteInput("");
      setValidadeInput("");
      setExpandedRowId(row.local_id);

      if (isOnline && !preferOfflineMode) {
        void runSync(true);
        void refreshSharedState();
        setStatusMessage("Item coletado e enviado para sincronização.");
      } else {
        setStatusMessage("Item coletado em modo local. Sincronize quando estiver online.");
      }
      focusBarcode();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar coleta.");
      focusBarcode();
    } finally {
      collectInFlightRef.current = false;
    }
  }, [
    barcodeInput,
    currentCd,
    dbBarrasCount,
    etiquetaFixa,
    focusBarcode,
    isOnline,
    loteInput,
    multiploInput,
    ocorrenciaInput,
    preferOfflineMode,
    profile.mat,
    profile.nome,
    profile.user_id,
    refreshLocalState,
    refreshSharedState,
    runSync,
    validadeInput
  ]);

  const onCollectSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleCollect();
  };

  const onBarcodeKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void handleCollect();
  };

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
            <span className="coleta-pending-pill" title="Linhas pendentes de envio">
              Pendentes: {pendingCount}
            </span>
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

      <section className="modules-shell coleta-shell">
        <div className="coleta-head">
          <h2>Olá, {displayUserName}</h2>
          <p>Para trabalhar offline, sincronize a base de barras antes de iniciar a coleta.</p>
          <p className="coleta-meta-line">
            Base local: <strong>{dbBarrasCount}</strong> itens
            {dbBarrasLastSyncAt ? ` | Atualizada em ${formatDateTime(dbBarrasLastSyncAt)}` : " | Sem atualização ainda"}
          </p>
        </div>

        {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
        {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
        {progressMessage ? <div className="alert success">{progressMessage}</div> : null}
        {preferOfflineMode ? (
          <div className="alert success">
            Modo offline ativo: novas coletas ficam locais e você sincroniza quando quiser.
          </div>
        ) : null}

        {!isOnline && dbBarrasCount <= 0 ? (
          <div className="alert error">
            Você está offline e ainda não há cache da DB_BARRAS neste dispositivo. Conecte-se para carregar a base.
          </div>
        ) : null}

        <div className="coleta-actions-row">
          <button
            type="button"
            className={`btn btn-muted coleta-offline-toggle${preferOfflineMode ? " is-active" : ""}`}
            onClick={() => setPreferOfflineMode((value) => !value)}
            title={preferOfflineMode ? "Desativar modo offline local" : "Ativar modo offline local"}
          >
            <span aria-hidden="true"><OfflineModeIcon enabled={!preferOfflineMode} /></span>
            {preferOfflineMode ? "Offline local" : "Online direto"}
          </button>
          <button type="button" className="btn btn-muted" onClick={() => void runDbBarrasRefresh(false)} disabled={!isOnline || busyRefresh}>
            {busyRefresh ? "Atualizando base..." : "Atualizar base barras"}
          </button>
          <button type="button" className="btn btn-muted" onClick={() => void refreshSharedState()} disabled={!isOnline || currentCd == null}>
            Atualizar coletas do dia
          </button>
          <button type="button" className="btn btn-primary coleta-sync-btn" onClick={() => void runSync(false)} disabled={!isOnline || busySync || pendingCount <= 0}>
            <span aria-hidden="true"><UploadIcon /></span>
            {busySync ? "Sincronizando..." : "Sincronizar agora"}
          </button>
          {canSeeReportTools ? (
            <button
              type="button"
              className="btn btn-muted coleta-report-toggle"
              onClick={() => {
                setShowReport((value) => !value);
                setReportError(null);
                setReportMessage(null);
              }}
              title="Buscar coletas para relatório"
            >
              <span aria-hidden="true"><SearchIcon /></span>
              Buscar coletas
            </button>
          ) : null}
        </div>
        {showReport && canSeeReportTools ? (
          <section className="coleta-report-panel">
            <div className="coleta-report-head">
              <h3>Relatório de Coletas (Admin)</h3>
              <p>Busca por período com contagem antes da extração para reduzir egress.</p>
            </div>

            {reportError ? <div className="alert error">{reportError}</div> : null}
            {reportMessage ? <div className="alert success">{reportMessage}</div> : null}

            <div className="coleta-report-grid">
              <label>
                Data inicial
                <input type="date" value={reportDtIni} onChange={(event) => setReportDtIni(event.target.value)} required />
              </label>
              <label>
                Data final
                <input type="date" value={reportDtFim} onChange={(event) => setReportDtFim(event.target.value)} required />
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

        <form className="coleta-form" onSubmit={onCollectSubmit}>
          <div className="coleta-form-grid">
            <label>
              Código de barras
              <div className="input-icon-wrap">
                <span className="field-icon" aria-hidden="true">
                  <BarcodeIcon />
                </span>
                <input
                  ref={barcodeRef}
                  type="text"
                  value={barcodeInput}
                  onChange={(event) => setBarcodeInput(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  onKeyDown={onBarcodeKeyDown}
                  placeholder="Bipe ou digite e pressione Enter"
                  required
                />
              </div>
            </label>

            <label>
              Múltiplo
              <div className="input-icon-wrap">
                <span className="field-icon" aria-hidden="true">
                  <QuantityIcon />
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={multiploInput}
                  onChange={(event) => setMultiploInput(event.target.value)}
                />
              </div>
            </label>

            <label>
              Etiqueta fixa
              <div className="input-icon-wrap">
                <span className="field-icon" aria-hidden="true">
                  <TagIcon />
                </span>
                <input
                  type="text"
                  value={etiquetaFixa}
                  onChange={(event) => setEtiquetaFixa(event.target.value)}
                  placeholder="Opcional (fica salvo até limpar)"
                />
              </div>
            </label>

            {isGlobalAdmin ? (
              <label>
                Depósito
                <select
                  value={cdAtivo ?? ""}
                  onChange={(event) => setCdAtivo(Number.parseInt(event.target.value, 10))}
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
            <label>
              Ocorrência
              <select value={ocorrenciaInput} onChange={(event) => setOcorrenciaInput(event.target.value as "" | "Avariado" | "Vencido")}>
                <option value="">Sem ocorrência</option>
                <option value="Avariado">Avariado</option>
                <option value="Vencido">Vencido</option>
              </select>
            </label>

            <label>
              Lote
              <input type="text" value={loteInput} onChange={(event) => setLoteInput(event.target.value)} placeholder="Opcional" />
            </label>

            <label>
              Validade (MM/AA)
              <input
                type="text"
                inputMode="numeric"
                value={validadeInput}
                onChange={(event) => setValidadeInput(formatValidadeInput(event.target.value))}
                placeholder="MM/AA"
                maxLength={5}
              />
            </label>
          </div>

          <button
            className="btn btn-primary coleta-submit"
            type="submit"
            disabled={currentCd == null || (dbBarrasCount <= 0 && (!isOnline || preferOfflineMode))}
          >
            Salvar coleta
          </button>
        </form>

        <div className="coleta-list-head">
          <h3>Coletas do dia no depósito</h3>
          <span>{visibleRows.length} itens</span>
        </div>

        <div className="coleta-list">
          {visibleRows.length === 0 ? (
            <div className="coleta-empty">Nenhuma coleta disponível para hoje neste depósito.</div>
          ) : (
            visibleRows.map((row) => (
              <article key={row.local_id} className={`coleta-row-card${expandedRowId === row.local_id ? " is-expanded" : ""}`}>
                <button
                  type="button"
                  className="coleta-row-line"
                  onClick={() => setExpandedRowId((current) => (current === row.local_id ? null : row.local_id))}
                >
                  <div className="coleta-row-line-main">
                    <strong>{row.descricao}</strong>
                    <p>Barras: {row.barras} | CODDV: {row.coddv}</p>
                    <p>Coletado em {formatDateTime(row.data_hr)}</p>
                  </div>

                  <div className="coleta-row-line-right">
                    <span className={`coleta-row-status ${asStatusClass(row.sync_status)}`} title={row.sync_error ?? undefined}>
                      {asStatusLabel(row.sync_status)}
                    </span>
                    <span className="coleta-row-expand" aria-hidden="true">
                      <ChevronIcon open={expandedRowId === row.local_id} />
                    </span>
                  </div>
                </button>

                {expandedRowId === row.local_id ? (
                  <div className="coleta-row-edit-card">
                    <div className="coleta-row-edit-grid">
                      <label>
                        Qtd
                        <input
                          type="number"
                          min={1}
                          defaultValue={row.qtd}
                          onBlur={(event) => {
                            const nextValue = parseMultiplo(event.target.value);
                            if (nextValue !== row.qtd) {
                              void applyRowUpdate(row, { qtd: nextValue });
                            }
                          }}
                        />
                      </label>

                      <label>
                        Etiqueta
                        <input
                          type="text"
                          defaultValue={row.etiqueta ?? ""}
                          onBlur={(event) => {
                            const nextValue = event.target.value.trim() || null;
                            if (nextValue !== row.etiqueta) {
                              void applyRowUpdate(row, { etiqueta: nextValue });
                            }
                          }}
                        />
                      </label>

                      <label>
                        Ocorrência
                        <select
                          value={row.ocorrencia ?? ""}
                          onChange={(event) => {
                            const next = event.target.value as "" | "Avariado" | "Vencido";
                            void applyRowUpdate(row, { ocorrencia: next || null });
                          }}
                        >
                          <option value="">Sem ocorrência</option>
                          <option value="Avariado">Avariado</option>
                          <option value="Vencido">Vencido</option>
                        </select>
                      </label>

                      <label>
                        Lote
                        <input
                          type="text"
                          defaultValue={row.lote ?? ""}
                          onBlur={(event) => {
                            const nextValue = event.target.value.trim() || null;
                            if (nextValue !== row.lote) {
                              void applyRowUpdate(row, { lote: nextValue });
                            }
                          }}
                        />
                      </label>

                      <label>
                        Validade
                        <input
                          type="text"
                          inputMode="numeric"
                          defaultValue={formatValidade(row.val_mmaa)}
                          maxLength={5}
                          onBlur={(event) => {
                            try {
                              const nextValue = normalizeValidadeInput(event.target.value);
                              if (nextValue !== row.val_mmaa) {
                                void applyRowUpdate(row, { val_mmaa: nextValue });
                              }
                            } catch (error) {
                              setErrorMessage(error instanceof Error ? error.message : "Validade inválida.");
                            }
                          }}
                        />
                      </label>
                    </div>

                    <div className="coleta-row-footer">
                      <span>
                        Auditor: {row.nome_aud} ({row.mat_aud})
                      </span>
                      <button className="btn btn-muted coleta-delete-btn" type="button" onClick={() => requestDeleteRow(row)}>
                        <span aria-hidden="true"><TrashIcon /></span>
                        Excluir
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>

        {deleteTarget ? (
          <div
            className="confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="coleta-delete-title"
            onClick={closeDeleteConfirm}
          >
            <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
              <h3 id="coleta-delete-title">Excluir item coletado</h3>
              <p>Deseja excluir "{deleteTarget.descricao}" da coleta?</p>
              <div className="confirm-actions">
                <button className="btn btn-muted" type="button" onClick={closeDeleteConfirm}>
                  Cancelar
                </button>
                <button className="btn btn-danger" type="button" onClick={() => void confirmDeleteRow()}>
                  Excluir
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
