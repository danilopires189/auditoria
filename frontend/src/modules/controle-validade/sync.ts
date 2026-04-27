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
  ControleValidadeIndicadorPendenteRow,
  ControleValidadeIndicadorZonaRow,
  ControleValidadeIndicadorZonaIgnoradaRow,
  ControleValidadeOfflineEventRow,
  ControleValidadeOfflineSyncResult,
  LinhaColetaLookupResult,
  LinhaColetaHistoryRow,
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

function parseZona(value: unknown, fallbackEndereco: string): string {
  const explicit = parseString(value).toUpperCase();
  if (explicit) return explicit.slice(0, 4);
  const fromEndereco = parseString(fallbackEndereco).toUpperCase();
  if (!fromEndereco) return "SEM ZONA";
  return fromEndereco.slice(0, 4);
}

function parseRetiradaStatus(value: unknown): "pendente" | "concluido" {
  return String(value) === "concluido" ? "concluido" : "pendente";
}

function parseMonthIndexFromValidade(value: string): number | null {
  const matched = /^(\d{2})\/(\d{2})$/.exec(String(value ?? "").trim());
  if (!matched) return null;
  const month = Number.parseInt(matched[1], 10);
  const year = 2000 + Number.parseInt(matched[2], 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return year * 12 + month;
}

function parseMonthIndexFromRef(value: string): number | null {
  const matched = /^(\d{4})-(\d{2})/.exec(String(value ?? "").trim());
  if (!matched) return null;
  const year = Number.parseInt(matched[1], 10);
  const month = Number.parseInt(matched[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return year * 12 + month;
}

function monthRefFromDate(value: Date): string {
  return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthRefFromDateTime(value: string | null | undefined): string | null {
  const parsed = new Date(String(value ?? "").trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return monthRefFromDate(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
}

function currentMonthRef(baseDate = new Date()): string {
  return monthRefFromDate(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1));
}

function previousMonthRef(baseDate = new Date()): string {
  return monthRefFromDate(new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 1));
}

function linhaLeadMonths(enderecoSep: string): number {
  return /^AL/i.test(String(enderecoSep ?? "").trim()) ? 2 : 4;
}

function linhaRuleLabel(enderecoSep: string): string {
  return linhaLeadMonths(enderecoSep) === 2 ? "al_lte_2m" : "geral_lte_4m";
}

function resolveLinhaColetaCycle(params: {
  endereco_sep: string;
  val_mmaa: string;
  data_coleta: string | null | undefined;
  baseDate?: Date;
}): { eligible: boolean; ref_coleta_mes: string | null; regra_aplicada: string } {
  const regra_aplicada = linhaRuleLabel(params.endereco_sep);
  const coletaRef = monthRefFromDateTime(params.data_coleta);
  const validadeMonthIdx = parseMonthIndexFromValidade(params.val_mmaa);
  const currentRef = currentMonthRef(params.baseDate);
  const previousRef = previousMonthRef(params.baseDate);
  const currentMonthIdx = parseMonthIndexFromRef(currentRef);
  if (!coletaRef || validadeMonthIdx == null || currentMonthIdx == null) {
    return { eligible: false, ref_coleta_mes: null, regra_aplicada };
  }
  const targetMonthIdx = validadeMonthIdx - linhaLeadMonths(params.endereco_sep);
  if (coletaRef === previousRef && targetMonthIdx === currentMonthIdx) {
    return { eligible: true, ref_coleta_mes: previousRef, regra_aplicada };
  }
  if (coletaRef === currentRef && targetMonthIdx <= currentMonthIdx) {
    return { eligible: true, ref_coleta_mes: currentRef, regra_aplicada };
  }
  return { eligible: false, ref_coleta_mes: null, regra_aplicada };
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
  if (normalized.includes("APENAS_ADMIN")) return "Apenas administradores podem alterar zonas desconsideradas.";
  if (normalized.includes("ZONA_OBRIGATORIA")) return "Informe a zona.";
  if (normalized.includes("PRODUTO_NAO_ENCONTRADO")) return "Produto não encontrado.";
  if (normalized.includes("TERMO_BUSCA_OBRIGATORIO")) return "Informe endereço, CODDV ou barras para buscar.";
  if (normalized.includes("ENDERECO_SEP_INVALIDO")) return "Endereço de Linha inválido para este produto.";
  if (normalized.includes("VALIDADE_INVALIDA")) return "Validade inválida. Use MMAA ou Indeterminada.";
  if (normalized.includes("ITEM_PUL_SEM_ESTOQUE")) return "Item do Pulmão sem estoque disponível (qtd_est_disp <= 0).";
  if (normalized.includes("ITEM_NAO_ELEGIVEL_RETIRADA")) return "Item não elegível para retirada.";
  if (normalized.includes("QTD_RETIRADA_EXCEDE_PENDENTE")) return "Quantidade retirada excede o pendente.";
  if (normalized.includes("QTD_RETIRADA_EXCEDE_ESTOQUE")) return "Quantidade retirada excede o estoque disponível.";
  if (normalized.includes("ITEM_JA_CONCLUIDO")) return "Este item já está concluído.";
  if (normalized.includes("APENAS_AUTOR_PODE_EDITAR")) return "Apenas o usuário que registrou pode editar este lançamento.";
  if (normalized.includes("REGISTRO_NAO_ENCONTRADO")) return "Registro não encontrado.";
  if (normalized.includes("COLETA_COM_RETIRADA_NAO_EDITAVEL")) return "Esta coleta já possui retirada vinculada e não pode ser editada.";
  return raw;
}

function isPulOutOfStockConflict(error: unknown): boolean {
  return toErrorMessage(error).toUpperCase().includes("SEM ESTOQUE");
}

function isRetiradaConflict(error: unknown): boolean {
  const normalized = toErrorMessage(error).toUpperCase();
  return normalized.includes("ITEM NÃO ELEGÍVEL")
    || normalized.includes("EXCEDE O PENDENTE")
    || normalized.includes("EXCEDE O ESTOQUE")
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
    status: parseRetiradaStatus(raw.status),
    regra_aplicada: parseString(raw.regra_aplicada),
    dt_ultima_coleta: parseNullableString(raw.dt_ultima_coleta),
    dt_ultima_retirada: parseNullableString(raw.dt_ultima_retirada),
    auditor_nome_ultima_coleta: parseNullableString(
      raw.auditor_nome_ultima_coleta ?? raw.created_nome ?? raw.nome_ultima_coleta
    ),
    auditor_mat_ultima_coleta: parseNullableString(
      raw.auditor_mat_ultima_coleta ?? raw.created_mat ?? raw.mat_ultima_coleta
    ),
    auditor_nome_ultima_retirada: parseNullableString(raw.auditor_nome_ultima_retirada),
    editable_retirada_id: parseNullableString(raw.editable_retirada_id),
    editable_retirada_qtd: raw.editable_retirada_qtd == null ? null : parseInteger(raw.editable_retirada_qtd)
  };
}

function mapLinhaColetaHistoryRow(raw: Record<string, unknown>): LinhaColetaHistoryRow {
  const enderecoSep = normalizeEnderecoDisplay(parseString(raw.endereco_sep));
  return {
    id: parseString(raw.id),
    cd: parseInteger(raw.cd),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao),
    barras: normalizeBarcode(parseString(raw.barras)),
    zona: parseZona(raw.zona, enderecoSep),
    endereco_sep: enderecoSep,
    val_mmaa: parseString(raw.val_mmaa),
    data_coleta: parseNullableString(raw.data_coleta),
    auditor_id: parseNullableString(raw.auditor_id),
    auditor_mat: parseNullableString(raw.auditor_mat),
    auditor_nome: parseNullableString(raw.auditor_nome)
  };
}

function mapPulRow(raw: Record<string, unknown>): PulRetiradaRow {
  const enderecoPul = normalizeEnderecoDisplay(parseString(raw.endereco_pul));
  return {
    cd: parseInteger(raw.cd),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao),
    zona: parseZona(raw.zona, enderecoPul),
    endereco_pul: enderecoPul,
    andar: parseNullableString(raw.andar),
    val_mmaa: parseString(raw.val_mmaa),
    qtd_retirada: parseInteger(raw.qtd_retirada),
    status: parseRetiradaStatus(raw.status),
    qtd_est_disp: parseInteger(raw.qtd_est_disp),
    dt_ultima_retirada: parseNullableString(raw.dt_ultima_retirada),
    auditor_nome_ultima_retirada: parseNullableString(raw.auditor_nome_ultima_retirada),
    editable_retirada_id: parseNullableString(raw.editable_retirada_id),
    editable_retirada_qtd: raw.editable_retirada_qtd == null ? null : parseInteger(raw.editable_retirada_qtd)
  };
}

function mapIndicadorZonaRow(raw: Record<string, unknown>): ControleValidadeIndicadorZonaRow {
  return {
    zona: parseZona(raw.zona, ""),
    coletado_total: parseInteger(raw.coletado_total),
    pendente_total: parseInteger(raw.pendente_total),
    total: parseInteger(raw.total)
  };
}

function mapIndicadorPendenteRow(raw: Record<string, unknown>): ControleValidadeIndicadorPendenteRow {
  return {
    endereco: normalizeEnderecoDisplay(parseString(raw.endereco)),
    descricao: parseString(raw.descricao) || "Item sem descrição",
    estoque: parseInteger(raw.estoque),
    dat_ult_compra: parseNullableString(raw.dat_ult_compra)
  };
}

function mapIndicadorZonaIgnoradaRow(raw: Record<string, unknown>): ControleValidadeIndicadorZonaIgnoradaRow {
  return {
    zona: parseZona(raw.zona, ""),
    created_at: parseNullableString(raw.created_at)
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
    const byZona = a.zona.localeCompare(b.zona, "pt-BR");
    if (byZona !== 0) return byZona;
    const byVal = a.val_mmaa.localeCompare(b.val_mmaa, "pt-BR");
    if (byVal !== 0) return byVal;
    const byEndereco = a.endereco_pul.localeCompare(b.endereco_pul, "pt-BR");
    if (byEndereco !== 0) return byEndereco;
    return a.coddv - b.coddv;
  });
}

function sortLinhaColetaHistoryRows(rows: LinhaColetaHistoryRow[]): LinhaColetaHistoryRow[] {
  return [...rows].sort((a, b) => {
    const byZona = a.zona.localeCompare(b.zona, "pt-BR");
    if (byZona !== 0) return byZona;
    const leftDate = String(a.data_coleta ?? "");
    const rightDate = String(b.data_coleta ?? "");
    const byData = rightDate.localeCompare(leftDate, "pt-BR");
    if (byData !== 0) return byData;
    const byEndereco = a.endereco_sep.localeCompare(b.endereco_sep, "pt-BR");
    if (byEndereco !== 0) return byEndereco;
    return a.coddv - b.coddv;
  });
}

function filterLinhaColetaHistoryToCurrentMonth(rows: LinhaColetaHistoryRow[], baseDate = new Date()): LinhaColetaHistoryRow[] {
  const currentRef = currentMonthRef(baseDate);
  return rows.filter((row) => monthRefFromDateTime(row.data_coleta) === currentRef);
}

function applyPendingEventsToLinhaRows(rows: LinhaRetiradaRow[], events: ControleValidadeOfflineEventRow[]): LinhaRetiradaRow[] {
  const merged = new Map<string, LinhaRetiradaRow>();
  for (const row of rows) {
    merged.set(lineKey(row), { ...row });
  }

  for (const event of events) {
    if (event.kind === "linha_coleta") {
      const payload = normalizeOfflinePayload(event.payload as LinhaColetaPayload);
      const cycle = resolveLinhaColetaCycle({
        endereco_sep: payload.endereco_sep,
        val_mmaa: payload.val_mmaa,
        data_coleta: payload.data_hr ?? event.created_at
      });
      if (!cycle.eligible || !cycle.ref_coleta_mes || payload.coddv <= 0) continue;
      const key = lineKey({
        coddv: payload.coddv,
        endereco_sep: payload.endereco_sep,
        val_mmaa: payload.val_mmaa,
        ref_coleta_mes: cycle.ref_coleta_mes
      });
      const current = merged.get(key);
      const nextColetaAt = payload.data_hr ?? event.created_at;
      const shouldReplaceActor = !current?.dt_ultima_coleta
        || (nextColetaAt != null && String(nextColetaAt).localeCompare(String(current.dt_ultima_coleta ?? "")) >= 0);
      const qtdColetada = (current?.qtd_coletada ?? 0) + 1;
      const qtdRetirada = current?.qtd_retirada ?? 0;
      merged.set(key, {
        cd: payload.cd,
        coddv: payload.coddv,
        descricao: payload.descricao || current?.descricao || `CODDV ${payload.coddv}`,
        endereco_sep: payload.endereco_sep,
        val_mmaa: payload.val_mmaa,
        ref_coleta_mes: cycle.ref_coleta_mes,
        qtd_coletada: qtdColetada,
        qtd_retirada: qtdRetirada,
        status: current?.status === "concluido" ? "concluido" : "pendente",
        regra_aplicada: cycle.regra_aplicada,
        dt_ultima_coleta: shouldReplaceActor ? nextColetaAt ?? current?.dt_ultima_coleta ?? null : current?.dt_ultima_coleta ?? null,
        dt_ultima_retirada: current?.dt_ultima_retirada ?? null,
        auditor_nome_ultima_coleta: shouldReplaceActor ? payload.auditor_nome ?? current?.auditor_nome_ultima_coleta ?? null : current?.auditor_nome_ultima_coleta ?? null,
        auditor_mat_ultima_coleta: shouldReplaceActor ? payload.auditor_mat ?? current?.auditor_mat_ultima_coleta ?? null : current?.auditor_mat_ultima_coleta ?? null,
        auditor_nome_ultima_retirada: current?.auditor_nome_ultima_retirada ?? null,
        editable_retirada_id: current?.editable_retirada_id ?? null,
        editable_retirada_qtd: current?.editable_retirada_qtd ?? null
      });
      continue;
    }

    if (event.kind !== "linha_retirada") continue;
    const payload = normalizeOfflinePayload(event.payload as LinhaRetiradaPayload);
    const explicitKey = payload.ref_coleta_mes
      ? lineKey({
          coddv: payload.coddv,
          endereco_sep: payload.endereco_sep,
          val_mmaa: payload.val_mmaa,
          ref_coleta_mes: payload.ref_coleta_mes
        })
      : null;
    const fallbackRow = explicitKey == null
      ? Array.from(merged.values()).find((candidate) =>
          candidate.coddv === payload.coddv
          && candidate.endereco_sep === payload.endereco_sep
          && candidate.val_mmaa === payload.val_mmaa
        ) ?? null
      : null;
    const current = explicitKey != null ? merged.get(explicitKey) ?? null : fallbackRow;
    if (!current) continue;

    const qtdRetirada = payload.qtd_retirada;
    const dtUltimaRetirada = payload.data_hr ?? event.created_at;
    merged.set(lineKey(current), {
      ...current,
      qtd_retirada: qtdRetirada,
      status: "concluido",
      dt_ultima_retirada: dtUltimaRetirada,
      auditor_nome_ultima_retirada: current.auditor_nome_ultima_retirada,
      editable_retirada_id: current.editable_retirada_id,
      editable_retirada_qtd: current.editable_retirada_qtd
    });
  }

  return sortLinhaRows(Array.from(merged.values()));
}

function applyPendingEventsToLinhaColetaHistoryRows(
  rows: LinhaColetaHistoryRow[],
  events: ControleValidadeOfflineEventRow[]
): LinhaColetaHistoryRow[] {
  const projected = [...rows];
  for (const event of events) {
    if (event.kind !== "linha_coleta") continue;
    const payload = normalizeOfflinePayload(event.payload as LinhaColetaPayload);
    if (payload.coddv <= 0 || !payload.endereco_sep) continue;
    projected.push({
      id: event.event_id,
      cd: payload.cd,
      coddv: payload.coddv,
      descricao: payload.descricao || `CODDV ${payload.coddv}`,
      barras: payload.barras,
      zona: parseZona(null, payload.endereco_sep),
      endereco_sep: payload.endereco_sep,
      val_mmaa: payload.val_mmaa,
      data_coleta: payload.data_hr ?? event.created_at,
      auditor_id: event.user_id,
      auditor_mat: payload.auditor_mat,
      auditor_nome: payload.auditor_nome
    });
  }
  return sortLinhaColetaHistoryRows(filterLinhaColetaHistoryToCurrentMonth(projected)).slice(0, 1000);
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
    merged.set(key, {
      ...current,
      qtd_retirada: qtdRetirada,
      status: qtdRetirada > 0 ? "concluido" : "pendente",
      dt_ultima_retirada: payload.data_hr ?? event.created_at,
      editable_retirada_id: current.editable_retirada_id,
      editable_retirada_qtd: current.editable_retirada_qtd
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

export async function fetchLinhaColetaHistoryList(params: {
  cd: number;
  limit?: number;
}): Promise<LinhaColetaHistoryRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_linha_coleta_history_list", {
    p_cd: params.cd,
    p_limit: params.limit ?? 1000,
    p_offset: 0
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return sortLinhaColetaHistoryRows(data.map((row) => mapLinhaColetaHistoryRow(row as Record<string, unknown>))).slice(0, 1000);
}

export async function searchLinhaLastColeta(params: {
  cd: number;
  term: string;
}): Promise<LinhaColetaHistoryRow | null> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_linha_coleta_last_search", {
    p_cd: params.cd,
    p_term: params.term
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return first ? mapLinhaColetaHistoryRow(first) : null;
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

export async function fetchControleValidadeIndicadoresZonas(params: {
  cd: number;
  monthStart?: string | null;
}): Promise<ControleValidadeIndicadorZonaRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_indicadores_zonas", {
    p_cd: params.cd,
    p_month_start: params.monthStart ?? null
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapIndicadorZonaRow(row as Record<string, unknown>));
}

export async function fetchControleValidadeIndicadoresPendentesZona(params: {
  cd: number;
  zona: string;
  monthStart?: string | null;
  limit?: number;
}): Promise<ControleValidadeIndicadorPendenteRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_indicadores_pendentes_zona", {
    p_cd: params.cd,
    p_zona: params.zona,
    p_month_start: params.monthStart ?? null,
    p_limit: params.limit ?? 500
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapIndicadorPendenteRow(row as Record<string, unknown>));
}

export async function fetchControleValidadeIndicadoresZonasIgnoradas(cd: number): Promise<ControleValidadeIndicadorZonaIgnoradaRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_indicadores_zonas_ignoradas_list", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapIndicadorZonaIgnoradaRow(row as Record<string, unknown>));
}

export async function addControleValidadeIndicadorZonaIgnorada(params: {
  cd: number;
  zona: string;
}): Promise<ControleValidadeIndicadorZonaIgnoradaRow | null> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_indicadores_zona_ignorada_add", {
    p_cd: params.cd,
    p_zona: params.zona
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  return first ? mapIndicadorZonaIgnoradaRow(first) : null;
}

export async function deleteControleValidadeIndicadorZonaIgnorada(params: {
  cd: number;
  zona: string;
}): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { error } = await supabase.rpc("rpc_ctrl_validade_indicadores_zona_ignorada_delete", {
    p_cd: params.cd,
    p_zona: params.zona
  });
  if (error) throw new Error(toErrorMessage(error));
}

export async function fetchLinhaColetaReportRows(params: {
  cd: number;
  dtIni: string;
  dtFim: string;
  limit?: number;
}): Promise<LinhaColetaHistoryRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_linha_coleta_report", {
    p_cd: params.cd,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_limit: params.limit ?? 50000,
    p_offset: 0
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return sortLinhaColetaHistoryRows(data.map((row) => mapLinhaColetaHistoryRow(row as Record<string, unknown>)));
}

export async function fetchLinhaRetiradaReportRows(params: {
  cd: number;
  status: "pendente" | "concluido" | "ambos";
  dtIni: string;
  dtFim: string;
  limit?: number;
}): Promise<LinhaRetiradaRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_linha_retirada_report", {
    p_cd: params.cd,
    p_status: params.status,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_limit: params.limit ?? 50000,
    p_offset: 0
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return sortLinhaRows(data.map((row) => mapLinhaRow(row as Record<string, unknown>)));
}

export async function fetchPulRetiradaReportRows(params: {
  cd: number;
  status: "pendente" | "concluido" | "ambos";
  dtIni: string;
  dtFim: string;
  limit?: number;
}): Promise<PulRetiradaRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_pul_retirada_report", {
    p_cd: params.cd,
    p_status: params.status,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_limit: params.limit ?? 50000,
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
    p_ref_coleta_mes: normalized.ref_coleta_mes,
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

export async function updateLinhaColetaValidadeOnline(params: {
  id: string;
  val_mmaa: string;
}): Promise<LinhaColetaHistoryRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_linha_coleta_update_val_mmaa", {
    p_id: params.id,
    p_val_mmaa: params.val_mmaa
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao editar coleta da Linha.");
  return mapLinhaColetaHistoryRow(first);
}

export async function updateLinhaRetiradaQtdOnline(params: {
  id: string;
  qtd_retirada: number;
}): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_linha_retirada_update_qtd", {
    p_id: params.id,
    p_qtd_retirada: params.qtd_retirada
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Falha ao editar retirada da Linha.");
  }
}

export async function updatePulRetiradaQtdOnline(params: {
  id: string;
  qtd_retirada: number;
}): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_ctrl_validade_pul_retirada_update_qtd", {
    p_id: params.id,
    p_qtd_retirada: params.qtd_retirada
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Falha ao editar retirada do Pulmão.");
  }
}

export async function downloadOfflineSnapshot(userId: string, cd: number): Promise<{
  linha_rows: LinhaRetiradaRow[];
  linha_coleta_history: LinhaColetaHistoryRow[];
  pul_rows: PulRetiradaRow[];
}> {
  const [linhaRows, linhaColetaHistory, pulRows] = await Promise.all([
    fetchLinhaRetiradaList({ cd, status: "todos" }),
    fetchLinhaColetaHistoryList({ cd, limit: 1000 }),
    fetchPulRetiradaList({ cd, status: "todos" })
  ]);
  await saveOfflineSnapshot({
    user_id: userId,
    cd,
    linha_rows: linhaRows,
    linha_coleta_history: linhaColetaHistory,
    pul_rows: pulRows
  });
  return { linha_rows: linhaRows, linha_coleta_history: linhaColetaHistory, pul_rows: pulRows };
}

export async function loadProjectedOfflineRows(params: {
  userId: string;
  cd: number;
}): Promise<{
  linha_rows: LinhaRetiradaRow[];
  linha_coleta_history: LinhaColetaHistoryRow[];
  pul_rows: PulRetiradaRow[];
}> {
  const snapshot = await loadOfflineSnapshot(params.userId, params.cd);
  if (!snapshot) {
    return { linha_rows: [], linha_coleta_history: [], pul_rows: [] };
  }
  const events = await listPendingOfflineEvents(params.userId, params.cd);
  const pendingEvents = events.filter((event) => event.status === "pending");
  const linhaRows = (snapshot.linha_rows ?? []).map((row) => mapLinhaRow(row as unknown as Record<string, unknown>));
  const linhaColetaHistory = (snapshot.linha_coleta_history ?? []).map((row) =>
    mapLinhaColetaHistoryRow(row as unknown as Record<string, unknown>)
  );
  const pulRows = (snapshot.pul_rows ?? []).map((row) => mapPulRow(row as unknown as Record<string, unknown>));
  return {
    linha_rows: applyPendingEventsToLinhaRows(linhaRows, pendingEvents),
    linha_coleta_history: applyPendingEventsToLinhaColetaHistoryRows(linhaColetaHistory, pendingEvents),
    pul_rows: applyPendingEventsToPulRows(pulRows, pendingEvents)
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
