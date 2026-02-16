import { supabase } from "../../lib/supabase";
import { saveLocalVolume, listPendingLocalVolumes, removeLocalVolume } from "./storage";
import type {
  CdOption,
  VolumeAvulsoItemRow,
  VolumeAvulsoLocalVolume,
  VolumeAvulsoManifestBarrasRow,
  VolumeAvulsoManifestItemRow,
  VolumeAvulsoManifestMeta,
  VolumeAvulsoRouteOverviewRow,
  VolumeAvulsoVolumeRow
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

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "t" || normalized === "1";
}

export function normalizeBarcode(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function mapManifestMeta(raw: Record<string, unknown>): VolumeAvulsoManifestMeta {
  return {
    cd: parseInteger(raw.cd),
    row_count: parseInteger(raw.row_count),
    etiquetas_count: parseInteger(raw.etiquetas_count),
    source_run_id: parseNullableString(raw.source_run_id),
    manifest_hash: String(raw.manifest_hash ?? ""),
    generated_at: String(raw.generated_at ?? new Date().toISOString())
  };
}

function mapManifestItem(raw: Record<string, unknown>): VolumeAvulsoManifestItemRow {
  return {
    nr_volume: String(raw.nr_volume ?? "").trim(),
    caixa: parseNullableString(raw.caixa),
    pedido: parseIntegerOrNull(raw.pedido),
    filial: parseIntegerOrNull(raw.filial),
    filial_nome: parseNullableString(raw.filial_nome),
    rota: parseNullableString(raw.rota),
    coddv: parseInteger(raw.coddv),
    descricao: String(raw.descricao ?? "").trim(),
    qtd_esperada: Math.max(parseInteger(raw.qtd_esperada, 1), 1)
  };
}

function mapManifestBarras(raw: Record<string, unknown>): VolumeAvulsoManifestBarrasRow {
  return {
    barras: normalizeBarcode(String(raw.barras ?? "")),
    coddv: parseInteger(raw.coddv),
    descricao: String(raw.descricao ?? "").trim(),
    updated_at: parseNullableString(raw.updated_at)
  };
}

function mapRouteOverview(raw: Record<string, unknown>): VolumeAvulsoRouteOverviewRow {
  const statusRaw = String(raw.status ?? "pendente").toLowerCase();
  const status =
    statusRaw === "concluido"
    || statusRaw === "conferido"
    || statusRaw === "finalizado_ok"
    || statusRaw === "finalizado_falta"
      ? "concluido"
      : statusRaw === "em_andamento" || statusRaw === "em_conferencia"
        ? "em_andamento"
        : "pendente";

  return {
    rota: String(raw.rota ?? "SEM ROTA"),
    filial: parseIntegerOrNull(raw.filial),
    filial_nome: String(raw.filial_nome ?? "Filial"),
    total_etiquetas: parseInteger(raw.total_etiquetas),
    conferidas: parseInteger(raw.conferidas),
    pendentes: parseInteger(raw.pendentes),
    status,
    tem_falta: parseBoolean(raw.tem_falta),
    colaborador_nome: parseNullableString(raw.colaborador_nome),
    colaborador_mat: parseNullableString(raw.colaborador_mat),
    status_at: parseNullableString(raw.status_at)
  };
}

function mapVolume(raw: Record<string, unknown>): VolumeAvulsoVolumeRow {
  const statusRaw = String(raw.status ?? "em_conferencia");
  const status = statusRaw === "finalizado_ok" || statusRaw === "finalizado_falta"
    ? statusRaw
    : "em_conferencia";

  return {
    conf_id: String(raw.conf_id ?? ""),
    conf_date: String(raw.conf_date ?? ""),
    cd: parseInteger(raw.cd),
    nr_volume: String(raw.nr_volume ?? ""),
    caixa: parseNullableString(raw.caixa),
    pedido: parseIntegerOrNull(raw.pedido),
    filial: parseIntegerOrNull(raw.filial),
    filial_nome: parseNullableString(raw.filial_nome),
    rota: parseNullableString(raw.rota),
    status,
    falta_motivo: parseNullableString(raw.falta_motivo),
    started_by: String(raw.started_by ?? ""),
    started_mat: String(raw.started_mat ?? ""),
    started_nome: String(raw.started_nome ?? ""),
    started_at: String(raw.started_at ?? new Date().toISOString()),
    finalized_at: parseNullableString(raw.finalized_at),
    updated_at: String(raw.updated_at ?? new Date().toISOString()),
    is_read_only: raw.is_read_only === true
  };
}

function mapItem(raw: Record<string, unknown>): VolumeAvulsoItemRow {
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
    updated_at: String(raw.updated_at ?? new Date().toISOString())
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

export async function fetchManifestMeta(cd: number): Promise<VolumeAvulsoManifestMeta> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_volume_avulso_manifest_meta", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Manifesto do Volume Avulso não encontrado.");
  return mapManifestMeta(first);
}

export async function fetchManifestItemsPage(
  cd: number,
  offset: number,
  limit = MANIFEST_ITEMS_PAGE_SIZE
): Promise<VolumeAvulsoManifestItemRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_volume_avulso_manifest_items_page", {
    p_cd: cd,
    p_offset: Math.max(offset, 0),
    p_limit: Math.max(1, limit)
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => mapManifestItem(row as Record<string, unknown>))
    .filter((row) => row.nr_volume && row.coddv > 0);
}

export async function fetchManifestBarrasPage(
  cd: number,
  offset: number,
  limit = MANIFEST_BARRAS_PAGE_SIZE
): Promise<VolumeAvulsoManifestBarrasRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_volume_avulso_manifest_barras_page", {
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

export async function fetchRouteOverview(cd: number): Promise<VolumeAvulsoRouteOverviewRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_volume_avulso_route_overview", {
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
  meta: VolumeAvulsoManifestMeta;
  items: VolumeAvulsoManifestItemRow[];
  barras: VolumeAvulsoManifestBarrasRow[];
  routes: VolumeAvulsoRouteOverviewRow[];
}> {
  const includeBarras = options?.includeBarras ?? true;
  const meta = await fetchManifestMeta(cd);

  let itemsOffset = 0;
  let itemsPages = 0;
  const items: VolumeAvulsoManifestItemRow[] = [];

  while (true) {
    const page = await fetchManifestItemsPage(cd, itemsOffset, MANIFEST_ITEMS_PAGE_SIZE);
    if (!page.length) break;
    items.push(...page);
    itemsPages += 1;
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

  const barras: VolumeAvulsoManifestBarrasRow[] = [];
  if (includeBarras) {
    let barrasOffset = 0;
    let barrasPages = 0;
    while (true) {
      const page = await fetchManifestBarrasPage(cd, barrasOffset, MANIFEST_BARRAS_PAGE_SIZE);
      if (!page.length) break;
      barras.push(...page);
      barrasPages += 1;
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

  return {
    meta,
    items,
    barras,
    routes
  };
}

export async function openVolume(nrVolume: string, cd: number): Promise<VolumeAvulsoVolumeRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_volume_avulso_open_volume", {
    p_nr_volume: nrVolume.trim(),
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao abrir volume.");
  return mapVolume(first);
}

export async function fetchActiveVolume(): Promise<VolumeAvulsoVolumeRow | null> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_volume_avulso_get_active_volume");
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) return null;
  return mapVolume(first);
}

export async function fetchVolumeItems(confId: string): Promise<VolumeAvulsoItemRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data: v2Data, error: v2Error } = await supabase.rpc("rpc_conf_volume_avulso_get_items_v2", {
    p_conf_id: confId
  });
  if (!v2Error) {
    if (!Array.isArray(v2Data)) return [];
    return v2Data.map((row) => mapItem(row as Record<string, unknown>));
  }

  const fallbackNeeded = /rpc_conf_volume_avulso_get_items_v2/i.test(toErrorMessage(v2Error));
  if (!fallbackNeeded) {
    throw new Error(toErrorMessage(v2Error));
  }

  const { data, error } = await supabase.rpc("rpc_conf_volume_avulso_get_items", {
    p_conf_id: confId
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapItem(row as Record<string, unknown>));
}

export async function scanBarcode(confId: string, barras: string, qtd: number): Promise<VolumeAvulsoItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_volume_avulso_scan_barcode", {
    p_conf_id: confId,
    p_barras: normalizeBarcode(barras),
    p_qtd: Math.max(1, Math.trunc(qtd))
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao atualizar item conferido.");
  return mapItem(first);
}

export async function setItemQtd(confId: string, coddv: number, qtdConferida: number): Promise<VolumeAvulsoItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_volume_avulso_set_item_qtd", {
    p_conf_id: confId,
    p_coddv: coddv,
    p_qtd_conferida: Math.max(0, Math.trunc(qtdConferida))
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao salvar quantidade.");
  return mapItem(first);
}

export async function resetItem(confId: string, coddv: number): Promise<VolumeAvulsoItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_volume_avulso_reset_item", {
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

  const { error } = await supabase.rpc("rpc_conf_volume_avulso_sync_snapshot", {
    p_conf_id: confId,
    p_items: payload
  });
  if (error) throw new Error(toErrorMessage(error));
}

export async function finalizeVolume(
  confId: string,
  faltaMotivo: string | null
): Promise<{ status: string; falta_motivo: string | null; finalized_at: string | null }> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_volume_avulso_finalize", {
    p_conf_id: confId,
    p_falta_motivo: faltaMotivo
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao finalizar conferência.");
  return {
    status: String(first.status ?? "em_conferencia"),
    falta_motivo: parseNullableString(first.falta_motivo),
    finalized_at: parseNullableString(first.finalized_at)
  };
}

export async function cancelVolume(confId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_volume_avulso_cancel", {
    p_conf_id: confId
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return first?.cancelled === true;
}

export async function syncPendingVolumeAvulsoVolumes(userId: string): Promise<{
  processed: number;
  synced: number;
  failed: number;
}> {
  const pending = await listPendingLocalVolumes(userId);
  let synced = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      if (row.pending_cancel) {
        if (row.remote_conf_id) {
          await cancelVolume(row.remote_conf_id);
        }
        await removeLocalVolume(row.local_key);
        synced += 1;
        continue;
      }

      if (row.is_read_only) {
        row.pending_snapshot = false;
        row.pending_finalize = false;
        row.pending_cancel = false;
        row.sync_error = null;
        row.last_synced_at = new Date().toISOString();
        await saveLocalVolume(row);
        synced += 1;
        continue;
      }

      let remoteConfId = row.remote_conf_id;

      if (!remoteConfId) {
        const remoteOpen = await openVolume(row.nr_volume, row.cd);
        remoteConfId = remoteOpen.conf_id;
        row.remote_conf_id = remoteConfId;
        row.conf_date = remoteOpen.conf_date || row.conf_date;
        row.status = remoteOpen.status;
        row.is_read_only = remoteOpen.is_read_only;
        row.sync_error = null;
      }

      if (!remoteConfId) {
        throw new Error("Não foi possível resolver o volume remoto.");
      }

      if (!row.is_read_only && row.pending_snapshot) {
        await syncSnapshot(
          remoteConfId,
          row.items.map((item) => ({
            coddv: item.coddv,
            qtd_conferida: Math.max(0, Math.trunc(item.qtd_conferida)),
            barras: item.barras ?? null
          }))
        );
        row.pending_snapshot = false;
      }

      if (!row.is_read_only && row.pending_finalize) {
        const finalized = await finalizeVolume(remoteConfId, row.pending_finalize_reason);
        const status =
          finalized.status === "finalizado_ok" || finalized.status === "finalizado_falta"
            ? finalized.status
            : row.status;
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
