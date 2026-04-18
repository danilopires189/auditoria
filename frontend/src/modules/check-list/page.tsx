import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import pmImage from "../../../assets/pm.png";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { formatDateOnlyPtBR, formatDateTimeBrasilia, monthKeyBrasilia, todayIsoBrasilia } from "../../shared/brasilia-datetime";
import { getModuleByKeyOrThrow } from "../registry";
import { fetchChecklistAdminList, fetchChecklistDetail, finalizeChecklistAudit, lookupChecklistEvaluatedUser } from "./sync";
import {
  CHECKLIST_DEFINITIONS,
  getChecklistDefinition,
  type CheckListModuleProfile,
  type ChecklistAnswer,
  type ChecklistAuditDetail,
  type ChecklistDefinition,
  type ChecklistEvaluatedUser,
  type ChecklistKey,
} from "./types";
import { calculateDraftResult, conformityStatus, formatMonthYearPtBR, formatPercent, formatPoints, riskLabel } from "./utils";
import type { DraftResult } from "./utils";
import "./checklist.css";

import ChecklistSelector from "./components/ChecklistSelector";
import ChecklistHero from "./components/ChecklistHero";
import ChecklistSectionPanel from "./components/ChecklistSectionPanel";
import AdminPanel from "./components/AdminPanel";
import CompletionModal from "./components/CompletionModal";
import type { CompletionPopup } from "./components/CompletionModal";
import ConfirmationModal from "./components/ConfirmationModal";
import type { ConfirmationPopup } from "./components/ConfirmationModal";

interface CheckListPageProps {
  isOnline: boolean;
  profile: CheckListModuleProfile;
}

type AnswerDraft = Record<number, ChecklistAnswer | "">;

const MODULE_DEF = getModuleByKeyOrThrow("check-list");

function emptyAnswers(definition: ChecklistDefinition | null): AnswerDraft {
  if (!definition) return {};
  return definition.items.reduce<AnswerDraft>((acc, item) => {
    acc[item.item_number] = "";
    return acc;
  }, {});
}

function normalizeMat(value: string): string {
  return value.replace(/\D/g, "");
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

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: CheckListModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) {
    return Math.trunc(profile.cd_default);
  }
  return parseCdFromLabel(profile.cd_nome);
}

function resolveCdLabel(profile: CheckListModuleProfile, cd: number | null): string {
  const raw = typeof profile.cd_nome === "string" ? profile.cd_nome.trim().replace(/\s+/g, " ") : "";
  if (raw) return raw;
  if (cd != null) return `CD ${String(cd).padStart(2, "0")}`;
  return "CD não definido";
}

function sectionItems(definition: ChecklistDefinition, sectionKey: string) {
  return definition.items.filter((item) => item.section_key === sectionKey);
}

function countAnswered(definition: ChecklistDefinition | null, answers: AnswerDraft): number {
  if (!definition) return 0;
  return definition.items.filter((item) => answers[item.item_number]).length;
}

function scrollChecklistTop(behavior: ScrollBehavior = "auto"): void {
  if (typeof window === "undefined") return;
  window.scrollTo({ top: 0, behavior });
}

function nextPdfY(doc: jsPDF, fallback: number): number {
  const last = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
  return typeof last === "number" && Number.isFinite(last) ? last + 14 : fallback;
}

async function imageUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function resolvePdfCdLabel(detail: ChecklistAuditDetail): string {
  const fullName = detail.cd_nome?.trim().replace(/\s+/g, " ");
  if (fullName) return fullName;
  return `CD ${String(detail.cd).padStart(2, "0")}`;
}

function evaluatedPdfLabel(detail: ChecklistAuditDetail): string {
  if (detail.scoring_mode !== "simple") return "Auditoria por CD";
  return `${detail.evaluated_nome} | MAT ${detail.evaluated_mat}`;
}

function resultLabel(detail: Pick<ChecklistAuditDetail, "scoring_mode" | "conformity_percent" | "risk_score_percent" | "risk_level" | "score_points" | "score_max_points">): string {
  if (detail.scoring_mode === "risk_weighted") {
    return `Risco ${formatPercent(detail.risk_score_percent ?? (100 - detail.conformity_percent))} | Nível ${detail.risk_level ?? "N/A"}`;
  }
  if (detail.scoring_mode === "score_points") {
    return `Score ${formatPoints(detail.score_points)} de ${formatPoints(detail.score_max_points)} | ${formatPercent(detail.conformity_percent)} | Risco ${detail.risk_level ?? "N/A"}`;
  }
  return `${formatPercent(detail.conformity_percent)} | Risco ${riskLabel(detail.conformity_percent)}`;
}

function buildSectionSummary(detail: ChecklistAuditDetail): string[][] {
  const sections = new Map<string, { total: number; no: number; yes: number; na: number; risk: number; score: number; max: number }>();
  detail.answers.forEach((answer) => {
    const current = sections.get(answer.section_title) ?? { total: 0, no: 0, yes: 0, na: 0, risk: 0, score: 0, max: 0 };
    current.total += 1;
    current.yes += answer.answer === "Sim" ? 1 : 0;
    current.no += answer.answer === "Não" ? 1 : 0;
    current.na += answer.answer === "N.A." ? 1 : 0;
    current.risk += answer.risk_points ?? 0;
    current.score += answer.earned_points ?? 0;
    current.max += answer.answer === "N.A." ? 0 : answer.max_points ?? 0;
    sections.set(answer.section_title, current);
  });
  return Array.from(sections.entries()).map(([section, values]) => [
    section,
    String(values.total),
    String(values.no),
    String(values.na),
    detail.scoring_mode === "score_points"
      ? `${formatPoints(values.score)} / ${formatPoints(values.max)}`
      : detail.scoring_mode === "risk_weighted"
        ? formatPoints(values.risk)
        : "-"
  ]);
}

async function buildPdf(detail: ChecklistAuditDetail): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const generatedAt = formatDateTimeBrasilia(new Date().toISOString(), { includeSeconds: true });
  const cdLabel = resolvePdfCdLabel(detail);
  const nonConforming = detail.answers.filter((answer) => answer.is_nonconformity);
  const logoDataUrl = await imageUrlToDataUrl(pmImage);

  if (logoDataUrl) doc.addImage(logoDataUrl, "PNG", 40, 28, 42, 42);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(detail.checklist_title, 96, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Versão ${detail.checklist_version} | ${cdLabel}`, 96, 58);
  doc.text(`Gerado em: ${generatedAt}`, 96, 72);

  autoTable(doc, {
    startY: 88,
    theme: "grid",
    head: [["Campo", "Valor"]],
    body: [
      ["Data da auditoria", formatDateTimeBrasilia(detail.created_at, { includeSeconds: true })],
      ["CD/Depósito", cdLabel],
      ["Auditor", `${detail.auditor_nome} | MAT ${detail.auditor_mat}`],
      [detail.scoring_mode === "simple" ? "Colaborador avaliado" : "Escopo", evaluatedPdfLabel(detail)],
      ["Checklist", `${detail.checklist_title} | ${detail.total_items} itens`],
      ["Não conformidades", String(detail.non_conformities)],
      [detail.scoring_mode === "simple" ? "Conformidade" : "Resultado", resultLabel(detail)]
    ],
    margin: { left: 40, right: 40 },
    styles: { fontSize: 9, cellPadding: 5, overflow: "linebreak" },
    headStyles: { fillColor: [22, 63, 135] },
    columnStyles: { 0: { cellWidth: 145, fontStyle: "bold" } }
  });

  if (detail.scoring_mode !== "simple") {
    autoTable(doc, {
      startY: nextPdfY(doc, 210),
      theme: "grid",
      head: [["Bloco", "Itens", "NC", "N.A.", detail.scoring_mode === "score_points" ? "Score" : "Risco ponderado"]],
      body: buildSectionSummary(detail),
      margin: { left: 40, right: 40 },
      styles: { fontSize: 8.5, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [22, 63, 135] },
      columnStyles: {
        0: { cellWidth: 205 },
        1: { cellWidth: 45, halign: "center" },
        2: { cellWidth: 45, halign: "center" },
        3: { cellWidth: 45, halign: "center" },
        4: { cellWidth: 120, halign: "center" }
      }
    });
  }

  autoTable(doc, {
    startY: nextPdfY(doc, 225),
    theme: "striped",
    head: [["Item", "Seção", "Critério", "Resposta", detail.scoring_mode === "score_points" ? "Pts" : "NC"]],
    body: detail.answers.map((answer) => [
      String(answer.item_number),
      answer.section_title,
      answer.question,
      answer.answer,
      detail.scoring_mode === "score_points" ? formatPoints(answer.earned_points ?? 0) : answer.is_nonconformity ? "Sim" : "-"
    ]),
    margin: { left: 30, right: 30 },
    styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
    headStyles: { fillColor: [22, 63, 135] },
    columnStyles: {
      0: { cellWidth: 28, halign: "center" },
      1: { cellWidth: 78 },
      3: { cellWidth: 52, halign: "center" },
      4: { cellWidth: 32, halign: "center" }
    }
  });

  autoTable(doc, {
    startY: nextPdfY(doc, 360),
    theme: "plain",
    head: [["Observações"]],
    body: [[detail.observations ?? "Nenhuma observação informada."]],
    margin: { left: 40, right: 40 },
    styles: { fontSize: 9, cellPadding: 5, overflow: "linebreak" },
    headStyles: { textColor: [22, 63, 135], fontStyle: "bold" }
  });

  autoTable(doc, {
    startY: nextPdfY(doc, 430),
    theme: "plain",
    head: [["Itens não conformes"]],
    body: nonConforming.length > 0
      ? nonConforming.map((answer) => [`${answer.item_number}. ${answer.question} | Resposta: ${answer.answer}`])
      : [["Nenhuma não conformidade apontada."]],
    margin: { left: 40, right: 40 },
    styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
    headStyles: { textColor: [22, 63, 135], fontStyle: "bold" }
  });

  autoTable(doc, {
    startY: nextPdfY(doc, 500),
    theme: "grid",
    head: [["Assinatura eletrônica"]],
    body: [[
      [
        `Auditor: ${detail.auditor_nome} | MAT ${detail.auditor_mat}`,
        `Aceite registrado em: ${formatDateTimeBrasilia(detail.signed_at, { includeSeconds: true })}`,
        `${detail.scoring_mode === "simple" ? "Colaborador avaliado" : "Escopo"}: ${evaluatedPdfLabel(detail)}`,
        `Checklist: ${detail.checklist_title}`,
        `ID da auditoria: ${detail.audit_id}`
      ].join("\n")
    ]],
    margin: { left: 40, right: 40 },
    styles: { fontSize: 8.5, cellPadding: 6, overflow: "linebreak" },
    headStyles: { fillColor: [22, 63, 135] }
  });

  doc.save(`checklist-${detail.checklist_key}-${detail.audit_id.slice(0, 8)}.pdf`);
}

export default function CheckListPage({ isOnline, profile }: CheckListPageProps) {
  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const currentCdLabel = useMemo(() => resolveCdLabel(profile, activeCd), [activeCd, profile]);
  const canSeeAdmin = profile.role === "admin";
  const isGlobalAdmin = profile.role === "admin" && profile.cd_default == null;

  const [selectedChecklistKey, setSelectedChecklistKey] = useState<ChecklistKey | null>(null);
  const selectedChecklist = useMemo(
    () => selectedChecklistKey ? getChecklistDefinition(selectedChecklistKey) : null,
    [selectedChecklistKey]
  );
  const [evaluatedMat, setEvaluatedMat] = useState("");
  const [evaluatedUser, setEvaluatedUser] = useState<ChecklistEvaluatedUser | null>(null);
  const [evaluatedLookupBusy, setEvaluatedLookupBusy] = useState(false);
  const [evaluatedLookupError, setEvaluatedLookupError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerDraft>(() => emptyAnswers(null));
  const [observations, setObservations] = useState("");
  const [signatureAccepted, setSignatureAccepted] = useState(false);
  const [busySubmit, setBusySubmit] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmationPopup, setConfirmationPopup] = useState<ConfirmationPopup | null>(null);
  const [completionPopup, setCompletionPopup] = useState<CompletionPopup | null>(null);

  const [reportDtIni, setReportDtIni] = useState(todayIsoBrasilia());
  const [reportDtFim, setReportDtFim] = useState(todayIsoBrasilia());
  const [reportCd, setReportCd] = useState("");
  const [reportAuditor, setReportAuditor] = useState("");
  const [reportEvaluated, setReportEvaluated] = useState("");
  const [reportChecklistKey, setReportChecklistKey] = useState<ChecklistKey | "">("");
  const [reportRows, setReportRows] = useState<import("./types").ChecklistAuditSummary[]>([]);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportExportingId, setReportExportingId] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const initialReportLoadedRef = useRef(false);
  const lookupSeqRef = useRef(0);

  const answeredCount = useMemo(() => countAnswered(selectedChecklist, answers), [answers, selectedChecklist]);
  const draftResult = useMemo((): DraftResult => calculateDraftResult(selectedChecklist, answers), [answers, selectedChecklist]);
  const nonConformities = draftResult.nonConformities;
  const monthLabel = useMemo(() => formatMonthYearPtBR(monthKeyBrasilia()), []);

  useEffect(() => { scrollChecklistTop("auto"); }, []);

  const clearFormForDefinition = useCallback((definition: ChecklistDefinition | null) => {
    lookupSeqRef.current += 1;
    setEvaluatedMat("");
    setEvaluatedUser(null);
    setEvaluatedLookupBusy(false);
    setEvaluatedLookupError(null);
    setAnswers(emptyAnswers(definition));
    setObservations("");
    setSignatureAccepted(false);
    setErrorMessage(null);
  }, []);

  const startChecklist = useCallback((key: ChecklistKey) => {
    const definition = getChecklistDefinition(key);
    setSelectedChecklistKey(key);
    clearFormForDefinition(definition);
    setStatusMessage(null);
    setConfirmationPopup(null);
    scrollChecklistTop();
  }, [clearFormForDefinition]);

  const switchChecklist = useCallback(() => {
    setSelectedChecklistKey(null);
    clearFormForDefinition(null);
    setConfirmationPopup(null);
    scrollChecklistTop();
  }, [clearFormForDefinition]);

  const updateAnswer = useCallback((itemNumber: number, answer: ChecklistAnswer) => {
    setAnswers((current) => ({ ...current, [itemNumber]: answer }));
  }, []);

  const lookupEvaluated = useCallback(async (matOverride?: string): Promise<ChecklistEvaluatedUser | null> => {
    const mat = normalizeMat(matOverride ?? evaluatedMat);
    lookupSeqRef.current += 1;
    const seq = lookupSeqRef.current;

    if (!mat) { setEvaluatedUser(null); setEvaluatedLookupError("Informe a matrícula do colaborador avaliado."); return null; }
    if (!isOnline) { setEvaluatedLookupError("Busca do avaliado disponível apenas online."); return null; }
    if (activeCd == null) { setEvaluatedLookupError("CD não definido para este usuário."); return null; }

    setEvaluatedLookupBusy(true);
    setEvaluatedLookupError(null);
    try {
      const user = await lookupChecklistEvaluatedUser({ cd: activeCd, mat });
      if (seq === lookupSeqRef.current) { setEvaluatedMat(user.mat); setEvaluatedUser(user); }
      return user;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao buscar matrícula no DB_USUARIO.";
      if (seq === lookupSeqRef.current) { setEvaluatedUser(null); setEvaluatedLookupError(message); }
      return null;
    } finally {
      if (seq === lookupSeqRef.current) setEvaluatedLookupBusy(false);
    }
  }, [activeCd, evaluatedMat, isOnline]);

  useEffect(() => {
    const mat = normalizeMat(evaluatedMat);
    if (!selectedChecklist?.requires_evaluated_user || !mat || mat.length < 3 || !isOnline || activeCd == null) return undefined;
    const timer = window.setTimeout(() => { void lookupEvaluated(mat); }, 500);
    return () => window.clearTimeout(timer);
  }, [activeCd, evaluatedMat, isOnline, lookupEvaluated, selectedChecklist]);

  const handleEvaluatedMatChange = useCallback((value: string) => {
    lookupSeqRef.current += 1;
    setEvaluatedMat(normalizeMat(value));
    setEvaluatedUser(null);
    setEvaluatedLookupBusy(false);
    setEvaluatedLookupError(null);
  }, []);

  const resetCurrentForm = useCallback(() => { clearFormForDefinition(selectedChecklist); }, [clearFormForDefinition, selectedChecklist]);

  const setChecklistError = useCallback((message: string) => { setErrorMessage(message); scrollChecklistTop(); }, []);

  const executeFinalizeChecklist = useCallback(async () => {
    if (!selectedChecklist) { setChecklistError("Selecione um checklist para iniciar."); return; }
    setBusySubmit(true);
    try {
      const resolvedEvaluated = selectedChecklist.requires_evaluated_user ? evaluatedUser ?? await lookupEvaluated(evaluatedMat) : null;
      if (selectedChecklist.requires_evaluated_user && !resolvedEvaluated) {
        setChecklistError("Localize uma matrícula válida no DB_USUARIO antes de finalizar.");
        return;
      }
      const result = await finalizeChecklistAudit({
        checklist_key: selectedChecklist.checklist_key,
        cd: activeCd,
        evaluated_mat: resolvedEvaluated?.mat ?? null,
        observations: observations.trim() || null,
        signature_accepted: signatureAccepted,
        answers: selectedChecklist.items.map((item) => ({
          item_number: item.item_number,
          answer: answers[item.item_number] as ChecklistAnswer,
          section_key: item.section_key,
          section_title: item.section_title,
          question: item.question,
          item_weight: item.item_weight ?? null,
          max_points: item.max_points ?? null,
          criticality: item.criticality ?? null,
          is_critical: Boolean(item.is_critical)
        }))
      });
      setStatusMessage(null);
      setConfirmationPopup(null);
      setCompletionPopup({
        checklistTitle: selectedChecklist.title,
        conformityPercent: result.conformity_percent,
        nonConformities: result.non_conformities,
        scoringMode: result.scoring_mode,
        riskScorePercent: result.risk_score_percent,
        riskLevel: result.risk_level,
        scorePoints: result.score_points,
        scoreMaxPoints: result.score_max_points,
        auditId: result.audit_id
      });
      setErrorMessage(null);
      setSelectedChecklistKey(null);
      clearFormForDefinition(null);
      scrollChecklistTop("auto");
    } catch (error) {
      setChecklistError(error instanceof Error ? error.message : "Falha ao finalizar checklist.");
    } finally {
      setBusySubmit(false);
    }
  }, [activeCd, answers, clearFormForDefinition, evaluatedMat, evaluatedUser, lookupEvaluated, observations, selectedChecklist, setChecklistError, signatureAccepted]);

  const submitChecklist = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedChecklist) { setChecklistError("Selecione um checklist para iniciar."); return; }
    if (!isOnline) { setChecklistError("Checklist disponível apenas online nesta versão."); return; }
    if (activeCd == null) { setChecklistError("CD não definido para este usuário."); return; }
    if (selectedChecklist.requires_evaluated_user && !evaluatedMat.trim()) {
      setChecklistError("Informe a matrícula do colaborador avaliado."); return;
    }
    if (answeredCount !== selectedChecklist.total_items) {
      setChecklistError(`Responda todos os ${selectedChecklist.total_items} itens antes de finalizar.`); return;
    }
    if (nonConformities > 0 && !observations.trim()) {
      setChecklistError("Informe a observação geral quando houver não conformidade."); return;
    }
    if (!signatureAccepted) { setChecklistError("Confirme a assinatura eletrônica antes de finalizar."); return; }
    setErrorMessage(null);
    setConfirmationPopup({
      checklistTitle: selectedChecklist.title,
      scoringMode: selectedChecklist.scoring_mode,
      conformityPercent: draftResult.conformityPercent,
      nonConformities,
      riskScorePercent: draftResult.riskScorePercent,
      riskLevel: draftResult.riskLevel,
      scorePoints: draftResult.scorePoints,
      scoreMaxPoints: draftResult.scoreMaxPoints,
      criticalFail: draftResult.criticalFail,
      evaluatedLabel: selectedChecklist.requires_evaluated_user
        ? `${evaluatedUser?.nome ?? "Colaborador não validado"} | MAT ${normalizeMat(evaluatedMat) || "-"}`
        : currentCdLabel
    });
  }, [activeCd, answeredCount, currentCdLabel, draftResult, evaluatedMat, evaluatedUser, isOnline, nonConformities, selectedChecklist, setChecklistError, signatureAccepted, observations]);

  const loadReportRows = useCallback(async () => {
    if (!canSeeAdmin) return;
    if (!isOnline) { setReportError("Consulta admin disponível apenas online."); return; }
    const parsedCd = isGlobalAdmin && reportCd.trim() ? Number.parseInt(reportCd.trim(), 10) : null;
    if (isGlobalAdmin && reportCd.trim() && !Number.isFinite(parsedCd)) { setReportError("Informe um CD válido."); return; }
    if (!isGlobalAdmin && activeCd == null) { setReportError("CD não definido para este usuário."); return; }
    setReportBusy(true);
    try {
      const rows = await fetchChecklistAdminList({
        dt_ini: reportDtIni, dt_fim: reportDtFim,
        cd: isGlobalAdmin ? parsedCd : activeCd,
        auditor: reportAuditor.trim() || null,
        evaluated: reportEvaluated.trim() || null,
        checklist_key: reportChecklistKey || null,
        limit: 200
      });
      setReportRows(rows);
      setReportMessage(rows.length > 0 ? `${rows.length} auditoria(s) encontrada(s).` : "Nenhuma auditoria encontrada no período.");
      setReportError(null);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Falha ao consultar auditorias.");
    } finally {
      setReportBusy(false);
    }
  }, [activeCd, canSeeAdmin, isGlobalAdmin, isOnline, reportAuditor, reportCd, reportDtFim, reportDtIni, reportEvaluated, reportChecklistKey]);

  useEffect(() => {
    if (canSeeAdmin && isOnline && !initialReportLoadedRef.current) {
      initialReportLoadedRef.current = true;
      void loadReportRows();
    }
  }, [canSeeAdmin, isOnline, loadReportRows]);

  const exportPdf = useCallback(async (auditId: string) => {
    setReportExportingId(auditId);
    try {
      const detail = await fetchChecklistDetail(auditId);
      await buildPdf(detail);
      setReportMessage("PDF gerado com sucesso.");
      setReportError(null);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Falha ao gerar PDF.");
    } finally {
      setReportExportingId(null);
    }
  }, []);

  return (
    <>
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
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
          <span className="module-title">{MODULE_DEF.title}</span>
        </div>
      </header>

      <section className="modules-shell">
        <article className="module-screen surface-enter checklist-page">
          {!selectedChecklist ? (
            <>
              {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
              <ChecklistSelector
                definitions={CHECKLIST_DEFINITIONS}
                onSelect={startChecklist}
                isOnline={isOnline}
                currentCdLabel={currentCdLabel}
                monthLabel={monthLabel}
              />
            </>
          ) : (
            <form className="checklist-form" onSubmit={submitChecklist}>
              <ChecklistHero
                checklist={selectedChecklist}
                draftResult={draftResult}
                answeredCount={answeredCount}
                currentCdLabel={currentCdLabel}
                monthLabel={monthLabel}
              />

              {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
              {statusMessage ? <div className="alert success">{statusMessage}</div> : null}

              {/* Dados da auditoria */}
              <section className="checklist-panel">
                <div className="checklist-panel-head">
                  <div>
                    <h3>Dados da auditoria</h3>
                    <span>{`Auditor: ${displayUserName} | MAT ${profile.mat || "-"} | ${selectedChecklist.requires_evaluated_user ? "Auditoria por colaborador" : "Auditoria por CD"}`}</span>
                  </div>
                  <button type="button" className="btn btn-muted" onClick={switchChecklist} disabled={busySubmit}>
                    Trocar checklist
                  </button>
                </div>
                {selectedChecklist.requires_evaluated_user ? (
                  <>
                    <div className="checklist-fields-grid">
                      <label>
                        Matrícula do avaliado
                        <input
                          type="text"
                          inputMode="numeric"
                          value={evaluatedMat}
                          onChange={(event) => handleEvaluatedMatChange(event.target.value)}
                          onBlur={() => { if (evaluatedMat.trim()) void lookupEvaluated(evaluatedMat); }}
                          placeholder="Informe a matrícula"
                          disabled={busySubmit}
                        />
                      </label>
                      <label>
                        Nome do avaliado
                        <input
                          type="text"
                          value={evaluatedUser?.nome ?? ""}
                          placeholder={evaluatedLookupBusy ? "Buscando no DB_USUARIO..." : "Preenchido automaticamente"}
                          readOnly
                          disabled={busySubmit}
                          className="checklist-readonly-input"
                        />
                      </label>
                    </div>
                    <div className="checklist-lookup-row">
                      <button
                        type="button"
                        className="btn btn-muted"
                        onClick={() => void lookupEvaluated(evaluatedMat)}
                        disabled={busySubmit || evaluatedLookupBusy || !isOnline || !evaluatedMat.trim()}
                      >
                        {evaluatedLookupBusy ? "Buscando..." : "Buscar avaliado"}
                      </button>
                      {evaluatedUser ? (
                        <span>{`Avaliado localizado: ${evaluatedUser.nome}${evaluatedUser.cargo ? ` | ${evaluatedUser.cargo}` : ""}`}</span>
                      ) : (
                        <span>O nome será preenchido somente a partir do DB_USUARIO.</span>
                      )}
                    </div>
                    {evaluatedLookupError ? <div className="alert error">{evaluatedLookupError}</div> : null}
                  </>
                ) : (
                  <div className="alert success">Este modelo audita o CD/processo, sem colaborador avaliado.</div>
                )}
              </section>

              {/* Seções de itens */}
              {selectedChecklist.sections.map((sectionKey) => {
                const items = sectionItems(selectedChecklist, sectionKey);
                const title = items[0]?.section_title ?? "";
                return (
                  <ChecklistSectionPanel
                    key={sectionKey}
                    items={items}
                    sectionTitle={title}
                    answers={answers}
                    onAnswer={updateAnswer}
                    disabled={busySubmit}
                    scoringMode={selectedChecklist.scoring_mode}
                  />
                );
              })}

              {/* Observações e aceite */}
              <section className="checklist-panel">
                <div className="checklist-panel-head">
                  <div>
                    <h3>Observações e aceite</h3>
                    <span>
                      {nonConformities > 0
                        ? `${nonConformities} não conformidade(s) exigem observação.`
                        : "Sem não conformidades até agora."}
                    </span>
                  </div>
                </div>
                <label>
                  Observação geral
                  <textarea
                    rows={4}
                    value={observations}
                    onChange={(event) => setObservations(event.target.value)}
                    placeholder="Descreva os pontos encontrados na auditoria."
                    disabled={busySubmit}
                  />
                </label>
                <label className="checklist-signature-box">
                  <input
                    type="checkbox"
                    checked={signatureAccepted}
                    onChange={(event) => setSignatureAccepted(event.target.checked)}
                    disabled={busySubmit}
                  />
                  <span>
                    Confirmo eletronicamente que realizei esta auditoria como {displayUserName} ({profile.mat || "sem matrícula"}).
                  </span>
                </label>
                <div className="checklist-submit-row">
                  <button type="button" className="btn btn-muted" onClick={resetCurrentForm} disabled={busySubmit}>
                    Limpar
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={busySubmit || !isOnline}>
                    {busySubmit ? "Finalizando..." : "Finalizar checklist"}
                  </button>
                </div>
              </section>
            </form>
          )}

          {canSeeAdmin ? (
            <AdminPanel
              isOnline={isOnline}
              isGlobalAdmin={isGlobalAdmin}
              currentCdLabel={currentCdLabel}
              reportDtIni={reportDtIni}
              reportDtFim={reportDtFim}
              reportCd={reportCd}
              reportAuditor={reportAuditor}
              reportEvaluated={reportEvaluated}
              reportChecklistKey={reportChecklistKey}
              reportRows={reportRows}
              reportBusy={reportBusy}
              reportExportingId={reportExportingId}
              reportMessage={reportMessage}
              reportError={reportError}
              onDtIniChange={setReportDtIni}
              onDtFimChange={setReportDtFim}
              onCdChange={setReportCd}
              onAuditorChange={setReportAuditor}
              onEvaluatedChange={setReportEvaluated}
              onChecklistKeyChange={setReportChecklistKey}
              onSearch={() => void loadReportRows()}
              onExportPdf={(id) => void exportPdf(id)}
            />
          ) : null}

          {completionPopup ? (
            <CompletionModal
              popup={completionPopup}
              onClose={() => { setCompletionPopup(null); scrollChecklistTop(); }}
            />
          ) : null}

          {confirmationPopup ? (
            <ConfirmationModal
              popup={confirmationPopup}
              onConfirm={() => void executeFinalizeChecklist()}
              onCancel={() => setConfirmationPopup(null)}
              busySubmit={busySubmit}
            />
          ) : null}

          <div className="checklist-footnote">
            <span>{`Hoje: ${formatDateOnlyPtBR(todayIsoBrasilia())}`}</span>
            <span>Fotos e assinatura desenhada ficam fora desta versão.</span>
          </div>
        </article>
      </section>
    </>
  );
}
