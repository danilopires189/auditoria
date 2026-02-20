import { FormEvent, useEffect, useMemo, useState } from "react";
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

function pvpsHistoryStatus(row: PvpsCompletedRow): { label: string; emoticon: string; tone: HistoryStatusTone } {
  if (row.end_sit === "vazio" || row.end_sit === "obstruido") {
    return { label: "Ocorrência", emoticon: ":/", tone: "warn" };
  }
  if (row.pul_auditados < 1) {
    return { label: "Aguardando validade Pulmão", emoticon: "...", tone: "wait" };
  }
  if (row.pul_has_lower || row.status === "nao_conforme") {
    return { label: "Não conforme", emoticon: ":(", tone: "bad" };
  }
  return { label: "Conforme", emoticon: ":)", tone: "ok" };
}

function alocHistoryStatus(row: AlocacaoCompletedRow): { label: string; emoticon: string; tone: HistoryStatusTone } {
  if (row.aud_sit === "ocorrencia") {
    return { label: "Ocorrência", emoticon: ":/", tone: "warn" };
  }
  if (row.aud_sit === "nao_conforme") {
    return { label: "Não conforme", emoticon: ":(", tone: "bad" };
  }
  return { label: "Conforme", emoticon: ":)", tone: "ok" };
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

  const [endSit, setEndSit] = useState<PvpsEndSit | "">("");
  const [valSep, setValSep] = useState("");
  const [pulInputs, setPulInputs] = useState<Record<string, string>>({});

  const [activeAlocQueue, setActiveAlocQueue] = useState<string | null>(null);
  const activeAloc = useMemo(
    () => alocRows.find((row) => row.queue_id === activeAlocQueue) ?? null,
    [alocRows, activeAlocQueue]
  );
  const [alocEndSit, setAlocEndSit] = useState<PvpsEndSit | "">("");
  const [alocValConf, setAlocValConf] = useState("");
  const [alocResult, setAlocResult] = useState<AlocacaoSubmitResult | null>(null);
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
  const [editingPvpsCompleted, setEditingPvpsCompleted] = useState<PvpsCompletedRow | null>(null);
  const [editingAlocCompleted, setEditingAlocCompleted] = useState<AlocacaoCompletedRow | null>(null);
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

  async function loadCurrent(): Promise<void> {
    setBusy(true);
    setErrorMessage(null);
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
      setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar dados.");
    } finally {
      setBusy(false);
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
    const interval = window.setInterval(() => {
      void loadCurrent();
    }, 10000);
    const onFocus = () => { void loadCurrent(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, tab, activeCd, todayBrt, feedView]);

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
          await loadCurrent();
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
      return;
    }

    setPulBusy(true);
    void fetchPvpsPulItems(activePvps.coddv, activePvps.end_sep, activeCd)
      .then((items) => {
        setFeedPulBySepKey((current) => ({ ...current, [keyOfPvps(activePvps)]: items }));
        setPulItems(items);
        const mapped: Record<string, string> = {};
        for (const item of items) {
          mapped[item.end_pul] = item.val_pul?.replace("/", "") ?? "";
        }
        setPulInputs(mapped);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar PUL.");
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

  const zones = useMemo(() => {
    const source = tab === "pvps" ? pvpsRows.map((row) => row.zona) : alocRows.map((row) => row.zona);
    return Array.from(new Set(source)).sort((a, b) => a.localeCompare(b));
  }, [tab, pvpsRows, alocRows]);

  const filteredZones = useMemo(() => {
    const q = zoneSearch.trim().toLocaleLowerCase("pt-BR");
    if (!q) return zones;
    return zones.filter((zone) => zone.toLocaleLowerCase("pt-BR").includes(q));
  }, [zones, zoneSearch]);

  const filteredPvpsRows = useMemo(() => {
    if (!selectedZones.length) return pvpsRows;
    const selected = new Set(selectedZones);
    return pvpsRows.filter((row) => selected.has(row.zona));
  }, [pvpsRows, selectedZones]);

  const filteredAlocRows = useMemo(() => {
    if (!selectedZones.length) return alocRows;
    const selected = new Set(selectedZones);
    return alocRows.filter((row) => selected.has(row.zona));
  }, [alocRows, selectedZones]);

  const filteredPvpsCompletedRows = useMemo(() => {
    if (!selectedZones.length) return pvpsCompletedRows;
    const selected = new Set(selectedZones);
    return pvpsCompletedRows.filter((row) => selected.has(row.zona));
  }, [pvpsCompletedRows, selectedZones]);

  const filteredAlocCompletedRows = useMemo(() => {
    if (!selectedZones.length) return alocCompletedRows;
    const selected = new Set(selectedZones);
    return alocCompletedRows.filter((row) => selected.has(row.zona));
  }, [alocCompletedRows, selectedZones]);

  const sortedPvpsRows = useMemo(
    () => [...filteredPvpsRows].sort((a, b) => {
      const byZone = a.zona.localeCompare(b.zona);
      if (byZone !== 0) return byZone;
      const byEndereco = a.end_sep.localeCompare(b.end_sep);
      if (byEndereco !== 0) return byEndereco;
      return a.coddv - b.coddv;
    }),
    [filteredPvpsRows]
  );

  const sortedAlocRows = useMemo(
    () => [...filteredAlocRows].sort((a, b) => {
      const byZone = a.zona.localeCompare(b.zona);
      if (byZone !== 0) return byZone;
      const byEndereco = a.endereco.localeCompare(b.endereco);
      if (byEndereco !== 0) return byEndereco;
      return a.coddv - b.coddv;
    }),
    [filteredAlocRows]
  );

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

  const pvpsFeedItems = useMemo<PvpsFeedItem[]>(() => {
    const items: PvpsFeedItem[] = [];
    for (const row of sortedPvpsRows) {
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
          zone: row.zona,
          endereco: item.end_pul,
          endPul: item.end_pul
        });
      }
    }
    return items;
  }, [sortedPvpsRows, feedPulBySepKey]);

  const activePvpsFeedKey = useMemo(() => {
    if (!activePvpsKey) return null;
    if (activePvpsMode === "pul" && activePulEnd) {
      return `pul:${activePvpsKey}:${activePulEnd}`;
    }
    return `sep:${activePvpsKey}`;
  }, [activePvpsKey, activePvpsMode, activePulEnd]);

  useEffect(() => {
    if (tab !== "pvps" || feedView !== "pendentes" || activeCd == null) return;
    const pendingPulRows = sortedPvpsRows.filter((row) => row.status === "pendente_pul");
    const missingRows = pendingPulRows.filter((row) => feedPulBySepKey[keyOfPvps(row)] == null);
    if (!missingRows.length) return;

    let cancelled = false;
    const loadMissing = async () => {
      const updates: Record<string, PvpsPulItemRow[]> = {};
      await Promise.all(missingRows.map(async (row) => {
        try {
          const items = await fetchPvpsPulItems(row.coddv, row.end_sep, activeCd);
          updates[keyOfPvps(row)] = items;
        } catch {
          updates[keyOfPvps(row)] = [];
        }
      }));
      if (cancelled || !Object.keys(updates).length) return;
      setFeedPulBySepKey((current) => ({ ...current, ...updates }));
    };
    void loadMissing();
    return () => {
      cancelled = true;
    };
  }, [tab, feedView, sortedPvpsRows, activeCd, feedPulBySepKey]);

  useEffect(() => {
    if (tab === "pvps") {
      if (!sortedPvpsRows.some((row) => keyOfPvps(row) === activePvpsKey)) {
        setActivePvpsKey(sortedPvpsRows[0] ? keyOfPvps(sortedPvpsRows[0]) : null);
      }
      return;
    }
    if (!sortedAlocRows.some((row) => row.queue_id === activeAlocQueue)) {
      setActiveAlocQueue(sortedAlocRows[0]?.queue_id ?? null);
    }
  }, [tab, sortedPvpsRows, sortedAlocRows, activePvpsKey, activeAlocQueue]);

  const nextQueueItems = useMemo(() => {
    if (tab === "pvps") {
      const start = activePvpsFeedKey
        ? Math.max(pvpsFeedItems.findIndex((item) => item.feedKey === activePvpsFeedKey), 0) + 1
        : 0;
      return pvpsFeedItems.slice(start, start + 5).map((item) => ({
        key: item.feedKey,
        coddv: item.row.coddv,
        descricao: item.row.descricao,
        endereco: item.endereco,
        dat_ult_compra: item.row.dat_ult_compra
      }));
    }
    const start = activeAlocQueue
      ? Math.max(sortedAlocRows.findIndex((row) => row.queue_id === activeAlocQueue), 0) + 1
      : 0;
    return sortedAlocRows.slice(start, start + 5).map((row) => ({
      key: `aloc:${row.queue_id}`,
      coddv: row.coddv,
      descricao: row.descricao,
      endereco: row.endereco,
      dat_ult_compra: row.dat_ult_compra
    }));
  }, [tab, pvpsFeedItems, sortedAlocRows, activePvpsFeedKey, activeAlocQueue]);

  function openPvpsPopup(row: PvpsManifestRow): void {
    if (row.status === "pendente_pul") {
      const pendingPulItems = (feedPulBySepKey[keyOfPvps(row)] ?? []).filter((item) => !item.auditado);
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
    setEditingPvpsCompleted(null);
    setActivePvpsMode("pul");
    setActivePulEnd(endPul);
    setActivePvpsKey(keyOfPvps(row));
    setShowPvpsPopup(true);
  }

  function openAlocPopup(row: AlocacaoManifestRow): void {
    setEditingAlocCompleted(null);
    setActiveAlocQueue(row.queue_id);
    setAlocEndSit("");
    setAlocValConf("");
    setAlocResult(null);
    setShowAlocPopup(true);
  }

  function closePvpsPopup(): void {
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

  function toggleExpandedPvpsCompleted(key: string): void {
    setExpandedPvpsCompleted((prev) => ({ ...prev, [key]: !prev[key] }));
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

  function openNextPvpsFrom(currentKey: string, currentZone?: string | null): void {
    const index = sortedPvpsRows.findIndex((row) => keyOfPvps(row) === currentKey);
    const fallbackZone = index >= 0 ? sortedPvpsRows[index]?.zona ?? null : null;
    const targetZone = currentZone ?? fallbackZone;
    const startAt = index >= 0 ? index + 1 : 0;
    let next: PvpsManifestRow | undefined;
    if (targetZone) {
      next = sortedPvpsRows.find((row, rowIndex) => rowIndex >= startAt && row.zona === targetZone);
    }
    if (next) {
      const nextKey = keyOfPvps(next);
      if (next.status === "pendente_pul") {
        const pendingPulItems = (feedPulBySepKey[nextKey] ?? []).filter((item) => !item.auditado);
        const firstPendingPul = pendingPulItems[0];
        if (firstPendingPul) {
          openPvpsPulPopup(next, firstPendingPul.end_pul);
          return;
        }
      }
      openPvpsPopup(next);
    } else {
      closePvpsPopup();
    }
  }

  function openNextAlocacaoFrom(currentQueueId: string, currentZone?: string | null): void {
    const index = sortedAlocRows.findIndex((row) => row.queue_id === currentQueueId);
    const fallbackZone = index >= 0 ? sortedAlocRows[index]?.zona ?? null : null;
    const targetZone = currentZone ?? fallbackZone;
    const startAt = index >= 0 ? index + 1 : 0;
    let next: AlocacaoManifestRow | undefined;
    if (targetZone) {
      next = sortedAlocRows.find((row, rowIndex) => rowIndex >= startAt && row.zona === targetZone);
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
      setErrorMessage("Validade SEP obrigatória (mmaa) quando não houver ocorrência.");
      return;
    }
    const currentKey = keyOfPvps(activePvps);
    const currentZone = activePvps.zona;
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
          setStatusMessage("SEP com ocorrência salva offline. Item retirado localmente e será sincronizado ao reconectar.");
          closePvpsPopup();
        } else {
          const localVal = `${normalizedValSep.slice(0, 2)}/${normalizedValSep.slice(2)}`;
          setPvpsRows((current) => current.map((row) => (
            keyOfPvps(row) === currentKey
              ? { ...row, status: "pendente_pul", val_sep: localVal, end_sit: null }
              : row
          )));
          setStatusMessage("SEP salva offline. PUL liberado localmente e será sincronizado ao reconectar.");
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar SEP offline.");
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
        setStatusMessage("SEP com ocorrência. Item removido do feed e não será enviado ao frontend.");
      } else {
        setStatusMessage(`SEP salva. PUL liberado: ${result.pul_auditados}/${result.pul_total} auditados.`);
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
        const items = await fetchPvpsPulItems(activePvps.coddv, activePvps.end_sep, activeCd);
        setFeedPulBySepKey((current) => ({ ...current, [currentKey]: items }));
        setPulItems(items);
        openNextPvpsFrom(currentKey, currentZone);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar etapa SEP.");
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
    const value = pulInputs[endPul] ?? "";
    if (value.trim().length !== 4) {
      setErrorMessage("Validade PUL obrigatória (mmaa).");
      return;
    }

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
        setErrorMessage("Para informar PUL offline, salve primeiro a linha SEP no mesmo endereço.");
        return;
      }
      try {
        await saveOfflinePulEvent({
          cd: activeCd,
          coddv: activePvps.coddv,
          end_sep: activePvps.end_sep,
          end_pul: endPul,
          val_pul: value.trim(),
          audit_id: activePvps.audit_id
        });
        setPulInputs((prev) => ({ ...prev, [endPul]: "" }));
        setStatusMessage("PUL salvo localmente (offline). Será sincronizado automaticamente ao reconectar.");
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar PUL offline.");
      }
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    const currentKey = keyOfPvps(activePvps);
    const currentZone = activePvps.zona;
    const isEditingCompleted = Boolean(editingPvpsCompleted);
    try {
      let auditId = activePvps.audit_id;
      if (!auditId) {
        const rows = await fetchPvpsManifest({ p_cd: activeCd, zona: null });
        auditId = rows.find((row) => row.coddv === activePvps.coddv && row.end_sep === activePvps.end_sep)?.audit_id ?? null;
      }
      if (!auditId) {
        setErrorMessage("AUDIT_ID_PVPS_NAO_DISPONIVEL. Sincronize a SEP antes de salvar PUL online.");
        return;
      }
      const result = await submitPvpsPul({
        p_cd: activeCd,
        audit_id: auditId,
        end_pul: endPul,
        val_pul: value
      });
      if (result.status === "concluido") {
        setStatusMessage("PVPS concluído com conformidade (VAL_SEP <= VAL_PUL). Feed atualizado automaticamente.");
      } else if (result.status === "nao_conforme") {
        setStatusMessage("PVPS concluído sem conformidade: existe PUL com validade menor que SEP.");
      } else {
        setStatusMessage(`PUL salvo. ${result.pul_auditados}/${result.pul_total} auditados.`);
      }
      await loadCurrent();
      if (isEditingCompleted) {
        setEditingPvpsCompleted(null);
        closePvpsPopup();
      } else if (result.status === "pendente_pul") {
        const items = await fetchPvpsPulItems(activePvps.coddv, activePvps.end_sep, activeCd);
        setFeedPulBySepKey((current) => ({ ...current, [currentKey]: items }));
        setPulItems(items);
        const pendingPulItems = items.filter((item) => !item.auditado);
        if (pendingPulItems.length === 0) {
          closePvpsPopup();
        } else {
          const currentPulIndex = pendingPulItems.findIndex((item) => item.end_pul === endPul);
          const nextPul = pendingPulItems[currentPulIndex + 1] ?? pendingPulItems[0];
          setActivePvpsMode("pul");
          setActivePulEnd(nextPul.end_pul);
          setShowPvpsPopup(true);
        }
      } else {
        openNextPvpsFrom(currentKey, currentZone);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar etapa PUL.");
    } finally {
      setBusy(false);
    }
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
      setErrorMessage("Validade conferida obrigatória (mmaa) quando não houver ocorrência.");
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
      setStatusMessage(result.aud_sit === "ocorrencia"
        ? "Alocação auditada com ocorrência. Feed atualizado automaticamente."
        : `Alocação auditada: ${result.aud_sit}. Feed atualizado automaticamente.`);
      await loadCurrent();
      setEditingAlocCompleted(null);
      setAlocEndSit("");
      setAlocValConf("");
      if (isEditingCompleted) {
        setShowAlocPopup(false);
      } else {
        openNextAlocacaoFrom(currentQueueId, currentZone);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar auditoria de alocação.");
    } finally {
      setBusy(false);
    }
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
            <span className="module-user-greeting">Olá, {displayUserName}</span>
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>{isOnline ? "Online" : "Offline"}</span>
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
                <h2>Auditoria por zona</h2>
                <p>PVPS: PUL só libera quando SEP for salva sem ocorrência.</p>
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
                    <button type="button" className="btn btn-muted pvps-toolbar-btn" onClick={() => void loadCurrent()} disabled={busy}>
                      <span className="pvps-btn-icon" aria-hidden="true">{refreshIcon()}</span>
                      <span>{busy ? "Atualizando..." : "Atualizar"}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="pvps-toolbar-group">
              <small className="pvps-toolbar-label">Tipo</small>
              <div className="pvps-tabs">
                <button type="button" className={`btn btn-muted pvps-toolbar-btn${tab === "pvps" ? " is-active" : ""}`} onClick={() => setTab("pvps")}>
                  <span className="pvps-btn-icon" aria-hidden="true">{listIcon()}</span>
                  <span>PVPS</span>
                </button>
                <button type="button" className={`btn btn-muted pvps-toolbar-btn${tab === "alocacao" ? " is-active" : ""}`} onClick={() => setTab("alocacao")}>
                  <span className="pvps-btn-icon" aria-hidden="true">{listIcon()}</span>
                  <span>Alocação</span>
                </button>
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
                  ? (sortedPvpsRows.length === 0
                    ? <p>Nenhum item PVPS pendente para os filtros atuais.</p>
                    : <p>Carregando endereços PUL pendentes...</p>)
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
                            {item.kind === "pul" ? <small>PUL pendente</small> : null}
                          </div>
                          <div className="pvps-row-actions">
                            <button
                              className="btn btn-primary pvps-icon-btn"
                              type="button"
                              onClick={() => {
                                if (item.kind === "pul") {
                                  openPvpsPulPopup(row, item.endPul);
                                } else {
                                  openPvpsPopup(row);
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
                              <small>Linha SEP {row.end_sep} | Validade linha {row.val_sep ?? "-"}</small>
                            ) : (
                              <small>Status {row.status} | PUL {row.pul_auditados}/{row.pul_total}</small>
                            )}
                            {item.kind === "pul" ? (
                              <small>Ocorrência linha: {row.end_sit ?? "sem ocorrência"}</small>
                            ) : null}
                            <small>Última compra: {formatDate(row.dat_ult_compra)}</small>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                <div className="pvps-recent-box">
                  <h4>Próximos a entrar na lista (até 5)</h4>
                  {nextQueueItems.length === 0 ? <p>Não há próximos itens para a fila atual.</p> : nextQueueItems.map((item) => (
                    <div key={item.key} className="pvps-recent-row">
                      <span>{item.endereco}</span>
                      <small>{item.coddv} - {item.descricao} | Última compra: {formatDate(item.dat_ult_compra)}</small>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {feedView === "pendentes" && tab === "alocacao" ? (
              <div className="pvps-list">
                {sortedAlocRows.length === 0 ? <p>Nenhum item de Alocação pendente para os filtros atuais.</p> : null}
                {sortedAlocRows.map((row, index) => {
                  const open = Boolean(expandedAloc[row.queue_id]);
                  const previous = index > 0 ? sortedAlocRows[index - 1] : null;
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
                  <h4>Próximos a entrar na lista (até 5)</h4>
                  {nextQueueItems.length === 0 ? <p>Não há próximos itens para a fila atual.</p> : nextQueueItems.map((item) => (
                    <div key={item.key} className="pvps-recent-row">
                      <span>{item.endereco}</span>
                      <small>{item.coddv} - {item.descricao} | Última compra: {formatDate(item.dat_ult_compra)}</small>
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
                            <button className="btn btn-muted pvps-icon-btn" type="button" onClick={() => toggleExpandedPvpsCompleted(row.audit_id)} title="Expandir">
                              {chevronIcon(open)}
                            </button>
                          </div>
                        </div>
                        {open ? (
                          <div className="pvps-row-details">
                            <small>PUL auditados: {row.pul_auditados}/{row.pul_total}</small>
                            {row.pul_has_lower ? (
                              <small>
                                PUL com validade menor: {row.pul_lower_end ?? "-"} ({row.pul_lower_val ?? "-"})
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
                ? "Editar PVPS concluído"
                : activePvpsMode === "pul"
                  ? "Informar PVPS - PUL"
                  : "Informar PVPS - SEP"}
            </h3>
            <p>SEP: <strong>{activePvps.end_sep}</strong> | CODDV: <strong>{activePvps.coddv}</strong></p>
            <p>Produto: {activePvps.descricao}</p>
            <p>Zona: <strong>{activePvps.zona}</strong> | Status: <strong>{activePvps.status}</strong></p>
            <p>Data última compra: <strong>{formatDate(activePvps.dat_ult_compra)}</strong></p>
            {editingPvpsCompleted ? <p>Última auditoria: <strong>{formatDateTime(editingPvpsCompleted.dt_hr)}</strong></p> : null}

            {activePvpsMode === "sep" ? (
              <form className="form-grid" onSubmit={(event) => void handleSubmitSep(event)}>
                {endSit !== "vazio" && endSit !== "obstruido" ? (
                  <label>
                    Validade SEP (mmaa)
                    <input
                      value={valSep}
                      onChange={(event) => setValSep(event.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder="mmaa"
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
                <button className="btn btn-primary" type="submit" disabled={busy}>Salvar etapa SEP</button>
              </form>
            ) : null}

            {activePvpsMode === "pul" ? (
              <div className="pvps-pul-box">
                <h4>Etapa PUL individual</h4>
                <p>Linha SEP: <strong>{activePvps.end_sep}</strong> | Validade linha: <strong>{activePvps.val_sep ?? "-"}</strong></p>
                <p>Ocorrência linha: <strong>{activePvps.end_sit ?? "sem ocorrência"}</strong></p>
                {pulBusy ? <p>Carregando endereços PUL...</p> : null}
                {!pulBusy && !activePulItem ? <p>Endereço PUL não encontrado no feed atual.</p> : null}
                {activePulItem ? (
                  <div className="pvps-pul-row">
                    <div>
                      <strong>{activePulItem.end_pul}</strong>
                      <small>{activePulItem.auditado ? "Auditado" : "Pendente"}</small>
                    </div>
                    <input
                      value={pulInputs[activePulItem.end_pul] ?? ""}
                      onChange={(event) => setPulInputs((prev) => ({ ...prev, [activePulItem.end_pul]: event.target.value.replace(/\D/g, "").slice(0, 4) }))}
                      placeholder="mmaa"
                      maxLength={4}
                      inputMode="numeric"
                      pattern="[0-9]*"
                    />
                    <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void handleSubmitPul(activePulItem.end_pul)}>
                      Salvar PUL
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
            setShowAlocPopup(false);
          }}
        >
          <div className="confirm-dialog surface-enter pvps-popup-card" onClick={(event) => event.stopPropagation()}>
            <h3 id="aloc-inform-title">{editingAlocCompleted ? "Editar Alocação concluída" : "Informar Alocação"}</h3>
            <p>Endereço: <strong>{activeAloc.endereco}</strong> | CODDV: <strong>{activeAloc.coddv}</strong></p>
            <p>Produto: {activeAloc.descricao}</p>
            <p>Zona: <strong>{activeAloc.zona}</strong> | Andar: <strong>{formatAndar(activeAloc.nivel)}</strong></p>
            <p>Data última compra: <strong>{formatDate(activeAloc.dat_ult_compra)}</strong></p>
            {editingAlocCompleted ? <p>Última auditoria: <strong>{formatDateTime(editingAlocCompleted.dt_hr)}</strong></p> : null}

            <form className="form-grid" onSubmit={(event) => void handleSubmitAlocacao(event)}>
              {alocEndSit !== "vazio" && alocEndSit !== "obstruido" ? (
                <label>
                  Validade conferida (mmaa)
                  <input
                    value={alocValConf}
                    onChange={(event) => setAlocValConf(event.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="mmaa"
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
              <button className="btn btn-primary" type="submit" disabled={busy}>Salvar Alocação</button>
            </form>

            {alocResult ? (
              <div className={`pvps-result-chip ${alocResult.aud_sit === "conforme" ? "ok" : alocResult.aud_sit === "ocorrencia" ? "" : "bad"}`}>
                Resultado: {alocResult.aud_sit === "conforme" ? "Conforme" : alocResult.aud_sit === "ocorrencia" ? "Ocorrência" : "Não conforme"}
                {alocResult.aud_sit === "ocorrencia"
                  ? ""
                  : ` | Sistema: ${alocResult.val_sist} | Informado: ${alocResult.val_conf ?? "-"}`}
              </div>
            ) : null}

            <div className="confirm-actions">
              <button className="btn btn-muted" type="button" disabled={busy} onClick={() => {
                setEditingAlocCompleted(null);
                setAlocResult(null);
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
