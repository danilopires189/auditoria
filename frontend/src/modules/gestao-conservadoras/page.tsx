import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { formatDateTimeBrasilia } from "../../shared/brasilia-datetime";
import { getModuleByKeyOrThrow } from "../registry";
import {
  confirmConservadoraDocumento,
  fetchConservadoraCards,
  fetchConservadoraHistory,
  fetchConservadoraRotas,
  fetchConservadoraTransportadoras,
  inativarConservadoraTransportadora,
  upsertConservadoraTransportadora,
  vincularConservadoraRota
} from "./sync";
import type {
  ConservadoraModuleProfile,
  ConservadoraRouteBinding,
  ConservadoraShipmentCard,
  ConservadoraStatus,
  ConservadoraTransportadora
} from "./types";

const MODULE_DEF = getModuleByKeyOrThrow("gestao-conservadoras");
const HISTORY_PAGE_SIZE = 100;

interface GestaoConservadorasPageProps {
  isOnline: boolean;
  profile: ConservadoraModuleProfile;
}

function cdDisplayLabel(cd: number | null, cdNome: string | null): string {
  const nome = (cdNome ?? "").trim();
  if (nome) return nome;
  return cd == null ? "CD não definido" : `CD ${String(cd).padStart(2, "0")}`;
}

function formatPedidoSemDv(value: string | number | null | undefined): string {
  const compact = String(value ?? "").trim();
  if (!compact) return "-";
  return compact.length > 1 ? compact.slice(0, -1) : compact;
}

function formatDateOnlyFromDateTime(value: string | null | undefined): string {
  const formatted = formatDateTimeBrasilia(value);
  return formatted === "-" ? formatted : formatted.split(",")[0]?.trim() ?? "-";
}

function toDisplayName(nome: string): string {
  const compact = nome.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact.toLocaleLowerCase("pt-BR").split(" ").map((chunk) => (
    chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1)
  )).join(" ");
}

function statusLabel(status: ConservadoraStatus): string {
  switch (status) {
    case "aguardando_documento": return "🟡 Aguardando Documento";
    case "documentacao_em_atraso": return "🔴 Documentação em Atraso";
    case "documentacao_recebida": return "✅ Doc. Recebida";
    default: return "🚚 Em Trânsito";
  }
}

function statusDescription(row: ConservadoraShipmentCard): string {
  if (row.status === "documentacao_recebida" && row.document_confirmed_at) {
    return `Confirmado em ${formatDateTimeBrasilia(row.document_confirmed_at)}.`;
  }
  if (row.status === "documentacao_em_atraso") return "Já existe embarque posterior da mesma placa com pedido maior e o documento passou do prazo de 5 dias.";
  if (row.status === "aguardando_documento") return "Já existe embarque posterior da mesma placa com pedido maior e o documento ainda está no prazo.";
  return "Ainda não existe embarque posterior para esta placa.";
}

function transportadoraLabel(row: ConservadoraShipmentCard): string {
  if (!row.transportadora_nome) return "Não vinculada";
  return row.transportadora_ativa ? row.transportadora_nome : `${row.transportadora_nome} (inativa)`;
}

export default function GestaoConservadorasPage({ isOnline, profile }: GestaoConservadorasPageProps) {
  const currentCd = profile.cd_default;
  const canManage = profile.role === "admin";
  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const [rows, setRows] = useState<ConservadoraShipmentCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [actionBusyKey, setActionBusyKey] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<ConservadoraShipmentCard[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState<ConservadoraStatus | "">("");
  const [historyDtIni, setHistoryDtIni] = useState("");
  const [historyDtFim, setHistoryDtFim] = useState("");
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasNext, setHistoryHasNext] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageLoading, setManageLoading] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [transportadoras, setTransportadoras] = useState<ConservadoraTransportadora[]>([]);
  const [rotas, setRotas] = useState<ConservadoraRouteBinding[]>([]);
  const [novaTransportadora, setNovaTransportadora] = useState("");
  const [routeSearch, setRouteSearch] = useState("");
  const [routeSelections, setRouteSelections] = useState<Record<string, string>>({});
  const [manageBusy, setManageBusy] = useState(false);
  const [routesReloadNonce, setRoutesReloadNonce] = useState(0);
  const deferredSearch = useDeferredValue(searchInput.trim());
  const deferredHistorySearch = useDeferredValue(historySearch.trim());
  const deferredRouteSearch = useDeferredValue(routeSearch.trim());
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSuccess = useCallback((message: string) => {
    setSuccessMessage(message);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setSuccessMessage(null), 4000);
  }, []);

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  const loadCards = useCallback(async () => {
    if (!currentCd) return;
    if (!isOnline) {
      setErrorMessage("Este módulo requer conexão com a internet.");
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      setRows(await fetchConservadoraCards({ cd: currentCd, search: deferredSearch || null }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao carregar embarques.");
    } finally {
      setLoading(false);
    }
  }, [currentCd, deferredSearch, isOnline]);

  useEffect(() => {
    void loadCards();
  }, [loadCards, refreshNonce]);

  useEffect(() => {
    if (!historyOpen || !currentCd || !isOnline) return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    fetchConservadoraHistory(currentCd, {
      search: deferredHistorySearch || null,
      status: historyStatus || null,
      dtIni: historyDtIni || null,
      dtFim: historyDtFim || null,
      offset: historyOffset,
      limit: HISTORY_PAGE_SIZE
    }).then((data) => {
      if (cancelled) return;
      setHistoryRows(data);
      setHistoryHasNext(data.length === HISTORY_PAGE_SIZE);
    }).catch((error) => {
      if (!cancelled) setHistoryError(error instanceof Error ? error.message : "Erro ao carregar histórico.");
    }).finally(() => {
      if (!cancelled) setHistoryLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentCd, deferredHistorySearch, historyDtFim, historyDtIni, historyOffset, historyOpen, historyStatus, isOnline]);

  useEffect(() => {
    if (!manageOpen || !currentCd || !isOnline) return;
    let cancelled = false;
    setManageLoading(true);
    setManageError(null);
    Promise.all([
      fetchConservadoraTransportadoras(currentCd),
      fetchConservadoraRotas(currentCd, deferredRouteSearch || null)
    ]).then(([transportadorasData, rotasData]) => {
      if (cancelled) return;
      setTransportadoras(transportadorasData);
      setRotas(rotasData);
      setRouteSelections((current) => {
        const next = { ...current };
        for (const route of rotasData) next[route.rota_descricao] = current[route.rota_descricao] ?? route.transportadora_id ?? "";
        return next;
      });
    }).catch((error) => {
      if (!cancelled) setManageError(error instanceof Error ? error.message : "Erro ao carregar o gerenciamento.");
    }).finally(() => {
      if (!cancelled) setManageLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentCd, deferredRouteSearch, isOnline, manageOpen, routesReloadNonce]);

  const groupedRows = useMemo(() => ({
    atraso: rows.filter((row) => row.status === "documentacao_em_atraso"),
    aguardando: rows.filter((row) => row.status === "aguardando_documento"),
    emTransito: rows.filter((row) => row.status === "em_transito"),
    recebida: rows.filter((row) => row.status === "documentacao_recebida")
  }), [rows]);

  const activeTransportadoras = useMemo(() => transportadoras.filter((item) => item.ativo), [transportadoras]);

  const toggleExpanded = useCallback((embarqueKey: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(embarqueKey)) next.delete(embarqueKey); else next.add(embarqueKey);
      return next;
    });
  }, []);

  const handleConfirmDocumento = useCallback(async (row: ConservadoraShipmentCard) => {
    if (!currentCd || !isOnline) return;
    setActionBusyKey(row.embarque_key);
    setErrorMessage(null);
    try {
      await confirmConservadoraDocumento({ cd: currentCd, embarqueKey: row.embarque_key });
      showSuccess(`Documento confirmado para o pedido ${formatPedidoSemDv(row.seq_ped)}.`);
      setRefreshNonce((value) => value + 1);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao confirmar o documento.");
    } finally {
      setActionBusyKey(null);
    }
  }, [currentCd, isOnline, showSuccess]);

  const handleSalvarTransportadora = useCallback(async () => {
    if (!currentCd || !isOnline || !novaTransportadora.trim()) return;
    setManageBusy(true);
    setManageError(null);
    try {
      await upsertConservadoraTransportadora({ cd: currentCd, nome: novaTransportadora.trim() });
      setNovaTransportadora("");
      setRoutesReloadNonce((value) => value + 1);
      showSuccess("Transportadora salva com sucesso.");
    } catch (error) {
      setManageError(error instanceof Error ? error.message : "Erro ao salvar transportadora.");
    } finally {
      setManageBusy(false);
    }
  }, [currentCd, isOnline, novaTransportadora, showSuccess]);

  const handleInativarTransportadora = useCallback(async (transportadoraId: string) => {
    if (!currentCd || !isOnline) return;
    setManageBusy(true);
    setManageError(null);
    try {
      await inativarConservadoraTransportadora({ cd: currentCd, transportadoraId });
      setRoutesReloadNonce((value) => value + 1);
      showSuccess("Transportadora inativada com sucesso.");
    } catch (error) {
      setManageError(error instanceof Error ? error.message : "Erro ao inativar transportadora.");
    } finally {
      setManageBusy(false);
    }
  }, [currentCd, isOnline, showSuccess]);

  const handleSalvarRota = useCallback(async (route: ConservadoraRouteBinding) => {
    const transportadoraId = routeSelections[route.rota_descricao] ?? "";
    if (!currentCd || !isOnline || !transportadoraId) return;
    setManageBusy(true);
    setManageError(null);
    try {
      await vincularConservadoraRota({ cd: currentCd, rotaDescricao: route.rota_descricao, transportadoraId });
      setRoutesReloadNonce((value) => value + 1);
      setRefreshNonce((value) => value + 1);
      showSuccess(`Rota ${route.rota_descricao} vinculada com sucesso.`);
    } catch (error) {
      setManageError(error instanceof Error ? error.message : "Erro ao salvar o vínculo da rota.");
    } finally {
      setManageBusy(false);
    }
  }, [currentCd, isOnline, routeSelections, showSuccess]);

  return (
    <>
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
            <span className="module-back-icon" aria-hidden="true"><BackIcon /></span>
            <span>Início</span>
          </Link>
          <div className="module-topbar-user-side">
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>{isOnline ? "🟢 Online" : "🔴 Offline"}</span>
          </div>
        </div>
        <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
          <span className="module-icon" aria-hidden="true"><ModuleIcon name={MODULE_DEF.icon} /></span>
          <span className="module-title">Conservadoras Térmicas</span>
        </div>
      </header>

      <section className="modules-shell coleta-shell caixa-termica-shell conservadora-shell">
        <div className="coleta-head">
          <h2>Olá, {displayUserName}</h2>
          <p>Acompanhe os embarques por rota, placa e pedido, com rastreabilidade documental por veículo.</p>
          <p className="coleta-meta-line">CD atual: <strong>{cdDisplayLabel(currentCd, profile.cd_nome)}</strong></p>
        </div>
        {successMessage && <div className="alert success">{successMessage}</div>}
        {errorMessage && <div className="alert error">{errorMessage}</div>}
        {!isOnline && <div className="alert error">Este módulo depende da base online para calcular os embarques agregados e os status documentais.</div>}
        {!currentCd && <div className="alert error">Nenhum CD padrão foi encontrado para o seu perfil.</div>}

        <div className="termo-actions-row">
          <div className="caixa-input-scan-wrap" style={{ flex: "1 1 260px" }}>
            <input
              type="search"
              className="caixa-search-input"
              placeholder="Buscar por rota, pedido, placa, transportadora ou responsável..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              disabled={!currentCd || !isOnline}
            />
          </div>
          <button type="button" className="btn btn-muted" onClick={() => { setHistoryOffset(0); setHistoryOpen(true); }} disabled={!currentCd || !isOnline}>📋 Histórico</button>
          {canManage && <button type="button" className="btn btn-muted" onClick={() => setManageOpen(true)} disabled={!currentCd || !isOnline}>🧾 Transportadoras</button>}
          <button type="button" className="btn btn-primary" onClick={() => setRefreshNonce((value) => value + 1)} disabled={!currentCd || !isOnline || loading}>{loading ? "Atualizando..." : "Atualizar"}</button>
        </div>
        {loading && rows.length === 0 ? <p className="caixa-sem-itens">Carregando embarques...</p> : (
          <>
            <ConservadoraSection title="🔴 Documentação em Atraso" count={groupedRows.atraso.length} emptyMessage="Nenhum embarque com documentação em atraso." rows={groupedRows.atraso} expandedKeys={expandedKeys} actionBusyKey={actionBusyKey} onToggleExpanded={toggleExpanded} onConfirmDocumento={handleConfirmDocumento} />
            <ConservadoraSection title="🟡 Aguardando Documento" count={groupedRows.aguardando.length} emptyMessage="Nenhum embarque aguardando documento." rows={groupedRows.aguardando} expandedKeys={expandedKeys} actionBusyKey={actionBusyKey} onToggleExpanded={toggleExpanded} onConfirmDocumento={handleConfirmDocumento} />
            <ConservadoraSection title="🚚 Em Trânsito" count={groupedRows.emTransito.length} emptyMessage="Nenhum embarque em trânsito." rows={groupedRows.emTransito} expandedKeys={expandedKeys} actionBusyKey={actionBusyKey} onToggleExpanded={toggleExpanded} onConfirmDocumento={handleConfirmDocumento} />
            <ConservadoraSection title="✅ Documentação Recebida" count={groupedRows.recebida.length} emptyMessage="Nenhum embarque com documentação recebida." rows={groupedRows.recebida} expandedKeys={expandedKeys} actionBusyKey={actionBusyKey} onToggleExpanded={toggleExpanded} onConfirmDocumento={handleConfirmDocumento} />
          </>
        )}
      </section>

      {historyOpen && typeof document !== "undefined" && createPortal(
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="conservadora-history-title" onClick={() => setHistoryOpen(false)}>
          <div className="confirm-dialog surface-enter conservadora-history-dialog" onClick={(event) => event.stopPropagation()}>
            <h3 id="conservadora-history-title">Histórico de Embarques</h3>
            <div className="conservadora-filters">
              <input type="search" className="caixa-search-input" placeholder="Buscar por rota, pedido, placa, transportadora ou responsável..." value={historySearch} onChange={(event) => { setHistorySearch(event.target.value); setHistoryOffset(0); }} />
              <select value={historyStatus} onChange={(event) => { setHistoryStatus(event.target.value as ConservadoraStatus | ""); setHistoryOffset(0); }}>
                <option value="">Todos os status</option>
                <option value="em_transito">Em trânsito</option>
                <option value="aguardando_documento">Aguardando documento</option>
                <option value="documentacao_em_atraso">Documentação em atraso</option>
                <option value="documentacao_recebida">Documentação recebida</option>
              </select>
              <input type="date" value={historyDtIni} onChange={(event) => { setHistoryDtIni(event.target.value); setHistoryOffset(0); }} />
              <input type="date" value={historyDtFim} onChange={(event) => { setHistoryDtFim(event.target.value); setHistoryOffset(0); }} />
            </div>
            {historyLoading && <p className="conservadora-empty">Carregando histórico...</p>}
            {historyError && <div className="alert error">{historyError}</div>}
            {!historyLoading && !historyError && <p className="conservadora-empty">{historyRows.length ? `Mostrando ${historyRows.length} embarque(s) nesta página.` : "Nenhum embarque encontrado para os filtros informados."}</p>}
            <div className="caixa-historico-timeline">
              {historyRows.map((row) => (
                <div key={row.embarque_key} className={`caixa-historico-item conservadora-history-item ${row.status}`}>
                  <span className="caixa-historico-tipo">{statusLabel(row.status)}</span>
                  <span className="caixa-historico-meta">Rota: {row.rota}</span>
                  <span className="caixa-historico-meta">Pedido: {formatPedidoSemDv(row.seq_ped)}</span>
                  <span className="caixa-historico-meta">Placa: {row.placa}</span>
                  <span className="caixa-historico-meta">Embarque: {formatDateTimeBrasilia(row.dt_lib ?? row.event_at)}</span>
                  {row.dt_ped && <span className="caixa-historico-meta">Data do pedido: {formatDateOnlyFromDateTime(row.dt_ped)}</span>}
                  <span className="caixa-historico-meta">Transportadora: {transportadoraLabel(row)}</span>
                  <span className="caixa-historico-meta">Responsável: {row.responsavel_nome ?? "Não informado"}{row.responsavel_mat ? ` (${row.responsavel_mat})` : ""}</span>
                  {row.document_confirmed_at && <span className="caixa-historico-meta">Documento confirmado em {formatDateTimeBrasilia(row.document_confirmed_at)}{row.document_confirmed_nome ? ` por ${row.document_confirmed_nome}` : ""}</span>}
                </div>
              ))}
            </div>
            <div className="confirm-actions" style={{ marginTop: "16px" }}>
              <button type="button" className="btn btn-muted" onClick={() => setHistoryOffset((value) => Math.max(value - HISTORY_PAGE_SIZE, 0))} disabled={historyLoading || historyOffset === 0}>Página anterior</button>
              <button type="button" className="btn btn-muted" onClick={() => setHistoryOffset((value) => value + HISTORY_PAGE_SIZE)} disabled={historyLoading || !historyHasNext}>Próxima página</button>
              <button type="button" className="btn btn-primary" onClick={() => setHistoryOpen(false)}>Fechar</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {manageOpen && typeof document !== "undefined" && createPortal(
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="conservadora-manage-title" onClick={() => setManageOpen(false)}>
          <div className="confirm-dialog surface-enter conservadora-manage-dialog" onClick={(event) => event.stopPropagation()}>
            <h3 id="conservadora-manage-title">Gerenciar Transportadoras</h3>
            {manageError && <div className="alert error">{manageError}</div>}
            {manageLoading && <p className="conservadora-empty">Carregando dados de gerenciamento...</p>}
            <div className="conservadora-manage-grid">
              <section className="conservadora-manage-section">
                <h4>Cadastro de transportadoras</h4>
                <div className="conservadora-inline-form">
                  <input type="text" placeholder="Nome da transportadora" value={novaTransportadora} onChange={(event) => setNovaTransportadora(event.target.value)} disabled={manageBusy} />
                  <button type="button" className="btn btn-primary" onClick={() => void handleSalvarTransportadora()} disabled={manageBusy || !novaTransportadora.trim()}>Salvar</button>
                </div>
                <div className="conservadora-list">
                  {transportadoras.map((item) => (
                    <div key={item.id} className="conservadora-list-row">
                      <div><strong>{item.nome}</strong><p>{item.ativo ? "Ativa" : "Inativa"}</p></div>
                      <button type="button" className="btn btn-muted" onClick={() => void handleInativarTransportadora(item.id)} disabled={manageBusy || !item.ativo}>Inativar</button>
                    </div>
                  ))}
                  {!transportadoras.length && !manageLoading && <p className="conservadora-empty">Nenhuma transportadora cadastrada.</p>}
                </div>
              </section>
              <section className="conservadora-manage-section">
                <h4>Vínculo de rotas</h4>
                <input type="search" placeholder="Buscar rota..." value={routeSearch} onChange={(event) => setRouteSearch(event.target.value)} disabled={manageBusy} />
                <div className="conservadora-list">
                  {rotas.map((route) => {
                    const selectedId = routeSelections[route.rota_descricao] ?? route.transportadora_id ?? "";
                    const currentInactive = route.transportadora_id && !activeTransportadoras.some((item) => item.id === route.transportadora_id)
                      ? [{ id: route.transportadora_id, cd: currentCd ?? 0, nome: route.transportadora_nome ?? "Transportadora atual", ativo: false, created_at: null, updated_at: null }]
                      : [];
                    const selectOptions = [...activeTransportadoras, ...currentInactive];
                    return (
                      <div key={route.rota_descricao} className="conservadora-route-row">
                        <div>
                          <strong>{route.rota_descricao}</strong>
                          <p>Atual: {route.transportadora_nome ? `${route.transportadora_nome}${route.transportadora_ativa ? "" : " (inativa)"}` : "Sem vínculo"}</p>
                        </div>
                        <div className="conservadora-route-actions">
                          <select value={selectedId} onChange={(event) => setRouteSelections((current) => ({ ...current, [route.rota_descricao]: event.target.value }))} disabled={manageBusy}>
                            <option value="">Selecionar transportadora</option>
                            {selectOptions.map((item) => <option key={item.id} value={item.id}>{item.nome}{item.ativo ? "" : " (inativa)"}</option>)}
                          </select>
                          <button type="button" className="btn btn-primary" onClick={() => void handleSalvarRota(route)} disabled={manageBusy || !selectedId || selectedId === (route.transportadora_id ?? "")}>Vincular</button>
                        </div>
                      </div>
                    );
                  })}
                  {!rotas.length && !manageLoading && <p className="conservadora-empty">Nenhuma rota encontrada para o filtro informado.</p>}
                </div>
              </section>
            </div>
            <div className="confirm-actions" style={{ marginTop: "16px" }}>
              <button type="button" className="btn btn-primary" onClick={() => setManageOpen(false)}>Fechar</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

interface ConservadoraSectionProps {
  title: string;
  count: number;
  emptyMessage: string;
  rows: ConservadoraShipmentCard[];
  expandedKeys: Set<string>;
  actionBusyKey: string | null;
  onToggleExpanded: (embarqueKey: string) => void;
  onConfirmDocumento: (row: ConservadoraShipmentCard) => void;
}

function ConservadoraSection(props: ConservadoraSectionProps) {
  const { title, count, emptyMessage, rows, expandedKeys, actionBusyKey, onToggleExpanded, onConfirmDocumento } = props;
  return (
    <div className="caixa-section">
      <p className="caixa-section-title">{title}<span className="caixa-section-count">{count}</span></p>
      {rows.length === 0 ? <p className="caixa-sem-itens">{emptyMessage}</p> : (
        <div className="caixa-cards-list">
          {rows.map((row) => (
            <ConservadoraCard key={row.embarque_key} row={row} isExpanded={expandedKeys.has(row.embarque_key)} isBusy={actionBusyKey === row.embarque_key} onToggleExpanded={() => onToggleExpanded(row.embarque_key)} onConfirmDocumento={() => onConfirmDocumento(row)} />
          ))}
        </div>
      )}
    </div>
  );
}

interface ConservadoraCardProps {
  row: ConservadoraShipmentCard;
  isExpanded: boolean;
  isBusy: boolean;
  onToggleExpanded: () => void;
  onConfirmDocumento: () => void;
}

function ConservadoraCard({ row, isExpanded, isBusy, onToggleExpanded, onConfirmDocumento }: ConservadoraCardProps) {
  const canConfirm = row.status === "aguardando_documento" || row.status === "documentacao_em_atraso";
  const pedidoDisplay = formatPedidoSemDv(row.seq_ped);
  return (
    <div className="caixa-card">
      <div className="caixa-card-header">
        <div className="caixa-card-title-block">
          <span className="caixa-card-codigo">{row.rota}</span>
          <p className="caixa-card-descricao">Pedido {pedidoDisplay}</p>
        </div>
        <span className={`caixa-card-status ${row.status}`}>{statusLabel(row.status)}</span>
        <button type="button" className="caixa-card-expand-btn" onClick={onToggleExpanded} aria-expanded={isExpanded} title={isExpanded ? "Ocultar detalhes" : "Ver detalhes"}>{isExpanded ? "Ocultar" : "Detalhes"}</button>
      </div>
      <div className="caixa-card-meta conservadora-card-meta">
        <span className="conservadora-card-meta-item">
          <strong>Pedido</strong>
          <span>{pedidoDisplay}</span>
        </span>
        <span className="conservadora-card-meta-item">
          <strong>Placa</strong>
          <span>{row.placa}</span>
        </span>
      </div>
      {isExpanded && (
        <div className="caixa-card-details">
          <div className="caixa-card-meta-grid">
            <span>Pedido: <strong>{pedidoDisplay}</strong></span>
            <span>Data do pedido: <strong>{formatDateOnlyFromDateTime(row.dt_ped)}</strong></span>
            <span>Data do embarque: <strong>{formatDateTimeBrasilia(row.dt_lib ?? row.event_at)}</strong></span>
            <span>Transportadora: <strong>{transportadoraLabel(row)}</strong></span>
            <span>Responsável: <strong>{row.responsavel_nome ?? "Não informado"}</strong>{row.responsavel_mat ? ` (${row.responsavel_mat})` : ""}</span>
            {row.next_embarque_at && <span>Embarque seguinte em: <strong>{formatDateTimeBrasilia(row.next_embarque_at)}</strong></span>}
            {row.document_confirmed_at && <span>Documento confirmado: <strong>{formatDateTimeBrasilia(row.document_confirmed_at)}</strong>{row.document_confirmed_nome ? ` | ${row.document_confirmed_nome}` : ""}</span>}
          </div>
          <p className="caixa-card-obs">{statusDescription(row)}</p>
          <div className="caixa-card-actions">
            {canConfirm ? (
              <button type="button" className="btn btn-primary" onClick={onConfirmDocumento} disabled={isBusy}>{isBusy ? "Confirmando..." : "Confirmar Recebimento do Documento"}</button>
            ) : (
              <button type="button" className="btn btn-muted" disabled>{row.status === "documentacao_recebida" ? "Documento já confirmado" : "Aguardando novo embarque da placa"}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
