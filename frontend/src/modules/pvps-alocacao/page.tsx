import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import {
  clearZone,
  fetchAdminBlacklist,
  fetchAdminPriorityZones,
  fetchAlocacaoManifest,
  fetchPvpsManifest,
  fetchPvpsPulItems,
  removeAdminBlacklist,
  removeAdminPriorityZone,
  reseedByZone,
  submitAlocacao,
  submitPvpsPul,
  submitPvpsSep,
  upsertAdminBlacklist,
  upsertAdminPriorityZone
} from "./sync";
import type {
  AlocacaoManifestRow,
  AlocacaoSubmitResult,
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
type RecentFeedItem = {
  key: string;
  tab: ModuleTab;
  coddv: number;
  descricao: string;
  endereco: string;
  dat_ult_compra: string;
  added_at: string;
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

export default function PvpsAlocacaoPage({ isOnline, profile }: PvpsAlocacaoPageProps) {
  const displayUserName = toDisplayName(profile.nome);
  const isAdmin = profile.role === "admin";

  const [tab, setTab] = useState<ModuleTab>("pvps");
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [showZoneFilterPopup, setShowZoneFilterPopup] = useState(false);
  const [zoneSearch, setZoneSearch] = useState("");
  const [showDiscardZonesConfirm, setShowDiscardZonesConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [pvpsRows, setPvpsRows] = useState<PvpsManifestRow[]>([]);
  const [alocRows, setAlocRows] = useState<AlocacaoManifestRow[]>([]);

  const [activePvpsKey, setActivePvpsKey] = useState<string | null>(null);
  const activePvps = useMemo(
    () => pvpsRows.find((row) => keyOfPvps(row) === activePvpsKey) ?? null,
    [pvpsRows, activePvpsKey]
  );

  const [pulItems, setPulItems] = useState<PvpsPulItemRow[]>([]);
  const [pulBusy, setPulBusy] = useState(false);

  const [endSit, setEndSit] = useState<PvpsEndSit | "">("");
  const [valSep, setValSep] = useState("");
  const [pulInputs, setPulInputs] = useState<Record<string, string>>({});

  const [activeAlocQueue, setActiveAlocQueue] = useState<string | null>(null);
  const activeAloc = useMemo(
    () => alocRows.find((row) => row.queue_id === activeAlocQueue) ?? null,
    [alocRows, activeAlocQueue]
  );
  const [alocEndSit, setAlocEndSit] = useState<PvpsEndSit>("vazio");
  const [alocValConf, setAlocValConf] = useState("");
  const [alocResult, setAlocResult] = useState<AlocacaoSubmitResult | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
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
  const [recentFeedItems, setRecentFeedItems] = useState<RecentFeedItem[]>([]);

  function appendRecentItems(items: RecentFeedItem[]): void {
    if (!items.length) return;
    setRecentFeedItems((previous) => {
      const merged = [...items, ...previous];
      const unique = new Map<string, RecentFeedItem>();
      for (const item of merged) {
        if (!unique.has(item.key)) unique.set(item.key, item);
      }
      return Array.from(unique.values())
        .sort((a, b) => Date.parse(b.added_at) - Date.parse(a.added_at))
        .slice(0, 5);
    });
  }

  async function loadAdminData(): Promise<void> {
    if (!isAdmin) return;
    setAdminBusy(true);
    try {
      const [blacklist, priority] = await Promise.all([
        fetchAdminBlacklist("ambos"),
        fetchAdminPriorityZones("ambos")
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
        const rows = await fetchPvpsManifest({ zona: null });
        const previousKeys = new Set(pvpsRows.map((row) => keyOfPvps(row)));
        const added = rows
          .filter((row) => !previousKeys.has(keyOfPvps(row)))
          .map((row) => ({
            key: `pvps:${keyOfPvps(row)}`,
            tab: "pvps" as const,
            coddv: row.coddv,
            descricao: row.descricao,
            endereco: row.end_sep,
            dat_ult_compra: row.dat_ult_compra,
            added_at: new Date().toISOString()
          }));
        appendRecentItems(added);
        setPvpsRows(rows);
        if (!rows.some((row) => keyOfPvps(row) === activePvpsKey)) {
          setActivePvpsKey(rows[0] ? keyOfPvps(rows[0]) : null);
          if (!rows[0]) setShowPvpsPopup(false);
        }
      } else {
        const rows = await fetchAlocacaoManifest({ zona: null });
        const previousKeys = new Set(alocRows.map((row) => row.queue_id));
        const added = rows
          .filter((row) => !previousKeys.has(row.queue_id))
          .map((row) => ({
            key: `aloc:${row.queue_id}`,
            tab: "alocacao" as const,
            coddv: row.coddv,
            descricao: row.descricao,
            endereco: row.endereco,
            dat_ult_compra: row.dat_ult_compra,
            added_at: new Date().toISOString()
          }));
        appendRecentItems(added);
        setAlocRows(rows);
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
  }, [tab]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (!activePvps) {
      setPulItems([]);
      setPulInputs({});
      return;
    }

    setEndSit(activePvps.end_sit ?? "");
    setValSep(activePvps.val_sep?.replace("/", "") ?? "");

    if (!activePvps.audit_id) {
      setPulItems([]);
      setPulInputs({});
      return;
    }

    setPulBusy(true);
    void fetchPvpsPulItems(activePvps.coddv, activePvps.end_sep)
      .then((items) => {
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
  }, [activePvps]);

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

  useEffect(() => {
    if (tab === "pvps") {
      if (!filteredPvpsRows.some((row) => keyOfPvps(row) === activePvpsKey)) {
        setActivePvpsKey(filteredPvpsRows[0] ? keyOfPvps(filteredPvpsRows[0]) : null);
      }
      return;
    }
    if (!filteredAlocRows.some((row) => row.queue_id === activeAlocQueue)) {
      setActiveAlocQueue(filteredAlocRows[0]?.queue_id ?? null);
    }
  }, [tab, filteredPvpsRows, filteredAlocRows, activePvpsKey, activeAlocQueue]);

  const recentForCurrentTab = useMemo(
    () => recentFeedItems.filter((item) => item.tab === tab).slice(0, 5),
    [recentFeedItems, tab]
  );

  function openPvpsPopup(row: PvpsManifestRow): void {
    setActivePvpsKey(keyOfPvps(row));
    setShowPvpsPopup(true);
  }

  function openAlocPopup(row: AlocacaoManifestRow): void {
    setActiveAlocQueue(row.queue_id);
    setShowAlocPopup(true);
  }

  async function handleSubmitSep(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!activePvps) return;

    setBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await submitPvpsSep({
        coddv: activePvps.coddv,
        end_sep: activePvps.end_sep,
        end_sit: endSit || null,
        val_sep: valSep
      });
      if (result.end_sit === "vazio" || result.end_sit === "obstruido") {
        setStatusMessage("SEP flagada (vazio/obstruído). Item removido do feed e não será enviado ao frontend.");
        setShowPvpsPopup(false);
      } else {
        setStatusMessage(`SEP salva. PUL liberado: ${result.pul_auditados}/${result.pul_total} auditados.`);
      }
      await loadCurrent();
      const items = await fetchPvpsPulItems(activePvps.coddv, activePvps.end_sep);
      setPulItems(items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao salvar etapa SEP.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitPul(endPul: string): Promise<void> {
    if (!activePvps?.audit_id) return;
    const value = pulInputs[endPul] ?? "";

    setBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await submitPvpsPul({
        audit_id: activePvps.audit_id,
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
      if (result.status === "pendente_pul") {
        const items = await fetchPvpsPulItems(activePvps.coddv, activePvps.end_sep);
        setPulItems(items);
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
    try {
      const result = await submitAlocacao({
        queue_id: activeAloc.queue_id,
        end_sit: alocEndSit,
        val_conf: alocValConf
      });
      setAlocResult(result);
      setStatusMessage(`Alocação auditada: ${result.aud_sit}. Feed atualizado automaticamente.`);
      await loadCurrent();
      setAlocValConf("");
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
                <p>PVPS: PUL só libera quando SEP for salva sem flag (vazio/obstruído).</p>
              </div>
              <div className="pvps-actions">
                <button type="button" className="btn btn-muted" onClick={() => setTab("pvps")} disabled={busy}>
                  Iniciar PVPS
                </button>
                <button type="button" className="btn btn-muted" onClick={() => setTab("alocacao")} disabled={busy}>
                  Iniciar Alocação
                </button>
                <button type="button" className="btn btn-muted" onClick={() => void loadCurrent()} disabled={busy}>
                  {busy ? "Atualizando..." : "Atualizar"}
                </button>
              </div>
            </div>

            <div className="pvps-tabs">
              <button type="button" className={`btn btn-muted${tab === "pvps" ? " is-active" : ""}`} onClick={() => setTab("pvps")}>PVPS</button>
              <button type="button" className={`btn btn-muted${tab === "alocacao" ? " is-active" : ""}`} onClick={() => setTab("alocacao")}>Alocação</button>
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

            <div className="pvps-filter-row">
              <button className="btn btn-muted" type="button" onClick={() => setShowZoneFilterPopup(true)}>
                Filtrar zonas {selectedZones.length > 0 ? `(${selectedZones.length})` : "(todas)"}
              </button>
            </div>

            {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
            {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
            <div className="pvps-recent-box">
              <h4>Recém adicionados no feed (últimos 5)</h4>
              {recentForCurrentTab.length === 0 ? (
                <p>Nenhum item novo detectado nesta sessão.</p>
              ) : (
                recentForCurrentTab.map((item) => (
                  <div key={item.key} className="pvps-recent-row">
                    <span>{item.coddv} - {item.descricao}</span>
                    <small>{item.endereco} | Última compra: {formatDate(item.dat_ult_compra)}</small>
                  </div>
                ))
              )}
            </div>

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
            {tab === "pvps" ? (
              <div className="pvps-grid">
                <div className="pvps-list">
                  {filteredPvpsRows.length === 0 ? <p>Nenhum item PVPS pendente para os filtros atuais.</p> : null}
                  {filteredPvpsRows.map((row) => {
                    const active = keyOfPvps(row) === activePvpsKey;
                    return (
                      <div key={keyOfPvps(row)} className={`pvps-row${active ? " is-active" : ""}`}>
                        <strong>{row.end_sep}</strong>
                        <span>{row.coddv} - {row.descricao}</span>
                        <small>{row.zona} | PUL {row.pul_auditados}/{row.pul_total} | {row.status}</small>
                        <small>Última compra: {formatDate(row.dat_ult_compra)}</small>
                        <button className="btn btn-primary pvps-inform-btn" type="button" onClick={() => openPvpsPopup(row)}>
                          Informar
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="pvps-editor">
                  {!activePvps ? <p>Selecione um item PVPS para auditar.</p> : (
                    <>
                      <h3>Item selecionado: SEP {activePvps.end_sep}</h3>
                      <p>Produto: {activePvps.coddv} - {activePvps.descricao}</p>
                      <p>Última compra: {formatDate(activePvps.dat_ult_compra)}</p>
                      <button className="btn btn-primary" type="button" onClick={() => setShowPvpsPopup(true)}>
                        Abrir popup para informar
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="pvps-grid">
                <div className="pvps-list">
                  {filteredAlocRows.length === 0 ? <p>Nenhum item de Alocação pendente para os filtros atuais.</p> : null}
                  {filteredAlocRows.map((row) => (
                    <div key={row.queue_id} className={`pvps-row${row.queue_id === activeAlocQueue ? " is-active" : ""}`}>
                      <strong>{row.endereco}</strong>
                      <span>{row.coddv} - {row.descricao}</span>
                      <small>{row.zona} | Nível {row.nivel ?? "-"}</small>
                      <small>Última compra: {formatDate(row.dat_ult_compra)}</small>
                      <button className="btn btn-primary pvps-inform-btn" type="button" onClick={() => openAlocPopup(row)}>
                        Informar
                      </button>
                    </div>
                  ))}
                </div>

                <div className="pvps-editor">
                  {!activeAloc ? <p>Selecione um item de Alocação para auditar.</p> : (
                    <>
                      <h3>Alocação: {activeAloc.endereco}</h3>
                      <p>Produto: {activeAloc.coddv} - {activeAloc.descricao}</p>
                      <p>Última compra: {formatDate(activeAloc.dat_ult_compra)}</p>
                      <button className="btn btn-primary" type="button" onClick={() => setShowAlocPopup(true)}>
                        Abrir popup para informar
                      </button>
                      {alocResult ? (
                        <div className={`pvps-result-chip ${alocResult.aud_sit === "conforme" ? "ok" : "bad"}`}>
                          Resultado: {alocResult.aud_sit === "conforme" ? "Conforme" : "Não conforme"} | Sistema: {alocResult.val_sist} | Informado: {alocResult.val_conf}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </article>
      </section>

      {showPvpsPopup && activePvps ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pvps-inform-title"
          onClick={() => {
            if (busy) return;
            setShowPvpsPopup(false);
          }}
        >
          <div className="confirm-dialog surface-enter pvps-popup-card" onClick={(event) => event.stopPropagation()}>
            <h3 id="pvps-inform-title">Informar PVPS</h3>
            <p>SEP: <strong>{activePvps.end_sep}</strong> | CODDV: <strong>{activePvps.coddv}</strong></p>
            <p>Produto: {activePvps.descricao}</p>
            <p>Data última compra: <strong>{formatDate(activePvps.dat_ult_compra)}</strong></p>

            <form className="form-grid" onSubmit={(event) => void handleSubmitSep(event)}>
              <label>
                Situação do endereço
                <select
                  value={endSit}
                  onChange={(event) => {
                    const next = event.target.value;
                    setEndSit(next === "vazio" || next === "obstruido" ? next : "");
                  }}
                >
                  <option value="">Sem flag (libera PUL)</option>
                  <option value="vazio">Flag: Vazio</option>
                  <option value="obstruido">Flag: Obstruído</option>
                </select>
              </label>
              <label>
                Validade SEP (mmaa)
                <input value={valSep} onChange={(event) => setValSep(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="mmaa" maxLength={4} />
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy}>Salvar etapa SEP</button>
            </form>

            {activePvps.audit_id ? (
              <div className="pvps-pul-box">
                <h4>Etapa PUL</h4>
                <p>Regra PVPS: validade SEP {"<="} validade de todos os PUL. Se SEP for flagada, o item sai do feed.</p>
                {pulBusy ? <p>Carregando endereços PUL...</p> : null}
                {pulItems.map((item) => (
                  <div key={item.end_pul} className="pvps-pul-row">
                    <div>
                      <strong>{item.end_pul}</strong>
                      <small>{item.auditado ? "Auditado" : "Pendente"}</small>
                    </div>
                    <input
                      value={pulInputs[item.end_pul] ?? ""}
                      onChange={(event) => setPulInputs((prev) => ({ ...prev, [item.end_pul]: event.target.value.replace(/\D/g, "").slice(0, 4) }))}
                      placeholder="mmaa"
                      maxLength={4}
                    />
                    <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void handleSubmitPul(item.end_pul)}>
                      Salvar PUL
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="confirm-actions">
              <button className="btn btn-muted" type="button" disabled={busy} onClick={() => setShowPvpsPopup(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showAlocPopup && activeAloc ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="aloc-inform-title"
          onClick={() => {
            if (busy) return;
            setShowAlocPopup(false);
          }}
        >
          <div className="confirm-dialog surface-enter pvps-popup-card" onClick={(event) => event.stopPropagation()}>
            <h3 id="aloc-inform-title">Informar Alocação</h3>
            <p>Endereço: <strong>{activeAloc.endereco}</strong> | CODDV: <strong>{activeAloc.coddv}</strong></p>
            <p>Produto: {activeAloc.descricao}</p>
            <p>Data última compra: <strong>{formatDate(activeAloc.dat_ult_compra)}</strong></p>

            <form className="form-grid" onSubmit={(event) => void handleSubmitAlocacao(event)}>
              <label>
                Situação do endereço
                <select value={alocEndSit} onChange={(event) => setAlocEndSit(event.target.value as PvpsEndSit)}>
                  <option value="vazio">Vazio</option>
                  <option value="obstruido">Obstruído</option>
                </select>
              </label>
              <label>
                Validade conferida (mmaa)
                <input value={alocValConf} onChange={(event) => setAlocValConf(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="mmaa" maxLength={4} />
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy}>Salvar Alocação</button>
            </form>

            {alocResult ? (
              <div className={`pvps-result-chip ${alocResult.aud_sit === "conforme" ? "ok" : "bad"}`}>
                Resultado: {alocResult.aud_sit === "conforme" ? "Conforme" : "Não conforme"} | Sistema: {alocResult.val_sist} | Informado: {alocResult.val_conf}
              </div>
            ) : null}

            <div className="confirm-actions">
              <button className="btn btn-muted" type="button" disabled={busy} onClick={() => setShowAlocPopup(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showClearZoneConfirm ? (
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
        </div>
      ) : null}

      {showZoneFilterPopup ? (
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
              <button className="btn btn-muted" type="button" onClick={() => setSelectedZones([])}>
                Limpar seleção
              </button>
              <button className="btn btn-muted" type="button" onClick={() => setSelectedZones(filteredZones)}>
                Selecionar filtradas
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
        </div>
      ) : null}

      {showDiscardZonesConfirm ? (
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
        </div>
      ) : null}
    </>
  );
}
