import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import { todayIsoBrasilia } from "../../shared/brasilia-datetime";
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
const REFRESH_INTERVAL_MS = 60_000;

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
  const clamped = Math.min(pct, 100);
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped / 100);
  const arcColor = ARC_COLOR[tone];

  return (
    <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
      <circle
        cx="66"
        cy="66"
        r={r}
        fill="none"
        className="ag-card__gauge-arc--track"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <circle
        cx="66"
        cy="66"
        r={r}
        fill="none"
        className="ag-card__gauge-arc--fill"
        strokeWidth="14"
        strokeLinecap="round"
        stroke={arcColor}
        strokeDasharray={`${circumference}`}
        strokeDashoffset={`${offset}`}
        transform="rotate(-90 66 66)"
      />
    </svg>
  );
}

interface ActivityCardProps {
  row: ApoioGestorActivityRow;
  noMetaReason: string;
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

function ActivityCard({ row, noMetaReason }: ActivityCardProps) {
  const tone = pctTone(row.achievement_pct);
  const pctDisplay =
    row.achievement_pct !== null ? `${row.achievement_pct.toFixed(1)}%` : "—";
  const cardToneClass = row.has_meta ? `ag-card--${tone}` : "";
  const deltaLabel = describeDelta(row, tone);
  const toneSummary = toneSummaryLabel(tone);
  const bigNumberClass = bigNumberSizeClass(row.actual_today);

  const badgeLabel =
    tone === "success"
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
      <div className={`ag-card ag-card--meta ${cardToneClass}`}>
        <div className={`ag-card__topbar ag-card__topbar--${tone}`}>
          <div className="ag-card__title-wrap">
            <span className="ag-card__label">{row.activity_label}</span>
            <span className="ag-card__summary">{toneSummary}</span>
          </div>
          {badgeLabel && (
            <span className={`ag-card__badge ag-card__badge--${tone}`}>{badgeLabel}</span>
          )}
        </div>
        <div className="ag-card__body">
          <div className="ag-card__gauge-panel">
            <div className="ag-card__gauge">
              <ArcGauge pct={row.achievement_pct ?? 0} tone={tone} />
              <div className={`ag-card__pct ag-card__pct--${tone}`}>{pctDisplay}</div>
            </div>
          </div>
          <div className="ag-card__metrics">
            <div className="ag-card__metric">
              <span className="ag-card__metric-label">Produzido hoje</span>
              <strong className="ag-card__actual">{formatMetric(row.actual_today)}</strong>
            </div>
            <div className="ag-card__metric">
              <span className="ag-card__metric-label">Meta do dia</span>
              <strong className="ag-card__target-value">
                {row.target_today != null ? formatMetric(row.target_today) : "—"}
              </strong>
            </div>
            <div className={`ag-card__signal ag-card__signal--${tone}`}>{deltaLabel}</div>
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
          {formatMetric(row.actual_today)}
        </div>
        <div className="ag-card__unit-label">{row.unit_label}</div>
        <div className="ag-card__simple-caption">{noMetaReason}</div>
      </div>
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cd = parseCdNumber(cdName);
  const today = todayIsoBrasilia();
  const fullDate = formatFullDate();

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const load = useCallback(async () => {
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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isOnline) return;
    intervalRef.current = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isOnline, load]);

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

        <section className="ag-overview">
          <article className="ag-overview__card ag-overview__card--strong">
            <span className="ag-overview__label">Com meta hoje</span>
            <strong className="ag-overview__value">{metaRows.length}</strong>
            <span className="ag-overview__hint">Indicadores ativos no Meta Mês</span>
          </article>
          <article className="ag-overview__card ag-overview__card--danger">
            <span className="ag-overview__label">Abaixo da meta</span>
            <strong className="ag-overview__value">{criticalCount}</strong>
            <span className="ag-overview__hint">Precisam de ação primeiro</span>
          </article>
          <article className="ag-overview__card ag-overview__card--warning">
            <span className="ag-overview__label">Em andamento</span>
            <strong className="ag-overview__value">{warningCount}</strong>
            <span className="ag-overview__hint">Ainda abaixo da faixa ideal</span>
          </article>
          <article className="ag-overview__card ag-overview__card--accent">
            <span className="ag-overview__label">Meta batida</span>
            <strong className="ag-overview__value">{hitCount}</strong>
            <span className="ag-overview__hint">Faixa de 100% a 119%</span>
          </article>
          <article className="ag-overview__card ag-overview__card--info">
            <span className="ag-overview__label">Meta superada</span>
            <strong className="ag-overview__value">{exceededCount}</strong>
            <span className="ag-overview__hint">Acima de 120%</span>
          </article>
          <article className="ag-overview__card">
            <span className="ag-overview__label">Volume do dia</span>
            <strong className="ag-overview__value">{formatMetric(totalActual)}</strong>
            <span className="ag-overview__hint">Soma de todas as atividades</span>
          </article>
        </section>

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
              <section className="ag-section">
                <div className="ag-section__header">
                  <h2 className="ag-section__title">Atividades com Meta</h2>
                  <span className="ag-section__count">{metaRows.length} cards</span>
                </div>
                <div className="ag-grid">
                  {metaRows.map((r) => (
                    <ActivityCard key={r.activity_key} row={r} noMetaReason={noMetaReason} />
                  ))}
                </div>
              </section>
            )}
            {simpleRows.length > 0 && (
              <section className="ag-section">
                <div className="ag-section__header">
                  <h2 className="ag-section__title">Outras Atividades</h2>
                  <span className="ag-section__count">{simpleRows.length} cards</span>
                </div>
                <div className="ag-grid">
                  {simpleRows.map((r) => (
                    <ActivityCard key={r.activity_key} row={r} noMetaReason={noMetaReason} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
