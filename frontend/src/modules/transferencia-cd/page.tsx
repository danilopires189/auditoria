import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { formatDateOnlyPtBR, todayIsoBrasilia } from "../../shared/brasilia-datetime";
import { getModuleByKeyOrThrow } from "../registry";
import {
  cancelTransferencia,
  countTransferenciaConciliacaoRows,
  fetchCdOptions,
  fetchTransferenciaConciliacaoRows,
  fetchTransferenciaItems,
  finalizeTransferencia,
  normalizeBarcode,
  openTransferenciaNote,
  resetTransferenciaItem,
  scanTransferenciaBarcode,
  searchTransferenciaNotes,
  setTransferenciaItemQtd,
  toTransferenciaErrorMessage
} from "./sync";
import type {
  CdOption,
  TransferenciaCdConferenceRow,
  TransferenciaCdConfStatus,
  TransferenciaCdItemRow,
  TransferenciaCdModuleProfile,
  TransferenciaCdNoteRow,
  TransferenciaCdReportCount,
  TransferenciaCdReportFilters,
  TransferenciaCdReportRow
} from "./types";

interface TransferenciaCdPageProps {
  isOnline: boolean;
  profile: TransferenciaCdModuleProfile;
}

type GroupKey = "falta" | "sobra" | "correto";

const MODULE_DEF = getModuleByKeyOrThrow("transferencia-cd");
const REPORT_PAGE_SIZE = 1000;

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: TransferenciaCdModuleProfile): number | null {
  return profile.cd_default ?? parseCdFromLabel(profile.cd_nome);
}

function parsePositiveInteger(value: string, fallback = 1): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(parsed, 1);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(parsed);
}

function formatReportDate(value: string | null | undefined): string {
  return value ? formatDateOnlyPtBR(value) : "-";
}

function formatStatus(value: TransferenciaCdConfStatus | null | undefined): string {
  if (value === "finalizado_ok") return "Finalizado OK";
  if (value === "finalizado_falta") return "Finalizado com falta";
  if (value === "em_conferencia") return "Em conferência";
  return "Não conferido";
}

function formatEtapa(value: "saida" | "entrada"): string {
  return value === "saida" ? "Saída CD origem" : "Entrada CD destino";
}

function formatConciliacao(value: string): string {
  if (value === "conciliado") return "Conciliado";
  if (value === "divergente") return "Divergente";
  if (value === "pendente_destino") return "Pendente destino";
  if (value === "pendente_origem") return "Pendente origem";
  return "Pendente";
}

function isBrowserDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(min-width: 980px)").matches;
}

function itemSort(a: TransferenciaCdItemRow, b: TransferenciaCdItemRow): number {
  const priority = (item: TransferenciaCdItemRow) => (
    item.qtd_conferida < item.qtd_esperada ? 1 : item.qtd_conferida > item.qtd_esperada ? 2 : 3
  );
  return priority(a) - priority(b) || a.descricao.localeCompare(b.descricao, "pt-BR") || a.coddv - b.coddv;
}

function buildNoteKey(row: Pick<TransferenciaCdReportRow, "dt_nf" | "nf_trf" | "sq_nf" | "cd_ori" | "cd_des">): string {
  return [row.dt_nf, row.nf_trf, row.sq_nf, row.cd_ori, row.cd_des].join("|");
}

function cdLabel(cd: number | null, options: CdOption[], fallback: string | null): string {
  if (cd == null) return "CD não definido";
  const option = options.find((row) => row.cd === cd);
  if (option?.cd_nome) return option.cd_nome;
  return fallback || `CD ${String(cd).padStart(2, "0")}`;
}

function originObservation(conf: TransferenciaCdConferenceRow): string {
  if (conf.etapa !== "entrada") return "";
  if (conf.origem_status === "finalizado_ok" || conf.origem_status === "finalizado_falta") {
    const mat = conf.origem_started_mat ? ` (${conf.origem_started_mat})` : "";
    return `Origem conferida por ${conf.origem_started_nome ?? "usuário"}${mat} em ${formatDateTime(conf.origem_finalized_at ?? conf.origem_started_at)}.`;
  }
  if (conf.origem_status === "em_conferencia") {
    const mat = conf.origem_started_mat ? ` (${conf.origem_started_mat})` : "";
    return `Origem em conferência por ${conf.origem_started_nome ?? "usuário"}${mat} desde ${formatDateTime(conf.origem_started_at)}.`;
  }
  return "Origem ainda não conferiu esta transferência.";
}

export default function TransferenciaCdPage({ isOnline, profile }: TransferenciaCdPageProps) {
  const fixedCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const [isDesktop, setIsDesktop] = useState<boolean>(() => isBrowserDesktop());
  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [currentCd, setCurrentCd] = useState<number | null>(fixedCd);
  const [nfInput, setNfInput] = useState("");
  const [notes, setNotes] = useState<TransferenciaCdNoteRow[]>([]);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [activeConference, setActiveConference] = useState<TransferenciaCdConferenceRow | null>(null);
  const [items, setItems] = useState<TransferenciaCdItemRow[]>([]);
  const [expandedCoddv, setExpandedCoddv] = useState<number | null>(null);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [qtdInput, setQtdInput] = useState("1");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busySearch, setBusySearch] = useState(false);
  const [busyOpen, setBusyOpen] = useState(false);
  const [busyScan, setBusyScan] = useState(false);
  const [busyFinalize, setBusyFinalize] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [faltaMotivo, setFaltaMotivo] = useState("");
  const [showReportPanel, setShowReportPanel] = useState(false);
  const [reportDtIni, setReportDtIni] = useState(todayIsoBrasilia());
  const [reportDtFim, setReportDtFim] = useState(todayIsoBrasilia());
  const [reportCount, setReportCount] = useState<TransferenciaCdReportCount | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportBusySearch, setReportBusySearch] = useState(false);
  const [reportBusyExport, setReportBusyExport] = useState(false);

  const canChangeCd = profile.role === "admin" && fixedCd == null;
  const canSeeReportTools = isDesktop && profile.role === "admin";
  const isReadOnly = activeConference?.is_read_only === true || activeConference?.status !== "em_conferencia";
  const currentCdLabel = cdLabel(currentCd, cdOptions, profile.cd_nome);

  useEffect(() => {
    if (fixedCd != null) setCurrentCd(fixedCd);
  }, [fixedCd]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 980px)");
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCdOptions()
      .then((rows) => {
        if (cancelled) return;
        setCdOptions(rows);
        if (fixedCd == null && currentCd == null && rows.length > 0) setCurrentCd(rows[0].cd);
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(toTransferenciaErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [currentCd, fixedCd]);

  const groupedItems = useMemo(() => {
    const groups: Record<GroupKey, TransferenciaCdItemRow[]> = { falta: [], sobra: [], correto: [] };
    for (const item of [...items].sort(itemSort)) {
      if (item.qtd_conferida < item.qtd_esperada) groups.falta.push(item);
      else if (item.qtd_conferida > item.qtd_esperada) groups.sobra.push(item);
      else groups.correto.push(item);
    }
    return groups;
  }, [items]);

  const totalEsperado = useMemo(() => items.reduce((sum, item) => sum + item.qtd_esperada, 0), [items]);
  const totalConferido = useMemo(() => items.reduce((sum, item) => sum + item.qtd_conferida, 0), [items]);
  const faltaCount = groupedItems.falta.length;
  const sobraCount = groupedItems.sobra.length;

  const refreshItems = useCallback(async (confId: string) => {
    const nextItems = await fetchTransferenciaItems(confId);
    setItems(nextItems);
  }, []);

  const openNote = useCallback(async (note: TransferenciaCdNoteRow) => {
    if (currentCd == null) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setBusyOpen(true);
    try {
      const conference = await openTransferenciaNote(currentCd, note);
      setActiveConference(conference);
      await refreshItems(conference.conf_id);
      setShowNotesModal(false);
      setExpandedCoddv(null);
      setStatusMessage(`NF ${conference.nf_trf} aberta para ${formatEtapa(conference.etapa)}.`);
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    } finally {
      setBusyOpen(false);
    }
  }, [currentCd, refreshItems]);

  const runNoteSearch = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    if (!isOnline) {
      setErrorMessage("Este módulo está disponível apenas online nesta versão.");
      return;
    }
    if (currentCd == null) {
      setErrorMessage("Selecione um CD antes de buscar.");
      return;
    }
    const nfTrf = Number.parseInt(nfInput.replace(/\D/g, ""), 10);
    if (!Number.isFinite(nfTrf)) {
      setErrorMessage("Informe o número da NF.");
      return;
    }
    setBusySearch(true);
    try {
      const rows = await searchTransferenciaNotes(currentCd, nfTrf);
      setNotes(rows);
      if (rows.length === 0) setStatusMessage("Nenhuma transferência encontrada para esta NF.");
      else if (rows.length === 1) await openNote(rows[0]);
      else {
        setShowNotesModal(true);
        setStatusMessage(`${rows.length} sequências encontradas para esta NF.`);
      }
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    } finally {
      setBusySearch(false);
    }
  }, [currentCd, isOnline, nfInput, openNote]);

  const updateItem = useCallback((nextItem: TransferenciaCdItemRow) => {
    setItems((current) => current.map((item) => item.coddv === nextItem.coddv ? nextItem : item));
  }, []);

  const onScanSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (!activeConference || isReadOnly) return;
    const barras = normalizeBarcode(barcodeInput);
    if (!barras) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setBusyScan(true);
    try {
      const qtd = parsePositiveInteger(qtdInput, 1);
      const nextItem = await scanTransferenciaBarcode(activeConference.conf_id, barras, qtd);
      updateItem(nextItem);
      setExpandedCoddv(nextItem.coddv);
      setBarcodeInput("");
      setStatusMessage(`Item ${nextItem.coddv} atualizado.`);
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    } finally {
      setBusyScan(false);
    }
  }, [activeConference, barcodeInput, isReadOnly, qtdInput, updateItem]);

  const onManualQtd = useCallback(async (item: TransferenciaCdItemRow, value: string) => {
    if (!activeConference || isReadOnly) return;
    const qtd = Math.max(0, Number.parseInt(value, 10) || 0);
    setErrorMessage(null);
    try {
      const nextItem = await setTransferenciaItemQtd(activeConference.conf_id, item.coddv, qtd);
      updateItem(nextItem);
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    }
  }, [activeConference, isReadOnly, updateItem]);

  const onResetItem = useCallback(async (item: TransferenciaCdItemRow) => {
    if (!activeConference || isReadOnly) return;
    setErrorMessage(null);
    try {
      const nextItem = await resetTransferenciaItem(activeConference.conf_id, item.coddv);
      updateItem(nextItem);
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    }
  }, [activeConference, isReadOnly, updateItem]);

  const runFinalize = useCallback(async (motivo: string | null) => {
    if (!activeConference || isReadOnly) return;
    setBusyFinalize(true);
    setErrorMessage(null);
    try {
      const finalized = await finalizeTransferencia(activeConference.conf_id, motivo);
      setActiveConference({
        ...activeConference,
        status: finalized.status,
        falta_motivo: finalized.falta_motivo,
        finalized_at: finalized.finalized_at,
        is_read_only: true
      });
      setShowFinalizeModal(false);
      setFaltaMotivo("");
      setStatusMessage("Conferência finalizada com sucesso.");
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    } finally {
      setBusyFinalize(false);
    }
  }, [activeConference, isReadOnly]);

  const requestFinalize = useCallback(() => {
    if (!activeConference || isReadOnly) return;
    if (sobraCount > 0) {
      setErrorMessage("Ajuste os itens com sobra antes de finalizar.");
      return;
    }
    if (faltaCount > 0) {
      setShowFinalizeModal(true);
      return;
    }
    void runFinalize(null);
  }, [activeConference, faltaCount, isReadOnly, runFinalize, sobraCount]);

  const onCancelConference = useCallback(async () => {
    if (!activeConference || isReadOnly) return;
    if (!window.confirm("Cancelar esta conferência?")) return;
    setErrorMessage(null);
    try {
      const cancelled = await cancelTransferencia(activeConference.conf_id);
      if (cancelled) {
        setActiveConference(null);
        setItems([]);
        setStatusMessage("Conferência cancelada.");
      }
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    }
  }, [activeConference, isReadOnly]);

  const validateReportFilters = useCallback((): TransferenciaCdReportFilters | null => {
    if (currentCd == null) {
      setReportError("Selecione um CD para gerar o relatório.");
      return null;
    }
    if (!reportDtIni || !reportDtFim) {
      setReportError("Informe o período do relatório.");
      return null;
    }
    if (reportDtFim < reportDtIni) {
      setReportError("Data final deve ser maior ou igual à data inicial.");
      return null;
    }
    return { dtIni: reportDtIni, dtFim: reportDtFim, cd: currentCd };
  }, [currentCd, reportDtFim, reportDtIni]);

  const runReportSearch = useCallback(async () => {
    if (!canSeeReportTools) return;
    setReportError(null);
    setReportMessage(null);
    const filters = validateReportFilters();
    if (!filters) return;
    setReportBusySearch(true);
    try {
      const count = await countTransferenciaConciliacaoRows(filters);
      setReportCount(count);
      setReportMessage(count.total_itens > 0
        ? `Foram encontrados ${count.total_notas} NF(s) e ${count.total_itens} item(ns).`
        : "Nenhuma transferência encontrada no período."
      );
    } catch (error) {
      setReportError(toTransferenciaErrorMessage(error));
    } finally {
      setReportBusySearch(false);
    }
  }, [canSeeReportTools, validateReportFilters]);

  const runReportExport = useCallback(async () => {
    if (!canSeeReportTools) return;
    setReportError(null);
    setReportMessage(null);
    const filters = validateReportFilters();
    if (!filters) return;
    if ((reportCount?.total_itens ?? 0) <= 0) {
      setReportError("Busque um período com registros antes de exportar o Excel.");
      return;
    }
    setReportBusyExport(true);
    try {
      const expectedItems = reportCount?.total_itens ?? 0;
      const itemRows: TransferenciaCdReportRow[] = [];
      let offset = 0;
      while (offset < expectedItems) {
        const batch = await fetchTransferenciaConciliacaoRows(filters, offset, REPORT_PAGE_SIZE);
        if (!batch.length) break;
        itemRows.push(...batch);
        offset += batch.length;
        setReportMessage(`Baixando itens do relatório: ${itemRows.length}/${expectedItems}.`);
        if (batch.length < REPORT_PAGE_SIZE) break;
      }
      if (expectedItems > 0 && itemRows.length !== expectedItems) {
        throw new Error(`Relatório incompleto: esperado ${expectedItems} item(ns), carregado ${itemRows.length}.`);
      }

      const noteMap = new Map<string, TransferenciaCdReportRow>();
      for (const row of itemRows) {
        const key = buildNoteKey(row);
        if (!noteMap.has(key)) noteMap.set(key, row);
      }
      const noteRows = Array.from(noteMap.values());
      const summaryCounts = noteRows.reduce<Record<string, number>>((acc, row) => {
        acc[row.conciliacao_status] = (acc[row.conciliacao_status] ?? 0) + 1;
        return acc;
      }, {});

      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const summarySheet = XLSX.utils.aoa_to_sheet([
        ["Relatório de Conciliação Transferência CD <> CD"],
        ["Período inicial", formatReportDate(filters.dtIni)],
        ["Período final", formatReportDate(filters.dtFim)],
        ["CD", currentCdLabel],
        [],
        ["Indicador", "Valor"],
        ["Total de NFs", noteRows.length],
        ["Total de itens", itemRows.length],
        ["Conciliadas", summaryCounts.conciliado ?? 0],
        ["Divergentes", summaryCounts.divergente ?? 0],
        ["Pendentes origem", summaryCounts.pendente_origem ?? 0],
        ["Pendentes destino", summaryCounts.pendente_destino ?? 0],
        ["Pendentes", summaryCounts.pendente ?? 0]
      ]);
      const conciliacaoSheet = XLSX.utils.json_to_sheet(noteRows.map((row) => ({
        Data_NF: formatReportDate(row.dt_nf),
        NF: row.nf_trf,
        SQ_NF: row.sq_nf,
        CD_Origem: row.cd_ori,
        Nome_CD_Origem: row.cd_ori_nome,
        CD_Destino: row.cd_des,
        Nome_CD_Destino: row.cd_des_nome,
        Status_Saida: formatStatus(row.saida_status),
        Usuario_Saida: row.saida_started_nome ?? "",
        Matricula_Saida: row.saida_started_mat ?? "",
        Finalizado_Saida: formatDateTime(row.saida_finalized_at),
        Status_Entrada: formatStatus(row.entrada_status),
        Usuario_Entrada: row.entrada_started_nome ?? "",
        Matricula_Entrada: row.entrada_started_mat ?? "",
        Finalizado_Entrada: formatDateTime(row.entrada_finalized_at),
        Situacao: formatConciliacao(row.conciliacao_status)
      })));
      const itemsSheet = XLSX.utils.json_to_sheet(itemRows.map((row) => ({
        Data_NF: formatReportDate(row.dt_nf),
        NF: row.nf_trf,
        SQ_NF: row.sq_nf,
        CD_Origem: row.cd_ori,
        CD_Destino: row.cd_des,
        CODDV: row.coddv,
        Descricao: row.descricao,
        Qtd_Atend: row.qtd_atend,
        Qtd_Conferida_Saida: row.qtd_conferida_saida,
        Qtd_Conferida_Entrada: row.qtd_conferida_entrada,
        Diferenca_Saida_Destino: row.diferenca_saida_destino,
        Embcomp_CX: row.embcomp_cx ?? "",
        Qtd_CXPad: row.qtd_cxpad ?? "",
        Situacao: formatConciliacao(row.conciliacao_status)
      })));
      summarySheet["!cols"] = [{ wch: 34 }, { wch: 24 }];
      conciliacaoSheet["!cols"] = Array.from({ length: 16 }, () => ({ wch: 20 }));
      itemsSheet["!cols"] = Array.from({ length: 14 }, () => ({ wch: 18 }));
      XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumo");
      XLSX.utils.book_append_sheet(workbook, conciliacaoSheet, "Conciliacao");
      XLSX.utils.book_append_sheet(workbook, itemsSheet, "Itens");
      XLSX.writeFile(workbook, `relatorio-transferencia-cd-${filters.dtIni}-${filters.dtFim}-cd${String(filters.cd).padStart(2, "0")}.xlsx`, { compression: true });
      setReportMessage(`Relatório gerado com sucesso (${noteRows.length} NF(s) e ${itemRows.length} item(ns)).`);
    } catch (error) {
      setReportError(toTransferenciaErrorMessage(error));
    } finally {
      setReportBusyExport(false);
    }
  }, [canSeeReportTools, currentCdLabel, reportCount, validateReportFilters]);

  const renderItemGroup = (title: string, groupKey: GroupKey, rows: TransferenciaCdItemRow[]) => {
    if (!rows.length) return null;
    return (
      <div className="termo-list-block">
        <h3>{title}</h3>
        <div className="termo-items-list">
          {rows.map((item) => {
            const expanded = expandedCoddv === item.coddv;
            const pillClass = groupKey === "falta" ? "falta" : groupKey === "sobra" ? "sobra" : "correto";
            const pillLabel = groupKey === "falta" ? `Falta ${item.qtd_falta}` : groupKey === "sobra" ? `Sobra ${item.qtd_sobra}` : "Correto";
            return (
              <article key={`${groupKey}-${item.coddv}`} className={`termo-item-card${expanded ? " is-expanded" : ""}`}>
                <button type="button" className="termo-item-line" onClick={() => setExpandedCoddv(expanded ? null : item.coddv)}>
                  <div className="termo-item-main">
                    <strong>{item.descricao}</strong>
                    <span>CODDV {item.coddv} | Esperado {item.qtd_esperada} | Conferido {item.qtd_conferida}</span>
                  </div>
                  <div className="termo-item-side">
                    <span className={`termo-divergencia ${pillClass}`}>{pillLabel}</span>
                  </div>
                </button>
                {expanded ? (
                  <div className="termo-item-detail">
                    <div className="termo-detail-grid">
                      <span>Qtd atendida: <strong>{item.qtd_esperada}</strong></span>
                      <span>Embcomp CX: <strong>{item.embcomp_cx ?? "-"}</strong></span>
                      <span>Qtd CXPad: <strong>{item.qtd_cxpad ?? "-"}</strong></span>
                      <span>Barras: <strong>{item.barras ?? "-"}</strong></span>
                    </div>
                    <div className="termo-item-actions">
                      <label>
                        Qtd conferida
                        <input
                          type="number"
                          min="0"
                          value={item.qtd_conferida}
                          disabled={isReadOnly}
                          onChange={(event) => void onManualQtd(item, event.target.value)}
                        />
                      </label>
                      <button className="btn btn-muted termo-danger-btn" type="button" disabled={isReadOnly} onClick={() => void onResetItem(item)}>
                        Zerar
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <main className="module-page">
      <section className="module-card module-header-card">
        <Link className="back-link" to="/inicio" aria-label="Voltar ao início">
          <BackIcon />
        </Link>
        <div className="module-header-main">
          <div className={`module-icon tone-${MODULE_DEF.tone}`}>
            <ModuleIcon name={MODULE_DEF.icon} />
          </div>
          <div>
            <h1>{MODULE_DEF.title}</h1>
            <p>Conferência de saída e chegada entre CDs.</p>
          </div>
        </div>
        <span className={`status-pill ${isOnline ? "online" : "offline"}`}>{isOnline ? "Online" : "Offline"}</span>
      </section>

      <section className="modules-shell termo-shell">
        <div className="termo-head">
          <h2>Notas de Transferência</h2>
          <p className="termo-meta-line">{currentCdLabel}</p>
        </div>

        <div className="termo-actions-row">
          <button type="button" className="btn btn-muted termo-route-btn" onClick={() => setShowNotesModal(true)} disabled={!notes.length}>
            Notas
          </button>
          {canSeeReportTools ? (
            <button type="button" className={`btn btn-muted termo-report-toggle${showReportPanel ? " is-active" : ""}`} onClick={() => setShowReportPanel((value) => !value)}>
              Relatório
            </button>
          ) : null}
        </div>

        {showReportPanel && canSeeReportTools ? (
          <section className="termo-report-panel">
            <div className="termo-report-head">
              <h3>Relatório de Conciliação</h3>
              <p>Exportação em Excel por período da nota.</p>
            </div>
            {reportError ? <div className="alert error">{reportError}</div> : null}
            {reportMessage ? <div className="alert success">{reportMessage}</div> : null}
            <div className="termo-report-grid">
              <label>
                Data inicial
                <input type="date" value={reportDtIni} onChange={(event) => setReportDtIni(event.target.value)} />
              </label>
              <label>
                Data final
                <input type="date" value={reportDtFim} onChange={(event) => setReportDtFim(event.target.value)} />
              </label>
            </div>
            <div className="termo-report-actions">
              <button className="btn btn-muted" type="button" disabled={reportBusySearch} onClick={() => void runReportSearch()}>
                {reportBusySearch ? "Buscando..." : "Buscar"}
              </button>
              <button className="btn btn-primary termo-export-btn" type="button" disabled={reportBusyExport || (reportCount?.total_itens ?? 0) <= 0} onClick={() => void runReportExport()}>
                {reportBusyExport ? "Gerando Excel..." : "Exportar Excel"}
              </button>
            </div>
            {reportCount ? <p className="termo-report-count">NFs: {reportCount.total_notas} | Itens: {reportCount.total_itens}</p> : null}
          </section>
        ) : null}

        {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
        {statusMessage ? <div className="alert success">{statusMessage}</div> : null}

        {canChangeCd ? (
          <div className="termo-cd-selector">
            <label>
              CD ativo
              <select
                value={currentCd ?? ""}
                onChange={(event) => {
                  const nextCd = Number.parseInt(event.target.value, 10);
                  setCurrentCd(Number.isFinite(nextCd) ? nextCd : null);
                  setActiveConference(null);
                  setItems([]);
                  setNotes([]);
                }}
              >
                {cdOptions.map((option) => (
                  <option key={option.cd} value={option.cd}>{option.cd_nome || `CD ${option.cd}`}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <form className="termo-form termo-open-form" onSubmit={runNoteSearch}>
          <label>
            Número da NF
            <div className="input-icon-wrap">
              <span className="field-icon" aria-hidden="true"><ModuleIcon name="notes" /></span>
              <input
                type="text"
                inputMode="numeric"
                value={nfInput}
                onChange={(event) => setNfInput(event.target.value.replace(/\D/g, ""))}
                placeholder="Digite ou bip a NF"
              />
            </div>
          </label>
          <button className="btn btn-primary" type="submit" disabled={busySearch || !isOnline}>
            {busySearch ? "Buscando..." : "Buscar NF"}
          </button>
        </form>

        {activeConference ? (
          <article className="termo-volume-card">
            <div className="termo-volume-head">
              <div>
                <span className="termo-kicker">{formatEtapa(activeConference.etapa)}</span>
                <h2>NF {activeConference.nf_trf} | SQ {activeConference.sq_nf}</h2>
                <p>Data NF: {formatReportDate(activeConference.dt_nf)}</p>
                <p>{activeConference.cd_ori_nome} -&gt; {activeConference.cd_des_nome}</p>
                {activeConference.etapa === "entrada" ? <p className="termo-inline-note">{originObservation(activeConference)}</p> : null}
              </div>
              <div className="termo-volume-head-right">
                <span className={`termo-divergencia ${activeConference.status === "finalizado_ok" ? "correto" : activeConference.status === "finalizado_falta" ? "falta" : "andamento"}`}>
                  {formatStatus(activeConference.status)}
                </span>
                <div className="termo-volume-actions">
                  <button className="btn btn-muted termo-close-btn" type="button" onClick={() => { setActiveConference(null); setItems([]); }}>
                    Fechar
                  </button>
                  <button className="btn btn-danger termo-cancel-btn" type="button" disabled={isReadOnly} onClick={() => void onCancelConference()}>
                    Cancelar
                  </button>
                  <button className="btn btn-primary termo-finalize-btn" type="button" disabled={isReadOnly || busyFinalize} onClick={requestFinalize}>
                    {busyFinalize ? "Finalizando..." : "Finalizar"}
                  </button>
                </div>
              </div>
            </div>

            <form className="termo-form termo-scan-form" onSubmit={onScanSubmit}>
              <div className="termo-scan-grid termo-scan-grid-stack">
                <label>
                  Código de barras
                  <input value={barcodeInput} disabled={isReadOnly || busyScan} onChange={(event) => setBarcodeInput(event.target.value)} autoComplete="off" />
                </label>
                <label>
                  Qtd
                  <input type="number" min="1" value={qtdInput} disabled={isReadOnly || busyScan} onChange={(event) => setQtdInput(event.target.value)} />
                </label>
              </div>
              <button className="btn btn-primary" type="submit" disabled={isReadOnly || busyScan}>
                {busyScan ? "Lançando..." : "Lançar"}
              </button>
            </form>

            <div className="termo-summary-grid">
              <span>Itens: <strong>{items.length}</strong></span>
              <span>Qtd atendida: <strong>{totalEsperado}</strong></span>
              <span>Qtd conferida: <strong>{totalConferido}</strong></span>
              <span>Faltas: <strong>{faltaCount}</strong></span>
              <span>Sobras: <strong>{sobraCount}</strong></span>
            </div>

            {renderItemGroup("Itens com falta", "falta", groupedItems.falta)}
            {renderItemGroup("Itens com sobra", "sobra", groupedItems.sobra)}
            {renderItemGroup("Itens corretos", "correto", groupedItems.correto)}
          </article>
        ) : null}
      </section>

      {showNotesModal && typeof document !== "undefined" ? createPortal(
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="transferencia-notas-title" onClick={() => setShowNotesModal(false)}>
          <div className="confirm-dialog termo-routes-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
            <h3 id="transferencia-notas-title">Notas</h3>
            {notes.length === 0 ? <p>Nenhuma NF carregada. Faça a busca pelo número da nota.</p> : null}
            <div className="termo-routes-list">
              {notes.map((note) => (
                <button
                  key={`${note.dt_nf}-${note.nf_trf}-${note.sq_nf}-${note.cd_ori}-${note.cd_des}`}
                  type="button"
                  className="termo-route-row-button termo-route-row-button-volume"
                  disabled={busyOpen}
                  onClick={() => void openNote(note)}
                >
                  <span className="termo-route-main">
                    <span className="termo-route-info">
                      <span className="termo-route-title">NF {note.nf_trf} | SQ {note.sq_nf}</span>
                      <span className="termo-route-sub">{formatReportDate(note.dt_nf)} | {note.cd_ori_nome} -&gt; {note.cd_des_nome}</span>
                      <span className="termo-route-sub">{formatEtapa(note.etapa)}</span>
                    </span>
                    <span className="termo-route-actions-row">
                      <span className="termo-route-items-count">{note.total_itens} item(ns)</span>
                      <span className="termo-divergencia andamento">{formatStatus(note.etapa === "saida" ? note.saida_status : note.entrada_status)}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="confirm-actions">
              <button className="btn btn-muted" type="button" onClick={() => setShowNotesModal(false)}>Fechar</button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {showFinalizeModal && typeof document !== "undefined" ? createPortal(
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="transferencia-finalizar-title" onClick={() => setShowFinalizeModal(false)}>
          <div className="confirm-dialog termo-finalize-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
            <h3 id="transferencia-finalizar-title">Finalizar com falta</h3>
            <p>Informe o motivo da falta para concluir a conferência.</p>
            <label>
              Motivo
              <textarea value={faltaMotivo} onChange={(event) => setFaltaMotivo(event.target.value)} rows={4} />
            </label>
            <div className="confirm-actions">
              <button className="btn btn-muted" type="button" onClick={() => setShowFinalizeModal(false)} disabled={busyFinalize}>Cancelar</button>
              <button className="btn btn-primary" type="button" disabled={busyFinalize || !faltaMotivo.trim()} onClick={() => void runFinalize(faltaMotivo)}>
                {busyFinalize ? "Finalizando..." : "Finalizar"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </main>
  );
}
