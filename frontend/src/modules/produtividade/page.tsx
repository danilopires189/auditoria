import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import pmImage from "../../../assets/pm.png";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { formatDateOnlyPtBR, formatDateTimeBrasilia, monthStartIsoBrasilia, todayIsoBrasilia } from "../../shared/brasilia-datetime";
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

interface ProdutividadePdfPreview {
  month: string;
  monthLabel: string;
  cdLabel: string;
  generatedAt: string;
  generatedBy: string;
  leaderLabel: string;
  rankingRows: ProdutividadeRankingRow[];
}

type RankingMetricConfig = {
  label: string;
  pdfLabel: string;
  pointsKey: keyof ProdutividadeRankingRow;
  qtyKey: keyof ProdutividadeRankingRow;
  singular: string;
  plural: string;
};

const MODULE_DEF = getModuleByKeyOrThrow("produtividade");
let reportLogoDataUrlPromise: Promise<string | null> | null = null;
const ALL_COLLABORATORS_VALUE = "__all__";

const RANKING_METRICS: RankingMetricConfig[] = [
  { label: "PVPs", pdfLabel: "PVPs", pointsKey: "pvps_pontos", qtyKey: "pvps_qtd", singular: "end", plural: "ends" },
  { label: "Vol. Expedido", pdfLabel: "Vol. Expedido", pointsKey: "vol_pontos", qtyKey: "vol_qtd", singular: "Vol.", plural: "Vol." },
  { label: "Blitz", pdfLabel: "Blitz", pointsKey: "blitz_pontos", qtyKey: "blitz_qtd", singular: "un", plural: "un" },
  { label: "Zerados", pdfLabel: "Zerados", pointsKey: "zerados_pontos", qtyKey: "zerados_qtd", singular: "end", plural: "ends" },
  { label: "Ativ Extra", pdfLabel: "Ativ Extra", pointsKey: "atividade_extra_pontos", qtyKey: "atividade_extra_qtd", singular: "Regist.", plural: "Regist." },
  { label: "Alocação", pdfLabel: "Alocação", pointsKey: "alocacao_pontos", qtyKey: "alocacao_qtd", singular: "end", plural: "ends" },
  { label: "Devolução", pdfLabel: "Devolução", pointsKey: "devolucao_pontos", qtyKey: "devolucao_qtd", singular: "devol.", plural: "devol." },
  { label: "Ter. Conf", pdfLabel: "Ter. Conf", pointsKey: "conf_termo_pontos", qtyKey: "conf_termo_qtd", singular: "sku", plural: "skus" },
  { label: "Avul. Conf", pdfLabel: "Avul. Conf", pointsKey: "conf_avulso_pontos", qtyKey: "conf_avulso_qtd", singular: "sku", plural: "skus" },
  { label: "Ent. Notas", pdfLabel: "Ent. Notas", pointsKey: "conf_entrada_pontos", qtyKey: "conf_entrada_qtd", singular: "sku", plural: "skus" },
  { label: "Transf. CD", pdfLabel: "Transf. CD", pointsKey: "conf_transferencia_cd_pontos", qtyKey: "conf_transferencia_cd_qtd", singular: "sku", plural: "skus" },
  { label: "Reg Lojas", pdfLabel: "Reg Lojas", pointsKey: "conf_lojas_pontos", qtyKey: "conf_lojas_qtd", singular: "loja", plural: "lojas" },
  { label: "Aud. Caixa", pdfLabel: "Aud. Caixa", pointsKey: "aud_caixa_pontos", qtyKey: "aud_caixa_qtd", singular: "volume", plural: "volumes" },
  { label: "Caixa Térmica", pdfLabel: "Cx. Térmica", pointsKey: "caixa_termica_pontos", qtyKey: "caixa_termica_qtd", singular: "mov.", plural: "mov." },
  { label: "Ronda Qualidade", pdfLabel: "Ronda Qual.", pointsKey: "ronda_quality_pontos", qtyKey: "ronda_quality_qtd", singular: "aud.", plural: "aud." },
  { label: "Check List", pdfLabel: "Check List", pointsKey: "checklist_pontos", qtyKey: "checklist_qtd", singular: "checklist", plural: "checklists" }
];

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

function formatDate(value: string): string {
  return formatDateOnlyPtBR(value, "-", "value");
}

function formatDateTime(value: string): string {
  return formatDateTimeBrasilia(value, { emptyFallback: "-", invalidFallback: "value" });
}

function formatMetric(value: number, unit?: string): string {
  const safe = Number.isFinite(value) ? value : 0;
  if (unit === "pontos") {
    return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(safe);
  }
  const rounded = Math.round(safe);
  if (Math.abs(safe - rounded) < 0.001) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(rounded);
  }
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(safe);
}

function formatRankingMetric(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(safe);
}

function formatMetricWithUnit(value: number, unitLabel: string): string {
  return formatMetricWithInflection(value, unitLabel, formatMetric);
}

function formatRankingPointsAndCount(points: number, count: number, singular: string, plural: string): string {
  return `${formatMetric(points, "")} pts | ${formatCountLabel(count, singular, plural, {
    formatValue: (value) => formatMetric(value, "")
  })}`;
}

function formatRankingPdfPointsAndCount(points: number, count: number, singular: string, plural: string): string {
  return `${formatMetric(points, "")} pts\n${formatCountLabel(count, singular, plural, {
    formatValue: (value) => formatMetric(value, "")
  })}`;
}

function buildRankingMetricItems(row: ProdutividadeRankingRow) {
  return RANKING_METRICS.map((metric) => {
    const points = Number(row[metric.pointsKey] ?? 0);
    const count = Number(row[metric.qtyKey] ?? 0);
    return {
      label: metric.label,
      pdfLabel: metric.pdfLabel,
      value: formatRankingPointsAndCount(points, count, metric.singular, metric.plural),
      pdfValue: formatRankingPdfPointsAndCount(points, count, metric.singular, metric.plural)
    };
  });
}

function asUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Erro inesperado.";
}

function visibilityModeLabel(mode: ProdutividadeVisibilityMode): string {
  return mode === "owner_only" ? "Somente dono/admin" : "Público no CD";
}

function friendlyCdLabel(profileCdName: string | null | undefined, cd: number | null): string {
  const profileLabel = typeof profileCdName === "string" ? profileCdName.trim().replace(/\s+/g, " ") : "";
  if (profileLabel) return profileLabel;
  if (cd != null) return `CD ${String(cd).padStart(2, "0")}`;
  return "CD não definido";
}

function formatRankingMonthLabel(value: string): string {
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number.parseInt(yearRaw ?? "", 10);
  const month = Number.parseInt(monthRaw ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return value;
  const monthNames = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro"
  ];
  const monthLabel = monthNames[month - 1];
  return monthLabel ? `${monthLabel} de ${year}` : value;
}

function isBrowserDesktop(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(min-width: 980px)").matches;
}

async function loadReportLogoDataUrl(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!reportLogoDataUrlPromise) {
    reportLogoDataUrlPromise = fetch(pmImage)
      .then(async (response) => {
        if (!response.ok) return null;
        const blob = await response.blob();
        return await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      })
      .catch(() => null);
  }
  return reportLogoDataUrlPromise;
}

function buildPdfColumnStyles(
  doc: jsPDF,
  headRow: string[],
  bodyRows: string[][],
  contentWidth: number,
  wrapColumns: number[],
  minWidths?: Partial<Record<number, number>>,
  maxWidths?: Partial<Record<number, number>>
): Record<number, { cellWidth: number; overflow?: "linebreak" | "ellipsize" }> {
  const fontSize = 7;
  const horizontalPadding = 12;
  const defaultMinWidth = 26;
  const absoluteMinWidth = 18;
  const wrapSet = new Set(wrapColumns);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(fontSize);

  void bodyRows;

  const baseMinWidths = headRow.map((_, columnIndex) => Math.max(minWidths?.[columnIndex] ?? defaultMinWidth, absoluteMinWidth));
  const maxColumnWidths = headRow.map((header, columnIndex) => {
    const headerWidth = doc.getTextWidth(String(header ?? "")) + horizontalPadding;
    const fallbackMax = wrapSet.has(columnIndex) ? 140 : 90;
    return Math.max(maxWidths?.[columnIndex] ?? fallbackMax, headerWidth, baseMinWidths[columnIndex]);
  });
  const headerWeights = headRow.map((header, columnIndex) => {
    const headerWidth = doc.getTextWidth(String(header ?? "")) + horizontalPadding;
    return Math.max(headerWidth, baseMinWidths[columnIndex], absoluteMinWidth);
  });

  let widths = [...baseMinWidths];
  let total = widths.reduce((sum, value) => sum + value, 0);

  if (total > contentWidth) {
    const scalableTotal = widths.reduce((sum, value) => sum + Math.max(value - absoluteMinWidth, 0), 0);
    if (scalableTotal > 0) {
      const overflow = total - contentWidth;
      widths = widths.map((value) => {
        const shrinkable = Math.max(value - absoluteMinWidth, 0);
        if (shrinkable <= 0) return value;
        const reduction = Math.min(shrinkable, (shrinkable / scalableTotal) * overflow);
        return value - reduction;
      });
      total = widths.reduce((sum, value) => sum + value, 0);
    }
  }

  if (total < contentWidth) {
    let remaining = contentWidth - total;
    const eligible = headRow.map((_, index) => index);

    while (remaining > 0.01 && eligible.length > 0) {
      const weightTotal = eligible.reduce((sum, index) => sum + headerWeights[index], 0);
      let consumed = 0;
      const nextEligible: number[] = [];

      for (const index of eligible) {
        const share = weightTotal > 0 ? (remaining * headerWeights[index]) / weightTotal : remaining / eligible.length;
        const room = Math.max(maxColumnWidths[index] - widths[index], 0);
        const growth = Math.min(share, room);
        widths[index] += growth;
        consumed += growth;
        if (widths[index] + 0.01 < maxColumnWidths[index]) {
          nextEligible.push(index);
        }
      }

      if (consumed <= 0.01) break;
      remaining -= consumed;
      eligible.splice(0, eligible.length, ...nextEligible);
    }
  }

  return Object.fromEntries(
    widths.map((width, index) => [
      index,
      {
        cellWidth: Number(width.toFixed(2)),
        overflow: wrapSet.has(index) ? "linebreak" : "ellipsize"
      }
    ])
  );
}

function pdfIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M15 3v3h3" />
      <path d="M8 14h2.5a1.5 1.5 0 0 0 0-3H8v6" />
      <path d="M13 11h1.5a2 2 0 0 1 0 4H13z" />
      <path d="M17 11h-2v6" />
      <path d="M17 14h1.5" />
    </svg>
  );
}

function visibilityIcon(isOwnerOnly: boolean) {
  if (isOwnerOnly) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 12c2-4 5-6 9-6s7 2 9 6" strokeLinecap="round" />
        <path d="M3 12c1 1.5 2 2.5 3.5 3.5" strokeLinecap="round" />
        <path d="M21 12c-1 1.5-2 2.5-3.5 3.5" strokeLinecap="round" />
        <line x1="8" y1="18" x2="8.8" y2="15.2" strokeLinecap="round" />
        <line x1="12" y1="19" x2="12" y2="16" strokeLinecap="round" />
        <line x1="16" y1="18" x2="15.2" y2="15.2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12c2-4.5 5-7 9-7s7 2.5 9 7c-2 4.5-5 7-9 7s-7-2.5-9-7z" />
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function ProdutividadePage({ isOnline, profile }: ProdutividadePageProps) {
  const displayUserName = toDisplayName(profile.nome);
  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const isAdmin = profile.role === "admin";
  const [isDesktop, setIsDesktop] = useState<boolean>(() => isBrowserDesktop());

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
  const [reportBusyExport, setReportBusyExport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

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
  const [expandedDailyDates, setExpandedDailyDates] = useState<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const isAllCollaboratorsSelected = selectedUserId === ALL_COLLABORATORS_VALUE;

  const selectedCollaborator = useMemo(
    () => collaborators.find((row) => row.user_id === selectedUserId) ?? null,
    [collaborators, selectedUserId]
  );
  const sortedCollaborators = useMemo(() => {
    return [...collaborators].sort((left, right) => (
      left.nome.localeCompare(right.nome, "pt-BR", { sensitivity: "base" }) || left.mat.localeCompare(right.mat, "pt-BR")
    ));
  }, [collaborators]);
  const filteredCollaborators = useMemo(() => {
    const query = collaboratorSearch.trim().toLocaleLowerCase("pt-BR");
    if (!query) return sortedCollaborators;
    return sortedCollaborators.filter((row) => `${row.nome} ${row.mat}`.toLocaleLowerCase("pt-BR").includes(query));
  }, [collaboratorSearch, sortedCollaborators]);
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
  const canUseRankingPdf = isAdmin && isDesktop;

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

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 980px)");
    const onChange = () => setIsDesktop(media.matches);
    onChange();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  const loadEntriesOnly = useCallback(async (targetUserId: string | null, nextActivityKey: string | null) => {
    if (activeCd == null) {
      setEntries([]);
      return;
    }
    const rows = await fetchProdutividadeEntries({
      cd: activeCd,
      targetUserId: targetUserId === ALL_COLLABORATORS_VALUE ? null : targetUserId,
      dtIni: dateStart,
      dtFim: dateEnd,
      activityKey: nextActivityKey,
      limit: 500
    });
    setEntries(rows);
  }, [activeCd, dateEnd, dateStart]);

  const loadUserPanels = useCallback(async (targetUserId: string | null, nextActivityKey: string | null) => {
    if (activeCd == null) {
      setActivityTotals([]);
      setDailyRows([]);
      setEntries([]);
      setExpandedDailyDates(new Set());
      return;
    }

    setLoadingDetail(true);
    setExpandedDailyDates(new Set());
    setErrorMessage(null);
    try {
      const [totals, daily, entryRows] = await Promise.all([
        fetchProdutividadeActivityTotals({
          cd: activeCd,
          targetUserId: targetUserId === ALL_COLLABORATORS_VALUE ? null : targetUserId,
          dtIni: dateStart,
          dtFim: dateEnd
        }),
        fetchProdutividadeDaily({
          cd: activeCd,
          targetUserId: targetUserId === ALL_COLLABORATORS_VALUE ? null : targetUserId,
          dtIni: dateStart,
          dtFim: dateEnd
        }),
        fetchProdutividadeEntries({
          cd: activeCd,
          targetUserId: targetUserId === ALL_COLLABORATORS_VALUE ? null : targetUserId,
          dtIni: dateStart,
          dtFim: dateEnd,
          activityKey: nextActivityKey,
          limit: 500
        })
      ]);

      setActivityTotals([...totals].sort((a, b) => a.activity_label.localeCompare(b.activity_label, "pt-BR")));
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
        if (nextSelectedUserId !== ALL_COLLABORATORS_VALUE && (!nextSelectedUserId || !collaboratorRows.some((row) => row.user_id === nextSelectedUserId))) {
          nextSelectedUserId = collaboratorRows[0].user_id;
        }
      } else {
        nextSelectedUserId = ALL_COLLABORATORS_VALUE;
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

  const buildRankingPdfPreview = useCallback((): ProdutividadePdfPreview | null => {
    if (!canUseRankingPdf) {
      setReportError("A exportação em PDF do ranking está disponível apenas para admin no desktop.");
      return null;
    }
    if (activeCd == null) {
      setReportError("CD não definido para este usuário.");
      return null;
    }
    if (rankingRows.length === 0) {
      setReportError("Clique em Buscar Ranking antes de exportar o PDF.");
      return null;
    }

    setReportError(null);
    return {
      month: rankingMonth,
      monthLabel: formatRankingMonthLabel(rankingMonth),
      cdLabel: friendlyCdLabel(profile.cd_nome, activeCd),
      generatedAt: new Date().toISOString(),
      generatedBy: `${displayUserName} (${profile.mat || "-"})`,
      leaderLabel: rankingRows[0] ? `${rankingRows[0].nome} (${formatMetric(rankingRows[0].total_pontos, "")} pts)` : "-",
      rankingRows
    };
  }, [activeCd, canUseRankingPdf, displayUserName, profile.cd_nome, profile.mat, rankingMonth, rankingRows]);

  const exportRankingPdf = useCallback(async (preview: ProdutividadePdfPreview) => {
    const logoDataUrl = await loadReportLogoDataUrl();
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4"
    });
    const marginX = 36;
    let pageWidth = doc.internal.pageSize.getWidth();
    let pageHeight = doc.internal.pageSize.getHeight();
    let contentWidth = pageWidth - (marginX * 2);

    let cursorY = 40;
    const logoWidth = 75;
    const logoHeight = 75;
    const titleX = marginX + 92;
    const metaStartY = cursorY + 38;
    const metaLineHeight = 16;
    const metaLines = [
      `Mês de referência: ${preview.monthLabel}`,
      `CD: ${preview.cdLabel}`,
      `Gerado por: ${preview.generatedBy}`,
      `Data/Hora: ${formatDateTime(preview.generatedAt)}`
    ];
    const metaBlockCenterY = metaStartY + ((metaLines.length - 1) * metaLineHeight) / 2;
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", marginX, metaBlockCenterY - (logoHeight / 2) - 6, logoWidth, logoHeight);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    doc.setTextColor(24, 51, 97);
    doc.text("Relatório de Ranking de Produtividade", titleX, cursorY + 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(70, 92, 126);
    metaLines.forEach((line, index) => {
      doc.text(line, titleX, metaStartY + (index * metaLineHeight));
    });

    cursorY = 170;
    [
      {
        label: "Líder do ranking",
        value: preview.leaderLabel,
        boxX: marginX,
        boxWidth: contentWidth,
        valueFont: 16,
        accent: true
      }
    ].forEach((card) => {
      doc.setFillColor(card.accent ? 236 : 245, card.accent ? 243 : 248, 253);
      doc.setDrawColor(209, 221, 241);
      doc.roundedRect(card.boxX, cursorY, card.boxWidth, 78, 10, 10, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(card.valueFont);
      doc.setTextColor(28, 58, 106);
      const lines = doc.splitTextToSize(card.value, card.boxWidth - 24);
      doc.text(lines, card.boxX + 12, cursorY + 24);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(86, 103, 132);
      doc.text(card.label, card.boxX + 12, cursorY + 62);
    });

    cursorY += 110;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(24, 51, 97);
    doc.text("Ranking Geral", marginX, cursorY);

    const rankingHead = [["Posição", "Colaborador", "Matrícula", "Pontos Totais"]];
    const rankingBody = preview.rankingRows.map((row, index) => [
      String(row.posicao > 0 ? row.posicao : index + 1),
      row.nome,
      row.mat,
      `${formatMetric(row.total_pontos, "")} pts`
    ]);
    autoTable(doc, {
      startY: cursorY + 8,
      margin: { left: marginX, right: marginX },
      head: rankingHead,
      body: rankingBody,
      theme: "grid",
      tableWidth: contentWidth,
      styles: {
        fontSize: 8,
        cellPadding: 4,
        overflow: "ellipsize",
        valign: "middle",
        lineColor: [214, 225, 241],
        lineWidth: 0.4,
        textColor: [31, 45, 69]
      },
      headStyles: {
        fillColor: [31, 69, 125],
        textColor: [255, 255, 255],
        fontStyle: "bold"
      },
      alternateRowStyles: {
        fillColor: [248, 250, 253]
      },
      columnStyles: {
        0: { cellWidth: 52 },
        1: { cellWidth: 280, overflow: "linebreak" },
        2: { cellWidth: 88 },
        3: { cellWidth: 96 }
      }
    });

    doc.addPage("a4", "landscape");
    pageWidth = doc.internal.pageSize.getWidth();
    pageHeight = doc.internal.pageSize.getHeight();
    contentWidth = pageWidth - (marginX * 2);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(24, 51, 97);
    doc.text("Detalhamento por Colaborador", marginX, 52);

    const detailsHead = [[
      "Pos.",
      "Colaborador",
      "Matrícula",
      "Total",
      ...RANKING_METRICS.map((metric) => metric.pdfLabel)
    ]];
    const detailsBody = preview.rankingRows.map((row, index) => {
      const metricItems = buildRankingMetricItems(row);
      return [
        String(row.posicao > 0 ? row.posicao : index + 1),
        row.nome,
        row.mat,
        `${formatMetric(row.total_pontos, "")} pts`,
        ...metricItems.map((item) => item.pdfValue)
      ];
    });
    autoTable(doc, {
      startY: 60,
      margin: { left: marginX, right: marginX },
      head: detailsHead,
      body: detailsBody,
      theme: "grid",
      tableWidth: contentWidth,
      styles: {
        fontSize: 5.5,
        cellPadding: 2.5,
        overflow: "linebreak",
        valign: "middle",
        lineColor: [214, 225, 241],
        lineWidth: 0.4,
        textColor: [31, 45, 69]
      },
      headStyles: {
        fillColor: [31, 69, 125],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        overflow: "linebreak"
      },
      alternateRowStyles: {
        fillColor: [248, 250, 253]
      },
      columnStyles: buildPdfColumnStyles(
        doc,
        detailsHead[0],
        detailsBody,
        contentWidth,
        [1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
        {
          0: 24,
          1: 92,
          2: 42,
          3: 44,
          4: 42,
          5: 46,
          6: 40,
          7: 42,
          8: 44,
          9: 42,
          10: 42,
          11: 42,
          12: 42,
          13: 44,
          14: 44,
          15: 42,
          16: 42,
          17: 46,
          18: 46,
          19: 46
        },
        {
          1: 122,
          4: 50,
          5: 54,
          6: 46,
          7: 50,
          8: 54,
          9: 50,
          10: 50,
          11: 50,
          12: 50,
          13: 54,
          14: 54,
          15: 50,
          16: 50,
          17: 56,
          18: 56,
          19: 56
        }
      )
    });

    const totalPages = doc.getNumberOfPages();
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      doc.setPage(pageNumber);
      const currentPageWidth = doc.internal.pageSize.getWidth();
      const currentPageHeight = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(86, 103, 132);
      doc.text(`Página ${pageNumber} de ${totalPages}`, currentPageWidth - marginX, currentPageHeight - 20, { align: "right" });
    }
    doc.save(`ranking-produtividade-${preview.month}-cd-${String(activeCd).padStart(2, "0")}.pdf`);
  }, [activeCd]);

  const runRankingPdfExport = useCallback(async () => {
    if (!canUseRankingPdf) {
      setReportError("A exportação em PDF do ranking está disponível apenas para admin no desktop.");
      return;
    }
    setReportBusyExport(true);
    setReportError(null);
    try {
      const preview = buildRankingPdfPreview();
      if (!preview) return;
      await exportRankingPdf(preview);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Falha ao gerar relatório PDF.");
    } finally {
      setReportBusyExport(false);
    }
  }, [buildRankingPdfPreview, canUseRankingPdf, exportRankingPdf]);

  useEffect(() => {
    if (viewMode === "history") {
      void loadModuleData(profile.user_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCd, viewMode]);

  useEffect(() => {
    if (viewMode === "ranking") {
      void loadRankingData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCd, viewMode, rankingMonth]);

  const dateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (viewMode !== "history" || !canLoadRange || loading) return;
    if (dateDebounceRef.current) clearTimeout(dateDebounceRef.current);
    dateDebounceRef.current = setTimeout(() => {
      void loadModuleData(selectedUserId ?? profile.user_id);
    }, 600);
    return () => {
      if (dateDebounceRef.current) clearTimeout(dateDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStart, dateEnd]);

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

  const onToggleDailyDay = useCallback((dateRef: string) => {
    setExpandedDailyDates((current) => {
      const next = new Set(current);
      if (next.has(dateRef)) {
        next.delete(dateRef);
      } else {
        next.add(dateRef);
      }
      return next;
    });
  }, []);

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
                <div className="produtividade-tabs">
                  <button
                    type="button"
                    className={`produtividade-tab${viewMode === "history" ? " is-active" : ""}`}
                    onClick={() => setViewMode("history")}
                  >
                    Histórico
                  </button>
                  <button
                    type="button"
                    className={`produtividade-tab${viewMode === "ranking" ? " is-active" : ""}`}
                    onClick={() => setViewMode("ranking")}
                  >
                    Ranking
                  </button>
                </div>
                {isAdmin && visibility ? (
                  <button
                    type="button"
                    className="btn btn-muted btn-icon produtividade-visibility-btn"
                    onClick={() => void onToggleVisibility()}
                    disabled={busyVisibility}
                    title={busyVisibility ? "Salvando..." : visibilityModeLabel(visibility.visibility_mode)}
                    aria-label={visibilityModeLabel(visibility.visibility_mode)}
                  >
                    {visibilityIcon(visibility.visibility_mode === "owner_only")}
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
                  <div className="produtividade-ranking-controls">
                    <label className="produtividade-ranking-month-label">
                      <span>Mês de referência</span>
                      <input type="month" value={rankingMonth} onChange={(event) => setRankingMonth(event.target.value)} />
                    </label>
                    {canUseRankingPdf ? (
                      <button
                        type="button"
                        className="btn btn-muted inventario-report-icon-btn"
                        onClick={() => void runRankingPdfExport()}
                        disabled={reportBusyExport || loadingRanking}
                        title="Exportar PDF do ranking"
                        aria-label="Exportar PDF do ranking"
                      >
                        {reportBusyExport ? "..." : pdfIcon()}
                      </button>
                    ) : null}
                  </div>
                </div>

                {reportError ? <div className="alert error">{reportError}</div> : null}

                {loadingRanking ? (
                  <div className="coleta-empty">Calculando ranking...</div>
                ) : rankingRows.length === 0 ? (
                  <div className="coleta-empty">Nenhum dado de ranking para o mês selecionado.</div>
                ) : (
                  <div className="produtividade-ranking-list">
                        {rankingRows.map((row, idx) => {
                          const isExpanded = expandedRankingUser === row.user_id;
                          const rankingPosition = row.posicao > 0 ? row.posicao : idx + 1;
                          const badgeClass = rankingPosition === 1 ? "rank-1" : rankingPosition === 2 ? "rank-2" : rankingPosition === 3 ? "rank-3" : "rank-other";
                          return (
                            <Fragment key={row.user_id}>
                              <div className={`produtividade-ranking-card${rankingPosition <= 3 ? " is-top" : ""}`}>
                                <div className="produtividade-ranking-card-main">
                                  <span className={`produtividade-rank-badge ${badgeClass}`}>
                                    {rankingPosition}º
                                  </span>
                                  <div className="produtividade-ranking-card-info">
                                    <strong>{row.nome}</strong>
                                    <small>{row.mat}</small>
                                  </div>
                                  <div className="produtividade-ranking-card-pts">
                                    <span>{formatRankingMetric(row.total_pontos)}</span>
                                    <small>pontos</small>
                                  </div>
                                  <button
                                    type="button"
                                    className="produtividade-ranking-expand-btn"
                                    onClick={() => setExpandedRankingUser(isExpanded ? null : row.user_id)}
                                    title="Ver detalhes"
                                  >
                                    <svg className={`produtividade-chevron${isExpanded ? " is-open" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </button>
                                </div>
                              {isExpanded && (
                                <div className="ranking-details-grid">
                                      {buildRankingMetricItems(row).map((item) => (
                                        <div key={item.label}>
                                          <strong>{item.label}</strong>
                                          <span>{item.value}</span>
                                        </div>
                                      ))}
                                </div>
                              )}
                              </div>
                            </Fragment>
                          );
                        })}
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
                      className="btn btn-primary produtividade-apply-btn"
                      onClick={() => void loadModuleData(selectedUserId ?? profile.user_id)}
                      disabled={!canLoadRange || busyRefresh || loading || loadingDetail}
                      style={{ visibility: "hidden", pointerEvents: "none" }}
                      aria-hidden="true"
                      tabIndex={-1}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" style={{width:15,height:15,stroke:"currentColor",fill:"none",strokeWidth:2.2,strokeLinecap:"round",strokeLinejoin:"round",flexShrink:0}}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {busyRefresh ? "Carregando..." : "Aplicar"}
                    </button>
                  </div>
                  <div className="produtividade-overview-strip">
                    <article className="produtividade-kpi-card">
                      <div className="produtividade-kpi-icon">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      </div>
                      <small>Ativos no período</small>
                      <strong>{collaborators.length}</strong>
                    </article>
                    <article className="produtividade-kpi-card">
                      <div className="produtividade-kpi-icon">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                      </div>
                      <small>Total bruto</small>
                      <strong>{formatMetric(moduleTotals.valorTotal)}</strong>
                    </article>
                    <article className="produtividade-kpi-card">
                      <div className="produtividade-kpi-icon">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                      </div>
                      <small>Registros</small>
                      <strong>{formatCountLabel(moduleTotals.registros, "registro", "registros")}</strong>
                    </article>
                    <label className="produtividade-kpi-card produtividade-kpi-select-card">
                      <div className="produtividade-kpi-icon">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      </div>
                      <small>Colaborador</small>
                      <select
                        className="produtividade-collab-select"
                        value={selectedUserId ?? ""}
                        onChange={(e) => {
                          const uid = e.target.value;
                          if (uid) onSelectCollaborator(uid);
                        }}
                        disabled={sortedCollaborators.length === 0}
                      >
                        {sortedCollaborators.length === 0
                          ? <option value="">Sem colaboradores</option>
                          : [
                            <option key={ALL_COLLABORATORS_VALUE} value={ALL_COLLABORATORS_VALUE}>Todos colaboradores</option>,
                            ...sortedCollaborators.map((c) => (
                              <option key={c.user_id} value={c.user_id}>{c.nome}</option>
                            ))
                          ]
                        }
                      </select>
                    </label>
                  </div>
                </section>

                <section className="produtividade-detail">
                    {selectedCollaborator || isAllCollaboratorsSelected ? (
                      <div className="produtividade-summary-strip">
                        <span>
                          <strong>{isAllCollaboratorsSelected ? "Todos colaboradores" : selectedCollaborator?.nome}</strong>
                          {isAllCollaboratorsSelected ? "" : ` · Mat. ${selectedCollaborator?.mat ?? "-"}`}
                        </span>
                        <span>{formatCountLabel(isAllCollaboratorsSelected ? moduleTotals.registros : selectedCollaborator?.registros_count ?? 0, "registro", "registros")}</span>
                        <span>{formatCountLabel(isAllCollaboratorsSelected ? collaborators.length : selectedCollaborator?.dias_ativos ?? 0, isAllCollaboratorsSelected ? "colaborador" : "dia ativo", isAllCollaboratorsSelected ? "colaboradores" : "dias ativos")}</span>
                        <span>{formatCountLabel(isAllCollaboratorsSelected ? activityTotals.filter((row) => row.registros_count > 0).length : selectedCollaborator?.atividades_count ?? 0, "atividade", "atividades")}</span>
                        <span>Bruto: {formatMetric(isAllCollaboratorsSelected ? moduleTotals.valorTotal : selectedCollaborator?.valor_total ?? 0, "")}</span>
                      </div>
                    ) : null}

                    <div className="produtividade-detail-body">
                      <div className="produtividade-detail-grid">
                        <div className="produtividade-panel produtividade-activity-block">
                          <h4>Atividades principais</h4>
                          {activityTotals.length === 0 ? (
                            <div className="coleta-empty">Sem atividades para a seleção atual.</div>
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
                                    {row.last_event_date ? ` · Último: ${formatDate(row.last_event_date)}` : ""}
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
                              {dailyGroups.map((bucket) => {
                                const isExpanded = expandedDailyDates.has(bucket.date);
                                const visibleItems = isExpanded ? bucket.items : bucket.items.slice(0, 3);
                                return (
                                  <button
                                    key={bucket.date}
                                    type="button"
                                    className={`produtividade-day-card${isExpanded ? " is-expanded" : ""}`}
                                    onClick={() => onToggleDailyDay(bucket.date)}
                                    aria-expanded={isExpanded}
                                    title={isExpanded ? "Clique para recolher" : "Clique para ver todas as atividades do dia"}
                                  >
                                    <strong>{formatDate(bucket.date)}</strong>
                                    <span>{formatMetric(bucket.total, "")} pts bruto</span>
                                    <ul className="produtividade-day-items">
                                      {visibleItems.map((row, index) => (
                                        <li key={`${bucket.date}:${row.activity_key}:${index}`}>
                                          {`${row.activity_label}: ${formatMetricWithUnit(row.valor_total, row.unit_label)}`}
                                        </li>
                                      ))}
                                      {!isExpanded && bucket.items.length > 3 ? (
                                        <li className="is-more">{`+${bucket.items.length - 3} mais — clique para expandir`}</li>
                                      ) : null}
                                      {isExpanded && bucket.items.length > 3 ? (
                                        <li className="is-more">Clique para recolher</li>
                                      ) : null}
                                    </ul>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="produtividade-panel produtividade-entries-block">
                        <div className="produtividade-filter-line">
                          <span>
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
                            <svg viewBox="0 0 24 24" aria-hidden="true" style={{width:13,height:13,stroke:"currentColor",fill:"none",strokeWidth:2.5,strokeLinecap:"round",strokeLinejoin:"round",flexShrink:0}}>
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
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
                                {isAllCollaboratorsSelected ? (
                                  <div className="produtividade-entry-collaborator">
                                    <span>{entry.mat} {entry.nome}</span>
                                  </div>
                                ) : null}
                                <p>{entry.detail || "-"}</p>
                                <div className="produtividade-entry-meta">
                                  <span>Data: {formatDate(entry.event_date)}</span>
                                  {entry.event_at ? <span>Registro: {formatDateTime(entry.event_at)}</span> : null}
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </section>
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
