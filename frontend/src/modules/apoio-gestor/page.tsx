import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import { todayIsoBrasilia } from "../../shared/brasilia-datetime";
import { fetchApoioGestorDailySummary } from "./sync";
import type { ApoioGestorActivityRow } from "./types";
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

function toFirstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function pctTone(pct: number | null): "success" | "warning" | "danger" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 100) return "success";
  if (pct >= 70) return "warning";
  return "danger";
}

const ARC_COLOR: Record<string, string> = {
  success: "#16a34a",
  warning: "#d97706",
  danger: "#dc2626",
  neutral: "#64748b",
};

interface ArcGaugeProps {
  pct: number;
  tone: "success" | "warning" | "danger" | "neutral";
}

function ArcGauge({ pct, tone }: ArcGaugeProps) {
  const clamped = Math.min(pct, 100);
  const r = 44;
  const circumference = Math.PI * r;
  const offset = circumference * (1 - clamped / 100);
  const arcColor = ARC_COLOR[tone];
  const arcPath = "M 16 60 A 44 44 0 0 1 104 60";

  return (
    <svg width="120" height="70" viewBox="0 0 120 70" aria-hidden="true">
      <path
        d={arcPath}
        fill="none"
        className="ag-card__gauge-arc--track"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <path
        d={arcPath}
        fill="none"
        className="ag-card__gauge-arc--fill"
        strokeWidth="10"
        strokeLinecap="round"
        stroke={arcColor}
        strokeDasharray={`${circumference}`}
        strokeDashoffset={`${offset}`}
      />
    </svg>
  );
}

interface ActivityCardProps {
  row: ApoioGestorActivityRow;
}

function ActivityCard({ row }: ActivityCardProps) {
  const tone = pctTone(row.achievement_pct);
  const pctDisplay =
    row.achievement_pct !== null ? `${row.achievement_pct.toFixed(1)}%` : "—";

  const badgeLabel =
    tone === "success"
      ? "Meta atingida"
      : tone === "warning"
      ? "Em andamento"
      : tone === "danger"
      ? "Abaixo da meta"
      : null;

  if (row.has_meta) {
    return (
      <div className="ag-card ag-card--meta">
        <div className="ag-card__label">{row.activity_label}</div>
        <div className="ag-card__gauge">
          <ArcGauge pct={row.achievement_pct ?? 0} tone={tone} />
          <div className={`ag-card__pct ag-card__pct--${tone}`}>{pctDisplay}</div>
        </div>
        <div className="ag-card__counts">
          <span className="ag-card__actual">
            {row.actual_today.toLocaleString("pt-BR")}
          </span>
          {row.target_today !== null && (
            <span className="ag-card__target">
              {" "}/ {row.target_today.toLocaleString("pt-BR")}
            </span>
          )}
          <span className="ag-card__unit"> {row.unit_label}</span>
        </div>
        {badgeLabel && (
          <div className={`ag-card__badge ag-card__badge--${tone}`}>{badgeLabel}</div>
        )}
      </div>
    );
  }

  return (
    <div className="ag-card ag-card--simple">
      <div className="ag-card__label">{row.activity_label}</div>
      <div className="ag-card__big-number">
        {row.actual_today.toLocaleString("pt-BR")}
      </div>
      <div className="ag-card__unit-label">{row.unit_label}</div>
    </div>
  );
}

export default function ApoioGestorPage({
  isOnline,
  userName,
  cdName,
}: ApoioGestorPageProps) {
  const [rows, setRows] = useState<ApoioGestorActivityRow[]>([]);
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
      const data = await fetchApoioGestorDailySummary(cd, today);
      setRows(data);
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

  const metaRows = rows.filter((r) => r.has_meta);
  const simpleRows = rows.filter((r) => !r.has_meta);

  return (
    <div className="ag-page">
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
            <span className="module-back-icon" aria-hidden="true"><BackIcon /></span>
            <span>Início</span>
          </Link>
          <div className="module-topbar-user-side">
            <span className="module-user-greeting">Olá, {toFirstName(userName)}</span>
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

      <div className="ag-header">
        <div className="ag-header__cd">{parseCityFromCdLabel(cdName) || cdName || "CD"}</div>
        <div className="ag-header__date">{fullDate}</div>
        {lastRefresh && (
          <div className="ag-header__refresh">
            Atualizado às{" "}
            {lastRefresh.toLocaleTimeString("pt-BR", {
              timeZone: BRAZIL_TZ,
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        )}
      </div>

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
              <h2 className="ag-section__title">Atividades com Meta</h2>
              <div className="ag-grid">
                {metaRows.map((r) => (
                  <ActivityCard key={r.activity_key} row={r} />
                ))}
              </div>
            </section>
          )}
          {simpleRows.length > 0 && (
            <section className="ag-section">
              <h2 className="ag-section__title">Outras Atividades</h2>
              <div className="ag-grid">
                {simpleRows.map((r) => (
                  <ActivityCard key={r.activity_key} row={r} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
