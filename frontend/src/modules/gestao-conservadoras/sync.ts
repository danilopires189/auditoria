import { supabase } from "../../lib/supabase";
import type {
  ConservadoraDocumentResult,
  ConservadoraHistoryFilters,
  ConservadoraRouteBinding,
  ConservadoraShipmentCard,
  ConservadoraStatus,
  ConservadoraTransportadora
} from "./types";

function parseString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStatus(value: unknown): ConservadoraStatus {
  if (value === "aguardando_documento") return "aguardando_documento";
  if (value === "documentacao_em_atraso") return "documentacao_em_atraso";
  if (value === "documentacao_recebida") return "documentacao_recebida";
  return "em_transito";
}

function parseDocumentResult(value: unknown): ConservadoraDocumentResult | null {
  if (value === "aprovada") return "aprovada";
  if (value === "reprovada") return "reprovada";
  return null;
}

function toErrorMessage(error: unknown): string {
  const rawMessage = (() => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const candidate = error as Record<string, unknown>;
      return typeof candidate.message === "string"
        ? candidate.message
        : typeof candidate.error_description === "string"
          ? candidate.error_description
          : typeof candidate.details === "string"
            ? candidate.details
            : "";
    }
    return "";
  })();

  const normalized = rawMessage.trim();
  if (!normalized) return "Erro inesperado.";
  if (/statement timeout|canceling statement/i.test(normalized)) {
    return "A consulta demorou além do limite. Tente novamente em instantes.";
  }
  if (normalized.includes("AUTH_REQUIRED")) return "Sessão inválida. Faça login novamente.";
  if (normalized.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Faça login novamente.";
  if (normalized.includes("CD_NAO_DEFINIDO_USUARIO")) return "CD não definido para este usuário.";
  if (normalized.includes("CD_SEM_ACESSO")) return "Você não possui acesso ao CD informado.";
  if (normalized.includes("EMBARQUE_OBRIGATORIO")) return "Selecione um embarque para confirmar o documento.";
  if (normalized.includes("EMBARQUE_NAO_ENCONTRADO")) return "Embarque não encontrado.";
  if (normalized.includes("RESULTADO_DOCUMENTO_OBRIGATORIO")) return "Selecione se o doc. foi aprovado ou reprovado.";
  if (normalized.includes("RESULTADO_DOCUMENTO_INVALIDO")) return "Resultado do doc. inválido.";
  if (normalized.includes("OCORRENCIA_OBRIGATORIA_REPROVACAO")) return "Informe a ocorrência quando o doc. for reprovado.";
  if (/column reference .*embarque_key.*ambiguous/i.test(normalized)) {
    return "A confirmação do documento encontrou uma inconsistência temporária no servidor. Atualize a página e tente novamente.";
  }
  if (normalized.includes("PERIODO_INVALIDO")) return "A data final não pode ser menor que a data inicial.";
  if (normalized.includes("TRANSPORTADORA_NOME_OBRIGATORIO")) return "Informe o nome da transportadora.";
  if (normalized.includes("TRANSPORTADORA_OBRIGATORIA")) return "Selecione uma transportadora.";
  if (normalized.includes("TRANSPORTADORA_JA_CADASTRADA")) return "Já existe uma transportadora com esse nome neste CD.";
  if (normalized.includes("TRANSPORTADORA_NAO_ENCONTRADA")) return "Transportadora não encontrada.";
  if (normalized.includes("ROTA_OBRIGATORIA")) return "Selecione uma rota para vincular.";
  if (normalized.includes("ROTA_NAO_ENCONTRADA")) return "Rota não encontrada na base.";
  if (normalized.includes("APENAS_ADMIN")) return "Apenas administradores podem gerenciar transportadoras e vínculos.";
  return normalized;
}

function mapShipment(raw: Record<string, unknown>): ConservadoraShipmentCard {
  return {
    embarque_key: parseString(raw.embarque_key),
    cd: parseInteger(raw.cd),
    rota: parseString(raw.rota, "-"),
    placa: parseString(raw.placa, "-"),
    seq_ped: parseString(raw.seq_ped, "-"),
    dt_ped: parseNullableString(raw.dt_ped),
    dt_lib: parseNullableString(raw.dt_lib),
    encerramento: parseNullableString(raw.encerramento),
    event_at: parseNullableString(raw.event_at),
    responsavel_mat: parseNullableString(raw.responsavel_mat),
    responsavel_nome: parseNullableString(raw.responsavel_nome),
    transportadora_id: parseNullableString(raw.transportadora_id),
    transportadora_nome: parseNullableString(raw.transportadora_nome),
    transportadora_ativa: Boolean(raw.transportadora_ativa),
    document_confirmed_at: parseNullableString(raw.document_confirmed_at),
    document_confirmed_mat: parseNullableString(raw.document_confirmed_mat),
    document_confirmed_nome: parseNullableString(raw.document_confirmed_nome),
    document_resultado: parseDocumentResult(raw.document_resultado),
    document_ocorrencia: parseNullableString(raw.document_ocorrencia),
    next_embarque_at: parseNullableString(raw.next_embarque_at),
    status: parseStatus(raw.status)
  };
}

function mapTransportadora(raw: Record<string, unknown>): ConservadoraTransportadora {
  return {
    id: parseString(raw.id),
    cd: parseInteger(raw.cd),
    nome: parseString(raw.nome),
    ativo: Boolean(raw.ativo),
    created_at: parseNullableString(raw.created_at),
    updated_at: parseNullableString(raw.updated_at)
  };
}

function mapRouteBinding(raw: Record<string, unknown>): ConservadoraRouteBinding {
  return {
    rota_descricao: parseString(raw.rota_descricao),
    transportadora_id: parseNullableString(raw.transportadora_id),
    transportadora_nome: parseNullableString(raw.transportadora_nome),
    transportadora_ativa: Boolean(raw.transportadora_ativa)
  };
}

export async function fetchConservadoraCards(params: {
  cd: number;
  status?: ConservadoraStatus | "" | null;
  search?: string | null;
}): Promise<ConservadoraShipmentCard[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_conservadora_cards_list", {
    p_cd: params.cd,
    p_status: params.status ?? null,
    p_search: params.search ?? null
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapShipment(row as Record<string, unknown>));
}

export async function fetchConservadoraHistory(
  cd: number,
  filters: ConservadoraHistoryFilters
): Promise<ConservadoraShipmentCard[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_conservadora_history", {
    p_cd: cd,
    p_search: filters.search ?? null,
    p_status: filters.status ?? null,
    p_dt_ini: filters.dtIni ?? null,
    p_dt_fim: filters.dtFim ?? null,
    p_offset: filters.offset ?? 0,
    p_limit: filters.limit ?? 100
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapShipment(row as Record<string, unknown>));
}

export async function confirmConservadoraDocumento(params: {
  cd: number;
  embarqueKey: string;
  resultado: ConservadoraDocumentResult;
  ocorrencia?: string | null;
}): Promise<{ embarque_key: string; confirmed_at: string | null; document_resultado: ConservadoraDocumentResult | null; document_ocorrencia: string | null }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_conservadora_confirmar_documento", {
    p_cd: params.cd,
    p_embarque_key: params.embarqueKey,
    p_resultado: params.resultado,
    p_ocorrencia: params.ocorrencia ?? null
  });
  if (error) throw new Error(toErrorMessage(error));

  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Nenhum dado retornado pelo servidor.");

  return {
    embarque_key: parseString(first.embarque_key),
    confirmed_at: parseNullableString(first.confirmed_at),
    document_resultado: parseDocumentResult(first.document_resultado),
    document_ocorrencia: parseNullableString(first.document_ocorrencia)
  };
}

export async function fetchConservadoraTransportadoras(cd: number): Promise<ConservadoraTransportadora[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_conservadora_transportadoras_list", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapTransportadora(row as Record<string, unknown>));
}

export async function upsertConservadoraTransportadora(params: {
  cd: number;
  nome: string;
  transportadoraId?: string | null;
}): Promise<ConservadoraTransportadora> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_conservadora_transportadora_upsert", {
    p_transportadora_id: params.transportadoraId ?? null,
    p_cd: params.cd,
    p_nome: params.nome
  });
  if (error) throw new Error(toErrorMessage(error));

  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Nenhum dado retornado pelo servidor.");
  return mapTransportadora(first);
}

export async function inativarConservadoraTransportadora(params: {
  cd: number;
  transportadoraId: string;
}): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { error } = await supabase.rpc("rpc_conservadora_transportadora_inativar", {
    p_cd: params.cd,
    p_transportadora_id: params.transportadoraId
  });
  if (error) throw new Error(toErrorMessage(error));
}

export async function fetchConservadoraRotas(
  cd: number,
  search?: string | null
): Promise<ConservadoraRouteBinding[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_conservadora_rotas_list", {
    p_cd: cd,
    p_search: search ?? null
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapRouteBinding(row as Record<string, unknown>));
}

export async function vincularConservadoraRota(params: {
  cd: number;
  rotaDescricao: string;
  transportadoraId: string;
}): Promise<ConservadoraRouteBinding> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_conservadora_rota_vincular", {
    p_cd: params.cd,
    p_rota_descricao: params.rotaDescricao,
    p_transportadora_id: params.transportadoraId
  });
  if (error) throw new Error(toErrorMessage(error));

  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Nenhum dado retornado pelo servidor.");
  return mapRouteBinding(first);
}
