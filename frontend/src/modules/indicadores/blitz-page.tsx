import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import pmImage from "../../../assets/pm.png";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import {
  fetchIndicadoresBlitzDailySeries,
  fetchIndicadoresBlitzDayDetails,
  fetchIndicadoresBlitzMonthOptions,
  fetchIndicadoresBlitzSummary,
  fetchIndicadoresBlitzZoneTotals
} from "./sync";
import type {
  IndicadoresBlitzDailyRow,
  IndicadoresBlitzDayDetailRow,
  IndicadoresBlitzMonthOption,
  IndicadoresBlitzSummary,
  IndicadoresBlitzZoneTotalRow,
  IndicadoresModuleProfile
} from "./types";

interface IndicadoresBlitzPageProps {
  isOnline: boolean;
  profile: IndicadoresModuleProfile;
}

interface MetricCardDefinition {
  label: string;
  value: string;
  accent?: "danger" | "warning" | "neutral";
}

const MODULE_DEF = getModuleByKeyOrThrow("indicadores");

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: IndicadoresModuleProfile): number | null {
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

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Erro inesperado.";
}

function todayIsoBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(parsed);
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

function formatInteger(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 0
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDecimal(value: number, digits = 2): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number): string {
  return `${formatDecimal(value, 2)}%`;
}

function buildCalendarDays(monthStart: string, monthEnd: string): string[] {
  if (!monthStart || !monthEnd) return [];
  const current = new Date(`${monthStart}T00:00:00`);
  const limit = new Date(`${monthEnd}T00:00:00`);
  if (Number.isNaN(current.getTime()) || Number.isNaN(limit.getTime())) return [];

  const days: string[] = [];
  while (current <= limit) {
    days.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function resolveInitialDay(summary: IndicadoresBlitzSummary, previousDay: string | null): string {
  const allDays = buildCalendarDays(summary.month_start, summary.month_end);
  const today = todayIsoBrasilia();

  if (previousDay && allDays.includes(previousDay)) return previousDay;
  if (today >= summary.month_start && today <= summary.month_end && allDays.includes(today)) return today;
  if (summary.available_day_end && allDays.includes(summary.available_day_end)) return summary.available_day_end;
  return allDays[0] ?? summary.month_start;
}

function statusClassName(status: IndicadoresBlitzDayDetailRow["status"]): string {
  if (status === "Falta") return "is-falta";
  if (status === "Sobra") return "is-sobra";
  return "is-fora";
}

function DailyChart({ rows }: { rows: IndicadoresBlitzDailyRow[] }) {
  const chartWidth = Math.max(rows.length * 36, 760);
  const chartHeight = 244;
  const plotHeight = 162;
  const barWidth = 16;
  const maxConferido = Math.max(1, ...rows.map((row) => row.conferido_total));
  const maxPercent = Math.max(1, ...rows.map((row) => row.percentual_oficial));

  const linePoints = rows
    .map((row, index) => {
      const x = 28 + index * 36 + barWidth / 2;
      const y = 28 + (1 - row.percentual_oficial / maxPercent) * plotHeight;
      return `${x},${Number.isFinite(y) ? y : 28 + plotHeight}`;
    })
    .join(" ");

  return (
    <div className="indicadores-chart-shell">
      <div className="indicadores-chart-scroll">
        <svg className="indicadores-chart-svg" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Conferência diária do mês Blitz">
          <line x1="18" y1="190" x2={chartWidth - 16} y2="190" className="indicadores-chart-axis" />
          <line x1="18" y1="28" x2="18" y2="190" className="indicadores-chart-axis" />
          {rows.map((row, index) => {
            const x = 28 + index * 36;
            const barHeight = (row.conferido_total / maxConferido) * plotHeight;
            const y = 190 - barHeight;
            return (
              <g key={row.date_ref}>
                <rect x={x} y={y} width={barWidth} height={barHeight} rx="5" className="indicadores-chart-bar" />
                <text x={x + barWidth / 2} y="206" textAnchor="middle" className="indicadores-chart-label">
                  {row.date_ref.slice(8, 10)}
                </text>
                {row.conferido_total > 0 ? (
                  <text x={x + barWidth / 2} y={Math.max(y - 6, 18)} textAnchor="middle" className="indicadores-chart-value">
                    {formatInteger(row.conferido_total)}
                  </text>
                ) : null}
              </g>
            );
          })}
          {rows.length > 1 ? <polyline points={linePoints} className="indicadores-chart-line" /> : null}
          {rows.map((row, index) => {
            const cx = 28 + index * 36 + barWidth / 2;
            const cy = 28 + (1 - row.percentual_oficial / maxPercent) * plotHeight;
            return (
              <g key={`${row.date_ref}:point`}>
                <circle cx={cx} cy={Number.isFinite(cy) ? cy : 28 + plotHeight} r="4" className="indicadores-chart-point" />
                {row.percentual_oficial > 0 ? (
                  <text x={cx} y={Math.max(cy - 10, 16)} textAnchor="middle" className="indicadores-chart-percent">
                    {formatPercent(row.percentual_oficial)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="indicadores-chart-legend">
        <span><i className="is-conferido" /> Conferido</span>
        <span><i className="is-percentual" /> Percentual oficial</span>
      </div>
    </div>
  );
}

function ZoneChart({ rows }: { rows: IndicadoresBlitzZoneTotalRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="indicadores-empty-box">
        <p>Nenhuma zona com mais de 1 erro no mês selecionado.</p>
      </div>
    );
  }

  const maxTotal = Math.max(1, ...rows.map((row) => row.erro_total));

  return (
    <div className="indicadores-zone-chart">
      <div className="indicadores-zone-scroll">
        {rows.map((row) => {
          const faltaHeight = (row.falta_total / maxTotal) * 180;
          const sobraHeight = (row.sobra_total / maxTotal) * 180;
          const foraHeight = (row.fora_politica_total / maxTotal) * 180;
          return (
            <div key={row.zona} className="indicadores-zone-column">
              <div className="indicadores-zone-stack" title={`${row.zona}: ${formatInteger(row.erro_total)} erros`}>
                <div className="indicadores-zone-segment is-fora" style={{ height: `${foraHeight}px` }} />
                <div className="indicadores-zone-segment is-sobra" style={{ height: `${sobraHeight}px` }} />
                <div className="indicadores-zone-segment is-falta" style={{ height: `${faltaHeight}px` }} />
              </div>
              <strong>{row.zona}</strong>
              <span>{formatInteger(row.erro_total)}</span>
            </div>
          );
        })}
      </div>
      <div className="indicadores-chart-legend">
        <span><i className="is-falta" /> Falta</span>
        <span><i className="is-sobra" /> Sobra</span>
        <span><i className="is-fora" /> Fora da política</span>
      </div>
    </div>
  );
}

export default function IndicadoresBlitzPage({ isOnline, profile }: IndicadoresBlitzPageProps) {
  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);

  const [monthOptions, setMonthOptions] = useState<IndicadoresBlitzMonthOption[]>([]);
  const [selectedMonthStart, setSelectedMonthStart] = useState<string>("");
  const [selectedDay, setSelectedDay] = useState<string>("");

  const [summary, setSummary] = useState<IndicadoresBlitzSummary | null>(null);
  const [dailySeries, setDailySeries] = useState<IndicadoresBlitzDailyRow[]>([]);
  const [zoneTotals, setZoneTotals] = useState<IndicadoresBlitzZoneTotalRow[]>([]);
  const [dayDetails, setDayDetails] = useState<IndicadoresBlitzDayDetailRow[]>([]);

  const [loadingMonths, setLoadingMonths] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMonths() {
      setLoadingMonths(true);
      setErrorMessage(null);
      try {
        const nextMonths = await fetchIndicadoresBlitzMonthOptions(activeCd);
        if (cancelled) return;
        setMonthOptions(nextMonths);
        setSelectedMonthStart((current) => current || nextMonths[0]?.month_start || "");
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(asErrorMessage(error));
          setMonthOptions([]);
        }
      } finally {
        if (!cancelled) setLoadingMonths(false);
      }
    }

    void loadMonths();
    return () => {
      cancelled = true;
    };
  }, [activeCd]);

  useEffect(() => {
    if (!selectedMonthStart) {
      setSummary(null);
      setDailySeries([]);
      setZoneTotals([]);
      return;
    }

    let cancelled = false;

    async function loadDashboard() {
      setLoadingDashboard(true);
      setErrorMessage(null);
      try {
        const [nextSummary, nextDaily, nextZones] = await Promise.all([
          fetchIndicadoresBlitzSummary(activeCd, selectedMonthStart),
          fetchIndicadoresBlitzDailySeries(activeCd, selectedMonthStart),
          fetchIndicadoresBlitzZoneTotals(activeCd, selectedMonthStart)
        ]);
        if (cancelled) return;
        setSummary(nextSummary);
        setDailySeries(nextDaily);
        setZoneTotals(nextZones);
        setSelectedDay((current) => resolveInitialDay(nextSummary, current || null));
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(asErrorMessage(error));
          setSummary(null);
          setDailySeries([]);
          setZoneTotals([]);
        }
      } finally {
        if (!cancelled) setLoadingDashboard(false);
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [activeCd, selectedMonthStart]);

  useEffect(() => {
    if (!selectedMonthStart || !selectedDay) {
      setDayDetails([]);
      return;
    }

    let cancelled = false;

    async function loadDetails() {
      setLoadingDetails(true);
      setErrorMessage(null);
      try {
        const rows = await fetchIndicadoresBlitzDayDetails(activeCd, selectedMonthStart, selectedDay);
        if (!cancelled) setDayDetails(rows);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(asErrorMessage(error));
          setDayDetails([]);
        }
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    }

    void loadDetails();
    return () => {
      cancelled = true;
    };
  }, [activeCd, selectedDay, selectedMonthStart]);

  const selectedMonthLabel = useMemo(
    () => monthOptions.find((option) => option.month_start === selectedMonthStart)?.month_label ?? "-",
    [monthOptions, selectedMonthStart]
  );

  const dayOptions = useMemo(() => {
    if (!summary) return [];
    return buildCalendarDays(summary.month_start, summary.month_end);
  }, [summary]);

  const metricCards = useMemo<MetricCardDefinition[]>(() => {
    if (!summary) return [];
    return [
      { label: "Percentual Oficial %", value: formatPercent(summary.percentual_oficial) },
      { label: "Divergências Oficial", value: formatInteger(summary.divergencia_oficial), accent: "danger" },
      { label: "Percentual Fora da Política", value: formatPercent(summary.percentual_fora_politica), accent: "warning" },
      { label: "Fora da Política", value: formatInteger(summary.fora_politica_total), accent: "warning" },
      { label: "Avaria Mês", value: formatInteger(summary.avaria_mes) },
      { label: "Erros de Hoje", value: summary.erros_hoje == null ? " " : formatInteger(summary.erros_hoje), accent: "danger" },
      { label: "Média de Conferência", value: formatDecimal(summary.media_conferencia_dia, 2) },
      { label: "Conferido Geral", value: formatInteger(summary.conferido_total) }
    ];
  }, [summary]);

  return (
    <>
      <header className="module-topbar module-topbar-fixed indicadores-topbar">
        <div className="module-topbar-line1">
          <Link
            to="/modulos/indicadores"
            className="module-home-btn"
            aria-label="Voltar para Indicadores"
            title="Voltar para Indicadores"
          >
            <span className="module-back-icon" aria-hidden="true">
              <BackIcon />
            </span>
            <span>Indicadores</span>
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
          <span className="module-title">Indicadores · Blitz</span>
        </div>
      </header>

      <section className="modules-shell indicadores-shell">
        <article className="module-screen surface-enter indicadores-screen indicadores-screen-blitz">
          <div className="module-screen-header">
            <div className="module-screen-title-row">
              <div className="module-screen-title indicadores-title-stack">
                <img className="indicadores-screen-logo" src={pmImage} alt="PM" />
                <div>
                  <h2>Dashboard Blitz</h2>
                  <span className="module-status">
                    CD ativo do usuário · mês {selectedMonthLabel} · atualizado em {formatDateTime(summary?.updated_at ?? null)}
                  </span>
                </div>
              </div>
              <div className="indicadores-filters">
                <label>
                  <span>Mês</span>
                  <select
                    value={selectedMonthStart}
                    onChange={(event) => setSelectedMonthStart(event.target.value)}
                    disabled={loadingMonths || monthOptions.length === 0}
                  >
                    {monthOptions.length === 0 ? <option value="">Sem meses</option> : null}
                    {monthOptions.map((option) => (
                      <option key={option.month_start} value={option.month_start}>
                        {option.month_label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Data</span>
                  <select
                    value={selectedDay}
                    onChange={(event) => setSelectedDay(event.target.value)}
                    disabled={!summary || dayOptions.length === 0}
                  >
                    {dayOptions.length === 0 ? <option value="">Sem datas</option> : null}
                    {dayOptions.map((day) => (
                      <option key={day} value={day}>
                        {formatDate(day)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>

          {errorMessage ? <div className="indicadores-feedback is-error">{errorMessage}</div> : null}

          <div className="indicadores-metrics-grid">
            {metricCards.map((card) => (
              <article key={card.label} className={`indicadores-metric-card ${card.accent ? `accent-${card.accent}` : ""}`}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </article>
            ))}
          </div>

          <div className="indicadores-layout-grid">
            <section className="indicadores-panel indicadores-panel-wide">
              <div className="indicadores-panel-head">
                <h3>Conferência do mês</h3>
                <span>{loadingDashboard ? "Atualizando..." : "Barras de conferido e linha percentual"}</span>
              </div>
              {loadingDashboard && !summary ? (
                <div className="indicadores-empty-box"><p>Carregando dados do mês...</p></div>
              ) : (
                <DailyChart rows={dailySeries} />
              )}
            </section>

            <section className="indicadores-panel indicadores-panel-side">
              <div className="indicadores-panel-head">
                <h3>Divergências do dia</h3>
                <span>{selectedDay ? formatDate(selectedDay) : "-"}</span>
              </div>
              <div className="indicadores-day-list">
                <div className="indicadores-day-list-head">
                  <span>Data</span>
                  <span>Descrição</span>
                  <span>Zona</span>
                  <span>Status</span>
                  <span>Filial</span>
                  <span>Qtd</span>
                </div>
                {loadingDetails ? (
                  <div className="indicadores-empty-box"><p>Carregando divergências do dia...</p></div>
                ) : dayDetails.length === 0 ? (
                  <div className="indicadores-empty-box"><p>Nenhuma divergência encontrada para a data selecionada.</p></div>
                ) : (
                  dayDetails.map((row, index) => (
                    <div key={`${row.data_conf}:${row.filial}:${row.pedido}:${row.coddv}:${row.status}:${index}`} className="indicadores-day-row">
                      <span>{formatDate(row.data_conf)}</span>
                      <span className="indicadores-day-description">
                        <strong>{row.descricao}</strong>
                        <small>Pedido {formatInteger(row.pedido)} · COD {formatInteger(row.coddv)}</small>
                      </span>
                      <span>{row.zona}</span>
                      <span>
                        <i className={`indicadores-status-badge ${statusClassName(row.status)}`}>{row.status}</i>
                      </span>
                      <span>{row.filial_nome}</span>
                      <span>{formatInteger(row.quantidade)}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="indicadores-panel indicadores-panel-wide">
              <div className="indicadores-panel-head">
                <h3>Total de erros por zona</h3>
                <span>Exibe apenas zonas com mais de 1 erro no mês.</span>
              </div>
              {loadingDashboard && zoneTotals.length === 0 ? (
                <div className="indicadores-empty-box"><p>Carregando zonas...</p></div>
              ) : (
                <ZoneChart rows={zoneTotals} />
              )}
            </section>
          </div>
        </article>
      </section>
    </>
  );
}
