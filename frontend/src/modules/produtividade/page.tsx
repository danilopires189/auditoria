import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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

const MODULE_DEF = getModuleByKeyOrThrow("produtividade");
let reportLogoDataUrlPromise: Promise<string | null> | null = null;

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
  const defaultMinWidth = 38;
  const wrapSet = new Set(wrapColumns);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(fontSize);

  const measured = headRow.map((header, columnIndex) => {
    let longest = doc.getTextWidth(String(header ?? ""));
    for (const row of bodyRows) {
      const width = doc.getTextWidth(String(row[columnIndex] ?? ""));
      if (width > longest) longest = width;
    }
    const minWidth = Math.max(minWidths?.[columnIndex] ?? defaultMinWidth, longest + horizontalPadding);
    const maxWidth = maxWidths?.[columnIndex] ?? (wrapSet.has(columnIndex) ? 140 : 90);
    return Math.min(Math.max(minWidth, defaultMinWidth), maxWidth);
  });

  const baseMinWidths = headRow.map((_, columnIndex) => minWidths?.[columnIndex] ?? defaultMinWidth);
  let widths = [...measured];
  let total = widths.reduce((sum, value) => sum + value, 0);

  if (total > contentWidth) {
    let shrinkable = widths.reduce((sum, value, index) => sum + Math.max(value - baseMinWidths[index], 0), 0);
    if (shrinkable > 0) {
      const overflow = total - contentWidth;
      widths = widths.map((value, index) => {
        const available = Math.max(value - baseMinWidths[index], 0);
        if (available <= 0 || shrinkable <= 0) return value;
        const reduction = Math.min(available, (available / shrinkable) * overflow);
        return value - reduction;
      });
      total = widths.reduce((sum, value) => sum + value, 0);
    }
  }

  if (total < contentWidth) {
    const growableColumns = headRow.map((_, index) => index).filter((index) => wrapSet.has(index));
    const perColumnExtra = growableColumns.length > 0 ? (contentWidth - total) / growableColumns.length : 0;
    widths = widths.map((value, index) => (
      growableColumns.includes(index) ? value + perColumnExtra : value
    ));
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
      "PVPs",
      "Vol. Expedido",
      "Blitz",
      "Zerados",
      "Ativ Extra",
      "Alocação",
      "Devolução",
      "Ter. Conf",
      "Avul. Conf",
      "Ent. Notas",
      "Transf. CD",
      "Reg Lojas",
      "Aud. Caixa",
      "Ronda Qual.",
      "Check List"
    ]];
    const detailsBody = preview.rankingRows.map((row, index) => [
      String(row.posicao > 0 ? row.posicao : index + 1),
      row.nome,
      row.mat,
      `${formatMetric(row.total_pontos, "")} pts`,
      formatRankingPdfPointsAndCount(row.pvps_pontos, row.pvps_qtd, "end", "ends"),
      formatRankingPdfPointsAndCount(row.vol_pontos, row.vol_qtd, "Vol.", "Vol."),
      formatRankingPdfPointsAndCount(row.blitz_pontos, row.blitz_qtd, "un", "un"),
      formatRankingPdfPointsAndCount(row.zerados_pontos, row.zerados_qtd, "end", "ends"),
      formatRankingPdfPointsAndCount(row.atividade_extra_pontos, row.atividade_extra_qtd, "Regist.", "Regist."),
      formatRankingPdfPointsAndCount(row.alocacao_pontos, row.alocacao_qtd, "end", "ends"),
      formatRankingPdfPointsAndCount(row.devolucao_pontos, row.devolucao_qtd, "devol.", "devol."),
      formatRankingPdfPointsAndCount(row.conf_termo_pontos, row.conf_termo_qtd, "sku", "skus"),
      formatRankingPdfPointsAndCount(row.conf_avulso_pontos, row.conf_avulso_qtd, "sku", "skus"),
      formatRankingPdfPointsAndCount(row.conf_entrada_pontos, row.conf_entrada_qtd, "sku", "skus"),
      formatRankingPdfPointsAndCount(row.conf_transferencia_cd_pontos, row.conf_transferencia_cd_qtd, "sku", "skus"),
      formatRankingPdfPointsAndCount(row.conf_lojas_pontos, row.conf_lojas_qtd, "loja", "lojas"),
      formatRankingPdfPointsAndCount(row.aud_caixa_pontos, row.aud_caixa_qtd, "volume", "volumes"),
      formatRankingPdfPointsAndCount(row.ronda_quality_pontos, row.ronda_quality_qtd, "aud.", "aud."),
      formatRankingPdfPointsAndCount(row.checklist_pontos, row.checklist_qtd, "checklist", "checklists")
    ]);
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
        [1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
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
          18: 46
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
          18: 56
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

                {isAdmin && !isDesktop ? (
                  <div className="alert info">A exportação do ranking em PDF está disponível apenas no desktop.</div>
                ) : null}

                {reportError ? <div className="alert error">{reportError}</div> : null}

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
                          const rankingPosition = row.posicao > 0 ? row.posicao : idx + 1;
                          const topClass = rankingPosition <= 3 ? `ranking-top-${rankingPosition}` : "";
                          return (
                            <Fragment key={row.user_id}>
                              <tr className={topClass}>
                                <td align="center">
                                  {rankingPosition === 1
                                    ? "🥇"
                                    : rankingPosition === 2
                                      ? "🥈"
                                      : rankingPosition === 3
                                        ? "🥉"
                                        : `${rankingPosition}º`}
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
                                    <div
                                      className="ranking-details-grid"
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                        gap: "8px",
                                        padding: "16px",
                                        background: "var(--color-bg-alt)",
                                        borderRadius: "8px",
                                        marginTop: "4px"
                                      }}
                                    >
                                      {[
                                        {
                                          label: "PVPs",
                                          value: formatRankingPointsAndCount(row.pvps_pontos, row.pvps_qtd, "end", "ends")
                                        },
                                        {
                                          label: "Vol. Expedido",
                                          value: formatRankingPointsAndCount(row.vol_pontos, row.vol_qtd, "Vol.", "Vol.")
                                        },
                                        {
                                          label: "Blitz",
                                          value: formatRankingPointsAndCount(row.blitz_pontos, row.blitz_qtd, "un", "un")
                                        },
                                        {
                                          label: "Zerados",
                                          value: formatRankingPointsAndCount(row.zerados_pontos, row.zerados_qtd, "end", "ends")
                                        },
                                        {
                                          label: "Ativ Extra",
                                          value: formatRankingPointsAndCount(
                                            row.atividade_extra_pontos,
                                            row.atividade_extra_qtd,
                                            "Regist.",
                                            "Regist."
                                          )
                                        },
                                        {
                                          label: "Alocação",
                                          value: formatRankingPointsAndCount(
                                            row.alocacao_pontos,
                                            row.alocacao_qtd,
                                            "end",
                                            "ends"
                                          )
                                        },
                                        {
                                          label: "Devolução",
                                          value: formatRankingPointsAndCount(
                                            row.devolucao_pontos,
                                            row.devolucao_qtd,
                                            "devol.",
                                            "devol."
                                          )
                                        },
                                        {
                                          label: "Ter. Conf",
                                          value: formatRankingPointsAndCount(
                                            row.conf_termo_pontos,
                                            row.conf_termo_qtd,
                                            "sku",
                                            "skus"
                                          )
                                        },
                                        {
                                          label: "Avul. Conf",
                                          value: formatRankingPointsAndCount(
                                            row.conf_avulso_pontos,
                                            row.conf_avulso_qtd,
                                            "sku",
                                            "skus"
                                          )
                                        },
                                        {
                                          label: "Ent. Notas",
                                          value: formatRankingPointsAndCount(
                                            row.conf_entrada_pontos,
                                            row.conf_entrada_qtd,
                                            "sku",
                                            "skus"
                                          )
                                        },
                                        {
                                          label: "Transf. CD",
                                          value: formatRankingPointsAndCount(
                                            row.conf_transferencia_cd_pontos,
                                            row.conf_transferencia_cd_qtd,
                                            "sku",
                                            "skus"
                                          )
                                        },
                                        {
                                          label: "Reg Lojas",
                                          value: formatRankingPointsAndCount(
                                            row.conf_lojas_pontos,
                                            row.conf_lojas_qtd,
                                            "loja",
                                            "lojas"
                                          )
                                        },
                                        {
                                          label: "Aud. Caixa",
                                          value: formatRankingPointsAndCount(
                                            row.aud_caixa_pontos,
                                            row.aud_caixa_qtd,
                                            "volume",
                                            "volumes"
                                          )
                                        },
                                        {
                                          label: "Ronda Qualidade",
                                          value: formatRankingPointsAndCount(
                                            row.ronda_quality_pontos,
                                            row.ronda_quality_qtd,
                                            "aud.",
                                            "aud."
                                          )
                                        },
                                        {
                                          label: "Check List",
                                          value: formatRankingPointsAndCount(
                                            row.checklist_pontos,
                                            row.checklist_qtd,
                                            "checklist",
                                            "checklists"
                                          )
                                        }
                                      ].map((item) => (
                                        <div key={item.label}>
                                          <strong>{item.label}:</strong>
                                          <br />
                                          {item.value}
                                        </div>
                                      ))}
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
                                  <span>Total bruto do dia: {formatMetric(bucket.total, "")}</span>
                                  <ul className="produtividade-day-items">
                                    {visibleItems.map((row, index) => (
                                      <li key={`${bucket.date}:${row.activity_key}:${index}`}>
                                        {`${row.activity_label}: ${formatMetricWithUnit(row.valor_total, row.unit_label)}`}
                                      </li>
                                    ))}
                                    {!isExpanded && bucket.items.length > 3 ? (
                                      <li className="is-more">{`+${bucket.items.length - 3} atividade(s) — clique para ver todas`}</li>
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
