import { supabase } from "../../lib/supabase";
import type {
  BuscaProdutoAddressRow,
  BuscaProdutoExcludedAddressRow,
  BuscaProdutoLookupResult
} from "./types";

interface LookupParams {
  cd?: number | null;
  barras?: string | null;
  coddv?: number | null;
}

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
  if (normalized.includes("PARAMS_BUSCA_OBRIGATORIOS")) return "Informe código de barras ou Código e Dígito (CODDV).";
  if (normalized.includes("CODDV_INVALIDO")) return "Código e Dígito (CODDV) inválido.";
  if (normalized.includes("PRODUTO_NAO_ENCONTRADO")) return "Produto não encontrado.";
  return raw;
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

function parseAddressRows(value: unknown): BuscaProdutoAddressRow[] {
  if (!Array.isArray(value)) return [];
  const rows: BuscaProdutoAddressRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const endereco = String(row.endereco ?? "").trim().toUpperCase();
    if (!endereco) continue;
    rows.push({
      endereco,
      andar: parseNullableString(row.andar),
      validade: parseNullableString(row.validade)
    });
  }
  return rows;
}

function parseExcludedRows(value: unknown): BuscaProdutoExcludedAddressRow[] {
  if (!Array.isArray(value)) return [];
  const rows: BuscaProdutoExcludedAddressRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const endereco = String(row.endereco ?? "").trim().toUpperCase();
    if (!endereco) continue;
    rows.push({
      endereco,
      exclusao: parseNullableString(row.exclusao)
    });
  }
  return rows;
}

function parseBarcodeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list: string[] = [];
  for (const item of value) {
    const parsed = String(item ?? "").trim();
    if (!parsed) continue;
    list.push(parsed);
  }
  return Array.from(new Set(list));
}

function mapLookupRow(raw: Record<string, unknown>): BuscaProdutoLookupResult {
  const barrasLista = parseBarcodeList(raw.barras_lista);
  const barrasPrincipal = String(raw.barras ?? "").trim();
  const barras = barrasPrincipal || barrasLista[0] || "";
  return {
    cd: parseInteger(raw.cd),
    coddv: parseInteger(raw.coddv),
    descricao: String(raw.descricao ?? "").trim(),
    barras,
    barras_lista: barrasLista.length > 0 ? barrasLista : (barras ? [barras] : []),
    qtd_est_disp: Math.max(parseInteger(raw.qtd_est_disp), 0),
    qtd_est_atual: Math.max(parseInteger(raw.qtd_est_atual), 0),
    estoque_updated_at: parseNullableString(raw.estoque_updated_at),
    dat_ult_compra: parseNullableString(raw.dat_ult_compra),
    custo_unitario: parseNullableNumber(raw.custo_unitario),
    enderecos_sep: parseAddressRows(raw.enderecos_sep),
    enderecos_pul: parseAddressRows(raw.enderecos_pul),
    enderecos_excluidos: parseExcludedRows(raw.enderecos_excluidos)
  };
}

export async function lookupProduto(params: LookupParams): Promise<BuscaProdutoLookupResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_busca_produto_lookup", {
    p_cd: params.cd ?? null,
    p_barras: params.barras ?? null,
    p_coddv: params.coddv ?? null
  });
  if (error) throw new Error(toErrorMessage(error));

  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Produto não encontrado.");
  return mapLookupRow(first);
}
