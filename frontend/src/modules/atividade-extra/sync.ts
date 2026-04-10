import { supabase } from "../../lib/supabase";
import type {
  AtividadeExtraApprovalStatus,
  AtividadeExtraAdminPointsCreatePayload,
  AtividadeExtraAssignableUserRow,
  AtividadeExtraEntryMode,
  AtividadeExtraCollaboratorRow,
  AtividadeExtraCreatePayload,
  AtividadeExtraEntryRow,
  AtividadeExtraMonthOption,
  AtividadeExtraUpdatePayload,
  AtividadeExtraVisibilityMode,
  AtividadeExtraVisibilityRow
} from "./types";

function toErrorMessage(error: unknown): string {
  const mapCode = (raw: string): string => {
    const normalized = raw.trim().toUpperCase();
    if (normalized.includes("AUTH_REQUIRED")) return "Sessão inválida. Faça login novamente.";
    if (normalized.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Faça login novamente.";
    if (normalized.includes("CD_NAO_DEFINIDO_USUARIO")) return "CD não definido para este usuário.";
    if (normalized.includes("CD_SEM_ACESSO")) return "Sem acesso ao CD selecionado.";
    if (normalized.includes("PROFILE_NAO_ENCONTRADO")) return "Perfil do usuário não encontrado.";
    if (normalized.includes("VISIBILIDADE_INVALIDA")) return "Modo de visibilidade inválido.";
    if (normalized.includes("APENAS_ADMIN")) return "Apenas admin pode alterar a visibilidade.";
    if (normalized.includes("DESCRICAO_OBRIGATORIA")) return "Descrição da atividade é obrigatória.";
    if (normalized.includes("DATA_INICIO_OBRIGATORIA")) return "Data inicial é obrigatória.";
    if (normalized.includes("HORA_INICIO_OBRIGATORIA")) return "Hora inicial é obrigatória.";
    if (normalized.includes("DATA_FIM_OBRIGATORIA")) return "Data final é obrigatória.";
    if (normalized.includes("HORA_FIM_OBRIGATORIA")) return "Hora final é obrigatória.";
    if (normalized.includes("DATA_FIM_DIFERENTE_DATA_INICIO")) return "Início e fim devem estar no mesmo dia.";
    if (normalized.includes("HORARIO_INICIO_FORA_JANELA")) return "Início deve estar entre 06:00 e 21:30.";
    if (normalized.includes("HORARIO_FIM_FORA_JANELA")) return "Fim deve estar entre 06:00 e 21:30.";
    if (normalized.includes("MES_FORA_DO_ATUAL")) return "Só é permitido registrar atividade no mês atual.";
    if (normalized.includes("INTERVALO_INVALIDO")) return "Horário final deve ser maior que o horário inicial.";
    if (normalized.includes("FUTURO_NAO_PERMITIDO")) return "Não é permitido registrar atividade futura.";
    if (normalized.includes("ATIVIDADE_NAO_ENCONTRADA_OU_SEM_ACESSO")) return "Atividade não encontrada ou sem acesso.";
    if (normalized.includes("SEM_PERMISSAO_VISUALIZAR_COLABORADOR")) {
      return "Você não tem permissão para visualizar este colaborador.";
    }
    if (normalized.includes("COLABORADOR_OBRIGATORIO")) return "Selecione um colaborador.";
    if (normalized.includes("COLABORADOR_SEM_ACESSO_CD")) return "O colaborador selecionado não pertence ao CD atual.";
    if (normalized.includes("PONTOS_OBRIGATORIOS")) return "Informe a pontuação.";
    if (normalized.includes("PONTOS_FORA_FAIXA")) return "A pontuação deve ser maior que zero.";
    if (normalized.includes("ID_OBRIGATORIO")) return "Identificador da atividade é obrigatório.";
    if (normalized.includes("ATIVIDADE_APROVADA_NAO_EDITAVEL")) return "Atividade já aprovada não pode ser editada.";
    return raw;
  };

  if (error instanceof Error) return mapCode(error.message);
  if (typeof error === "string") return mapCode(error);
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.message === "string") return mapCode(candidate.message);
    if (typeof candidate.error_description === "string") return mapCode(candidate.error_description);
    if (typeof candidate.details === "string") return mapCode(candidate.details);
  }
  return "Erro inesperado.";
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
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

function parseVisibility(value: unknown): AtividadeExtraVisibilityMode {
  return String(value) === "owner_only" ? "owner_only" : "public_cd";
}

function parseApprovalStatus(value: unknown): AtividadeExtraApprovalStatus {
  return String(value) === "approved" ? "approved" : "pending";
}

function parseEntryMode(value: unknown): AtividadeExtraEntryMode {
  return String(value) === "manual_points" ? "manual_points" : "timed";
}

function mapVisibilityRow(raw: Record<string, unknown>): AtividadeExtraVisibilityRow {
  return {
    cd: parseInteger(raw.cd),
    visibility_mode: parseVisibility(raw.visibility_mode),
    updated_by: parseNullableString(raw.updated_by),
    updated_at: parseNullableString(raw.updated_at)
  };
}

function mapMonthOption(raw: Record<string, unknown>): AtividadeExtraMonthOption {
  return {
    month_start: parseString(raw.month_start),
    month_label: parseString(raw.month_label)
  };
}

function mapCollaboratorRow(raw: Record<string, unknown>): AtividadeExtraCollaboratorRow {
  return {
    user_id: parseString(raw.user_id),
    mat: parseString(raw.mat),
    nome: parseString(raw.nome),
    pontos_soma: parseNumber(raw.pontos_soma),
    tempo_total_segundos: parseInteger(raw.tempo_total_segundos),
    tempo_total_hms: parseString(raw.tempo_total_hms, "00:00:00"),
    atividades_count: parseInteger(raw.atividades_count)
  };
}

function mapAssignableUserRow(raw: Record<string, unknown>): AtividadeExtraAssignableUserRow {
  return {
    user_id: parseString(raw.user_id),
    mat: parseString(raw.mat),
    nome: parseString(raw.nome)
  };
}

function mapEntryRow(raw: Record<string, unknown>): AtividadeExtraEntryRow {
  return {
    id: parseString(raw.id),
    cd: parseInteger(raw.cd),
    user_id: parseString(raw.user_id),
    mat: parseString(raw.mat),
    nome: parseString(raw.nome),
    entry_mode: parseEntryMode(raw.entry_mode),
    data_inicio: parseString(raw.data_inicio),
    hora_inicio: parseString(raw.hora_inicio),
    data_fim: parseString(raw.data_fim),
    hora_fim: parseString(raw.hora_fim),
    duracao_segundos: parseInteger(raw.duracao_segundos),
    tempo_gasto_hms: parseString(raw.tempo_gasto_hms, "00:00:00"),
    pontos: parseNumber(raw.pontos),
    descricao: parseString(raw.descricao),
    approval_status: parseApprovalStatus(raw.approval_status),
    approved_at: parseNullableString(raw.approved_at),
    approved_by: parseNullableString(raw.approved_by),
    approved_by_mat: parseNullableString(raw.approved_by_mat),
    approved_by_nome: parseNullableString(raw.approved_by_nome),
    created_at: parseString(raw.created_at),
    updated_at: parseString(raw.updated_at),
    can_edit: Boolean(raw.can_edit),
    can_delete: Boolean(raw.can_delete),
    can_approve: Boolean(raw.can_approve)
  };
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data)) return null;
  const row = data[0];
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

export async function fetchAtividadeExtraVisibility(cd: number | null): Promise<AtividadeExtraVisibilityRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_atividade_extra_visibility_get", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao buscar visibilidade do CD.");
  return mapVisibilityRow(row);
}

export async function fetchAtividadeExtraMonthOptions(cd: number | null): Promise<AtividadeExtraMonthOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_atividade_extra_month_options", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapMonthOption(row as Record<string, unknown>));
}

export async function setAtividadeExtraVisibility(
  cd: number,
  visibilityMode: AtividadeExtraVisibilityMode
): Promise<AtividadeExtraVisibilityRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_atividade_extra_visibility_set", {
    p_cd: cd,
    p_visibility_mode: visibilityMode
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao atualizar visibilidade do CD.");
  return mapVisibilityRow(row);
}

export async function insertAtividadeExtra(payload: AtividadeExtraCreatePayload): Promise<AtividadeExtraEntryRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_atividade_extra_insert", {
    p_cd: payload.cd,
    p_data_inicio: payload.data_inicio,
    p_hora_inicio: payload.hora_inicio,
    p_data_fim: payload.data_fim,
    p_hora_fim: payload.hora_fim,
    p_descricao: payload.descricao
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao registrar atividade.");
  return mapEntryRow(row);
}

export async function insertAtividadeExtraAdminPoints(
  payload: AtividadeExtraAdminPointsCreatePayload
): Promise<AtividadeExtraEntryRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_atividade_extra_insert_admin_points", {
    p_cd: payload.cd,
    p_target_user_id: payload.target_user_id,
    p_data_atividade: payload.data_atividade,
    p_pontos: payload.pontos,
    p_descricao: payload.descricao
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao registrar pontuação manual.");
  return mapEntryRow(row);
}

export async function updateAtividadeExtra(payload: AtividadeExtraUpdatePayload): Promise<AtividadeExtraEntryRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_atividade_extra_update", {
    p_id: payload.id,
    p_data_inicio: payload.data_inicio,
    p_hora_inicio: payload.hora_inicio,
    p_data_fim: payload.data_fim,
    p_hora_fim: payload.hora_fim,
    p_descricao: payload.descricao
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao atualizar atividade.");
  return mapEntryRow(row);
}

export async function deleteAtividadeExtra(entryId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_atividade_extra_delete", {
    p_id: entryId
  });
  if (error) throw new Error(toErrorMessage(error));
  if (data !== true) throw new Error("Atividade não encontrada para exclusão.");
}

export async function fetchAtividadeExtraCollaborators(
  cd: number | null,
  monthStart: string
): Promise<AtividadeExtraCollaboratorRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_atividade_extra_collaborators", {
    p_cd: cd,
    p_month_start: monthStart
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapCollaboratorRow(row as Record<string, unknown>));
}

export async function fetchAtividadeExtraAssignableUsers(cd: number | null): Promise<AtividadeExtraAssignableUserRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_atividade_extra_assignable_users", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapAssignableUserRow(row as Record<string, unknown>));
}

export async function fetchAtividadeExtraEntries(params: {
  cd: number | null;
  targetUserId: string | null;
  monthStart: string;
}): Promise<AtividadeExtraEntryRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_atividade_extra_entries_v2", {
    p_cd: params.cd,
    p_target_user_id: params.targetUserId,
    p_month_start: params.monthStart
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapEntryRow(row as Record<string, unknown>));
}

export async function fetchAtividadeExtraPendingEntries(
  cd: number | null,
  monthStart: string
): Promise<AtividadeExtraEntryRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_atividade_extra_pending_entries", {
    p_cd: cd,
    p_month_start: monthStart
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapEntryRow(row as Record<string, unknown>));
}

export async function approveAtividadeExtra(entryId: string): Promise<AtividadeExtraEntryRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_atividade_extra_approve", {
    p_id: entryId
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao aprovar atividade.");
  return mapEntryRow(row);
}
