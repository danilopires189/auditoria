import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getDbBarrasMeta } from "../../shared/db-barras/storage";
import { refreshDbBarrasCacheSmart } from "../../shared/db-barras/sync";
import { getDbEndMeta } from "../../shared/db-end/storage";
import { refreshDbEndCacheSmart } from "../../shared/db-end/sync";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import { getModuleByKeyOrThrow } from "../registry";
import {
  getControleValidadePrefs,
  hasOfflineSnapshot,
  saveControleValidadePrefs,
  saveOfflineSnapshot
} from "./storage";
import {
  downloadOfflineSnapshot,
  enqueueLinhaColeta,
  enqueueLinhaRetirada,
  enqueuePulRetirada,
  fetchLinhaRetiradaList,
  fetchPulRetiradaList,
  flushControleValidadeOfflineQueue,
  getOfflineQueueStats,
  loadProjectedOfflineRows,
  normalizeControleValidadeError,
  resolveLinhaColetaProduto
} from "./sync";
import type {
  ControleValidadeModuleProfile,
  LinhaColetaLookupResult,
  LinhaRetiradaRow,
  PulRetiradaRow,
  RetiradaStatusFilter
} from "./types";

interface ControleValidadePageProps {
  isOnline: boolean;
  profile: ControleValidadeModuleProfile;
}

type MainTab = "linha" | "pulmao";
type LinhaSubTab = "coleta" | "retirada";

const MODULE_DEF = getModuleByKeyOrThrow("controle-validade");
const OFFLINE_FLUSH_INTERVAL_MS = 15000;

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: ControleValidadeModuleProfile): number | null {
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

function normalizeValidadeInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length !== 4) throw new Error("Validade deve estar no formato MMAA.");
  const month = Number.parseInt(digits.slice(0, 2), 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) throw new Error("Mês da validade inválido.");
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function safeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function ControleValidadePage({ isOnline, profile }: ControleValidadePageProps) {
  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);

  const [mainTab, setMainTab] = useState<MainTab>("linha");
  const [linhaSubTab, setLinhaSubTab] = useState<LinhaSubTab>("coleta");
  const [statusFilter, setStatusFilter] = useState<RetiradaStatusFilter>("pendente");

  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingErrors, setPendingErrors] = useState(0);
  const [dbBarrasCount, setDbBarrasCount] = useState(0);
  const [dbEndCount, setDbEndCount] = useState(0);
  const [offlineSnapshotReady, setOfflineSnapshotReady] = useState(false);
  const [busyOfflineBase, setBusyOfflineBase] = useState(false);
  const [busyFlush, setBusyFlush] = useState(false);
  const [busyLoadRows, setBusyLoadRows] = useState(false);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  const [barcodeInput, setBarcodeInput] = useState("");
  const [validadeInput, setValidadeInput] = useState("");
  const [coletaLookupBusy, setColetaLookupBusy] = useState(false);
  const [coletaLookup, setColetaLookup] = useState<LinhaColetaLookupResult | null>(null);
  const [selectedEnderecoSep, setSelectedEnderecoSep] = useState("");

  const [linhaRows, setLinhaRows] = useState<LinhaRetiradaRow[]>([]);
  const [pulRows, setPulRows] = useState<PulRetiradaRow[]>([]);
  const [linhaQtyInputs, setLinhaQtyInputs] = useState<Record<string, string>>({});
  const [pulQtyInputs, setPulQtyInputs] = useState<Record<string, string>>({});

  const flushBusyRef = useRef(false);
  const isOfflineModeActive = preferOfflineMode || !isOnline;

  const refreshQueueStats = useCallback(async () => {
    if (activeCd == null) {
      setPendingCount(0);
      setPendingErrors(0);
      return;
    }
    const stats = await getOfflineQueueStats(profile.user_id, activeCd);
    setPendingCount(stats.pending);
    setPendingErrors(stats.errors);
  }, [activeCd, profile.user_id]);

  const refreshOfflineMeta = useCallback(async () => {
    if (activeCd == null) {
      setDbBarrasCount(0);
      setDbEndCount(0);
      return;
    }
    const [barrasMeta, endMeta] = await Promise.all([
      getDbBarrasMeta(),
      getDbEndMeta(activeCd)
    ]);
    setDbBarrasCount(barrasMeta.row_count);
    setDbEndCount(endMeta.row_count);
  }, [activeCd]);

  const loadRows = useCallback(async () => {
    if (activeCd == null) {
      setLinhaRows([]);
      setPulRows([]);
      return;
    }

    setBusyLoadRows(true);
    setErrorMessage(null);
    try {
      if (isOfflineModeActive) {
        const projected = await loadProjectedOfflineRows({
          userId: profile.user_id,
          cd: activeCd
        });
        setLinhaRows(projected.linha_rows);
        setPulRows(projected.pul_rows);
        return;
      }

      const [linhaOnline, pulOnline] = await Promise.all([
        fetchLinhaRetiradaList({ cd: activeCd, status: "todos" }),
        fetchPulRetiradaList({ cd: activeCd, status: "todos" })
      ]);
      setLinhaRows(linhaOnline);
      setPulRows(pulOnline);

      await saveOfflineSnapshot({
        user_id: profile.user_id,
        cd: activeCd,
        linha_rows: linhaOnline,
        pul_rows: pulOnline
      });
      setOfflineSnapshotReady(true);
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    } finally {
      setBusyLoadRows(false);
    }
  }, [activeCd, isOfflineModeActive, profile.user_id]);

  const flushQueue = useCallback(async (manual = false): Promise<void> => {
    if (!isOnline || activeCd == null) return;
    if (flushBusyRef.current) return;
    flushBusyRef.current = true;
    setBusyFlush(true);
    setErrorMessage(null);

    try {
      const result = await flushControleValidadeOfflineQueue(profile.user_id, activeCd);
      await refreshQueueStats();
      if (result.discarded_pul_sem_estoque > 0) {
        setStatusMessage(
          `${result.discarded_pul_sem_estoque} evento(s) de Pulmão foram descartados por estoque indisponível (qtd_est_disp <= 0).`
        );
      } else if (manual && result.synced > 0) {
        setStatusMessage(`Sincronização concluída: ${result.synced} evento(s) enviados.`);
      } else if (manual && result.synced === 0 && result.discarded === 0 && result.failed === 0) {
        setStatusMessage("Nenhum evento pendente para sincronizar.");
      }

      if (result.failed > 0) {
        setErrorMessage(`Falha ao sincronizar ${result.failed} evento(s).`);
      }

      if (result.synced > 0 || result.discarded > 0) {
        await loadRows();
      }
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    } finally {
      setBusyFlush(false);
      flushBusyRef.current = false;
    }
  }, [activeCd, isOnline, loadRows, profile.user_id, refreshQueueStats]);

  const syncOfflineBase = useCallback(async () => {
    if (!isOnline) {
      setErrorMessage("Sem internet para baixar base offline.");
      return;
    }
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      return;
    }

    setBusyOfflineBase(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setProgressMessage("Iniciando preparação da base offline...");

    try {
      await refreshDbBarrasCacheSmart((progress) => {
        setProgressMessage(`db_barras: ${progress.rowsFetched} registros (${progress.percent}%)`);
      }, { allowFullReconcile: true });

      await refreshDbEndCacheSmart(activeCd, (progress) => {
        setProgressMessage(`db_end: ${progress.rowsFetched} registros (${progress.percent}%)`);
      }, { allowFullReconcile: true });

      setProgressMessage("Atualizando snapshot de retiradas...");
      await downloadOfflineSnapshot(profile.user_id, activeCd);
      setOfflineSnapshotReady(true);
      await refreshOfflineMeta();
      await loadRows();
      setStatusMessage("Base offline pronta para uso neste dispositivo.");
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    } finally {
      setProgressMessage(null);
      setBusyOfflineBase(false);
    }
  }, [activeCd, isOnline, loadRows, profile.user_id, refreshOfflineMeta]);

  const onToggleOfflineMode = useCallback(async () => {
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      return;
    }

    const next = !preferOfflineMode;
    setErrorMessage(null);
    setStatusMessage(null);

    if (!next) {
      setPreferOfflineMode(false);
      setStatusMessage("Modo offline desativado.");
      return;
    }

    if (!isOnline) {
      const snapshotExists = await hasOfflineSnapshot(profile.user_id, activeCd);
      if (!snapshotExists) {
        setErrorMessage("Sem internet e sem snapshot local. Conecte-se e baixe a base offline.");
        return;
      }
      setPreferOfflineMode(true);
      setStatusMessage("Modo offline ativado usando snapshot local.");
      return;
    }

    await syncOfflineBase();
    setPreferOfflineMode(true);
  }, [activeCd, isOnline, preferOfflineMode, profile.user_id, syncOfflineBase]);

  const onLookupProduto = useCallback(async () => {
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      return;
    }
    if (!barcodeInput.trim()) {
      setErrorMessage("Informe o código de barras.");
      return;
    }

    setColetaLookupBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await resolveLinhaColetaProduto({
        cd: activeCd,
        rawBarcode: barcodeInput,
        isOnline,
        preferOfflineMode: isOfflineModeActive
      });
      setColetaLookup(result);
      setSelectedEnderecoSep(result.enderecos_sep[0] ?? "");
      setStatusMessage(`Produto localizado: ${result.descricao}.`);
    } catch (error) {
      setColetaLookup(null);
      setSelectedEnderecoSep("");
      setErrorMessage(normalizeControleValidadeError(error));
    } finally {
      setColetaLookupBusy(false);
    }
  }, [activeCd, barcodeInput, isOfflineModeActive, isOnline]);

  const onSubmitColeta = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      return;
    }
    if (!coletaLookup) {
      setErrorMessage("Busque o produto antes de salvar a coleta.");
      return;
    }
    if (!selectedEnderecoSep) {
      setErrorMessage("Selecione um endereço da Linha.");
      return;
    }

    try {
      const valMmaa = normalizeValidadeInput(validadeInput);
      await enqueueLinhaColeta({
        userId: profile.user_id,
        cd: activeCd,
        payload: {
          client_event_id: safeUuid(),
          cd: activeCd,
          barras: coletaLookup.barras,
          endereco_sep: selectedEnderecoSep,
          val_mmaa: valMmaa,
          qtd: 1,
          data_hr: new Date().toISOString()
        }
      });
      await refreshQueueStats();
      setStatusMessage("Coleta da Linha registrada.");
      setBarcodeInput("");
      setValidadeInput("");
      setColetaLookup(null);
      setSelectedEnderecoSep("");
      if (isOnline) {
        await flushQueue(false);
      } else {
        await loadRows();
      }
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    }
  }, [activeCd, coletaLookup, flushQueue, isOnline, loadRows, profile.user_id, refreshQueueStats, selectedEnderecoSep, validadeInput]);

  const submitLinhaRetirada = useCallback(async (row: LinhaRetiradaRow) => {
    if (activeCd == null) return;
    const key = `${row.coddv}|${row.endereco_sep}|${row.val_mmaa}|${row.ref_coleta_mes}`;
    const parsed = Number.parseInt((linhaQtyInputs[key] || "1").replace(/\D/g, ""), 10);
    const qtd = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

    try {
      await enqueueLinhaRetirada({
        userId: profile.user_id,
        cd: activeCd,
        payload: {
          client_event_id: safeUuid(),
          cd: activeCd,
          coddv: row.coddv,
          endereco_sep: row.endereco_sep,
          val_mmaa: row.val_mmaa,
          qtd_retirada: qtd,
          data_hr: new Date().toISOString()
        }
      });
      await refreshQueueStats();
      setStatusMessage(`Retirada da Linha registrada (${qtd}).`);
      if (isOnline) {
        await flushQueue(false);
      }
      await loadRows();
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    }
  }, [activeCd, flushQueue, isOnline, linhaQtyInputs, loadRows, profile.user_id, refreshQueueStats]);

  const submitPulRetirada = useCallback(async (row: PulRetiradaRow) => {
    if (activeCd == null) return;
    const key = `${row.coddv}|${row.endereco_pul}|${row.val_mmaa}`;
    const parsed = Number.parseInt((pulQtyInputs[key] || "1").replace(/\D/g, ""), 10);
    const qtd = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

    try {
      await enqueuePulRetirada({
        userId: profile.user_id,
        cd: activeCd,
        payload: {
          client_event_id: safeUuid(),
          cd: activeCd,
          coddv: row.coddv,
          endereco_pul: row.endereco_pul,
          val_mmaa: row.val_mmaa,
          qtd_retirada: qtd,
          data_hr: new Date().toISOString()
        }
      });
      await refreshQueueStats();
      setStatusMessage(`Retirada do Pulmão registrada (${qtd}).`);
      if (isOnline) {
        await flushQueue(false);
      }
      await loadRows();
    } catch (error) {
      setErrorMessage(normalizeControleValidadeError(error));
    }
  }, [activeCd, flushQueue, isOnline, loadRows, profile.user_id, pulQtyInputs, refreshQueueStats]);

  useEffect(() => {
    if (activeCd == null) return;
    const bootstrap = async () => {
      try {
        const prefs = await getControleValidadePrefs(profile.user_id);
        setPreferOfflineMode(Boolean(prefs.prefer_offline_mode));
      } finally {
        setPreferencesReady(true);
      }
      await Promise.all([
        refreshQueueStats(),
        refreshOfflineMeta()
      ]);
      const snapshotExists = await hasOfflineSnapshot(profile.user_id, activeCd);
      setOfflineSnapshotReady(snapshotExists);
    };
    void bootstrap();
  }, [activeCd, profile.user_id, refreshOfflineMeta, refreshQueueStats]);

  useEffect(() => {
    if (!preferencesReady) return;
    void saveControleValidadePrefs(profile.user_id, {
      prefer_offline_mode: preferOfflineMode
    });
  }, [preferencesReady, preferOfflineMode, profile.user_id]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!isOnline || activeCd == null) return;
    const run = () => {
      void flushQueue(false);
    };
    const intervalId = window.setInterval(run, OFFLINE_FLUSH_INTERVAL_MS);
    window.addEventListener("online", run);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("online", run);
    };
  }, [activeCd, flushQueue, isOnline]);

  const linhaRowsFiltered = useMemo(() => {
    if (statusFilter === "todos") return linhaRows;
    return linhaRows.filter((row) => row.status === statusFilter);
  }, [linhaRows, statusFilter]);

  const pulRowsFiltered = useMemo(() => {
    if (statusFilter === "todos") return pulRows;
    return pulRows.filter((row) => row.status === statusFilter);
  }, [pulRows, statusFilter]);

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

      <section className="modules-shell controle-validade-shell">
        <article className="module-screen surface-enter controle-validade-screen">
          <div className="module-screen-header">
            <div className="module-screen-title">
              <h2>Controle de Validade</h2>
              <p>CD ativo: {activeCd != null ? `CD ${String(activeCd).padStart(2, "0")}` : "não definido"}</p>
            </div>
            <div className="controle-validade-head-actions">
              <PendingSyncBadge
                pendingCount={pendingCount}
                errorCount={pendingErrors}
                title="Eventos offline pendentes de sincronização"
              />
              <button
                type="button"
                className={`btn btn-muted${preferOfflineMode ? " is-active" : ""}`}
                onClick={() => void onToggleOfflineMode()}
                disabled={busyOfflineBase}
              >
                {preferOfflineMode ? "📦 Offline ativo" : "📶 Trabalhar offline"}
              </button>
              <button
                type="button"
                className="btn btn-muted"
                onClick={() => void syncOfflineBase()}
                disabled={!isOnline || busyOfflineBase}
              >
                {busyOfflineBase ? "Baixando base..." : "Baixar base offline"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void flushQueue(true)}
                disabled={!isOnline || busyFlush}
              >
                {busyFlush ? "Sincronizando..." : "Sincronizar pendentes"}
              </button>
            </div>
          </div>

          <div className="module-screen-body controle-validade-body">
            {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
            {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
            {progressMessage ? <div className="alert success">{progressMessage}</div> : null}
            {preferOfflineMode && !offlineSnapshotReady ? (
              <div className="alert error">Modo offline ativo sem snapshot de retirada. Use "Baixar base offline".</div>
            ) : null}

            <div className="controle-validade-meta">
              <span>db_barras local: {dbBarrasCount}</span>
              <span>db_end local: {dbEndCount}</span>
              <span>Snapshot: {offlineSnapshotReady ? "pronto" : "indisponível"}</span>
            </div>

            <div className="controle-validade-tabs">
              <button
                type="button"
                className={`btn btn-muted${mainTab === "linha" ? " is-active" : ""}`}
                onClick={() => setMainTab("linha")}
              >
                Validade Linha
              </button>
              <button
                type="button"
                className={`btn btn-muted${mainTab === "pulmao" ? " is-active" : ""}`}
                onClick={() => setMainTab("pulmao")}
              >
                Validade Pulmão
              </button>
            </div>

            {mainTab === "linha" ? (
              <div className="controle-validade-pane">
                <div className="controle-validade-subtabs">
                  <button
                    type="button"
                    className={`btn btn-muted${linhaSubTab === "coleta" ? " is-active" : ""}`}
                    onClick={() => setLinhaSubTab("coleta")}
                  >
                    Opção (Coleta)
                  </button>
                  <button
                    type="button"
                    className={`btn btn-muted${linhaSubTab === "retirada" ? " is-active" : ""}`}
                    onClick={() => setLinhaSubTab("retirada")}
                  >
                    Opção (Retirada)
                  </button>
                </div>

                {linhaSubTab === "coleta" ? (
                  <form className="controle-validade-form" onSubmit={onSubmitColeta}>
                    <label>
                      Código de barras
                      <div className="controle-validade-inline-field">
                        <input
                          type="text"
                          value={barcodeInput}
                          onChange={(event) => setBarcodeInput(event.target.value)}
                          placeholder="Leia ou digite o código de barras"
                          required
                        />
                        <button
                          type="button"
                          className="btn btn-muted"
                          onClick={() => void onLookupProduto()}
                          disabled={coletaLookupBusy || activeCd == null}
                        >
                          {coletaLookupBusy ? "Buscando..." : "Buscar"}
                        </button>
                      </div>
                    </label>

                    {coletaLookup ? (
                      <div className="controle-validade-lookup-card">
                        <strong>{coletaLookup.descricao}</strong>
                        <span>CODDV: {coletaLookup.coddv}</span>
                        <span>Barras: {coletaLookup.barras}</span>
                        <label>
                          Endereço Linha (SEP)
                          <select
                            value={selectedEnderecoSep}
                            onChange={(event) => setSelectedEnderecoSep(event.target.value)}
                            required
                          >
                            {coletaLookup.enderecos_sep.map((endereco) => (
                              <option key={endereco} value={endereco}>
                                {endereco}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}

                    <label>
                      Validade (MMAA)
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        value={validadeInput}
                        onChange={(event) => setValidadeInput(event.target.value.replace(/\D/g, "").slice(0, 4))}
                        placeholder="Ex.: 0426"
                        required
                      />
                    </label>

                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={activeCd == null || !coletaLookup || !selectedEnderecoSep}
                    >
                      Salvar coleta (qtd 1)
                    </button>
                  </form>
                ) : (
                  <div className="controle-validade-list-area">
                    <div className="controle-validade-status-tabs">
                      <button
                        type="button"
                        className={`btn btn-muted${statusFilter === "pendente" ? " is-active" : ""}`}
                        onClick={() => setStatusFilter("pendente")}
                      >
                        Pendentes
                      </button>
                      <button
                        type="button"
                        className={`btn btn-muted${statusFilter === "concluido" ? " is-active" : ""}`}
                        onClick={() => setStatusFilter("concluido")}
                      >
                        Concluídos
                      </button>
                    </div>

                    {busyLoadRows ? <p>Carregando retiradas da Linha...</p> : null}
                    {!busyLoadRows && linhaRowsFiltered.length === 0 ? (
                      <p>Nenhum item na Linha para o filtro atual.</p>
                    ) : null}
                    <div className="controle-validade-list">
                      {linhaRowsFiltered.map((row) => {
                        const key = `${row.coddv}|${row.endereco_sep}|${row.val_mmaa}|${row.ref_coleta_mes}`;
                        const isPending = row.status === "pendente";
                        return (
                          <article key={key} className="controle-validade-row-card">
                            <div className="controle-validade-row-head">
                              <strong>{row.descricao}</strong>
                              <span className={`controle-validade-status ${row.status}`}>
                                {row.status === "pendente" ? "Pendente" : "Concluído"}
                              </span>
                            </div>
                            <div className="controle-validade-row-grid">
                              <span>CODDV: {row.coddv}</span>
                              <span>Endereço: {row.endereco_sep}</span>
                              <span>Validade: {row.val_mmaa}</span>
                              <span>Regra: {row.regra_aplicada === "al_lt_3m" ? "AL < 3 meses" : "Até 5 meses"}</span>
                              <span>Coletado: {row.qtd_coletada}</span>
                              <span>Retirado: {row.qtd_retirada}</span>
                              <span>Pendente: {row.qtd_pendente}</span>
                              <span>Última coleta: {formatDateTime(row.dt_ultima_coleta)}</span>
                            </div>
                            {isPending ? (
                              <div className="controle-validade-row-actions">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={linhaQtyInputs[key] ?? "1"}
                                  onChange={(event) =>
                                    setLinhaQtyInputs((current) => ({
                                      ...current,
                                      [key]: event.target.value.replace(/\D/g, "").slice(0, 4)
                                    }))
                                  }
                                />
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={() => void submitLinhaRetirada(row)}
                                >
                                  Registrar retirada
                                </button>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="controle-validade-pane">
                <div className="controle-validade-status-tabs">
                  <button
                    type="button"
                    className={`btn btn-muted${statusFilter === "pendente" ? " is-active" : ""}`}
                    onClick={() => setStatusFilter("pendente")}
                  >
                    Pendentes
                  </button>
                  <button
                    type="button"
                    className={`btn btn-muted${statusFilter === "concluido" ? " is-active" : ""}`}
                    onClick={() => setStatusFilter("concluido")}
                  >
                    Concluídos
                  </button>
                </div>

                {busyLoadRows ? <p>Carregando retiradas do Pulmão...</p> : null}
                {!busyLoadRows && pulRowsFiltered.length === 0 ? (
                  <p>Nenhum item de Pulmão para o filtro atual.</p>
                ) : null}
                <div className="controle-validade-list">
                  {pulRowsFiltered.map((row) => {
                    const key = `${row.coddv}|${row.endereco_pul}|${row.val_mmaa}`;
                    const isPending = row.status === "pendente";
                    return (
                      <article key={key} className="controle-validade-row-card">
                        <div className="controle-validade-row-head">
                          <strong>{row.descricao}</strong>
                          <span className={`controle-validade-status ${row.status}`}>
                            {row.status === "pendente" ? "Pendente" : "Concluído"}
                          </span>
                        </div>
                        <div className="controle-validade-row-grid">
                          <span>CODDV: {row.coddv}</span>
                          <span>Endereço PUL: {row.endereco_pul}</span>
                          <span>Validade: {row.val_mmaa}</span>
                          <span>Estoque disponível: {row.qtd_est_disp}</span>
                          <span>Alvo: {row.qtd_alvo}</span>
                          <span>Retirado: {row.qtd_retirada}</span>
                          <span>Pendente: {row.qtd_pendente}</span>
                        </div>
                        {isPending ? (
                          <div className="controle-validade-row-actions">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={pulQtyInputs[key] ?? "1"}
                              onChange={(event) =>
                                setPulQtyInputs((current) => ({
                                  ...current,
                                  [key]: event.target.value.replace(/\D/g, "").slice(0, 4)
                                }))
                              }
                            />
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => void submitPulRetirada(row)}
                            >
                              Registrar retirada
                            </button>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </article>
      </section>
    </>
  );
}
