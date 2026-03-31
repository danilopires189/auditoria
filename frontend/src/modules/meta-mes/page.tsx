import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import pmImage from "../../../assets/pm.png";
import { BackIcon, HolidayIcon, ModuleIcon } from "../../ui/icons";
import { formatDateOnlyPtBR, formatDateTimeBrasilia, monthStartIsoBrasilia } from "../../shared/brasilia-datetime";
import { getModuleByKeyOrThrow } from "../registry";
import {
  fetchMetaMesActivities,
  fetchMetaMesDailyRows,
  fetchMetaMesMonthOptions,
  fetchMetaMesSummary,
  setMetaMesDailyTarget,
  setMetaMesHoliday
} from "./sync";
import type {
  MetaMesActivityOption,
  MetaMesDailyRow,
  MetaMesModuleProfile,
  MetaMesMonthOption,
  MetaMesSummary,
  MetaMesValueMode
} from "./types";

interface MetaMesPageProps {
  isOnline: boolean;
  profile: MetaMesModuleProfile;
}

interface MetricCardDefinition {
  label: string;
  value: string;
  accent?: "success" | "danger" | "warning" | "neutral";
}

const MODULE_DEF = getModuleByKeyOrThrow("meta-mes");
const COMPACT_FORMATTER = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1
});

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: MetaMesModuleProfile): number | null {
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

function resolveCdDisplayName(profile: MetaMesModuleProfile, activeCd: number | null): string {
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

function formatMetricValue(value: number, mode: MetaMesValueMode): string {
  const safe = Number.isFinite(value) ? value : 0;
  if (mode === "currency") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(safe);
  }

  if (mode === "decimal") {
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3
    }).format(safe);
  }

  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 0
  }).format(Math.round(safe));
}

function formatCompactValue(value: number, mode: MetaMesValueMode): string {
  const safe = Number.isFinite(value) ? value : 0;
  if (mode === "currency") return `R$ ${COMPACT_FORMATTER.format(safe)}`;
  return COMPACT_FORMATTER.format(safe);
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value)}%`;
}

function formatBalance(value: number, mode: MetaMesValueMode): string {
  if (!Number.isFinite(value) || value === 0) return formatMetricValue(0, mode);
  const signal = value > 0 ? "+" : "";
  return `${signal}${formatMetricValue(value, mode)}`;
}

function normalizeDraftValue(raw: string): string {
  const compact = raw.trim().replace(",", ".");
  if (!compact) return "";
  const parsed = Number.parseFloat(compact);
  if (!Number.isFinite(parsed)) return raw.trim();
  return String(parsed);
}

function serializeRowTarget(row: MetaMesDailyRow): string {
  if (row.target_kind !== "meta" || row.target_value == null) return "";
  return String(row.target_value);
}

function targetInputStep(mode: MetaMesValueMode): string {
  return mode === "currency" ? "0.01" : "1";
}

function statusLabel(status: MetaMesDailyRow["status"]): string {
  switch (status) {
    case "acima":
      return "Acima";
    case "atingiu":
      return "Atingiu";
    case "abaixo":
      return "Abaixo";
    case "feriado":
      return "Feriado";
    case "domingo":
      return "Domingo";
    default:
      return "Sem meta";
  }
}

function statusClassName(status: MetaMesDailyRow["status"]): string {
  return `is-${status.replace("_", "-")}`;
}

function emptyDraftMap(rows: MetaMesDailyRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.date_ref, serializeRowTarget(row)]));
}

function DailyTargetChart({ rows, valueMode }: { rows: MetaMesDailyRow[]; valueMode: MetaMesValueMode }) {
  const safeRows = Math.max(rows.length, 1);
  const horizontalPadding = 34;
  const slotWidth = 46;
  const chartWidth = Math.max(1220, horizontalPadding * 2 + safeRows * slotWidth);
  const chartHeight = 352;
  const plotTop = 28;
  const plotBottom = 262;
  const plotHeight = plotBottom - plotTop;
  const innerSlot = 24;
  const targetWidth = 14;
  const actualWidth = 14;
  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => [row.actual_value, row.target_kind === "meta" ? row.target_value ?? 0 : 0])
  );

  return (
    <div className="meta-mes-chart-shell">
      <div className="meta-mes-chart-scroll">
        <svg className="meta-mes-chart-svg" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Meta e atingido por dia do mês">
          <line x1="16" y1={plotBottom} x2={chartWidth - 12} y2={plotBottom} className="meta-mes-chart-axis" />
          <line x1="16" y1={plotTop} x2="16" y2={plotBottom} className="meta-mes-chart-axis" />
          {rows.map((row, index) => {
            const baseX = horizontalPadding + index * slotWidth;
            const targetHeight = row.target_kind === "meta" && row.target_value != null
              ? (row.target_value / maxValue) * plotHeight
              : 0;
            const actualHeight = (row.actual_value / maxValue) * plotHeight;
            const targetY = plotBottom - targetHeight;
            const actualY = plotBottom - actualHeight;

            return (
              <g key={row.date_ref}>
                {row.target_kind === "meta" && row.target_value != null ? (
                  <rect
                    x={baseX - innerSlot / 2}
                    y={targetY}
                    width={targetWidth}
                    height={targetHeight}
                    rx="5"
                    className="meta-mes-chart-target"
                  >
                    <title>{`${formatDateOnlyPtBR(row.date_ref)} · Meta ${formatMetricValue(row.target_value, valueMode)}`}</title>
                  </rect>
                ) : null}
                <rect
                  x={baseX + innerSlot / 2 - actualWidth}
                  y={actualY}
                  width={actualWidth}
                  height={actualHeight}
                  rx="5"
                  className="meta-mes-chart-actual"
                >
                  <title>{`${formatDateOnlyPtBR(row.date_ref)} · Atingido ${formatMetricValue(row.actual_value, valueMode)}`}</title>
                </rect>
                {row.actual_value > 0 ? (
                  <text
                    x={baseX + innerSlot / 2 - actualWidth / 2}
                    y={Math.max(actualY - 10, 18)}
                    textAnchor="middle"
                    className="meta-mes-chart-value"
                  >
                    {formatCompactValue(row.actual_value, valueMode)}
                  </text>
                ) : null}
                <text x={baseX} y="292" textAnchor="middle" className="meta-mes-chart-label">
                  {String(row.day_number).padStart(2, "0")}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="meta-mes-chart-legend">
        <span><i className="is-target" /> Meta</span>
        <span><i className="is-actual" /> Atingido</span>
      </div>
    </div>
  );
}

export default function MetaMesPage({ isOnline, profile }: MetaMesPageProps) {
  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const displayCdName = useMemo(() => resolveCdDisplayName(profile, activeCd), [activeCd, profile]);
  const isAdmin = profile.role === "admin";

  const [activities, setActivities] = useState<MetaMesActivityOption[]>([]);
  const [monthOptions, setMonthOptions] = useState<MetaMesMonthOption[]>([]);
  const [selectedActivityKey, setSelectedActivityKey] = useState("");
  const [selectedMonthStart, setSelectedMonthStart] = useState("");

  const [summary, setSummary] = useState<MetaMesSummary | null>(null);
  const [dailyRows, setDailyRows] = useState<MetaMesDailyRow[]>([]);
  const [draftTargets, setDraftTargets] = useState<Record<string, string>>({});

  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [busyDayKey, setBusyDayKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadDashboard = useCallback(async (activityKey: string, monthStart: string) => {
    if (!activityKey || !monthStart) {
      setSummary(null);
      setDailyRows([]);
      setDraftTargets({});
      return;
    }

    setLoadingDashboard(true);
    setErrorMessage(null);
    try {
      const [nextSummary, nextRows] = await Promise.all([
        fetchMetaMesSummary(activeCd, activityKey, monthStart),
        fetchMetaMesDailyRows(activeCd, activityKey, monthStart)
      ]);
      setSummary(nextSummary);
      setDailyRows(nextRows);
      setDraftTargets(emptyDraftMap(nextRows));
    } catch (error) {
      setErrorMessage(asErrorMessage(error));
      setSummary(null);
      setDailyRows([]);
      setDraftTargets({});
    } finally {
      setLoadingDashboard(false);
    }
  }, [activeCd]);

  useEffect(() => {
    let cancelled = false;

    async function loadFilters() {
      setLoadingFilters(true);
      setErrorMessage(null);
      try {
        const [nextActivities, nextMonths] = await Promise.all([
          fetchMetaMesActivities(activeCd),
          fetchMetaMesMonthOptions(activeCd)
        ]);
        if (cancelled) return;
        setActivities(nextActivities);
        setMonthOptions(nextMonths);
        setSelectedActivityKey((current) => (
          current && nextActivities.some((item) => item.activity_key === current)
            ? current
            : nextActivities[0]?.activity_key || ""
        ));
        setSelectedMonthStart((current) => (
          current && nextMonths.some((item) => item.month_start === current)
            ? current
            : nextMonths[0]?.month_start || monthStartIsoBrasilia()
        ));
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(asErrorMessage(error));
        setActivities([]);
        setMonthOptions([]);
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    }

    void loadFilters();
    return () => {
      cancelled = true;
    };
  }, [activeCd]);

  useEffect(() => {
    void loadDashboard(selectedActivityKey, selectedMonthStart);
  }, [loadDashboard, selectedActivityKey, selectedMonthStart]);

  const selectedActivity = useMemo(
    () => activities.find((item) => item.activity_key === selectedActivityKey) ?? null,
    [activities, selectedActivityKey]
  );

  const selectedMonthLabel = useMemo(
    () => monthOptions.find((item) => item.month_start === selectedMonthStart)?.month_label ?? "-",
    [monthOptions, selectedMonthStart]
  );

  const valueMode = summary?.value_mode ?? selectedActivity?.value_mode ?? "integer";
  const projectionPercent = summary && summary.total_target > 0
    ? (summary.monthly_projection / summary.total_target) * 100
    : null;
  const isCurrentMonthSelected = selectedMonthStart === monthStartIsoBrasilia();

  const metricCards = useMemo<MetricCardDefinition[]>(() => {
    if (!summary) return [];
    return [
      { label: "Total do mês", value: formatMetricValue(summary.total_actual, valueMode) },
      { label: "Meta do mês", value: formatMetricValue(summary.total_target, valueMode) },
      {
        label: "% de atingimento",
        value: formatPercent(summary.achievement_percent),
        accent: summary.achievement_percent != null && summary.achievement_percent >= 100 ? "success" : "danger"
      },
      { label: "Média dia", value: formatMetricValue(summary.daily_average, valueMode) },
      { label: "Projeção mensal", value: formatMetricValue(summary.monthly_projection, valueMode), accent: "neutral" },
      {
        label: "Ritmo projetado",
        value: formatPercent(projectionPercent),
        accent: projectionPercent != null && projectionPercent >= 100 ? "success" : "warning"
      },
      { label: "Dias com meta", value: String(summary.days_with_target) },
      { label: "Dias atingidos", value: String(summary.days_hit), accent: summary.days_hit > 0 ? "success" : "neutral" }
    ];
  }, [projectionPercent, summary, valueMode]);

  const onChangeDraft = useCallback((dateRef: string, value: string) => {
    setDraftTargets((current) => ({
      ...current,
      [dateRef]: value
    }));
  }, []);

  const onSaveTarget = useCallback(async (row: MetaMesDailyRow) => {
    if (!selectedActivityKey || !selectedMonthStart) return;
    const draft = (draftTargets[row.date_ref] ?? "").trim();
    const normalized = draft.replace(",", ".");
    const targetValue = normalized === "" ? null : Number.parseFloat(normalized);
    if (targetValue != null && !Number.isFinite(targetValue)) {
      setErrorMessage("Informe uma meta válida antes de salvar.");
      return;
    }

    setBusyDayKey(row.date_ref);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await setMetaMesDailyTarget({
        cd: activeCd,
        activityKey: selectedActivityKey,
        dateRef: row.date_ref,
        targetValue
      });
      await loadDashboard(selectedActivityKey, selectedMonthStart);
      setStatusMessage(`Meta do dia ${formatDateOnlyPtBR(row.date_ref)} atualizada.`);
    } catch (error) {
      setErrorMessage(asErrorMessage(error));
    } finally {
      setBusyDayKey(null);
    }
  }, [activeCd, draftTargets, loadDashboard, selectedActivityKey, selectedMonthStart]);

  const onToggleHoliday = useCallback(async (row: MetaMesDailyRow) => {
    if (!selectedActivityKey || !selectedMonthStart) return;
    setBusyDayKey(row.date_ref);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await setMetaMesHoliday({
        cd: activeCd,
        activityKey: selectedActivityKey,
        dateRef: row.date_ref,
        isHoliday: !row.is_holiday
      });
      await loadDashboard(selectedActivityKey, selectedMonthStart);
      setStatusMessage(
        row.is_holiday
          ? `Feriado removido em ${formatDateOnlyPtBR(row.date_ref)}.`
          : `Feriado marcado em ${formatDateOnlyPtBR(row.date_ref)}.`
      );
    } catch (error) {
      setErrorMessage(asErrorMessage(error));
    } finally {
      setBusyDayKey(null);
    }
  }, [activeCd, loadDashboard, selectedActivityKey, selectedMonthStart]);

  return (
    <>
      <header className="module-topbar module-topbar-fixed indicadores-topbar">
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

      <section className="modules-shell indicadores-shell meta-mes-shell">
        <article className="module-screen surface-enter indicadores-screen meta-mes-screen">
          <div className="module-screen-header">
            <div className="module-screen-title-row">
              <div className="module-screen-title indicadores-title-stack">
                <img className="indicadores-screen-logo" src={pmImage} alt="PM" />
                <div>
                  <h2>Meta do mês</h2>
                  <span className="module-status">
                    {displayCdName} · {selectedMonthLabel} · atualizado em {formatDateTimeBrasilia(summary?.updated_at ?? null, {
                      emptyFallback: "-"
                    })}
                  </span>
                </div>
              </div>
              <div className="indicadores-filters meta-mes-filters">
                <label>
                  <span>Meta</span>
                  <select
                    value={selectedActivityKey}
                    onChange={(event) => setSelectedActivityKey(event.target.value)}
                    disabled={loadingFilters || activities.length === 0}
                  >
                    {activities.length === 0 ? <option value="">Sem metas</option> : null}
                    {activities.map((activity) => (
                      <option key={activity.activity_key} value={activity.activity_key}>
                        {activity.activity_label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Mês/Ano</span>
                  <select
                    value={selectedMonthStart}
                    onChange={(event) => setSelectedMonthStart(event.target.value)}
                    disabled={loadingFilters || monthOptions.length === 0}
                  >
                    {monthOptions.length === 0 ? <option value="">Sem meses</option> : null}
                    {monthOptions.map((month) => (
                      <option key={month.month_start} value={month.month_start}>
                        {month.month_label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>

          <section className="meta-mes-hero">
            <div className="meta-mes-hero-main">
              <strong>{summary?.activity_label ?? selectedActivity?.activity_label ?? "Selecione uma meta"}</strong>
              <p>
                Um dia por linha, meta diária configurável no mês atual, domingos zerados automaticamente e feriados sem cobrança de meta.
              </p>
            </div>
            <div className="meta-mes-hero-side">
              <span className={`meta-mes-hero-pill${isAdmin && isCurrentMonthSelected ? " is-admin" : ""}`}>
                {isAdmin && isCurrentMonthSelected ? "Admin com edição liberada" : "Visualização somente leitura"}
              </span>
              <small>
                {isCurrentMonthSelected
                  ? "Percentual só aparece quando houver meta definida."
                  : "Meses anteriores ficam travados para consulta histórica."}
              </small>
            </div>
          </section>

          {errorMessage ? <div className="indicadores-feedback is-error">{errorMessage}</div> : null}
          {statusMessage ? <div className="meta-mes-feedback">{statusMessage}</div> : null}

          <div className="indicadores-metrics-grid meta-mes-metrics-grid">
            {metricCards.map((card) => (
              <article key={card.label} className={`indicadores-metric-card meta-mes-metric-card ${card.accent ? `accent-${card.accent}` : ""}`}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </article>
            ))}
          </div>

          <div className="meta-mes-layout-grid">
            <section className="indicadores-panel meta-mes-panel meta-mes-panel-chart">
              <div className="indicadores-panel-head">
                <h3>Ritmo diário</h3>
                <span>{loadingDashboard ? "Atualizando..." : "Meta x atingido por dia"}</span>
              </div>
              {loadingDashboard && !summary ? (
                <div className="indicadores-empty-box"><p>Carregando visão mensal...</p></div>
              ) : (
                <DailyTargetChart rows={dailyRows} valueMode={valueMode} />
              )}
            </section>

            <section className="indicadores-panel meta-mes-panel meta-mes-panel-insights">
              <div className="indicadores-panel-head">
                <h3>Resumo executivo</h3>
                <span>Informações para leitura rápida da operação.</span>
              </div>
              <div className="meta-mes-insights-grid">
                <article className="meta-mes-insight-card">
                  <span>Saldo para meta</span>
                  <strong className={summary && summary.balance_to_target >= 0 ? "is-positive" : "is-negative"}>
                    {summary ? formatBalance(summary.balance_to_target, valueMode) : "-"}
                  </strong>
                </article>
                <article className="meta-mes-insight-card">
                  <span>Dias acima da meta</span>
                  <strong>{summary ? String(summary.days_over) : "-"}</strong>
                </article>
                <article className="meta-mes-insight-card">
                  <span>Feriados</span>
                  <strong>{summary ? String(summary.days_holiday) : "-"}</strong>
                </article>
                <article className="meta-mes-insight-card">
                  <span>Dias sem meta</span>
                  <strong>{summary ? String(summary.days_without_target) : "-"}</strong>
                </article>
              </div>
              <div className="meta-mes-legend-list">
                <span className="meta-mes-legend-item"><i className="is-atingiu" /> Atingiu a meta do dia.</span>
                <span className="meta-mes-legend-item"><i className="is-acima" /> Superou a meta prevista.</span>
                <span className="meta-mes-legend-item"><i className="is-abaixo" /> Ficou abaixo do planejado.</span>
                <span className="meta-mes-legend-item"><i className="is-feriado" /> Feriado sem percentual.</span>
              </div>
            </section>
          </div>

          <section className="indicadores-panel meta-mes-panel meta-mes-panel-table">
            <div className="indicadores-panel-head">
              <h3>Controle diário</h3>
              <span>
                {selectedActivity ? `${selectedActivity.activity_label} · ${selectedActivity.unit_label}` : "Selecione uma meta para começar."}
              </span>
            </div>
            {loadingDashboard && dailyRows.length === 0 ? (
              <div className="indicadores-empty-box"><p>Carregando dias do mês...</p></div>
            ) : (
              <div className="meta-mes-table-wrap">
                <table className="meta-mes-table">
                  <thead>
                    <tr>
                      <th>Dia</th>
                      <th>Tipo</th>
                      <th>Meta</th>
                      <th>Atingido</th>
                      <th>% dia</th>
                      <th>Acumulado</th>
                      <th>Saldo</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyRows.map((row) => {
                      const rowBusy = busyDayKey === row.date_ref;
                      const canEditRow = isAdmin && isCurrentMonthSelected && !row.is_sunday;
                      const draft = draftTargets[row.date_ref] ?? "";
                      const isDirty = normalizeDraftValue(draft) !== normalizeDraftValue(serializeRowTarget(row));
                      const accumulatedLabel = `${formatMetricValue(row.cumulative_actual, valueMode)} / ${formatMetricValue(row.cumulative_target, valueMode)}`;
                      const deltaLabel = row.delta_value == null ? "-" : formatBalance(row.delta_value, valueMode);

                      return (
                        <tr key={row.date_ref} className={`meta-mes-row ${row.status === "acima" ? "is-highlight" : ""}`}>
                          <td>
                            <div className="meta-mes-day-cell">
                              <strong>{formatDateOnlyPtBR(row.date_ref)}</strong>
                              <small>{row.weekday_label}</small>
                            </div>
                          </td>
                          <td>
                            <span className={`meta-mes-status ${statusClassName(row.status)}`}>{statusLabel(row.status)}</span>
                          </td>
                          <td>
                            <div className="meta-mes-target-cell">
                              <input
                                type="number"
                                inputMode="decimal"
                                step={targetInputStep(valueMode)}
                                value={draft}
                                onChange={(event) => onChangeDraft(row.date_ref, event.target.value)}
                                disabled={!canEditRow || rowBusy}
                                placeholder={row.is_sunday ? "0" : row.is_holiday ? "Feriado" : "Sem meta"}
                              />
                              <small>
                                {row.is_sunday
                                  ? "Domingo = 0"
                                  : row.is_holiday
                                    ? "Dia sem meta"
                                    : row.target_kind === "sem_meta"
                                      ? "Não definida"
                                      : "Meta ativa"}
                              </small>
                            </div>
                          </td>
                          <td>{formatMetricValue(row.actual_value, valueMode)}</td>
                          <td>{formatPercent(row.percent_achievement)}</td>
                          <td>
                            <div className="meta-mes-acc-cell">
                              <strong>{accumulatedLabel}</strong>
                              <small>{formatPercent(row.cumulative_percent)}</small>
                            </div>
                          </td>
                          <td>
                            <span
                              className={`meta-mes-balance${
                                row.delta_value == null ? "" : row.delta_value >= 0 ? " is-positive" : " is-negative"
                              }`}
                            >
                              {deltaLabel}
                            </span>
                          </td>
                          <td>
                            <div className="meta-mes-row-actions">
                              <button
                                type="button"
                                className={`meta-mes-icon-btn${row.is_holiday ? " is-active" : ""}`}
                                onClick={() => void onToggleHoliday(row)}
                                disabled={!canEditRow || rowBusy}
                                title={row.is_holiday ? "Remover feriado" : "Marcar feriado"}
                                aria-label={row.is_holiday ? "Remover feriado" : "Marcar feriado"}
                              >
                                <HolidayIcon />
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary meta-mes-save-btn"
                                onClick={() => void onSaveTarget(row)}
                                disabled={!canEditRow || rowBusy || !isDirty}
                              >
                                {rowBusy ? "Salvando..." : "Salvar"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </article>
      </section>
    </>
  );
}
