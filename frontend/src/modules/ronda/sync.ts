import { supabase } from "../../lib/supabase";
import type {
  RondaQualidadeAddressOption,
  RondaQualidadeCorrectionStatus,
  RondaQualidadeMonthOption,
  RondaQualidadeOccurrenceDraft,
  RondaQualidadeOccurrenceHistoryRow,
  RondaQualidadeZoneDetail,
  RondaQualidadeZoneSummary,
  RondaQualidadeZoneType
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
  if (normalized.includes("ZONE_TYPE_INVALIDO")) return "Tipo de zona inválido.";
  if (normalized.includes("ZONA_OBRIGATORIA")) return "Selecione uma zona antes de continuar.";
  if (normalized.includes("AUDIT_RESULT_INVALIDO")) return "Resultado da auditoria inválido.";
  if (normalized.includes("OCCURRENCES_INVALIDAS")) return "Lista de ocorrências inválida.";
  if (normalized.includes("SEM_OCORRENCIA_NAO_ACEITA_ITENS")) return "Auditoria sem ocorrência não pode ter itens.";
  if (normalized.includes("SEM_OCORRENCIA_DUPLICADA_COLUNA")) return "Esta coluna já foi registrada sem ocorrência neste mês.";
  if (normalized.includes("SEM_OCORRENCIA_DUPLICADA_ZONA")) return "Esta zona já foi registrada sem ocorrência neste mês.";
  if (normalized.includes("OCORRENCIA_OBRIGATORIA")) return "Adicione pelo menos uma ocorrência antes de salvar.";
  if (normalized.includes("ENDERECO_OBRIGATORIO")) return "Informe o endereço da ocorrência.";
  if (normalized.includes("MOTIVO_OBRIGATORIO")) return "Selecione o motivo da ocorrência.";
  if (normalized.includes("OBSERVACAO_OBRIGATORIA")) return "Informe a observação da ocorrência.";
  if (normalized.includes("COLUNA_OBRIGATORIA_PUL")) return "Selecione a coluna do Pulmão antes de salvar.";
  if (normalized.includes("COLUNA_FORA_DA_ZONA")) return "A coluna selecionada não pertence à zona.";
  if (normalized.includes("ZONA_SEM_ESTOQUE_DISPONIVEL")) return "Esta zona não possui mais produtos com estoque disponível.";
  if (normalized.includes("COLUNA_SEM_ESTOQUE_DISPONIVEL")) return "Esta coluna não possui mais produtos com estoque disponível.";
  if (normalized.includes("ENDERECO_SEM_ESTOQUE_DISPONIVEL")) return "Este endereço não possui mais produtos com estoque disponível.";
  if (normalized.includes("MOTIVO_INVALIDO_SEP") || normalized.includes("MOTIVO_INVALIDO_PUL")) return "Motivo inválido para o tipo de zona selecionado.";
  if (normalized.includes("ENDERECO_FORA_DA_ZONA")) return "O endereço informado não pertence à zona selecionada.";
  if (normalized.includes("ENDERECO_FORA_DA_COLUNA")) return "O endereço informado não pertence à coluna selecionada.";
  if (normalized.includes("CORRECTION_STATUS_INVALIDO")) return "Status de correção inválido.";
  if (normalized.includes("OCCURRENCE_ID_OBRIGATORIO") || normalized.includes("OCCURRENCE_NAO_ENCONTRADA")) return "Ocorrência não encontrada.";
  if (normalized.includes("STATEMENT TIMEOUT")) return "A operação demorou mais que o esperado. Tente novamente; se persistir, sincronize a base antes de finalizar.";
  return raw;
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
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

function parseCorrectionStatus(value: unknown): RondaQualidadeCorrectionStatus {
  return String(value ?? "").trim().toLowerCase() === "corrigido" ? "corrigido" : "nao_corrigido";
}

function parseZoneType(value: unknown): RondaQualidadeZoneType {
  return String(value ?? "").trim().toUpperCase() === "PUL" ? "PUL" : "SEP";
}

function mapMonthOption(raw: Record<string, unknown>): RondaQualidadeMonthOption {
  return {
    month_start: parseString(raw.month_start),
    month_label: parseString(raw.month_label)
  };
}

function mapAddressOption(raw: Record<string, unknown>): RondaQualidadeAddressOption {
  return {
    endereco: parseString(raw.endereco),
    coluna: parseNullableInteger(raw.coluna),
    nivel: parseNullableString(raw.nivel),
    produtos_unicos: Math.max(parseInteger(raw.produtos_unicos), 0),
    produto_label: parseString(raw.produto_label, "Produto")
  };
}

function mapZoneSummary(raw: Record<string, unknown>): RondaQualidadeZoneSummary {
  return {
    cd: parseInteger(raw.cd),
    month_ref: parseString(raw.month_ref),
    zone_type: parseZoneType(raw.zone_type),
    zona: parseString(raw.zona),
    total_enderecos: Math.max(parseInteger(raw.total_enderecos), 0),
    produtos_unicos: Math.max(parseInteger(raw.produtos_unicos), 0),
    enderecos_com_ocorrencia: Math.max(parseInteger(raw.enderecos_com_ocorrencia), 0),
    percentual_conformidade: Math.max(parseNumber(raw.percentual_conformidade), 0),
    audited_in_month: Boolean(raw.audited_in_month),
    total_auditorias: Math.max(parseInteger(raw.total_auditorias), 0),
    last_audit_at: parseNullableString(raw.last_audit_at),
    last_started_at: parseNullableString(raw.last_started_at),
    last_finished_at: parseNullableString(raw.last_finished_at),
    total_colunas: Math.max(parseInteger(raw.total_colunas), 0),
    total_colunas_auditadas: Math.max(parseInteger(raw.total_colunas_auditadas), 0),
    total_niveis: Math.max(parseInteger(raw.total_niveis), 0)
  };
}

function parseColumnStats(value: unknown): RondaQualidadeZoneDetail["column_stats"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const coluna = parseNullableInteger(raw.coluna);
      if (coluna == null) return null;
      return {
        coluna,
        total_enderecos: Math.max(parseInteger(raw.total_enderecos), 0),
        produtos_unicos: Math.max(parseInteger(raw.produtos_unicos), 0),
        enderecos_com_ocorrencia: Math.max(parseInteger(raw.enderecos_com_ocorrencia), 0),
        percentual_conformidade: Math.max(parseNumber(raw.percentual_conformidade), 0),
        audited_in_month: Boolean(raw.audited_in_month),
        total_auditorias: Math.max(parseInteger(raw.total_auditorias), 0),
        last_audit_at: parseNullableString(raw.last_audit_at),
        last_started_at: parseNullableString(raw.last_started_at),
        last_finished_at: parseNullableString(raw.last_finished_at)
      };
    })
    .filter((item): item is RondaQualidadeZoneDetail["column_stats"][number] => item != null);
}

function parseLevelStats(value: unknown): RondaQualidadeZoneDetail["level_stats"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const nivel = parseNullableString(raw.nivel);
      if (!nivel) return null;
      return {
        nivel,
        total_enderecos: Math.max(parseInteger(raw.total_enderecos), 0),
        produtos_unicos: Math.max(parseInteger(raw.produtos_unicos), 0)
      };
    })
    .filter((item): item is RondaQualidadeZoneDetail["level_stats"][number] => item != null);
}

function parseHistoryRows(value: unknown): RondaQualidadeZoneDetail["history_rows"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const occurrencesRaw = Array.isArray(raw.occurrences) ? raw.occurrences : [];
      return {
        audit_id: parseString(raw.audit_id),
        audit_result: parseString(raw.audit_result) === "sem_ocorrencia" ? "sem_ocorrencia" : "com_ocorrencia",
        coluna: parseNullableInteger(raw.coluna),
        auditor_nome: parseString(raw.auditor_nome, "Usuário"),
        auditor_mat: parseString(raw.auditor_mat, "-"),
        created_at: parseString(raw.created_at),
        started_at: parseNullableString(raw.started_at),
        finished_at: parseNullableString(raw.finished_at),
        occurrence_count: Math.max(parseInteger(raw.occurrence_count), 0),
        occurrences: occurrencesRaw
          .map((occurrence) => {
            if (!occurrence || typeof occurrence !== "object") return null;
            const occRaw = occurrence as Record<string, unknown>;
            return {
              occurrence_id: parseString(occRaw.occurrence_id),
              motivo: parseString(occRaw.motivo),
              endereco: parseString(occRaw.endereco),
              nivel: parseNullableString(occRaw.nivel),
              coluna: parseNullableInteger(occRaw.coluna),
              observacao: parseString(occRaw.observacao),
              correction_status: parseCorrectionStatus(occRaw.correction_status),
              correction_updated_at: parseNullableString(occRaw.correction_updated_at),
              correction_updated_mat: parseNullableString(occRaw.correction_updated_mat),
              correction_updated_nome: parseNullableString(occRaw.correction_updated_nome),
              created_at: parseString(occRaw.created_at)
            };
          })
          .filter((occurrence): occurrence is RondaQualidadeZoneDetail["history_rows"][number]["occurrences"][number] => occurrence != null)
      };
    })
    .filter((item): item is RondaQualidadeZoneDetail["history_rows"][number] => item != null);
}

function mapZoneDetail(raw: Record<string, unknown>): RondaQualidadeZoneDetail {
  return {
    ...mapZoneSummary(raw),
    column_stats: parseColumnStats(raw.column_stats),
    level_stats: parseLevelStats(raw.level_stats),
    history_rows: parseHistoryRows(raw.history_rows)
  };
}

function mapOccurrenceHistoryRow(raw: Record<string, unknown>): RondaQualidadeOccurrenceHistoryRow {
  return {
    occurrence_id: parseString(raw.occurrence_id),
    audit_id: parseString(raw.audit_id),
    month_ref: parseString(raw.month_ref),
    cd: parseInteger(raw.cd),
    zone_type: parseZoneType(raw.zone_type),
    zona: parseString(raw.zona),
    coluna: parseNullableInteger(raw.coluna),
    endereco: parseString(raw.endereco),
    nivel: parseNullableString(raw.nivel),
    motivo: parseString(raw.motivo),
    observacao: parseString(raw.observacao),
    correction_status: parseCorrectionStatus(raw.correction_status),
    correction_updated_at: parseNullableString(raw.correction_updated_at),
    correction_updated_mat: parseNullableString(raw.correction_updated_mat),
    correction_updated_nome: parseNullableString(raw.correction_updated_nome),
    created_at: parseString(raw.created_at),
    auditor_nome: parseString(raw.auditor_nome, "Usuário"),
    auditor_mat: parseString(raw.auditor_mat, "-"),
    audit_result: parseString(raw.audit_result) === "sem_ocorrencia" ? "sem_ocorrencia" : "com_ocorrencia"
  };
}

export async function fetchRondaQualidadeZoneList(params: {
  cd?: number | null;
  zoneType: RondaQualidadeZoneType;
  monthRef?: string | null;
  search?: string | null;
}): Promise<RondaQualidadeZoneSummary[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_ronda_quality_zone_list", {
    p_cd: params.cd ?? null,
    p_zone_type: params.zoneType,
    p_month_ref: params.monthRef ?? null,
    p_search: params.search ?? null
  });

  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapZoneSummary(row as Record<string, unknown>));
}

export async function fetchRondaQualidadeMonthOptions(cd: number | null): Promise<RondaQualidadeMonthOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_ronda_quality_month_options", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapMonthOption(row as Record<string, unknown>));
}

export async function fetchRondaQualidadeAddressOptions(params: {
  cd?: number | null;
  zoneType: RondaQualidadeZoneType;
  zona: string;
  coluna?: number | null;
  search?: string | null;
  nivel?: string | null;
  limit?: number;
}): Promise<RondaQualidadeAddressOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_ronda_quality_address_options", {
    p_cd: params.cd ?? null,
    p_zone_type: params.zoneType,
    p_zona: params.zona,
    p_coluna: params.coluna ?? null,
    p_search: params.search ?? null,
    p_nivel: params.nivel ?? null,
    p_limit: params.limit ?? 500
  });

  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapAddressOption(row as Record<string, unknown>));
}

export async function fetchRondaQualidadeZoneDetail(params: {
  cd?: number | null;
  zoneType: RondaQualidadeZoneType;
  zona: string;
  monthRef?: string | null;
}): Promise<RondaQualidadeZoneDetail> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_ronda_quality_zone_detail", {
    p_cd: params.cd ?? null,
    p_zone_type: params.zoneType,
    p_zona: params.zona,
    p_month_ref: params.monthRef ?? null
  });

  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) {
    throw new Error("Zona não encontrada.");
  }
  return mapZoneDetail(first);
}

export async function submitRondaQualidadeAudit(params: {
  cd?: number | null;
  zoneType: RondaQualidadeZoneType;
  zona: string;
  coluna?: number | null;
  auditResult: "sem_ocorrencia" | "com_ocorrencia";
  occurrences?: RondaQualidadeOccurrenceDraft[];
  startedAt?: string | null;
}): Promise<{ audit_id: string; occurrence_count: number; created_at: string | null; started_at: string | null; finished_at: string | null }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const payload = (params.occurrences ?? []).map((occurrence) => ({
    motivo: occurrence.motivo.trim(),
    endereco: occurrence.endereco.trim().toUpperCase(),
    observacao: occurrence.observacao.trim() || null,
    nivel: occurrence.nivel.trim() || null,
    endereco_manual: occurrence.enderecoManual
  }));

  const { data, error } = await supabase.rpc("rpc_ronda_quality_submit_audit", {
    p_cd: params.cd ?? null,
    p_zone_type: params.zoneType,
    p_zona: params.zona,
    p_coluna: params.coluna ?? null,
    p_audit_result: params.auditResult,
    p_occurrences: payload,
    p_started_at: params.startedAt ?? null
  });

  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data)
    ? (data[0] as Record<string, unknown> | undefined)
    : (data && typeof data === "object" ? data as Record<string, unknown> : undefined);
  if (!first) throw new Error("Falha ao salvar auditoria.");
  return {
    audit_id: parseString(first.audit_id),
    occurrence_count: Math.max(parseInteger(first.occurrence_count), 0),
    created_at: parseNullableString(first.created_at),
    started_at: parseNullableString(first.started_at),
    finished_at: parseNullableString(first.finished_at)
  };
}

export async function fetchRondaQualidadeOccurrenceHistory(params: {
  cd?: number | null;
  zoneType?: RondaQualidadeZoneType | null;
  monthRef?: string | null;
  status?: "todos" | RondaQualidadeCorrectionStatus;
  search?: string | null;
  limit?: number;
  offset?: number;
}): Promise<RondaQualidadeOccurrenceHistoryRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_ronda_quality_occurrence_history", {
    p_cd: params.cd ?? null,
    p_zone_type: params.zoneType ?? null,
    p_month_ref: params.monthRef ?? null,
    p_status: params.status ?? "todos",
    p_search: params.search ?? null,
    p_limit: params.limit ?? 200,
    p_offset: params.offset ?? 0
  });

  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapOccurrenceHistoryRow(row as Record<string, unknown>));
}

export async function setRondaQualidadeOccurrenceCorrection(params: {
  occurrenceId: string;
  correctionStatus: RondaQualidadeCorrectionStatus;
}): Promise<{
  occurrence_id: string;
  correction_status: RondaQualidadeCorrectionStatus;
  correction_updated_at: string | null;
  correction_updated_mat: string | null;
  correction_updated_nome: string | null;
}> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_ronda_quality_occurrence_set_correction", {
    p_occurrence_id: params.occurrenceId,
    p_correction_status: params.correctionStatus
  });

  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao atualizar o status da ocorrência.");
  return {
    occurrence_id: parseString(first.occurrence_id),
    correction_status: parseCorrectionStatus(first.correction_status),
    correction_updated_at: parseNullableString(first.correction_updated_at),
    correction_updated_mat: parseNullableString(first.correction_updated_mat),
    correction_updated_nome: parseNullableString(first.correction_updated_nome)
  };
}

export async function deleteRondaQualidadeOccurrence(params: {
  occurrenceId: string;
}): Promise<{ success: boolean; message: string }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_ronda_quality_occurrence_delete", {
    p_occurrence_id: params.occurrenceId
  });

  if (error) throw new Error(toErrorMessage(error));
  return {
    success: true,
    message: "Ocorrência excluída com sucesso."
  };
}
