import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { formatCountLabel, formatMetricWithUnit as formatMetricWithInflection } from "../../shared/inflection";
import { getModuleByKeyOrThrow } from "../registry";
import {
  fetchProdutividadeActivityTotals,
  fetchProdutividadeCollaborators,
  fetchProdutividadeDaily,
  fetchProdutividadeEntries,
  fetchProdutividadeRanking,
  fetchProdutividadeVisibility,
  setProdutividadeVisibility
} from "./sync";
import type {
  ProdutividadeActivityTotalRow,
  ProdutividadeCollaboratorRow,
  ProdutividadeDailyRow,
  ProdutividadeEntryRow,
  ProdutividadeModuleProfile,
  ProdutividadeRankingRow,
  ProdutividadeVisibilityMode,
  ProdutividadeVisibilityRow
} from "./types";

interface ProdutividadePageProps {
  isOnline: boolean;
  profile: ProdutividadeModuleProfile;
}

type ConfirmDialogState = {
  kind: "visibility";
  nextMode: ProdutividadeVisibilityMode;
};

const MODULE_DEF = getModuleByKeyOrThrow("produtividade");

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: ProdutividadeModuleProfile): number | null {
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

function monthStartIsoBrasilia(): string {
  const now = new Date();
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).format(now);
  return `${month}-01`;
}

function formatDate(value: string): string {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(parsed);
}

function formatDateTime(value: string): string {
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

function formatMetric(value: number, unit: string): string {
  const safe = Number.isFinite(value) ? value : 0;
  if (unit === "pontos") {
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(safe);
  }
  const rounded = Math.round(safe);
  if (Math.abs(safe - rounded) < 0.001) {
    return new Intl.NumberFormat("pt-BR", {
      maximumFractionDigits: 0
    }).format(rounded);
  }
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  }).format(safe);
}

function formatMetricWithUnit(value: number, unitLabel: string): string {
  return formatMetricWithInflection(value, unitLabel, formatMetric);
}

function asUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Erro inesperado.";
}

function visibilityModeLabel(mode: ProdutividadeVisibilityMode): string {
  return mode === "owner_only" ? "Somente dono/admin" : "Público no CD";
}

function visibilityIcon(isOwnerOnly: boolean) {
  if (isOwnerOnly) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function ProdutividadePage({ isOnline, profile }: ProdutividadePageProps) {
  const displayUserName = toDisplayName(profile.nome);
  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const isAdmin = profile.role === "admin";

  const [dateStart, setDateStart] = useState<string>(monthStartIsoBrasilia());
  const [dateEnd, setDateEnd] = useState<string>(todayIsoBrasilia());

  const [viewMode, setViewMode] = useState<"history" | "ranking">("history");
  const [rankingMonth, setRankingMonth] = useState<string>(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit"
    }).format(new Date()).slice(0, 7)
  );
  const [rankingRows, setRankingRows] = useState<ProdutividadeRankingRow[]>([]);
  const [loadingRanking, setLoadingRanking] = useState(false);
  const [expandedRankingUser, setExpandedRankingUser] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busyRefresh, setBusyRefresh] = useState(false);
  const [busyVisibility, setBusyVisibility] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [visibility, setVisibility] = useState<ProdutividadeVisibilityRow | null>(null);
  const [collaborators, setCollaborators] = useState<ProdutividadeCollaboratorRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(profile.user_id);
  const [collaboratorSearch, setCollaboratorSearch] = useState("");

  const [activityTotals, setActivityTotals] = useState<ProdutividadeActivityTotalRow[]>([]);
  const [dailyRows, setDailyRows] = useState<ProdutividadeDailyRow[]>([]);
  const [entries, setEntries] = useState<ProdutividadeEntryRow[]>([]);
  const [activityFilter, setActivityFilter] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const selectedCollaborator = useMemo(
    () => collaborators.find((row) => row.user_id === selectedUserId) ?? null,
    [collaborators, selectedUserId]
  );
  const filteredCollaborators = useMemo(() => {
    const query = collaboratorSearch.trim().toLocaleLowerCase("pt-BR");
    if (!query) return collaborators;
    return collaborators.filter((row) => `${row.nome} ${row.mat}`.toLocaleLowerCase("pt-BR").includes(query));
  }, [collaboratorSearch, collaborators]);
  const moduleTotals = useMemo(() => {
    return collaborators.reduce(
      (acc, row) => {
        acc.registros += row.registros_count;
        acc.valorTotal += row.valor_total;
        return acc;
      },
      { registros: 0, valorTotal: 0 }
    );
  }, [collaborators]);

  const canLoadRange = dateStart.trim() !== "" && dateEnd.trim() !== "" && dateStart <= dateEnd;

  const dailyGroups = useMemo(() => {
    const map = new Map<string, { date: string; total: number; items: ProdutividadeDailyRow[] }>();
    for (const row of dailyRows) {
      const existing = map.get(row.date_ref);
      if (!existing) {
        map.set(row.date_ref, {
          date: row.date_ref,
          total: row.valor_total,
          items: [row]
        });
      } else {
        existing.total += row.valor_total;
        existing.items.push(row);
      }
    }

    return [...map.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((bucket) => ({
        ...bucket,
        items: [...bucket.items].sort((a, b) => b.valor_total - a.valor_total)
      }));
  }, [dailyRows]);

  const loadEntriesOnly = useCallback(async (targetUserId: string | null, nextActivityKey: string | null) => {
    if (activeCd == null || targetUserId == null) {
      setEntries([]);
      return;
    }
    const rows = await fetchProdutividadeEntries({
      cd: activeCd,
      targetUserId,
      dtIni: dateStart,
      dtFim: dateEnd,
      activityKey: nextActivityKey,
      limit: 500
    });
    setEntries(rows);
  }, [activeCd, dateEnd, dateStart]);

  const loadUserPanels = useCallback(async (targetUserId: string | null, nextActivityKey: string | null) => {
    if (activeCd == null || targetUserId == null) {
      setActivityTotals([]);
      setDailyRows([]);
      setEntries([]);
      return;
    }

    setLoadingDetail(true);
    setErrorMessage(null);
    try {
      const [totals, daily, entryRows] = await Promise.all([
        fetchProdutividadeActivityTotals({
          cd: activeCd,
          targetUserId,
          dtIni: dateStart,
          dtFim: dateEnd
        }),
        fetchProdutividadeDaily({
          cd: activeCd,
          targetUserId,
          dtIni: dateStart,
          dtFim: dateEnd
        }),
        fetchProdutividadeEntries({
          cd: activeCd,
          targetUserId,
          dtIni: dateStart,
          dtFim: dateEnd,
          activityKey: nextActivityKey,
          limit: 500
        })
      ]);

      setActivityTotals(totals);
      setDailyRows(daily);
      setEntries(entryRows);
    } catch (error) {
      setErrorMessage(asUnknownErrorMessage(error));
    } finally {
      setLoadingDetail(false);
    }
  }, [activeCd, dateEnd, dateStart]);

  const loadModuleData = useCallback(async (preferredUserId?: string | null) => {
    if (!canLoadRange) {
      setErrorMessage("Período inválido. Ajuste a data inicial e final.");
      return;
    }
    if (activeCd == null) {
      setVisibility(null);
      setCollaborators([]);
      setActivityTotals([]);
      setDailyRows([]);
      setEntries([]);
      setErrorMessage("CD não definido para este usuário.");
      setLoading(false);
      return;
    }

    const isFirstLoad = loading;
    if (isFirstLoad) {
      setLoading(true);
    } else {
      setBusyRefresh(true);
    }
    setErrorMessage(null);

    try {
      const [visibilityRow, collaboratorRows] = await Promise.all([
        fetchProdutividadeVisibility(activeCd),
        fetchProdutividadeCollaborators({
          cd: activeCd,
          dtIni: dateStart,
          dtFim: dateEnd
        })
      ]);

      const preferred = preferredUserId ?? selectedUserId ?? profile.user_id;
      let nextSelectedUserId: string | null = preferred;
      if (collaboratorRows.length > 0) {
        if (!nextSelectedUserId || !collaboratorRows.some((row) => row.user_id === nextSelectedUserId)) {
          nextSelectedUserId = collaboratorRows[0].user_id;
        }
      } else {
        nextSelectedUserId = profile.user_id;
      }

      setVisibility(visibilityRow);
      setCollaborators(collaboratorRows);
      setSelectedUserId(nextSelectedUserId);
      await loadUserPanels(nextSelectedUserId, activityFilter);
    } catch (error) {
      setErrorMessage(asUnknownErrorMessage(error));
    } finally {
      setBusyRefresh(false);
      setLoading(false);
    }
  }, [activeCd, activityFilter, canLoadRange, dateEnd, dateStart, loadUserPanels, loading, profile.user_id, selectedUserId]);

  const loadRankingData = useCallback(async () => {
    if (activeCd == null) return;
    setLoadingRanking(true);
    setErrorMessage(null);
    try {
      const parts = rankingMonth.split("-");
      const ano = parts[0] ? parseInt(parts[0], 10) : null;
      const mes = parts[1] ? parseInt(parts[1], 10) : null;
      const rows = await fetchProdutividadeRanking({ cd: activeCd, ano, mes });
      setRankingRows(rows);
    } catch (error) {
      setErrorMessage(asUnknownErrorMessage(error));
    } finally {
      setLoadingRanking(false);
    }
  }, [activeCd, rankingMonth]);

  useEffect(() => {
    if (viewMode === "history") {
      void loadModuleData(profile.user_id);
    } else {
      void loadRankingData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCd, viewMode]);

  const onSelectCollaborator = useCallback((targetUserId: string) => {
    if (targetUserId === selectedUserId) return;
    setSelectedUserId(targetUserId);
    setStatusMessage(null);
    void loadUserPanels(targetUserId, activityFilter).catch((error) => {
      setErrorMessage(asUnknownErrorMessage(error));
    });
  }, [activityFilter, loadUserPanels, selectedUserId]);

  const onToggleActivityFilter = useCallback((nextActivityKey: string) => {
    const resolved = activityFilter === nextActivityKey ? null : nextActivityKey;
    setActivityFilter(resolved);
    setStatusMessage(null);
    void loadEntriesOnly(selectedUserId, resolved).catch((error) => {
      setErrorMessage(asUnknownErrorMessage(error));
    });
  }, [activityFilter, loadEntriesOnly, selectedUserId]);

  const onClearActivityFilter = useCallback(() => {
    setActivityFilter(null);
    setStatusMessage(null);
    void loadEntriesOnly(selectedUserId, null).catch((error) => {
      setErrorMessage(asUnknownErrorMessage(error));
    });
  }, [loadEntriesOnly, selectedUserId]);

  const onToggleVisibility = useCallback(() => {
    if (!isAdmin || !visibility || activeCd == null || busyVisibility) return;
    const nextMode: ProdutividadeVisibilityMode = visibility.visibility_mode === "public_cd" ? "owner_only" : "public_cd";
    setConfirmDialog({
      kind: "visibility",
      nextMode
    });
  }, [activeCd, busyVisibility, isAdmin, visibility]);

  const onConfirmDialog = useCallback(async () => {
    if (!confirmDialog) return;
    if (!isAdmin || !visibility || activeCd == null || busyVisibility) {
      setConfirmDialog(null);
      return;
    }

    setBusyVisibility(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setConfirmDialog(null);
    try {
      const row = await setProdutividadeVisibility(activeCd, confirmDialog.nextMode);
      setVisibility(row);
      setStatusMessage(`Visibilidade atualizada: ${visibilityModeLabel(row.visibility_mode)}.`);
      await loadModuleData(selectedUserId ?? profile.user_id);
    } catch (error) {
      setErrorMessage(asUnknownErrorMessage(error));
    } finally {
      setBusyVisibility(false);
    }
  }, [activeCd, busyVisibility, confirmDialog, isAdmin, loadModuleData, profile.user_id, selectedUserId, visibility]);

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

      <section className="modules-shell produtividade-shell">
        <article className="module-screen surface-enter produtividade-screen">
          <div className="module-screen-header">
            <div className="module-screen-title-row">
              <div className="module-screen-title">
                <h2>{viewMode === "history" ? "Painel histórico de produtividade" : "Ranking de Produtividade"}</h2>
              </div>
              <div className="produtividade-actions-head">
                <button
                  type="button"
                  className={`btn ${viewMode === "ranking" ? "btn-primary" : "btn-muted"} produtividade-ranking-btn`}
                  onClick={() => setViewMode(viewMode === "history" ? "ranking" : "history")}
                >
                  {viewMode === "history" ? "🏆 Ver Ranking" : "Voltar ao Histórico"}
                </button>
                {viewMode === "history" && (
                  <button
                    type="button"
                    className="btn btn-muted"
                    onClick={() => void loadModuleData(selectedUserId ?? profile.user_id)}
                    disabled={busyRefresh || loading || loadingDetail}
                  >
                    {busyRefresh ? "Atualizando..." : "Atualizar"}
                  </button>
                )}
                {isAdmin && visibility ? (
                  <button
                    type="button"
                    className="btn btn-muted produtividade-visibility-btn"
                    onClick={() => void onToggleVisibility()}
                    disabled={busyVisibility}
                  >
                    <span aria-hidden="true">{visibilityIcon(visibility.visibility_mode === "owner_only")}</span>
                    {busyVisibility ? "Salvando..." : visibilityModeLabel(visibility.visibility_mode)}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="module-screen-body produtividade-body">
            {viewMode === "history" && loading ? <div className="coleta-empty">Carregando produtividade...</div> : null}
            {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
            {statusMessage ? <div className="alert success">{statusMessage}</div> : null}

            {viewMode === "ranking" ? (
              <section className="produtividade-ranking-view">
                <div className="produtividade-period-card">
                  <div className="produtividade-period-row">
                    <label>
                      Referência (Mês/Ano)
                      <input type="month" value={rankingMonth} onChange={(event) => setRankingMonth(event.target.value)} />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void loadRankingData()}
                      disabled={loadingRanking}
                    >
                      {loadingRanking ? "Calculando..." : "Buscar Ranking"}
                    </button>
                  </div>
                </div>

                {loadingRanking ? (
                  <div className="coleta-empty">Calculando ranking...</div>
                ) : rankingRows.length === 0 ? (
                  <div className="coleta-empty">Nenhum dado de ranking para o mês selecionado.</div>
                ) : (
                  <div className="produtividade-ranking-table-scroller">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Posição</th>
                          <th>Colaborador</th>
                          <th>Pontos Totais</th>
                          <th style={{ width: "48px" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankingRows.map((row, idx) => {
                          const isExpanded = expandedRankingUser === row.user_id;
                          return (
                            <Fragment key={row.user_id}>
                              <tr className={idx < 3 ? `ranking-top-${idx + 1}` : ""}>
                                <td align="center">
                                  {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}º`}
                                </td>
                                <td>
                                  <strong>{row.nome}</strong>
                                  <br />
                                  <small>{row.mat}</small>
                                </td>
                                <td align="right">
                                  <strong>{formatMetric(row.total_pontos, "")}</strong>
                                </td>
                                <td align="center">
                                  <button
                                    type="button"
                                    className="btn btn-icon"
                                    onClick={() => setExpandedRankingUser(isExpanded ? null : row.user_id)}
                                    title="Ver detalhes"
                                  >
                                    {isExpanded ? "➖" : "➕"}
                                  </button>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="ranking-details-row">
                                  <td colSpan={4} className="ranking-details-cell">
                                    <div className="ranking-details-grid" style={{
                                      display: "grid",
                                      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                      gap: "8px",
                                      padding: "16px",
                                      background: "var(--color-bg-alt)",
                                      borderRadius: "8px",
                                      marginTop: "4px"
                                    }}>
                                      <div><strong>PVPs:</strong><br />{formatMetric(row.pvps_pontos, "")} pts</div>
                                      <div><strong>Volume:</strong><br />{formatMetric(row.vol_pontos, "")} pts</div>
                                      <div><strong>Blitz:</strong><br />{formatMetric(row.blitz_pontos, "")} pts</div>
                                      <div><strong>Ativ Extra:</strong><br />{formatMetric(row.atividade_extra_pontos, "")} pts</div>
                                      <div><strong>Alocação:</strong><br />{formatCountLabel(row.alocacao_qtd, "end", "ends")}</div>
                                      <div><strong>Devolução:</strong><br />{formatCountLabel(row.devolucao_qtd, "nf", "nfs")}</div>
                                      <div><strong>Ter. Conf:</strong><br />{formatCountLabel(row.conf_termo_qtd, "sku", "skus")}</div>
                                      <div><strong>Avul. Conf:</strong><br />{formatCountLabel(row.conf_avulso_qtd, "sku", "skus")}</div>
                                      <div><strong>Ent. Notas:</strong><br />{formatCountLabel(row.conf_entrada_qtd, "sku", "skus")}</div>
                                      <div><strong>Reg Lojas:</strong><br />{formatCountLabel(row.conf_lojas_qtd, "loja", "lojas")}</div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : (
              <>
                <section className="produtividade-period-card">
                  <div className="produtividade-period-row">
                    <label>
                      Data inicial
                      <input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} />
                    </label>
                    <label>
                      Data final
                      <input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void loadModuleData(selectedUserId ?? profile.user_id)}
                      disabled={!canLoadRange || busyRefresh || loading || loadingDetail}
                    >
                      Aplicar período
                    </button>
                  </div>
                  <div className="produtividade-overview-strip">
                    <article className="produtividade-kpi-card">
                      <small>Colaboradores ativos</small>
                      <strong>{collaborators.length}</strong>
                    </article>
                    <article className="produtividade-kpi-card">
                      <small>Total bruto no período</small>
                      <strong>{formatMetric(moduleTotals.valorTotal, "")}</strong>
                    </article>
                    <article className="produtividade-kpi-card">
                      <small>Registros no período</small>
                      <strong>{formatCountLabel(moduleTotals.registros, "registro", "registros")}</strong>
                    </article>
                    <article className="produtividade-kpi-card">
                      <small>Colaborador selecionado</small>
                      <strong>{selectedCollaborator?.nome ?? "-"}</strong>
                    </article>
                  </div>
                </section>

                <div className="produtividade-grid">
                  <section className="produtividade-collaborators">
                    <div className="produtividade-collaborators-head">
                      <h3>Colaboradores</h3>
                      <label className="produtividade-collaborator-search">
                        <input
                          type="text"
                          value={collaboratorSearch}
                          onChange={(event) => setCollaboratorSearch(event.target.value)}
                          placeholder="Buscar por nome ou matrícula"
                        />
                      </label>
                    </div>
                    {collaborators.length === 0 ? (
                      <div className="coleta-empty">Sem registros no período selecionado.</div>
                    ) : filteredCollaborators.length === 0 ? (
                      <div className="coleta-empty">Nenhum colaborador encontrado para o filtro informado.</div>
                    ) : (
                      <div className="produtividade-collaborator-list">
                        {filteredCollaborators.map((row) => (
                          <button
                            key={`col:${row.user_id}`}
                            type="button"
                            className={`produtividade-collaborator-card${row.user_id === selectedUserId ? " is-selected" : ""}`}
                            onClick={() => onSelectCollaborator(row.user_id)}
                          >
                            <div className="produtividade-collaborator-top">
                              <strong>{row.nome}</strong>
                              <span>{row.mat}</span>
                            </div>
                            <div className="produtividade-collaborator-metrics">
                              <span>{formatCountLabel(row.dias_ativos, "dia ativo", "dias ativos")}</span>
                              <span>{formatCountLabel(row.atividades_count, "atividade", "atividades")}</span>
                              <span>{formatCountLabel(row.registros_count, "registro", "registros")}</span>
                            </div>
                            <small>{`Total bruto: ${formatMetric(row.valor_total, "")}`}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="produtividade-detail">
                    <h3>
                      Visão do colaborador
                      {selectedCollaborator ? `: ${selectedCollaborator.nome}` : ""}
                    </h3>

                    {selectedCollaborator ? (
                      <div className="produtividade-summary-strip">
                        <span>Registros: {selectedCollaborator.registros_count}</span>
                        <span>Dias ativos: {selectedCollaborator.dias_ativos}</span>
                        <span>Atividades no período: {selectedCollaborator.atividades_count}</span>
                        <span>Total bruto: {formatMetric(selectedCollaborator.valor_total, "")}</span>
                      </div>
                    ) : null}

                    <div className="produtividade-detail-grid">
                      <div className="produtividade-panel produtividade-activity-block">
                        <h4>Atividades principais</h4>
                        {activityTotals.length === 0 ? (
                          <div className="coleta-empty">Sem atividades para o colaborador selecionado.</div>
                        ) : (
                          <div className="produtividade-activity-grid">
                            {activityTotals.map((row) => (
                              <button
                                key={row.activity_key}
                                type="button"
                                className={`produtividade-activity-card${row.activity_key === activityFilter ? " is-active" : ""}`}
                                onClick={() => onToggleActivityFilter(row.activity_key)}
                              >
                                <strong>{row.activity_label}</strong>
                                <span>{formatMetricWithUnit(row.valor_total, row.unit_label)}</span>
                                <small>
                                  {formatCountLabel(row.registros_count, "registro", "registros")}
                                  {row.last_event_date ? ` | Último: ${formatDate(row.last_event_date)}` : ""}
                                </small>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="produtividade-panel produtividade-daily-block">
                        <h4>Produtividade diária</h4>
                        {dailyGroups.length === 0 ? (
                          <div className="coleta-empty">Sem dados diários no período.</div>
                        ) : (
                          <div className="produtividade-daily-list">
                            {dailyGroups.map((bucket) => (
                              <article key={bucket.date} className="produtividade-day-card">
                                <strong>{formatDate(bucket.date)}</strong>
                                <span>Total bruto do dia: {formatMetric(bucket.total, "")}</span>
                                <ul className="produtividade-day-items">
                                  {bucket.items.slice(0, 3).map((row, index) => (
                                    <li key={`${bucket.date}:${row.activity_key}:${index}`}>
                                      {`${row.activity_label}: ${formatMetricWithUnit(row.valor_total, row.unit_label)}`}
                                    </li>
                                  ))}
                                  {bucket.items.length > 3 ? <li className="is-more">{`+${bucket.items.length - 3} atividade(s)`}</li> : null}
                                </ul>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="produtividade-panel produtividade-entries-block">
                      <div className="produtividade-filter-line">
                        <span>
                          Filtro de detalhes:{" "}
                          {activityFilter
                            ? activityTotals.find((row) => row.activity_key === activityFilter)?.activity_label ?? activityFilter
                            : "Todas as atividades"}
                        </span>
                        <button
                          className="btn btn-muted"
                          type="button"
                          onClick={onClearActivityFilter}
                          disabled={activityFilter == null}
                        >
                          Limpar filtro
                        </button>
                      </div>
                      <h4>Detalhes das atividades</h4>
                      {loadingDetail ? <div className="coleta-empty">Carregando detalhes...</div> : null}
                      {!loadingDetail && entries.length === 0 ? (
                        <div className="coleta-empty">Nenhum detalhe para o filtro atual.</div>
                      ) : null}
                      {!loadingDetail ? (
                        <div className="produtividade-entry-list">
                          {entries.map((entry) => (
                            <article key={entry.entry_id} className="produtividade-entry-card">
                              <div className="produtividade-entry-head">
                                <strong>{entry.activity_label}</strong>
                                <span>{formatMetricWithUnit(entry.metric_value, entry.unit_label)}</span>
                              </div>
                              <p>{entry.detail || "-"}</p>
                              <div className="produtividade-entry-meta">
                                <span>Data: {formatDate(entry.event_date)}</span>
                                {entry.event_at ? <span>Registro: {formatDateTime(entry.event_at)}</span> : null}
                                {entry.source_ref ? <span>Ref: {entry.source_ref}</span> : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>
              </>
            )}
          </div>
        </article>
      </section>
      {confirmDialog && typeof document !== "undefined"
        ? createPortal(
          <div
            className="confirm-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="produtividade-confirm-title"
            onClick={() => setConfirmDialog(null)}
          >
            <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
              <h3 id="produtividade-confirm-title">Alterar visibilidade</h3>
              <p>
                {confirmDialog.nextMode === "owner_only"
                  ? "Somente o dono e administradores verão atividades de outros colaboradores. Deseja continuar?"
                  : "Todos os usuários do CD poderão visualizar as atividades registradas. Deseja continuar?"}
              </p>
              <div className="confirm-actions">
                <button
                  className="btn btn-muted"
                  type="button"
                  onClick={() => setConfirmDialog(null)}
                  disabled={busyVisibility}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void onConfirmDialog()}
                  disabled={busyVisibility}
                >
                  {busyVisibility ? "Salvando..." : "Confirmar"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
        : null}
    </>
  );
}
