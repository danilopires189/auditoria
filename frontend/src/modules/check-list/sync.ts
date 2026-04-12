import { supabase } from "../../lib/supabase";
import type {
  ChecklistAdminFilters,
  ChecklistAnswer,
  ChecklistAuditDetail,
  ChecklistAuditResult,
  ChecklistAuditSummary,
  ChecklistEvaluatedUser,
  ChecklistFinalizePayload,
  ChecklistKey,
  ChecklistSectionKey
} from "./types";

function toErrorMessage(error: unknown): string {
  const raw = (() => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const candidate = error as Record<string, unknown>;
      if (typeof candidate.message === "string") return candidate.message;
      if (typeof candidate.error_description === "string") return candidate.error_description;
      if (typeof candidate.details === "string") return candidate.details;
    }
    return "Erro inesperado.";
  })();

  const normalized = raw.toUpperCase();
  if (normalized.includes("AUTH_REQUIRED")) return "Sessão inválida. Faça login novamente.";
  if (normalized.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Faça login novamente.";
  if (normalized.includes("CD_NAO_DEFINIDO_USUARIO")) return "CD não definido para este usuário.";
  if (normalized.includes("CD_SEM_ACESSO")) return "Sem acesso ao CD selecionado.";
  if (normalized.includes("PROFILE_NAO_ENCONTRADO")) return "Perfil do usuário não encontrado.";
  if (normalized.includes("CHECKLIST_INVALIDO")) return "Checklist selecionado inválido.";
  if (normalized.includes("AVALIADO_MATRICULA_OBRIGATORIA")) return "Informe a matrícula do colaborador avaliado.";
  if (normalized.includes("AVALIADO_NAO_ENCONTRADO")) return "Matrícula não encontrada no DB_USUARIO deste CD.";
  if (normalized.includes("ASSINATURA_ELETRONICA_OBRIGATORIA")) return "Confirme a assinatura eletrônica antes de finalizar.";
  if (normalized.includes("RESPOSTAS_INVALIDAS")) return "As respostas do checklist estão inválidas.";
  if (normalized.includes("RESPOSTAS_OBRIGATORIAS")) return "Responda todos os itens antes de finalizar.";
  if (normalized.includes("OBSERVACAO_OBRIGATORIA_NC")) return "Informe a observação geral quando houver não conformidade.";
  if (normalized.includes("APENAS_ADMIN")) return "Apenas admin pode consultar auditorias finalizadas.";
  if (normalized.includes("PERIODO_OBRIGATORIO")) return "Informe o período da consulta.";
  if (normalized.includes("PERIODO_INVALIDO")) return "A data final deve ser maior ou igual à data inicial.";
  if (normalized.includes("JANELA_MAX_90_DIAS")) return "Consulte no máximo 90 dias por vez.";
  if (normalized.includes("AUDITORIA_OBRIGATORIA") || normalized.includes("AUDITORIA_NAO_ENCONTRADA")) return "Auditoria não encontrada.";
  return raw;
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumber(value: unknown, fallback = 0): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseString(value: unknown, fallback = ""): string {
  const parsed = String(value ?? "").trim();
  return parsed || fallback;
}

function parseNullableString(value: unknown): string | null {
  const parsed = parseString(value);
  return parsed || null;
}

function parseChecklistKey(value: unknown): ChecklistKey {
  return parseString(value) === "dto_alocacao" ? "dto_alocacao" : "dto_pvps";
}

function parseAnswer(value: unknown): ChecklistAnswer {
  const parsed = parseString(value);
  if (parsed === "Não" || parsed === "N.A.") return parsed;
  return "Sim";
}

function parseSectionKey(value: unknown): ChecklistSectionKey {
  const parsed = parseString(value);
  if (parsed === "pulmao" || parsed === "alocacao") return parsed;
  return "zona_separacao";
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data)) return null;
  const row = data[0];
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

function mapSummary(raw: Record<string, unknown>): ChecklistAuditSummary {
  return {
    audit_id: parseString(raw.audit_id),
    cd: parseInteger(raw.cd),
    cd_nome: parseNullableString(raw.cd_nome),
    checklist_key: parseChecklistKey(raw.checklist_key),
    checklist_title: parseString(raw.checklist_title, "DTO - Auditoria"),
    checklist_version: parseString(raw.checklist_version, "1.0"),
    evaluated_mat: parseString(raw.evaluated_mat),
    evaluated_nome: parseString(raw.evaluated_nome),
    auditor_mat: parseString(raw.auditor_mat),
    auditor_nome: parseString(raw.auditor_nome),
    non_conformities: parseInteger(raw.non_conformities),
    conformity_percent: parseNumber(raw.conformity_percent),
    created_at: parseString(raw.created_at),
    signed_at: parseNullableString(raw.signed_at)
  };
}

function mapAuditResult(raw: Record<string, unknown>): ChecklistAuditResult {
  return {
    ...mapSummary(raw),
    observations: parseNullableString(raw.observations),
    signature_accepted: Boolean(raw.signature_accepted),
    total_items: parseInteger(raw.total_items, 17)
  };
}

function mapDetail(raw: Record<string, unknown>): ChecklistAuditDetail {
  const answersRaw = Array.isArray(raw.answers) ? raw.answers : [];
  return {
    ...mapAuditResult(raw),
    answers: answersRaw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const answer = item as Record<string, unknown>;
        return {
          item_number: parseInteger(answer.item_number),
          section_key: parseSectionKey(answer.section_key),
          section_title: parseString(answer.section_title),
          question: parseString(answer.question),
          answer: parseAnswer(answer.answer),
          is_nonconformity: Boolean(answer.is_nonconformity)
        };
      })
      .filter((item): item is ChecklistAuditDetail["answers"][number] => item != null)
      .sort((left, right) => left.item_number - right.item_number)
  };
}

function mapEvaluatedUser(raw: Record<string, unknown>): ChecklistEvaluatedUser {
  return {
    cd: parseInteger(raw.cd),
    mat: parseString(raw.mat),
    nome: parseString(raw.nome),
    cargo: parseNullableString(raw.cargo)
  };
}

export async function lookupChecklistEvaluatedUser(params: { cd: number | null; mat: string }): Promise<ChecklistEvaluatedUser> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_checklist_dto_pvps_lookup_evaluated", {
    p_cd: params.cd,
    p_mat: params.mat
  });

  if (error) throw new Error(toErrorMessage(error));
  const row = firstRow(data);
  if (!row) throw new Error("Matrícula não encontrada no DB_USUARIO deste CD.");
  return mapEvaluatedUser(row);
}

export async function finalizeChecklistAudit(payload: ChecklistFinalizePayload): Promise<ChecklistAuditResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_checklist_dto_pvps_finalize", {
    p_checklist_key: payload.checklist_key,
    p_cd: payload.cd,
    p_evaluated_mat: payload.evaluated_mat,
    p_observations: payload.observations,
    p_signature_accepted: payload.signature_accepted,
    p_answers: payload.answers
  });

  if (error) throw new Error(toErrorMessage(error));
  const row = firstRow(data);
  if (!row) throw new Error("Falha ao finalizar checklist.");
  return mapAuditResult(row);
}

export async function fetchChecklistAdminList(filters: ChecklistAdminFilters): Promise<ChecklistAuditSummary[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_checklist_dto_pvps_admin_list", {
    p_dt_ini: filters.dt_ini,
    p_dt_fim: filters.dt_fim,
    p_cd: filters.cd,
    p_auditor: filters.auditor,
    p_evaluated: filters.evaluated,
    p_checklist_key: filters.checklist_key,
    p_limit: filters.limit ?? 200
  });

  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapSummary(row as Record<string, unknown>));
}

export async function fetchChecklistDetail(auditId: string): Promise<ChecklistAuditDetail> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_checklist_dto_pvps_detail", {
    p_audit_id: auditId
  });

  if (error) throw new Error(toErrorMessage(error));
  const row = firstRow(data);
  if (!row) throw new Error("Auditoria não encontrada.");
  return mapDetail(row);
}
