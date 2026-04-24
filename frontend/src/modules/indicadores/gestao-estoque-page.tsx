import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import pmImage from "../../../assets/pm.png";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { formatDateOnlyPtBR, formatDateTimeBrasilia, todayIsoBrasilia } from "../../shared/brasilia-datetime";
import { getModuleByKeyOrThrow } from "../registry";
import type { IndicadoresModuleProfile } from "./types";
import {
  applyIndicadoresGestaoEstoqueInventarioSeed,
  fetchIndicadoresGestaoEstoqueDailySeries,
  fetchIndicadoresGestaoEstoqueDetails,
  fetchIndicadoresGestaoEstoqueLossDimension,
  fetchIndicadoresGestaoEstoqueMonthOptions,
  previewIndicadoresGestaoEstoqueInventarioSeed,
  fetchIndicadoresGestaoEstoqueReportBase,
  fetchIndicadoresGestaoEstoqueReportDailySeries,
  fetchIndicadoresGestaoEstoqueReportDetails,
  fetchIndicadoresGestaoEstoqueReportLossDimension,
  fetchIndicadoresGestaoEstoqueReportReentryItems,
  fetchIndicadoresGestaoEstoqueReportSummary,
  fetchIndicadoresGestaoEstoqueReportZoneValues,
  fetchIndicadoresGestaoEstoqueReportTopItems,
  fetchIndicadoresGestaoEstoqueSummary,
  fetchIndicadoresGestaoEstoqueTopItems,
  fetchIndicadoresGestaoEstoqueZoneProducts,
  fetchIndicadoresGestaoEstoqueZoneValues,
  fetchIndicadoresGestaoEstoqueYearReentryItems
} from "./gestao-estoque-sync";
import type {
  IndicadoresGestaoEstoqueDailyRow,
  IndicadoresGestaoEstoqueDetailRow,
  IndicadoresGestaoEstoqueInventarioApplySummary,
  IndicadoresGestaoEstoqueInventarioPreviewSummary,
  IndicadoresGestaoEstoqueInventarioStockType,
  IndicadoresGestaoEstoqueLossDimensionItem,
  IndicadoresGestaoEstoqueMonthOption,
  IndicadoresGestaoEstoqueMovementFilter,
  IndicadoresGestaoEstoqueReentryItem,
  IndicadoresGestaoEstoqueSummary,
  IndicadoresGestaoEstoqueTopItem,
  IndicadoresGestaoEstoqueZoneProductRow,
  IndicadoresGestaoEstoqueZoneValueRow
} from "./gestao-estoque-types";

interface IndicadoresGestaoEstoquePageProps {
  isOnline: boolean;
  profile: IndicadoresModuleProfile;
}

interface MetricCardDefinition {
  label: string;
  value: number;
  kind: "currency" | "signed-currency" | "integer";
  accent?: "danger" | "warning" | "neutral" | "entry" | "exit" | "loss";
  natureBadge?: "falta" | "sobra" | null;
  valueTone?: "default" | "entry" | "exit";
}

type MobileAccordionSection = "zoneValues" | "reentry" | "topEntradas" | "topSaidas" | "supplierLoss" | "categoryLoss" | "details";
type InventarioStockTypeValue = IndicadoresGestaoEstoqueInventarioStockType | "";
type FullscreenPanel = "daily" | "zoneValues" | null;

interface MobileAccordionControl {
  enabled: boolean;
  expanded: boolean;
  bodyId: string;
  onToggle: () => void;
}

interface AnimatedRevealProps {
  revealKey: string;
  children: ReactNode;
  className?: string;
  delayMs?: number;
}

interface AnimatedMetricCardProps {
  card: MetricCardDefinition;
  animationKey: string;
  delayMs?: number;
  prefersReducedMotion: boolean;
}

interface AnimatedDetailRowProps {
  row: IndicadoresGestaoEstoqueDetailRow;
  rowKey: string;
  delayMs?: number;
}

const MODULE_DEF = getModuleByKeyOrThrow("indicadores");
const ALL_DAYS_VALUE = "__ALL_DAYS__";
const DETAIL_ROWS_LIMIT = 100;
const INSIGHT_ROWS_LIMIT = 10;
const REENTRY_ROWS_LIMIT = 12;
const MOBILE_ACCORDION_MEDIA_QUERY = "(max-width: 720px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const METRIC_ANIMATION_DURATION_MS = 1400;
const INVENTARIO_SEED_ALLOWED_HOSTNAMES = new Set([
  "prevencaocd.vercel.app",
  "www.prevencaocd.vercel.app",
  "prevencaocds.vercel.app",
  "www.prevencaocds.vercel.app"
]);

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
  return Number.isFinite(value) ? String(Math.trunc(value)) : "0";
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

function formatCompactValue(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    minimumFractionDigits: Math.abs(safe) >= 1000 ? 1 : 0,
    maximumFractionDigits: 1
  }).format(Math.abs(safe));
}

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function animatedNumberValue(target: number, easedProgress: number): number {
  if (!Number.isFinite(target) || Math.abs(target) < 0.000001) return target;
  return target * easedProgress;
}

function animatedIntegerValue(target: number, easedProgress: number): number {
  if (!Number.isFinite(target) || Math.abs(target) < 1) return target;
  return Math.trunc(animatedNumberValue(target, easedProgress));
}

function revealStyle(delayMs: number): CSSProperties {
  return { ["--indicadores-reveal-delay" as string]: `${delayMs}ms` };
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

function formatInventoryStockTypeLabel(value: IndicadoresGestaoEstoqueInventarioStockType): string {
  return value === "atual" ? "Atual" : "Disponível";
}

function isInventarioSeedAllowedHostname(hostname: string | undefined): boolean {
  if (!hostname) return false;
  return INVENTARIO_SEED_ALLOWED_HOSTNAMES.has(hostname.trim().toLowerCase());
}

function defaultReportStartDate(
  summary: IndicadoresGestaoEstoqueSummary | null,
  selectedMonthStart: string,
  selectedDay: string
): string {
  if (selectedDay !== ALL_DAYS_VALUE && selectedDay) return selectedDay;
  return summary?.available_day_start ?? summary?.month_start ?? selectedMonthStart;
}

function defaultReportEndDate(
  summary: IndicadoresGestaoEstoqueSummary | null,
  selectedMonthStart: string,
  selectedDay: string
): string {
  if (selectedDay !== ALL_DAYS_VALUE && selectedDay) return selectedDay;
  return summary?.available_day_end ?? summary?.month_end ?? selectedMonthStart;
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

function AnimatedReveal({ revealKey, children, className = "", delayMs = 0 }: AnimatedRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
  }, [revealKey]);

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
        threshold: 0.01,
        rootMargin: "0px 0px 18% 0px"
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [revealKey, visible]);

  return (
    <div
      ref={ref}
      className={`${className} indicadores-scroll-reveal${visible ? " is-visible" : ""}`.trim()}
      style={revealStyle(delayMs)}
    >
      {children}
    </div>
  );
}

function AnimatedMetricCard({ card, animationKey, delayMs = 0, prefersReducedMotion }: AnimatedMetricCardProps) {
  const animationFrameRef = useRef<number | null>(null);
  const animationDelayRef = useRef<number | null>(null);
  const [displayedValue, setDisplayedValue] = useState(() => (prefersReducedMotion ? card.value : 0));

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (animationDelayRef.current !== null) {
        window.clearTimeout(animationDelayRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (animationDelayRef.current !== null) {
      window.clearTimeout(animationDelayRef.current);
      animationDelayRef.current = null;
    }

    if (prefersReducedMotion || !Number.isFinite(card.value) || Math.abs(card.value) < 0.000001) {
      setDisplayedValue(card.value);
      return;
    }

    setDisplayedValue(0);

    const startAnimation = () => {
      animationDelayRef.current = null;
      const startedAt = performance.now();

      const tick = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / METRIC_ANIMATION_DURATION_MS);
        const easedProgress = easeOutCubic(progress);
        const nextValue =
          card.kind === "integer"
            ? animatedIntegerValue(card.value, easedProgress)
            : animatedNumberValue(card.value, easedProgress);

        setDisplayedValue(nextValue);

        if (progress < 1) {
          animationFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }

        animationFrameRef.current = null;
        setDisplayedValue(card.value);
      };

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationDelayRef.current = window.setTimeout(startAnimation, delayMs);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (animationDelayRef.current !== null) {
        window.clearTimeout(animationDelayRef.current);
        animationDelayRef.current = null;
      }
    };
  }, [animationKey, card.kind, card.value, delayMs, prefersReducedMotion]);

  return (
    <article
      className={`indicadores-metric-card ${card.accent ? `accent-${card.accent}` : ""} ${card.valueTone ? `gestao-estq-metric-tone-${card.valueTone}` : ""} ${card.natureBadge ? "gestao-estq-metric-card-has-badge" : ""}`}
    >
      {card.natureBadge ? (
        <span className={`indicadores-status-badge gestao-estq-metric-badge ${natureClassName(card.natureBadge)}`}>
          {card.natureBadge === "falta" ? "Falta" : "Sobra"}
        </span>
      ) : null}
      <span>{card.label}</span>
      {card.kind === "integer" ? <strong>{formatInteger(displayedValue)}</strong> : null}
      {card.kind === "currency" ? <CurrencyMetricValue value={displayedValue} /> : null}
      {card.kind === "signed-currency" ? <CurrencyMetricValue value={displayedValue} signed /> : null}
    </article>
  );
}

function AnimatedDetailRow({ row, rowKey, delayMs = 0 }: AnimatedDetailRowProps) {
  const ref = useRef<HTMLTableRowElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
  }, [rowKey]);

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
        threshold: 0.01,
        rootMargin: "0px 0px 16% 0px"
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [rowKey, visible]);

  return (
    <tr
      ref={ref}
      className={`indicadores-table-reveal${visible ? " is-visible" : ""}`}
      style={revealStyle(delayMs)}
    >
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
      <td>{formatInteger(row.quantidade)}</td>
      <td>{formatCurrency(row.valor_total)}</td>
      <td>{row.responsavel}</td>
      <td>{row.cargo}</td>
    </tr>
  );
}

function inventorySendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M10 14 20 4" />
      <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
      <path d="M9 12h5v5" />
    </svg>
  );
}

function expandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4H4v4" />
      <path d="M4 4l6 6" />
      <path d="M16 4h4v4" />
      <path d="M20 4l-6 6" />
      <path d="M8 20H4v-4" />
      <path d="M4 20l6-6" />
      <path d="M16 20h4v-4" />
      <path d="M20 20l-6-6" />
    </svg>
  );
}

function closeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function PanelHead({
  title,
  subtitle,
  mobileAccordion,
  action
}: {
  title: string;
  subtitle: string;
  mobileAccordion?: MobileAccordionControl;
  action?: ReactNode;
}) {
  return (
    <div className={`indicadores-panel-head${mobileAccordion?.enabled ? " is-mobile-accordion" : ""}`}>
      <div className="indicadores-panel-head-copy">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </div>
      <div className="gestao-estq-panel-head-actions">
        {action}
        {mobileAccordion?.enabled ? (
          <button
            type="button"
            className="gestao-estq-mobile-toggle"
            aria-expanded={mobileAccordion.expanded}
            aria-controls={mobileAccordion.bodyId}
            onClick={mobileAccordion.onToggle}
          >
            {mobileAccordion.expanded ? "Recolher" : "Expandir"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DailyChart({ rows }: { rows: IndicadoresGestaoEstoqueDailyRow[] }) {
  const safeRows = Math.max(rows.length, 1);
  const horizontalPadding = 40;
  const slotWidth = 110;
  const entryBarWidth = 24;
  const exitBarWidth = 24;
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
        <svg
          className="indicadores-chart-svg"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          style={{ width: `${chartWidth}px`, minWidth: `${chartWidth}px` }}
          role="img"
          aria-label="Entradas, saídas e perda por dia do mês"
        >
          <line x1="16" y1={barsBottom} x2={chartWidth - 12} y2={barsBottom} className="indicadores-chart-axis" />
          <line x1="16" y1={lossMid} x2={chartWidth - 12} y2={lossMid} className="indicadores-chart-axis gestao-estq-chart-loss-axis" />
          {rows.map((row, index) => {
            const baseX = horizontalPadding + index * slotWidth;
            const entryHeight = (row.entrada_total / maxVolume) * barsHeight;
            const exitHeight = (row.saida_total / maxVolume) * barsHeight;
            const entryY = barsBottom - entryHeight;
            const exitY = barsBottom - exitHeight;
            const entryValueY = Math.max(entryY - 10, 18);
            const exitValueY = Math.max(exitY - 10, 18);
            const lossY = lossMid - (row.perda_total / maxLossAbs) * (lossHalf - 10);
            const lossValueY = row.perda_total >= 0 ? lossY - 10 : lossY + 16;
            return (
              <g key={row.date_ref}>
                <text
                  x={baseX - entryBarWidth / 2 - 7}
                  y={entryValueY}
                  textAnchor="middle"
                  className="gestao-estq-chart-bar-value gestao-estq-chart-entry-value"
                >
                  {formatCompactValue(row.entrada_total)}
                </text>
                <rect
                  x={baseX - entryBarWidth - 7}
                  y={entryY}
                  width={entryBarWidth}
                  height={entryHeight}
                  rx="6"
                  className="indicadores-chart-bar gestao-estq-chart-entry"
                >
                  <title>{`${formatDate(row.date_ref)} · Entradas ${formatCurrency(row.entrada_total)}`}</title>
                </rect>
                <text
                  x={baseX + exitBarWidth / 2 + 7}
                  y={exitValueY}
                  textAnchor="middle"
                  className="gestao-estq-chart-bar-value gestao-estq-chart-exit-value"
                >
                  {formatCompactValue(row.saida_total)}
                </text>
                <rect
                  x={baseX + 7}
                  y={exitY}
                  width={exitBarWidth}
                  height={exitHeight}
                  rx="6"
                  className="indicadores-chart-bar gestao-estq-chart-exit"
                >
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
  className,
  mobileAccordion,
  revealBaseKey = title
}: {
  title: string;
  subtitle: string;
  rows: IndicadoresGestaoEstoqueTopItem[];
  emptyMessage: string;
  className?: string;
  mobileAccordion?: MobileAccordionControl;
  revealBaseKey?: string;
}) {
  return (
    <section className={`indicadores-panel gestao-estq-panel ${className ?? ""}`}>
      <PanelHead title={title} subtitle={subtitle} mobileAccordion={mobileAccordion} />
      {!mobileAccordion?.enabled || mobileAccordion.expanded ? (
        <div id={mobileAccordion?.bodyId}>
          {rows.length === 0 ? (
            <div className="indicadores-empty-box"><p>{emptyMessage}</p></div>
          ) : (
            <div className="gestao-estq-top-list">
              {rows.map((row, index) => (
                <AnimatedReveal
                  key={`${row.movement_group}:${row.coddv}:${index}`}
                  revealKey={`${revealBaseKey}:${row.movement_group}:${row.coddv}:${index}`}
                  className="gestao-estq-list-reveal"
                  delayMs={Math.min(index, 8) * 35}
                >
                  <article className="gestao-estq-top-item">
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
                </AnimatedReveal>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function formatCompactCurrency(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `R$ ${new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    minimumFractionDigits: Math.abs(safe) >= 1000 ? 1 : 0,
    maximumFractionDigits: 1
  }).format(safe)}`;
}

function formatCompactSignedCurrency(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const signal = safe > 0 ? "+" : safe < 0 ? "-" : "";
  return `${signal}R$ ${new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    minimumFractionDigits: Math.abs(safe) >= 1000 ? 1 : 0,
    maximumFractionDigits: 1
  }).format(Math.abs(safe))}`;
}

function ZoneValueChart({
  rows,
  movementFilter,
  onZoneClick
}: {
  rows: IndicadoresGestaoEstoqueZoneValueRow[];
  movementFilter: IndicadoresGestaoEstoqueMovementFilter;
  onZoneClick?: (row: IndicadoresGestaoEstoqueZoneValueRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="indicadores-empty-box">
        <p>Nenhuma movimentação por zona encontrada para o filtro selecionado.</p>
      </div>
    );
  }

  const maxTotal = Math.max(1, ...rows.map((row) => row.valor_total));

  return (
    <div className="indicadores-zone-chart gestao-estq-zone-chart">
      <div className="indicadores-zone-scroll">
        {rows.map((row) => {
          const entradaHeight = (row.entrada_total / maxTotal) * 180;
          const saidaHeight = (row.saida_total / maxTotal) * 180;
          const balanceTotal = row.saida_total - row.entrada_total;
          const displayValue =
            movementFilter === "entrada"
              ? row.entrada_total
              : movementFilter === "saida"
                ? row.saida_total
                : balanceTotal;
          const displayValueClassName =
            movementFilter === "entrada"
              ? " is-entry"
              : movementFilter === "saida"
                ? " is-exit"
                : displayValue > 0
                  ? " is-positive"
                  : displayValue < 0
                    ? " is-negative"
                    : "";
          const valueTitle =
            movementFilter === "entrada"
              ? `${row.zona}: Entrada ${formatCurrency(row.entrada_total)}`
              : movementFilter === "saida"
                ? `${row.zona}: Saída ${formatCurrency(row.saida_total)}`
                : `${row.zona}: Entrada ${formatCurrency(row.entrada_total)} · Saída ${formatCurrency(row.saida_total)} · Saldo ${formatSignedCurrency(balanceTotal)}`;
          return (
            <button
              key={row.zona}
              type="button"
              className="indicadores-zone-column gestao-estq-zone-column gestao-estq-zone-button"
              onClick={() => onZoneClick?.(row)}
              title={`${valueTitle}. Clique para ver produtos.`}
              aria-label={`Ver produtos da zona ${row.zona}`}
            >
              <div className="indicadores-zone-stack" title={valueTitle}>
                {(movementFilter === "todas" || movementFilter === "saida") && saidaHeight > 0 ? (
                  <div className="indicadores-zone-segment gestao-estq-zone-segment is-exit" style={{ height: `${saidaHeight}px` }} />
                ) : null}
                {(movementFilter === "todas" || movementFilter === "entrada") && entradaHeight > 0 ? (
                  <div className="indicadores-zone-segment gestao-estq-zone-segment is-entry" style={{ height: `${entradaHeight}px` }} />
                ) : null}
              </div>
              <strong>{row.zona}</strong>
              <span className={`gestao-estq-zone-value${displayValueClassName}`}>
                {movementFilter === "todas" ? formatCompactSignedCurrency(displayValue) : formatCompactCurrency(displayValue)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="indicadores-chart-legend">
        {movementFilter !== "saida" ? <span><i className="gestao-estq-legend-entry" /> Entrada</span> : null}
        {movementFilter !== "entrada" ? <span><i className="gestao-estq-legend-exit" /> Saída</span> : null}
      </div>
    </div>
  );
}

function LossDimensionList({
  title,
  subtitle,
  rows,
  emptyMessage,
  mobileAccordion,
  revealBaseKey = title
}: {
  title: string;
  subtitle: string;
  rows: IndicadoresGestaoEstoqueLossDimensionItem[];
  emptyMessage: string;
  mobileAccordion?: MobileAccordionControl;
  revealBaseKey?: string;
}) {
  return (
    <section className="indicadores-panel gestao-estq-panel gestao-estq-panel-loss">
      <PanelHead title={title} subtitle={subtitle} mobileAccordion={mobileAccordion} />
      {!mobileAccordion?.enabled || mobileAccordion.expanded ? (
        <div id={mobileAccordion?.bodyId}>
          {rows.length === 0 ? (
            <div className="indicadores-empty-box"><p>{emptyMessage}</p></div>
          ) : (
            <div className="gestao-estq-loss-list">
              {rows.map((row, index) => (
                <AnimatedReveal
                  key={`${row.dimension_key}:${index}`}
                  revealKey={`${revealBaseKey}:${row.dimension_key}:${index}`}
                  className="gestao-estq-list-reveal"
                  delayMs={Math.min(index, 8) * 35}
                >
                  <article className="gestao-estq-loss-item">
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
                </AnimatedReveal>
              ))}
            </div>
          )}
        </div>
      ) : null}
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
  const [zoneValueRows, setZoneValueRows] = useState<IndicadoresGestaoEstoqueZoneValueRow[]>([]);
  const [topEntradas, setTopEntradas] = useState<IndicadoresGestaoEstoqueTopItem[]>([]);
  const [topSaidas, setTopSaidas] = useState<IndicadoresGestaoEstoqueTopItem[]>([]);
  const [detailRows, setDetailRows] = useState<IndicadoresGestaoEstoqueDetailRow[]>([]);
  const [reentryRows, setReentryRows] = useState<IndicadoresGestaoEstoqueReentryItem[]>([]);
  const [supplierLossRows, setSupplierLossRows] = useState<IndicadoresGestaoEstoqueLossDimensionItem[]>([]);
  const [categoryLossRows, setCategoryLossRows] = useState<IndicadoresGestaoEstoqueLossDimensionItem[]>([]);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [zoneProductRows, setZoneProductRows] = useState<IndicadoresGestaoEstoqueZoneProductRow[]>([]);

  const [loadingMonths, setLoadingMonths] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [loadingZoneValues, setLoadingZoneValues] = useState(false);
  const [loadingTopLists, setLoadingTopLists] = useState(false);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingZoneProducts, setLoadingZoneProducts] = useState(false);
  const [dashboardErrorMessage, setDashboardErrorMessage] = useState<string | null>(null);
  const [zoneValuesErrorMessage, setZoneValuesErrorMessage] = useState<string | null>(null);
  const [zoneProductsErrorMessage, setZoneProductsErrorMessage] = useState<string | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportErrorMessage, setReportErrorMessage] = useState<string | null>(null);
  const [reportStatusMessage, setReportStatusMessage] = useState<string | null>(null);
  const [reportDateStart, setReportDateStart] = useState("");
  const [reportDateEnd, setReportDateEnd] = useState("");
  const [reportMovementFilter, setReportMovementFilter] = useState<IndicadoresGestaoEstoqueMovementFilter>("todas");
  const [inventarioDialogOpen, setInventarioDialogOpen] = useState(false);
  const [inventarioBusy, setInventarioBusy] = useState(false);
  const [inventarioErrorMessage, setInventarioErrorMessage] = useState<string | null>(null);
  const [inventarioStatusMessage, setInventarioStatusMessage] = useState<string | null>(null);
  const [inventarioDateStart, setInventarioDateStart] = useState("");
  const [inventarioDateEnd, setInventarioDateEnd] = useState("");
  const [inventarioStockType, setInventarioStockType] = useState<InventarioStockTypeValue>("");
  const [inventarioIncludePul, setInventarioIncludePul] = useState(false);
  const [inventarioPreview, setInventarioPreview] = useState<IndicadoresGestaoEstoqueInventarioPreviewSummary | null>(null);
  const [inventarioApplySummary, setInventarioApplySummary] = useState<IndicadoresGestaoEstoqueInventarioApplySummary | null>(null);
  const [isMobileAccordion, setIsMobileAccordion] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MOBILE_ACCORDION_MEDIA_QUERY).matches;
  });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(REDUCED_MOTION_QUERY).matches
      : false
  );
  const [expandedMobileSection, setExpandedMobileSection] = useState<MobileAccordionSection | null>(null);
  const [fullscreenPanel, setFullscreenPanel] = useState<FullscreenPanel>(null);
  const inventarioHostAllowed = useMemo(
    () => isInventarioSeedAllowedHostname(typeof window === "undefined" ? undefined : window.location.hostname),
    []
  );

  function toggleMobileSection(section: MobileAccordionSection) {
    setExpandedMobileSection((current) => (current === section ? null : section));
  }

  function mobileAccordionControl(section: MobileAccordionSection, bodyId: string): MobileAccordionControl {
    return {
      enabled: isMobileAccordion,
      expanded: expandedMobileSection === section,
      bodyId,
      onToggle: () => toggleMobileSection(section)
    };
  }

  function openZoneProducts(zona: string) {
    setSelectedZone(zona);
    setZoneProductsErrorMessage(null);
  }

  function closeZoneProducts() {
    setSelectedZone(null);
    setZoneProductRows([]);
    setZoneProductsErrorMessage(null);
  }

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mediaQuery = window.matchMedia(MOBILE_ACCORDION_MEDIA_QUERY);
    const sync = () => setIsMobileAccordion(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => {
      mediaQuery.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => setPrefersReducedMotion(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => {
      mediaQuery.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (isMobileAccordion) {
      setExpandedMobileSection(null);
      setReportDialogOpen(false);
      setInventarioDialogOpen(false);
    }
  }, [isMobileAccordion]);

  useEffect(() => {
    if (!fullscreenPanel) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullscreenPanel(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreenPanel]);

  useEffect(() => {
    if (!selectedZone) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeZoneProducts();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedZone]);

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
      setZoneValueRows([]);
      setTopEntradas([]);
      setTopSaidas([]);
      setReentryRows([]);
      setSupplierLossRows([]);
      setCategoryLossRows([]);
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
      setZoneValueRows([]);
      setZoneValuesErrorMessage(null);
      return;
    }

    let cancelled = false;

    async function loadZoneValues() {
      setLoadingZoneValues(true);
      setZoneValuesErrorMessage(null);
      try {
        const rows = await fetchIndicadoresGestaoEstoqueZoneValues(
          activeCd,
          selectedMonthStart,
          selectedDay === ALL_DAYS_VALUE ? null : selectedDay,
          movementFilter
        );
        if (!cancelled) setZoneValueRows(rows);
      } catch (error) {
        if (!cancelled) {
          setZoneValueRows([]);
          setZoneValuesErrorMessage(asErrorMessage(error));
        }
      } finally {
        if (!cancelled) setLoadingZoneValues(false);
      }
    }

    void loadZoneValues();
    return () => {
      cancelled = true;
    };
  }, [activeCd, movementFilter, selectedDay, selectedMonthStart]);

  useEffect(() => {
    if (!selectedZone || !selectedMonthStart) {
      setZoneProductRows([]);
      return;
    }

    let cancelled = false;
    const activeZone = selectedZone;

    async function loadZoneProducts() {
      setLoadingZoneProducts(true);
      setZoneProductsErrorMessage(null);
      try {
        const rows = await fetchIndicadoresGestaoEstoqueZoneProducts({
          cd: activeCd,
          monthStart: selectedMonthStart,
          day: selectedDay === ALL_DAYS_VALUE ? null : selectedDay,
          movementFilter,
          zona: activeZone,
          limit: 300
        });
        if (!cancelled) setZoneProductRows(rows);
      } catch (error) {
        if (!cancelled) {
          setZoneProductRows([]);
          setZoneProductsErrorMessage(asErrorMessage(error));
        }
      } finally {
        if (!cancelled) setLoadingZoneProducts(false);
      }
    }

    void loadZoneProducts();
    return () => {
      cancelled = true;
    };
  }, [activeCd, movementFilter, selectedDay, selectedMonthStart, selectedZone]);

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
    if (!selectedMonthStart) {
      setDetailRows([]);
      return;
    }

    if (isMobileAccordion && expandedMobileSection !== "details") {
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
  }, [activeCd, expandedMobileSection, isMobileAccordion, movementFilter, selectedDay, selectedMonthStart]);

  const canExportReport = !isMobileAccordion && Boolean(selectedMonthStart);
  const canOpenInventarioDialog = !isMobileAccordion && Boolean(selectedMonthStart) && inventarioHostAllowed && profile.role === "admin";
  const inventarioPreviewHasItems = (inventarioPreview?.itens_qtd ?? 0) > 0;

  const openReportDialog = useCallback(() => {
    if (!canExportReport || reportBusy) return;

    setReportDateStart(defaultReportStartDate(summary, selectedMonthStart, selectedDay));
    setReportDateEnd(defaultReportEndDate(summary, selectedMonthStart, selectedDay));
    setReportMovementFilter(movementFilter);
    setReportErrorMessage(null);
    setReportStatusMessage(null);
    setReportDialogOpen(true);
  }, [canExportReport, movementFilter, reportBusy, selectedDay, selectedMonthStart, summary]);

  const closeReportDialog = useCallback(() => {
    if (reportBusy) return;
    setReportDialogOpen(false);
    setReportErrorMessage(null);
  }, [reportBusy]);

  const openInventarioDialog = useCallback(() => {
    if (!canOpenInventarioDialog || inventarioBusy) return;

    setInventarioDateStart(defaultReportStartDate(summary, selectedMonthStart, selectedDay));
    setInventarioDateEnd(defaultReportEndDate(summary, selectedMonthStart, selectedDay));
    setInventarioStockType("");
    setInventarioIncludePul(false);
    setInventarioPreview(null);
    setInventarioApplySummary(null);
    setInventarioErrorMessage(null);
    setInventarioStatusMessage(null);
    setInventarioDialogOpen(true);
  }, [canOpenInventarioDialog, inventarioBusy, selectedDay, selectedMonthStart, summary]);

  const closeInventarioDialog = useCallback(() => {
    if (inventarioBusy) return;
    setInventarioDialogOpen(false);
    setInventarioErrorMessage(null);
  }, [inventarioBusy]);

  const validateReportFilters = useCallback((): string | null => {
    if (!reportDateStart || !reportDateEnd) {
      return "Informe a data inicial e a data final do relatório.";
    }
    if (reportDateStart > reportDateEnd) {
      return "A data inicial não pode ser maior que a data final.";
    }
    return null;
  }, [reportDateEnd, reportDateStart]);

  const validateInventarioFilters = useCallback((): string | null => {
    if (!inventarioDateStart || !inventarioDateEnd) {
      return "Informe a data inicial e a data final.";
    }
    if (inventarioDateStart > inventarioDateEnd) {
      return "A data inicial não pode ser maior que a data final.";
    }
    if (!inventarioStockType) {
      return "Selecione o tipo de estoque: Disponível ou Atual.";
    }
    return null;
  }, [inventarioDateEnd, inventarioDateStart, inventarioStockType]);

  const runInventarioPreview = useCallback(async () => {
    const validationError = validateInventarioFilters();
    if (validationError) {
      setInventarioErrorMessage(validationError);
      return;
    }

    if (!inventarioStockType) return;

    setInventarioBusy(true);
    setInventarioErrorMessage(null);
    setInventarioStatusMessage(null);
    setInventarioApplySummary(null);

    try {
      const preview = await previewIndicadoresGestaoEstoqueInventarioSeed({
        cd: activeCd,
        dtIni: inventarioDateStart,
        dtFim: inventarioDateEnd,
        estoqueTipo: inventarioStockType,
        incluirPul: inventarioIncludePul
      });
      setInventarioPreview(preview);
    } catch (error) {
      setInventarioPreview(null);
      setInventarioErrorMessage(asErrorMessage(error));
    } finally {
      setInventarioBusy(false);
    }
  }, [activeCd, inventarioDateEnd, inventarioDateStart, inventarioIncludePul, inventarioStockType, validateInventarioFilters]);

  const applyInventarioSeed = useCallback(async () => {
    const validationError = validateInventarioFilters();
    if (validationError) {
      setInventarioErrorMessage(validationError);
      return;
    }
    if (!inventarioStockType) return;
    if (!inventarioPreviewHasItems) {
      setInventarioErrorMessage("Gere a prévia com itens elegíveis antes de confirmar.");
      return;
    }

    setInventarioBusy(true);
    setInventarioErrorMessage(null);
    setInventarioStatusMessage(null);

    try {
      const summaryApply = await applyIndicadoresGestaoEstoqueInventarioSeed({
        cd: activeCd,
        dtIni: inventarioDateStart,
        dtFim: inventarioDateEnd,
        estoqueTipo: inventarioStockType,
        incluirPul: inventarioIncludePul
      });
      setInventarioApplySummary(summaryApply);
      setInventarioDialogOpen(false);
      setInventarioStatusMessage(
        `Inventário atualizado. Produtos: ${formatInteger(summaryApply.produtos_qtd)} | Endereços: ${formatInteger(summaryApply.enderecos_qtd)} | Itens afetados: ${formatInteger(summaryApply.itens_afetados)} | Total atual: ${formatInteger(summaryApply.total_geral)}.`
      );
    } catch (error) {
      setInventarioErrorMessage(asErrorMessage(error));
    } finally {
      setInventarioBusy(false);
    }
  }, [
    activeCd,
    inventarioDateEnd,
    inventarioDateStart,
    inventarioIncludePul,
    inventarioPreviewHasItems,
    inventarioStockType,
    validateInventarioFilters
  ]);

  const exportReportXlsx = useCallback(async () => {
    const validationError = validateReportFilters();
    if (validationError) {
      setReportErrorMessage(validationError);
      return;
    }

    setReportBusy(true);
    setReportErrorMessage(null);
    setReportStatusMessage(null);

    try {
      const [
        reportSummary,
        reportDailySeries,
        reportZoneValues,
        reportTopEntradas,
        reportTopSaidas,
        reportReentries,
        reportSupplierLoss,
        reportCategoryLoss,
        reportDetails,
        reportBase
      ] = await Promise.all([
        fetchIndicadoresGestaoEstoqueReportSummary({
          cd: activeCd,
          dtIni: reportDateStart,
          dtFim: reportDateEnd,
          movementFilter: reportMovementFilter
        }),
        fetchIndicadoresGestaoEstoqueReportDailySeries({
          cd: activeCd,
          dtIni: reportDateStart,
          dtFim: reportDateEnd,
          movementFilter: reportMovementFilter
        }),
        fetchIndicadoresGestaoEstoqueReportZoneValues({
          cd: activeCd,
          dtIni: reportDateStart,
          dtFim: reportDateEnd,
          movementFilter: reportMovementFilter
        }),
        fetchIndicadoresGestaoEstoqueReportTopItems({
          cd: activeCd,
          dtIni: reportDateStart,
          dtFim: reportDateEnd,
          rankGroup: "entrada",
          movementFilter: reportMovementFilter
        }),
        fetchIndicadoresGestaoEstoqueReportTopItems({
          cd: activeCd,
          dtIni: reportDateStart,
          dtFim: reportDateEnd,
          rankGroup: "saida",
          movementFilter: reportMovementFilter
        }),
        fetchIndicadoresGestaoEstoqueReportReentryItems({
          cd: activeCd,
          dtIni: reportDateStart,
          dtFim: reportDateEnd,
          movementFilter: reportMovementFilter
        }),
        fetchIndicadoresGestaoEstoqueReportLossDimension({
          cd: activeCd,
          dtIni: reportDateStart,
          dtFim: reportDateEnd,
          dimension: "fornecedor",
          movementFilter: reportMovementFilter
        }),
        fetchIndicadoresGestaoEstoqueReportLossDimension({
          cd: activeCd,
          dtIni: reportDateStart,
          dtFim: reportDateEnd,
          dimension: "categoria_n2",
          movementFilter: reportMovementFilter
        }),
        fetchIndicadoresGestaoEstoqueReportDetails({
          cd: activeCd,
          dtIni: reportDateStart,
          dtFim: reportDateEnd,
          movementFilter: reportMovementFilter
        }),
        fetchIndicadoresGestaoEstoqueReportBase({
          cd: activeCd,
          dtIni: reportDateStart,
          dtFim: reportDateEnd,
          movementFilter: reportMovementFilter
        })
      ]);

      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const generatedAtIso = new Date().toISOString();
      const fileCdSuffix = activeCd == null ? "na" : String(activeCd).padStart(2, "0");
      const fileName = `indicadores-gestao-estoque-${reportDateStart}-a-${reportDateEnd}-cd${fileCdSuffix}.xlsx`;
      const setSheetWidths = (sheet: Record<string, unknown>, widths: number[]) => {
        sheet["!cols"] = widths.map((wch) => ({ wch }));
      };

      const parametrosSheet = XLSX.utils.aoa_to_sheet([
        ["Parametro", "Valor"],
        ["CD", displayCdName],
        ["Codigo do CD", activeCd == null ? "-" : String(activeCd).padStart(2, "0")],
        ["Data inicial", formatDate(reportDateStart)],
        ["Data final", formatDate(reportDateEnd)],
        ["Movimentacao", formatMovementLabel(reportMovementFilter)],
        ["Gerado em", formatDateTime(generatedAtIso)],
        ["Atualizado em", formatDateTime(reportSummary.updated_at)]
      ]);
      setSheetWidths(parametrosSheet, [28, 34]);

      const resumoSheet = XLSX.utils.aoa_to_sheet([
        ["Indicador", "Valor"],
        ["Entradas no Periodo", formatCurrency(reportSummary.total_entradas_periodo)],
        ["Saidas no Periodo", formatCurrency(reportSummary.total_saidas_periodo)],
        ["Sobras no Periodo", formatCurrency(reportSummary.total_sobras_periodo)],
        ["Faltas no Periodo", formatCurrency(reportSummary.total_faltas_periodo)],
        ["Perda Liquida no Periodo", formatSignedCurrency(reportSummary.perda_liquida_periodo)],
        ["Produtos Distintos", formatInteger(reportSummary.produtos_distintos_periodo)],
        ["Primeiro dia com movimento", formatDate(reportSummary.available_day_start)],
        ["Ultimo dia com movimento", formatDate(reportSummary.available_day_end)]
      ]);
      setSheetWidths(resumoSheet, [34, 26]);

      const serieDiariaSheet = XLSX.utils.json_to_sheet(
        reportDailySeries.map((row) => ({
          Data: formatDate(row.date_ref),
          Entradas: row.entrada_total,
          Saidas: row.saida_total,
          Perda: row.perda_total
        })),
        { header: ["Data", "Entradas", "Saidas", "Perda"] }
      );
      setSheetWidths(serieDiariaSheet, [14, 16, 16, 16]);

      const zonasSheet = XLSX.utils.json_to_sheet(
        reportZoneValues.map((row) => ({
          Zona: row.zona,
          EntradaTotal: row.entrada_total,
          SaidaTotal: row.saida_total,
          ValorTotal: row.valor_total
        })),
        {
          header: ["Zona", "EntradaTotal", "SaidaTotal", "ValorTotal"]
        }
      );
      setSheetWidths(zonasSheet, [22, 16, 16, 16]);

      const reentradaSheet = XLSX.utils.json_to_sheet(
        reportReentries.map((row) => ({
          CODDV: formatPlainInteger(row.coddv),
          Descricao: row.descricao,
          PrimeiraSaida: formatDate(row.first_saida_date),
          PrimeiraReentrada: formatDate(row.first_entrada_after_saida_date),
          TotalSaidaPeriodo: row.total_saida_periodo,
          TotalEntradaPeriodo: row.total_entrada_periodo,
          SaldoPeriodo: row.saldo_periodo
        })),
        {
          header: [
            "CODDV",
            "Descricao",
            "PrimeiraSaida",
            "PrimeiraReentrada",
            "TotalSaidaPeriodo",
            "TotalEntradaPeriodo",
            "SaldoPeriodo"
          ]
        }
      );
      setSheetWidths(reentradaSheet, [12, 44, 16, 18, 18, 20, 16]);

      const topEntradasSheet = XLSX.utils.json_to_sheet(
        reportTopEntradas.map((row) => ({
          CODDV: formatPlainInteger(row.coddv),
          Descricao: row.descricao,
          TotalValor: row.total_valor,
          Movimentacoes: row.movimentacoes,
          DiasDistintos: row.dias_distintos,
          PrimeiraData: formatDate(row.first_date),
          UltimaData: formatDate(row.last_date)
        })),
        {
          header: [
            "CODDV",
            "Descricao",
            "TotalValor",
            "Movimentacoes",
            "DiasDistintos",
            "PrimeiraData",
            "UltimaData"
          ]
        }
      );
      setSheetWidths(topEntradasSheet, [12, 42, 16, 14, 14, 16, 16]);

      const topSaidasSheet = XLSX.utils.json_to_sheet(
        reportTopSaidas.map((row) => ({
          CODDV: formatPlainInteger(row.coddv),
          Descricao: row.descricao,
          TotalValor: row.total_valor,
          Movimentacoes: row.movimentacoes,
          DiasDistintos: row.dias_distintos,
          PrimeiraData: formatDate(row.first_date),
          UltimaData: formatDate(row.last_date)
        })),
        {
          header: [
            "CODDV",
            "Descricao",
            "TotalValor",
            "Movimentacoes",
            "DiasDistintos",
            "PrimeiraData",
            "UltimaData"
          ]
        }
      );
      setSheetWidths(topSaidasSheet, [12, 42, 16, 14, 14, 16, 16]);

      const perdasFornecedorSheet = XLSX.utils.json_to_sheet(
        reportSupplierLoss.map((row) => ({
          Fornecedor: row.dimension_key,
          PerdaPeriodo: row.perda_periodo,
          TotalFaltasPeriodo: row.total_faltas_periodo,
          TotalSobrasPeriodo: row.total_sobras_periodo,
          ProdutosDistintosPeriodo: row.produtos_distintos_periodo
        })),
        {
          header: [
            "Fornecedor",
            "PerdaPeriodo",
            "TotalFaltasPeriodo",
            "TotalSobrasPeriodo",
            "ProdutosDistintosPeriodo"
          ]
        }
      );
      setSheetWidths(perdasFornecedorSheet, [34, 16, 18, 18, 18]);

      const perdasCategoriaSheet = XLSX.utils.json_to_sheet(
        reportCategoryLoss.map((row) => ({
          CategoriaN2: row.dimension_key,
          PerdaPeriodo: row.perda_periodo,
          TotalFaltasPeriodo: row.total_faltas_periodo,
          TotalSobrasPeriodo: row.total_sobras_periodo,
          ProdutosDistintosPeriodo: row.produtos_distintos_periodo
        })),
        {
          header: [
            "CategoriaN2",
            "PerdaPeriodo",
            "TotalFaltasPeriodo",
            "TotalSobrasPeriodo",
            "ProdutosDistintosPeriodo"
          ]
        }
      );
      setSheetWidths(perdasCategoriaSheet, [32, 16, 18, 18, 18]);

      const movimentacoesSheet = XLSX.utils.json_to_sheet(
        reportDetails.map((row) => ({
          Data: formatDate(row.data_mov),
          CODDV: formatPlainInteger(row.coddv),
          Descricao: row.descricao,
          TipoMovimentacao: row.tipo_movimentacao,
          GrupoMovimento: row.movement_group,
          Natureza: row.natureza,
          Quantidade: row.quantidade,
          ValorTotal: row.valor_total,
          Responsavel: row.responsavel,
          Cargo: row.cargo,
          Ocorrencias: row.ocorrencias
        })),
        {
          header: [
            "Data",
            "CODDV",
            "Descricao",
            "TipoMovimentacao",
            "GrupoMovimento",
            "Natureza",
            "Quantidade",
            "ValorTotal",
            "Responsavel",
            "Cargo",
            "Ocorrencias"
          ]
        }
      );
      setSheetWidths(movimentacoesSheet, [14, 12, 42, 18, 16, 14, 12, 16, 28, 22, 12]);

      const baseSheet = XLSX.utils.json_to_sheet(
        reportBase.map((row) => ({
          CD: row.cd,
          DataMov: row.data_mov,
          CODDV: row.coddv,
          Descricao: row.descricao,
          TipoMovimentacao: row.tipo_movimentacao,
          CategoriaN1: row.categoria_n1 ?? "",
          CategoriaN2: row.categoria_n2 ?? "",
          Fornecedor: row.fornecedor ?? "",
          Usuario: row.usuario ?? "",
          QtdMov: row.qtd_mov ?? "",
          ValorMov: row.valor_mov,
          UpdatedAt: row.updated_at ?? ""
        })),
        {
          header: [
            "CD",
            "DataMov",
            "CODDV",
            "Descricao",
            "TipoMovimentacao",
            "CategoriaN1",
            "CategoriaN2",
            "Fornecedor",
            "Usuario",
            "QtdMov",
            "ValorMov",
            "UpdatedAt"
          ]
        }
      );
      setSheetWidths(baseSheet, [8, 12, 12, 40, 18, 24, 24, 28, 18, 12, 14, 22]);

      XLSX.utils.book_append_sheet(workbook, parametrosSheet, "Parametros");
      XLSX.utils.book_append_sheet(workbook, resumoSheet, "Resumo");
      XLSX.utils.book_append_sheet(workbook, serieDiariaSheet, "Serie Diaria");
      XLSX.utils.book_append_sheet(workbook, zonasSheet, "Mov por Zona");
      XLSX.utils.book_append_sheet(workbook, reentradaSheet, "Reentrada");
      XLSX.utils.book_append_sheet(workbook, topEntradasSheet, "Top Entradas");
      XLSX.utils.book_append_sheet(workbook, topSaidasSheet, "Top Saidas");
      XLSX.utils.book_append_sheet(workbook, perdasFornecedorSheet, "Perdas Fornec");
      XLSX.utils.book_append_sheet(workbook, perdasCategoriaSheet, "Perdas Cat N2");
      XLSX.utils.book_append_sheet(workbook, movimentacoesSheet, "Mov Agregadas");
      XLSX.utils.book_append_sheet(workbook, baseSheet, "Base Periodo");

      XLSX.writeFile(workbook, fileName, { compression: true });

      setReportDialogOpen(false);
      setReportStatusMessage("Relatório Excel gerado com sucesso.");
    } catch (error) {
      setReportErrorMessage(asErrorMessage(error));
    } finally {
      setReportBusy(false);
    }
  }, [
    activeCd,
    displayCdName,
    reportDateEnd,
    reportDateStart,
    reportMovementFilter,
    validateReportFilters
  ]);

  const selectedMonthLabel = useMemo(
    () => monthOptions.find((option) => option.month_start === selectedMonthStart)?.month_label ?? "-",
    [monthOptions, selectedMonthStart]
  );
  const dashboardAnimationKey = `${selectedMonthStart}:${selectedDay}:${movementFilter}:${summary?.updated_at ?? "pending"}`;

  useEffect(() => {
    if (!inventarioDialogOpen) return;
    setInventarioPreview(null);
    setInventarioApplySummary(null);
    setInventarioErrorMessage(null);
    setInventarioStatusMessage(null);
  }, [inventarioDateEnd, inventarioDateStart, inventarioDialogOpen, inventarioIncludePul, inventarioStockType]);

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
      { label: "Entradas no Mês", value: summary.total_entradas_mes, kind: "currency", accent: "entry", valueTone: "entry" },
      { label: "Saídas no Mês", value: summary.total_saidas_mes, kind: "currency", accent: "exit", valueTone: "exit" },
      {
        label: "Perda no Mês Atual",
        value: summary.perda_mes_atual,
        kind: "signed-currency",
        accent: "loss",
        natureBadge: lossNatureBadge(summary.perda_mes_atual),
        valueTone: "default"
      },
      {
        label: "Perda Acum. Ano",
        value: summary.perda_acumulada_ano,
        kind: "signed-currency",
        accent: "loss",
        natureBadge: lossNatureBadge(summary.perda_acumulada_ano),
        valueTone: "default"
      },
      { label: "Acumulado Entradas Ano", value: summary.acumulado_entradas_ano, kind: "currency", accent: "neutral" },
      { label: "Acumulado Saídas Ano", value: summary.acumulado_saidas_ano, kind: "currency", accent: "exit", valueTone: "default" },
      { label: "Produtos Distintos", value: summary.produtos_distintos_mes, kind: "integer" }
    ];
  }, [summary]);

  const inventarioApplyActorLabel = useMemo(() => {
    if (!inventarioApplySummary) return null;
    const nome = (inventarioApplySummary.usuario_nome ?? "").trim();
    const mat = (inventarioApplySummary.usuario_mat ?? "").trim();
    const atualizadoEm = formatDateTime(inventarioApplySummary.atualizado_em);
    const actor = [nome, mat ? `MAT ${mat}` : null].filter(Boolean).join(" | ");
    if (actor && atualizadoEm !== "-") return `${actor} em ${atualizadoEm}`;
    if (actor) return actor;
    if (atualizadoEm !== "-") return atualizadoEm;
    return null;
  }, [inventarioApplySummary]);

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
          <AnimatedReveal revealKey={`gestao-estq-header:${dashboardAnimationKey}`} delayMs={0}>
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
                  {!isMobileAccordion ? (
                    <div className="indicadores-filters-actions">
                      {canOpenInventarioDialog ? (
                        <button
                          type="button"
                          className="btn btn-muted gestao-estq-inventario-trigger"
                          onClick={openInventarioDialog}
                          disabled={inventarioBusy}
                          title="Enviar produtos de saída para auditoria no Inventário (zerados)"
                        >
                          <span className="gestao-estq-action-icon" aria-hidden="true">
                            {inventorySendIcon()}
                          </span>
                          <span>{inventarioBusy ? "Processando..." : "Enviar para Inventário"}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-primary gestao-estq-report-export-trigger"
                        onClick={openReportDialog}
                        disabled={!canExportReport || reportBusy}
                      >
                        {reportBusy ? "Gerando Excel..." : "Exportar Excel"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </AnimatedReveal>

          {dashboardErrorMessage ? (
            <AnimatedReveal revealKey={`gestao-estq-dashboard-error:${dashboardErrorMessage}`} delayMs={40}>
              <div className="indicadores-feedback is-error">{dashboardErrorMessage}</div>
            </AnimatedReveal>
          ) : null}
          {inventarioStatusMessage ? (
            <AnimatedReveal revealKey={`gestao-estq-inventario-status:${inventarioStatusMessage}`} delayMs={40}>
              <div className="module-inline-message">{inventarioStatusMessage}</div>
            </AnimatedReveal>
          ) : null}
          {inventarioApplySummary && inventarioApplyActorLabel ? (
            <AnimatedReveal revealKey={`gestao-estq-inventario-actor:${inventarioApplyActorLabel}`} delayMs={40}>
              <div className="module-inline-message">{`Base atualizada por ${inventarioApplyActorLabel}`}</div>
            </AnimatedReveal>
          ) : null}
          {reportStatusMessage ? (
            <AnimatedReveal revealKey={`gestao-estq-report-status:${reportStatusMessage}`} delayMs={40}>
              <div className="module-inline-message">{reportStatusMessage}</div>
            </AnimatedReveal>
          ) : null}

          <div className="indicadores-metrics-grid gestao-estq-metrics-grid">
            {metricCards.map((card, index) => (
              <AnimatedMetricCard
                key={card.label}
                card={card}
                animationKey={dashboardAnimationKey}
                delayMs={80 + index * 45}
                prefersReducedMotion={prefersReducedMotion}
              />
            ))}
          </div>

          <div className="gestao-estq-layout-grid">
            <AnimatedReveal revealKey={`gestao-estq-chart:${dashboardAnimationKey}`} className="gestao-estq-panel-reveal gestao-estq-panel-chart" delayMs={140}>
              <section className="indicadores-panel gestao-estq-panel gestao-estq-panel-chart">
                <div className="indicadores-panel-head">
                  <div className="indicadores-panel-head-copy">
                    <h3>Ritmo diário</h3>
                    <span>{loadingDashboard ? "Atualizando..." : "Entradas, saídas e perda por dia do mês"}</span>
                  </div>
                  <button
                    type="button"
                    className="gestao-estq-fullscreen-trigger"
                    onClick={() => setFullscreenPanel("daily")}
                    title="Ver Ritmo diário em tela cheia"
                    aria-label="Ver Ritmo diário em tela cheia"
                  >
                    {expandIcon()}
                  </button>
                </div>
                {loadingDashboard && !summary ? (
                  <div className="indicadores-empty-box"><p>Carregando série diária...</p></div>
                ) : (
                  <DailyChart rows={dailySeries} />
                )}
              </section>
            </AnimatedReveal>

            <AnimatedReveal revealKey={`gestao-estq-zones:${dashboardAnimationKey}`} className="gestao-estq-panel-reveal gestao-estq-panel-zone-values" delayMs={200}>
              <section className="indicadores-panel gestao-estq-panel gestao-estq-panel-zone-values">
                <PanelHead
                  title="Valor de movimentação por zona"
                  subtitle={
                    loadingZoneValues
                      ? "Atualizando zonas..."
                      : selectedDay === ALL_DAYS_VALUE
                        ? "Acumulado do mês no filtro ativo."
                        : `Data ${formatDate(selectedDay)}`
                  }
                  mobileAccordion={mobileAccordionControl("zoneValues", "gestao-estq-zone-values-body")}
                  action={
                    <button
                      type="button"
                      className="gestao-estq-fullscreen-trigger"
                      onClick={() => setFullscreenPanel("zoneValues")}
                      title="Ver Valor de movimentação por zona em tela cheia"
                      aria-label="Ver Valor de movimentação por zona em tela cheia"
                    >
                      {expandIcon()}
                    </button>
                  }
                />
                {!isMobileAccordion || expandedMobileSection === "zoneValues" ? (
                  <div id="gestao-estq-zone-values-body">
                    {zoneValuesErrorMessage ? (
                      <div className="indicadores-empty-box"><p>{zoneValuesErrorMessage}</p></div>
                    ) : loadingZoneValues ? (
                      <div className="indicadores-empty-box"><p>Carregando movimentações por zona...</p></div>
                    ) : (
                      <ZoneValueChart rows={zoneValueRows} movementFilter={movementFilter} onZoneClick={(row) => openZoneProducts(row.zona)} />
                    )}
                  </div>
                ) : null}
              </section>
            </AnimatedReveal>

            <AnimatedReveal revealKey={`gestao-estq-reentry:${dashboardAnimationKey}:${expandedMobileSection ?? "closed"}`} className="gestao-estq-panel-reveal gestao-estq-panel-reentry" delayMs={260}>
              <section className="indicadores-panel gestao-estq-panel gestao-estq-panel-reentry">
                <PanelHead
                  title="Saída seguida de entrada"
                  subtitle="Acumulado do ano."
                  mobileAccordion={mobileAccordionControl("reentry", "gestao-estq-reentry-body")}
                />
                {!isMobileAccordion || expandedMobileSection === "reentry" ? (
                  <div id="gestao-estq-reentry-body">
                    {loadingInsights && reentryRows.length === 0 ? (
                      <div className="indicadores-empty-box"><p>Carregando insights do ano...</p></div>
                    ) : reentryRows.length === 0 ? (
                      <div className="indicadores-empty-box"><p>Nenhum produto com saída seguida de entrada encontrado no ano.</p></div>
                    ) : (
                      <div className="gestao-estq-reentry-list">
                        {reentryRows.map((row, index) => (
                          <AnimatedReveal
                            key={`${row.coddv}:${index}`}
                            revealKey={`gestao-estq-reentry-row:${dashboardAnimationKey}:${row.coddv}:${index}`}
                            className="gestao-estq-list-reveal"
                            delayMs={Math.min(index, 8) * 35}
                          >
                            <article className="gestao-estq-reentry-item">
                              <div className="gestao-estq-reentry-main">
                                <strong className="gestao-estq-reentry-title">
                                  <span className="gestao-estq-reentry-coddv">CODDV {formatPlainInteger(row.coddv)}</span>
                                  <span className="gestao-estq-reentry-description">{row.descricao}</span>
                                </strong>
                              </div>
                              <div className="gestao-estq-reentry-stats">
                                <section className="gestao-estq-reentry-stat gestao-estq-reentry-stat-saida">
                                  <span className="gestao-estq-reentry-stat-label">Saída</span>
                                  <strong>{formatCurrency(row.total_saida_ano)}</strong>
                                  <small>Data {formatDate(row.first_saida_date)}</small>
                                </section>
                                <section className="gestao-estq-reentry-stat gestao-estq-reentry-stat-entrada">
                                  <span className="gestao-estq-reentry-stat-label">Entrada</span>
                                  <strong>{formatCurrency(row.total_entrada_ano)}</strong>
                                  <small>Data {formatDate(row.first_entrada_after_saida_date)}</small>
                                </section>
                                <section className="gestao-estq-reentry-stat gestao-estq-reentry-stat-diff">
                                  <span className="gestao-estq-reentry-stat-label">Diferença</span>
                                  <strong className={row.saldo_ano >= 0 ? "gestao-estq-value-positive" : "gestao-estq-value-negative"}>
                                    {formatSignedCurrency(row.saldo_ano)}
                                  </strong>
                                  <small>Entrada - saída</small>
                                </section>
                              </div>
                            </article>
                          </AnimatedReveal>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </section>
            </AnimatedReveal>

            <AnimatedReveal revealKey={`gestao-estq-top-entradas:${dashboardAnimationKey}:${expandedMobileSection ?? "closed"}`} className="gestao-estq-panel-reveal gestao-estq-panel-top" delayMs={300}>
              <TopList
                title="Top 30 Entradas"
                subtitle={loadingTopLists ? "Atualizando ranking..." : selectedDay === ALL_DAYS_VALUE ? "Acumulado do mês no filtro ativo." : `Data ${formatDate(selectedDay)}`}
                rows={topEntradas}
                emptyMessage="Nenhuma entrada encontrada para o filtro selecionado."
                className="gestao-estq-panel-top"
                mobileAccordion={mobileAccordionControl("topEntradas", "gestao-estq-top-entradas-body")}
                revealBaseKey={`gestao-estq-top-entradas:${dashboardAnimationKey}`}
              />
            </AnimatedReveal>

            <AnimatedReveal revealKey={`gestao-estq-top-saidas:${dashboardAnimationKey}:${expandedMobileSection ?? "closed"}`} className="gestao-estq-panel-reveal gestao-estq-panel-top" delayMs={340}>
              <TopList
                title="Top 30 Saídas"
                subtitle={loadingTopLists ? "Atualizando ranking..." : selectedDay === ALL_DAYS_VALUE ? "Acumulado do mês no filtro ativo." : `Data ${formatDate(selectedDay)}`}
                rows={topSaidas}
                emptyMessage="Nenhuma saída encontrada para o filtro selecionado."
                className="gestao-estq-panel-top"
                mobileAccordion={mobileAccordionControl("topSaidas", "gestao-estq-top-saidas-body")}
                revealBaseKey={`gestao-estq-top-saidas:${dashboardAnimationKey}`}
              />
            </AnimatedReveal>

            <AnimatedReveal revealKey={`gestao-estq-loss-supplier:${dashboardAnimationKey}:${expandedMobileSection ?? "closed"}`} className="gestao-estq-panel-reveal gestao-estq-panel-loss" delayMs={380}>
              <LossDimensionList
                title="Maiores perdas por fornecedor"
                subtitle={loadingInsights ? "Atualizando perdas..." : "Perda do mês e acumulado do ano."}
                rows={supplierLossRows}
                emptyMessage="Nenhuma perda positiva por fornecedor encontrada no filtro selecionado."
                mobileAccordion={mobileAccordionControl("supplierLoss", "gestao-estq-supplier-loss-body")}
                revealBaseKey={`gestao-estq-loss-supplier:${dashboardAnimationKey}`}
              />
            </AnimatedReveal>

            <AnimatedReveal revealKey={`gestao-estq-loss-category:${dashboardAnimationKey}:${expandedMobileSection ?? "closed"}`} className="gestao-estq-panel-reveal gestao-estq-panel-loss" delayMs={420}>
              <LossDimensionList
                title="Maiores perdas por categoria N2"
                subtitle={loadingInsights ? "Atualizando perdas..." : "Perda do mês e acumulado do ano."}
                rows={categoryLossRows}
                emptyMessage="Nenhuma perda positiva por categoria encontrada no filtro selecionado."
                mobileAccordion={mobileAccordionControl("categoryLoss", "gestao-estq-category-loss-body")}
                revealBaseKey={`gestao-estq-loss-category:${dashboardAnimationKey}`}
              />
            </AnimatedReveal>

            <AnimatedReveal revealKey={`gestao-estq-details:${dashboardAnimationKey}:${expandedMobileSection ?? "closed"}`} className="gestao-estq-panel-reveal gestao-estq-panel-details" delayMs={460}>
              <section className="indicadores-panel gestao-estq-panel gestao-estq-panel-details">
              <PanelHead
                title={selectedDay === ALL_DAYS_VALUE ? "Movimentações do mês" : "Movimentações do dia"}
                subtitle={
                  selectedDay === ALL_DAYS_VALUE
                    ? `${selectedMonthLabel} · maiores valores do mês no filtro ativo · top ${DETAIL_ROWS_LIMIT}`
                    : `${formatDate(selectedDay)} · maiores valores no filtro ${formatMovementLabel(movementFilter)} · top ${DETAIL_ROWS_LIMIT}`
                }
                mobileAccordion={mobileAccordionControl("details", "gestao-estq-details-body")}
              />
              {!isMobileAccordion || expandedMobileSection === "details" ? (
                <div id="gestao-estq-details-body">
                  {loadingDetails ? (
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
                            <th>Quantidade</th>
                            <th>Total (R$)</th>
                            <th>Responsável</th>
                            <th>Cargo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailRows.map((row, index) => (
                            <AnimatedDetailRow
                              key={`${row.data_mov}:${row.coddv}:${row.tipo_movimentacao}:${index}`}
                              row={row}
                              rowKey={`${dashboardAnimationKey}:${row.data_mov}:${row.coddv}:${row.tipo_movimentacao}:${index}`}
                              delayMs={Math.min(index, 6) * 20}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
              </section>
            </AnimatedReveal>
          </div>
        </article>
      </section>
      {fullscreenPanel && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay gestao-estq-fullscreen-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gestao-estq-fullscreen-title"
              onClick={() => setFullscreenPanel(null)}
            >
              <div className="gestao-estq-fullscreen-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <div className="gestao-estq-fullscreen-head">
                  <div>
                    <h3 id="gestao-estq-fullscreen-title">
                      {fullscreenPanel === "daily" ? "Ritmo diário" : "Valor de movimentação por zona"}
                    </h3>
                    <span>
                      {fullscreenPanel === "daily"
                        ? loadingDashboard
                          ? "Atualizando..."
                          : "Entradas, saídas e perda por dia do mês"
                        : loadingZoneValues
                          ? "Atualizando zonas..."
                          : selectedDay === ALL_DAYS_VALUE
                            ? "Acumulado do mês no filtro ativo."
                            : `Data ${formatDate(selectedDay)}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="gestao-estq-fullscreen-close"
                    onClick={() => setFullscreenPanel(null)}
                    title="Fechar tela cheia"
                    aria-label="Fechar tela cheia"
                  >
                    {closeIcon()}
                  </button>
                </div>
                <div className="gestao-estq-fullscreen-body">
                  {fullscreenPanel === "daily" ? (
                    loadingDashboard && !summary ? (
                      <div className="indicadores-empty-box"><p>Carregando série diária...</p></div>
                    ) : (
                      <DailyChart rows={dailySeries} />
                    )
                  ) : zoneValuesErrorMessage ? (
                    <div className="indicadores-empty-box"><p>{zoneValuesErrorMessage}</p></div>
                  ) : loadingZoneValues ? (
                    <div className="indicadores-empty-box"><p>Carregando movimentações por zona...</p></div>
                  ) : (
                    <ZoneValueChart rows={zoneValueRows} movementFilter={movementFilter} onZoneClick={(row) => openZoneProducts(row.zona)} />
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {selectedZone && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay gestao-estq-zone-products-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gestao-estq-zone-products-title"
              onClick={closeZoneProducts}
            >
              <div className="gestao-estq-zone-products-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <div className="gestao-estq-fullscreen-head">
                  <div>
                    <h3 id="gestao-estq-zone-products-title">{`Produtos da zona ${selectedZone}`}</h3>
                    <span>
                      {`${displayCdName} · mês ${selectedMonthLabel} · data ${selectedDay === ALL_DAYS_VALUE ? "Todos" : formatDate(selectedDay)} · movimentação ${formatMovementLabel(movementFilter)}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="gestao-estq-fullscreen-close"
                    onClick={closeZoneProducts}
                    title="Fechar produtos da zona"
                    aria-label="Fechar produtos da zona"
                  >
                    {closeIcon()}
                  </button>
                </div>
                <div className="gestao-estq-zone-products-body">
                  {zoneProductsErrorMessage ? (
                    <div className="indicadores-empty-box"><p>{zoneProductsErrorMessage}</p></div>
                  ) : loadingZoneProducts ? (
                    <div className="indicadores-empty-box"><p>Carregando produtos da zona...</p></div>
                  ) : zoneProductRows.length === 0 ? (
                    <div className="indicadores-empty-box"><p>Nenhum produto encontrado para esta zona no filtro selecionado.</p></div>
                  ) : (
                    <div className="gestao-estq-details-wrap gestao-estq-zone-products-table-wrap">
                      <table className="gestao-estq-details-table gestao-estq-zone-products-table">
                        <thead>
                          <tr>
                            <th>Data</th>
                            <th>Produto</th>
                            <th>Tipo</th>
                            <th>Mov.</th>
                            <th>Natureza</th>
                            <th>Quantidade</th>
                            <th>Total (R$)</th>
                            <th>Responsável</th>
                            <th>Cargo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {zoneProductRows.map((row, index) => (
                            <AnimatedDetailRow
                              key={`${row.zona}:${row.data_mov}:${row.coddv}:${row.tipo_movimentacao}:${index}`}
                              row={row}
                              rowKey={`zone-products:${selectedZone}:${dashboardAnimationKey}:${row.data_mov}:${row.coddv}:${row.tipo_movimentacao}:${index}`}
                              delayMs={Math.min(index, 8) * 18}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {!isMobileAccordion && inventarioDialogOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay gestao-estq-report-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gestao-estq-inventario-title"
              onClick={closeInventarioDialog}
            >
              <div className="confirm-dialog surface-enter gestao-estq-report-dialog" onClick={(event) => event.stopPropagation()}>
                <h3 id="gestao-estq-inventario-title">Enviar para Inventário</h3>
                <p>{`${displayCdName} · apenas movimentações de Saída`}</p>

                <div className="gestao-estq-report-form">
                  <div className="gestao-estq-report-form-row">
                    <label>
                      <span>Data inicial</span>
                      <input
                        type="date"
                        value={inventarioDateStart}
                        onChange={(event) => setInventarioDateStart(event.target.value)}
                        disabled={inventarioBusy}
                      />
                    </label>
                    <label>
                      <span>Data final</span>
                      <input
                        type="date"
                        value={inventarioDateEnd}
                        onChange={(event) => setInventarioDateEnd(event.target.value)}
                        disabled={inventarioBusy}
                      />
                    </label>
                  </div>

                  <label>
                    <span>Estoque a considerar</span>
                    <select
                      value={inventarioStockType}
                      onChange={(event) => setInventarioStockType(event.target.value as InventarioStockTypeValue)}
                      disabled={inventarioBusy}
                    >
                      <option value="">Selecione</option>
                      <option value="disponivel">Disponível</option>
                      <option value="atual">Atual</option>
                    </select>
                  </label>

                  <label className="gestao-estq-inventario-check">
                    <input
                      className="gestao-estq-inventario-check-input"
                      type="checkbox"
                      checked={inventarioIncludePul}
                      onChange={(event) => setInventarioIncludePul(event.target.checked)}
                      disabled={inventarioBusy}
                    />
                    <span className="gestao-estq-inventario-check-control" aria-hidden="true" />
                    <span className="gestao-estq-inventario-check-label">Incluir endereço Pulmão</span>
                  </label>

                  {inventarioPreview ? (
                    <div className="gestao-estq-inventario-preview">
                      <strong>Prévia da auditoria</strong>
                      <div className="gestao-estq-inventario-preview-grid">
                        <p><span>Produtos</span><strong>{formatInteger(inventarioPreview.produtos_qtd)}</strong></p>
                        <p><span>Endereços</span><strong>{formatInteger(inventarioPreview.enderecos_qtd)}</strong></p>
                        <p><span>Itens</span><strong>{formatInteger(inventarioPreview.itens_qtd)}</strong></p>
                        <p><span>Zonas</span><strong>{formatInteger(inventarioPreview.zonas_qtd)}</strong></p>
                      </div>
                      <small>
                        {inventarioPreviewHasItems
                          ? `Estoque ${formatInventoryStockTypeLabel(inventarioStockType as IndicadoresGestaoEstoqueInventarioStockType)}${inventarioIncludePul ? " com Pulmão" : " sem Pulmão"}.`
                          : "Nenhum item elegível encontrado para os filtros informados."}
                      </small>
                    </div>
                  ) : null}

                  {inventarioErrorMessage ? <div className="module-inline-error">{inventarioErrorMessage}</div> : null}
                </div>

                <div className="confirm-actions">
                  <button className="btn btn-muted" type="button" onClick={() => void runInventarioPreview()} disabled={inventarioBusy}>
                    {inventarioBusy ? "Processando..." : "Gerar prévia"}
                  </button>
                  <button className="btn btn-primary" type="button" onClick={() => void applyInventarioSeed()} disabled={inventarioBusy || !inventarioPreviewHasItems}>
                    {inventarioBusy ? "Enviando..." : "Confirmar envio"}
                  </button>
                  <button className="btn btn-muted" type="button" onClick={closeInventarioDialog} disabled={inventarioBusy}>
                    Fechar
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {!isMobileAccordion && reportDialogOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay gestao-estq-report-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gestao-estq-report-title"
              onClick={closeReportDialog}
            >
              <div className="confirm-dialog surface-enter gestao-estq-report-dialog" onClick={(event) => event.stopPropagation()}>
                <h3 id="gestao-estq-report-title">Exportar relatório Excel</h3>
                <p>{`${displayCdName} · filtro ${formatMovementLabel(reportMovementFilter)}`}</p>

                <div className="gestao-estq-report-form">
                  <div className="gestao-estq-report-form-row">
                    <label>
                      <span>Data inicial</span>
                      <input
                        type="date"
                        value={reportDateStart}
                        onChange={(event) => setReportDateStart(event.target.value)}
                        disabled={reportBusy}
                      />
                    </label>
                    <label>
                      <span>Data final</span>
                      <input
                        type="date"
                        value={reportDateEnd}
                        onChange={(event) => setReportDateEnd(event.target.value)}
                        disabled={reportBusy}
                      />
                    </label>
                  </div>

                  <label>
                    <span>Movimentação</span>
                    <select
                      value={reportMovementFilter}
                      onChange={(event) => setReportMovementFilter(event.target.value as IndicadoresGestaoEstoqueMovementFilter)}
                      disabled={reportBusy}
                    >
                      <option value="todas">Todas</option>
                      <option value="entrada">Entrada</option>
                      <option value="saida">Saída</option>
                    </select>
                  </label>

                  {reportErrorMessage ? <div className="module-inline-error">{reportErrorMessage}</div> : null}
                </div>

                <div className="confirm-actions">
                  <button className="btn btn-primary" type="button" onClick={() => void exportReportXlsx()} disabled={reportBusy}>
                    {reportBusy ? "Gerando Excel..." : "Gerar Excel"}
                  </button>
                  <button className="btn btn-muted" type="button" onClick={closeReportDialog} disabled={reportBusy}>
                    Fechar
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
