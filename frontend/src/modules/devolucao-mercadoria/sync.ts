import { supabase } from "../../lib/supabase";
import { listPendingLocalVolumes, removeLocalVolume, saveLocalVolume } from "./storage";
import type {
  CdOption,
  DevolucaoMercadoriaItemRow,
  DevolucaoMercadoriaLocalVolume,
  DevolucaoMercadoriaManifestBarrasRow,
  DevolucaoMercadoriaManifestItemRow,
  DevolucaoMercadoriaManifestMeta,
  DevolucaoMercadoriaManifestVolumeRow,
  DevolucaoMercadoriaPartialReopenInfo,
  DevolucaoMercadoriaRouteOverviewRow,
  DevolucaoMercadoriaVolumeRow
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

function mapManifestMeta(raw: Record<string, unknown>): DevolucaoMercadoriaManifestMeta {
  return {
    cd: parseInteger(raw.cd),
    row_count: parseInteger(raw.row_count),
    etiquetas_count: parseInteger(raw.etiquetas_count),
    source_run_id: parseNullableString(raw.source_run_id),
    manifest_hash: String(raw.manifest_hash ?? ""),
    generated_at: String(raw.generated_at ?? new Date().toISOString())
  };
}

function mapManifestItem(raw: Record<string, unknown>): DevolucaoMercadoriaManifestItemRow {
  return {
    ref: String(raw.ref ?? "").trim(),
    nfd: parseIntegerOrNull(raw.nfd),
    chave: parseNullableString(raw.chave),
    motivo: parseNullableString(raw.motivo),
    coddv: parseInteger(raw.coddv),
    descricao: String(raw.descricao ?? "").trim(),
    tipo: (parseNullableString(raw.tipo) ?? "UN").toUpperCase(),
    qtd_esperada: Math.max(parseInteger(raw.qtd_esperada, 0), 0),
    caixa: null,
    pedido: null,
    filial: null,
    filial_nome: null,
    rota: null,
    lotes: null,
    validades: null
  };
}

function mapManifestVolume(raw: Record<string, unknown>): DevolucaoMercadoriaManifestVolumeRow {
  const statusRaw = String(raw.status ?? "").toLowerCase();
  const status =
    statusRaw === "concluido" || statusRaw === "finalizado_ok" || statusRaw === "finalizado_falta"
      ? "concluido"
      : statusRaw === "em_andamento" || statusRaw === "em_conferencia"
        ? "em_andamento"
        : statusRaw === "pendente"
          ? "pendente"
          : null;

  return {
    ref: String(raw.ref ?? "").trim(),
    nfd: parseIntegerOrNull(raw.nfd),
    chave: parseNullableString(raw.chave),
    motivo: parseNullableString(raw.motivo),
    itens_total: Math.max(parseInteger(raw.itens_total), 0),
    qtd_esperada_total: Math.max(parseInteger(raw.qtd_esperada_total), 0),
    status,
    colaborador_nome: parseNullableString(raw.colaborador_nome),
    colaborador_mat: parseNullableString(raw.colaborador_mat),
    status_at: parseNullableString(raw.status_at)
  };
}

function mapManifestBarras(raw: Record<string, unknown>): DevolucaoMercadoriaManifestBarrasRow {
  return {
    barras: normalizeBarcode(String(raw.barras ?? "")),
    coddv: parseInteger(raw.coddv),
    descricao: String(raw.descricao ?? "").trim(),
    updated_at: parseNullableString(raw.updated_at)
  };
}

function mapRouteOverview(raw: Record<string, unknown>): DevolucaoMercadoriaRouteOverviewRow {
  const statusRaw = String(raw.status ?? "pendente").toLowerCase();
  const status =
    statusRaw === "concluido"
      ? "concluido"
      : statusRaw === "em_andamento" || statusRaw === "em_conferencia"
        ? "em_andamento"
        : "pendente";

  return {
    rota: String(raw.rota ?? "SEM ROTA"),
    filial: parseIntegerOrNull(raw.filial),
    filial_nome: String(raw.filial_nome ?? "Devolucao"),
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

function mapVolume(raw: Record<string, unknown>): DevolucaoMercadoriaVolumeRow {
  const statusRaw = String(raw.status ?? "em_conferencia");
  const status = statusRaw === "finalizado_ok" || statusRaw === "finalizado_falta" ? statusRaw : "em_conferencia";
  const confId = String(raw.conf_id ?? "");
  const parsedRef = String(raw.ref ?? "").trim();
  return {
    conf_id: confId,
    conf_date: String(raw.conf_date ?? ""),
    cd: parseInteger(raw.cd),
    conference_kind: raw.conference_kind === "sem_nfd" ? "sem_nfd" : "com_nfd",
    nfd: parseIntegerOrNull(raw.nfd),
    chave: parseNullableString(raw.chave),
    ref: parsedRef || parseNullableString(raw.chave) || parseNullableString(raw.nfd)?.toString() || `SEM-NFD-${confId.slice(0, 8)}`,
    source_motivo: parseNullableString(raw.source_motivo),
    nfo: parseNullableString(raw.nfo),
    motivo_sem_nfd: parseNullableString(raw.motivo_sem_nfd),
    status,
    falta_motivo: parseNullableString(raw.falta_motivo),
    started_by: String(raw.started_by ?? ""),
    started_mat: String(raw.started_mat ?? ""),
    started_nome: String(raw.started_nome ?? ""),
    started_at: String(raw.started_at ?? new Date().toISOString()),
    finalized_at: parseNullableString(raw.finalized_at),
    updated_at: String(raw.updated_at ?? new Date().toISOString()),
    is_read_only: raw.is_read_only === true,
    caixa: null,
    pedido: null,
    filial: null,
    filial_nome: null,
    rota: null
  };
}

function mapItem(raw: Record<string, unknown>): DevolucaoMercadoriaItemRow {
  const tipoRaw = String(raw.divergencia_tipo ?? "correto").toLowerCase();
  const divergencia_tipo = tipoRaw === "falta" || tipoRaw === "sobra" ? tipoRaw : "correto";

  return {
    item_id: String(raw.item_id ?? ""),
    conf_id: String(raw.conf_id ?? ""),
    coddv: parseInteger(raw.coddv),
    barras: parseNullableString(raw.barras),
    descricao: String(raw.descricao ?? "").trim(),
    tipo: (parseNullableString(raw.tipo) ?? "UN").toUpperCase(),
    qtd_esperada: parseInteger(raw.qtd_esperada),
    qtd_conferida: parseInteger(raw.qtd_conferida),
    qtd_manual_total: Math.max(parseInteger(raw.qtd_manual_total), 0),
    qtd_falta: parseInteger(raw.qtd_falta),
    qtd_sobra: parseInteger(raw.qtd_sobra),
    divergencia_tipo,
    lotes: null,
    validades: null,
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

export async function fetchManifestMeta(cd: number): Promise<DevolucaoMercadoriaManifestMeta> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_manifest_meta", { p_cd: cd });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Manifesto de devolução não encontrado.");
  return mapManifestMeta(first);
}

export async function fetchManifestItemsPage(
  cd: number,
  offset: number,
  limit = MANIFEST_ITEMS_PAGE_SIZE
): Promise<DevolucaoMercadoriaManifestItemRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_manifest_items_page", {
    p_cd: cd,
    p_offset: Math.max(offset, 0),
    p_limit: Math.max(1, limit)
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => mapManifestItem(row as Record<string, unknown>))
    .filter((row) => row.ref && row.coddv > 0);
}

export async function fetchManifestVolumes(cd: number): Promise<DevolucaoMercadoriaManifestVolumeRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_manifest_notas", { p_cd: cd });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => mapManifestVolume(row as Record<string, unknown>))
    .filter((row) => row.ref);
}

export async function fetchManifestBarrasPage(
  cd: number,
  offset: number,
  limit = MANIFEST_BARRAS_PAGE_SIZE
): Promise<DevolucaoMercadoriaManifestBarrasRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_manifest_barras_page", {
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

export async function fetchRouteOverview(cd: number): Promise<DevolucaoMercadoriaRouteOverviewRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_route_overview", { p_cd: cd });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapRouteOverview(row as Record<string, unknown>));
}

export async function fetchManifestBundle(
  cd: number,
  onProgress?: (progress: { step: "items" | "barras" | "routes"; rows: number; total: number; percent: number }) => void,
  options?: { includeBarras?: boolean }
): Promise<{
  meta: DevolucaoMercadoriaManifestMeta;
  items: DevolucaoMercadoriaManifestItemRow[];
  barras: DevolucaoMercadoriaManifestBarrasRow[];
  routes: DevolucaoMercadoriaRouteOverviewRow[];
}> {
  const includeBarras = options?.includeBarras ?? true;
  const meta = await fetchManifestMeta(cd);
  const items: DevolucaoMercadoriaManifestItemRow[] = [];
  let itemsOffset = 0;
  while (true) {
    const page = await fetchManifestItemsPage(cd, itemsOffset, MANIFEST_ITEMS_PAGE_SIZE);
    if (!page.length) break;
    items.push(...page);
    itemsOffset += page.length;
    const itemTotal = Math.max(meta.row_count, 0);
    const itemPercent = itemTotal > 0 ? Math.round(Math.min(1, items.length / itemTotal) * 100) : 100;
    onProgress?.({ step: "items", rows: items.length, total: itemTotal, percent: itemPercent });
    if (page.length < MANIFEST_ITEMS_PAGE_SIZE) break;
  }

  const barras: DevolucaoMercadoriaManifestBarrasRow[] = [];
  if (includeBarras) {
    let barrasOffset = 0;
    while (true) {
      const page = await fetchManifestBarrasPage(cd, barrasOffset, MANIFEST_BARRAS_PAGE_SIZE);
      if (!page.length) break;
      barras.push(...page);
      barrasOffset += page.length;
      onProgress?.({ step: "barras", rows: barras.length, total: barras.length, percent: 100 });
      if (page.length < MANIFEST_BARRAS_PAGE_SIZE) break;
    }
  }

  const routes = await fetchRouteOverview(cd);
  onProgress?.({ step: "routes", rows: routes.length, total: routes.length, percent: 100 });
  return { meta, items, barras, routes };
}

export async function openConference(ref: string, cd: number): Promise<DevolucaoMercadoriaVolumeRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_open_conference", {
    p_ref: ref.trim(),
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao abrir devolução.");
  return mapVolume(first);
}

export async function openVolume(ref: string, cd: number): Promise<DevolucaoMercadoriaVolumeRow> {
  return openConference(ref, cd);
}

export async function openWithoutNfd(cd: number): Promise<DevolucaoMercadoriaVolumeRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_open_without_nfd", { p_cd: cd });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao iniciar devolução sem NFD.");
  return mapVolume(first);
}

export async function fetchActiveVolume(): Promise<DevolucaoMercadoriaVolumeRow | null> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_get_active_conference");
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) return null;
  return mapVolume(first);
}

export async function fetchVolumeItems(confId: string): Promise<DevolucaoMercadoriaItemRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_get_items_v2", { p_conf_id: confId });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapItem(row as Record<string, unknown>));
}

export async function scanBarcode(
  confId: string,
  barras: string,
  qtd: number,
  qtdManual = 0
): Promise<DevolucaoMercadoriaItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_scan_barcode", {
    p_conf_id: confId,
    p_barras: normalizeBarcode(barras),
    p_qtd: Math.max(1, Math.trunc(qtd)),
    p_qtd_manual: Math.max(0, Math.trunc(qtdManual))
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao atualizar item conferido.");
  return mapItem(first);
}

export async function setItemQtd(
  confId: string,
  coddv: number,
  qtdConferida: number,
  qtdManualTotal?: number
): Promise<DevolucaoMercadoriaItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_set_item_qtd", {
    p_conf_id: confId,
    p_coddv: coddv,
    p_qtd_conferida: Math.max(0, Math.trunc(qtdConferida)),
    p_qtd_manual_total: typeof qtdManualTotal === "number" ? Math.max(0, Math.trunc(qtdManualTotal)) : null
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao salvar quantidade.");
  return mapItem(first);
}

export async function resetItem(confId: string, coddv: number): Promise<DevolucaoMercadoriaItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_reset_item", {
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
  items: Array<{ coddv: number; qtd_conferida: number; qtd_manual_total?: number; barras?: string | null }>
): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const payload = items.map((item) => ({
    coddv: item.coddv,
    qtd_conferida: Math.max(0, Math.trunc(item.qtd_conferida)),
    qtd_manual_total: Math.max(0, Math.trunc(item.qtd_manual_total ?? 0)),
    barras: item.barras ? normalizeBarcode(item.barras) : null
  }));

  const { error } = await supabase.rpc("rpc_conf_devolucao_sync_snapshot", {
    p_conf_id: confId,
    p_items: payload
  });
  if (error) throw new Error(toErrorMessage(error));
}

export async function finalizeVolume(
  confId: string,
  faltaMotivo: string | null,
  options?: { faltaTotalSemBipagem?: boolean; nfo?: string | null; motivoSemNfd?: string | null }
): Promise<{ status: string; falta_motivo: string | null; finalized_at: string | null }> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_finalize", {
    p_conf_id: confId,
    p_falta_motivo: faltaMotivo,
    p_falta_total_sem_bipagem: options?.faltaTotalSemBipagem === true,
    p_nfo: options?.nfo ?? null,
    p_motivo_sem_nfd: options?.motivoSemNfd ?? null
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
  const { data, error } = await supabase.rpc("rpc_conf_devolucao_cancel", { p_conf_id: confId });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return first?.cancelled === true;
}

export async function fetchPartialReopenInfo(ref: string, _cd?: number): Promise<DevolucaoMercadoriaPartialReopenInfo> {
  return {
    conf_id: "",
    ref: ref.trim(),
    status: "finalizado_falta",
    previous_started_by: null,
    previous_started_mat: null,
    previous_started_nome: null,
    locked_items: 0,
    pending_items: 0,
    can_reopen: false
  };
}

export async function reopenPartialConference(_ref?: string, _cd?: number): Promise<DevolucaoMercadoriaVolumeRow> {
  throw new Error("REABERTURA_NAO_DISPONIVEL");
}

export async function syncPendingDevolucaoMercadoriaVolumes(userId: string): Promise<{
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
        const remoteOpen = row.conference_kind === "sem_nfd"
          ? await openWithoutNfd(row.cd)
          : await openConference(row.ref, row.cd);
        remoteConfId = remoteOpen.conf_id;
        row.remote_conf_id = remoteConfId;
        row.conf_date = remoteOpen.conf_date || row.conf_date;
        row.status = remoteOpen.status;
        row.is_read_only = remoteOpen.is_read_only;
        row.sync_error = null;
      }

      if (needsRemoteConf && !remoteConfId) throw new Error("Não foi possível resolver conferência remota.");

      if (row.pending_snapshot && remoteConfId) {
        await syncSnapshot(
          remoteConfId,
          row.items.map((item) => ({
            coddv: item.coddv,
            qtd_conferida: Math.max(0, Math.trunc(item.qtd_conferida)),
            qtd_manual_total: Math.max(0, Math.trunc(item.qtd_manual_total ?? 0)),
            barras: item.barras ?? null
          }))
        );
        row.pending_snapshot = false;
      }

      if (row.pending_finalize && remoteConfId) {
        const finalized = await finalizeVolume(remoteConfId, row.pending_finalize_reason, {
          faltaTotalSemBipagem: row.pending_finalize_without_scan,
          nfo: row.pending_finalize_nfo,
          motivoSemNfd: row.pending_finalize_motivo_sem_nfd
        });
        const status =
          finalized.status === "finalizado_ok" || finalized.status === "finalizado_falta"
            ? finalized.status
            : row.status;
        row.status = status;
        row.falta_motivo = finalized.falta_motivo;
        row.is_read_only = true;
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
