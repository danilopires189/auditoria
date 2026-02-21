import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import {
  clearZone,
  fetchAlocacaoCompletedItemsDayAll,
  fetchAdminBlacklist,
  fetchAdminPriorityZones,
  fetchAlocacaoManifest,
  fetchPvpsCompletedItemsDayAll,
  fetchPvpsManifest,
  fetchPvpsPulItems,
  removeAdminBlacklist,
  removeAdminPriorityZone,
  reseedByZone,
  submitAlocacao,
  submitAlocacaoCompletedEdit,
  submitPvpsPul,
  submitPvpsSep,
  upsertAdminBlacklist,
  upsertAdminPriorityZone
} from "./sync";
import { syncPvpsOfflineQueue } from "./offline-sync";
import {
  hasOfflineSepCache,
  saveOfflinePulEvent,
  saveOfflineSepEvent,
  upsertOfflineSepCache
} from "./storage";
import type {
  AlocacaoCompletedRow,
  AlocacaoManifestRow,
  AlocacaoSubmitResult,
  PvpsCompletedRow,
  PvpsAdminBlacklistRow,
  PvpsAdminPriorityZoneRow,
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
      <path d="M12 3l9 16H3z" />
      <path d="M12 9v5" />
      <circle cx="12" cy="17" r="1" />
    </svg>
  );
}

function playIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6l10 6-10 6z" />
    </svg>
  );
}

function refreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 4v6h-6" />
    </svg>
  );
}

function listIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function filterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}

function editIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="M13 7l4 4" />
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

function doneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 7L9 18l-5-5" />
    </svg>
  );
}

function nextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function clearSelectionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M8 7l1 12h6l1-12" />
      <path d="M10 10v7" />
      <path d="M14 10v7" />
    </svg>
  );
}

function selectFilteredIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 12l2 2 4-4" />
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
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

export default function PvpsAlocacaoPage({ isOnline, profile }: PvpsAlocacaoPageProps) {
  const displayUserName = toDisplayName(profile.nome);
  const isAdmin = profile.role === "admin";

  const [tab, setTab] = useState<ModuleTab>("pvps");
  const [feedView, setFeedView] = useState<FeedView>("pendentes");
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [showZoneFilterPopup, setShowZoneFilterPopup] = useState(false);
  const [zoneSearch, setZoneSearch] = useState("");
  const [showDiscardZonesConfirm, setShowDiscardZonesConfirm] = useState(false);
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
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [offlineSyncBusy, setOfflineSyncBusy] = useState(false);
  const [adminModulo, setAdminModulo] = useState<PvpsModulo>("ambos");
  const [adminZona, setAdminZona] = useState("");
  const [adminCoddv, setAdminCoddv] = useState("");
  const [adminPrioridade, setAdminPrioridade] = useState("100");
  const [adminAutoRepor, setAdminAutoRepor] = useState(true);
  const [showClearZoneConfirm, setShowClearZoneConfirm] = useState(false);
  const [blacklistRows, setBlacklistRows] = useState<PvpsAdminBlacklistRow[]>([]);
  const [priorityRows, setPriorityRows] = useState<PvpsAdminPriorityZoneRow[]>([]);
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
      const [blacklist, priority] = await Promise.all([
        fetchAdminBlacklist("ambos", activeCd),
        fetchAdminPriorityZones("ambos", activeCd)
      ]);
      setBlacklistRows(blacklist);
      setPriorityRows(priority);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar dados administrativos.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function loadCurrent(options?: { silent?: boolean }): Promise<void> {
    const silent = options?.silent === true;
    if (!silent) {
      setBusy(true);
      setErrorMessage(null);
    }
    try {
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

  useEffect(() => {
    void loadCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeCd, todayBrt]);

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
  }, [isOnline, tab, activeCd, todayBrt, feedView, showPvpsPopup, showAlocPopup]);

  useEffect(() => {
    if (!isOnline || activeCd == null || offlineSyncBusy) return;
    let cancelled = false;
    const runSync = async () => {
      setOfflineSyncBusy(true);
      try {
        const result = await syncPvpsOfflineQueue(activeCd);
        if (cancelled) return;
        if (result.synced > 0) {
          setStatusMessage(`Sincronização offline PVPS concluída: ${result.synced} evento(s) enviados.`);
          await loadCurrent({ silent: true });
        } else if (result.remaining > 0 && result.failed > 0) {
          setStatusMessage(`Sincronização offline parcial: ${result.failed} pendente(s) para nova tentativa.`);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Falha na sincronização offline PVPS.");
        }
      } finally {
        if (!cancelled) setOfflineSyncBusy(false);
      }
    };
    void runSync();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, activeCd]);

  useEffect(() => {
    if (!activePvps) {
      setPulItems([]);
      setPulInputs({});
      setPulEndSits({});
      return;
    }

    setEndSit(activePvps.end_sit ?? "");
    setValSep(activePvps.val_sep?.replace("/", "") ?? "");

    if (activeCd != null && (activePvps.val_sep || activePvps.end_sit)) {
      void upsertOfflineSepCache({
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
  }, [activePvps, activeCd]);

  useEffect(() => {
    if (activePvpsMode !== "pul") return;
    if (!pulItems.length) return;
    if (activePulEnd && pulItems.some((item) => item.end_pul === activePulEnd)) return;
    const next = pulItems.find((item) => !item.auditado) ?? pulItems[0];
    setActivePulEnd(next?.end_pul ?? null);
  }, [activePvpsMode, pulItems, activePulEnd]);

  const zoneFilterSet = useMemo(() => new Set(selectedZones), [selectedZones]);

  const sortedPvpsAllRows = useMemo(
    () => [...pvpsRows].sort((a, b) => {
      const byZone = a.zona.localeCompare(b.zona);
      if (byZone !== 0) return byZone;
      const byEndereco = a.end_sep.localeCompare(b.end_sep);
      if (byEndereco !== 0) return byEndereco;
      const byCoddv = a.coddv - b.coddv;
      if (byCoddv !== 0) return byCoddv;
      return dateSortValue(b.dat_ult_compra) - dateSortValue(a.dat_ult_compra);
    }),
    [pvpsRows]
  );

  const sortedAlocAllRows = useMemo(
    () => [...alocRows].sort((a, b) => {
      const byDate = dateSortValue(b.dat_ult_compra) - dateSortValue(a.dat_ult_compra);
      if (byDate !== 0) return byDate;
      const byCoddv = a.coddv - b.coddv;
      if (byCoddv !== 0) return byCoddv;
      const byZone = a.zona.localeCompare(b.zona);
      if (byZone !== 0) return byZone;
      return a.endereco.localeCompare(b.endereco);
    }),
    [alocRows]
  );

  const pvpsFeedItemsAll = useMemo<PvpsFeedItem[]>(() => {
    const items: PvpsFeedItem[] = [];
    for (const row of sortedPvpsAllRows) {
      const baseKey = keyOfPvps(row);
      if (row.status === "pendente_sep") {
        items.push({
          kind: "sep",
          feedKey: `sep:${baseKey}`,
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
        items.push({
          kind: "pul",
          feedKey: `pul:${baseKey}:${item.end_pul}`,
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
    const byCoddv = new Map<number, { coddv: number; descricao: string; dat_ult_compra: string; maxTs: number }>();
    for (const row of sortedPvpsAllRows) {
      const ts = dateSortValue(row.dat_ult_compra);
      const current = byCoddv.get(row.coddv);
      if (!current || ts > current.maxTs) {
        byCoddv.set(row.coddv, {
          coddv: row.coddv,
          descricao: row.descricao,
          dat_ult_compra: row.dat_ult_compra,
          maxTs: ts
        });
      }
    }
    return Array.from(byCoddv.values()).sort((a, b) => (b.maxTs - a.maxTs) || (a.coddv - b.coddv));
  }, [sortedPvpsAllRows]);

  const alocQueueProducts = useMemo(() => {
    const byCoddv = new Map<number, { coddv: number; descricao: string; dat_ult_compra: string; maxTs: number }>();
    for (const row of sortedAlocAllRows) {
      const ts = dateSortValue(row.dat_ult_compra);
      const current = byCoddv.get(row.coddv);
      if (!current || ts > current.maxTs) {
        byCoddv.set(row.coddv, {
          coddv: row.coddv,
          descricao: row.descricao,
          dat_ult_compra: row.dat_ult_compra,
          maxTs: ts
        });
      }
    }
    return Array.from(byCoddv.values()).sort((a, b) => (b.maxTs - a.maxTs) || (a.coddv - b.coddv));
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
        const byZone = a.zone.localeCompare(b.zone);
        if (byZone !== 0) return byZone;
        if (a.kind !== b.kind) return a.kind === "sep" ? -1 : 1;
        return a.endereco.localeCompare(b.endereco);
      });
  }, [pvpsFeedItemsAll, pvpsActiveCoddvSet, selectedZones, zoneFilterSet]);

  const visibleAlocRows = useMemo(() => {
    const coddvOrder = new Map<number, number>();
    alocActiveCoddvList.forEach((coddv, index) => coddvOrder.set(coddv, index));
    return sortedAlocAllRows
      .filter((row) => alocActiveCoddvSet.has(row.coddv))
      .filter((row) => !selectedZones.length || zoneFilterSet.has(row.zona))
      .sort((a, b) => {
        const byZone = a.zona.localeCompare(b.zona);
        if (byZone !== 0) return byZone;
        const byCoddv = (coddvOrder.get(a.coddv) ?? 999) - (coddvOrder.get(b.coddv) ?? 999);
        if (byCoddv !== 0) return byCoddv;
        return a.endereco.localeCompare(b.endereco);
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
      const byDt = new Date(b.dt_hr).getTime() - new Date(a.dt_hr).getTime();
      if (!Number.isNaN(byDt) && byDt !== 0) return byDt;
      const byZone = a.zona.localeCompare(b.zona);
      if (byZone !== 0) return byZone;
      return a.end_sep.localeCompare(b.end_sep);
    }),
    [filteredPvpsCompletedRows]
  );

  const sortedAlocCompletedRows = useMemo(
    () => [...filteredAlocCompletedRows].sort((a, b) => {
      const byDt = new Date(b.dt_hr).getTime() - new Date(a.dt_hr).getTime();
      if (!Number.isNaN(byDt) && byDt !== 0) return byDt;
      const byZone = a.zona.localeCompare(b.zona);
      if (byZone !== 0) return byZone;
      return a.endereco.localeCompare(b.endereco);
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
      if (!activePvpsKey || !visibleKeys.has(activePvpsKey)) {
        const first = pvpsFeedItems[0];
        setActivePvpsKey(first ? keyOfPvps(first.row) : null);
        if (first?.kind === "pul") {
          setActivePvpsMode("pul");
          setActivePulEnd(first.endPul);
        } else {
          setActivePvpsMode("sep");
          setActivePulEnd(null);
        }
      }
      return;
    }
    if (!visibleAlocRows.some((row) => row.queue_id === activeAlocQueue)) {
      setActiveAlocQueue(visibleAlocRows[0]?.queue_id ?? null);
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
        qtd_est_disp: 0
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
        qtd_est_disp: 0
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
      try {
        await saveOfflineSepEvent({
          cd: activeCd,
          coddv: activePvps.coddv,
          end_sep: activePvps.end_sep,
          end_sit: endSit || null,
          val_sep: hasOcorrencia ? null : normalizedValSep
        });
        await upsertOfflineSepCache({
          cd: activeCd,
          coddv: activePvps.coddv,
          end_sep: activePvps.end_sep,
          end_sit: endSit || null,
          val_sep: hasOcorrencia ? null : normalizedValSep
        });
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
      let hasSep = await hasOfflineSepCache(activeCd, activePvps.coddv, activePvps.end_sep);
      if (!hasSep && (activePvps.val_sep || activePvps.end_sit)) {
        await upsertOfflineSepCache({
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
          cd: activeCd,
          coddv: activePvps.coddv,
          end_sep: activePvps.end_sep,
          end_pul: endPul,
          end_sit: hasPulOcorrencia ? pulEndSit : null,
          val_pul: hasPulOcorrencia ? null : value.trim(),
          audit_id: activePvps.audit_id
        });
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

    setBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    const currentQueueId = activeAloc.queue_id;
    const currentZone = activeAloc.zona;
    const isEditingCompleted = Boolean(editingAlocCompleted);
    const hasOcorrencia = alocEndSit === "vazio" || alocEndSit === "obstruido";
    const normalizedValConf = alocValConf.trim();
    if (!hasOcorrencia && normalizedValConf.length !== 4) {
      setBusy(false);
      setErrorMessage("Validade do Produto obrigatória (MMAA) quando não houver ocorrência.");
      return;
    }
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

  async function handleAdminAddBlacklist(): Promise<void> {
    setAdminBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await upsertAdminBlacklist({
        p_cd: activeCd,
        modulo: adminModulo,
        zona: adminZona,
        coddv: Number.parseInt(adminCoddv, 10)
      });
      await loadAdminData();
      setStatusMessage("Blacklist atualizada.");
      await loadCurrent();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar blacklist.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleAdminAddPriority(): Promise<void> {
    setAdminBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await upsertAdminPriorityZone({
        p_cd: activeCd,
        modulo: adminModulo,
        zona: adminZona,
        prioridade: Number.parseInt(adminPrioridade, 10)
      });
      await loadAdminData();
      setStatusMessage("Zonas prioritárias atualizadas.");
      await loadCurrent();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar zona prioritária.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleAdminClearZone(): Promise<void> {
    setAdminBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await clearZone({
        p_cd: activeCd,
        modulo: adminModulo,
        zona: adminZona,
        repor_automatico: adminAutoRepor
      });
      setStatusMessage(`Zona limpa. PVPS removidos: ${result.cleared_pvps}, Alocação removidos: ${result.cleared_alocacao}.`);
      await loadAdminData();
      await loadCurrent();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao limpar zona.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleAdminReseedZone(): Promise<void> {
    setAdminBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await reseedByZone({
        p_cd: activeCd,
        modulo: adminModulo,
        zona: adminZona
      });
      setStatusMessage(`Reposição concluída. PVPS: ${result.reposto_pvps}, Alocação: ${result.reposto_alocacao}.`);
      await loadCurrent();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao repor zona.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleRemoveBlacklist(id: string): Promise<void> {
    setAdminBusy(true);
    try {
      await removeAdminBlacklist(id);
      await loadAdminData();
      await loadCurrent();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao remover blacklist.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleRemovePriority(id: string): Promise<void> {
    setAdminBusy(true);
    try {
      await removeAdminPriorityZone(id);
      await loadAdminData();
      await loadCurrent();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao remover zona prioritária.");
    } finally {
      setAdminBusy(false);
    }
  }

  function toggleZone(zone: string): void {
    setSelectedZones((previous) => (
      previous.includes(zone) ? previous.filter((z) => z !== zone) : [...previous, zone]
    ));
  }

  async function handleDiscardSelectedZones(): Promise<void> {
    if (!selectedZones.length) return;
    setAdminBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      let totalPvps = 0;
      let totalAloc = 0;
      for (const zone of selectedZones) {
        const result = await clearZone({
          p_cd: activeCd,
          modulo: tab,
          zona: zone,
          repor_automatico: true
        });
        totalPvps += result.cleared_pvps;
        totalAloc += result.cleared_alocacao;
      }
      await loadCurrent();
      setStatusMessage(`Zonas descartadas (${selectedZones.length}). Removidos: PVPS ${totalPvps}, Alocação ${totalAloc}. Fila reposta automaticamente.`);
      setShowDiscardZonesConfirm(false);
      setShowZoneFilterPopup(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao descartar zonas selecionadas.");
    } finally {
      setAdminBusy(false);
    }
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
              <button type="button" className="btn btn-muted pvps-toolbar-btn" onClick={() => void loadCurrent()} disabled={busy}>
                <span className="pvps-btn-icon" aria-hidden="true">{refreshIcon()}</span>
                <span>{busy ? "Atualizando..." : "Atualizar"}</span>
              </button>
            </div>

            <div className="pvps-toolbar">
              <div className="pvps-toolbar-group">
                <small className="pvps-toolbar-label">Ações</small>
                <div className="pvps-actions">
                  <button
                    type="button"
                    className={`btn btn-muted pvps-toolbar-btn${tab === "pvps" ? " is-active" : ""}`}
                    onClick={() => setTab("pvps")}
                    disabled={busy}
                  >
                    <span className="pvps-btn-icon" aria-hidden="true">{playIcon()}</span>
                    <span>Iniciar PVPS</span>
                  </button>
                  <button
                    type="button"
                    className={`btn btn-muted pvps-toolbar-btn${tab === "alocacao" ? " is-active" : ""}`}
                    onClick={() => setTab("alocacao")}
                    disabled={busy}
                  >
                    <span className="pvps-btn-icon" aria-hidden="true">{playIcon()}</span>
                    <span>Iniciar Alocação</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="pvps-toolbar-group">
              <small className="pvps-toolbar-label">Visualização</small>
              <div className="pvps-tabs">
                <button
                  type="button"
                  className={`btn btn-muted pvps-toolbar-btn${feedView === "pendentes" ? " is-active" : ""}`}
                  onClick={() => setFeedView("pendentes")}
                >
                  <span className="pvps-btn-icon" aria-hidden="true">{listIcon()}</span>
                  <span>Pendentes</span>
                </button>
                <button
                  type="button"
                  className={`btn btn-muted pvps-toolbar-btn${feedView === "concluidos" ? " is-active" : ""}`}
                  onClick={() => setFeedView("concluidos")}
                >
                  <span className="pvps-btn-icon" aria-hidden="true">{doneIcon()}</span>
                  <span>Concluídos do dia</span>
                </button>
              </div>
            </div>

            {isAdmin ? (
              <div className="pvps-tabs">
                <button
                  type="button"
                  className={`btn btn-muted${showAdminPanel ? " is-active" : ""}`}
                  onClick={() => setShowAdminPanel((prev) => !prev)}
                >
                  {showAdminPanel ? "Ocultar Admin" : "Admin: Regras de Zona"}
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
            {isAdmin && showAdminPanel ? (
              <div className="pvps-admin-panel">
                <h3>Painel Admin</h3>
                <div className="pvps-admin-grid">
                  <label>
                    Módulo
                    <select value={adminModulo} onChange={(event) => setAdminModulo(event.target.value as PvpsModulo)}>
                      <option value="ambos">Ambos</option>
                      <option value="pvps">PVPS</option>
                      <option value="alocacao">Alocação</option>
                    </select>
                  </label>
                  <label>
                    Zona
                    <input value={adminZona} onChange={(event) => setAdminZona(event.target.value.toUpperCase())} placeholder="Ex.: A001" />
                  </label>
                  <label>
                    CODDV (blacklist)
                    <input value={adminCoddv} onChange={(event) => setAdminCoddv(event.target.value.replace(/\D/g, ""))} placeholder="Código" />
                  </label>
                  <label>
                    Prioridade zona
                    <input value={adminPrioridade} onChange={(event) => setAdminPrioridade(event.target.value.replace(/\D/g, ""))} placeholder="1 = mais alta" />
                  </label>
                </div>
                <div className="pvps-actions">
                  <button className="btn btn-muted" type="button" disabled={adminBusy || !adminZona || !adminCoddv} onClick={() => void handleAdminAddBlacklist()}>
                    Adicionar Blacklist
                  </button>
                  <button className="btn btn-muted" type="button" disabled={adminBusy || !adminZona || !adminPrioridade} onClick={() => void handleAdminAddPriority()}>
                    Priorizar Zona
                  </button>
                  <button className="btn btn-muted" type="button" disabled={adminBusy || !adminZona} onClick={() => void handleAdminReseedZone()}>
                    Repor Zona
                  </button>
                </div>
                <div className="pvps-actions">
                  <label className="pvps-checkbox">
                    <input type="checkbox" checked={adminAutoRepor} onChange={(event) => setAdminAutoRepor(event.target.checked)} />
                    Reposição automática ao limpar base
                  </label>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={adminBusy || !adminZona}
                    onClick={() => setShowClearZoneConfirm(true)}
                  >
                    Limpar base por zona
                  </button>
                </div>
                <div className="pvps-admin-lists">
                  <div>
                    <h4>Blacklist</h4>
                    {blacklistRows.map((row) => (
                      <div key={row.blacklist_id} className="pvps-admin-row">
                        <span>{row.modulo} | {row.zona} | {row.coddv}</span>
                        <button className="btn btn-muted" type="button" disabled={adminBusy} onClick={() => void handleRemoveBlacklist(row.blacklist_id)}>
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4>Zonas Prioritárias</h4>
                    {priorityRows.map((row) => (
                      <div key={row.priority_id} className="pvps-admin-row">
                        <span>{row.modulo} | {row.zona} | prioridade {row.prioridade}</span>
                        <button className="btn btn-muted" type="button" disabled={adminBusy} onClick={() => void handleRemovePriority(row.priority_id)}>
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
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
                {endSit !== "vazio" && endSit !== "obstruido" ? (
                  <label>
                    Validade do Produto
                    <input
                      value={valSep}
                      onChange={(event) => setValSep(event.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder="MMAA"
                      maxLength={4}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      required
                    />
                  </label>
                ) : null}
                <label>
                  Ocorrência do endereço
                  <div className="pvps-occurrence-wrap">
                    <span className="pvps-occurrence-icon" aria-hidden="true">{occurrenceIcon()}</span>
                    <select
                      value={endSit}
                      onChange={(event) => {
                        const next = event.target.value;
                        const parsed = next === "vazio" || next === "obstruido" ? next : "";
                        setEndSit(parsed);
                        if (parsed) setValSep("");
                      }}
                    >
                      <option value="">Sem ocorrência</option>
                      <option value="vazio">Vazio</option>
                      <option value="obstruido">Obstruído</option>
                    </select>
                  </div>
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
                    {(pulEndSits[activePulItem.end_pul] ?? "") !== "vazio" && (pulEndSits[activePulItem.end_pul] ?? "") !== "obstruido" ? (
                      <input
                        value={pulInputs[activePulItem.end_pul] ?? ""}
                        onChange={(event) => setPulInputs((prev) => ({ ...prev, [activePulItem.end_pul]: event.target.value.replace(/\D/g, "").slice(0, 4) }))}
                        placeholder="MMAA"
                        maxLength={4}
                        inputMode="numeric"
                        pattern="[0-9]*"
                      />
                    ) : null}
                    <div className="pvps-occurrence-wrap">
                      <span className="pvps-occurrence-icon" aria-hidden="true">{occurrenceIcon()}</span>
                      <select
                        value={pulEndSits[activePulItem.end_pul] ?? ""}
                        onChange={(event) => {
                          const next = event.target.value;
                          const parsed = next === "vazio" || next === "obstruido" ? next : "";
                          setPulEndSits((prev) => ({ ...prev, [activePulItem.end_pul]: parsed }));
                          if (parsed) {
                            setPulInputs((prev) => ({ ...prev, [activePulItem.end_pul]: "" }));
                          }
                        }}
                      >
                        <option value="">Sem ocorrência</option>
                        <option value="vazio">Vazio</option>
                        <option value="obstruido">Obstruído</option>
                      </select>
                    </div>
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

            <form className="form-grid" onSubmit={(event) => void handleSubmitAlocacao(event)}>
              {alocEndSit !== "vazio" && alocEndSit !== "obstruido" ? (
                <label>
                  Validade do Produto
                  <input
                    value={alocValConf}
                    onChange={(event) => setAlocValConf(event.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="MMAA"
                    maxLength={4}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required
                  />
                </label>
              ) : null}
              <label>
                Ocorrência do endereço
                <div className="pvps-occurrence-wrap">
                  <span className="pvps-occurrence-icon" aria-hidden="true">{occurrenceIcon()}</span>
                  <select
                    value={alocEndSit}
                    onChange={(event) => {
                      const next = event.target.value;
                      const parsed = next === "vazio" || next === "obstruido" ? next : "";
                      setAlocEndSit(parsed);
                      if (parsed) setAlocValConf("");
                    }}
                  >
                    <option value="">Sem ocorrência</option>
                    <option value="vazio">Vazio</option>
                    <option value="obstruido">Obstruído</option>
                  </select>
                </div>
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy || Boolean(alocFeedback && !editingAlocCompleted)}>
                Salvar
              </button>
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

      {showClearZoneConfirm && typeof document !== "undefined"
        ? createPortal(
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pvps-clear-zone-title"
          onClick={() => {
            if (adminBusy) return;
            setShowClearZoneConfirm(false);
          }}
        >
          <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
            <h3 id="pvps-clear-zone-title">Confirmar limpeza da base por zona</h3>
            <p>
              Esta ação irá remover os itens pendentes da zona <strong>{adminZona || "-"}</strong> para o módulo{" "}
              <strong>{adminModulo.toUpperCase()}</strong>.
            </p>
            <p>
              Reposição automática: <strong>{adminAutoRepor ? "ativada" : "desativada"}</strong>.
            </p>
            <div className="confirm-actions">
              <button
                className="btn btn-muted"
                type="button"
                disabled={adminBusy}
                onClick={() => setShowClearZoneConfirm(false)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-danger"
                type="button"
                disabled={adminBusy}
                onClick={() => {
                  void handleAdminClearZone();
                  setShowClearZoneConfirm(false);
                }}
              >
                {adminBusy ? "Limpando..." : "Confirmar limpeza"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {showZoneFilterPopup && typeof document !== "undefined"
        ? createPortal(
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pvps-zone-filter-title"
          onClick={() => {
            if (adminBusy) return;
            setShowZoneFilterPopup(false);
          }}
        >
          <div className="confirm-dialog surface-enter pvps-zone-popup-card" onClick={(event) => event.stopPropagation()}>
            <h3 id="pvps-zone-filter-title">Filtro de zonas ({tab.toUpperCase()})</h3>
            <div className="form-grid">
              <label>
                Pesquisar zona
                <input
                  value={zoneSearch}
                  onChange={(event) => setZoneSearch(event.target.value.toUpperCase())}
                  placeholder="Ex.: A001"
                />
              </label>
            </div>

            <div className="pvps-zone-picker-actions">
              <button
                className="btn btn-muted pvps-zone-action-btn"
                type="button"
                onClick={() => setSelectedZones([])}
                title="Limpar seleção"
                aria-label="Limpar seleção"
              >
                <span className="pvps-btn-icon" aria-hidden="true">{clearSelectionIcon()}</span>
                <span className="pvps-zone-action-label">Limpar</span>
              </button>
              <button
                className="btn btn-muted pvps-zone-action-btn"
                type="button"
                onClick={() => setSelectedZones(filteredZones)}
                title="Selecionar filtradas"
                aria-label="Selecionar filtradas"
              >
                <span className="pvps-btn-icon" aria-hidden="true">{selectFilteredIcon()}</span>
                <span className="pvps-zone-action-label">Selecionar</span>
              </button>
            </div>

            <div className="pvps-zone-list">
              {filteredZones.length === 0 ? <p>Sem zonas para este filtro.</p> : null}
              {filteredZones.map((zone) => (
                <label key={zone} className="pvps-zone-item">
                  <input type="checkbox" checked={selectedZones.includes(zone)} onChange={() => toggleZone(zone)} />
                  <span>{zone}</span>
                </label>
              ))}
            </div>

            <div className="confirm-actions">
              {isAdmin ? (
                <button
                  className="btn btn-danger"
                  type="button"
                  disabled={adminBusy || selectedZones.length === 0}
                  onClick={() => setShowDiscardZonesConfirm(true)}
                >
                  Descartar zonas selecionadas (repos. auto)
                </button>
              ) : null}
              <button className="btn btn-primary" type="button" onClick={() => setShowZoneFilterPopup(false)}>
                Aplicar filtro
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {showDiscardZonesConfirm && typeof document !== "undefined"
        ? createPortal(
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pvps-discard-zones-title"
          onClick={() => {
            if (adminBusy) return;
            setShowDiscardZonesConfirm(false);
          }}
        >
          <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
            <h3 id="pvps-discard-zones-title">Descartar zonas selecionadas</h3>
            <p>
              Esta ação remove da fila atual da aba <strong>{tab.toUpperCase()}</strong> as zonas selecionadas:
              <strong> {selectedZones.join(", ") || "-"}</strong>.
            </p>
            <p>A reposição será automática com os próximos itens previstos.</p>
            <div className="confirm-actions">
              <button className="btn btn-muted" type="button" disabled={adminBusy} onClick={() => setShowDiscardZonesConfirm(false)}>
                Cancelar
              </button>
              <button className="btn btn-danger" type="button" disabled={adminBusy} onClick={() => void handleDiscardSelectedZones()}>
                {adminBusy ? "Descartando..." : "Confirmar descarte"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
