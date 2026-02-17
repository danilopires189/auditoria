import { supabase } from "../../lib/supabase";
import { saveLocalVolume, listPendingLocalVolumes, removeLocalVolume } from "./storage";
import type {
  EntradaNotasAvulsaConflictCheck,
  EntradaNotasAvulsaTargetOption,
  EntradaNotasAvulsaTargetSummary,
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

function mapAvulsaVolume(raw: Record<string, unknown>): EntradaNotasVolumeRow {
  const status = normalizeConferenceStatus(raw.status);
  const transportadora = parseNullableString(raw.transportadora) ?? "CONFERENCIA AVULSA";
  const fornecedor = parseNullableString(raw.fornecedor) ?? "GERAL";

  return {
    conf_id: String(raw.conf_id ?? ""),
    conf_date: String(raw.conf_date ?? ""),
    cd: parseInteger(raw.cd),
    conference_kind: "avulsa",
    seq_entrada: 0,
    nf: 0,
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

    nr_volume: "AVULSA",
    caixa: null,
    pedido: null,
    filial: null,
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

function mapAvulsaTargetOption(raw: Record<string, unknown>): EntradaNotasAvulsaTargetOption {
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
    qtd_pendente: Math.max(parseInteger(raw.qtd_pendente), 0),
    target_conf_id: parseNullableString(raw.target_conf_id),
    target_status: parseNullableString(raw.target_status),
    started_by: parseNullableString(raw.started_by),
    started_nome: parseNullableString(raw.started_nome),
    started_mat: parseNullableString(raw.started_mat),
    is_locked: raw.is_locked === true,
    is_available: raw.is_available === true
  };
}

function mapAvulsaTargetSummary(raw: Record<string, unknown>): EntradaNotasAvulsaTargetSummary {
  return {
    avulsa_conf_id: String(raw.avulsa_conf_id ?? ""),
    target_conf_id: String(raw.target_conf_id ?? ""),
    seq_entrada: parseInteger(raw.seq_entrada),
    nf: parseInteger(raw.nf),
    transportadora: String(raw.transportadora ?? "SEM TRANSPORTADORA").trim() || "SEM TRANSPORTADORA",
    fornecedor: String(raw.fornecedor ?? "SEM FORNECEDOR").trim() || "SEM FORNECEDOR",
    status: normalizeConferenceStatus(raw.status),
    total_itens: Math.max(parseInteger(raw.total_itens), 0),
    itens_conferidos: Math.max(parseInteger(raw.itens_conferidos), 0),
    falta_count: Math.max(parseInteger(raw.falta_count), 0),
    sobra_count: Math.max(parseInteger(raw.sobra_count), 0),
    correto_count: Math.max(parseInteger(raw.correto_count), 0),
    first_scan_at: parseNullableString(raw.first_scan_at),
    last_scan_at: parseNullableString(raw.last_scan_at)
  };
}

function mapAvulsaConflict(raw: Record<string, unknown>): EntradaNotasAvulsaConflictCheck {
  return {
    conf_id: String(raw.conf_id ?? ""),
    has_remote_data: raw.has_remote_data === true,
    remote_targets: Math.max(parseInteger(raw.remote_targets), 0),
    remote_items_conferidos: Math.max(parseInteger(raw.remote_items_conferidos), 0),
    seq_nf_list: String(raw.seq_nf_list ?? "")
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

export async function openAvulsaVolume(cd: number): Promise<EntradaNotasVolumeRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_avulsa_open", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao abrir conferência avulsa.");
  return mapAvulsaVolume(first);
}

export async function fetchActiveAvulsaVolume(): Promise<EntradaNotasVolumeRow | null> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_avulsa_get_active");
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) return null;
  return mapAvulsaVolume(first);
}

export async function resolveAvulsaTargets(confId: string, barras: string): Promise<EntradaNotasAvulsaTargetOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_avulsa_resolve_targets", {
    p_conf_id: confId,
    p_barras: normalizeBarcode(barras)
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapAvulsaTargetOption(row as Record<string, unknown>));
}

export async function applyAvulsaScan(
  confId: string,
  barras: string,
  qtd: number,
  seqEntrada?: number | null,
  nf?: number | null
): Promise<EntradaNotasItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_avulsa_apply_scan", {
    p_conf_id: confId,
    p_barras: normalizeBarcode(barras),
    p_qtd: Math.max(1, Math.trunc(qtd)),
    p_seq_entrada: seqEntrada != null ? Math.max(0, Math.trunc(seqEntrada)) : null,
    p_nf: nf != null ? Math.max(0, Math.trunc(nf)) : null
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao aplicar bipagem avulsa.");
  const mapped = mapItem(first);
  if (!mapped.item_key) {
    const seq = mapped.seq_entrada ?? parseInteger(first.seq_entrada);
    const nfValue = mapped.nf ?? parseInteger(first.nf);
    mapped.item_key = `${seq}/${nfValue}:${mapped.coddv}`;
  }
  if (!mapped.target_conf_id) {
    mapped.target_conf_id = parseNullableString(first.target_conf_id) ?? mapped.conf_id;
  }
  return mapped;
}

export async function fetchAvulsaTargets(confId: string): Promise<EntradaNotasAvulsaTargetSummary[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_avulsa_get_targets", {
    p_conf_id: confId
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapAvulsaTargetSummary(row as Record<string, unknown>));
}

export async function checkAvulsaConflict(confId: string): Promise<EntradaNotasAvulsaConflictCheck> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_avulsa_check_conflict", {
    p_conf_id: confId
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) {
    return {
      conf_id: confId,
      has_remote_data: false,
      remote_targets: 0,
      remote_items_conferidos: 0,
      seq_nf_list: ""
    };
  }
  return mapAvulsaConflict(first);
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

export async function fetchAvulsaItems(confId: string): Promise<EntradaNotasItemRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data: v2Data, error: v2Error } = await supabase.rpc("rpc_conf_entrada_notas_avulsa_get_items_v2", {
    p_conf_id: confId
  });
  if (!v2Error) {
    if (!Array.isArray(v2Data)) return [];
    return v2Data.map((row) => mapItem(row as Record<string, unknown>));
  }

  const fallbackNeeded = /rpc_conf_entrada_notas_avulsa_get_items_v2/i.test(toErrorMessage(v2Error));
  if (!fallbackNeeded) {
    throw new Error(toErrorMessage(v2Error));
  }

  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_avulsa_get_items", {
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

export async function scanBarcodeAvulsa(confId: string, barras: string, qtd: number): Promise<EntradaNotasItemRow> {
  return applyAvulsaScan(confId, barras, qtd, null, null);
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
  confId: string
): Promise<{ status: string; falta_motivo: string | null; finalized_at: string | null }> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_avulsa_finalize_batch", {
    p_conf_id: confId
  });
  if (error) throw new Error(toErrorMessage(error));
  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
  if (!rows.length) throw new Error("Falha ao finalizar conferência avulsa.");
  const avulsaStatus = String(rows[0]?.avulsa_status ?? "em_conferencia");
  const finalizedAt = parseNullableString(rows[0]?.finalized_at) ?? new Date().toISOString();
  return {
    status: avulsaStatus,
    falta_motivo: null,
    finalized_at: finalizedAt
  };
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

export async function cancelAvulsaVolume(confId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_entrada_notas_avulsa_cancel_batch", {
    p_conf_id: confId
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return first?.cancelled === true;
}

function findAvulsaLocalItemForEvent(
  row: EntradaNotasLocalVolume,
  event: { coddv: number; seq_entrada: number; nf: number }
): EntradaNotasLocalVolume["items"][number] | null {
  return row.items.find((item) => (
    item.coddv === event.coddv
      && Number(item.seq_entrada ?? 0) === event.seq_entrada
      && Number(item.nf ?? 0) === event.nf
  )) ?? null;
}

function findAvulsaTargetConfIdFromCache(
  row: EntradaNotasLocalVolume,
  event: { seq_entrada: number; nf: number }
): string | null {
  const cached = row.avulsa_targets?.find((target) => (
    target.seq_entrada === event.seq_entrada
      && target.nf === event.nf
  ));
  return cached?.target_conf_id ?? null;
}

async function resolveAvulsaTargetConfId(
  row: EntradaNotasLocalVolume,
  event: { seq_entrada: number; nf: number; target_conf_id: string | null; coddv: number }
): Promise<string> {
  const eventTarget = String(event.target_conf_id ?? "").trim();
  if (eventTarget) return eventTarget;

  const localItem = findAvulsaLocalItemForEvent(row, event);
  const localTarget = String(localItem?.target_conf_id ?? "").trim();
  if (localTarget) return localTarget;

  const cachedTarget = findAvulsaTargetConfIdFromCache(row, event);
  if (cachedTarget) return cachedTarget;

  return (await openVolume(`${event.seq_entrada}/${event.nf}`, row.cd)).conf_id;
}

function shouldTryAvulsaAbsoluteFallback(message: string): boolean {
  return (
    message.includes("BARRAS_NAO_ENCONTRADA")
    || message.includes("ALVO_SEQ_NF_NAO_PENDENTE")
    || message.includes("SEM_ALVO_PENDENTE")
  );
}

async function syncAvulsaEventByAbsoluteQty(
  row: EntradaNotasLocalVolume,
  event: { seq_entrada: number; nf: number; target_conf_id: string | null; coddv: number; qtd: number }
): Promise<void> {
  const localItem = findAvulsaLocalItemForEvent(row, event);
  const desiredQtd = localItem
    ? Math.max(0, Math.trunc(localItem.qtd_conferida))
    : Math.max(0, Math.trunc(event.qtd));
  const targetConfId = await resolveAvulsaTargetConfId(row, event);
  await setItemQtd(targetConfId, event.coddv, desiredQtd);
}

function shouldCheckAlreadyAppliedSetQtd(message: string): boolean {
  return (
    message.includes("CONFERENCIA_JA_FINALIZADA")
    || message.includes("ITEM_BLOQUEADO_OUTRO_USUARIO")
    || message.includes("CONFERENCIA_EM_USO")
    || message.includes("ALVO_SEQ_NF_NAO_PENDENTE")
    || message.includes("SEM_ALVO_PENDENTE")
  );
}

async function isAvulsaQtdAlreadyApplied(
  row: EntradaNotasLocalVolume,
  event: { seq_entrada: number; nf: number; target_conf_id: string | null; coddv: number },
  targetConfId: string,
  expectedQtd: number
): Promise<boolean> {
  const candidateConfIds: string[] = [targetConfId];
  try {
    const resolvedConfId = await resolveAvulsaTargetConfId(row, event);
    if (resolvedConfId && !candidateConfIds.includes(resolvedConfId)) {
      candidateConfIds.push(resolvedConfId);
    }
  } catch {
    // Fallback apenas para conferência já resolvida.
  }

  for (const confId of candidateConfIds) {
    try {
      const remoteItems = await fetchVolumeItems(confId);
      const remoteItem = remoteItems.find((item) => item.coddv === event.coddv);
      if (remoteItem && Math.max(0, Math.trunc(remoteItem.qtd_conferida)) === expectedQtd) {
        return true;
      }
    } catch {
      // Tentará próximo confId candidato.
    }
  }
  return false;
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
      let isAvulsa = row.conference_kind === "avulsa" || row.nr_volume === "AVULSA";

      if (row.pending_cancel) {
        if (row.remote_conf_id) {
          if (isAvulsa) {
            await cancelAvulsaVolume(row.remote_conf_id);
          } else {
            await cancelVolume(row.remote_conf_id);
          }
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
        const remoteOpen = isAvulsa
          ? await openAvulsaVolume(row.cd)
          : await openVolume(row.nr_volume, row.cd);
        remoteConfId = remoteOpen.conf_id;
        row.remote_conf_id = remoteConfId;
        row.conf_date = remoteOpen.conf_date || row.conf_date;
        row.status = remoteOpen.status;
        row.is_read_only = remoteOpen.is_read_only;
        row.conference_kind = remoteOpen.conference_kind ?? row.conference_kind ?? "seq_nf";
        isAvulsa = row.conference_kind === "avulsa" || row.nr_volume === "AVULSA";
        row.sync_error = null;
      }

      if (needsRemoteConf && !remoteConfId) {
        throw new Error("Não foi possível resolver a conferência remota.");
      }

      if (row.pending_snapshot && remoteConfId) {
        if (isAvulsa) {
          const queue = [...(row.avulsa_queue ?? [])]
            .sort((a, b) => Date.parse(a.created_at || "") - Date.parse(b.created_at || ""));

          for (let index = 0; index < queue.length; index += 1) {
            const event = queue[index];
            if (event.kind === "scan") {
              try {
                await applyAvulsaScan(
                  remoteConfId,
                  event.barras,
                  Math.max(1, Math.trunc(event.qtd)),
                  event.seq_entrada,
                  event.nf
                );
              } catch (scanError) {
                const scanMessage = toErrorMessage(scanError);
                if (!shouldTryAvulsaAbsoluteFallback(scanMessage)) {
                  throw scanError;
                }
                await syncAvulsaEventByAbsoluteQty(row, event);
              }
            } else {
              const desiredQtd = Math.max(0, Math.trunc(event.qtd));
              let targetConfId = await resolveAvulsaTargetConfId(row, event);
              try {
                await setItemQtd(targetConfId, event.coddv, desiredQtd);
              } catch (setQtdError) {
                const setQtdMessage = toErrorMessage(setQtdError);
                if (setQtdMessage.includes("CONFERENCIA_NAO_ENCONTRADA")) {
                  const reopened = await openVolume(`${event.seq_entrada}/${event.nf}`, row.cd);
                  if (reopened.conf_id !== targetConfId) {
                    targetConfId = reopened.conf_id;
                    await setItemQtd(targetConfId, event.coddv, desiredQtd);
                  } else if (
                    !shouldCheckAlreadyAppliedSetQtd(setQtdMessage)
                    || !(await isAvulsaQtdAlreadyApplied(row, event, targetConfId, desiredQtd))
                  ) {
                    throw setQtdError;
                  }
                } else if (
                  !shouldCheckAlreadyAppliedSetQtd(setQtdMessage)
                  || !(await isAvulsaQtdAlreadyApplied(row, event, targetConfId, desiredQtd))
                ) {
                  throw setQtdError;
                }
              }
            }

            // Evita reprocessamento duplicado quando um erro ocorre após parte da fila.
            row.avulsa_queue = queue.slice(index + 1);
            row.updated_at = new Date().toISOString();
            await saveLocalVolume(row);
          }

          row.avulsa_queue = [];
          row.pending_snapshot = false;
          try {
            row.avulsa_targets = await fetchAvulsaTargets(remoteConfId);
            row.items = await fetchAvulsaItems(remoteConfId);
          } catch {
            // A bipagem já foi aplicada; atualização visual pode ocorrer no próximo sync.
          }
        } else {
          const payload = row.items.map((item) => ({
            coddv: item.coddv,
            qtd_conferida: Math.max(0, Math.trunc(item.qtd_conferida)),
            barras: item.barras ?? null
          }));
          await syncSnapshot(remoteConfId, payload);
          row.pending_snapshot = false;
        }
      }

      if (row.pending_finalize && remoteConfId) {
        const finalized = isAvulsa
          ? await finalizeAvulsaVolume(remoteConfId)
          : await finalizeVolume(remoteConfId, row.pending_finalize_reason);
        const status = normalizeConferenceStatus(finalized.status);
        row.status = status;
        row.falta_motivo = finalized.falta_motivo;
        row.finalized_at = finalized.finalized_at;
        row.is_read_only = status !== "em_conferencia";
        row.pending_finalize = false;
        row.pending_cancel = false;

        if (isAvulsa && row.remote_conf_id) {
          row.avulsa_targets = await fetchAvulsaTargets(row.remote_conf_id);
        }
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
