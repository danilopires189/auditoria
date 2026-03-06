import { supabase } from "../../lib/supabase";
import { getDbBarrasByBarcode, upsertDbBarrasCacheRow } from "../../shared/db-barras/storage";
import { normalizeBarcode } from "../../shared/db-barras/sync";
import {
  enqueueValidarEtiquetaPulmaoAudit as enqueueAuditPending,
  getPendingValidarEtiquetaPulmaoAudits,
  markPendingValidarEtiquetaPulmaoAuditError,
  removePendingValidarEtiquetaPulmaoAudit
} from "./storage";
import type {
  ValidarEtiquetaPulmaoAuditPayload,
  ValidarEtiquetaPulmaoLookupResult
} from "./types";

interface ParsedBarcodeInput {
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
  if (normalized.includes("PRODUTO_NAO_ENCONTRADO")) return "Produto não encontrado.";
  return raw;
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

function parseBarcodeInput(rawInput: string): ParsedBarcodeInput | null {
  const barras = normalizeBarcode(String(rawInput ?? ""));
  if (!barras) return null;
  return { barras };
}

function mapLookupRow(cd: number, raw: Record<string, unknown>): ValidarEtiquetaPulmaoLookupResult {
  const barrasPrincipal = normalizeBarcode(String(raw.barras ?? ""));
  const barrasLista = parseBarcodeList(raw.barras_lista);
  const barras = barrasPrincipal || barrasLista[0] || "";

  return {
    cd,
    coddv: parseInteger(raw.coddv),
    descricao: String(raw.descricao ?? "").trim(),
    barras,
    barras_lista: barrasLista.length > 0 ? barrasLista : (barras ? [barras] : [])
  };
}

async function lookupProdutoOnlineByParsed(cd: number, parsedInput: ParsedBarcodeInput): Promise<ValidarEtiquetaPulmaoLookupResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_db_barras_lookup", {
    p_barras: parsedInput.barras
  });
  if (error) throw new Error(toErrorMessage(error));

  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Produto não encontrado.");

  return mapLookupRow(cd, {
    ...first,
    barras_lista: [String(first.barras ?? parsedInput.barras)]
  });
}

async function lookupProdutoOfflineByParsed(cd: number, parsedInput: ParsedBarcodeInput): Promise<ValidarEtiquetaPulmaoLookupResult | null> {
  const barcodeRow = await getDbBarrasByBarcode(parsedInput.barras);
  if (!barcodeRow || barcodeRow.coddv <= 0) return null;

  return {
    cd,
    coddv: barcodeRow.coddv,
    descricao: barcodeRow.descricao?.trim() || `CODDV ${barcodeRow.coddv}`,
    barras: parsedInput.barras,
    barras_lista: Array.from(
      new Set(
        [parsedInput.barras, normalizeBarcode(String(barcodeRow.barras ?? ""))]
          .filter(Boolean)
      )
    )
  };
}

function containsNotFoundError(error: unknown): boolean {
  const normalized = toErrorMessage(error).toUpperCase();
  return normalized.includes("PRODUTO NÃO ENCONTRADO")
    || normalized.includes("PRODUTO NAO ENCONTRADO")
    || normalized.includes("PRODUTO_NAO_ENCONTRADO");
}

function normalizeAuditPayload(input: ValidarEtiquetaPulmaoAuditPayload): ValidarEtiquetaPulmaoAuditPayload {
  const parsedDate = input.data_hr ? new Date(input.data_hr) : null;
  const descricao = String(input.descricao ?? "").trim();

  return {
    cd: Number.isFinite(input.cd) ? Math.trunc(input.cd) : 0,
    codigo_interno: Number.isFinite(input.codigo_interno) ? Math.trunc(input.codigo_interno) : 0,
    barras: normalizeBarcode(String(input.barras ?? "")),
    coddv_resolvido: Number.isFinite(input.coddv_resolvido ?? Number.NaN) ? Math.trunc(input.coddv_resolvido as number) : null,
    descricao: descricao || null,
    validado: Boolean(input.validado),
    data_hr: parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toISOString()
      : null
  };
}

function isValidAuditPayload(payload: ValidarEtiquetaPulmaoAuditPayload): boolean {
  return payload.cd > 0
    && payload.codigo_interno > 0
    && Boolean(payload.barras);
}

async function warmupCachesFromOnline(result: ValidarEtiquetaPulmaoLookupResult): Promise<void> {
  const barras = result.barras_lista.length > 0 ? result.barras_lista : [result.barras];
  await Promise.all(
    barras
      .filter(Boolean)
      .map((barcode) => upsertDbBarrasCacheRow({
        barras: normalizeBarcode(barcode),
        coddv: result.coddv,
        descricao: result.descricao,
        updated_at: null
      }))
  );
}

export async function resolveProdutoForValidacao(params: {
  cd: number;
  rawInput: string;
  isOnline: boolean;
  preferOfflineMode: boolean;
}): Promise<ValidarEtiquetaPulmaoLookupResult> {
  const parsedInput = parseBarcodeInput(params.rawInput);
  if (!parsedInput) {
    throw new Error("Informe código de barras.");
  }

  let offlineResult: ValidarEtiquetaPulmaoLookupResult | null = null;
  let onlineError: unknown = null;
  const shouldTryOfflineFirst = params.preferOfflineMode || !params.isOnline;

  if (shouldTryOfflineFirst) {
    offlineResult = await lookupProdutoOfflineByParsed(params.cd, parsedInput);
  }

  if (params.isOnline && (!shouldTryOfflineFirst || !offlineResult)) {
    try {
      const online = await lookupProdutoOnlineByParsed(params.cd, parsedInput);
      await warmupCachesFromOnline(online).catch(() => undefined);
      return online;
    } catch (error) {
      onlineError = error;
      if (offlineResult && containsNotFoundError(error)) {
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

export async function sendValidarEtiquetaPulmaoAuditOnline(payload: ValidarEtiquetaPulmaoAuditPayload): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const normalized = normalizeAuditPayload(payload);
  if (!isValidAuditPayload(normalized)) {
    throw new Error("Registro de etiqueta pulmão inválido.");
  }

  const { data, error } = await supabase.rpc("rpc_aud_etiqueta_pulmao_insert", {
    p_cd: normalized.cd,
    p_codigo_interno: normalized.codigo_interno,
    p_barras: normalized.barras,
    p_coddv_resolvido: normalized.coddv_resolvido,
    p_descricao: normalized.descricao,
    p_validado: normalized.validado,
    p_data_hr: normalized.data_hr
  });

  if (error) {
    throw new Error(toErrorMessage(error));
  }

  const first = Array.isArray(data) ? data[0] : null;
  if (!first || typeof first !== "object") {
    throw new Error("Resposta inválida ao gravar validação de etiqueta pulmão.");
  }
}

export async function flushPendingValidarEtiquetaPulmaoAudits(userId: string): Promise<{
  processed: number;
  synced: number;
  failed: number;
  pending: number;
}> {
  const rows = await getPendingValidarEtiquetaPulmaoAudits(userId);
  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await sendValidarEtiquetaPulmaoAuditOnline(row.payload);
      await removePendingValidarEtiquetaPulmaoAudit(userId, row.local_id);
      synced += 1;
    } catch (error) {
      failed += 1;
      await markPendingValidarEtiquetaPulmaoAuditError(userId, row.local_id, toErrorMessage(error));
    }
  }

  const pending = (await getPendingValidarEtiquetaPulmaoAudits(userId)).length;
  return {
    processed: rows.length,
    synced,
    failed,
    pending
  };
}

export async function enqueueValidarEtiquetaPulmaoAudit(params: {
  userId: string;
  payload: ValidarEtiquetaPulmaoAuditPayload;
  isOnline: boolean;
}): Promise<void> {
  const normalized = normalizeAuditPayload(params.payload);
  if (!isValidAuditPayload(normalized)) return;

  await enqueueAuditPending(params.userId, normalized);

  if (!params.isOnline) return;
  try {
    await flushPendingValidarEtiquetaPulmaoAudits(params.userId);
  } catch {
    // Mantem registro local para retry silencioso quando houver conexão estável.
  }
}
