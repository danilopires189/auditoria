import { supabase } from "../../lib/supabase";
import type {
  AlmoxMovimento,
  AlmoxNfExtraction,
  AlmoxNfImport,
  AlmoxNfValidationRow,
  AlmoxProduto,
  AlmoxSolicitacao,
  AlmoxSolicitacaoItem,
  AlmoxSolicitacaoItemDraft,
  AlmoxSolicitacaoStatus,
  AlmoxSolicitacaoTipo
} from "./types";

function rawErrorMessage(error: unknown): string {
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

export function toAlmoxErrorMessage(error: unknown): string {
  const raw = rawErrorMessage(error);
  const normalized = raw.toUpperCase();
  if (!raw) return "Erro inesperado.";
  if (normalized.includes("AUTH_REQUIRED")) return "Sessão inválida. Faça login novamente.";
  if (normalized.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Faça login novamente.";
  if (normalized.includes("APENAS_ADMIN_GLOBAL")) return "Ação permitida apenas para Admin Global.";
  if (normalized.includes("APENAS_ADMIN")) return "Ação permitida apenas para administradores.";
  if (normalized.includes("PRODUTO_NAO_ENCONTRADO")) return "Produto não encontrado.";
  if (normalized.includes("PRODUTO_NOVO_BLOQUEIA_APLICACAO")) return "Existem produtos novos. Cadastre antes de aplicar a nota.";
  if (normalized.includes("ESTOQUE_INSUFICIENTE")) return "Estoque insuficiente para aprovar a retirada.";
  if (normalized.includes("QTD_INVALIDA")) return "Informe quantidade maior que zero.";
  if (normalized.includes("CODIGO_OBRIGATORIO")) return "Informe o código do produto.";
  if (normalized.includes("SOLICITACAO_NAO_PENDENTE")) return "Solicitação já foi decidida.";
  if (normalized.includes("NF_SEM_ITENS")) return "Nota sem itens válidos.";
  return raw;
}

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

function parseNumber(value: unknown, fallback = 0): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").toLowerCase().trim();
  return normalized === "true" || normalized === "t" || normalized === "1";
}

function parseStatus(value: unknown): AlmoxSolicitacaoStatus {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "aprovada" || raw === "reprovada") return raw;
  return "pendente";
}

function parseTipo(value: unknown): AlmoxSolicitacaoTipo {
  return String(value ?? "").toLowerCase() === "retirada" ? "retirada" : "compra";
}

function asRecords(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? data.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object")) : [];
}

function firstRecord(data: unknown): Record<string, unknown> | null {
  return asRecords(data)[0] ?? null;
}

function mapProduto(raw: Record<string, unknown>): AlmoxProduto {
  return {
    produto_id: parseString(raw.produto_id),
    codigo: parseString(raw.codigo),
    descricao: parseString(raw.descricao),
    marca: parseString(raw.marca),
    tamanho: parseNullableString(raw.tamanho),
    estoque_atual: parseInteger(raw.estoque_atual),
    ultimo_custo: parseNumber(raw.ultimo_custo),
    created_at: parseString(raw.created_at),
    updated_at: parseString(raw.updated_at)
  };
}

function mapSolicitacaoItem(raw: Record<string, unknown>): AlmoxSolicitacaoItem {
  return {
    item_id: parseString(raw.item_id),
    solicitacao_id: parseString(raw.solicitacao_id),
    produto_id: parseString(raw.produto_id),
    codigo: parseString(raw.codigo),
    descricao: parseString(raw.descricao),
    marca: parseString(raw.marca),
    tamanho: parseNullableString(raw.tamanho),
    quantidade: parseInteger(raw.quantidade),
    estoque_snapshot: parseInteger(raw.estoque_snapshot),
    valor_unitario: parseNumber(raw.valor_unitario),
    valor_total: parseNumber(raw.valor_total)
  };
}

function mapSolicitacao(raw: Record<string, unknown>): AlmoxSolicitacao {
  return {
    solicitacao_id: parseString(raw.solicitacao_id),
    tipo: parseTipo(raw.tipo),
    status: parseStatus(raw.status),
    motivo: parseNullableString(raw.motivo),
    total_valor: parseNumber(raw.total_valor),
    solicitante_nome: parseString(raw.solicitante_nome, "Usuário"),
    solicitante_mat: parseString(raw.solicitante_mat, "-"),
    created_at: parseString(raw.created_at),
    aprovador_nome: parseNullableString(raw.aprovador_nome),
    aprovador_mat: parseNullableString(raw.aprovador_mat),
    aprovado_at: parseNullableString(raw.aprovado_at),
    decisao_observacao: parseNullableString(raw.decisao_observacao),
    itens: asRecords(raw.itens).map(mapSolicitacaoItem)
  };
}

function mapMovimento(raw: Record<string, unknown>): AlmoxMovimento {
  return {
    movimento_id: parseString(raw.movimento_id),
    tipo: parseString(raw.tipo) as AlmoxMovimento["tipo"],
    codigo: parseString(raw.codigo),
    descricao: parseString(raw.descricao),
    quantidade_delta: parseInteger(raw.quantidade_delta),
    estoque_antes: parseInteger(raw.estoque_antes),
    estoque_depois: parseInteger(raw.estoque_depois),
    valor_unitario: parseNumber(raw.valor_unitario),
    valor_total: parseNumber(raw.valor_total),
    actor_nome: parseString(raw.actor_nome, "Usuário"),
    actor_mat: parseString(raw.actor_mat, "-"),
    created_at: parseString(raw.created_at),
    origem_label: parseNullableString(raw.origem_label)
  };
}

function mapNfImport(raw: Record<string, unknown>): AlmoxNfImport {
  return {
    import_id: parseString(raw.import_id),
    numero_nf: parseNullableString(raw.numero_nf),
    fornecedor: parseNullableString(raw.fornecedor),
    data_emissao: parseNullableString(raw.data_emissao),
    status: parseString(raw.status) === "aplicada" ? "aplicada" : "extraida",
    alertas: Array.isArray(raw.alertas) ? raw.alertas.map(String) : [],
    created_at: parseString(raw.created_at),
    applied_at: parseNullableString(raw.applied_at)
  };
}

function mapNfValidation(raw: Record<string, unknown>): AlmoxNfValidationRow {
  return {
    codigo: parseString(raw.codigo),
    descricao: parseString(raw.descricao),
    quantidade: parseInteger(raw.quantidade),
    valor_unitario: parseNumber(raw.valor_unitario),
    valor_total: parseNumber(raw.valor_total),
    produto_id: parseNullableString(raw.produto_id),
    produto_existe: parseBoolean(raw.produto_existe),
    estoque_atual: parseInteger(raw.estoque_atual)
  };
}

export async function listAlmoxProdutos(search = ""): Promise<AlmoxProduto[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_almox_produtos_list", { p_search: search });
  if (error) throw new Error(toAlmoxErrorMessage(error));
  return asRecords(data).map(mapProduto);
}

export async function saveAlmoxProduto(params: {
  produtoId?: string | null;
  codigo: string;
  descricao: string;
  marca: string;
  tamanho?: string | null;
}): Promise<AlmoxProduto> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_almox_produto_save", {
    p_produto_id: params.produtoId ?? null,
    p_codigo: params.codigo,
    p_descricao: params.descricao,
    p_marca: params.marca,
    p_tamanho: params.tamanho ?? null
  });
  if (error) throw new Error(toAlmoxErrorMessage(error));
  const first = firstRecord(data);
  if (!first) throw new Error("Produto não retornado.");
  return mapProduto(first);
}

export async function adjustAlmoxInventario(params: {
  produtoId: string;
  estoqueAtual: number;
  observacao?: string | null;
}): Promise<AlmoxProduto> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_almox_inventario_ajustar", {
    p_produto_id: params.produtoId,
    p_estoque_atual: params.estoqueAtual,
    p_observacao: params.observacao ?? null
  });
  if (error) throw new Error(toAlmoxErrorMessage(error));
  const first = firstRecord(data);
  if (!first) throw new Error("Produto não retornado.");
  return mapProduto(first);
}

export async function createAlmoxSolicitacao(params: {
  tipo: AlmoxSolicitacaoTipo;
  motivo?: string | null;
  itens: AlmoxSolicitacaoItemDraft[];
}): Promise<AlmoxSolicitacao> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_almox_solicitacao_criar", {
    p_tipo: params.tipo,
    p_motivo: params.motivo ?? null,
    p_itens: params.itens
  });
  if (error) throw new Error(toAlmoxErrorMessage(error));
  const first = firstRecord(data);
  if (!first) throw new Error("Solicitação não retornada.");
  return mapSolicitacao(first);
}

export async function listAlmoxSolicitacoes(params: {
  scope: "minhas" | "pendentes" | "todas";
  tipo?: AlmoxSolicitacaoTipo | "todas";
}): Promise<AlmoxSolicitacao[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_almox_solicitacoes_list", {
    p_scope: params.scope,
    p_tipo: params.tipo === "todas" ? null : params.tipo ?? null
  });
  if (error) throw new Error(toAlmoxErrorMessage(error));
  return asRecords(data).map(mapSolicitacao);
}

export async function decideAlmoxSolicitacao(params: {
  solicitacaoId: string;
  approve: boolean;
  observacao?: string | null;
}): Promise<AlmoxSolicitacao> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_almox_solicitacao_decidir", {
    p_solicitacao_id: params.solicitacaoId,
    p_approve: params.approve,
    p_observacao: params.observacao ?? null
  });
  if (error) throw new Error(toAlmoxErrorMessage(error));
  const first = firstRecord(data);
  if (!first) throw new Error("Solicitação não retornada.");
  return mapSolicitacao(first);
}

export async function extractAlmoxNfPdf(file: File): Promise<AlmoxNfExtraction> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const formData = new FormData();
  formData.set("file", file, file.name);
  const { data, error } = await supabase.functions.invoke("almox_nf_extract", { body: formData });
  if (error) throw new Error(toAlmoxErrorMessage(error));
  if (!data || typeof data !== "object") throw new Error("Extração inválida.");
  return data as AlmoxNfExtraction;
}

export async function saveAlmoxNfImport(payload: AlmoxNfExtraction): Promise<AlmoxNfImport> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_almox_nf_import_save", { p_payload: payload });
  if (error) throw new Error(toAlmoxErrorMessage(error));
  const first = firstRecord(data);
  if (!first) throw new Error("Importação não retornada.");
  return mapNfImport(first);
}

export async function validateAlmoxNfItems(payload: AlmoxNfExtraction): Promise<AlmoxNfValidationRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_almox_nf_validate_items", { p_payload: payload });
  if (error) throw new Error(toAlmoxErrorMessage(error));
  return asRecords(data).map(mapNfValidation);
}

export async function applyAlmoxNfImport(importId: string, payload: AlmoxNfExtraction): Promise<AlmoxNfImport> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_almox_nf_import_apply", {
    p_import_id: importId,
    p_payload: payload
  });
  if (error) throw new Error(toAlmoxErrorMessage(error));
  const first = firstRecord(data);
  if (!first) throw new Error("Importação não retornada.");
  return mapNfImport(first);
}

export async function listAlmoxNfImports(): Promise<AlmoxNfImport[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_almox_nf_imports_list");
  if (error) throw new Error(toAlmoxErrorMessage(error));
  return asRecords(data).map(mapNfImport);
}

export async function listAlmoxMovimentos(): Promise<AlmoxMovimento[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_almox_movimentos_report");
  if (error) throw new Error(toAlmoxErrorMessage(error));
  return asRecords(data).map(mapMovimento);
}
