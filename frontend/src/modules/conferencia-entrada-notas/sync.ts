import { supabase } from "../../lib/supabase";
import { saveLocalVolume, listPendingLocalVolumes, removeLocalVolume } from "./storage";
import type {
  EntradaNotasAvulsaConflictCheck,
  EntradaNotasAvulsaTargetOption,
  EntradaNotasAvulsaTargetSummary,
  EntradaNotasBarcodeSeqNfOption,
  CdOption,
  EntradaNotasContributor,
  EntradaNotasItemRow,
  EntradaNotasLocalVolume,
  EntradaNotasManifestBarrasRow,
  EntradaNotasManifestItemRow,
  EntradaNotasManifestMeta,
  EntradaNotasPartialReopenInfo,
  EntradaNotasRouteOverviewRow,
  EntradaNotasVolumeRow
} from "./types";

const MANIFEST_ITEMS_PAGE_SIZE = 1200;
const MANIFEST_BARRAS_PAGE_SIZE = 1500;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.error_description === "string") return candidate.error_description;
    if (typeof candidate.details === "string") return candidate.details;
  }
  return "Erro inesperado.";
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntegerOrNull(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeConferenceStatus(value: unknown): EntradaNotasVolumeRow["status"] {
  const statusRaw = String(value ?? "em_conferencia");
  if (statusRaw === "finalizado_ok" || statusRaw === "finalizado_falta" || statusRaw === "finalizado_divergencia") {
    return statusRaw;
  }
  return "em_conferencia";
}

function normalizeRouteStatus(value: unknown): EntradaNotasRouteOverviewRow["status"] {
  const statusRaw = String(value ?? "pendente").toLowerCase();
  if (statusRaw === "concluido" || statusRaw === "conferido") return "concluido";
  if (statusRaw === "em_andamento" || statusRaw === "em_conferencia") return "em_andamento";
  return "pendente";
}

export function normalizeBarcode(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function composeVolumeLabel(seqEntrada: number, nf: number): string {
  return `${seqEntrada}/${nf}`;
}

function parseVolumeLabel(value: string): { seqEntrada: number; nf: number } | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parts = raw.split(/[^\d]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const seqEntrada = Number.parseInt(parts[0], 10);
  const nf = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(seqEntrada) || !Number.isFinite(nf) || seqEntrada <= 0 || nf <= 0) return null;
  return { seqEntrada, nf };
}

function mapManifestMeta(raw: Record<string, unknown>): EntradaNotasManifestMeta {
  const sequenciasCount = parseInteger(raw.sequencias_count);
  return {
    cd: parseInteger(raw.cd),
    row_count: parseInteger(raw.row_count),
    sequencias_count: sequenciasCount,
    etiquetas_count: sequenciasCount,
    source_run_id: parseNullableString(raw.source_run_id),
    manifest_hash: String(raw.manifest_hash ?? ""),
    generated_at: String(raw.generated_at ?? new Date().toISOString())
  };
}

function mapManifestItem(raw: Record<string, unknown>): EntradaNotasManifestItemRow {
  const seqEntrada = parseInteger(raw.seq_entrada);
  const nf = parseInteger(raw.nf);
  const transportadora = String(raw.transportadora ?? "SEM TRANSPORTADORA").trim() || "SEM TRANSPORTADORA";
  const fornecedor = String(raw.fornecedor ?? "SEM FORNECEDOR").trim() || "SEM FORNECEDOR";
  return {
    seq_entrada: seqEntrada,
    nf,
    transportadora,
    fornecedor,
    coddv: parseInteger(raw.coddv),
    descricao: String(raw.descricao ?? "").trim(),
    qtd_esperada: Math.max(parseInteger(raw.qtd_esperada, 1), 1),

    nr_volume: composeVolumeLabel(seqEntrada, nf),
    caixa: null,
    pedido: null,
    filial: parseIntegerOrNull(raw.nf),
    filial_nome: fornecedor,
    rota: transportadora
  };
}

function mapManifestBarras(raw: Record<string, unknown>): EntradaNotasManifestBarrasRow {
  return {
    barras: normalizeBarcode(String(raw.barras ?? "")),
    coddv: parseInteger(raw.coddv),
    descricao: String(raw.descricao ?? "").trim(),
    updated_at: parseNullableString(raw.updated_at)
  };
}

function mapRouteOverview(raw: Record<string, unknown>): EntradaNotasRouteOverviewRow {
  const seqEntrada = parseInteger(raw.seq_entrada);
  const nf = parseInteger(raw.nf);
  const transportadora = String(raw.transportadora ?? "SEM TRANSPORTADORA").trim() || "SEM TRANSPORTADORA";
  const fornecedor = String(raw.fornecedor ?? "SEM FORNECEDOR").trim() || "SEM FORNECEDOR";
  const totalItens = Math.max(parseInteger(raw.total_itens), 0);
  const itensConferidos = Math.max(parseInteger(raw.itens_conferidos), 0);
  const itensDivergentes = Math.max(parseInteger(raw.itens_divergentes), 0);
  const status = normalizeRouteStatus(raw.status);

  return {
    transportadora,
    fornecedor,
    seq_entrada: seqEntrada,
    nf,
    total_itens: totalItens,
    itens_conferidos: itensConferidos,
    itens_divergentes: itensDivergentes,
    status,
    colaborador_nome: parseNullableString(raw.colaborador_nome),
    colaborador_mat: parseNullableString(raw.colaborador_mat),
    status_at: parseNullableString(raw.status_at),
    produtos_multiplos_seq: Math.max(parseInteger(raw.produtos_multiplos_seq), 0),

    rota: transportadora,
    filial: parseIntegerOrNull(raw.nf),
    filial_nome: fornecedor,
    total_etiquetas: totalItens,
    conferidas: itensConferidos,
    pendentes: Math.max(totalItens - itensConferidos, 0),
    pedidos_seq: `Seq ${seqEntrada} / NF ${nf}`
  };
}

function mapVolume(raw: Record<string, unknown>): EntradaNotasVolumeRow {
  const seqEntrada = parseInteger(raw.seq_entrada);
  const nf = parseInteger(raw.nf);
  const transportadora = parseNullableString(raw.transportadora) ?? "SEM TRANSPORTADORA";
  const fornecedor = parseNullableString(raw.fornecedor) ?? "SEM FORNECEDOR";
  const status = normalizeConferenceStatus(raw.status);

  return {
    conf_id: String(raw.conf_id ?? ""),
    conf_date: String(raw.conf_date ?? ""),
    cd: parseInteger(raw.cd),
    conference_kind: "seq_nf",
    seq_entrada: seqEntrada,
    nf,
    transportadora,
    fornecedor,
    status,
    started_by: String(raw.started_by ?? ""),
    started_mat: String(raw.started_mat ?? ""),
    started_nome: String(raw.started_nome ?? ""),
    started_at: String(raw.started_at ?? new Date().toISOString()),
    finalized_at: parseNullableString(raw.finalized_at),
    updated_at: String(raw.updated_at ?? new Date().toISOString()),
    is_read_only: raw.is_read_only === true,

    nr_volume: composeVolumeLabel(seqEntrada, nf),
    caixa: null,
    pedido: null,
    filial: parseIntegerOrNull(raw.nf),
    filial_nome: fornecedor,
    rota: transportadora,
    falta_motivo: null,
    contributors: []
  };
}

function mapItem(raw: Record<string, unknown>): EntradaNotasItemRow {
  const tipoRaw = String(raw.divergencia_tipo ?? "correto").toLowerCase();
  const divergencia_tipo = tipoRaw === "falta" || tipoRaw === "sobra" ? tipoRaw : "correto";

  return {
    item_id: String(raw.item_id ?? ""),
    conf_id: String(raw.conf_id ?? ""),
    coddv: parseInteger(raw.coddv),
    barras: parseNullableString(raw.barras),
    descricao: String(raw.descricao ?? "").trim(),
    qtd_esperada: parseInteger(raw.qtd_esperada),
    qtd_conferida: parseInteger(raw.qtd_conferida),
    qtd_falta: parseInteger(raw.qtd_falta),
    qtd_sobra: parseInteger(raw.qtd_sobra),
    divergencia_tipo,
    updated_at: String(raw.updated_at ?? new Date().toISOString()),
    seq_entrada: parseIntegerOrNull(raw.seq_entrada),
    nf: parseIntegerOrNull(raw.nf),
    target_conf_id: parseNullableString(raw.target_conf_id),
    item_key: parseNullableString(raw.item_key),
    is_locked: raw.is_locked === true,
    locked_by: parseNullableString(raw.locked_by),
    locked_mat: parseNullableString(raw.locked_mat),
    locked_nome: parseNullableString(raw.locked_nome)
  };
}

function mapBarcodeSeqNfOption(raw: Record<string, unknown>): EntradaNotasBarcodeSeqNfOption {
  return {
    coddv: parseInteger(raw.coddv),
    descricao: String(raw.descricao ?? "").trim() || `Produto ${parseInteger(raw.coddv)}`,
    barras: normalizeBarcode(String(raw.barras ?? "")),
    seq_entrada: parseInteger(raw.seq_entrada),
    nf: parseInteger(raw.nf),
    transportadora: String(raw.transportadora ?? "SEM TRANSPORTADORA").trim() || "SEM TRANSPORTADORA",
    fornecedor: String(raw.fornecedor ?? "SEM FORNECEDOR").trim() || "SEM FORNECEDOR",
    qtd_esperada: Math.max(parseInteger(raw.qtd_esperada), 0),
    qtd_conferida: Math.max(parseInteger(raw.qtd_conferida), 0),
    qtd_pendente: Math.max(parseInteger(raw.qtd_pendente), 0)
  };
}

function mapContributor(raw: Record<string, unknown>): EntradaNotasContributor {
  return {
    user_id: String(raw.user_id ?? ""),
    mat: String(raw.mat ?? "").trim(),
    nome: String(raw.nome ?? "").trim(),
    first_action_at: String(raw.first_action_at ?? new Date().toISOString()),
    last_action_at: String(raw.last_action_at ?? new Date().toISOString())
  };
}

function mapPartialReopenInfo(raw: Record<string, unknown>): EntradaNotasPartialReopenInfo {
  return {
    conf_id: String(raw.conf_id ?? ""),
    seq_entrada: parseInteger(raw.seq_entrada),
    nf: parseInteger(raw.nf),
    status: normalizeConferenceStatus(raw.status),
    previous_started_by: parseNullableString(raw.previous_started_by),
    previous_started_mat: parseNullableString(raw.previous_started_mat),
    previous_started_nome: parseNullableString(raw.previous_started_nome),
    locked_items: Math.max(parseInteger(raw.locked_items), 0),
    pending_items: Math.max(parseInteger(raw.pending_items), 0),
    can_reopen: raw.can_reopen === true
  };
}

export async function fetchCdOptions(): Promise<CdOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_cd_options");
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data
    .map((row) => {
      const raw = row as Record<string, unknown>;
      const cd = parseInteger(raw.cd, -1);
      if (cd < 0) return null;
      return {
        cd,
        cd_nome: String(raw.cd_nome ?? `CD ${cd}`)
      } satisfies CdOption;
    })
    .filter((row): row is CdOption => row != null);
}

export async function fetchManifestMeta(cd: number): Promise<EntradaNotasManifestMeta> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_manifest_meta", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Manifesto da entrada de notas não encontrado.");
  return mapManifestMeta(first);
}

export async function fetchManifestItemsPage(
  cd: number,
  offset: number,
  limit = MANIFEST_ITEMS_PAGE_SIZE
): Promise<EntradaNotasManifestItemRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_manifest_items_page", {
    p_cd: cd,
    p_offset: Math.max(offset, 0),
    p_limit: Math.max(1, limit)
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => mapManifestItem(row as Record<string, unknown>))
    .filter((row) => (row.seq_entrada ?? 0) > 0 && (row.nf ?? 0) > 0 && row.coddv > 0);
}

export async function fetchManifestBarrasPage(
  cd: number,
  offset: number,
  limit = MANIFEST_BARRAS_PAGE_SIZE
): Promise<EntradaNotasManifestBarrasRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_manifest_barras_page", {
    p_cd: cd,
    p_offset: Math.max(offset, 0),
    p_limit: Math.max(1, limit)
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => mapManifestBarras(row as Record<string, unknown>))
    .filter((row) => row.barras && row.coddv > 0);
}

export async function fetchRouteOverview(cd: number): Promise<EntradaNotasRouteOverviewRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_route_overview", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapRouteOverview(row as Record<string, unknown>));
}

export async function fetchManifestBundle(
  cd: number,
  onProgress?: (progress: { step: "items" | "barras" | "routes"; rows: number; total: number; percent: number }) => void,
  options?: { includeBarras?: boolean }
): Promise<{
  meta: EntradaNotasManifestMeta;
  items: EntradaNotasManifestItemRow[];
  barras: EntradaNotasManifestBarrasRow[];
  routes: EntradaNotasRouteOverviewRow[];
}> {
  const includeBarras = options?.includeBarras ?? true;
  const meta = await fetchManifestMeta(cd);

  let itemsOffset = 0;
  const items: EntradaNotasManifestItemRow[] = [];
  while (true) {
    const page = await fetchManifestItemsPage(cd, itemsOffset, MANIFEST_ITEMS_PAGE_SIZE);
    if (!page.length) break;
    items.push(...page);
    itemsOffset += page.length;
    const itemTotal = Math.max(meta.row_count, 0);
    const itemPercent = itemTotal > 0 ? Math.round(Math.min(1, items.length / itemTotal) * 100) : 100;
    onProgress?.({
      step: "items",
      rows: items.length,
      total: itemTotal,
      percent: itemPercent
    });
    if (page.length < MANIFEST_ITEMS_PAGE_SIZE) break;
  }

  const barras: EntradaNotasManifestBarrasRow[] = [];
  if (includeBarras) {
    let barrasOffset = 0;
    while (true) {
      const page = await fetchManifestBarrasPage(cd, barrasOffset, MANIFEST_BARRAS_PAGE_SIZE);
      if (!page.length) break;
      barras.push(...page);
      barrasOffset += page.length;
      onProgress?.({
        step: "barras",
        rows: barras.length,
        total: barras.length,
        percent: 100
      });
      if (page.length < MANIFEST_BARRAS_PAGE_SIZE) break;
    }
  }

  const routes = await fetchRouteOverview(cd);
  onProgress?.({
    step: "routes",
    rows: routes.length,
    total: routes.length,
    percent: 100
  });

  return { meta, items, barras, routes };
}

export async function openVolume(nrVolume: string, cd: number): Promise<EntradaNotasVolumeRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const parsed = parseVolumeLabel(nrVolume);
  if (!parsed) {
    throw new Error("SEQ_NF_INVALIDO");
  }
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_open_conference", {
    p_seq_entrada: parsed.seqEntrada,
    p_nf: parsed.nf,
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao abrir conferência.");
  return mapVolume(first);
}

export async function fetchActiveVolume(): Promise<EntradaNotasVolumeRow | null> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_get_active_conference");
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) return null;
  return mapVolume(first);
}

export async function fetchPartialReopenInfo(
  nrVolume: string,
  cd: number
): Promise<EntradaNotasPartialReopenInfo> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const parsed = parseVolumeLabel(nrVolume);
  if (!parsed) throw new Error("SEQ_NF_INVALIDO");

  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_get_partial_reopen_info", {
    p_seq_entrada: parsed.seqEntrada,
    p_nf: parsed.nf,
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao validar reabertura parcial.");
  return mapPartialReopenInfo(first);
}

export async function reopenPartialConference(
  nrVolume: string,
  cd: number
): Promise<EntradaNotasVolumeRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const parsed = parseVolumeLabel(nrVolume);
  if (!parsed) throw new Error("SEQ_NF_INVALIDO");

  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_reopen_partial_conference", {
    p_seq_entrada: parsed.seqEntrada,
    p_nf: parsed.nf,
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao reabrir conferência parcial.");
  return mapVolume(first);
}

export async function fetchVolumeContributors(confId: string): Promise<EntradaNotasContributor[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_get_contributors", {
    p_conf_id: confId
  });
  if (error) {
    const message = toErrorMessage(error);
    if (/rpc_conf_entrada_notas_get_contributors/i.test(message)) {
      return [];
    }
    throw new Error(message);
  }
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapContributor(row as Record<string, unknown>));
}

export async function lookupSeqNfByBarcode(
  barras: string,
  cd: number
): Promise<EntradaNotasBarcodeSeqNfOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_lookup_seq_nf_by_barcode", {
    p_barras: normalizeBarcode(barras),
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapBarcodeSeqNfOption(row as Record<string, unknown>));
}

function legacyAvulsaDisabledError(): Error {
  return new Error("CONFERENCIA_AVULSA_DESATIVADA");
}

export async function openAvulsaVolume(_cd: number): Promise<EntradaNotasVolumeRow> {
  throw legacyAvulsaDisabledError();
}

export async function fetchActiveAvulsaVolume(): Promise<EntradaNotasVolumeRow | null> {
  return null;
}

export async function resolveAvulsaTargets(
  _confId: string,
  _barras: string
): Promise<EntradaNotasAvulsaTargetOption[]> {
  return [];
}

export async function applyAvulsaScan(
  _confId: string,
  _barras: string,
  _qtd: number,
  _seqEntrada?: number | null,
  _nf?: number | null
): Promise<EntradaNotasItemRow> {
  throw legacyAvulsaDisabledError();
}

export async function fetchAvulsaTargets(_confId: string): Promise<EntradaNotasAvulsaTargetSummary[]> {
  return [];
}

export async function checkAvulsaConflict(confId: string): Promise<EntradaNotasAvulsaConflictCheck> {
  return {
    conf_id: confId,
    has_remote_data: false,
    remote_targets: 0,
    remote_items_conferidos: 0,
    seq_nf_list: ""
  };
}

export async function fetchAvulsaItems(_confId: string): Promise<EntradaNotasItemRow[]> {
  return [];
}

export async function fetchVolumeItems(confId: string): Promise<EntradaNotasItemRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data: v2Data, error: v2Error } = await supabase.rpc("rpc_conf_entrada_notas_get_items_v2", {
    p_conf_id: confId
  });
  if (!v2Error) {
    if (!Array.isArray(v2Data)) return [];
    return v2Data.map((row) => mapItem(row as Record<string, unknown>));
  }

  const fallbackNeeded = /rpc_conf_entrada_notas_get_items_v2/i.test(toErrorMessage(v2Error));
  if (!fallbackNeeded) {
    throw new Error(toErrorMessage(v2Error));
  }

  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_get_items", {
    p_conf_id: confId
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapItem(row as Record<string, unknown>));
}

export async function scanBarcode(confId: string, barras: string, qtd: number): Promise<EntradaNotasItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_scan_barcode", {
    p_conf_id: confId,
    p_barras: normalizeBarcode(barras),
    p_qtd: Math.max(1, Math.trunc(qtd))
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao atualizar item conferido.");
  return mapItem(first);
}

export async function setItemQtd(confId: string, coddv: number, qtdConferida: number): Promise<EntradaNotasItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_set_item_qtd", {
    p_conf_id: confId,
    p_coddv: coddv,
    p_qtd_conferida: Math.max(0, Math.trunc(qtdConferida))
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao salvar quantidade.");
  return mapItem(first);
}

export async function resetItem(confId: string, coddv: number): Promise<EntradaNotasItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_reset_item", {
    p_conf_id: confId,
    p_coddv: coddv
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao zerar item.");
  return mapItem(first);
}

export async function syncSnapshot(
  confId: string,
  items: Array<{ coddv: number; qtd_conferida: number; barras?: string | null }>
): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const payload = items.map((item) => ({
    coddv: item.coddv,
    qtd_conferida: Math.max(0, Math.trunc(item.qtd_conferida)),
    barras: item.barras ? normalizeBarcode(item.barras) : null
  }));

  const { error } = await supabase.rpc("rpc_conf_entrada_notas_sync_snapshot", {
    p_conf_id: confId,
    p_items: payload
  });
  if (error) throw new Error(toErrorMessage(error));
}

export async function finalizeVolume(
  confId: string,
  // assinatura mantida por compatibilidade com a UI reaproveitada
  _faltaMotivo: string | null = null
): Promise<{ status: string; falta_motivo: string | null; finalized_at: string | null }> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_finalize", {
    p_conf_id: confId
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao finalizar conferência.");
  return {
    status: String(first.status ?? "em_conferencia"),
    falta_motivo: null,
    finalized_at: parseNullableString(first.finalized_at)
  };
}

export async function finalizeAvulsaVolume(
  _confId: string
): Promise<{ status: string; falta_motivo: string | null; finalized_at: string | null }> {
  throw legacyAvulsaDisabledError();
}

export async function cancelVolume(confId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_cancel", {
    p_conf_id: confId
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return first?.cancelled === true;
}

export async function cancelAvulsaVolume(_confId: string): Promise<boolean> {
  return true;
}

export async function syncPendingEntradaNotasVolumes(userId: string): Promise<{
  processed: number;
  synced: number;
  failed: number;
}> {
  const pending = await listPendingLocalVolumes(userId);
  let synced = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      const isLegacyAvulsa = row.nr_volume === "AVULSA" || String(row.conference_kind ?? "") === "avulsa";
      if (isLegacyAvulsa) {
        await removeLocalVolume(row.local_key);
        synced += 1;
        continue;
      }

      if (row.pending_cancel) {
        if (row.remote_conf_id) {
          await cancelVolume(row.remote_conf_id);
        }
        await removeLocalVolume(row.local_key);
        synced += 1;
        continue;
      }

      if (row.is_read_only && !row.pending_snapshot && !row.pending_finalize) {
        row.pending_snapshot = false;
        row.pending_finalize = false;
        row.pending_cancel = false;
        row.sync_error = null;
        row.last_synced_at = new Date().toISOString();
        await saveLocalVolume(row);
        synced += 1;
        continue;
      }

      const needsRemoteConf = row.pending_snapshot || row.pending_finalize;
      let remoteConfId = row.remote_conf_id;
      if (needsRemoteConf && !remoteConfId) {
        const remoteOpen = await openVolume(row.nr_volume, row.cd);
        remoteConfId = remoteOpen.conf_id;
        row.remote_conf_id = remoteConfId;
        row.conf_date = remoteOpen.conf_date || row.conf_date;
        row.status = remoteOpen.status;
        row.is_read_only = remoteOpen.is_read_only;
        row.conference_kind = remoteOpen.conference_kind ?? row.conference_kind ?? "seq_nf";
        row.sync_error = null;
      }

      if (needsRemoteConf && !remoteConfId) {
        throw new Error("Não foi possível resolver a conferência remota.");
      }

      if (row.pending_snapshot && remoteConfId) {
        const payload = row.items.map((item) => ({
          coddv: item.coddv,
          qtd_conferida: Math.max(0, Math.trunc(item.qtd_conferida)),
          barras: item.barras ?? null
        }));
        await syncSnapshot(remoteConfId, payload);
        row.pending_snapshot = false;
      }

      if (row.pending_finalize && remoteConfId) {
        const finalized = await finalizeVolume(remoteConfId, row.pending_finalize_reason);
        const status = normalizeConferenceStatus(finalized.status);
        row.status = status;
        row.falta_motivo = finalized.falta_motivo;
        row.finalized_at = finalized.finalized_at;
        row.is_read_only = status !== "em_conferencia";
        row.pending_finalize = false;
        row.pending_cancel = false;
      }

      row.sync_error = null;
      row.last_synced_at = new Date().toISOString();
      row.updated_at = new Date().toISOString();
      await saveLocalVolume(row);
      synced += 1;
    } catch (error) {
      const message = toErrorMessage(error);
      if (message.includes("CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA")) {
        await removeLocalVolume(row.local_key);
        synced += 1;
        continue;
      }
      row.sync_error = message;
      row.updated_at = new Date().toISOString();
      await saveLocalVolume(row);
      failed += 1;
    }
  }

  return {
    processed: pending.length,
    synced,
    failed
  };
}
