import { supabase } from "../../lib/supabase";
import { getDbBarrasByBarcode, upsertDbBarrasCacheRow } from "../../shared/db-barras/storage";
import { normalizeBarcode } from "../../shared/db-barras/sync";
import { normalizeEnderecoDisplay } from "../../shared/db-end/sync";
import { getDbEndRowsByCoddv, upsertDbEndCacheRows } from "../../shared/db-end/storage";
import type { DbEndCacheRow } from "../../shared/db-end/types";
import type { ValidarEnderecamentoLookupResult } from "./types";

interface ParsedProductInput {
  barras: string;
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  if (normalized.includes("PARAMS_BUSCA_OBRIGATORIOS")) return "Informe código de barras.";
  if (normalized.includes("PRODUTO_NAO_ENCONTRADO")) return "Produto não encontrado.";
  return raw;
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

function parseBarcodeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list: string[] = [];
  for (const item of value) {
    const parsed = normalizeBarcode(String(item ?? ""));
    if (!parsed) continue;
    list.push(parsed);
  }
  return Array.from(new Set(list));
}

function parseSepAddresses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const endereco = normalizeEnderecoDisplay(String(row.endereco ?? ""));
    if (!endereco) continue;
    list.push(endereco);
  }
  return Array.from(new Set(list));
}

function parseProductInput(rawInput: string): ParsedProductInput | null {
  const original = String(rawInput ?? "").trim();
  if (!original) return null;

  const barras = normalizeBarcode(original);
  if (!barras) return null;
  return { barras };
}

function mapLookupRow(raw: Record<string, unknown>): ValidarEnderecamentoLookupResult {
  const barrasLista = parseBarcodeList(raw.barras_lista);
  const barrasPrincipal = normalizeBarcode(String(raw.barras ?? ""));
  const barras = barrasPrincipal || barrasLista[0] || "";
  const sep = parseSepAddresses(raw.enderecos_sep);

  return {
    cd: parseInteger(raw.cd),
    coddv: parseInteger(raw.coddv),
    descricao: String(raw.descricao ?? "").trim(),
    barras,
    barras_lista: barrasLista.length > 0 ? barrasLista : (barras ? [barras] : []),
    enderecos_sep: sep
  };
}

function toDbEndCacheRows(result: ValidarEnderecamentoLookupResult): DbEndCacheRow[] {
  return result.enderecos_sep.map((endereco) => ({
    cd: result.cd,
    coddv: result.coddv,
    descricao: result.descricao,
    endereco,
    tipo: "SEP",
    andar: null,
    validade: null,
    updated_at: null
  }));
}

async function lookupProdutoOnlineByParsed(cd: number, parsedInput: ParsedProductInput): Promise<ValidarEnderecamentoLookupResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const client = supabase;

  const { data, error } = await client.rpc("rpc_busca_produto_lookup", {
    p_cd: cd,
    p_barras: parsedInput.barras,
    p_coddv: null
  });
  if (error) throw new Error(toErrorMessage(error));

  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Produto não encontrado.");
  return mapLookupRow(first);
}

async function lookupProdutoOfflineByParsed(
  cd: number,
  parsedInput: ParsedProductInput
): Promise<ValidarEnderecamentoLookupResult | null> {
  const barcode = parsedInput.barras;
  const barcodeRow = await getDbBarrasByBarcode(barcode);
  const coddv = barcodeRow?.coddv ?? null;
  if (coddv == null || coddv <= 0) return null;

  const sepRows = await getDbEndRowsByCoddv(cd, coddv, "SEP");
  if (!barcodeRow && sepRows.length === 0) return null;

  const descricao =
    barcodeRow?.descricao?.trim()
    || sepRows[0]?.descricao?.trim()
    || `CODDV ${coddv}`;

  const barrasLista = Array.from(new Set([
    barcode,
    normalizeBarcode(String(barcodeRow?.barras ?? ""))
  ].filter(Boolean)));

  return {
    cd,
    coddv,
    descricao,
    barras: barrasLista[0] ?? "",
    barras_lista: Array.from(new Set(barrasLista.filter(Boolean))),
    enderecos_sep: Array.from(
      new Set(
        sepRows
          .map((row) => normalizeEnderecoDisplay(row.endereco))
          .filter((value) => Boolean(value))
      )
    )
  };
}

function containsNotFoundError(error: unknown): boolean {
  const normalized = toErrorMessage(error).toUpperCase();
  return normalized.includes("PRODUTO NÃO ENCONTRADO")
    || normalized.includes("PRODUTO_NAO_ENCONTRADO");
}

async function warmupCachesFromOnline(result: ValidarEnderecamentoLookupResult): Promise<void> {
  const bars = result.barras_lista.length > 0 ? result.barras_lista : (result.barras ? [result.barras] : []);
  const barsRows = bars.map((barras) => ({
    barras: normalizeBarcode(barras),
    coddv: result.coddv,
    descricao: result.descricao,
    updated_at: null
  }));
  const sepRows = toDbEndCacheRows(result);

  await Promise.all([
    ...barsRows.map((row) => upsertDbBarrasCacheRow(row)),
    upsertDbEndCacheRows(result.cd, sepRows)
  ]);
}

export async function resolveProdutoForValidacao(params: {
  cd: number;
  rawInput: string;
  isOnline: boolean;
  preferOfflineMode: boolean;
}): Promise<ValidarEnderecamentoLookupResult> {
  const parsedInput = parseProductInput(params.rawInput);
  if (!parsedInput) {
    throw new Error("Informe código de barras.");
  }

  let offlineResult: ValidarEnderecamentoLookupResult | null = null;
  let onlineError: unknown = null;
  const shouldTryOfflineFirst = params.preferOfflineMode || !params.isOnline;

  if (shouldTryOfflineFirst) {
    offlineResult = await lookupProdutoOfflineByParsed(params.cd, parsedInput);
  }

  const offlineIncomplete = !offlineResult || offlineResult.enderecos_sep.length === 0;
  if (params.isOnline && (!shouldTryOfflineFirst || offlineIncomplete)) {
    try {
      const online = await lookupProdutoOnlineByParsed(params.cd, parsedInput);
      await warmupCachesFromOnline(online).catch(() => undefined);
      return online;
    } catch (error) {
      onlineError = error;
      if (offlineResult && (offlineResult.enderecos_sep.length > 0 || containsNotFoundError(error))) {
        return offlineResult;
      }
    }
  }

  if (!offlineResult && !shouldTryOfflineFirst) {
    offlineResult = await lookupProdutoOfflineByParsed(params.cd, parsedInput);
  }

  if (offlineResult) return offlineResult;

  if (!params.isOnline) {
    throw new Error("Sem internet para validação online e sem base local disponível.");
  }

  if (onlineError) throw (onlineError instanceof Error ? onlineError : new Error(toErrorMessage(onlineError)));
  throw new Error("Produto não encontrado.");
}

export function normalizeLookupError(error: unknown): string {
  return toErrorMessage(error);
}
