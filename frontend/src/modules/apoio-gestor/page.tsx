import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import { todayIsoBrasilia } from "../../shared/brasilia-datetime";
import { READS_SILENT_REFRESH_INTERVAL_MS, shouldRunReadSilentRefresh } from "../../shared/offline/queue-policy";
import { fetchApoioGestorDailySummary, fetchApoioGestorDayFlags } from "./sync";
import type { ApoioGestorActivityRow, ApoioGestorDayFlags } from "./types";
import "./apoio-gestor.css";

interface ApoioGestorPageProps {
  isOnline: boolean;
  userName: string;
  cdName: string;
}

const BRAZIL_TZ = "America/Sao_Paulo";
const MODULE_DEF = getModuleByKeyOrThrow("apoio-gestor");
const REFRESH_INTERVAL_MS = READS_SILENT_REFRESH_INTERVAL_MS;
const COUNT_ANIMATION_DURATION_MS = 2400;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface OverviewMetrics {
  metaCount: number;
  criticalCount: number;
  warningCount: number;
  hitCount: number;
  exceededCount: number;
  totalActual: number;
}

function createEmptyOverviewMetrics(): OverviewMetrics {
  return {
    metaCount: 0,
    criticalCount: 0,
    warningCount: 0,
    hitCount: 0,
    exceededCount: 0,
    totalActual: 0,
  };
}

interface AnimatedRevealProps {
  revealKey: string;
  children: ReactNode;
  className?: string;
  delayMs?: number;
}

interface ViewportAnimatedActivityCardProps {
  row: ApoioGestorActivityRow;
  noMetaReason: string;
  prefersReducedMotion: boolean;
  delayMs?: number;
}

function formatFullDate(): string {
  const raw = new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRAZIL_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function parseCityFromCdLabel(cdLabel: string | null): string {
  if (!cdLabel) return "";
  const dashIdx = cdLabel.indexOf(" - ");
  if (dashIdx !== -1) return cdLabel.slice(dashIdx + 3).trim();
  return cdLabel.trim();
}

function parseCdNumber(cdLabel: string | null): number | null {
  if (!cdLabel) return null;
  const m = /cd\s*0*(\d+)/i.exec(cdLabel);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function toDisplayName(name: string): string {
  const compact = name.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function pctTone(pct: number | null): "success" | "exceeded" | "warning" | "danger" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 120) return "exceeded";
  if (pct >= 100) return "success";
  if (pct >= 70) return "warning";
  return "danger";
}

const ARC_COLOR: Record<string, string> = {
  success: "#4d8a6a",
  exceeded: "#1d4ed8",
  warning: "#b58542",
  danger: "#b16659",
  neutral: "#8f7d6b",
};

interface ArcGaugeProps {
  pct: number;
  tone: "success" | "exceeded" | "warning" | "danger" | "neutral";
}

function ArcGauge({ pct, tone }: ArcGaugeProps) {
  const normalizedPct = Math.max(0, pct);
  const innerPct = Math.min(normalizedPct, 100);
  const overflowPct = normalizedPct > 100 ? normalizedPct % 100 : 0;
  const overflowCycles = normalizedPct >= 200 ? Math.max(0, Math.floor(normalizedPct / 100) - 1) : 0;
  const innerRadius = 52;
  const overflowRadius = 64;
  const innerCircumference = 2 * Math.PI * innerRadius;
  const overflowCircumference = 2 * Math.PI * overflowRadius;
  const innerOffset = innerCircumference * (1 - innerPct / 100);
  const overflowOffset = overflowCircumference * (1 - overflowPct / 100);
  const arcColor = ARC_COLOR[tone];

  return (
    <>
      <svg width="164" height="164" viewBox="0 0 164 164" aria-hidden="true">
        <circle
          cx="82"
          cy="82"
          r={overflowRadius}
          fill="none"
          className={`ag-card__gauge-overflow-track${normalizedPct > 100 ? " is-visible" : ""}`}
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle
          cx="82"
          cy="82"
          r={overflowRadius}
          fill="none"
          className={`ag-card__gauge-overflow-fill${normalizedPct > 100 ? " is-visible" : ""}`}
          strokeWidth="5"
          strokeLinecap="round"
          stroke={arcColor}
          strokeDasharray={`${overflowCircumference}`}
          strokeDashoffset={`${overflowOffset}`}
          transform="rotate(-90 82 82)"
        />
        <circle
          cx="82"
          cy="82"
          r={innerRadius}
          fill="none"
          className="ag-card__gauge-arc--track"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <circle
          cx="82"
          cy="82"
          r={innerRadius}
          fill="none"
          className="ag-card__gauge-arc--fill"
          strokeWidth="12"
          strokeLinecap="round"
          stroke={arcColor}
          strokeDasharray={`${innerCircumference}`}
          strokeDashoffset={`${innerOffset}`}
          transform="rotate(-90 82 82)"
        />
      </svg>
      {overflowCycles > 0 && (
        <span className={`ag-card__gauge-overflow-chip ag-card__gauge-overflow-chip--${tone}`}>
          +{overflowCycles}x
        </span>
      )}
    </>
  );
}

interface ActivityCardProps {
  row: ApoioGestorActivityRow;
  noMetaReason: string;
  displayedActual: number;
  displayedPct: number | null;
  showFinalMetaTone: boolean;
}

function formatMetric(value: number): string {
  return value.toLocaleString("pt-BR");
}

function bigNumberSizeClass(value: number): string {
  const textLength = formatMetric(value).length;
  if (textLength >= 12) return "ag-card__big-number--dense";
  if (textLength >= 9) return "ag-card__big-number--compact";
  return "";
}

function formatMonitoringLabel(count: number): string {
  return `${count} ${count === 1 ? "ind. com meta definida" : "inds. com metas definidas"}`;
}

function shouldAnimateCount(value: number): boolean {
  return value > 0;
}

function shouldAnimatePct(value: number | null): value is number {
  return value !== null && value > 0;
}

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function animatedCountValue(target: number, easedProgress: number): number {
  if (!shouldAnimateCount(target)) return target;
  return Math.min(target, Math.round(target * easedProgress));
}

function animatedPctValue(target: number | null, easedProgress: number): number | null {
  if (target === null) return null;
  if (!shouldAnimatePct(target)) return target;
  return Math.min(target, Math.round(target * easedProgress * 10) / 10);
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}%`;
}

function pctSizeClass(value: number | null): string {
  const textLength = formatPct(value).length;
  if (textLength >= 7) return "ag-card__pct--dense";
  if (textLength >= 6) return "ag-card__pct--compact";
  return "";
}

function revealStyle(delayMs: number): CSSProperties {
  return { ["--ag-reveal-delay" as string]: `${delayMs}ms` };
}

function dayStatusLabel(flags: ApoioGestorDayFlags): string | null {
  if (flags.is_holiday) return "Feriado";
  if (flags.is_sunday) return "Domingo";
  return null;
}

function tonePriority(tone: ReturnType<typeof pctTone>): number {
  if (tone === "danger") return 0;
  if (tone === "warning") return 1;
  if (tone === "success") return 2;
  if (tone === "exceeded") return 3;
  return 4;
}

function describeDelta(row: ApoioGestorActivityRow, tone: ReturnType<typeof pctTone>): string {
  if (row.target_today == null) return "Sem meta configurada para hoje";
  const diff = row.actual_today - row.target_today;
  if (tone === "danger" || tone === "warning") {
    return `Faltam ${formatMetric(Math.max(0, Math.abs(diff)))} ${row.unit_label.toLowerCase()}`;
  }
  if (tone === "success") {
    return "Meta batida dentro da faixa esperada";
  }
  if (tone === "exceeded") {
    return `Acima ${formatMetric(Math.max(0, diff))} ${row.unit_label.toLowerCase()}`;
  }
  return "Sem percentual calculado";
}

function toneSummaryLabel(tone: ReturnType<typeof pctTone>): string {
  if (tone === "danger") return "Prioridade alta";
  if (tone === "warning") return "Atenção";
  if (tone === "success") return "Meta batida";
  if (tone === "exceeded") return "Meta superada";
  return "Sem meta";
}

function AnimatedReveal({ revealKey, children, className = "", delayMs = 0 }: AnimatedRevealProps) {
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
        threshold: 0.01,
        rootMargin: "0px 0px 18% 0px",
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [revealKey, visible]);

  return (
    <div
      ref={ref}
      className={`${className} ag-reveal${visible ? " is-visible" : ""}`.trim()}
      style={revealStyle(delayMs)}
    >
      {children}
    </div>
  );
}

function ActivityCard({ row, noMetaReason, displayedActual, displayedPct, showFinalMetaTone }: ActivityCardProps) {
  const tone = pctTone(row.achievement_pct);
  const pctDisplay = formatPct(displayedPct);
  const visualTone = showFinalMetaTone ? tone : "neutral";
  const cardToneClass = row.has_meta ? `ag-card--${visualTone}` : "";
  const deltaLabel = describeDelta(row, tone);
  const toneSummary = showFinalMetaTone ? toneSummaryLabel(tone) : "Indicador em apuração";
  const bigNumberClass = bigNumberSizeClass(displayedActual);
  const pctDensityClass = pctSizeClass(displayedPct);

  const badgeLabel =
    !showFinalMetaTone
      ? "Apurando"
      : tone === "success"
      ? "Meta atingida"
      : tone === "exceeded"
      ? "Meta superada"
      : tone === "warning"
      ? "Em andamento"
      : tone === "danger"
      ? "Abaixo da meta"
      : null;

  if (row.has_meta) {
    return (
      <div className={`ag-card ag-card--meta ${cardToneClass} ${showFinalMetaTone ? "" : "ag-card--neutral-state"}`.trim()}>
        <div className={`ag-card__topbar ag-card__topbar--${visualTone}`}>
          <div className="ag-card__title-wrap">
            <span className="ag-card__label">{row.activity_label}</span>
            <span className="ag-card__summary">{toneSummary}</span>
          </div>
          {badgeLabel && (
            <span className={`ag-card__badge ag-card__badge--${visualTone}`}>{badgeLabel}</span>
          )}
        </div>
        <div className="ag-card__body">
          <div className="ag-card__gauge-panel">
            <div className="ag-card__gauge">
              <ArcGauge pct={displayedPct ?? 0} tone={visualTone} />
              <div className={`ag-card__pct ag-card__pct--${visualTone} ${pctDensityClass}`.trim()}>{pctDisplay}</div>
            </div>
          </div>
          <div className="ag-card__metrics">
            <div className="ag-card__metric">
              <span className="ag-card__metric-label">Produzido hoje</span>
              <strong className="ag-card__actual">{formatMetric(displayedActual)}</strong>
            </div>
            <div className="ag-card__metric">
              <span className="ag-card__metric-label">Meta do dia</span>
              <strong className="ag-card__target-value">
                {row.target_today != null ? formatMetric(row.target_today) : "—"}
              </strong>
            </div>
            <div className={`ag-card__signal ag-card__signal--${visualTone}`}>{deltaLabel}</div>
            <div className="ag-card__unit-row">{row.unit_label}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ag-card ag-card--simple">
      <div className="ag-card__topbar ag-card__topbar--simple">
        <div className="ag-card__title-wrap">
          <span className="ag-card__label">{row.activity_label}</span>
          <span className="ag-card__summary">Monitoramento livre</span>
        </div>
        <span className="ag-card__badge ag-card__badge--simple">Sem meta</span>
      </div>
      <div className="ag-card__body ag-card__body--simple">
        <div className={`ag-card__big-number ${bigNumberClass}`.trim()}>
          {formatMetric(displayedActual)}
        </div>
        <div className="ag-card__unit-label">{row.unit_label}</div>
        <div className="ag-card__simple-caption">{noMetaReason}</div>
      </div>
    </div>
  );
}

function ViewportAnimatedActivityCard({
  row,
  noMetaReason,
  prefersReducedMotion,
  delayMs = 0,
}: ViewportAnimatedActivityCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(prefersReducedMotion);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(prefersReducedMotion);
  const [hasCompletedAnimation, setHasCompletedAnimation] = useState(prefersReducedMotion);
  const [displayedActual, setDisplayedActual] = useState(
    prefersReducedMotion
      ? row.actual_today
      : shouldAnimateCount(row.actual_today)
      ? 0
      : row.actual_today
  );
  const [displayedPct, setDisplayedPct] = useState<number | null>(
    prefersReducedMotion
      ? row.achievement_pct
      : shouldAnimatePct(row.achievement_pct)
      ? 0
      : row.achievement_pct
  );

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      setVisible(true);
      setHasEnteredViewport(true);
      setHasCompletedAnimation(true);
      setDisplayedActual(row.actual_today);
      setDisplayedPct(row.achievement_pct);
      return;
    }

    if (hasCompletedAnimation) {
      setDisplayedActual(row.actual_today);
      setDisplayedPct(row.achievement_pct);
    }
  }, [
    hasCompletedAnimation,
    prefersReducedMotion,
    row.achievement_pct,
    row.actual_today,
  ]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const node = ref.current;
    if (!node) return;
    if (hasEnteredViewport) return;
    if (typeof window === "undefined" || typeof window.IntersectionObserver === "undefined") {
      setVisible(true);
      setHasEnteredViewport(true);
      return;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          setHasEnteredViewport(true);
          observer.disconnect();
        }
      },
      {
        threshold: 0.01,
        rootMargin: "0px 0px 18% 0px",
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasEnteredViewport, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (!hasEnteredViewport) return;
    if (hasCompletedAnimation) return;

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const shouldAnimateActual = shouldAnimateCount(row.actual_today);
    const shouldAnimatePercent = shouldAnimatePct(row.achievement_pct);

    if (!shouldAnimateActual && !shouldAnimatePercent) {
      setDisplayedActual(row.actual_today);
      setDisplayedPct(row.achievement_pct);
      setHasCompletedAnimation(true);
      return;
    }

    setDisplayedActual(shouldAnimateActual ? 0 : row.actual_today);
    setDisplayedPct(shouldAnimatePercent ? 0 : row.achievement_pct);

    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / COUNT_ANIMATION_DURATION_MS);
      const easedProgress = easeOutCubic(progress);

      setDisplayedActual(animatedCountValue(row.actual_today, easedProgress));
      setDisplayedPct(animatedPctValue(row.achievement_pct, easedProgress));

      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      animationFrameRef.current = null;
      setHasCompletedAnimation(true);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [
    hasCompletedAnimation,
    hasEnteredViewport,
    prefersReducedMotion,
    row.achievement_pct,
    row.actual_today,
  ]);

  const showFinalMetaTone =
    prefersReducedMotion ||
    hasCompletedAnimation ||
    (!shouldAnimateCount(row.actual_today) && !shouldAnimatePct(row.achievement_pct));

  return (
    <div
      ref={ref}
      className={`ag-reveal ag-reveal--card${visible ? " is-visible" : ""}`}
      style={revealStyle(delayMs)}
    >
      <ActivityCard
        row={row}
        noMetaReason={noMetaReason}
        displayedActual={displayedActual}
        displayedPct={displayedPct}
        showFinalMetaTone={showFinalMetaTone}
      />
    </div>
  );
}

export default function ApoioGestorPage({
  isOnline,
  userName,
  cdName,
}: ApoioGestorPageProps) {
  const [rows, setRows] = useState<ApoioGestorActivityRow[]>([]);
  const [dayFlags, setDayFlags] = useState<ApoioGestorDayFlags>({
    meta_defined_count: 0,
    is_holiday: false,
    is_sunday: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [animatedOverview, setAnimatedOverview] = useState<OverviewMetrics>(createEmptyOverviewMetrics);
  const [hasAnimatedOverviewIntro, setHasAnimatedOverviewIntro] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(REDUCED_MOTION_QUERY).matches
      : false
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLoadAtRef = useRef(0);
  const overviewAnimationFrameRef = useRef<number | null>(null);

  const cd = parseCdNumber(cdName);
  const today = todayIsoBrasilia();
  const fullDate = formatFullDate();

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };
    setPrefersReducedMotion(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  const load = useCallback(async () => {
    lastLoadAtRef.current = Date.now();
    if (cd === null) {
      setError("CD não identificado. Verifique seu perfil.");
      setLoading(false);
      return;
    }
    try {
      const [data, flags] = await Promise.all([
        fetchApoioGestorDailySummary(cd, today),
        fetchApoioGestorDayFlags(cd, today),
      ]);
      setRows(data);
      setDayFlags(flags);
      setError(null);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, [cd, today]);

  const requestSilentLoad = useCallback(() => {
    if (!shouldRunReadSilentRefresh({
      isOnline,
      visibilityState: typeof document === "undefined" ? "visible" : document.visibilityState,
      lastRefreshAt: lastLoadAtRef.current
    })) {
      return;
    }
    void load();
  }, [isOnline, load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isOnline) return;
    const handleFocus = () => {
      requestSilentLoad();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestSilentLoad();
      }
    };
    intervalRef.current = setInterval(() => requestSilentLoad(), REFRESH_INTERVAL_MS);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isOnline, requestSilentLoad]);

  const metaRows = [...rows]
    .filter((r) => r.has_meta)
    .sort((a, b) => {
      const toneDiff = tonePriority(pctTone(a.achievement_pct)) - tonePriority(pctTone(b.achievement_pct));
      if (toneDiff !== 0) return toneDiff;
      const pctA = a.achievement_pct ?? -1;
      const pctB = b.achievement_pct ?? -1;
      if (pctA !== pctB) return pctA - pctB;
      return a.activity_label.localeCompare(b.activity_label, "pt-BR");
    });
  const simpleRows = rows
    .filter((r) => !r.has_meta)
    .sort((a, b) => a.activity_label.localeCompare(b.activity_label, "pt-BR"));
  const criticalCount = metaRows.filter((row) => pctTone(row.achievement_pct) === "danger").length;
  const warningCount = metaRows.filter((row) => pctTone(row.achievement_pct) === "warning").length;
  const hitCount = metaRows.filter((row) => pctTone(row.achievement_pct) === "success").length;
  const exceededCount = metaRows.filter((row) => pctTone(row.achievement_pct) === "exceeded").length;
  const totalActual = rows.reduce((sum, row) => sum + row.actual_today, 0);
  const currentDayStatus = dayStatusLabel(dayFlags);
  const noMetaReason = currentDayStatus
    ? `Dia classificado como ${currentDayStatus.toLowerCase()} no Meta Mês`
    : "Sem meta configurada para hoje";
  const overviewMetrics: OverviewMetrics = {
    metaCount: metaRows.length,
    criticalCount,
    warningCount,
    hitCount,
    exceededCount,
    totalActual,
  };
  const isOverviewAnimationActive =
    !loading && error === null && !hasAnimatedOverviewIntro && !prefersReducedMotion;

  useEffect(() => {
    return () => {
      if (overviewAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(overviewAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (loading || error !== null) return;

    if (overviewAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(overviewAnimationFrameRef.current);
      overviewAnimationFrameRef.current = null;
    }

    if (prefersReducedMotion) {
      setHasAnimatedOverviewIntro(true);
      return;
    }

    if (hasAnimatedOverviewIntro) {
      return;
    }

    const hasAnyAnimatedValue =
      shouldAnimateCount(overviewMetrics.metaCount) ||
      shouldAnimateCount(overviewMetrics.criticalCount) ||
      shouldAnimateCount(overviewMetrics.warningCount) ||
      shouldAnimateCount(overviewMetrics.hitCount) ||
      shouldAnimateCount(overviewMetrics.exceededCount) ||
      shouldAnimateCount(overviewMetrics.totalActual);

    if (!hasAnyAnimatedValue) {
      setHasAnimatedOverviewIntro(true);
      return;
    }

    setAnimatedOverview(createEmptyOverviewMetrics());

    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / COUNT_ANIMATION_DURATION_MS);
      const easedProgress = easeOutCubic(progress);

      setAnimatedOverview({
        metaCount: animatedCountValue(overviewMetrics.metaCount, easedProgress),
        criticalCount: animatedCountValue(overviewMetrics.criticalCount, easedProgress),
        warningCount: animatedCountValue(overviewMetrics.warningCount, easedProgress),
        hitCount: animatedCountValue(overviewMetrics.hitCount, easedProgress),
        exceededCount: animatedCountValue(overviewMetrics.exceededCount, easedProgress),
        totalActual: animatedCountValue(overviewMetrics.totalActual, easedProgress),
      });

      if (progress < 1) {
        overviewAnimationFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      overviewAnimationFrameRef.current = null;
      setHasAnimatedOverviewIntro(true);
    };

    overviewAnimationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (overviewAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(overviewAnimationFrameRef.current);
        overviewAnimationFrameRef.current = null;
      }
    };
  }, [
    error,
    hasAnimatedOverviewIntro,
    loading,
    overviewMetrics.criticalCount,
    overviewMetrics.exceededCount,
    overviewMetrics.hitCount,
    overviewMetrics.metaCount,
    overviewMetrics.totalActual,
    overviewMetrics.warningCount,
    prefersReducedMotion,
  ]);

  return (
    <div className="ag-page">
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
            <span className="module-back-icon" aria-hidden="true"><BackIcon /></span>
            <span>Início</span>
          </Link>
          <div className="module-topbar-user-side">
            <span className="module-user-greeting">Olá, {toDisplayName(userName)}</span>
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
              {isOnline ? "🟢 Online" : "🔴 Offline"}
            </span>
          </div>
        </div>
        <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
          <span className="module-icon" aria-hidden="true"><ModuleIcon name={MODULE_DEF.icon} /></span>
          <span className="module-title">{MODULE_DEF.title}</span>
        </div>
      </header>

      <div className="ag-content-shell">
        <AnimatedReveal revealKey="apoio-gestor-header" className="ag-reveal--hero">
        <section className="ag-header">
          <div className="ag-header__main">
            <div className="ag-header__title-block">
              <span className="ag-header__eyebrow">Painel operacional do dia</span>
              <div className="ag-header__cd">{parseCityFromCdLabel(cdName) || cdName || "CD"}</div>
              <div className="ag-header__date-row">
                <div className="ag-header__date">{fullDate}</div>
                {currentDayStatus && (
                  <span className="ag-header__day-status">{currentDayStatus}</span>
                )}
              </div>
            </div>
            <div className="ag-header__info-grid">
              <div className="ag-header__info-card">
                <span className="ag-header__info-label">Monitoramento</span>
                <strong className="ag-header__info-value">{formatMonitoringLabel(dayFlags.meta_defined_count)}</strong>
                <span className="ag-header__info-subvalue">Painel priorizado por urgência</span>
              </div>
              {lastRefresh && (
                <div className="ag-header__info-card ag-header__info-card--refresh">
                  <span className="ag-header__info-label">Atualizado às</span>
                  <strong className="ag-header__info-value">
                    {lastRefresh.toLocaleTimeString("pt-BR", {
                      timeZone: BRAZIL_TZ,
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </strong>
                  <span className="ag-header__info-subvalue">Leitura do dia em tempo real</span>
                </div>
              )}
            </div>
          </div>
        </section>
        </AnimatedReveal>

              <AnimatedReveal revealKey="apoio-gestor-overview" className="ag-reveal--overview" delayMs={60}>
        <section className="ag-overview">
          <article className="ag-overview__card ag-overview__card--strong">
            <span className="ag-overview__label">Com meta hoje</span>
            <strong className="ag-overview__value">
              {isOverviewAnimationActive ? animatedOverview.metaCount : overviewMetrics.metaCount}
            </strong>
            <span className="ag-overview__hint">Indicadores ativos no Meta Mês</span>
          </article>
          <article className="ag-overview__card ag-overview__card--danger">
            <span className="ag-overview__label">Abaixo da meta</span>
            <strong className="ag-overview__value">
              {isOverviewAnimationActive ? animatedOverview.criticalCount : overviewMetrics.criticalCount}
            </strong>
            <span className="ag-overview__hint">Precisam de ação primeiro</span>
          </article>
          <article className="ag-overview__card ag-overview__card--warning">
            <span className="ag-overview__label">Em andamento</span>
            <strong className="ag-overview__value">
              {isOverviewAnimationActive ? animatedOverview.warningCount : overviewMetrics.warningCount}
            </strong>
            <span className="ag-overview__hint">Ainda abaixo da faixa ideal</span>
          </article>
          <article className="ag-overview__card ag-overview__card--accent">
            <span className="ag-overview__label">Meta batida</span>
            <strong className="ag-overview__value">
              {isOverviewAnimationActive ? animatedOverview.hitCount : overviewMetrics.hitCount}
            </strong>
            <span className="ag-overview__hint">Faixa de 100% a 119%</span>
          </article>
          <article className="ag-overview__card ag-overview__card--info">
            <span className="ag-overview__label">Meta superada</span>
            <strong className="ag-overview__value">
              {isOverviewAnimationActive ? animatedOverview.exceededCount : overviewMetrics.exceededCount}
            </strong>
            <span className="ag-overview__hint">Acima de 120%</span>
          </article>
          <article className="ag-overview__card">
            <span className="ag-overview__label">Volume do dia</span>
            <strong className="ag-overview__value">
              {formatMetric(isOverviewAnimationActive ? animatedOverview.totalActual : overviewMetrics.totalActual)}
            </strong>
            <span className="ag-overview__hint">Soma de todas as atividades</span>
          </article>
        </section>
        </AnimatedReveal>

        {loading ? (
          <div className="ag-state ag-state--loading">
            <div className="ag-spinner" />
            <span>Carregando atividades...</span>
          </div>
        ) : error ? (
          <div className="ag-state ag-state--error">
            <span>{error}</span>
            <button type="button" className="ag-retry-btn" onClick={() => void load()}>
              Tentar novamente
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="ag-state ag-state--empty">
            Nenhuma atividade registrada hoje.
          </div>
        ) : (
          <div className="ag-content">
            {metaRows.length > 0 && (
              <AnimatedReveal revealKey="apoio-gestor-meta-section" className="ag-reveal--section" delayMs={120}>
              <section className="ag-section">
                <div className="ag-section__header">
                  <h2 className="ag-section__title">Atividades com Meta</h2>
                  <span className="ag-section__count">{metaRows.length} cards</span>
                </div>
                <div className="ag-grid">
                  {metaRows.map((r, index) => (
                    <ViewportAnimatedActivityCard
                      key={r.activity_key}
                      row={r}
                      noMetaReason={noMetaReason}
                      prefersReducedMotion={prefersReducedMotion}
                      delayMs={160 + Math.min(index, 7) * 48}
                    />
                  ))}
                </div>
              </section>
              </AnimatedReveal>
            )}
            {simpleRows.length > 0 && (
              <AnimatedReveal revealKey="apoio-gestor-simple-section" className="ag-reveal--section" delayMs={180}>
              <section className="ag-section">
                <div className="ag-section__header">
                  <h2 className="ag-section__title">Outras Atividades</h2>
                  <span className="ag-section__count">{simpleRows.length} cards</span>
                </div>
                <div className="ag-grid">
                  {simpleRows.map((r, index) => (
                    <ViewportAnimatedActivityCard
                      key={r.activity_key}
                      row={r}
                      noMetaReason={noMetaReason}
                      prefersReducedMotion={prefersReducedMotion}
                      delayMs={220 + Math.min(index, 7) * 42}
                    />
                  ))}
                </div>
              </section>
              </AnimatedReveal>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
