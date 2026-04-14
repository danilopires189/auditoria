import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import pmImage from "../../../assets/pm.png";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { formatDateOnlyPtBR, formatDateTimeBrasilia, todayIsoBrasilia } from "../../shared/brasilia-datetime";
import { getModuleByKeyOrThrow } from "../registry";
import {
  fetchIndicadoresPvpsAlocDailySeries,
  fetchIndicadoresPvpsAlocDayDetails,
  fetchIndicadoresPvpsAlocMonthOptions,
  fetchIndicadoresPvpsAlocSummary,
  fetchIndicadoresPvpsAlocZoneTotals
} from "./sync";
import type {
  IndicadoresModuleProfile,
  IndicadoresPvpsAlocDailyRow,
  IndicadoresPvpsAlocDayDetailRow,
  IndicadoresPvpsAlocMonthOption,
  IndicadoresPvpsAlocStatus,
  IndicadoresPvpsAlocSummary,
  IndicadoresPvpsAlocTipo,
  IndicadoresPvpsAlocZoneTotalRow
} from "./types";

interface IndicadoresPvpsAlocacaoPageProps {
  isOnline: boolean;
  profile: IndicadoresModuleProfile;
}

interface MetricCardDefinition {
  key: string;
  label: string;
  value: string;
  accent?: "danger" | "warning" | "neutral";
}

interface AnimatedDayRevealProps {
  itemKey: string;
  className: string;
  children: ReactNode;
  rootRef?: RefObject<HTMLElement | null>;
}

const MODULE_DEF = getModuleByKeyOrThrow("indicadores");
const ZONA_COLLATOR = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const ALL_DAYS_VALUE = "__ALL_DAYS__";

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

function formatPlainInteger(value: number): string {
  const numeric = Number.isFinite(value) ? Math.trunc(value) : 0;
  return String(numeric);
}

function formatDecimal(value: number, digits = 2): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number, digits = 2): string {
  return `${formatDecimal(value, digits)}%`;
}

function formatAddress(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  return compact || "Sem endereço";
}

function formatTipoLabel(tipo: IndicadoresPvpsAlocTipo): string {
  if (tipo === "pvps") return "PVPS";
  if (tipo === "alocacao") return "Alocação";
  return "Ambos";
}

function eligibleAuditLabel(tipo: IndicadoresPvpsAlocTipo): string {
  void tipo;
  return "End. Auditado";
}

function formatModuloLabel(modulo: IndicadoresPvpsAlocDayDetailRow["modulo"]): string {
  return modulo === "pvps" ? "PVPS" : "Alocação";
}

function formatStatusLabel(status: Exclude<IndicadoresPvpsAlocStatus, "conforme">): string {
  if (status === "nao_conforme") return "Não conforme";
  if (status === "vazio") return "Vazio";
  return "Obstruído";
}

function statusClassName(status: Exclude<IndicadoresPvpsAlocStatus, "conforme">): string {
  if (status === "nao_conforme") return "is-falta";
  if (status === "vazio") return "is-sobra";
  return "is-fora";
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

function resolveInitialDay(
  summary: IndicadoresPvpsAlocSummary,
  dailyRows: IndicadoresPvpsAlocDailyRow[],
  previousDay: string | null
): string {
  const allDays = buildCalendarDays(summary.month_start, summary.month_end);
  const latestDayWithErrors = [...dailyRows]
    .filter((row) => row.erros_total > 0)
    .sort((left, right) => right.date_ref.localeCompare(left.date_ref))[0]?.date_ref;
  const latestDayWithData = [...dailyRows]
    .sort((left, right) => right.date_ref.localeCompare(left.date_ref))[0]?.date_ref;

  if (previousDay === ALL_DAYS_VALUE) return ALL_DAYS_VALUE;
  if (previousDay && allDays.includes(previousDay)) return previousDay;
  if (latestDayWithErrors && allDays.includes(latestDayWithErrors)) return latestDayWithErrors;
  if (latestDayWithData && allDays.includes(latestDayWithData)) return latestDayWithData;
  if (summary.available_day_end && allDays.includes(summary.available_day_end)) return summary.available_day_end;
  return allDays[0] ?? "";
}

function AnimatedDayReveal({ itemKey, className, children, rootRef }: AnimatedDayRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (visible) return;
    if (typeof window === "undefined" || typeof window.IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {
        root: rootRef?.current ?? null,
        threshold: 0.01,
        rootMargin: "0px 0px 18% 0px"
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [itemKey, rootRef, visible]);

  return (
    <div
      ref={ref}
      className={`${className} indicadores-scroll-reveal${visible ? " is-visible" : ""}`}
    >
      {children}
    </div>
  );
}

function DailyChart({ rows, isDesktop }: { rows: IndicadoresPvpsAlocDailyRow[]; isDesktop: boolean }) {
  const safeRows = Math.max(rows.length, 1);
  const horizontalPadding = 36;
  const slotWidth = 92;
  const chartWidth = Math.max(340, horizontalPadding * 2 + safeRows * slotWidth);
  const chartHeight = isDesktop ? 452 : 392;
  const plotTop = isDesktop ? 118 : 36;
  const plotBottom = isDesktop ? 332 : 292;
  const plotHeight = plotBottom - plotTop;
  const availablePlotWidth = Math.max(chartWidth - horizontalPadding * 2, safeRows * slotWidth);
  const stepX = safeRows > 1 ? availablePlotWidth / (safeRows - 1) : availablePlotWidth;
  const barWidth = Math.min(30, Math.max(20, stepX * 0.52));
  const maxAudited = Math.max(1, ...rows.map((row) => row.enderecos_auditados));
  const maxPercent = Math.max(1, ...rows.map((row) => row.percentual_conformidade));

  const linePoints = rows
    .map((row, index) => {
      const x = horizontalPadding + index * stepX;
      const y = plotTop + (1 - row.percentual_conformidade / maxPercent) * plotHeight;
      return `${x},${Number.isFinite(y) ? y : plotBottom}`;
    })
    .join(" ");

  return (
    <div className="indicadores-chart-shell indicadores-chart-shell-pvps-aloc">
      <div className="indicadores-chart-scroll indicadores-chart-scroll-pvps-aloc">
        <svg
          className="indicadores-chart-svg indicadores-chart-svg-pvps-aloc"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label="Conformidade diária do mês PVPS e Alocação"
          style={{ width: `${chartWidth}px`, minWidth: `${chartWidth}px` }}
        >
          <line x1="18" y1={plotBottom} x2={chartWidth - 16} y2={plotBottom} className="indicadores-chart-axis" />
          <line x1="18" y1={plotTop} x2="18" y2={plotBottom} className="indicadores-chart-axis" />
          {rows.map((row, index) => {
            const centerX = horizontalPadding + index * stepX;
            const x = centerX - barWidth / 2;
            const barHeight = (row.enderecos_auditados / maxAudited) * plotHeight;
            const y = plotBottom - barHeight;
            return (
              <g key={row.date_ref}>
                <rect x={x} y={y} width={barWidth} height={barHeight} rx="5" className="indicadores-chart-bar" />
                <text x={centerX} y={isDesktop ? 372 : 326} textAnchor="middle" className="indicadores-chart-label">
                  {row.date_ref.slice(8, 10)}
                </text>
                {row.enderecos_auditados > 0 ? (
                  <text x={centerX} y={Math.max(y - 12, isDesktop ? 74 : 22)} textAnchor="middle" className="indicadores-chart-value">
                    {formatInteger(row.enderecos_auditados)}
                  </text>
                ) : null}
              </g>
            );
          })}
          {rows.length > 1 ? <polyline points={linePoints} className="indicadores-chart-line" /> : null}
          {rows.map((row, index) => {
            const cx = horizontalPadding + index * stepX;
            const cy = plotTop + (1 - row.percentual_conformidade / maxPercent) * plotHeight;
            const safeCy = Number.isFinite(cy) ? cy : plotBottom;
            const percentLabelY = isDesktop
              ? Math.max(safeCy - 14, 48)
              : Math.max(safeCy - 14, 20);
            return (
              <g key={`${row.date_ref}:point`}>
                <circle cx={cx} cy={safeCy} r="6" className="indicadores-chart-point" />
                {row.percentual_conformidade > 0 ? (
                  <text x={cx} y={percentLabelY} textAnchor="middle" className="indicadores-chart-percent">
                    {formatPercent(row.percentual_conformidade)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="indicadores-chart-legend">
        <span><i className="is-conferido" /> Endereços auditados</span>
        <span><i className="is-percentual" /> % conformidade</span>
      </div>
    </div>
  );
}

function ZoneChart({ rows }: { rows: IndicadoresPvpsAlocZoneTotalRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="indicadores-empty-box">
        <p>Nenhuma zona com erro no mês selecionado.</p>
      </div>
    );
  }

  const maxTotal = Math.max(1, ...rows.map((row) => row.erro_total));

  return (
    <div className="indicadores-zone-chart">
      <div className="indicadores-zone-scroll">
        {rows.map((row) => {
          const naoConformeHeight = (row.nao_conforme_total / maxTotal) * 180;
          const vazioHeight = (row.vazio_total / maxTotal) * 180;
          const obstruidoHeight = (row.obstruido_total / maxTotal) * 180;
          return (
            <div key={row.zona} className="indicadores-zone-column">
              <div className="indicadores-zone-stack" title={`${row.zona}: ${formatInteger(row.erro_total)} erros`}>
                <div className="indicadores-zone-segment is-fora" style={{ height: `${obstruidoHeight}px` }} />
                <div className="indicadores-zone-segment is-sobra" style={{ height: `${vazioHeight}px` }} />
                <div className="indicadores-zone-segment is-falta" style={{ height: `${naoConformeHeight}px` }} />
              </div>
              <strong>{row.zona}</strong>
              <span>{formatInteger(row.erro_total)}</span>
            </div>
          );
        })}
      </div>
      <div className="indicadores-chart-legend">
        <span><i className="is-falta" /> Não conforme</span>
      </div>
    </div>
  );
}

export default function IndicadoresPvpsAlocacaoPage({ isOnline, profile }: IndicadoresPvpsAlocacaoPageProps) {
  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const displayCdName = useMemo(() => resolveCdDisplayName(profile, activeCd), [activeCd, profile]);
  const dayListBodyRef = useRef<HTMLDivElement | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth >= 960;
  });

  const [selectedType, setSelectedType] = useState<IndicadoresPvpsAlocTipo>("ambos");
  const [monthOptions, setMonthOptions] = useState<IndicadoresPvpsAlocMonthOption[]>([]);
  const [selectedMonthStart, setSelectedMonthStart] = useState<string>("");
  const [selectedDay, setSelectedDay] = useState<string>("");

  const [summary, setSummary] = useState<IndicadoresPvpsAlocSummary | null>(null);
  const [dailySeries, setDailySeries] = useState<IndicadoresPvpsAlocDailyRow[]>([]);
  const [zoneTotals, setZoneTotals] = useState<IndicadoresPvpsAlocZoneTotalRow[]>([]);
  const [dayDetails, setDayDetails] = useState<IndicadoresPvpsAlocDayDetailRow[]>([]);

  const [loadingMonths, setLoadingMonths] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const onResize = () => setIsDesktop(window.innerWidth >= 960);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMonths() {
      setLoadingMonths(true);
      setErrorMessage(null);
      try {
        const nextMonths = await fetchIndicadoresPvpsAlocMonthOptions(activeCd, selectedType);
        if (cancelled) return;
        setMonthOptions(nextMonths);
        setSelectedMonthStart((current) => (
          current && nextMonths.some((option) => option.month_start === current)
            ? current
            : (nextMonths[0]?.month_start ?? "")
        ));
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(asErrorMessage(error));
          setMonthOptions([]);
          setSelectedMonthStart("");
        }
      } finally {
        if (!cancelled) setLoadingMonths(false);
      }
    }

    void loadMonths();
    return () => {
      cancelled = true;
    };
  }, [activeCd, selectedType]);

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
          fetchIndicadoresPvpsAlocSummary(activeCd, selectedMonthStart, selectedType),
          fetchIndicadoresPvpsAlocDailySeries(activeCd, selectedMonthStart, selectedType),
          fetchIndicadoresPvpsAlocZoneTotals(activeCd, selectedMonthStart, selectedType)
        ]);
        if (cancelled) return;
        setSummary(nextSummary);
        setDailySeries(nextDaily);
        setZoneTotals(nextZones);
        setSelectedDay((current) => resolveInitialDay(nextSummary, nextDaily, current || null));
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
  }, [activeCd, selectedMonthStart, selectedType]);

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
        const rows = await fetchIndicadoresPvpsAlocDayDetails(
          activeCd,
          selectedMonthStart,
          selectedType,
          selectedDay === ALL_DAYS_VALUE ? null : selectedDay
        );
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
  }, [activeCd, selectedMonthStart, selectedType, selectedDay]);

  const selectedMonthLabel = useMemo(
    () => monthOptions.find((option) => option.month_start === selectedMonthStart)?.month_label ?? "-",
    [monthOptions, selectedMonthStart]
  );

  const dayOptions = useMemo(() => {
    if (!summary) return [];
    return buildCalendarDays(summary.month_start, summary.month_end);
  }, [summary]);

  const selectedDaySeries = useMemo(
    () => (selectedDay === ALL_DAYS_VALUE ? null : dailySeries.find((row) => row.date_ref === selectedDay) ?? null),
    [dailySeries, selectedDay]
  );

  const showingMonthDetails = selectedDay === ALL_DAYS_VALUE;

  const sortedDayDetails = useMemo(() => {
    const rows = dayDetails.filter((row) => row.status_dashboard === "nao_conforme");
    rows.sort((left, right) => {
      const zoneCmp = ZONA_COLLATOR.compare(left.zona, right.zona);
      if (zoneCmp !== 0) return zoneCmp;
      const dateCmp = right.date_ref.localeCompare(left.date_ref);
      if (dateCmp !== 0) return dateCmp;
      if (left.modulo !== right.modulo) return left.modulo.localeCompare(right.modulo);
      const descCmp = ZONA_COLLATOR.compare(left.descricao, right.descricao);
      if (descCmp !== 0) return descCmp;
      return left.coddv - right.coddv;
    });
    return rows;
  }, [dayDetails]);

  const visibleZoneTotals = useMemo(
    () => zoneTotals
      .map((row) => ({
        ...row,
        vazio_total: 0,
        obstruido_total: 0,
        erro_total: row.nao_conforme_total
      }))
      .sort((left, right) => {
        if (right.erro_total !== left.erro_total) return right.erro_total - left.erro_total;
        return ZONA_COLLATOR.compare(left.zona, right.zona);
      })
      .filter((row) => row.erro_total > 0),
    [zoneTotals]
  );

  const metricCards = useMemo<MetricCardDefinition[]>(() => {
    if (!summary) return [];
    const selectedDayErrors = formatInteger(selectedDaySeries?.nao_conformes ?? 0);

    const cards: MetricCardDefinition[] = [
      { key: "percentual-conformidade", label: "% Conformidade", value: formatPercent(summary.percentual_conformidade, 2) },
      { key: "enderecos-conforme", label: "End. Conforme", value: formatInteger(summary.conformes_elegiveis) },
      { key: "enderecos-auditado", label: eligibleAuditLabel(selectedType), value: formatInteger(summary.enderecos_auditados) },
      { key: "percentual-nao-conforme", label: "% Não Conforme", value: formatPercent(summary.percentual_erro, 2), accent: "danger" },
      { key: "enderecos-nao-conforme", label: "End. Não Conforme", value: formatInteger(summary.nao_conformes), accent: "danger" },
      { key: "media-sku-dia", label: "Média Sku Dia", value: formatInteger(summary.media_sku_dia) }
    ];

    if (!showingMonthDetails) {
      cards.push({ key: "erros-dia", label: "Erros do dia", value: selectedDayErrors, accent: "danger" });
    }

    return cards;
  }, [selectedDaySeries, selectedType, showingMonthDetails, summary]);

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
          <span className="module-title">Indicadores · PVPS e Alocação</span>
        </div>
      </header>

      <section className="modules-shell indicadores-shell">
        <article className="module-screen surface-enter indicadores-screen indicadores-screen-blitz">
          <div className="module-screen-header">
            <div className="module-screen-title-row">
              <div className="module-screen-title indicadores-title-stack">
                <img className="indicadores-screen-logo" src={pmImage} alt="PM" />
                <div>
                  <h2>Dashboard PVPS e Alocação</h2>
                  <span className="module-status">
                    {displayCdName} · {formatTipoLabel(selectedType)} · mês {selectedMonthLabel} · atualizado em {formatDateTime(summary?.updated_at ?? null)}
                  </span>
                </div>
              </div>
              <div className="indicadores-filters">
                <label>
                  <span>Mês/Ano</span>
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
                    {dayOptions.length > 0 ? <option value={ALL_DAYS_VALUE}>Todos</option> : null}
                    {dayOptions.map((day) => (
                      <option key={day} value={day}>
                        {formatDate(day)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Tipo</span>
                  <select value={selectedType} onChange={(event) => setSelectedType(event.target.value as IndicadoresPvpsAlocTipo)}>
                    <option value="ambos">Ambos</option>
                    <option value="pvps">PVPS</option>
                    <option value="alocacao">Alocação</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          {errorMessage ? <div className="indicadores-feedback is-error">{errorMessage}</div> : null}

          <div className="indicadores-metrics-grid indicadores-metrics-grid-pvps-aloc">
            {metricCards.map((card) => (
              <article key={card.key} className={`indicadores-metric-card indicadores-metric-card-${card.key} ${card.accent ? `accent-${card.accent}` : ""}`}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </article>
            ))}
          </div>

          <div className="indicadores-layout-grid indicadores-layout-grid-pvps-aloc">
            <section className="indicadores-panel indicadores-panel-wide indicadores-panel-conferencia indicadores-panel-conferencia-pvps-aloc">
              <div className="indicadores-panel-head">
                <h3>Conformidade do mês</h3>
                <span>{loadingDashboard ? "Atualizando..." : `Barras de ${eligibleAuditLabel(selectedType).toLocaleLowerCase("pt-BR")} e linha de conformidade`}</span>
              </div>
              {loadingDashboard && !summary ? (
                <div className="indicadores-empty-box"><p>Carregando dados do mês...</p></div>
              ) : (
                <DailyChart rows={dailySeries} isDesktop={isDesktop} />
              )}
            </section>

            <section className="indicadores-panel indicadores-panel-side indicadores-panel-divergencias indicadores-panel-divergencias-pvps-aloc">
              <div className="indicadores-panel-head">
                <h3>{showingMonthDetails ? "Divergentes do mês" : "Divergentes do dia"}</h3>
                <span>{showingMonthDetails ? selectedMonthLabel : selectedDay ? formatDate(selectedDay) : "-"}</span>
              </div>
              <div className="indicadores-day-list">
                <div className="indicadores-day-list-head">
                  <span>Descrição</span>
                  <span>Endereço</span>
                  <span>Status</span>
                  <span>Tipo</span>
                  <span>Divergência</span>
                </div>
                <div ref={dayListBodyRef} className="indicadores-day-list-body">
                  {loadingDetails ? (
                    <div className="indicadores-empty-box"><p>{showingMonthDetails ? "Carregando divergentes do mês..." : "Carregando divergentes do dia..."}</p></div>
                  ) : sortedDayDetails.length === 0 ? (
                    <div className="indicadores-empty-box"><p>{showingMonthDetails ? "Nenhum divergente encontrado para o mês selecionado." : "Nenhum divergente encontrado para a data selecionada."}</p></div>
                  ) : (
                    (() => {
                      const items: ReactNode[] = [];
                      let lastZone = "";
                      let revealStep = 0;

                      sortedDayDetails.forEach((row, index) => {
                        const normalizedZone = row.zona.trim().toUpperCase() || "SEM ZONA";
                        if (normalizedZone !== lastZone) {
                          revealStep += 1;
                          const zoneKey = `zone-divider:${normalizedZone}:${index}`;
                          items.push(
                            <AnimatedDayReveal
                              key={zoneKey}
                              itemKey={zoneKey}
                              rootRef={dayListBodyRef}
                              className="indicadores-zone-divider-row"
                            >
                              <span className="indicadores-zone-divider">{normalizedZone}</span>
                            </AnimatedDayReveal>
                          );
                          lastZone = normalizedZone;
                        }

                        revealStep += 1;
                        const rowKey = `${row.date_ref}:${row.modulo}:${row.coddv}:${row.status_dashboard}:${index}`;
                        items.push(
                          <AnimatedDayReveal
                            key={rowKey}
                            itemKey={`${rowKey}:${revealStep}`}
                            rootRef={dayListBodyRef}
                            className="indicadores-day-row"
                          >
                            <span className="indicadores-day-description">
                              <span className="indicadores-day-description-head">
                                <strong>{row.descricao}</strong>
                              </span>
                              <span className="indicadores-day-description-meta">
                                <small>COD {formatPlainInteger(row.coddv)}</small>
                                <small className="indicadores-day-date">{formatDate(row.date_ref)}</small>
                              </span>
                            </span>
                            <span className="indicadores-day-address" title={formatAddress(row.endereco)}>
                              {formatAddress(row.endereco)}
                            </span>
                            <span>
                              <i className={`indicadores-status-badge ${statusClassName(row.status_dashboard)}`}>{formatStatusLabel(row.status_dashboard)}</i>
                            </span>
                            <span className="indicadores-day-field">
                              <strong className="indicadores-day-inline-label">Tipo:</strong>
                              <span>{formatModuloLabel(row.modulo)}</span>
                            </span>
                            <span className="indicadores-day-field">
                              <strong className="indicadores-day-inline-label">Divergência:</strong>
                              <span>{formatInteger(row.quantidade)}</span>
                            </span>
                          </AnimatedDayReveal>
                        );
                      });

                      return items;
                    })()
                  )}
                </div>
              </div>
            </section>

            <section className="indicadores-panel indicadores-panel-wide indicadores-panel-zonas">
              <div className="indicadores-panel-head">
                <h3>Erro por zona</h3>
                <span>Exibe somente não conformes por zona.</span>
              </div>
              {loadingDashboard && visibleZoneTotals.length === 0 ? (
                <div className="indicadores-empty-box"><p>Carregando zonas...</p></div>
              ) : (
                <ZoneChart rows={visibleZoneTotals} />
              )}
            </section>
          </div>
        </article>
      </section>
    </>
  );
}
