import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDateOnlyPtBR, formatDateTimeBrasilia, todayIsoBrasilia } from "../../shared/brasilia-datetime";
import { normalizeBarcode } from "../../shared/db-barras/sync";
import { BackIcon, CalendarIcon, EyeIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import { lookupProduto } from "../busca-produto/sync";
import type { BuscaProdutoLookupResult } from "../busca-produto/types";
import {
  addGestaoEstoqueItem,
  deleteGestaoEstoqueItem,
  fetchGestaoEstoqueAvailableDays,
  fetchGestaoEstoqueList,
  normalizeGestaoEstoqueError,
  updateGestaoEstoqueQuantity
} from "./sync";
import type {
  GestaoEstoqueAvailableDay,
  GestaoEstoqueItemRow,
  GestaoEstoqueModuleProfile,
  GestaoEstoqueMovementType
} from "./types";

interface GestaoEstoquePageProps {
  isOnline: boolean;
  profile: GestaoEstoqueModuleProfile;
}

const MODULE_DEF = getModuleByKeyOrThrow("gestao-estoque");
const REFRESH_INTERVAL_MS = 15000;

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: GestaoEstoqueModuleProfile): number | null {
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

function formatInteger(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const isInteger = Math.abs(safe % 1) < 0.000001;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: isInteger ? 0 : 2,
    maximumFractionDigits: isInteger ? 0 : 2
  }).format(safe);
}

function formatCurrency(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `R$ ${formatNumber(value)}`;
}

function formatDate(value: string | null): string {
  return formatDateOnlyPtBR(value, "-", "value");
}

function normalizeUtcTimestamp(value: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}[ t]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/i.test(raw)) {
    return `${raw.replace(" ", "T")}Z`;
  }

  return raw;
}

function formatDateTime(value: string | null): string {
  return formatDateTimeBrasilia(normalizeUtcTimestamp(value), {
    includeSeconds: true,
    emptyFallback: "-",
    invalidFallback: "value"
  });
}

function movementLabel(value: GestaoEstoqueMovementType): string {
  return value === "entrada" ? "Entrada" : "Baixa";
}

function resolveCdLabel(profile: GestaoEstoqueModuleProfile, cd: number | null): string {
  const raw = typeof profile.cd_nome === "string" ? profile.cd_nome.trim().replace(/\s+/g, " ") : "";
  if (raw) return raw;
  if (cd != null) return `CD ${String(cd).padStart(2, "0")}`;
  return "CD não definido";
}

function joinAddresses(rows: { endereco: string }[]): string {
  if (!rows.length) return "-";
  return rows.map((row) => row.endereco).join(" | ");
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function buildRowSearchBlob(row: GestaoEstoqueItemRow): string {
  return normalizeSearchText([
    row.descricao,
    String(row.coddv),
    movementLabel(row.movement_type),
    row.endereco_sep ?? "",
    row.created_nome,
    row.created_mat,
    row.updated_nome,
    row.updated_mat,
    formatDate(row.dat_ult_compra)
  ].join(" "));
}

function compareDateDesc(left: string, right: string): number {
  return right.localeCompare(left, "pt-BR");
}

function buildDayOptions(today: string, availableDays: GestaoEstoqueAvailableDay[]): GestaoEstoqueAvailableDay[] {
  const byDate = new Map<string, GestaoEstoqueAvailableDay>();
  byDate.set(today, {
    movement_date: today,
    item_count: 0,
    updated_at: null,
    is_today: true
  });
  for (const day of availableDays) {
    byDate.set(day.movement_date, day);
  }
  return [...byDate.values()].sort((left, right) => compareDateDesc(left.movement_date, right.movement_date));
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </svg>
  );
}

export default function GestaoEstoquePage({ isOnline, profile }: GestaoEstoquePageProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocusItemIdRef = useRef<string | null>(null);
  const [movementType, setMovementType] = useState<GestaoEstoqueMovementType>("baixa");
  const [selectedDate, setSelectedDate] = useState(todayIsoBrasilia());
  const [availableDays, setAvailableDays] = useState<GestaoEstoqueAvailableDay[]>([]);
  const [rows, setRows] = useState<GestaoEstoqueItemRow[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [quantidadeInput, setQuantidadeInput] = useState("1");
  const [preview, setPreview] = useState<BuscaProdutoLookupResult | null>(null);
  const [busyLookup, setBusyLookup] = useState(false);
  const [busyList, setBusyList] = useState(false);
  const [busyExport, setBusyExport] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingQuantity, setEditingQuantity] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<GestaoEstoqueItemRow | null>(null);
  const [listSearchInput, setListSearchInput] = useState("");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [actionRow, setActionRow] = useState<GestaoEstoqueItemRow | null>(null);

  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const today = todayIsoBrasilia();
  const isHistorical = selectedDate !== today;
  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const currentCdLabel = useMemo(() => resolveCdLabel(profile, activeCd), [activeCd, profile]);
  const dayOptions = useMemo(() => buildDayOptions(today, availableDays), [availableDays, today]);
  const selectedDayOption = useMemo(
    () => dayOptions.find((day) => day.movement_date === selectedDate) ?? null,
    [dayOptions, selectedDate]
  );
  const totalUnique = rows.length;
  const totalQuantidade = useMemo(() => rows.reduce((acc, row) => acc + row.quantidade, 0), [rows]);
  const totalValor = useMemo(() => rows.reduce((acc, row) => acc + row.custo_total, 0), [rows]);
  const estoqueUpdatedAt = useMemo(() => {
    const candidates = rows
      .map((row) => row.estoque_updated_at)
      .filter((value): value is string => Boolean(value));

    if (preview?.estoque_updated_at) {
      candidates.push(preview.estoque_updated_at);
    }

    if (selectedDayOption?.updated_at) {
      candidates.push(selectedDayOption.updated_at);
    }

    if (candidates.length === 0) return null;

    let latest: string | null = null;
    let latestMs = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      const timestamp = Date.parse(candidate);
      if (!Number.isFinite(timestamp)) continue;
      if (timestamp > latestMs) {
        latestMs = timestamp;
        latest = candidate;
      }
    }
    return latest ?? candidates[0] ?? null;
  }, [preview, rows, selectedDayOption]);
  const listSearchQuery = useMemo(() => normalizeSearchText(listSearchInput), [listSearchInput]);
  const filteredRows = useMemo(() => {
    if (!listSearchQuery) return rows;
    return rows.filter((row) => buildRowSearchBlob(row).includes(listSearchQuery));
  }, [listSearchQuery, rows]);

  const focusSearch = useCallback(() => {
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, []);

  const focusRow = useCallback((itemId: string) => {
    pendingFocusItemIdRef.current = itemId;
    window.requestAnimationFrame(() => {
      const node = rowRefs.current.get(itemId);
      if (!node) return;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.focus();
      pendingFocusItemIdRef.current = null;
    });
  }, []);

  const refreshDays = useCallback(async () => {
    if (activeCd == null) {
      setAvailableDays([]);
      return;
    }
    const nextDays = await fetchGestaoEstoqueAvailableDays(activeCd);
    setAvailableDays(nextDays);
  }, [activeCd]);

  const refreshRows = useCallback(async () => {
    if (activeCd == null) {
      setRows([]);
      return;
    }
    setBusyList(true);
    try {
      const nextRows = await fetchGestaoEstoqueList({
        cd: activeCd,
        date: selectedDate,
        movementType
      });
      setRows(nextRows);
    } finally {
      setBusyList(false);
    }
  }, [activeCd, movementType, selectedDate]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshDays(), refreshRows()]);
  }, [refreshDays, refreshRows]);

  const clearPreview = useCallback(() => {
    setPreview(null);
    setSearchInput("");
    setQuantidadeInput("1");
  }, []);

  const executeLookup = useCallback(async () => {
    const rawValue = searchInput.trim();
    const normalized = normalizeBarcode(rawValue);
    if (!normalized) {
      setErrorMessage("Informe código de barras ou CODDV.");
      setStatusMessage(null);
      setPreview(null);
      focusSearch();
      return;
    }
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      setStatusMessage(null);
      setPreview(null);
      return;
    }

    setBusyLookup(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      let found: BuscaProdutoLookupResult | null = null;
      try {
        found = await lookupProduto({ cd: activeCd, barras: normalized });
      } catch (error) {
        const message = normalizeGestaoEstoqueError(error).toUpperCase();
        if (!message.includes("PRODUTO NÃO ENCONTRADO") && !message.includes("PRODUTO_NAO_ENCONTRADO")) {
          throw error;
        }
      }

      if (!found && /^\d+$/.test(rawValue)) {
        const parsedCoddv = Number.parseInt(rawValue, 10);
        if (Number.isFinite(parsedCoddv) && parsedCoddv > 0) {
          found = await lookupProduto({ cd: activeCd, coddv: parsedCoddv });
        }
      }

      if (!found) {
        setPreview(null);
        setErrorMessage("Produto não encontrado.");
        focusSearch();
        return;
      }

      setPreview(found);
      setStatusMessage("Produto localizado com sucesso.");
      setQuantidadeInput("1");
      focusSearch();
    } catch (error) {
      setPreview(null);
      setErrorMessage(normalizeGestaoEstoqueError(error));
      focusSearch();
    } finally {
      setBusyLookup(false);
    }
  }, [activeCd, focusSearch, searchInput]);

  const startEditingRow = useCallback((row: GestaoEstoqueItemRow) => {
    setEditingItemId(row.id);
    setEditingQuantity(String(row.quantidade));
    setExpandedRowId(row.id);
    focusRow(row.id);
  }, [focusRow]);

  const onSubmitAdd = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (preview == null) {
      await executeLookup();
      return;
    }
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      return;
    }
    if (isHistorical) {
      setErrorMessage("Dias anteriores ficam somente para consulta.");
      return;
    }
    const quantidade = parsePositiveInt(quantidadeInput);
    if (quantidade == null) {
      setErrorMessage("Informe uma quantidade válida.");
      return;
    }
    if (movementType === "baixa" && quantidade > preview.qtd_est_atual) {
      setErrorMessage("A quantidade de baixa excede o estoque atual.");
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await addGestaoEstoqueItem({
        cd: activeCd,
        date: selectedDate,
        movementType,
        coddv: preview.coddv,
        quantidade
      });
      await refreshAll();
      if (result.status === "already_exists") {
        setStatusMessage(result.message);
        startEditingRow(result.row);
        return;
      }

      setStatusMessage(result.message);
      clearPreview();
      focusSearch();
    } catch (error) {
      setErrorMessage(normalizeGestaoEstoqueError(error));
    }
  }, [
    activeCd,
    clearPreview,
    executeLookup,
    focusSearch,
    isHistorical,
    movementType,
    preview,
    quantidadeInput,
    refreshAll,
    selectedDate,
    startEditingRow
  ]);

  const saveEditingRow = useCallback(async (row: GestaoEstoqueItemRow) => {
    const quantidade = parsePositiveInt(editingQuantity);
    if (quantidade == null) {
      setErrorMessage("Informe uma quantidade válida.");
      return;
    }
    try {
      await updateGestaoEstoqueQuantity({
        itemId: row.id,
        quantidade,
        expectedUpdatedAt: row.updated_at
      });
      setStatusMessage("Quantidade atualizada.");
      setErrorMessage(null);
      setEditingItemId(null);
      setEditingQuantity("");
      setExpandedRowId(row.id);
      await refreshAll();
      focusRow(row.id);
    } catch (error) {
      setErrorMessage(normalizeGestaoEstoqueError(error));
    }
  }, [editingQuantity, focusRow, refreshAll]);

  const confirmRemoveRow = useCallback(async () => {
    const row = confirmDeleteRow;
    if (!row || pendingDeleteId) return;
    setPendingDeleteId(row.id);
    try {
      await deleteGestaoEstoqueItem({
        itemId: row.id,
        expectedUpdatedAt: row.updated_at
      });
      setStatusMessage("Item excluído.");
      setErrorMessage(null);
      setEditingItemId((current) => (current === row.id ? null : current));
      setEditingQuantity("");
      setConfirmDeleteRow(null);
      await refreshAll();
      focusSearch();
    } catch (error) {
      setErrorMessage(normalizeGestaoEstoqueError(error));
    } finally {
      setPendingDeleteId(null);
    }
  }, [confirmDeleteRow, focusSearch, pendingDeleteId, refreshAll]);

  const removeRow = useCallback(async (row: GestaoEstoqueItemRow) => {
    if (pendingDeleteId) return;
    setConfirmDeleteRow(row);
  }, [pendingDeleteId]);

  const toggleExpandedRow = useCallback((rowId: string) => {
    setExpandedRowId((current) => (current === rowId ? null : rowId));
  }, []);

  const openRowActions = useCallback((row: GestaoEstoqueItemRow) => {
    setActionRow(row);
  }, []);

  const exportPdf = useCallback(async () => {
    setBusyExport(true);
    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      doc.setFontSize(16);
      doc.text(MODULE_DEF.title, 40, 42);
      doc.setFontSize(10);
      doc.text(`CD: ${currentCdLabel}`, 40, 62);
      doc.text(`Data: ${formatDate(selectedDate)}`, 180, 62);
      doc.text(`Visão: ${movementLabel(movementType)}`, 300, 62);
      doc.text(`Emitido por: ${displayUserName} (${profile.mat || "-"})`, 440, 62);

      autoTable(doc, {
        startY: 78,
        head: [[
          "CodDv",
          "Descrição",
          "Tipo",
          "Quantidade",
          "Últ. compra",
          "Custo unit.",
          "Custo total",
          "End. de Separação",
          "End. de Pulmão",
          "Criado / Editado"
        ]],
        body: rows.map((row) => [
          String(row.coddv),
          row.descricao,
          movementLabel(row.movement_type),
          formatInteger(row.quantidade),
          formatDate(row.dat_ult_compra),
          formatCurrency(row.custo_unitario),
          formatCurrency(row.custo_total),
          row.endereco_sep ?? "-",
          row.endereco_pul ?? "-",
          `${row.created_nome} ${row.created_mat}\n${formatDateTime(row.updated_at)}`
        ]),
        margin: { left: 30, right: 30 },
        styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
        headStyles: { fillColor: [27, 70, 133] }
      });

      doc.save(`gestao-estoque-${movementType}-${selectedDate}.pdf`);
      setStatusMessage("PDF gerado com sucesso.");
      setErrorMessage(null);
      await refreshRows();
    } catch (error) {
      setErrorMessage(normalizeGestaoEstoqueError(error));
    } finally {
      setBusyExport(false);
    }
  }, [currentCdLabel, displayUserName, movementType, profile.mat, refreshRows, rows, selectedDate]);

  const exportXlsx = useCallback(async () => {
    setBusyExport(true);
    try {
      const XLSX = await import("xlsx");
      const itemRows = rows.map((row) => ({
        Data: formatDate(row.movement_date),
        Tipo: movementLabel(row.movement_type),
        CODDV: row.coddv,
        Descricao: row.descricao,
        Quantidade: row.quantidade,
        QtdEstAtual: row.qtd_est_atual,
        QtdEstDisp: row.qtd_est_disp,
        DataUltCompra: formatDate(row.dat_ult_compra),
        CustoUnitario: row.custo_unitario ?? 0,
        CustoTotal: row.custo_total,
        EnderecoSEP: row.endereco_sep ?? "",
        EnderecoPUL: row.endereco_pul ?? "",
        CriadoPor: `${row.created_nome} (${row.created_mat})`,
        CriadoEm: formatDateTime(row.created_at),
        EditadoPor: `${row.updated_nome} (${row.updated_mat})`,
        EditadoEm: formatDateTime(row.updated_at),
        AtualizadoAoVivoEm: formatDateTime(row.resolved_refreshed_at)
      }));
      const summaryRows = [{
        CD: currentCdLabel,
        Data: formatDate(selectedDate),
        Visao: movementLabel(movementType),
        ItensUnicos: totalUnique,
        QuantidadeTotal: totalQuantidade,
        ValorTotal: totalValor
      }];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(itemRows), "Itens");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Resumo");
      XLSX.writeFile(workbook, `gestao-estoque-${movementType}-${selectedDate}.xlsx`, { compression: true });
      setStatusMessage("Excel gerado com sucesso.");
      setErrorMessage(null);
      await refreshRows();
    } catch (error) {
      setErrorMessage(normalizeGestaoEstoqueError(error));
    } finally {
      setBusyExport(false);
    }
  }, [currentCdLabel, movementType, refreshRows, rows, selectedDate, totalQuantidade, totalUnique, totalValor]);

  useEffect(() => {
    void refreshAll().catch((error) => setErrorMessage(normalizeGestaoEstoqueError(error)));
  }, [refreshAll]);

  useEffect(() => {
    const pendingId = pendingFocusItemIdRef.current;
    if (!pendingId) return;
    focusRow(pendingId);
  }, [rows, focusRow]);

  useEffect(() => {
    if (isHistorical) return;
    if (!isOnline) return;

    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshRows().catch((error) => setErrorMessage(normalizeGestaoEstoqueError(error)));
    };

    const timerId = window.setInterval(refreshIfVisible, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timerId);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [isHistorical, isOnline, refreshRows]);

  useEffect(() => {
    focusSearch();
  }, [focusSearch]);

  return (
    <>
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-back-btn" aria-label="Voltar para o início">
            <span className="module-back-icon" aria-hidden="true"><BackIcon /></span>
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
          <span className="module-icon" aria-hidden="true"><ModuleIcon name={MODULE_DEF.icon} /></span>
          <div className="gestao-op-header-copy">
            <span className="module-title">{MODULE_DEF.title}</span>
            <span className="gestao-op-header-cd">{currentCdLabel}</span>
          </div>
        </div>
      </header>

      <section className="module-screen surface-enter gestao-op-screen">
        <div className="module-screen-header">
          <div className="module-screen-title-row">
            <div className="module-screen-title">
              <h2>Ajuste diário de estoque</h2>
            </div>
          </div>
          <div className="gestao-op-header-meta">
            <span className="gestao-op-date-pill">
              Data ativa: {formatDate(selectedDate)} {isHistorical ? "(somente leitura)" : "(dia atual)"}
            </span>
            <span className="gestao-op-date-pill">
              Dados atualizados em: {formatDateTime(estoqueUpdatedAt)}
            </span>
          </div>
        </div>

        <div className="gestao-op-toolbar">
          <div className="gestao-op-segmented" role="tablist" aria-label="Tipo de movimentação">
            <button
              type="button"
              className={movementType === "baixa" ? "is-active" : ""}
              onClick={() => setMovementType("baixa")}
            >
              Baixa
            </button>
            <button
              type="button"
              className={movementType === "entrada" ? "is-active" : ""}
              onClick={() => setMovementType("entrada")}
            >
              Entrada
            </button>
          </div>

          <label className="gestao-op-day-picker">
            <span className="gestao-op-day-icon" aria-hidden="true"><CalendarIcon /></span>
            <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
              {dayOptions.map((day) => (
                <option key={day.movement_date} value={day.movement_date}>
                  {formatDate(day.movement_date)}{day.is_today ? " • Hoje" : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="gestao-op-actions">
            <button className="btn btn-muted" type="button" onClick={() => void exportPdf()} disabled={busyExport || rows.length === 0}>
              {busyExport ? "Gerando..." : "Exportar PDF"}
            </button>
            <button className="btn btn-primary" type="button" onClick={() => void exportXlsx()} disabled={busyExport || rows.length === 0}>
              {busyExport ? "Gerando..." : "Exportar Excel"}
            </button>
          </div>
        </div>

        {statusMessage ? <div className="module-inline-message">{statusMessage}</div> : null}
        {errorMessage ? <div className="module-inline-error">{errorMessage}</div> : null}

        <div className="gestao-op-metrics">
          <article className="module-card module-card-static gestao-op-metric-card">
            <span>Itens únicos</span>
            <strong>{formatInteger(totalUnique)}</strong>
          </article>
          <article className="module-card module-card-static gestao-op-metric-card">
            <span>Quantidade total</span>
            <strong>{formatInteger(totalQuantidade)}</strong>
          </article>
          <article className="module-card module-card-static gestao-op-metric-card">
            <span>Valor total</span>
            <strong>{formatCurrency(totalValor)}</strong>
          </article>
        </div>

        <div className="gestao-op-grid">
          <article className="module-card module-card-static gestao-op-panel">
            <div className="gestao-op-panel-head">
              <h3>Localizar produto</h3>
              <span></span>
            </div>
            <form className="gestao-op-search-form" onSubmit={onSubmitAdd}>
              <div className="gestao-op-field">
                <label htmlFor="gestao-op-search">Barras ou CODDV</label>
                <div className="gestao-op-inline-field">
                  <input
                    id="gestao-op-search"
                    ref={searchInputRef}
                    type="text"
                    value={searchInput}
                    onChange={(event) => {
                      setSearchInput(event.target.value);
                      setPreview(null);
                      setErrorMessage(null);
                      setStatusMessage(null);
                    }}
                    placeholder="Bipar ou digitar código"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="numeric"
                    disabled={isHistorical}
                  />
                  <button className="btn btn-muted" type="button" onClick={() => void executeLookup()} disabled={busyLookup || isHistorical}>
                    {busyLookup ? "Buscando..." : "Buscar"}
                  </button>
                </div>
              </div>

              <div className="gestao-op-field">
                <label htmlFor="gestao-op-qty">Quantidade</label>
                <input
                  id="gestao-op-qty"
                  type="number"
                  min={1}
                  max={movementType === "baixa" && preview ? Math.max(preview.qtd_est_atual, 1) : undefined}
                  value={quantidadeInput}
                  onChange={(event) => setQuantidadeInput(event.target.value)}
                  inputMode="numeric"
                  disabled={isHistorical}
                />
                {movementType === "baixa" && preview ? (
                  <small>Máximo para baixa: {formatInteger(preview.qtd_est_atual)}</small>
                ) : (
                  <small>Para entrada não há limitador.</small>
                )}
              </div>

              <button className="btn btn-primary gestao-op-add-btn" type="submit" disabled={preview == null || isHistorical}>
                Adicionar à lista
              </button>
            </form>
          </article>

          <article className="module-card module-card-static gestao-op-panel">
            <div className="gestao-op-panel-head">
              <h3>Pré-visualização</h3>
              <span>Dados Atualizados</span>
            </div>
            {preview ? (
              <div className="gestao-op-preview">
                <div className="gestao-op-preview-head">
                  <strong>{preview.descricao}</strong>
                  <span>CODDV {preview.coddv}</span>
                </div>
                <dl>
                  <div>
                    <dt>Endereço de Separação</dt>
                    <dd>{joinAddresses(preview.enderecos_sep)}</dd>
                  </div>
                  <div>
                    <dt>Endereço de Pulmão</dt>
                    <dd>{joinAddresses(preview.enderecos_pul)}</dd>
                  </div>
                  <div>
                    <dt>Estoque atual</dt>
                    <dd>{formatInteger(preview.qtd_est_atual)}</dd>
                  </div>
                  <div>
                    <dt>Estoque disponível</dt>
                    <dd>{formatInteger(preview.qtd_est_disp)}</dd>
                  </div>
                  <div>
                    <dt>Últ. compra</dt>
                    <dd>{formatDate(preview.dat_ult_compra)}</dd>
                  </div>
                  <div>
                    <dt>R$ unitário</dt>
                    <dd>{formatCurrency(preview.custo_unitario)}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="coleta-empty">Nenhum produto selecionado.</div>
            )}
          </article>
        </div>

        <article className="module-card module-card-static gestao-op-list-panel">
          <div className="gestao-op-panel-head">
            <h3>Lista da visão atual</h3>
            <span>
              {busyList
                ? "Atualizando..."
                : listSearchQuery
                  ? `${formatInteger(filteredRows.length)} de ${formatInteger(rows.length)} registro(s)`
                  : `${formatInteger(rows.length)} registro(s)`}
            </span>
          </div>
          <div className="gestao-op-list-toolbar">
            <label className="gestao-op-list-search">
              <span>Buscar na lista</span>
              <input
                type="text"
                value={listSearchInput}
                onChange={(event) => setListSearchInput(event.target.value)}
                placeholder="Filtrar por descrição, CODDV, usuário..."
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
          {rows.length === 0 ? (
            <div className="coleta-empty">Nenhum item lançado para esta data e visão.</div>
          ) : filteredRows.length === 0 ? (
            <div className="coleta-empty">Nenhum item encontrado para o filtro informado.</div>
          ) : (
            <div className="gestao-op-table">
              <div className="gestao-op-table-head" role="row">
                <span>Produto</span>
                <span>Qtd</span>
                <span>Últ. compra</span>
                <span>Custo unit.</span>
                <span>Custo total</span>
                <span>Estoque</span>
                <span className="gestao-op-table-head-actions">Ações</span>
              </div>
              {filteredRows.map((row) => {
                const isEditing = editingItemId === row.id;
                const isExpanded = expandedRowId === row.id;
                return (
                  <div
                    key={row.id}
                    ref={(node) => {
                      if (node) rowRefs.current.set(row.id, node);
                      else rowRefs.current.delete(row.id);
                    }}
                    className={`gestao-op-row${isEditing ? " is-editing" : ""}`}
                    tabIndex={-1}
                  >
                    <div className="gestao-op-row-main gestao-op-row-main-table">
                      <button
                        className="gestao-op-row-expand"
                        type="button"
                        onClick={() => toggleExpandedRow(row.id)}
                        aria-expanded={isExpanded}
                      >
                        <span className="gestao-op-row-expand-icon" aria-hidden="true">
                          <EyeIcon open={isExpanded} />
                        </span>
                        <span className="gestao-op-row-title">
                          <strong>{row.descricao}</strong>
                          <span>CODDV {row.coddv} • {movementLabel(row.movement_type)}</span>
                        </span>
                      </button>
                      <span className="gestao-op-row-cell">
                        <span className="gestao-op-row-cell-label">Qtd</span>
                        <span className="gestao-op-row-cell-value">{formatInteger(row.quantidade)}</span>
                      </span>
                      <span className="gestao-op-row-cell">
                        <span className="gestao-op-row-cell-label">Últ. compra</span>
                        <span className="gestao-op-row-cell-value">{formatDate(row.dat_ult_compra)}</span>
                      </span>
                      <span className="gestao-op-row-cell">
                        <span className="gestao-op-row-cell-label">Custo unit.</span>
                        <span className="gestao-op-row-cell-value">{formatCurrency(row.custo_unitario)}</span>
                      </span>
                      <span className="gestao-op-row-cell">
                        <span className="gestao-op-row-cell-label">Custo total</span>
                        <span className="gestao-op-row-cell-value">{formatCurrency(row.custo_total)}</span>
                      </span>
                      <span className="gestao-op-row-cell">
                        <span className="gestao-op-row-cell-label">Estoque</span>
                        <span className="gestao-op-row-cell-value">{formatInteger(row.qtd_est_atual)} atual • {formatInteger(row.qtd_est_disp)} disp.</span>
                      </span>
                    </div>
                    <div className="gestao-op-row-actions">
                      {isHistorical ? (
                        <span className="gestao-op-readonly-badge">Somente leitura</span>
                      ) : (
                        <button
                          className="gestao-op-row-more-btn"
                          type="button"
                          onClick={() => openRowActions(row)}
                          aria-label={`Ações para ${row.descricao}`}
                        >
                          <MoreIcon />
                        </button>
                      )}
                    </div>
                    {isExpanded ? (
                      <div className="gestao-op-row-details">
                        <div className="gestao-op-row-detail-grid">
                          <span><b>Endereço SEP:</b> {row.endereco_sep ?? "-"}</span>
                          <span><b>Endereço PUL:</b> {row.endereco_pul ?? "-"}</span>
                          <span><b>Criado por:</b> {row.created_nome} ({row.created_mat}) em {formatDateTime(row.created_at)}</span>
                          <span><b>Editado por:</b> {row.updated_nome} ({row.updated_mat}) em {formatDateTime(row.updated_at)}</span>
                        </div>
                        {isHistorical ? null : isEditing ? (
                          <div className="gestao-op-row-inline-editor">
                            <input
                              type="number"
                              min={1}
                              max={row.movement_type === "baixa" ? Math.max(row.qtd_est_atual, 1) : undefined}
                              value={editingQuantity}
                              onChange={(event) => setEditingQuantity(event.target.value)}
                              inputMode="numeric"
                            />
                            <button className="btn btn-primary" type="button" onClick={() => void saveEditingRow(row)}>
                              Salvar
                            </button>
                            <button
                              className="btn btn-muted"
                              type="button"
                              onClick={() => {
                                setEditingItemId(null);
                                setEditingQuantity("");
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </section>
      {confirmDeleteRow && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gestao-estoque-delete-title"
              onClick={() => {
                if (pendingDeleteId) return;
                setConfirmDeleteRow(null);
              }}
            >
              <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="gestao-estoque-delete-title">Excluir item da lista</h3>
                <p>
                  {`Deseja excluir "${confirmDeleteRow.descricao}" (CODDV ${confirmDeleteRow.coddv}) da lista de ${movementLabel(confirmDeleteRow.movement_type).toLocaleLowerCase("pt-BR")}? Essa ação ficará registrada no histórico.`}
                </p>
                <div className="confirm-actions">
                  <button
                    className="btn btn-muted"
                    type="button"
                    onClick={() => setConfirmDeleteRow(null)}
                    disabled={pendingDeleteId === confirmDeleteRow.id}
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={() => void confirmRemoveRow()}
                    disabled={pendingDeleteId === confirmDeleteRow.id}
                  >
                    {pendingDeleteId === confirmDeleteRow.id ? "Excluindo..." : "Excluir"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {actionRow && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gestao-estoque-action-title"
              onClick={() => setActionRow(null)}
            >
              <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="gestao-estoque-action-title">O que deseja fazer?</h3>
                <p>{`${actionRow.descricao} (CODDV ${actionRow.coddv})`}</p>
                <div className="gestao-op-choice-actions">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => {
                      startEditingRow(actionRow);
                      setActionRow(null);
                    }}
                  >
                    Editar quantidade
                  </button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={() => {
                      setActionRow(null);
                      void removeRow(actionRow);
                    }}
                  >
                    Excluir item
                  </button>
                  <button className="btn btn-muted" type="button" onClick={() => setActionRow(null)}>
                    Cancelar
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
