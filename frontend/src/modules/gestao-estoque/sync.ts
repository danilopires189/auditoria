import { supabase } from "../../lib/supabase";
import type {
  GestaoEstoqueAddResult,
  GestaoEstoqueAvailableDay,
  GestaoEstoqueItemRow,
  GestaoEstoqueMovementType
} from "./types";

function extractRawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.error_description === "string") return candidate.error_description;
    if (typeof candidate.details === "string") return candidate.details;
  }
  return "";
}

export function normalizeGestaoEstoqueError(error: unknown): string {
  const raw = extractRawErrorMessage(error);
  if (!raw) return "Erro inesperado.";

  const normalized = raw.trim().toUpperCase();
  if (normalized.includes("AUTH_REQUIRED")) return "Sessão inválida. Faça login novamente.";
  if (normalized.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Faça login novamente.";
  if (normalized.includes("CD_NAO_DEFINIDO_USUARIO")) return "CD não definido para este usuário.";
  if (normalized.includes("CD_SEM_ACESSO")) return "Sem acesso ao CD selecionado.";
  if (normalized.includes("TIPO_MOVIMENTO_INVALIDO")) return "Tipo de movimentação inválido.";
  if (normalized.includes("QTD_INVALIDA")) return "Informe uma quantidade válida maior que zero.";
  if (normalized.includes("QTD_BAIXA_EXCEDE_ESTOQUE")) return "A quantidade de baixa excede o estoque atual.";
  if (normalized.includes("DIA_SOMENTE_LEITURA")) return "Dias anteriores ficam somente para consulta.";
  if (normalized.includes("ITEM_NAO_ENCONTRADO")) return "Item não encontrado.";
  if (normalized.includes("CONFLITO_ATUALIZACAO")) return "A linha foi alterada por outro processo. Atualize a lista e tente novamente.";
  if (normalized.includes("PRODUTO_NAO_ENCONTRADO")) return "Produto não encontrado.";
  if (normalized.includes("PARAMS_BUSCA_OBRIGATORIOS")) return "Informe código de barras ou CODDV.";
  if (normalized.includes("CODDV_INVALIDO")) return "CODDV inválido.";
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

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
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

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "t" || normalized === "1";
}

function parseMovementType(value: unknown): GestaoEstoqueMovementType {
  return String(value).trim().toLowerCase() === "entrada" ? "entrada" : "baixa";
}

function mapItemRow(raw: Record<string, unknown>): GestaoEstoqueItemRow {
  return {
    id: parseString(raw.id),
    movement_date: parseString(raw.movement_date),
    movement_type: parseMovementType(raw.movement_type),
    coddv: parseInteger(raw.coddv),
    barras_informado: parseNullableString(raw.barras_informado),
    quantidade: parseInteger(raw.quantidade),
    descricao: parseString(raw.descricao, "Item sem descrição"),
    endereco_sep: parseNullableString(raw.endereco_sep),
    endereco_pul: parseNullableString(raw.endereco_pul),
    qtd_est_atual: parseInteger(raw.qtd_est_atual),
    qtd_est_disp: parseInteger(raw.qtd_est_disp),
    estoque_updated_at: parseNullableString(raw.estoque_updated_at),
    dat_ult_compra: parseNullableString(raw.dat_ult_compra),
    custo_unitario: parseNullableNumber(raw.custo_unitario),
    custo_total: parseNumber(raw.custo_total),
    created_nome: parseString(raw.created_nome, "Usuário"),
    created_mat: parseString(raw.created_mat, "-"),
    created_at: parseString(raw.created_at),
    updated_nome: parseString(raw.updated_nome, "Usuário"),
    updated_mat: parseString(raw.updated_mat, "-"),
    updated_at: parseString(raw.updated_at),
    resolved_refreshed_at: parseNullableString(raw.resolved_refreshed_at),
    is_frozen: parseBoolean(raw.is_frozen)
  };
}

function firstRecord(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (!first || typeof first !== "object") return null;
  return first as Record<string, unknown>;
}

export async function fetchGestaoEstoqueAvailableDays(cd: number | null): Promise<GestaoEstoqueAvailableDay[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_gestao_estoque_available_days", {
    p_cd: cd
  });
  if (error) throw new Error(normalizeGestaoEstoqueError(error));
  if (!Array.isArray(data)) return [];

  return data.map((entry) => {
    const raw = entry as Record<string, unknown>;
    return {
      movement_date: parseString(raw.movement_date),
      item_count: parseInteger(raw.item_count),
      updated_at: parseNullableString(raw.updated_at),
      is_today: parseBoolean(raw.is_today)
    } satisfies GestaoEstoqueAvailableDay;
  });
}

export async function fetchGestaoEstoqueList(params: {
  cd: number | null;
  date: string;
  movementType: GestaoEstoqueMovementType;
}): Promise<GestaoEstoqueItemRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_gestao_estoque_list", {
    p_cd: params.cd,
    p_date: params.date,
    p_type: params.movementType
  });
  if (error) throw new Error(normalizeGestaoEstoqueError(error));
  if (!Array.isArray(data)) return [];
  return data
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    .map(mapItemRow);
}

export async function addGestaoEstoqueItem(params: {
  cd: number | null;
  date: string;
  movementType: GestaoEstoqueMovementType;
  barras?: string | null;
  coddv?: number | null;
  quantidade: number;
}): Promise<GestaoEstoqueAddResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_gestao_estoque_add_item", {
    p_cd: params.cd,
    p_date: params.date,
    p_type: params.movementType,
    p_barras: params.barras ?? null,
    p_coddv: params.coddv ?? null,
    p_quantidade: params.quantidade
  });
  if (error) throw new Error(normalizeGestaoEstoqueError(error));

  const first = firstRecord(data);
  if (!first) throw new Error("Não foi possível concluir a inclusão.");

  return {
    status: parseString(first.result_status) === "already_exists" ? "already_exists" : "added",
    message: parseString(first.result_message, "Operação concluída."),
    row: mapItemRow(first)
  };
}

export async function updateGestaoEstoqueQuantity(params: {
  itemId: string;
  quantidade: number;
  expectedUpdatedAt: string;
}): Promise<GestaoEstoqueItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_gestao_estoque_update_quantity", {
    p_item_id: params.itemId,
    p_quantidade: params.quantidade,
    p_expected_updated_at: params.expectedUpdatedAt
  });
  if (error) throw new Error(normalizeGestaoEstoqueError(error));
  const first = firstRecord(data);
  if (!first) throw new Error("Não foi possível atualizar a quantidade.");
  return mapItemRow(first);
}

export async function deleteGestaoEstoqueItem(params: {
  itemId: string;
  expectedUpdatedAt: string;
}): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { error } = await supabase.rpc("rpc_gestao_estoque_delete_item", {
    p_item_id: params.itemId,
    p_expected_updated_at: params.expectedUpdatedAt
  });
  if (error) throw new Error(normalizeGestaoEstoqueError(error));
}
