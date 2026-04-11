import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { IScannerControls } from "@zxing/browser";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import { formatDateOnlyPtBR, formatDateTimeBrasilia, todayIsoBrasilia } from "../../shared/brasilia-datetime";
import { formatCountLabel } from "../../shared/inflection";
import { getDbBarrasByBarcode, getDbBarrasMeta } from "../../shared/db-barras/storage";
import { refreshDbBarrasCacheSmart } from "../../shared/db-barras/sync";
import { shouldUseQueuedMutationFlow } from "../../shared/offline/queue-policy";
import { useOnDemandSoftKeyboard } from "../../shared/use-on-demand-soft-keyboard";
import { useScanFeedback } from "../../shared/use-scan-feedback";
import { getModuleByKeyOrThrow } from "../registry";
import {
  buildTransferenciaCdConferenceKey,
  cleanupExpiredTransferenciaCdConferences,
  getLocalConference,
  getManifestItemsByNote,
  getManifestMetaLocal,
  getPendingSummary,
  getTransferenciaCdPreferences,
  listUserLocalConferences,
  listManifestNotesLocal,
  saveLocalConference,
  saveManifestSnapshot,
  saveTransferenciaCdPreferences
} from "./storage";
import {
  cancelTransferencia,
  countTransferenciaConciliacaoRows,
  fetchActiveTransferenciaConference,
  fetchCdOptions,
  fetchManifestBundle,
  fetchManifestNotes,
  fetchTransferenciaConciliacaoRows,
  fetchTransferenciaItems,
  finalizeTransferencia,
  isTransferenciaActiveConferenceConflict,
  normalizeBarcode,
  openTransferenciaNote,
  resetTransferenciaItem,
  scanTransferenciaBarcode,
  searchTransferenciaNotes,
  setTransferenciaItemQtd,
  syncPendingTransferenciaCdConferences,
  toTransferenciaErrorMessage
} from "./sync";
import type {
  CdOption,
  TransferenciaCdConfStatus,
  TransferenciaCdDivergenciaTipo,
  TransferenciaCdEtapa,
  TransferenciaCdItemRow,
  TransferenciaCdLocalConference,
  TransferenciaCdLocalItem,
  TransferenciaCdManifestItemRow,
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
type ScannerTarget = "nf" | "barras";
type DialogState = { title: string; message: string; confirmLabel?: string; onConfirm?: () => void };
type OcorrenciaTipo = "" | "Avariado" | "Vencido";

const MODULE_DEF = getModuleByKeyOrThrow("transferencia-cd");
const REPORT_PAGE_SIZE = 1000;

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact.toLocaleLowerCase("pt-BR").split(" ").map((chunk) => (
    chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1)
  )).join(" ");
}

function parseCdFromLabel(label: string | null): number | null {
  const matched = /cd\s*0*(\d+)/i.exec(label ?? "");
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: TransferenciaCdModuleProfile): number | null {
  return typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)
    ? Math.trunc(profile.cd_default)
    : parseCdFromLabel(profile.cd_nome);
}

function parsePositiveInteger(value: string, fallback = 1): number {
  const parsed = Number.parseInt(value.replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatDateTime(value: string | null | undefined): string {
  return formatDateTimeBrasilia(value ?? null, { includeSeconds: true, emptyFallback: "-", invalidFallback: "-" });
}

function formatReportDate(value: string | null | undefined): string {
  return formatDateOnlyPtBR(value ?? null, "-");
}

function formatStatus(value: TransferenciaCdConfStatus | null | undefined): string {
  if (value === "finalizado_ok") return "Finalizado OK";
  if (value === "finalizado_falta") return "Finalizado com falta";
  if (value === "em_conferencia") return "Em conferência";
  return "Não conferido";
}

function formatEtapa(value: TransferenciaCdEtapa): string {
  return value === "saida" ? "📤 Mercadoria a enviar" : "📥 Mercadoria a receber";
}

function formatConciliacao(value: string): string {
  if (value === "conciliado") return "Conciliado";
  if (value === "divergente") return "Divergente";
  if (value === "pendente_destino") return "Pendente destino";
  if (value === "pendente_origem") return "Pendente origem";
  return "Pendente";
}

function formatPercent(value: number): string {
  const rounded = Math.round(Math.max(0, Math.min(value, 100)) * 10) / 10;
  return `${rounded.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function itemSort(a: TransferenciaCdLocalItem, b: TransferenciaCdLocalItem): number {
  return a.descricao.localeCompare(b.descricao, "pt-BR") || a.coddv - b.coddv;
}

function withDivergencia(item: TransferenciaCdLocalItem): {
  item: TransferenciaCdLocalItem;
  divergencia: TransferenciaCdDivergenciaTipo;
  qtd_falta: number;
  qtd_sobra: number;
} {
  const qtd_falta = Math.max(item.qtd_esperada - item.qtd_conferida, 0);
  const qtd_sobra = Math.max(item.qtd_conferida - item.qtd_esperada, 0);
  const divergencia = qtd_falta > 0 ? "falta" : qtd_sobra > 0 ? "sobra" : "correto";
  return { item, divergencia, qtd_falta, qtd_sobra };
}

function normalizeOccurrenceForQtd(avariado: number, vencido: number, qtdConferida: number): { avariado: number; vencido: number } {
  const qtd = Math.max(0, Math.trunc(qtdConferida));
  let nextAvariado = Math.max(0, Math.trunc(avariado));
  let nextVencido = Math.max(0, Math.trunc(vencido));
  let overflow = nextAvariado + nextVencido - qtd;
  if (overflow <= 0) return { avariado: nextAvariado, vencido: nextVencido };
  const reduceVencido = Math.min(nextVencido, overflow);
  nextVencido -= reduceVencido;
  overflow -= reduceVencido;
  if (overflow > 0) nextAvariado = Math.max(0, nextAvariado - overflow);
  return { avariado: nextAvariado, vencido: nextVencido };
}

function itemPackageLabel(item: TransferenciaCdLocalItem): string {
  const caixas = item.qtd_cxpad == null ? "-" : item.qtd_cxpad;
  const unidades = item.embcomp_cx == null ? "-" : item.embcomp_cx;
  return `${caixas} caixa(s) com ${unidades} un em cada caixa`;
}

function formatItemCount(value: number): string {
  return formatCountLabel(value, "Item", "Itens");
}

function noteStatus(note: TransferenciaCdNoteRow): TransferenciaCdConfStatus | null {
  return note.etapa === "saida" ? note.saida_status : note.entrada_status;
}

function noteStatusDetail(note: TransferenciaCdNoteRow): string {
  const status = noteStatus(note);
  if (!status) return "";
  const nome = note.etapa === "saida" ? note.saida_started_nome : note.entrada_started_nome;
  const mat = note.etapa === "saida" ? note.saida_started_mat : note.entrada_started_mat;
  const startedAt = note.etapa === "saida" ? note.saida_started_at : note.entrada_started_at;
  const finalizedAt = note.etapa === "saida" ? note.saida_finalized_at : note.entrada_finalized_at;
  const userLabel = `${nome ?? "usuário"}${mat ? ` (${mat})` : ""}`;
  if (status === "em_conferencia") return `Em conferência por ${userLabel} desde ${formatDateTime(startedAt)}.`;
  return `Concluído por ${userLabel} em ${formatDateTime(finalizedAt ?? startedAt)}.`;
}

function activeConferenceStatusDetail(conf: TransferenciaCdLocalConference): string {
  const userLabel = `${conf.started_nome || "usuário"}${conf.started_mat ? ` (${conf.started_mat})` : ""}`;
  if (conf.status === "em_conferencia") return `Em conferência por ${userLabel} desde ${formatDateTime(conf.started_at)}.`;
  return `Concluído por ${userLabel} em ${formatDateTime(conf.finalized_at ?? conf.updated_at ?? conf.started_at)}.`;
}

function conferenceResumeLabel(conf: Pick<TransferenciaCdLocalConference, "nf_trf" | "sq_nf" | "etapa">): string {
  return `NF ${conf.nf_trf}/${conf.sq_nf} (${formatEtapa(conf.etapa)})`;
}

function deriveConferenceCd(conf: Pick<TransferenciaCdLocalConference, "etapa" | "cd_ori" | "cd_des">): number {
  return conf.etapa === "saida" ? conf.cd_ori : conf.cd_des;
}

function routeStatusLabel(status: TransferenciaCdConfStatus | null): string {
  if (status === "finalizado_ok" || status === "finalizado_falta") return "Concluído";
  if (status === "em_conferencia") return "Em andamento";
  return "Pendente";
}

function routeStatusClass(status: TransferenciaCdConfStatus | null): "correto" | "andamento" | "falta" {
  if (status === "finalizado_ok" || status === "finalizado_falta") return "correto";
  if (status === "em_conferencia") return "andamento";
  return "falta";
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

function cdLabel(cd: number | null, options: CdOption[], fallback: string | null): string {
  if (cd == null) return "CD não definido";
  return options.find((row) => row.cd === cd)?.cd_nome || fallback || `CD ${String(cd).padStart(2, "0")}`;
}

function icon(path: ReactNode) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{path}</svg>;
}

function barcodeIcon() { return icon(<><path d="M4 6v12" /><path d="M7 6v12" /><path d="M10 6v12" /><path d="M14 6v12" /><path d="M18 6v12" /><path d="M20 6v12" /><path d="M3 4h18" /><path d="M3 20h18" /></>); }
function cameraIcon() { return icon(<><path d="M4 7h4l1.5-2h5L16 7h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="4" /></>); }
function quantityIcon() { return icon(<><path d="M6 8h12" /><path d="M12 4v16" /><circle cx="12" cy="12" r="9" /></>); }
function refreshIcon() { return icon(<><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>); }
function listIcon() { return icon(<><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><circle cx="4" cy="6" r="1.2" /><circle cx="4" cy="12" r="1.2" /><circle cx="4" cy="18" r="1.2" /></>); }
function reportIcon() { return icon(<><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" /><path d="M9 12h6" /><path d="M9 16h6" /></>); }
function closeIcon() { return icon(<><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>); }
function checkIcon() { return icon(<path d="M5 12.5l4.2 4.2L19 7" />); }
function chevronIcon(open: boolean) { return icon(open ? <path d="M6 14l6-6 6 6" /> : <path d="M6 10l6 6 6-6" />); }
function searchIcon() { return icon(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.7-3.7" /></>); }
function startConferenceIcon() { return icon(<path d="M8 6v12l10-6z" />); }
function resumeConferenceIcon() { return icon(<><path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 4v4h4" /></>); }

function buildReportNoteKey(row: Pick<TransferenciaCdReportRow, "dt_nf" | "nf_trf" | "sq_nf" | "cd_ori" | "cd_des">): string {
  return [row.dt_nf, row.nf_trf, row.sq_nf, row.cd_ori, row.cd_des].join("|");
}

function originObservation(conf: TransferenciaCdLocalConference): string {
  if (conf.etapa !== "entrada") return "";
  if (conf.origem_status === "finalizado_ok" || conf.origem_status === "finalizado_falta") {
    const mat = conf.origem_started_mat ? ` (${conf.origem_started_mat})` : "";
    return `O CD origem conferiu esta transferência: ${conf.origem_started_nome ?? "usuário"}${mat} em ${formatDateTime(conf.origem_finalized_at ?? conf.origem_started_at)}.`;
  }
  if (conf.origem_status === "em_conferencia") {
    const mat = conf.origem_started_mat ? ` (${conf.origem_started_mat})` : "";
    return `O CD origem está conferindo esta transferência: ${conf.origem_started_nome ?? "usuário"}${mat} desde ${formatDateTime(conf.origem_started_at)}.`;
  }
  return "O CD origem ainda não conferiu esta transferência.";
}

function localFromRemote(profile: TransferenciaCdModuleProfile, cd: number, conf: Omit<TransferenciaCdLocalConference, "local_key" | "user_id" | "cd" | "remote_conf_id" | "items" | "pending_snapshot" | "pending_finalize" | "pending_finalize_reason" | "pending_cancel" | "sync_error" | "last_synced_at">, items: TransferenciaCdItemRow[]): TransferenciaCdLocalConference {
  return {
    ...conf,
    local_key: buildTransferenciaCdConferenceKey(profile.user_id, cd, conf.etapa, conf),
    user_id: profile.user_id,
    cd,
    remote_conf_id: conf.conf_id,
    items: items.map((item) => ({
      coddv: item.coddv,
      barras: item.barras,
      descricao: item.descricao,
      qtd_esperada: item.qtd_esperada,
      qtd_conferida: item.qtd_conferida,
      embcomp_cx: item.embcomp_cx,
      qtd_cxpad: item.qtd_cxpad,
      ocorrencia_avariado_qtd: item.ocorrencia_avariado_qtd,
      ocorrencia_vencido_qtd: item.ocorrencia_vencido_qtd,
      updated_at: item.updated_at
    })).sort(itemSort),
    pending_snapshot: false,
    pending_finalize: false,
    pending_finalize_reason: null,
    pending_cancel: false,
    sync_error: null,
    last_synced_at: new Date().toISOString()
  };
}

function localFromManifest(profile: TransferenciaCdModuleProfile, cd: number, note: TransferenciaCdNoteRow, manifestItems: TransferenciaCdManifestItemRow[]): TransferenciaCdLocalConference {
  const nowIso = new Date().toISOString();
  return {
    local_key: buildTransferenciaCdConferenceKey(profile.user_id, cd, note.etapa, note),
    user_id: profile.user_id,
    cd,
    remote_conf_id: null,
    conf_id: buildTransferenciaCdConferenceKey(profile.user_id, cd, note.etapa, note),
    conf_date: todayIsoBrasilia(),
    dt_nf: note.dt_nf,
    nf_trf: note.nf_trf,
    sq_nf: note.sq_nf,
    cd_ori: note.cd_ori,
    cd_des: note.cd_des,
    cd_ori_nome: note.cd_ori_nome,
    cd_des_nome: note.cd_des_nome,
    etapa: note.etapa,
    status: "em_conferencia",
    falta_motivo: null,
    started_by: profile.user_id,
    started_mat: profile.mat || "",
    started_nome: profile.nome || "Usuário",
    started_at: nowIso,
    finalized_at: null,
    updated_at: nowIso,
    is_read_only: false,
    origem_status: note.saida_status,
    origem_started_mat: note.saida_started_mat,
    origem_started_nome: note.saida_started_nome,
    origem_started_at: note.saida_started_at,
    origem_finalized_at: note.saida_finalized_at,
    items: manifestItems.map((row) => ({
      coddv: row.coddv,
      barras: null,
      descricao: row.descricao,
      qtd_esperada: row.qtd_esperada,
      qtd_conferida: 0,
      embcomp_cx: row.embcomp_cx,
      qtd_cxpad: row.qtd_cxpad,
      ocorrencia_avariado_qtd: 0,
      ocorrencia_vencido_qtd: 0,
      updated_at: nowIso
    })).sort(itemSort),
    pending_snapshot: true,
    pending_finalize: false,
    pending_finalize_reason: null,
    pending_cancel: false,
    sync_error: null,
    last_synced_at: null
  };
}

export default function TransferenciaCdPage({ isOnline, profile }: TransferenciaCdPageProps) {
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const nfRef = useRef<HTMLInputElement | null>(null);
  const barrasRef = useRef<HTMLInputElement | null>(null);
  const { scanFeedback, scanFeedbackTop, showScanFeedback, triggerScanErrorAlert } = useScanFeedback(useCallback(() => barrasRef.current, []));
  const { inputMode: barcodeInputMode, enableSoftKeyboard, disableSoftKeyboard } = useOnDemandSoftKeyboard("numeric");

  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 980px)").matches);
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [manifestReady, setManifestReady] = useState(false);
  const [manifestInfo, setManifestInfo] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingErrors, setPendingErrors] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [cdAtivo, setCdAtivo] = useState<number | null>(null);
  const [nfInput, setNfInput] = useState("");
  const [notes, setNotes] = useState<TransferenciaCdNoteRow[]>([]);
  const [onlineOverviewNotes, setOnlineOverviewNotes] = useState<TransferenciaCdNoteRow[]>([]);
  const [manifestNotes, setManifestNotes] = useState<TransferenciaCdNoteRow[]>([]);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notesSearchInput, setNotesSearchInput] = useState("");
  const [activeConference, setActiveConference] = useState<TransferenciaCdLocalConference | null>(null);
  const [expandedCoddv, setExpandedCoddv] = useState<number | null>(null);
  const [editingCoddv, setEditingCoddv] = useState<number | null>(null);
  const [lastAddedCoddv, setLastAddedCoddv] = useState<number | null>(null);
  const [editQtdInput, setEditQtdInput] = useState("0");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeValidationState, setBarcodeValidationState] = useState<"idle" | "validating" | "valid" | "invalid">("idle");
  const [multiploInput, setMultiploInput] = useState("1");
  const [ocorrenciaInput, setOcorrenciaInput] = useState<OcorrenciaTipo>("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<ScannerTarget>("barras");
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [showReportPanel, setShowReportPanel] = useState(false);
  const [reportDtIni, setReportDtIni] = useState("");
  const [reportDtFim, setReportDtFim] = useState("");
  const [reportCount, setReportCount] = useState<TransferenciaCdReportCount | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportBusySearch, setReportBusySearch] = useState(false);
  const [reportBusyExport, setReportBusyExport] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [finalizeMotivo, setFinalizeMotivo] = useState("");
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [busyManifest, setBusyManifest] = useState(false);
  const [busyOpen, setBusyOpen] = useState(false);
  const [busyScan, setBusyScan] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [busyFinalize, setBusyFinalize] = useState(false);
  const [busyCancel, setBusyCancel] = useState(false);
  const [dialogState, setDialogState] = useState<DialogState | null>(null);

  const isGlobalAdmin = profile.role === "admin" && profile.cd_default == null;
  const fixedCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const currentCd = isGlobalAdmin ? cdAtivo : fixedCd;
  const currentCdLabel = useMemo(() => cdLabel(currentCd, cdOptions, profile.cd_nome), [cdOptions, currentCd, profile.cd_nome]);
  const canSeeReportTools = isDesktop && profile.role === "admin";
  const canEditActiveConference = Boolean(activeConference && !activeConference.is_read_only && activeConference.started_by === profile.user_id);
  const hasOpenConference = Boolean(activeConference && activeConference.status === "em_conferencia" && !activeConference.is_read_only);
  const hasAnyItemInformed = Boolean(activeConference?.items.some((item) => item.qtd_conferida > 0));
  const isReceivingActiveConference = activeConference?.etapa === "entrada";
  const qtdAtendidaLabel = isReceivingActiveConference ? "Qtd a receber" : "Qtd a enviar";
  const barcodeIconClassName = `field-icon validation-status${barcodeValidationState === "validating" ? " is-validating" : ""}${barcodeValidationState === "valid" ? " is-valid" : ""}${barcodeValidationState === "invalid" ? " is-invalid" : ""}`;

  const groupedItems = useMemo(() => {
    const groups = { falta: [], sobra: [], correto: [] } as Record<GroupKey, Array<ReturnType<typeof withDivergencia>>>;
    for (const row of activeConference?.items.map(withDivergencia) ?? []) {
      groups[row.divergencia].push(row);
    }
    groups.falta.sort((a, b) => itemSort(a.item, b.item));
    groups.sobra.sort((a, b) => itemSort(a.item, b.item));
    groups.correto.sort((a, b) => itemSort(a.item, b.item));
    return groups;
  }, [activeConference]);

  const divergenciaTotals = {
    falta: groupedItems.falta.length,
    sobra: groupedItems.sobra.length,
    correto: groupedItems.correto.length
  };
  const overviewNotes = preferOfflineMode || !isOnline
    ? manifestNotes
    : onlineOverviewNotes.length ? onlineOverviewNotes : manifestNotes;
  const modalNotes = notes.length ? notes : overviewNotes;
  const filteredModalNotes = useMemo(() => {
    const needle = normalizeSearchText(notesSearchInput);
    if (!needle) return modalNotes;
    return modalNotes.filter((row) => normalizeSearchText([
      row.nf_trf,
      row.sq_nf,
      row.dt_nf,
      row.cd_ori_nome,
      row.cd_des_nome,
      formatEtapa(row.etapa),
      routeStatusLabel(noteStatus(row)),
      noteStatusDetail(row)
    ].join(" ")).includes(needle));
  }, [modalNotes, notesSearchInput]);
  const completionStats = useMemo(() => {
    const rows = overviewNotes.length ? overviewNotes : notes;
    const completed = rows.filter((row) => {
      const status = noteStatus(row);
      return status === "finalizado_ok" || status === "finalizado_falta";
    }).length;
    return { total: rows.length, completed, percent: rows.length ? (completed / rows.length) * 100 : 0 };
  }, [notes, overviewNotes]);

  const refreshPendingState = useCallback(async () => {
    const pending = await getPendingSummary(profile.user_id);
    setPendingCount(pending.pending_count);
    setPendingErrors(pending.errors_count);
  }, [profile.user_id]);

  const persistPreferences = useCallback(async (next: { prefer_offline_mode?: boolean; multiplo_padrao?: number; cd_ativo?: number | null }) => {
    const current = await getTransferenciaCdPreferences(profile.user_id);
    await saveTransferenciaCdPreferences(profile.user_id, {
      prefer_offline_mode: next.prefer_offline_mode ?? current.prefer_offline_mode,
      multiplo_padrao: next.multiplo_padrao ?? current.multiplo_padrao,
      cd_ativo: next.cd_ativo ?? current.cd_ativo
    });
  }, [profile.user_id]);

  const refreshManifestInfo = useCallback(async (cd: number | null) => {
    if (cd == null) return;
    const [meta, localNotes, barrasMeta] = await Promise.all([
      getManifestMetaLocal(profile.user_id, cd),
      listManifestNotesLocal(profile.user_id, cd),
      getDbBarrasMeta()
    ]);
    setManifestReady(Boolean(meta) && barrasMeta.row_count > 0);
    setManifestNotes(localNotes);
    setManifestInfo(meta
      ? `Base local: Transferência CD ${formatItemCount(meta.row_count)} | ${meta.notas_count} nota(s) | Barras ${formatItemCount(barrasMeta.row_count)} | Atualizada em ${formatDateTime(meta.cached_at ?? meta.generated_at)}`
      : "Sem base local de Transferência CD. Sincronize antes de trabalhar offline."
    );
  }, [profile.user_id]);

  const setAndSaveActiveConference = useCallback(async (next: TransferenciaCdLocalConference) => {
    await saveLocalConference(next);
    setActiveConference(next);
    await refreshPendingState();
  }, [refreshPendingState]);

  const activateConference = useCallback(async (
    next: TransferenciaCdLocalConference,
    options?: { silent?: boolean; message?: string | null }
  ) => {
    const nextCd = deriveConferenceCd(next);
    if (isGlobalAdmin && cdAtivo !== nextCd) {
      setCdAtivo(nextCd);
      void persistPreferences({ cd_ativo: nextCd });
    }
    await setAndSaveActiveConference(next);
    setNfInput(String(next.nf_trf));
    setShowNotesModal(false);
    setNotes([]);
    setEditingCoddv(null);
    setExpandedCoddv(null);
    if (!options?.silent) {
      setStatusMessage(options?.message ?? `Conferência retomada automaticamente: ${conferenceResumeLabel(next)}.`);
    }
    return next;
  }, [cdAtivo, isGlobalAdmin, persistPreferences, setAndSaveActiveConference]);

  const resumeLocalActiveConference = useCallback(async (silent = false): Promise<TransferenciaCdLocalConference | null> => {
    const rows = await listUserLocalConferences(profile.user_id);
    const openRows = rows.filter((row) => row.status === "em_conferencia" && !row.pending_cancel);
    const local = openRows[0] ?? null;
    if (!local) return null;
    return activateConference(local, { silent });
  }, [activateConference, profile.user_id]);

  const resumeRemoteActiveConference = useCallback(async (silent = false): Promise<TransferenciaCdLocalConference | null> => {
    if (preferOfflineMode || !isOnline) return null;
    const remoteActive = await fetchActiveTransferenciaConference();
    if (!remoteActive || remoteActive.status !== "em_conferencia") return null;
    const remoteCd = deriveConferenceCd(remoteActive);
    const remoteItems = await fetchTransferenciaItems(remoteActive.conf_id);
    const local = localFromRemote(profile, remoteCd, remoteActive, remoteItems);
    return activateConference(local, { silent });
  }, [activateConference, isOnline, preferOfflineMode, profile]);

  const queueModeFor = useCallback((conference: TransferenciaCdLocalConference) => (
    shouldUseQueuedMutationFlow({ isOnline, preferOfflineMode, hasRemoteTarget: Boolean(conference.remote_conf_id) }) || !conference.remote_conf_id
  ), [isOnline, preferOfflineMode]);

  const runPendingSync = useCallback(async (silent = false) => {
    if (!isOnline || busySync) return;
    setBusySync(true);
    if (!silent) {
      setStatusMessage(null);
      setErrorMessage(null);
    }
    try {
      const result = await syncPendingTransferenciaCdConferences(profile.user_id);
      await refreshPendingState();
      if (activeConference) setActiveConference(await getLocalConference(activeConference.local_key));
      if (!silent) {
        if (result.failed > 0) setErrorMessage(`${formatCountLabel(result.failed, "pendência", "pendências")} com falha na sincronização da Transferência CD.`);
        else if (result.processed > 0) setStatusMessage(`Sincronização concluída (${formatCountLabel(result.synced, "pendência processada", "pendências processadas")}).`);
        else setStatusMessage("Sem pendências de conferência para sincronizar.");
      }
    } catch (error) {
      if (!silent) setErrorMessage(toTransferenciaErrorMessage(error));
    } finally {
      setBusySync(false);
    }
  }, [activeConference, busySync, isOnline, profile.user_id, refreshPendingState]);

  const runManifestSync = useCallback(async () => {
    if (!isOnline || currentCd == null) {
      setErrorMessage("Conecte e selecione o CD para sincronizar.");
      return;
    }
    setBusyManifest(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      await runPendingSync(true);
      const bundle = await fetchManifestBundle(currentCd, (progress) => {
        const label = progress.step === "items" ? "itens" : progress.step === "barras" ? "barras" : "notas";
        setProgressMessage(`Sincronizando ${label}: ${progress.rows}/${progress.total || progress.rows} (${progress.percent}%).`);
      }, { includeBarras: false });
      await saveManifestSnapshot({ user_id: profile.user_id, cd: currentCd, ...bundle });
      const barrasSync = await refreshDbBarrasCacheSmart((progress) => {
        if (progress.totalRows > 0) setProgressMessage(`Atualizando base de barras: ${progress.rowsFetched}/${progress.totalRows} (${progress.percent}%).`);
        else setProgressMessage(`Atualizando base de barras: ${progress.percent}%.`);
      }, { allowFullReconcile: true });
      await refreshManifestInfo(currentCd);
      setOnlineOverviewNotes(bundle.notes);
      setNotes([]);
      setStatusMessage(`Base de Transferência CD sincronizada (${bundle.notes.length} NF(s), ${formatItemCount(bundle.items.length)} e ${barrasSync.total} barras).`);
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    } finally {
      setProgressMessage(null);
      setBusyManifest(false);
    }
  }, [currentCd, isOnline, profile.user_id, refreshManifestInfo, runPendingSync]);

  const handleToggleOffline = useCallback(async () => {
    const next = !preferOfflineMode;
    if (!next) {
      setPreferOfflineMode(false);
      await persistPreferences({ prefer_offline_mode: false });
      return;
    }
    if (!isOnline) {
      if (!manifestReady) {
        setErrorMessage("Conecte para preparar a base de Transferência CD e a base de barras antes de ativar o offline.");
        return;
      }
      setPreferOfflineMode(true);
      await persistPreferences({ prefer_offline_mode: true });
      return;
    }
    if (!manifestReady) {
      await runManifestSync();
      const [meta, barrasMeta] = await Promise.all([
        currentCd == null ? Promise.resolve(null) : getManifestMetaLocal(profile.user_id, currentCd),
        getDbBarrasMeta()
      ]);
      if (!meta || barrasMeta.row_count <= 0) {
        setErrorMessage("Não foi possível preparar a base offline completa. Tente sincronizar novamente.");
        return;
      }
    } else {
      setBusyManifest(true);
      setStatusMessage(null);
      setErrorMessage(null);
      try {
        await refreshDbBarrasCacheSmart((progress) => {
          if (progress.totalRows > 0) setProgressMessage(`Atualizando base de barras: ${progress.rowsFetched}/${progress.totalRows} (${progress.percent}%).`);
          else setProgressMessage(`Atualizando base de barras: ${progress.percent}%.`);
        }, { allowFullReconcile: true });
        await refreshManifestInfo(currentCd);
      } catch (error) {
        setErrorMessage(toTransferenciaErrorMessage(error));
        return;
      } finally {
        setProgressMessage(null);
        setBusyManifest(false);
      }
    }
    setPreferOfflineMode(true);
    await persistPreferences({ prefer_offline_mode: true });
    setStatusMessage("Modo offline ativado com base de Transferência CD e barras prontas.");
  }, [currentCd, isOnline, manifestReady, persistPreferences, preferOfflineMode, profile.user_id, refreshManifestInfo, runManifestSync]);

  const openNotesModal = useCallback(async () => {
    if (currentCd == null) {
      setErrorMessage("Selecione um CD antes de abrir as notas.");
      return;
    }
    setNotesSearchInput("");
    setErrorMessage(null);
    if (preferOfflineMode || !isOnline || modalNotes.length > 0) {
      setShowNotesModal(true);
      return;
    }
    setBusyOpen(true);
    try {
      const rows = await fetchManifestNotes(currentCd);
      setOnlineOverviewNotes(rows);
      setNotes(rows);
      setShowNotesModal(true);
      if (!rows.length) setStatusMessage("Sem notas disponíveis para este CD.");
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    } finally {
      setBusyOpen(false);
    }
  }, [currentCd, isOnline, modalNotes.length, preferOfflineMode]);

  const openNote = useCallback(async (note: TransferenciaCdNoteRow) => {
    if (currentCd == null) return;
    setBusyOpen(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const localKey = buildTransferenciaCdConferenceKey(profile.user_id, currentCd, note.etapa, note);
      const existing = await getLocalConference(localKey);
      const openLocals = (await listUserLocalConferences(profile.user_id))
        .filter((row) => row.status === "em_conferencia" && !row.pending_cancel);
      const conflictingLocal = openLocals.find((row) => row.local_key !== localKey) ?? null;

      if (conflictingLocal) {
        await activateConference(conflictingLocal, {
          message: `Conferência retomada automaticamente: ${conferenceResumeLabel(conflictingLocal)}.`
        });
        return;
      }

      if (preferOfflineMode || !isOnline) {
        if (!manifestReady) throw new Error("Sincronize a base antes de trabalhar offline.");
        if (existing) {
          await activateConference(existing, {
            message: `Conferência retomada automaticamente: ${conferenceResumeLabel(existing)}.`
          });
          return;
        } else {
          const manifestItems = await getManifestItemsByNote(profile.user_id, currentCd, note);
          if (!manifestItems.length) throw new Error("NF não encontrada na base local sincronizada.");
          await activateConference(localFromManifest(profile, currentCd, note, manifestItems), { silent: true });
        }
      } else {
        try {
          const remote = await openTransferenciaNote(currentCd, note);
          const items = await fetchTransferenciaItems(remote.conf_id);
          await activateConference(localFromRemote(profile, currentCd, remote, items), { silent: true });
        } catch (error) {
          if (isTransferenciaActiveConferenceConflict(error)) {
            const resumed = await resumeRemoteActiveConference(true) ?? await resumeLocalActiveConference(true);
            if (resumed) {
              setStatusMessage(`Conferência retomada automaticamente: ${conferenceResumeLabel(resumed)}.`);
              return;
            }
          }
          throw error;
        }
      }
      setShowNotesModal(false);
      setEditingCoddv(null);
      setExpandedCoddv(null);
      setStatusMessage(`NF ${note.nf_trf} aberta para ${formatEtapa(note.etapa)}.`);
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    } finally {
      setBusyOpen(false);
    }
  }, [
    activateConference,
    currentCd,
    isOnline,
    manifestReady,
    preferOfflineMode,
    profile,
    resumeLocalActiveConference,
    resumeRemoteActiveConference
  ]);

  const runNoteSearchByValue = useCallback(async (value: string) => {
    if (currentCd == null) {
      setErrorMessage("Selecione um CD antes de buscar.");
      return;
    }
    const nfTrf = Number.parseInt(value.replace(/\D/g, ""), 10);
    if (!Number.isFinite(nfTrf)) {
      setErrorMessage("Informe o número da NF.");
      return;
    }
    setBusyOpen(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const rows = (preferOfflineMode || !isOnline)
        ? (await listManifestNotesLocal(profile.user_id, currentCd)).filter((row) => row.nf_trf === nfTrf)
        : await searchTransferenciaNotes(currentCd, nfTrf);
      setNotes(rows);
      setNotesSearchInput(String(nfTrf));
      if (rows.length === 0) setStatusMessage("Nenhuma transferência encontrada para esta NF.");
      else if (rows.length === 1) await openNote(rows[0]);
      else {
        setShowNotesModal(true);
        setStatusMessage(`${rows.length} sequências encontradas para esta NF.`);
      }
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    } finally {
      setBusyOpen(false);
    }
  }, [currentCd, isOnline, openNote, preferOfflineMode, profile.user_id]);

  const runNoteSearch = useCallback((event?: FormEvent) => {
    event?.preventDefault();
    void runNoteSearchByValue(nfInput);
  }, [nfInput, runNoteSearchByValue]);

  const updateActiveItem = useCallback(async (nextItem: TransferenciaCdLocalItem, markPending: boolean) => {
    if (!activeConference) return;
    await setAndSaveActiveConference({
      ...activeConference,
      items: activeConference.items.map((item) => item.coddv === nextItem.coddv ? nextItem : item).sort(itemSort),
      pending_snapshot: markPending || activeConference.pending_snapshot,
      updated_at: new Date().toISOString()
    });
  }, [activeConference, setAndSaveActiveConference]);

  const handleCollectBarcode = useCallback(async (raw?: string) => {
    if (!activeConference || !canEditActiveConference || busyScan) return;
    const barras = normalizeBarcode(raw ?? barcodeInput);
    if (!barras) return;
    const qtd = parsePositiveInteger(multiploInput, 1);
    setBusyScan(true);
    setBarcodeValidationState("validating");
    setErrorMessage(null);
    try {
      let nextItem: TransferenciaCdLocalItem | null = null;
      if (queueModeFor(activeConference)) {
        const found = await getDbBarrasByBarcode(barras);
        if (!found) throw new Error("BARRAS_NAO_ENCONTRADA");
        const current = activeConference.items.find((item) => item.coddv === found.coddv);
        if (!current) throw new Error("PRODUTO_FORA_DA_TRANSFERENCIA");
        const nextQtd = current.qtd_conferida + qtd;
        const normalizedOcc = activeConference.etapa === "entrada"
          ? normalizeOccurrenceForQtd(
            current.ocorrencia_avariado_qtd + (ocorrenciaInput === "Avariado" ? qtd : 0),
            current.ocorrencia_vencido_qtd + (ocorrenciaInput === "Vencido" ? qtd : 0),
            nextQtd
          )
          : { avariado: 0, vencido: 0 };
        nextItem = {
          ...current,
          barras,
          qtd_conferida: nextQtd,
          ocorrencia_avariado_qtd: normalizedOcc.avariado,
          ocorrencia_vencido_qtd: normalizedOcc.vencido,
          updated_at: new Date().toISOString()
        };
        await updateActiveItem(nextItem, true);
      } else if (activeConference.remote_conf_id) {
        const remote = await scanTransferenciaBarcode(activeConference.remote_conf_id, barras, qtd, activeConference.etapa === "entrada" ? ocorrenciaInput : "");
        nextItem = { coddv: remote.coddv, barras: remote.barras, descricao: remote.descricao, qtd_esperada: remote.qtd_esperada, qtd_conferida: remote.qtd_conferida, embcomp_cx: remote.embcomp_cx, qtd_cxpad: remote.qtd_cxpad, ocorrencia_avariado_qtd: remote.ocorrencia_avariado_qtd, ocorrencia_vencido_qtd: remote.ocorrencia_vencido_qtd, updated_at: remote.updated_at };
        await updateActiveItem(nextItem, false);
      }
      if (!nextItem) return;
      setBarcodeValidationState("valid");
      setLastAddedCoddv(nextItem.coddv);
      setExpandedCoddv(nextItem.coddv);
      setBarcodeInput("");
      showScanFeedback("success", "Leitura registrada", `CODDV ${nextItem.coddv} | Conferido ${nextItem.qtd_conferida}`);
    } catch (error) {
      const message = toTransferenciaErrorMessage(error);
      setBarcodeValidationState("invalid");
      setErrorMessage(message);
      showScanFeedback("error", "Erro", message);
      triggerScanErrorAlert(message);
    } finally {
      setBusyScan(false);
      window.setTimeout(() => setBarcodeValidationState("idle"), 700);
    }
  }, [activeConference, barcodeInput, busyScan, canEditActiveConference, multiploInput, ocorrenciaInput, queueModeFor, showScanFeedback, triggerScanErrorAlert, updateActiveItem]);

  const onSubmitBarras = useCallback((event: FormEvent) => {
    event.preventDefault();
    void handleCollectBarcode();
  }, [handleCollectBarcode]);

  const handleSaveItemEdit = useCallback(async (coddv: number) => {
    if (!activeConference || !canEditActiveConference) return;
    const qtd = Math.max(0, Number.parseInt(editQtdInput.replace(/\D/g, ""), 10) || 0);
    const current = activeConference.items.find((item) => item.coddv === coddv);
    if (!current) return;
    try {
      if (queueModeFor(activeConference)) {
        const normalizedOcc = activeConference.etapa === "entrada"
          ? normalizeOccurrenceForQtd(current.ocorrencia_avariado_qtd, current.ocorrencia_vencido_qtd, qtd)
          : { avariado: 0, vencido: 0 };
        await updateActiveItem({
          ...current,
          qtd_conferida: qtd,
          ocorrencia_avariado_qtd: normalizedOcc.avariado,
          ocorrencia_vencido_qtd: normalizedOcc.vencido,
          updated_at: new Date().toISOString()
        }, true);
      } else if (activeConference.remote_conf_id) {
        const remote = await setTransferenciaItemQtd(activeConference.remote_conf_id, coddv, qtd);
        await updateActiveItem({ coddv: remote.coddv, barras: remote.barras, descricao: remote.descricao, qtd_esperada: remote.qtd_esperada, qtd_conferida: remote.qtd_conferida, embcomp_cx: remote.embcomp_cx, qtd_cxpad: remote.qtd_cxpad, ocorrencia_avariado_qtd: remote.ocorrencia_avariado_qtd, ocorrencia_vencido_qtd: remote.ocorrencia_vencido_qtd, updated_at: remote.updated_at }, false);
      }
      setEditingCoddv(null);
      setEditQtdInput("0");
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    }
  }, [activeConference, canEditActiveConference, editQtdInput, queueModeFor, updateActiveItem]);

  const resetItem = useCallback(async (coddv: number) => {
    if (!activeConference || !canEditActiveConference) return;
    const current = activeConference.items.find((item) => item.coddv === coddv);
    if (!current) return;
    try {
      if (queueModeFor(activeConference)) {
        await updateActiveItem({ ...current, qtd_conferida: 0, barras: null, ocorrencia_avariado_qtd: 0, ocorrencia_vencido_qtd: 0, updated_at: new Date().toISOString() }, true);
      } else if (activeConference.remote_conf_id) {
        const remote = await resetTransferenciaItem(activeConference.remote_conf_id, coddv);
        await updateActiveItem({ coddv: remote.coddv, barras: remote.barras, descricao: remote.descricao, qtd_esperada: remote.qtd_esperada, qtd_conferida: remote.qtd_conferida, embcomp_cx: remote.embcomp_cx, qtd_cxpad: remote.qtd_cxpad, ocorrencia_avariado_qtd: remote.ocorrencia_avariado_qtd, ocorrencia_vencido_qtd: remote.ocorrencia_vencido_qtd, updated_at: remote.updated_at }, false);
      }
    } catch (error) {
      setErrorMessage(toTransferenciaErrorMessage(error));
    }
  }, [activeConference, canEditActiveConference, queueModeFor, updateActiveItem]);

  const requestResetItem = useCallback((coddv: number) => {
    setDialogState({ title: "Limpar item", message: "Deseja limpar a quantidade conferida deste item?", confirmLabel: "Limpar", onConfirm: () => { setDialogState(null); void resetItem(coddv); } });
  }, [resetItem]);

  const requestCancelConference = useCallback(() => {
    if (!activeConference || !canEditActiveConference) return;
    setDialogState({
      title: "Cancelar conferência",
      message: "Deseja cancelar esta conferência?",
      confirmLabel: "Cancelar conferência",
      onConfirm: () => {
        setDialogState(null);
        void (async () => {
          if (!activeConference) return;
          setBusyCancel(true);
          try {
            if (queueModeFor(activeConference)) {
              await setAndSaveActiveConference({ ...activeConference, pending_cancel: true, pending_snapshot: false, pending_finalize: false, updated_at: new Date().toISOString() });
              setStatusMessage("Cancelamento salvo localmente. A remoção no banco ocorrerá ao reconectar.");
            } else if (activeConference.remote_conf_id) {
              await cancelTransferencia(activeConference.remote_conf_id);
              setStatusMessage("Conferência cancelada.");
            }
            setActiveConference(null);
          } catch (error) {
            setErrorMessage(toTransferenciaErrorMessage(error));
          } finally {
            setBusyCancel(false);
          }
        })();
      }
    });
  }, [activeConference, canEditActiveConference, queueModeFor, setAndSaveActiveConference]);

  const handleFinalizeConference = useCallback(async () => {
    if (!activeConference || !canEditActiveConference) return;
    const motivo = finalizeMotivo.trim() || null;
    if (groupedItems.falta.length > 0 && !motivo) {
      setFinalizeError("Informe o motivo da falta para finalizar.");
      return;
    }
    setBusyFinalize(true);
    setFinalizeError(null);
    try {
      if (queueModeFor(activeConference)) {
        await setAndSaveActiveConference({ ...activeConference, status: groupedItems.falta.length > 0 ? "finalizado_falta" : "finalizado_ok", falta_motivo: motivo, finalized_at: new Date().toISOString(), is_read_only: true, pending_snapshot: true, pending_finalize: true, pending_finalize_reason: motivo, updated_at: new Date().toISOString() });
      } else if (activeConference.remote_conf_id) {
        const finalized = await finalizeTransferencia(activeConference.remote_conf_id, motivo);
        await setAndSaveActiveConference({ ...activeConference, status: finalized.status, falta_motivo: finalized.falta_motivo, finalized_at: finalized.finalized_at, is_read_only: true, updated_at: new Date().toISOString() });
      }
      setShowFinalizeModal(false);
      setFinalizeMotivo("");
      setStatusMessage("Conferência finalizada com sucesso.");
    } catch (error) {
      const message = toTransferenciaErrorMessage(error);
      setFinalizeError(message);
      setErrorMessage(message);
    } finally {
      setBusyFinalize(false);
    }
  }, [activeConference, canEditActiveConference, finalizeMotivo, groupedItems.falta.length, queueModeFor, setAndSaveActiveConference]);

  const requestFinalize = useCallback(() => {
    if (groupedItems.sobra.length > 0) {
      setErrorMessage("Ajuste os itens com sobra antes de finalizar.");
      return;
    }
    setFinalizeError(null);
    setShowFinalizeModal(true);
  }, [groupedItems.sobra.length]);

  const validateReportFilters = useCallback((): TransferenciaCdReportFilters | null => {
    if (currentCd == null) { setReportError("Selecione um CD para gerar o relatório."); return null; }
    if (!reportDtIni || !reportDtFim) { setReportError("Informe o período do relatório."); return null; }
    if (reportDtFim < reportDtIni) { setReportError("Data final deve ser maior ou igual à data inicial."); return null; }
    return { dtIni: reportDtIni, dtFim: reportDtFim, cd: currentCd };
  }, [currentCd, reportDtFim, reportDtIni]);

  const runReportSearch = useCallback(async () => {
    if (!canSeeReportTools) return;
    const filters = validateReportFilters();
    if (!filters) return;
    setReportBusySearch(true);
    setReportError(null);
    setReportMessage(null);
    try {
      const count = await countTransferenciaConciliacaoRows(filters);
      setReportCount(count);
      setReportMessage(count.total_itens > 0 ? `Foram encontrados ${count.total_notas} NF(s) e ${formatItemCount(count.total_itens)}.` : "Nenhuma transferência encontrada no período.");
    } catch (error) {
      setReportError(toTransferenciaErrorMessage(error));
    } finally {
      setReportBusySearch(false);
    }
  }, [canSeeReportTools, validateReportFilters]);

  const runReportExport = useCallback(async () => {
    if (!canSeeReportTools) return;
    const filters = validateReportFilters();
    if (!filters || (reportCount?.total_itens ?? 0) <= 0) {
      setReportError("Busque um período com registros antes de exportar o Excel.");
      return;
    }
    setReportBusyExport(true);
    setReportError(null);
    setReportMessage(null);
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
      const noteMap = new Map<string, TransferenciaCdReportRow>();
      for (const row of itemRows) if (!noteMap.has(buildReportNoteKey(row))) noteMap.set(buildReportNoteKey(row), row);
      const noteRows = Array.from(noteMap.values());
      const summaryCounts = noteRows.reduce<Record<string, number>>((acc, row) => {
        acc[row.conciliacao_status] = (acc[row.conciliacao_status] ?? 0) + 1;
        return acc;
      }, {});
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ["Relatório de Conferência de Transferência CD"],
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
      ]), "Resumo");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(noteRows.map((row) => ({
        Data_NF: formatReportDate(row.dt_nf), NF: row.nf_trf, SQ_NF: row.sq_nf, CD_Origem: row.cd_ori, Nome_CD_Origem: row.cd_ori_nome, CD_Destino: row.cd_des, Nome_CD_Destino: row.cd_des_nome, Status_Saida: formatStatus(row.saida_status), Usuario_Saida: row.saida_started_nome ?? "", Matricula_Saida: row.saida_started_mat ?? "", Finalizado_Saida: formatDateTime(row.saida_finalized_at), Status_Entrada: formatStatus(row.entrada_status), Usuario_Entrada: row.entrada_started_nome ?? "", Matricula_Entrada: row.entrada_started_mat ?? "", Finalizado_Entrada: formatDateTime(row.entrada_finalized_at), Situacao: formatConciliacao(row.conciliacao_status)
      }))), "Conciliacao");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(itemRows.map((row) => ({
        Data_NF: formatReportDate(row.dt_nf), NF: row.nf_trf, SQ_NF: row.sq_nf, CD_Origem: row.cd_ori, CD_Destino: row.cd_des, CODDV: row.coddv, Descricao: row.descricao, Qtd_Atend: row.qtd_atend, Qtd_Conferida_Saida: row.qtd_conferida_saida, Qtd_Conferida_Entrada: row.qtd_conferida_entrada, Diferenca_Saida_Destino: row.diferenca_saida_destino, Qtd_Avariado_Entrada: row.ocorrencia_avariado_qtd, Qtd_Vencido_Entrada: row.ocorrencia_vencido_qtd, Embcomp_CX: row.embcomp_cx ?? "", Qtd_CXPad: row.qtd_cxpad ?? "", Situacao: formatConciliacao(row.conciliacao_status)
      }))), "Itens");
      XLSX.writeFile(workbook, `relatorio-conferencia-transferencia-cd-${filters.dtIni}-${filters.dtFim}-cd${String(filters.cd).padStart(2, "0")}.xlsx`, { compression: true });
      setReportMessage(`Relatório gerado com sucesso (${noteRows.length} NF(s) e ${formatItemCount(itemRows.length)}).`);
    } catch (error) {
      setReportError(toTransferenciaErrorMessage(error));
    } finally {
      setReportBusyExport(false);
    }
  }, [canSeeReportTools, currentCdLabel, reportCount, validateReportFilters]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 980px)");
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [prefs, cdRows] = await Promise.all([getTransferenciaCdPreferences(profile.user_id), fetchCdOptions()]);
        if (cancelled) return;
        setPreferOfflineMode(prefs.prefer_offline_mode);
        setMultiploInput(String(prefs.multiplo_padrao || 1));
        setCdOptions(cdRows);
        const initialCd = isGlobalAdmin ? (prefs.cd_ativo ?? cdRows[0]?.cd ?? null) : fixedCd;
        setCdAtivo(initialCd);
        await cleanupExpiredTransferenciaCdConferences(profile.user_id);
        await refreshPendingState();
        await refreshManifestInfo(initialCd);
      } catch (error) {
        if (!cancelled) setErrorMessage(toTransferenciaErrorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [fixedCd, isGlobalAdmin, profile.user_id, refreshManifestInfo, refreshPendingState]);

  useEffect(() => {
    void refreshManifestInfo(currentCd);
  }, [currentCd, refreshManifestInfo]);

  useEffect(() => {
    let cancelled = false;
    setOnlineOverviewNotes([]);
    if (currentCd == null || !isOnline || preferOfflineMode) return () => { cancelled = true; };
    void (async () => {
      try {
        const rows = await fetchManifestNotes(currentCd);
        if (!cancelled) setOnlineOverviewNotes(rows);
      } catch (error) {
        if (!cancelled) setErrorMessage(toTransferenciaErrorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [currentCd, isOnline, preferOfflineMode]);

  useEffect(() => {
    let cancelled = false;
    if (currentCd == null) return () => { cancelled = true; };

    void (async () => {
      try {
        const resumedRemote = await resumeRemoteActiveConference(false);
        if (cancelled || resumedRemote) return;
        await resumeLocalActiveConference(false);
      } catch (error) {
        if (!cancelled) setErrorMessage(toTransferenciaErrorMessage(error));
      }
    })();

    return () => { cancelled = true; };
  }, [currentCd, resumeLocalActiveConference, resumeRemoteActiveConference]);

  useEffect(() => {
    if (isOnline) void runPendingSync(true);
  }, [isOnline, runPendingSync]);

  useEffect(() => {
    if (!scannerOpen) return undefined;
    let cancelled = false;
    const start = async () => {
      const videoEl = scannerVideoRef.current;
      if (!videoEl) return;
      try {
        const zxing = await import("@zxing/browser");
        const reader = new zxing.BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: "environment" } } }, videoEl, (result, error) => {
          if (cancelled) return;
          if (result) {
            const scanned = normalizeBarcode(result.getText() ?? "");
            if (!scanned) return;
            setScannerOpen(false);
            controls.stop();
            scannerControlsRef.current = null;
            setScannerError(null);
            if (scannerTarget === "nf") {
              const next = scanned.replace(/\D/g, "");
              setNfInput(next);
              void runNoteSearchByValue(next);
            } else {
              setBarcodeInput(scanned);
              void handleCollectBarcode(scanned);
            }
            return;
          }
          const errorName = (error as { name?: string } | null)?.name;
          if (error && errorName !== "NotFoundException" && errorName !== "ChecksumException" && errorName !== "FormatException") {
            setScannerError("Não foi possível ler o código. Ajuste foco/distância e tente novamente.");
          }
        });
        if (cancelled) {
          controls.stop();
          return;
        }
        scannerControlsRef.current = controls;
      } catch (error) {
        setScannerError(error instanceof Error ? error.message : "Falha ao iniciar câmera.");
      }
    };
    void start();
    return () => {
      cancelled = true;
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [handleCollectBarcode, runNoteSearchByValue, scannerOpen, scannerTarget]);

  const renderItemGroup = (title: string, groupKey: GroupKey, rows: Array<ReturnType<typeof withDivergencia>>) => (
    <div className="termo-list-block">
      <h4>{title} ({rows.length})</h4>
      {rows.length === 0 ? <div className="coleta-empty">Sem itens com {groupKey === "correto" ? "conferência correta" : groupKey}.</div> : rows.map(({ item, qtd_falta, qtd_sobra }) => {
        const expanded = expandedCoddv === item.coddv;
        const isLastAddedItem = lastAddedCoddv === item.coddv;
        return (
          <article key={`${groupKey}-${item.coddv}`} className={`termo-item-card${expanded ? " is-expanded" : ""}${isLastAddedItem ? " is-last-added" : ""}`}>
            <button type="button" className="termo-item-line" onClick={() => setExpandedCoddv((current) => current === item.coddv ? null : item.coddv)}>
              <div className="termo-item-main">
                <strong>{item.descricao}</strong>
                <p>CODDV: {item.coddv}</p>
                {item.qtd_conferida > 0 ? <p>Barras: {item.barras ?? "-"}</p> : null}
                <p>Esperada: {item.qtd_esperada} | Conferida: {item.qtd_conferida}</p>
                {item.ocorrencia_avariado_qtd > 0 || item.ocorrencia_vencido_qtd > 0 ? <p>Ocorrência: Avariado {item.ocorrencia_avariado_qtd} | Vencido {item.ocorrencia_vencido_qtd}</p> : null}
              </div>
              <div className="termo-item-side">
                {isLastAddedItem ? <span className="termo-last-added-tag"><span className="termo-last-added-tag-icon" aria-hidden="true">{barcodeIcon()}</span>Último adicionado</span> : null}
                <span className={`termo-divergencia ${groupKey}`}>{groupKey === "falta" ? `Falta ${qtd_falta}` : groupKey === "sobra" ? `Sobra ${qtd_sobra}` : "Correto"}</span>
                <span className="coleta-row-expand" aria-hidden="true">{chevronIcon(expanded)}</span>
              </div>
            </button>
            {expanded ? (
              <div className="termo-item-detail">
                <p>Última alteração: {formatDateTime(item.updated_at)}</p>
                <p>{qtdAtendidaLabel}: {item.qtd_esperada}</p>
                <p>{itemPackageLabel(item)}</p>
                {canEditActiveConference ? (
                  <div className="termo-item-actions">
                    {editingCoddv === item.coddv && item.qtd_conferida > 0 ? (
                      <>
                        <input type="text" inputMode="numeric" pattern="[0-9]*" value={editQtdInput} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => setEditQtdInput(event.target.value.replace(/\D/g, ""))} />
                        <button className="btn btn-primary" type="button" onClick={() => void handleSaveItemEdit(item.coddv)}>Salvar</button>
                        <button className="btn btn-muted" type="button" onClick={() => { setEditingCoddv(null); setEditQtdInput("0"); }}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        {item.qtd_conferida > 0 ? <button className="btn btn-muted" type="button" onClick={() => { setEditingCoddv(item.coddv); setEditQtdInput(String(item.qtd_conferida)); }}>Editar</button> : null}
                        {item.qtd_conferida > 0 ? <button className="btn btn-muted termo-danger-btn" type="button" onClick={() => requestResetItem(item.coddv)}>Limpar</button> : null}
                      </>
                    )}
                  </div>
                ) : null}
                {qtd_sobra > 0 ? <p className="termo-inline-note">Sobra detectada: {qtd_sobra}</p> : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );

  return (
    <>
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
            <span className="module-back-icon" aria-hidden="true"><BackIcon /></span>
            <span>Início</span>
          </Link>
          <div className="module-topbar-user-side">
            <PendingSyncBadge pendingCount={pendingCount} errorCount={pendingErrors} title="Conferências pendentes de envio" />
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>{isOnline ? "🟢 Online" : "🔴 Offline"}</span>
          </div>
        </div>
        <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
          <span className="module-icon" aria-hidden="true"><ModuleIcon name={MODULE_DEF.icon} /></span>
          <span className="module-title">{MODULE_DEF.title}</span>
        </div>
      </header>

      <section className="modules-shell termo-shell">
        <div className="termo-head">
          <h2>Olá, {toDisplayName(profile.nome)}</h2>
          <p>Sincronize a base para trabalhar com Transferência CD.</p>
          {manifestInfo ? <p className="termo-meta-line">{manifestInfo}</p> : null}
        </div>

        <div className="termo-actions-row">
          <button type="button" className="btn btn-muted termo-sync-btn" onClick={() => void runManifestSync()} disabled={busyManifest || !isOnline}>
            <span aria-hidden="true">{refreshIcon()}</span>
            {busyManifest ? "Sincronizando..." : "Sincronizar agora"}
          </button>
          {!isDesktop ? (
            <button type="button" className={`btn btn-muted termo-offline-toggle${preferOfflineMode ? " is-active" : ""}`} onClick={() => void handleToggleOffline()} disabled={busyManifest}>
              {preferOfflineMode ? "📦 Offline ativo" : "📶 Trabalhar offline"}
            </button>
          ) : null}
          <button type="button" className="btn btn-muted termo-route-btn" onClick={() => void openNotesModal()} disabled={currentCd == null || busyOpen}>
            <span aria-hidden="true">{listIcon()}</span>
            {busyOpen ? "Abrindo..." : "Notas"}
          </button>
          {canSeeReportTools ? (
            <button type="button" className={`btn btn-muted termo-report-toggle${showReportPanel ? " is-active" : ""}`} aria-pressed={showReportPanel} onClick={() => { setShowReportPanel((value) => { const next = !value; if (next && (!reportDtIni || !reportDtFim)) { const today = todayIsoBrasilia(); setReportDtIni((current) => current || today); setReportDtFim((current) => current || today); } return next; }); setReportCount(null); setReportMessage(null); setReportError(null); }}>
              <span className="termo-report-toggle-icon" aria-hidden="true">{reportIcon()}</span>
              Relatório
            </button>
          ) : null}
        </div>

        {showReportPanel && canSeeReportTools ? (
          <section className="termo-report-panel">
            <div className="termo-report-head">
              <h3>Relatório de Conferência de Transferência CD</h3>
              <p>Busca por período para exportação em Excel com conciliação entre origem e destino.</p>
            </div>
            {reportError ? <div className="alert error">{reportError}</div> : null}
            {reportMessage ? <div className="alert success">{reportMessage}</div> : null}
            <div className="termo-report-grid">
              <label>Data inicial<input type="date" autoComplete="off" value={reportDtIni} onChange={(event) => { setReportDtIni(event.target.value); setReportCount(null); }} required /></label>
              <label>Data final<input type="date" autoComplete="off" value={reportDtFim} onChange={(event) => { setReportDtFim(event.target.value); setReportCount(null); }} required /></label>
              <label>CD<input type="text" value={currentCdLabel} disabled /></label>
            </div>
            <div className="termo-report-actions">
              <button type="button" className="btn btn-muted" onClick={() => void runReportSearch()} disabled={reportBusySearch}>{reportBusySearch ? "Buscando..." : "Buscar"}</button>
              <button type="button" className="btn btn-primary termo-export-btn" onClick={() => void runReportExport()} disabled={reportBusyExport || (reportCount?.total_itens ?? 0) <= 0}><span aria-hidden="true">{reportIcon()}</span>{reportBusyExport ? "Gerando Excel..." : "Exportar Excel"}</button>
            </div>
            {reportCount ? <p className="termo-report-count">NFs encontradas: {reportCount.total_notas} | Itens encontrados: {formatItemCount(reportCount.total_itens)}</p> : null}
          </section>
        ) : null}

        {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
        {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
        {progressMessage ? <div className="alert success">{progressMessage}</div> : null}
        {scanFeedback ? <div key={scanFeedback.id} className={`termo-scan-feedback ${scanFeedback.tone === "error" ? "is-error" : "is-success"}`} role="status" aria-live="polite" style={scanFeedbackTop != null ? { top: `${scanFeedbackTop}px` } : undefined}><strong>{scanFeedback.tone === "error" ? "Erro" : scanFeedback.title}</strong>{scanFeedback.detail ? <span>{scanFeedback.detail}</span> : null}</div> : null}

        {isGlobalAdmin ? (
          <div className="termo-cd-selector">
            <label>CD<select value={cdAtivo ?? ""} onChange={(event) => { const nextCd = Number.parseInt(event.target.value, 10); setCdAtivo(nextCd); setActiveConference(null); setNotes([]); setOnlineOverviewNotes([]); void persistPreferences({ cd_ativo: nextCd }); }}>
              <option value="" disabled>Selecione o CD</option>
              {cdOptions.map((option) => <option key={option.cd} value={option.cd}>{option.cd_nome || `CD ${String(option.cd).padStart(2, "0")}`}</option>)}
            </select></label>
          </div>
        ) : null}

        {!activeConference ? (
          <div className="pvps-progress-card" role="status" aria-live="polite">
            <div className="pvps-progress-head"><strong>Concluído Transferência CD</strong><span>{formatPercent(completionStats.percent)}</span></div>
            <div className="pvps-progress-track" aria-hidden="true"><span className="pvps-progress-fill" style={{ width: `${Math.max(0, Math.min(completionStats.percent, 100))}%` }} /></div>
            <small>{completionStats.completed} {completionStats.completed === 1 ? "nota conferida" : "notas conferidas"} de {completionStats.total} {completionStats.total === 1 ? "nota" : "notas"} na base {preferOfflineMode || !isOnline ? "local atual" : "online atual"}.</small>
          </div>
        ) : null}

        {!hasOpenConference ? (
          <form className="termo-form termo-open-form" onSubmit={runNoteSearch}>
            <h3>Abertura de NF</h3>
            <label>Número da NF<div className="input-icon-wrap with-action"><span className="field-icon" aria-hidden="true"><ModuleIcon name="notes" /></span><input ref={nfRef} type="text" inputMode="numeric" value={nfInput} onChange={(event) => setNfInput(event.target.value.replace(/\D/g, ""))} autoComplete="off" placeholder="Informe a NF" required /><button type="button" className="input-action-btn" onClick={() => { setScannerTarget("nf"); setScannerOpen(true); }} title="Ler NF pela câmera" aria-label="Ler NF pela câmera">{cameraIcon()}</button></div></label>
            <button className="btn btn-primary" type="submit" disabled={busyOpen || currentCd == null}>{busyOpen ? "Abrindo..." : "Abrir NF"}</button>
          </form>
        ) : null}

        {activeConference ? (
          <article className="termo-volume-card">
            <div className="termo-volume-head">
              <div>
                <h3>NF {activeConference.nf_trf} | SQ {activeConference.sq_nf}</h3>
                <p>Origem: {activeConference.cd_ori_nome}</p>
                <p>Destino: {activeConference.cd_des_nome}</p>
                <p>{formatEtapa(activeConference.etapa)} para esta transferência.</p>
                <p>Data NF: {formatReportDate(activeConference.dt_nf)}</p>
                {activeConference.etapa === "entrada" ? <p className="termo-inline-note">{originObservation(activeConference)}</p> : null}
                <p>Status: {formatStatus(activeConference.status)}</p>
                <p>{activeConferenceStatusDetail(activeConference)}</p>
              </div>
              <div className="termo-volume-head-right">
                <span className={`coleta-row-status ${activeConference.sync_error ? "error" : activeConference.pending_snapshot || activeConference.pending_finalize || activeConference.pending_cancel ? "pending" : "synced"}`}>{activeConference.sync_error ? "Erro de sync" : activeConference.pending_snapshot || activeConference.pending_finalize || activeConference.pending_cancel ? "Pendente sync" : "Sincronizado"}</span>
                <div className="termo-volume-actions">
                  {activeConference.is_read_only ? <button className="btn btn-muted termo-close-btn" type="button" onClick={() => setActiveConference(null)}><span aria-hidden="true">{closeIcon()}</span>Fechar</button> : <>
                    <button className="btn btn-danger termo-cancel-btn" type="button" onClick={requestCancelConference} disabled={busyCancel || busyFinalize}><span aria-hidden="true">{closeIcon()}</span>{busyCancel ? "Cancelando..." : "Cancelar"}</button>
                    {hasAnyItemInformed ? <button className="btn btn-primary termo-finalize-btn" type="button" onClick={requestFinalize} disabled={busyCancel || busyFinalize}><span aria-hidden="true">{checkIcon()}</span>Finalizar</button> : null}
                  </>}
                </div>
              </div>
            </div>
            <form className="termo-form termo-scan-form" onSubmit={onSubmitBarras}>
              <h4>Conferência de produtos</h4>
              <div className="termo-scan-grid termo-scan-grid-stack">
                <label>Código de barras<div className="input-icon-wrap with-action"><span className={barcodeIconClassName} aria-hidden="true">{barcodeIcon()}</span><input ref={barrasRef} type="text" inputMode={barcodeInputMode} value={barcodeInput} onChange={(event) => setBarcodeInput(event.target.value)} onFocus={enableSoftKeyboard} onPointerDown={enableSoftKeyboard} onBlur={disableSoftKeyboard} autoComplete="off" placeholder="Bipe, digite ou use câmera" disabled={!canEditActiveConference || busyScan} /><button type="button" className="input-action-btn" onClick={() => { setScannerTarget("barras"); setScannerOpen(true); }} title="Ler barras pela câmera" aria-label="Ler barras pela câmera">{cameraIcon()}</button></div></label>
                <label>Múltiplo<div className="input-icon-wrap with-stepper"><span className="field-icon" aria-hidden="true">{quantityIcon()}</span><input type="text" inputMode="numeric" pattern="[0-9]*" value={multiploInput} onChange={(event) => { const next = event.target.value.replace(/\D/g, "") || "1"; setMultiploInput(next); void persistPreferences({ multiplo_padrao: parsePositiveInteger(next, 1) }); }} disabled={!canEditActiveConference} /><div className="input-stepper-group"><button type="button" className="input-stepper-btn" onClick={() => setMultiploInput((current) => String(Math.max(1, parsePositiveInteger(current, 1) - 1)))} disabled={!canEditActiveConference}>-</button><button type="button" className="input-stepper-btn" onClick={() => setMultiploInput((current) => String(parsePositiveInteger(current, 1) + 1))} disabled={!canEditActiveConference}>+</button></div></div></label>
                {isReceivingActiveConference ? <label>Ocorrência<select value={ocorrenciaInput} onChange={(event) => setOcorrenciaInput(event.target.value as OcorrenciaTipo)} disabled={!canEditActiveConference || busyScan}><option value="">Sem ocorrência</option><option value="Avariado">Avariado</option><option value="Vencido">Vencido</option></select></label> : null}
              </div>
              <button className="btn btn-primary" type="submit" disabled={!canEditActiveConference || busyScan}>{busyScan ? "Registrando..." : "Registrar leitura"}</button>
            </form>
            {renderItemGroup("Falta", "falta", groupedItems.falta)}
            {renderItemGroup("Sobra", "sobra", groupedItems.sobra)}
            {renderItemGroup("Correto", "correto", groupedItems.correto)}
          </article>
        ) : <div className="coleta-empty">Nenhuma NF ativa. Informe uma NF para iniciar a conferência.</div>}
      </section>

      {showNotesModal && typeof document !== "undefined" ? createPortal(<div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="transferencia-notas-title" onClick={() => setShowNotesModal(false)}><div className="confirm-dialog termo-routes-dialog surface-enter" onClick={(event) => event.stopPropagation()}><h3 id="transferencia-notas-title">Notas</h3><div className="input-icon-wrap termo-routes-search"><span className="field-icon" aria-hidden="true">{searchIcon()}</span><input type="text" value={notesSearchInput} onChange={(event) => setNotesSearchInput(event.target.value)} placeholder="Buscar NF, SQ, CD ou status..." /></div>{filteredModalNotes.length === 0 ? <p>Sem notas disponíveis para este CD.</p> : <div className="termo-routes-list">{filteredModalNotes.map((note) => { const status = noteStatus(note); const statusDetail = noteStatusDetail(note); return <div key={`${note.dt_nf}-${note.nf_trf}-${note.sq_nf}-${note.cd_ori}-${note.cd_des}`} className="termo-route-group"><button type="button" className="termo-route-row-button termo-route-row-button-volume" disabled={busyOpen} onClick={() => void openNote(note)}><span className="termo-route-main"><span className="termo-route-info"><span className="termo-route-title">NF {note.nf_trf} | SQ {note.sq_nf}</span><span className="termo-route-sub">Origem: {note.cd_ori_nome}</span><span className="termo-route-sub">Destino: {note.cd_des_nome}</span><span className="termo-route-sub">Data NF: {formatReportDate(note.dt_nf)}</span><span className="termo-route-sub">{formatEtapa(note.etapa)}</span>{statusDetail ? <span className="termo-route-sub">{statusDetail}</span> : null}</span><span className="termo-route-actions-row"><span className="termo-route-items-count">{formatItemCount(note.total_itens)}</span><span className={`termo-divergencia ${routeStatusClass(status)}`}>{routeStatusLabel(status)}</span><span className="termo-route-open-icon" aria-hidden="true">{status == null ? startConferenceIcon() : resumeConferenceIcon()}</span></span></span></button></div>; })}</div>}<div className="confirm-actions"><button className="btn btn-muted" type="button" onClick={() => setShowNotesModal(false)}>Fechar</button></div></div></div>, document.body) : null}

      {showFinalizeModal && activeConference && typeof document !== "undefined" ? createPortal(<div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="transferencia-finalizar-title" onClick={() => setShowFinalizeModal(false)}><div className="confirm-dialog termo-finalize-dialog surface-enter" onClick={(event) => event.stopPropagation()}><h3 id="transferencia-finalizar-title">Finalizar conferência</h3><p>Resumo: Falta {divergenciaTotals.falta} | Sobra {divergenciaTotals.sobra} | Correto {divergenciaTotals.correto}</p>{divergenciaTotals.falta > 0 || divergenciaTotals.sobra > 0 ? <div className="termo-item-detail"><p>Itens com divergência:</p><div className="termo-routes-list termo-finalize-list">{groupedItems.falta.map(({ item, qtd_falta }) => <p key={`fim-falta-${item.coddv}`}>{item.coddv} - {item.descricao || "Item sem descrição"}: Falta {qtd_falta}</p>)}{groupedItems.sobra.map(({ item, qtd_sobra }) => <p key={`fim-sobra-${item.coddv}`}>{item.coddv} - {item.descricao || "Item sem descrição"}: Sobra {qtd_sobra}</p>)}</div></div> : null}{divergenciaTotals.falta > 0 ? <label>Motivo da falta<textarea value={finalizeMotivo} onChange={(event) => setFinalizeMotivo(event.target.value)} placeholder="Descreva o motivo da falta" rows={3} /></label> : null}{finalizeError ? <div className="alert error">{finalizeError}</div> : null}<div className="confirm-actions"><button className="btn btn-muted" type="button" onClick={() => setShowFinalizeModal(false)} disabled={busyFinalize}>Cancelar</button><button className="btn btn-primary" type="button" onClick={() => void handleFinalizeConference()} disabled={busyFinalize}>{busyFinalize ? "Finalizando..." : "Confirmar finalização"}</button></div></div></div>, document.body) : null}

      {dialogState && typeof document !== "undefined" ? createPortal(<div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="transferencia-dialog" onClick={() => setDialogState(null)}><div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}><h3 id="transferencia-dialog">{dialogState.title}</h3><p>{dialogState.message}</p><div className="confirm-actions"><button className="btn btn-muted" type="button" onClick={() => setDialogState(null)}>Cancelar</button><button className="btn btn-primary" type="button" onClick={dialogState.onConfirm}>{dialogState.confirmLabel ?? "Confirmar"}</button></div></div></div>, document.body) : null}

      {scannerOpen && typeof document !== "undefined" ? createPortal(<div className="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="transferencia-scanner-title" onClick={() => setScannerOpen(false)}><div className="scanner-dialog surface-enter" onClick={(event) => event.stopPropagation()}><div className="scanner-head"><h3 id="transferencia-scanner-title">{scannerTarget === "nf" ? "Scanner de NF" : "Scanner de barras"}</h3><div className="scanner-head-actions"><button className="scanner-close-btn" type="button" onClick={() => setScannerOpen(false)} aria-label="Fechar scanner">{closeIcon()}</button></div></div><div className="scanner-video-wrap"><video ref={scannerVideoRef} className="scanner-video" autoPlay muted playsInline /><div className="scanner-frame" aria-hidden="true"><div className="scanner-frame-corner top-left" /><div className="scanner-frame-corner top-right" /><div className="scanner-frame-corner bottom-left" /><div className="scanner-frame-corner bottom-right" /><div className="scanner-frame-line" /></div></div><p className="scanner-hint">Aponte a câmera para leitura automática.</p>{scannerError ? <div className="alert error">{scannerError}</div> : null}</div></div>, document.body) : null}
    </>
  );
}
