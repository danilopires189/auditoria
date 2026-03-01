import { supabase } from "../../lib/supabase";
import { getDbBarrasByBarcode, upsertDbBarrasCacheRow } from "../../shared/db-barras/storage";
import { normalizeBarcode } from "../../shared/db-barras/sync";
import { getDbEndRowsByCoddv, upsertDbEndCacheRows } from "../../shared/db-end/storage";
import { normalizeEnderecoDisplay } from "../../shared/db-end/sync";
import {
  countErrorOfflineEvents,
  countPendingOfflineEvents,
  listPendingOfflineEvents,
  loadOfflineSnapshot,
  normalizeOfflinePayload,
  removeOfflineEvent,
  saveOfflineLinhaColetaEvent,
  saveOfflineLinhaRetiradaEvent,
  saveOfflinePulRetiradaEvent,
  saveOfflineSnapshot,
  updateOfflineEventStatus
} from "./storage";
import type {
  ControleValidadeOfflineEventRow,
  ControleValidadeOfflineSyncResult,
  LinhaColetaLookupResult,
  LinhaColetaPayload,
  LinhaRetiradaPayload,
  LinhaRetiradaRow,
  PulRetiradaPayload,
  PulRetiradaRow,
  RetiradaStatusFilter
} from "./types";

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseString(value: unknown): string {
  return String(value ?? "").trim();
}

function parseNullableString(value: unknown): string | null {
  const normalized = parseString(value);
  return normalized || null;
}

function parseRetiradaStatus(value: unknown): "pendente" | "concluido" {
  return String(value) === "concluido" ? "concluido" : "pendente";
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
  if (normalized.includes("ENDERECO_SEP_INVALIDO")) return "Endereço de Linha inválido para este produto.";
  if (normalized.includes("VALIDADE_INVALIDA")) return "Validade inválida. Use MMAA.";
  if (normalized.includes("ITEM_PUL_SEM_ESTOQUE")) return "Item do Pulmão sem estoque disponível (qtd_est_disp <= 0).";
  if (normalized.includes("ITEM_NAO_ELEGIVEL_RETIRADA")) return "Item não elegível para retirada.";
  if (normalized.includes("QTD_RETIRADA_EXCEDE_PENDENTE")) return "Quantidade retirada excede o pendente.";
  if (normalized.includes("ITEM_JA_CONCLUIDO")) return "Este item já está concluído.";
  return raw;
}

function isPulOutOfStockConflict(error: unknown): boolean {
  return toErrorMessage(error).toUpperCase().includes("SEM ESTOQUE");
}

function isRetiradaConflict(error: unknown): boolean {
  const normalized = toErrorMessage(error).toUpperCase();
  return normalized.includes("ITEM NÃO ELEGÍVEL")
    || normalized.includes("EXCEDE O PENDENTE")
    || normalized.includes("JÁ ESTÁ CONCLUÍDO")
    || normalized.includes("SEM ESTOQUE");
}

function parseSepFromLookup(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const endereco = normalizeEnderecoDisplay(parseString(row.endereco));
    if (!endereco) continue;
    list.push(endereco);
  }
  return Array.from(new Set(list));
}

function normalizeStatusFilter(value: RetiradaStatusFilter): RetiradaStatusFilter {
  if (value === "concluido" || value === "todos") return value;
  return "pendente";
}

function mapLinhaRow(raw: Record<string, unknown>): LinhaRetiradaRow {
  return {
    cd: parseInteger(raw.cd),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao),
    endereco_sep: normalizeEnderecoDisplay(parseString(raw.endereco_sep)),
    val_mmaa: parseString(raw.val_mmaa),
    ref_coleta_mes: parseString(raw.ref_coleta_mes),
    qtd_coletada: parseInteger(raw.qtd_coletada),
    qtd_retirada: parseInteger(raw.qtd_retirada),
    qtd_pendente: parseInteger(raw.qtd_pendente),
    status: parseRetiradaStatus(raw.status),
    regra_aplicada: parseString(raw.regra_aplicada),
    dt_ultima_coleta: parseNullableString(raw.dt_ultima_coleta)
  };
}

function mapPulRow(raw: Record<string, unknown>): PulRetiradaRow {
  return {
    cd: parseInteger(raw.cd),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao),
    endereco_pul: normalizeEnderecoDisplay(parseString(raw.endereco_pul)),
    val_mmaa: parseString(raw.val_mmaa),
    qtd_alvo: parseInteger(raw.qtd_alvo, 1),
    qtd_retirada: parseInteger(raw.qtd_retirada),
    qtd_pendente: parseInteger(raw.qtd_pendente),
    status: parseRetiradaStatus(raw.status),
    qtd_est_disp: parseInteger(raw.qtd_est_disp)
  };
}

function lineKey(row: Pick<LinhaRetiradaRow, "coddv" | "endereco_sep" | "val_mmaa" | "ref_coleta_mes">): string {
  return `${row.coddv}|${row.endereco_sep}|${row.val_mmaa}|${row.ref_coleta_mes}`;
}

function pulKey(row: Pick<PulRetiradaRow, "coddv" | "endereco_pul" | "val_mmaa">): string {
  return `${row.coddv}|${row.endereco_pul}|${row.val_mmaa}`;
}

function sortLinhaRows(rows: LinhaRetiradaRow[]): LinhaRetiradaRow[] {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pendente" ? -1 : 1;
    const byEndereco = a.endereco_sep.localeCompare(b.endereco_sep, "pt-BR");
    if (byEndereco !== 0) return byEndereco;
    const byCoddv = a.coddv - b.coddv;
    if (byCoddv !== 0) return byCoddv;
    return a.val_mmaa.localeCompare(b.val_mmaa, "pt-BR");
  });
}

function sortPulRows(rows: PulRetiradaRow[]): PulRetiradaRow[] {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pendente" ? -1 : 1;
    const byVal = a.val_mmaa.localeCompare(b.val_mmaa, "pt-BR");
    if (byVal !== 0) return byVal;
    const byEndereco = a.endereco_pul.localeCompare(b.endereco_pul, "pt-BR");
    if (byEndereco !== 0) return byEndereco;
    return a.coddv - b.coddv;
  });
}

function applyPendingEventsToLinhaRows(rows: LinhaRetiradaRow[], events: ControleValidadeOfflineEventRow[]): LinhaRetiradaRow[] {
  const merged = new Map<string, LinhaRetiradaRow>();
  for (const row of rows) {
    merged.set(lineKey(row), { ...row });
  }

  for (const event of events) {
    if (event.kind !== "linha_retirada") continue;
    const payload = normalizeOfflinePayload(event.payload as LinhaRetiradaPayload);
    const key = lineKey({
      coddv: payload.coddv,
      endereco_sep: payload.endereco_sep,
      val_mmaa: payload.val_mmaa,
      ref_coleta_mes: rows[0]?.ref_coleta_mes ?? ""
    });
    const current = merged.get(key);
    if (!current) continue;

    const qtdRetirada = current.qtd_retirada + payload.qtd_retirada;
    const qtdPendente = Math.max(current.qtd_coletada - qtdRetirada, 0);
    merged.set(key, {
      ...current,
      qtd_retirada: qtdRetirada,
      qtd_pendente: qtdPendente,
      status: qtdPendente > 0 ? "pendente" : "concluido"
    });
  }

  return sortLinhaRows(Array.from(merged.values()));
}

function applyPendingEventsToPulRows(rows: PulRetiradaRow[], events: ControleValidadeOfflineEventRow[]): PulRetiradaRow[] {
  const merged = new Map<string, PulRetiradaRow>();
  for (const row of rows) {
    merged.set(pulKey(row), { ...row });
  }

  for (const event of events) {
    if (event.kind !== "pul_retirada") continue;
    const payload = normalizeOfflinePayload(event.payload as PulRetiradaPayload);
    const key = pulKey({
      coddv: payload.coddv,
      endereco_pul: payload.endereco_pul,
      val_mmaa: payload.val_mmaa
    });
    const current = merged.get(key);
    if (!current) continue;

    const qtdRetirada = current.qtd_retirada + payload.qtd_retirada;
    const qtdPendente = Math.max(current.qtd_alvo - qtdRetirada, 0);
    merged.set(key, {
      ...current,
      qtd_retirada: qtdRetirada,
      qtd_pendente: qtdPendente,
      status: qtdPendente > 0 ? "pendente" : "concluido"
    });
  }

  return sortPulRows(Array.from(merged.values()));
}

async function lookupProdutoOnline(cd: number, barras: string): Promise<LinhaColetaLookupResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_busca_produto_lookup", {
    p_cd: cd,
    p_barras: barras,
    p_coddv: null
  });
  if (error) throw new Error(toErrorMessage(error));

  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Produto não encontrado.");
  return {
    cd: parseInteger(first.cd),
    coddv: parseInteger(first.coddv),
    descricao: parseString(first.descricao),
    barras: normalizeBarcode(parseString(first.barras) || barras),
    enderecos_sep: parseSepFromLookup(first.enderecos_sep)
  };
}

async function lookupProdutoOffline(cd: number, barras: string): Promise<LinhaColetaLookupResult | null> {
  const barcodeRow = await getDbBarrasByBarcode(barras);
  const coddv = barcodeRow?.coddv ?? 0;
  if (coddv <= 0) return null;
  const sepRows = await getDbEndRowsByCoddv(cd, coddv, "SEP");
  if (!sepRows.length) return null;
  return {
    cd,
    coddv,
    descricao: barcodeRow?.descricao?.trim() || sepRows[0].descricao || `CODDV ${coddv}`,
    barras,
    enderecos_sep: Array.from(
      new Set(
        sepRows
          .map((row) => normalizeEnderecoDisplay(row.endereco))
          .filter((value) => Boolean(value))
      )
    )
  };
}

async function warmCaches(result: LinhaColetaLookupResult): Promise<void> {
  await Promise.all([
    upsertDbBarrasCacheRow({
      barras: result.barras,
      coddv: result.coddv,
      descricao: result.descricao,
      updated_at: null
    }),
    upsertDbEndCacheRows(
      result.cd,
      result.enderecos_sep.map((endereco) => ({
        cd: result.cd,
        coddv: result.coddv,
        descricao: result.descricao,
        endereco,
        tipo: "SEP",
        andar: null,
        validade: null,
        updated_at: null
      }))
    )
  ]);
}

export async function resolveLinhaColetaProduto(params: {
  cd: number;
  rawBarcode: string;
  isOnline: boolean;
  preferOfflineMode: boolean;
}): Promise<LinhaColetaLookupResult> {
  const barras = normalizeBarcode(String(params.rawBarcode ?? ""));
  if (!barras) throw new Error("Informe o código de barras.");

  const shouldTryOfflineFirst = params.preferOfflineMode || !params.isOnline;
  let offlineResult: LinhaColetaLookupResult | null = null;
  let onlineError: unknown = null;

  if (shouldTryOfflineFirst) {
    offlineResult = await lookupProdutoOffline(params.cd, barras);
  }

  if (params.isOnline && (!shouldTryOfflineFirst || !offlineResult)) {
    try {
      const onlineResult = await lookupProdutoOnline(params.cd, barras);
      await warmCaches(onlineResult).catch(() => undefined);
      return onlineResult;
    } catch (error) {
      onlineError = error;
      if (offlineResult) return offlineResult;
    }
  }

  if (!offlineResult && !shouldTryOfflineFirst) {
    offlineResult = await lookupProdutoOffline(params.cd, barras);
  }

  if (offlineResult) return offlineResult;
  if (onlineError) throw (onlineError instanceof Error ? onlineError : new Error(toErrorMessage(onlineError)));
  throw new Error("Produto não encontrado no cache local.");
}

export async function fetchLinhaRetiradaList(params: {
  cd: number;
  status: RetiradaStatusFilter;
}): Promise<LinhaRetiradaRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_linha_retirada_list", {
    p_cd: params.cd,
    p_status: normalizeStatusFilter(params.status),
    p_limit: 4000,
    p_offset: 0
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return sortLinhaRows(data.map((row) => mapLinhaRow(row as Record<string, unknown>)));
}

export async function fetchPulRetiradaList(params: {
  cd: number;
  status: RetiradaStatusFilter;
}): Promise<PulRetiradaRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_pul_retirada_list", {
    p_cd: params.cd,
    p_status: normalizeStatusFilter(params.status),
    p_limit: 4000,
    p_offset: 0
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return sortPulRows(data.map((row) => mapPulRow(row as Record<string, unknown>)));
}

export async function sendLinhaColetaOnline(payload: LinhaColetaPayload): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const normalized = normalizeOfflinePayload(payload);
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_linha_coleta_insert", {
    p_cd: normalized.cd,
    p_barras: normalized.barras,
    p_endereco_sep: normalized.endereco_sep,
    p_val_mmaa: normalized.val_mmaa,
    p_qtd: normalized.qtd,
    p_data_hr: normalized.data_hr,
    p_client_event_id: normalized.client_event_id
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Falha ao registrar coleta da Linha.");
  }
}

export async function sendLinhaRetiradaOnline(payload: LinhaRetiradaPayload): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const normalized = normalizeOfflinePayload(payload);
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_linha_retirada_insert", {
    p_cd: normalized.cd,
    p_coddv: normalized.coddv,
    p_endereco_sep: normalized.endereco_sep,
    p_val_mmaa: normalized.val_mmaa,
    p_qtd_retirada: normalized.qtd_retirada,
    p_data_hr: normalized.data_hr,
    p_client_event_id: normalized.client_event_id
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Falha ao registrar retirada da Linha.");
  }
}

export async function sendPulRetiradaOnline(payload: PulRetiradaPayload): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const normalized = normalizeOfflinePayload(payload);
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_pul_retirada_insert", {
    p_cd: normalized.cd,
    p_coddv: normalized.coddv,
    p_endereco_pul: normalized.endereco_pul,
    p_val_mmaa: normalized.val_mmaa,
    p_qtd_retirada: normalized.qtd_retirada,
    p_data_hr: normalized.data_hr,
    p_client_event_id: normalized.client_event_id
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Falha ao registrar retirada do Pulmão.");
  }
}

export async function downloadOfflineSnapshot(userId: string, cd: number): Promise<{
  linha_rows: LinhaRetiradaRow[];
  pul_rows: PulRetiradaRow[];
}> {
  const [linhaRows, pulRows] = await Promise.all([
    fetchLinhaRetiradaList({ cd, status: "todos" }),
    fetchPulRetiradaList({ cd, status: "todos" })
  ]);
  await saveOfflineSnapshot({
    user_id: userId,
    cd,
    linha_rows: linhaRows,
    pul_rows: pulRows
  });
  return { linha_rows: linhaRows, pul_rows: pulRows };
}

export async function loadProjectedOfflineRows(params: {
  userId: string;
  cd: number;
}): Promise<{
  linha_rows: LinhaRetiradaRow[];
  pul_rows: PulRetiradaRow[];
}> {
  const snapshot = await loadOfflineSnapshot(params.userId, params.cd);
  if (!snapshot) {
    return { linha_rows: [], pul_rows: [] };
  }
  const events = await listPendingOfflineEvents(params.userId, params.cd);
  return {
    linha_rows: applyPendingEventsToLinhaRows(snapshot.linha_rows, events),
    pul_rows: applyPendingEventsToPulRows(snapshot.pul_rows, events)
  };
}

export async function enqueueLinhaColeta(params: {
  userId: string;
  cd: number;
  payload: LinhaColetaPayload;
}): Promise<void> {
  await saveOfflineLinhaColetaEvent({
    user_id: params.userId,
    cd: params.cd,
    payload: normalizeOfflinePayload(params.payload)
  });
}

export async function enqueueLinhaRetirada(params: {
  userId: string;
  cd: number;
  payload: LinhaRetiradaPayload;
}): Promise<void> {
  await saveOfflineLinhaRetiradaEvent({
    user_id: params.userId,
    cd: params.cd,
    payload: normalizeOfflinePayload(params.payload)
  });
}

export async function enqueuePulRetirada(params: {
  userId: string;
  cd: number;
  payload: PulRetiradaPayload;
}): Promise<void> {
  await saveOfflinePulRetiradaEvent({
    user_id: params.userId,
    cd: params.cd,
    payload: normalizeOfflinePayload(params.payload)
  });
}

async function syncSingleEvent(event: ControleValidadeOfflineEventRow): Promise<void> {
  if (event.kind === "linha_coleta") {
    await sendLinhaColetaOnline(normalizeOfflinePayload(event.payload as LinhaColetaPayload));
    return;
  }
  if (event.kind === "linha_retirada") {
    await sendLinhaRetiradaOnline(normalizeOfflinePayload(event.payload as LinhaRetiradaPayload));
    return;
  }
  await sendPulRetiradaOnline(normalizeOfflinePayload(event.payload as PulRetiradaPayload));
}

export async function flushControleValidadeOfflineQueue(userId: string, cd: number): Promise<ControleValidadeOfflineSyncResult> {
  const events = await listPendingOfflineEvents(userId, cd);
  if (!events.length) {
    return {
      synced: 0,
      failed: 0,
      discarded: 0,
      remaining: 0,
      discarded_pul_sem_estoque: 0
    };
  }

  let synced = 0;
  let failed = 0;
  let discarded = 0;
  let discardedPulNoStock = 0;

  for (const event of events) {
    try {
      await syncSingleEvent(event);
      await removeOfflineEvent(event.event_id);
      synced += 1;
    } catch (error) {
      const message = toErrorMessage(error);
      const discard =
        (event.kind === "pul_retirada" && isPulOutOfStockConflict(error))
        || (event.kind !== "linha_coleta" && isRetiradaConflict(error));

      if (discard) {
        await removeOfflineEvent(event.event_id);
        discarded += 1;
        if (event.kind === "pul_retirada" && isPulOutOfStockConflict(error)) {
          discardedPulNoStock += 1;
        }
        continue;
      }

      failed += 1;
      await updateOfflineEventStatus({
        event_id: event.event_id,
        status: "error",
        error_message: message,
        increment_attempt: true
      });
    }
  }

  const remaining = await countPendingOfflineEvents(userId, cd);
  return {
    synced,
    failed,
    discarded,
    remaining,
    discarded_pul_sem_estoque: discardedPulNoStock
  };
}

export async function getOfflineQueueStats(userId: string, cd: number): Promise<{ pending: number; errors: number }> {
  const [pending, errors] = await Promise.all([
    countPendingOfflineEvents(userId, cd),
    countErrorOfflineEvents(userId, cd)
  ]);
  return { pending, errors };
}

export function normalizeControleValidadeError(error: unknown): string {
  return toErrorMessage(error);
}
