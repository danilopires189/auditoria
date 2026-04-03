import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import pmImage from "../../../assets/pm.png";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { formatDateOnlyPtBR, formatDateTimeBrasilia, todayIsoBrasilia } from "../../shared/brasilia-datetime";
import { getModuleByKeyOrThrow } from "../registry";
import type { IndicadoresModuleProfile } from "./types";
import {
  fetchIndicadoresGestaoEstoqueDailySeries,
  fetchIndicadoresGestaoEstoqueDetails,
  fetchIndicadoresGestaoEstoqueLossDimension,
  fetchIndicadoresGestaoEstoqueMonthOptions,
  fetchIndicadoresGestaoEstoqueSummary,
  fetchIndicadoresGestaoEstoqueTopItems,
  fetchIndicadoresGestaoEstoqueYearReentryItems
} from "./gestao-estoque-sync";
import type {
  IndicadoresGestaoEstoqueDailyRow,
  IndicadoresGestaoEstoqueDetailRow,
  IndicadoresGestaoEstoqueLossDimensionItem,
  IndicadoresGestaoEstoqueMonthOption,
  IndicadoresGestaoEstoqueMovementFilter,
  IndicadoresGestaoEstoqueReentryItem,
  IndicadoresGestaoEstoqueSummary,
  IndicadoresGestaoEstoqueTopItem
} from "./gestao-estoque-types";

interface IndicadoresGestaoEstoquePageProps {
  isOnline: boolean;
  profile: IndicadoresModuleProfile;
}

interface MetricCardDefinition {
  label: string;
  value: number;
  kind: "currency" | "signed-currency" | "integer";
  accent?: "danger" | "warning" | "neutral" | "entry" | "exit";
  natureBadge?: "falta" | "sobra" | null;
}

const MODULE_DEF = getModuleByKeyOrThrow("indicadores");
const ALL_DAYS_VALUE = "__ALL_DAYS__";
const DETAIL_ROWS_LIMIT = 100;
const INSIGHT_ROWS_LIMIT = 10;
const REENTRY_ROWS_LIMIT = 12;

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

function resolveCdDisplayName(profile: IndicadoresModuleProfile, activeCd: number | null): string {
  const rawLabel = typeof profile.cd_nome === "string" ? profile.cd_nome.trim().replace(/\s+/g, " ") : "";
  if (rawLabel) return rawLabel;
  if (activeCd != null) return `CD ${String(activeCd).padStart(2, "0")}`;
  return "CD não definido";
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Erro inesperado.";
}

function formatDate(value: string | null): string {
  return formatDateOnlyPtBR(value, "-", "value");
}

function formatDateTime(value: string | null): string {
  return formatDateTimeBrasilia(value, { emptyFallback: "-", invalidFallback: "value" });
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 0
  }).format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const isInteger = Math.abs(safe % 1) < 0.000001;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: isInteger ? 0 : 2,
    maximumFractionDigits: isInteger ? 0 : 2
  }).format(safe);
}

function formatSigned(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const signal = safe > 0 ? "+" : "";
  return `${signal}${formatNumber(safe)}`;
}

function formatCurrency(value: number): string {
  return `R$ ${formatNumber(value)}`;
}

function formatSignedCurrency(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const signal = safe > 0 ? "+" : safe < 0 ? "-" : "";
  return `${signal}R$ ${formatNumber(Math.abs(safe))}`;
}

function formatCompactSignedDifference(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const signal = safe > 0 ? "+" : safe < 0 ? "-" : "";
  const formatted = new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    minimumFractionDigits: Math.abs(safe) >= 1000 ? 1 : 0,
    maximumFractionDigits: 1
  }).format(Math.abs(safe));
  return `${signal}${formatted}`;
}

function buildCalendarDays(monthStart: string, monthEnd: string): string[] {
  if (!monthStart || !monthEnd) return [];
  const current = new Date(`${monthStart}T00:00:00`);
  const today = todayIsoBrasilia();
  const cappedEnd = today < monthEnd ? today : monthEnd;
  const limit = new Date(`${cappedEnd}T00:00:00`);
  if (Number.isNaN(current.getTime()) || Number.isNaN(limit.getTime())) return [];
  if (current > limit) return [];

  const days: string[] = [];
  while (current <= limit) {
    days.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function formatMovementLabel(value: IndicadoresGestaoEstoqueMovementFilter): string {
  if (value === "entrada") return "Entrada";
  if (value === "saida") return "Saída";
  return "Todas";
}

function natureClassName(value: IndicadoresGestaoEstoqueDetailRow["natureza"]): string {
  if (value === "falta") return "is-falta";
  if (value === "sobra") return "is-sobra";
  return "is-neutro";
}

function signedDifferenceClassName(value: number): string {
  if (value > 0) return "is-falta";
  if (value < 0) return "is-sobra";
  return "is-neutro";
}

function lossNatureBadge(value: number): MetricCardDefinition["natureBadge"] {
  if (!Number.isFinite(value) || Math.abs(value) < 0.000001) return null;
  return value > 0 ? "falta" : "sobra";
}

function CurrencyMetricValue({ value, signed = false }: { value: number; signed?: boolean }) {
  const safe = Number.isFinite(value) ? value : 0;
  const signal = signed ? (safe > 0 ? "+" : safe < 0 ? "-" : "") : "";
  return (
    <strong className="gestao-estq-metric-value">
      <small>{`${signal}R$`}</small>
      <span>{formatNumber(Math.abs(safe))}</span>
    </strong>
  );
}

function DailyChart({ rows }: { rows: IndicadoresGestaoEstoqueDailyRow[] }) {
  const safeRows = Math.max(rows.length, 1);
  const horizontalPadding = 40;
  const slotWidth = 82;
  const chartWidth = Math.max(1480, horizontalPadding * 2 + safeRows * slotWidth);
  const chartHeight = 430;
  const barsTop = 28;
  const barsBottom = 210;
  const barsHeight = barsBottom - barsTop;
  const lossTop = 262;
  const lossBottom = 372;
  const lossMid = (lossTop + lossBottom) / 2;
  const lossHalf = (lossBottom - lossTop) / 2;
  const maxVolume = Math.max(1, ...rows.flatMap((row) => [row.entrada_total, row.saida_total]));
  const maxLossAbs = Math.max(1, ...rows.map((row) => Math.abs(row.perda_total)));

  const lossPath = rows
    .map((row, index) => {
      const baseX = horizontalPadding + index * slotWidth;
      const pointY = lossMid - (row.perda_total / maxLossAbs) * (lossHalf - 10);
      return `${index === 0 ? "M" : "L"} ${baseX} ${pointY}`;
    })
    .join(" ");

  return (
    <div className="indicadores-chart-shell gestao-estq-chart-shell">
      <div className="indicadores-chart-scroll">
        <svg className="indicadores-chart-svg" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Entradas, saídas e perda por dia do mês">
          <line x1="16" y1={barsBottom} x2={chartWidth - 12} y2={barsBottom} className="indicadores-chart-axis" />
          <line x1="16" y1={lossMid} x2={chartWidth - 12} y2={lossMid} className="indicadores-chart-axis gestao-estq-chart-loss-axis" />
          {rows.map((row, index) => {
            const baseX = horizontalPadding + index * slotWidth;
            const entryHeight = (row.entrada_total / maxVolume) * barsHeight;
            const exitHeight = (row.saida_total / maxVolume) * barsHeight;
            const entryY = barsBottom - entryHeight;
            const exitY = barsBottom - exitHeight;
            const lossY = lossMid - (row.perda_total / maxLossAbs) * (lossHalf - 10);
            const lossValueY = row.perda_total >= 0 ? lossY - 10 : lossY + 16;
            return (
              <g key={row.date_ref}>
                <rect x={baseX - 23} y={entryY} width="18" height={entryHeight} rx="6" className="indicadores-chart-bar gestao-estq-chart-entry">
                  <title>{`${formatDate(row.date_ref)} · Entradas ${formatCurrency(row.entrada_total)}`}</title>
                </rect>
                <rect x={baseX + 5} y={exitY} width="18" height={exitHeight} rx="6" className="indicadores-chart-bar gestao-estq-chart-exit">
                  <title>{`${formatDate(row.date_ref)} · Saídas ${formatCurrency(row.saida_total)}`}</title>
                </rect>
                <circle cx={baseX} cy={lossY} r="4.4" className="gestao-estq-chart-loss-point">
                  <title>{`${formatDate(row.date_ref)} · Perda ${formatSignedCurrency(row.perda_total)}`}</title>
                </circle>
                <text
                  x={baseX}
                  y={lossValueY}
                  textAnchor="middle"
                  className={`gestao-estq-chart-loss-value ${signedDifferenceClassName(row.perda_total)}`}
                >
                  {formatCompactSignedDifference(row.perda_total)}
                </text>
                <text x={baseX} y="236" textAnchor="middle" className="indicadores-chart-label gestao-estq-chart-day-label">
                  {row.date_ref.slice(8, 10)}
                </text>
              </g>
            );
          })}
          {rows.length > 1 ? <path d={lossPath} className="gestao-estq-chart-loss-line" /> : null}
          <text x="18" y={lossTop - 10} className="indicadores-chart-label gestao-estq-chart-section-label">Perda diária</text>
        </svg>
      </div>
      <div className="indicadores-chart-legend">
        <span><i className="gestao-estq-legend-entry" /> Entrada</span>
        <span><i className="gestao-estq-legend-exit" /> Saída</span>
        <span><i className="gestao-estq-legend-loss" /> Perda</span>
      </div>
    </div>
  );
}

function TopList({
  title,
  subtitle,
  rows,
  emptyMessage,
  className
}: {
  title: string;
  subtitle: string;
  rows: IndicadoresGestaoEstoqueTopItem[];
  emptyMessage: string;
  className?: string;
}) {
  return (
    <section className={`indicadores-panel gestao-estq-panel ${className ?? ""}`}>
      <div className="indicadores-panel-head">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </div>
      {rows.length === 0 ? (
        <div className="indicadores-empty-box"><p>{emptyMessage}</p></div>
      ) : (
        <div className="gestao-estq-top-list">
          {rows.map((row, index) => (
            <article key={`${row.movement_group}:${row.coddv}:${index}`} className="gestao-estq-top-item">
              <div className="gestao-estq-top-rank">{String(index + 1).padStart(2, "0")}</div>
              <div className="gestao-estq-top-main">
                <strong>{row.descricao}</strong>
                <small>CODDV {formatInteger(row.coddv)} · {row.movimentacoes} mov. · {row.dias_distintos} dias</small>
              </div>
              <div className="gestao-estq-top-value">
                <strong>{formatCurrency(row.total_valor)}</strong>
                <small>{row.last_date ? formatDate(row.last_date) : "-"}</small>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function LossDimensionList({
  title,
  subtitle,
  rows,
  emptyMessage
}: {
  title: string;
  subtitle: string;
  rows: IndicadoresGestaoEstoqueLossDimensionItem[];
  emptyMessage: string;
}) {
  return (
    <section className="indicadores-panel gestao-estq-panel gestao-estq-panel-loss">
      <div className="indicadores-panel-head">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </div>
      {rows.length === 0 ? (
        <div className="indicadores-empty-box"><p>{emptyMessage}</p></div>
      ) : (
        <div className="gestao-estq-loss-list">
          {rows.map((row, index) => (
            <article key={`${row.dimension_key}:${index}`} className="gestao-estq-loss-item">
              <div className="gestao-estq-top-rank">{String(index + 1).padStart(2, "0")}</div>
              <div className="gestao-estq-loss-main">
                <strong>{row.dimension_key}</strong>
                <small>{row.produtos_distintos_mes} prod. no mês · {row.produtos_distintos_ano} no ano</small>
              </div>
              <div className="gestao-estq-loss-metrics">
                <strong>{formatSignedCurrency(row.perda_acumulada_ano)}</strong>
                <small>Mês {formatSignedCurrency(row.perda_mes)}</small>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default function IndicadoresGestaoEstoquePage({ isOnline, profile }: IndicadoresGestaoEstoquePageProps) {
  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const displayCdName = useMemo(() => resolveCdDisplayName(profile, activeCd), [activeCd, profile]);

  const [monthOptions, setMonthOptions] = useState<IndicadoresGestaoEstoqueMonthOption[]>([]);
  const [selectedMonthStart, setSelectedMonthStart] = useState<string>("");
  const [selectedDay, setSelectedDay] = useState<string>(ALL_DAYS_VALUE);
  const [movementFilter, setMovementFilter] = useState<IndicadoresGestaoEstoqueMovementFilter>("todas");

  const [summary, setSummary] = useState<IndicadoresGestaoEstoqueSummary | null>(null);
  const [dailySeries, setDailySeries] = useState<IndicadoresGestaoEstoqueDailyRow[]>([]);
  const [topEntradas, setTopEntradas] = useState<IndicadoresGestaoEstoqueTopItem[]>([]);
  const [topSaidas, setTopSaidas] = useState<IndicadoresGestaoEstoqueTopItem[]>([]);
  const [detailRows, setDetailRows] = useState<IndicadoresGestaoEstoqueDetailRow[]>([]);
  const [reentryRows, setReentryRows] = useState<IndicadoresGestaoEstoqueReentryItem[]>([]);
  const [supplierLossRows, setSupplierLossRows] = useState<IndicadoresGestaoEstoqueLossDimensionItem[]>([]);
  const [categoryLossRows, setCategoryLossRows] = useState<IndicadoresGestaoEstoqueLossDimensionItem[]>([]);

  const [loadingMonths, setLoadingMonths] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [loadingTopLists, setLoadingTopLists] = useState(false);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [dashboardErrorMessage, setDashboardErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMonths() {
      setLoadingMonths(true);
      setDashboardErrorMessage(null);
      try {
        const nextMonths = await fetchIndicadoresGestaoEstoqueMonthOptions(activeCd);
        if (cancelled) return;
        setMonthOptions(nextMonths);
        setSelectedMonthStart((current) => current || nextMonths[0]?.month_start || "");
      } catch (error) {
        if (!cancelled) {
          setDashboardErrorMessage(asErrorMessage(error));
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
      setTopEntradas([]);
      setTopSaidas([]);
      setReentryRows([]);
      setSupplierLossRows([]);
      setCategoryLossRows([]);
      setShowDetails(false);
      return;
    }

    let cancelled = false;

    async function loadDashboard() {
      setLoadingDashboard(true);
      setDashboardErrorMessage(null);
      try {
        const [nextSummary, nextDaily] = await Promise.all([
          fetchIndicadoresGestaoEstoqueSummary(activeCd, selectedMonthStart, movementFilter),
          fetchIndicadoresGestaoEstoqueDailySeries(activeCd, selectedMonthStart, movementFilter)
        ]);
        if (cancelled) return;
        setSummary(nextSummary);
        setDailySeries(nextDaily);
      } catch (error) {
        if (!cancelled) {
          setDashboardErrorMessage(asErrorMessage(error));
          setSummary(null);
          setDailySeries([]);
          setTopEntradas([]);
          setTopSaidas([]);
        }
      } finally {
        if (!cancelled) setLoadingDashboard(false);
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [activeCd, movementFilter, selectedMonthStart]);

  useEffect(() => {
    if (!selectedMonthStart) {
      setTopEntradas([]);
      setTopSaidas([]);
      return;
    }

    let cancelled = false;

    async function loadTopLists() {
      setLoadingTopLists(true);
      try {
        const activeDay = selectedDay === ALL_DAYS_VALUE ? null : selectedDay;
        const [nextEntradas, nextSaidas] = await Promise.all([
          fetchIndicadoresGestaoEstoqueTopItems({
            cd: activeCd,
            monthStart: selectedMonthStart,
            day: activeDay,
            rankGroup: "entrada",
            movementFilter
          }),
          fetchIndicadoresGestaoEstoqueTopItems({
            cd: activeCd,
            monthStart: selectedMonthStart,
            day: activeDay,
            rankGroup: "saida",
            movementFilter
          })
        ]);
        if (cancelled) return;
        setTopEntradas(nextEntradas);
        setTopSaidas(nextSaidas);
      } catch (error) {
        if (!cancelled) {
          setTopEntradas([]);
          setTopSaidas([]);
        }
      } finally {
        if (!cancelled) setLoadingTopLists(false);
      }
    }

    void loadTopLists();
    return () => {
      cancelled = true;
    };
  }, [activeCd, movementFilter, selectedDay, selectedMonthStart]);

  useEffect(() => {
    if (!selectedMonthStart) {
      setReentryRows([]);
      setSupplierLossRows([]);
      setCategoryLossRows([]);
      return;
    }

    let cancelled = false;

    async function loadInsights() {
      setLoadingInsights(true);
      try {
        const [nextReentries, nextSupplierLoss, nextCategoryLoss] = await Promise.all([
          fetchIndicadoresGestaoEstoqueYearReentryItems(activeCd, selectedMonthStart, REENTRY_ROWS_LIMIT),
          fetchIndicadoresGestaoEstoqueLossDimension({
            cd: activeCd,
            monthStart: selectedMonthStart,
            dimension: "fornecedor",
            movementFilter,
            limit: INSIGHT_ROWS_LIMIT
          }),
          fetchIndicadoresGestaoEstoqueLossDimension({
            cd: activeCd,
            monthStart: selectedMonthStart,
            dimension: "categoria_n2",
            movementFilter,
            limit: INSIGHT_ROWS_LIMIT
          })
        ]);
        if (cancelled) return;
        setReentryRows(nextReentries);
        setSupplierLossRows(nextSupplierLoss);
        setCategoryLossRows(nextCategoryLoss);
      } catch (error) {
        if (!cancelled) {
          setReentryRows([]);
          setSupplierLossRows([]);
          setCategoryLossRows([]);
        }
      } finally {
        if (!cancelled) setLoadingInsights(false);
      }
    }

    void loadInsights();
    return () => {
      cancelled = true;
    };
  }, [activeCd, movementFilter, selectedMonthStart]);

  useEffect(() => {
    if (!selectedMonthStart || !showDetails) {
      setDetailRows([]);
      return;
    }

    let cancelled = false;

    async function loadDetails() {
      setLoadingDetails(true);
      try {
        const rows = await fetchIndicadoresGestaoEstoqueDetails(
          activeCd,
          selectedMonthStart,
          selectedDay === ALL_DAYS_VALUE ? null : selectedDay,
          movementFilter,
          DETAIL_ROWS_LIMIT
        );
        if (!cancelled) setDetailRows(rows);
      } catch (error) {
        if (!cancelled) {
          setDetailRows([]);
        }
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    }

    void loadDetails();
    return () => {
      cancelled = true;
    };
  }, [activeCd, movementFilter, selectedDay, selectedMonthStart, showDetails]);

  useEffect(() => {
    if (selectedDay !== ALL_DAYS_VALUE) {
      setShowDetails(true);
    }
  }, [selectedDay]);

  useEffect(() => {
    setShowDetails(false);
  }, [selectedMonthStart, movementFilter]);

  const selectedMonthLabel = useMemo(
    () => monthOptions.find((option) => option.month_start === selectedMonthStart)?.month_label ?? "-",
    [monthOptions, selectedMonthStart]
  );

  const dayOptions = useMemo(() => {
    if (!summary) return [];
    return buildCalendarDays(summary.month_start, summary.month_end);
  }, [summary]);

  useEffect(() => {
    if (selectedDay === ALL_DAYS_VALUE) return;
    if (dayOptions.includes(selectedDay)) return;
    setSelectedDay(ALL_DAYS_VALUE);
  }, [dayOptions, selectedDay]);

  const metricCards = useMemo<MetricCardDefinition[]>(() => {
    if (!summary) return [];
    return [
      { label: "Entradas no Mês", value: summary.total_entradas_mes, kind: "currency", accent: "entry" },
      { label: "Saídas no Mês", value: summary.total_saidas_mes, kind: "currency", accent: "exit" },
      {
        label: "Perda no Mês Atual",
        value: summary.perda_mes_atual,
        kind: "signed-currency",
        accent: "danger",
        natureBadge: lossNatureBadge(summary.perda_mes_atual)
      },
      {
        label: "Perda Acum. Ano",
        value: summary.perda_acumulada_ano,
        kind: "signed-currency",
        accent: "danger",
        natureBadge: lossNatureBadge(summary.perda_acumulada_ano)
      },
      { label: "Acumulado Entradas Ano", value: summary.acumulado_entradas_ano, kind: "currency", accent: "neutral" },
      { label: "Acumulado Saídas Ano", value: summary.acumulado_saidas_ano, kind: "currency", accent: "warning" },
      { label: "Produtos Distintos", value: summary.produtos_distintos_mes, kind: "integer" }
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
          <span className="module-title">Indicadores · Gestão de Estoque</span>
        </div>
      </header>

      <section className="modules-shell indicadores-shell">
        <article className="module-screen surface-enter indicadores-screen indicadores-screen-blitz gestao-estq-screen">
          <div className="module-screen-header">
            <div className="module-screen-title-row">
              <div className="module-screen-title indicadores-title-stack">
                <img className="indicadores-screen-logo" src={pmImage} alt="PM" />
                <div>
                  <h2>Dashboard Gestão de Estoque</h2>
                  <span className="module-status">
                    {displayCdName} · mês {selectedMonthLabel} · filtro {formatMovementLabel(movementFilter)} · atualizado em {formatDateTime(summary?.updated_at ?? null)}
                  </span>
                </div>
              </div>
              <div className="indicadores-filters">
                <label>
                  <span>Mês/Ano</span>
                  <select value={selectedMonthStart} onChange={(event) => setSelectedMonthStart(event.target.value)} disabled={loadingMonths || monthOptions.length === 0}>
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
                  <select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)} disabled={!summary || dayOptions.length === 0}>
                    {dayOptions.length === 0 ? <option value="">Sem datas</option> : null}
                    {dayOptions.length > 0 ? <option value={ALL_DAYS_VALUE}>Todos</option> : null}
                    {dayOptions.map((day) => (
                      <option key={day} value={day}>
                        {formatDate(day)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Movimentação</span>
                  <select value={movementFilter} onChange={(event) => setMovementFilter(event.target.value as IndicadoresGestaoEstoqueMovementFilter)}>
                    <option value="todas">Todas</option>
                    <option value="entrada">Entrada</option>
                    <option value="saida">Saída</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          {dashboardErrorMessage ? <div className="indicadores-feedback is-error">{dashboardErrorMessage}</div> : null}

          <div className="indicadores-metrics-grid gestao-estq-metrics-grid">
            {metricCards.map((card) => (
              <article
                key={card.label}
                className={`indicadores-metric-card ${card.accent ? `accent-${card.accent}` : ""} ${card.natureBadge ? "gestao-estq-metric-card-has-badge" : ""}`}
              >
                {card.natureBadge ? (
                  <span className={`indicadores-status-badge gestao-estq-metric-badge ${natureClassName(card.natureBadge)}`}>
                    {card.natureBadge === "falta" ? "Falta" : "Sobra"}
                  </span>
                ) : null}
                <span>{card.label}</span>
                {card.kind === "integer" ? <strong>{formatInteger(card.value)}</strong> : null}
                {card.kind === "currency" ? <CurrencyMetricValue value={card.value} /> : null}
                {card.kind === "signed-currency" ? <CurrencyMetricValue value={card.value} signed /> : null}
              </article>
            ))}
          </div>

          <div className="gestao-estq-layout-grid">
            <section className="indicadores-panel gestao-estq-panel gestao-estq-panel-chart">
              <div className="indicadores-panel-head">
                <h3>Ritmo diário</h3>
                <span>{loadingDashboard ? "Atualizando..." : "Entradas, saídas e perda por dia do mês"}</span>
              </div>
              {loadingDashboard && !summary ? (
                <div className="indicadores-empty-box"><p>Carregando série diária...</p></div>
              ) : (
                <DailyChart rows={dailySeries} />
              )}
            </section>

            <section className="indicadores-panel gestao-estq-panel gestao-estq-panel-reentry">
              <div className="indicadores-panel-head">
                <h3>Saída seguida de entrada</h3>
                <span>Acumulado do ano do CD ativo.</span>
              </div>
              {loadingInsights && reentryRows.length === 0 ? (
                <div className="indicadores-empty-box"><p>Carregando insights do ano...</p></div>
              ) : reentryRows.length === 0 ? (
                <div className="indicadores-empty-box"><p>Nenhum produto com saída seguida de entrada encontrado no ano.</p></div>
              ) : (
                <div className="gestao-estq-reentry-list">
                  {reentryRows.map((row, index) => (
                    <article key={`${row.coddv}:${index}`} className="gestao-estq-reentry-item">
                      <div className="gestao-estq-reentry-main">
                        <strong>{row.descricao}</strong>
                        <small>CODDV {formatInteger(row.coddv)}</small>
                      </div>
                      <div className="gestao-estq-reentry-dates">
                        <span>Saída {formatDate(row.first_saida_date)}</span>
                        <span>Entrada {formatDate(row.first_entrada_after_saida_date)}</span>
                      </div>
                      <div className="gestao-estq-reentry-balance">
                        <strong>{formatSignedCurrency(row.saldo_ano)}</strong>
                        <small>{formatCurrency(row.total_saida_ano)} / {formatCurrency(row.total_entrada_ano)}</small>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <TopList
              title="Top 30 Entradas"
              subtitle={loadingTopLists ? "Atualizando ranking..." : selectedDay === ALL_DAYS_VALUE ? "Acumulado do mês no filtro ativo." : `Data ${formatDate(selectedDay)}`}
              rows={topEntradas}
              emptyMessage="Nenhuma entrada encontrada para o filtro selecionado."
              className="gestao-estq-panel-top"
            />

            <TopList
              title="Top 30 Saídas"
              subtitle={loadingTopLists ? "Atualizando ranking..." : selectedDay === ALL_DAYS_VALUE ? "Acumulado do mês no filtro ativo." : `Data ${formatDate(selectedDay)}`}
              rows={topSaidas}
              emptyMessage="Nenhuma saída encontrada para o filtro selecionado."
              className="gestao-estq-panel-top"
            />

            <LossDimensionList
              title="Maiores perdas por fornecedor"
              subtitle={loadingInsights ? "Atualizando perdas..." : "Perda do mês e acumulado do ano."}
              rows={supplierLossRows}
              emptyMessage="Nenhuma perda positiva por fornecedor encontrada no filtro selecionado."
            />

            <LossDimensionList
              title="Maiores perdas por categoria N2"
              subtitle={loadingInsights ? "Atualizando perdas..." : "Perda do mês e acumulado do ano."}
              rows={categoryLossRows}
              emptyMessage="Nenhuma perda positiva por categoria encontrada no filtro selecionado."
            />

            <section className="indicadores-panel gestao-estq-panel gestao-estq-panel-details">
              <div className="indicadores-panel-head">
                <h3>{selectedDay === ALL_DAYS_VALUE ? "Movimentações do mês" : "Movimentações do dia"}</h3>
                <span>
                  {selectedDay === ALL_DAYS_VALUE ? selectedMonthLabel : formatDate(selectedDay)}
                  {" · "}
                  {`até ${DETAIL_ROWS_LIMIT} linhas mais relevantes`}
                </span>
              </div>
              {!showDetails ? (
                <div className="indicadores-empty-box">
                  <p>O detalhamento completo fica sob demanda para reduzir processamento.</p>
                  <button type="button" className="gestao-estq-details-button" onClick={() => setShowDetails(true)}>
                    Mostrar detalhamento
                  </button>
                </div>
              ) : loadingDetails ? (
                <div className="indicadores-empty-box"><p>Carregando movimentações...</p></div>
              ) : detailRows.length === 0 ? (
                <div className="indicadores-empty-box"><p>Nenhuma movimentação encontrada para o filtro selecionado.</p></div>
              ) : (
                <div className="gestao-estq-details-wrap">
                  <table className="gestao-estq-details-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Produto</th>
                        <th>Tipo</th>
                        <th>Mov.</th>
                        <th>Natureza</th>
                        <th>Ocorrências</th>
                        <th>Total (R$)</th>
                        <th>Responsável</th>
                        <th>Cargo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((row, index) => (
                        <tr key={`${row.data_mov}:${row.coddv}:${row.tipo_movimentacao}:${index}`}>
                          <td>{formatDate(row.data_mov)}</td>
                          <td>
                            <div className="gestao-estq-product-cell">
                              <strong>{row.descricao}</strong>
                              <small>CODDV {formatInteger(row.coddv)}</small>
                            </div>
                          </td>
                          <td>{row.tipo_movimentacao}</td>
                          <td className="gestao-estq-capitalize">{row.movement_group}</td>
                          <td>
                            <span className={`indicadores-status-badge ${natureClassName(row.natureza)}`}>{row.natureza}</span>
                          </td>
                          <td>{formatInteger(row.ocorrencias)}</td>
                          <td>{formatCurrency(row.valor_total)}</td>
                          <td>{row.responsavel}</td>
                          <td>{row.cargo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </article>
      </section>
    </>
  );
}
