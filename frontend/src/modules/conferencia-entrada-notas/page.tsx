import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent
} from "react";
import type { IScannerControls } from "@zxing/browser";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import {
  getDbBarrasByBarcode,
  getDbBarrasMeta,
  upsertDbBarrasCacheRow
} from "../../shared/db-barras/storage";
import {
  fetchDbBarrasByBarcodeOnline,
  refreshDbBarrasCacheSmart
} from "../../shared/db-barras/sync";
import { useOnDemandSoftKeyboard } from "../../shared/use-on-demand-soft-keyboard";
import { useScanFeedback } from "../../shared/use-scan-feedback";
import { getModuleByKeyOrThrow } from "../registry";
import {
  buildEntradaNotasVolumeKey,
  cleanupExpiredEntradaNotasVolumes,
  getLocalVolume,
  getManifestItemsByEtiqueta,
  listManifestItemsByCd,
  getManifestMetaLocal,
  getPendingSummary,
  getRouteOverviewLocal,
  getEntradaNotasPreferences,
  listUserLocalVolumes,
  saveLocalVolume,
  saveManifestSnapshot,
  saveRouteOverviewLocal,
  saveEntradaNotasPreferences,
  removeLocalVolume
} from "./storage";
import {
  applyAvulsaScan,
  checkAvulsaConflict,
  fetchAvulsaTargets,
  cancelAvulsaVolume,
  cancelVolumeBatch,
  cancelVolume,
  fetchCdOptions,
  fetchActiveAvulsaVolume,
  fetchActiveVolume,
  fetchAvulsaItems,
  fetchManifestBundle,
  fetchManifestMeta,
  fetchPartialReopenInfo,
  fetchRouteOverview,
  fetchVolumeContributors,
  fetchVolumeItems,
  finalizeAvulsaVolume,
  finalizeVolume,
  lookupSeqNfByBarcode,
  normalizeBarcode,
  openAvulsaVolume,
  openVolumeBatch,
  openVolume,
  reopenPartialConference,
  scanBarcode,
  setItemQtd,
  syncSnapshot,
  resolveAvulsaTargets,
  syncPendingEntradaNotasVolumes
} from "./sync";
import type {
  EntradaNotasBarcodeSeqNfOption,
  EntradaNotasAvulsaTargetOption,
  EntradaNotasAvulsaTargetSummary,
  CdOption,
  EntradaNotasContributor,
  EntradaNotasDivergenciaTipo,
  EntradaNotasItemRow,
  EntradaNotasLocalItem,
  EntradaNotasLocalVolume,
  EntradaNotasManifestItemRow,
  EntradaNotasRouteOverviewRow,
  EntradaNotasVolumeRow,
  EntradaNotasModuleProfile
} from "./types";

interface ConferenciaEntradaNotasPageProps {
  isOnline: boolean;
  profile: EntradaNotasModuleProfile;
}

type EntradaNotasStoreStatus = "pendente" | "em_andamento" | "concluido";
type EntradaNotasRouteStatus = "pendente" | "iniciado" | "concluido";
type BarcodeValidationState = "idle" | "validating" | "valid" | "invalid";

interface EntradaNotasRouteGroup {
  rota: string;
  lojas_total: number;
  lojas_conferidas: number;
  etiquetas_total: number;
  etiquetas_conferidas: number;
  status: EntradaNotasRouteStatus;
  filiais: EntradaNotasRouteOverviewRow[];
  route_blob: string;
  search_blob: string;
}

interface EntradaNotasRouteGroupView extends EntradaNotasRouteGroup {
  visible_filiais: EntradaNotasRouteOverviewRow[];
  force_open: boolean;
}

type RouteBatchGroupSelectionSource = Pick<EntradaNotasRouteGroup, "rota" | "filiais">;

type RouteContributorsState = {
  status: "loading" | "loaded" | "error";
  contributors: EntradaNotasContributor[];
};

type DialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
};

type OfflineBaseState = {
  entrada_ready: boolean;
  barras_ready: boolean;
  stale: boolean;
  entrada_rows: number;
  barras_rows: number;
  entrada_updated_at: string | null;
  barras_updated_at: string | null;
};

type AvulsaPendingScan = {
  barras: string;
  qtd: number;
  coddv: number;
  descricao: string;
  options: EntradaNotasAvulsaTargetOption[];
};

type BarcodeOpenSelection = {
  barras: string;
  descricao: string;
  options: EntradaNotasBarcodeSeqNfOption[];
};

type LastAddedItemMarker = {
  volumeKey: string;
  itemKey: string;
};

const MODULE_DEF = getModuleByKeyOrThrow("conferencia-entrada-notas");
const PREFERRED_SYNC_DELAY_MS = 800;
const OFFLINE_BASE_STALE_MS = 1000 * 60 * 60 * 24;
const SCANNER_INPUT_MAX_INTERVAL_MS = 45;
const SCANNER_INPUT_MIN_BURST_CHARS = 5;
const SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS = 90;
const SCANNER_INPUT_SUBMIT_COOLDOWN_MS = 600;

type ScannerInputTarget = "etiqueta" | "barras";

interface ScannerInputState {
  lastInputAt: number;
  lastLength: number;
  burstChars: number;
  timerId: number | null;
  lastSubmittedValue: string;
  lastSubmittedAt: number;
}

function createScannerInputState(): ScannerInputState {
  return {
    lastInputAt: 0,
    lastLength: 0,
    burstChars: 0,
    timerId: null,
    lastSubmittedValue: "",
    lastSubmittedAt: 0
  };
}

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function todayIsoBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: EntradaNotasModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) {
    return Math.trunc(profile.cd_default);
  }
  return parseCdFromLabel(profile.cd_nome);
}

function parsePositiveInteger(value: string, fallback = 1): number {
  const parsed = Number.parseInt(value.replace(/\D/g, ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(parsed);
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  let bestIso: string | null = null;
  let bestTs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) continue;
    if (parsed > bestTs) {
      bestTs = parsed;
      bestIso = value;
    }
  }
  return bestIso;
}

function buildManifestInfoLine(params: {
  termoRows: number;
  barrasRows: number;
  termoUpdatedAt?: string | null;
  barrasUpdatedAt?: string | null;
  hasEntradaNotasBase: boolean;
}): string {
  const updatedAt = latestTimestamp([params.termoUpdatedAt, params.barrasUpdatedAt]);
  const updatedText = updatedAt ? ` | Atualizada em ${formatDateTime(updatedAt)}` : " | Sem atualização ainda";

  if (params.hasEntradaNotasBase) {
    return `Base local: Entrada de Notas ${params.termoRows} item(ns) | Barras ${params.barrasRows} item(ns)${updatedText}`;
  }

  return `Sem base local da Entrada de Notas. Barras local: ${params.barrasRows} item(ns)${updatedText}`;
}

function isBaseTimestampStale(value: string | null | undefined): boolean {
  if (!value) return true;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed > OFFLINE_BASE_STALE_MS;
}

function buildOfflineBaseState(params: {
  entradaRows: number;
  barrasRows: number;
  entradaUpdatedAt?: string | null;
  barrasUpdatedAt?: string | null;
}): OfflineBaseState {
  const entradaReady = params.entradaRows > 0;
  const barrasReady = params.barrasRows > 0;
  const stale =
    isBaseTimestampStale(params.entradaUpdatedAt)
    || isBaseTimestampStale(params.barrasUpdatedAt);

  return {
    entrada_ready: entradaReady,
    barras_ready: barrasReady,
    stale,
    entrada_rows: Math.max(params.entradaRows, 0),
    barras_rows: Math.max(params.barrasRows, 0),
    entrada_updated_at: params.entradaUpdatedAt ?? null,
    barras_updated_at: params.barrasUpdatedAt ?? null
  };
}

function withDivergencia(item: EntradaNotasLocalItem): {
  item: EntradaNotasLocalItem;
  divergencia: EntradaNotasDivergenciaTipo;
  qtd_falta: number;
  qtd_sobra: number;
} {
  const qtdFalta = Math.max(item.qtd_esperada - item.qtd_conferida, 0);
  const qtdSobra = Math.max(item.qtd_conferida - item.qtd_esperada, 0);
  const divergencia: EntradaNotasDivergenciaTipo = qtdFalta > 0 ? "falta" : qtdSobra > 0 ? "sobra" : "correto";
  return { item, divergencia, qtd_falta: qtdFalta, qtd_sobra: qtdSobra };
}

function itemSort(a: EntradaNotasLocalItem, b: EntradaNotasLocalItem): number {
  const aSeq = a.seq_entrada ?? 0;
  const bSeq = b.seq_entrada ?? 0;
  if (aSeq !== bSeq) return aSeq - bSeq;
  const aNf = a.nf ?? 0;
  const bNf = b.nf ?? 0;
  if (aNf !== bNf) return aNf - bNf;
  const byDesc = a.descricao.localeCompare(b.descricao);
  if (byDesc !== 0) return byDesc;
  return a.coddv - b.coddv;
}

function buildAvulsaItemKey(seqEntrada: number, nf: number, coddv: number): string {
  return `${seqEntrada}/${nf}:${coddv}`;
}

function parseSeqNfFromVolumeLabel(value: string): { seq_entrada: number; nf: number } {
  const parts = value.split(/[^\d]+/).filter(Boolean);
  const seqEntrada = Number.parseInt(parts[0] ?? "", 10);
  const nf = Number.parseInt(parts[1] ?? "", 10);
  return {
    seq_entrada: Number.isFinite(seqEntrada) ? Math.max(seqEntrada, 0) : 0,
    nf: Number.isFinite(nf) ? Math.max(nf, 0) : 0
  };
}

function parseStrictSeqNfInput(value: string): { seq_entrada: number; nf: number; label: string } | null {
  const compact = String(value ?? "").replace(/\s+/g, "");
  if (!compact) return null;
  const matched = /^(\d+)\/(\d+)$/.exec(compact);
  if (!matched) return null;
  const seqEntrada = Number.parseInt(matched[1], 10);
  const nf = Number.parseInt(matched[2], 10);
  if (!Number.isFinite(seqEntrada) || !Number.isFinite(nf) || seqEntrada <= 0 || nf <= 0) {
    return null;
  }
  return {
    seq_entrada: seqEntrada,
    nf,
    label: `${seqEntrada}/${nf}`
  };
}

function buildSeqNfLabelKey(seqEntrada: number | null | undefined, nf: number | null | undefined): string | null {
  if (seqEntrada == null || nf == null) return null;
  if (!Number.isFinite(seqEntrada) || !Number.isFinite(nf)) return null;
  if (seqEntrada <= 0 || nf <= 0) return null;
  return `${seqEntrada}/${nf}`;
}

function formatCollaboratorName(value: {
  nome?: string | null;
  mat?: string | null;
}): string {
  const nome = value.nome?.trim() ?? "";
  const mat = value.mat?.trim() ?? "";
  if (nome && mat) return `${nome} (${mat})`;
  if (nome) return nome;
  if (mat) return `Matrícula ${mat}`;
  return "outro usuário";
}

function formatLockedItemOwner(item: Pick<EntradaNotasLocalItem, "locked_nome" | "locked_mat">): string {
  return formatCollaboratorName({
    nome: item.locked_nome ?? null,
    mat: item.locked_mat ?? null
  });
}

function createLocalVolumeFromRemote(
  profile: EntradaNotasModuleProfile,
  volume: EntradaNotasVolumeRow,
  items: EntradaNotasItemRow[],
  contributors: EntradaNotasVolumeRow["contributors"] = []
): EntradaNotasLocalVolume {
  const confDate = volume.conf_date || todayIsoBrasilia();
  const localKey = buildEntradaNotasVolumeKey(profile.user_id, volume.cd, confDate, volume.nr_volume);
  const parsedFromLabel = parseSeqNfFromVolumeLabel(volume.nr_volume);
  const seqEntrada = volume.seq_entrada ?? parsedFromLabel.seq_entrada;
  const nf = volume.nf ?? parsedFromLabel.nf;
  const transportadora = volume.transportadora ?? volume.rota ?? "SEM TRANSPORTADORA";
  const fornecedor = volume.fornecedor ?? volume.filial_nome ?? "SEM FORNECEDOR";
  const localItems: EntradaNotasLocalItem[] = items.map((item) => ({
    coddv: item.coddv,
    barras: item.barras ?? null,
    descricao: item.descricao,
    qtd_esperada: item.qtd_esperada,
    qtd_conferida: item.qtd_conferida,
    updated_at: item.updated_at,
    seq_entrada: item.seq_entrada ?? null,
    nf: item.nf ?? null,
    target_conf_id: item.target_conf_id ?? null,
    item_key: item.item_key
      ?? (
        (volume.conference_kind === "avulsa" && item.seq_entrada != null && item.nf != null)
          ? buildAvulsaItemKey(item.seq_entrada, item.nf, item.coddv)
          : String(item.coddv)
      ),
    is_locked: item.is_locked === true,
    locked_by: item.locked_by ?? null,
    locked_mat: item.locked_mat ?? null,
    locked_nome: item.locked_nome ?? null
  }));

  return {
    local_key: localKey,
    user_id: profile.user_id,
    conf_date: confDate,
    cd: volume.cd,
    conference_kind: volume.conference_kind ?? "seq_nf",
    seq_entrada: seqEntrada,
    nf,
    transportadora,
    fornecedor,
    nr_volume: volume.nr_volume,
    caixa: volume.caixa,
    pedido: volume.pedido,
    filial: nf > 0 ? nf : volume.filial,
    filial_nome: fornecedor,
    rota: transportadora,
    remote_conf_id: volume.conf_id,
    status: volume.status,
    falta_motivo: null,
    started_by: volume.started_by,
    started_mat: volume.started_mat,
    started_nome: volume.started_nome,
    started_at: volume.started_at,
    finalized_at: volume.finalized_at,
    updated_at: volume.updated_at,
    is_read_only: volume.is_read_only,
    items: localItems.sort(itemSort),
    avulsa_targets: [],
    avulsa_queue: [],
    contributors: [...(contributors ?? [])],
    pending_snapshot: false,
    pending_finalize: false,
    pending_finalize_reason: null,
    pending_cancel: false,
    sync_error: null,
    last_synced_at: new Date().toISOString()
  };
}

function createLocalVolumeFromManifest(
  profile: EntradaNotasModuleProfile,
  cd: number,
  idEtiqueta: string,
  manifestItems: EntradaNotasManifestItemRow[]
): EntradaNotasLocalVolume {
  const nowIso = new Date().toISOString();
  const confDate = todayIsoBrasilia();
  const first = manifestItems[0];
  const parsedFromLabel = parseSeqNfFromVolumeLabel(idEtiqueta);
  const seqEntrada = first?.seq_entrada ?? parsedFromLabel.seq_entrada;
  const nf = first?.nf ?? parsedFromLabel.nf;
  const transportadora = first?.transportadora ?? first?.rota ?? "SEM TRANSPORTADORA";
  const fornecedor = first?.fornecedor ?? first?.filial_nome ?? "SEM FORNECEDOR";
  const localKey = buildEntradaNotasVolumeKey(profile.user_id, cd, confDate, idEtiqueta);
  const items: EntradaNotasLocalItem[] = manifestItems.map((row) => ({
    coddv: row.coddv,
    barras: null,
    descricao: row.descricao,
    qtd_esperada: row.qtd_esperada,
    qtd_conferida: 0,
    updated_at: nowIso
  }));

  return {
    local_key: localKey,
    user_id: profile.user_id,
    conf_date: confDate,
    cd,
    conference_kind: "seq_nf",
    seq_entrada: seqEntrada,
    nf,
    transportadora,
    fornecedor,
    nr_volume: idEtiqueta,
    caixa: first?.caixa ?? null,
    pedido: first?.pedido ?? null,
    filial: nf > 0 ? nf : first?.filial ?? null,
    filial_nome: fornecedor,
    rota: transportadora,
    remote_conf_id: null,
    status: "em_conferencia",
    falta_motivo: null,
    started_by: profile.user_id,
    started_mat: profile.mat || "",
    started_nome: profile.nome || "Usuário",
    started_at: nowIso,
    finalized_at: null,
    updated_at: nowIso,
    is_read_only: false,
    items: items.sort(itemSort),
    contributors: [
      {
        user_id: profile.user_id,
        mat: profile.mat || "",
        nome: profile.nome || "Usuário",
        first_action_at: nowIso,
        last_action_at: nowIso
      }
    ],
    pending_snapshot: true,
    pending_finalize: false,
    pending_finalize_reason: null,
    pending_cancel: false,
    sync_error: null,
    last_synced_at: null
  };
}

function createLocalAvulsaFromManifest(
  profile: EntradaNotasModuleProfile,
  cd: number,
  _manifestItems: EntradaNotasManifestItemRow[]
): EntradaNotasLocalVolume {
  const nowIso = new Date().toISOString();
  const confDate = todayIsoBrasilia();
  const localKey = buildEntradaNotasVolumeKey(profile.user_id, cd, confDate, "AVULSA");
  return {
    local_key: localKey,
    user_id: profile.user_id,
    conf_date: confDate,
    cd,
    conference_kind: "avulsa",
    seq_entrada: 0,
    nf: 0,
    transportadora: "CONFERENCIA AVULSA",
    fornecedor: "GERAL",
    nr_volume: "AVULSA",
    caixa: null,
    pedido: null,
    filial: null,
    filial_nome: "GERAL",
    rota: "CONFERENCIA AVULSA",
    remote_conf_id: null,
    status: "em_conferencia",
    falta_motivo: null,
    started_by: profile.user_id,
    started_mat: profile.mat || "",
    started_nome: profile.nome || "Usuário",
    started_at: nowIso,
    finalized_at: null,
    updated_at: nowIso,
    is_read_only: false,
    items: [],
    avulsa_targets: [],
    avulsa_queue: [],
    contributors: [],
    pending_snapshot: false,
    pending_finalize: false,
    pending_finalize_reason: null,
    pending_cancel: false,
    sync_error: null,
    last_synced_at: null
  };
}

function barcodeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6v12" />
      <path d="M7 6v12" />
      <path d="M10 6v12" />
      <path d="M14 6v12" />
      <path d="M18 6v12" />
      <path d="M20 6v12" />
      <path d="M3 4h18" />
      <path d="M3 20h18" />
    </svg>
  );
}

function cameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h4l1.5-2h5L16 7h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function quantityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 8h12" />
      <path d="M12 4v16" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function refreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function listIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <circle cx="4" cy="6" r="1.2" />
      <circle cx="4" cy="12" r="1.2" />
      <circle cx="4" cy="18" r="1.2" />
    </svg>
  );
}

function closeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function checkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  );
}

function flashIcon(on: boolean) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 2h10l-4 7h5l-9 13 2-9H6z" />
      {!on ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function chevronIcon(open: boolean) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {open ? <path d="M6 14l6-6 6 6" /> : <path d="M6 10l6 6 6-6" />}
    </svg>
  );
}

function normalizeRpcErrorMessage(value: string): string {
  if (value.includes("SEQ_NF_INVALIDO") || value.includes("SEQ_OU_NF_OBRIGATORIO")) {
    return "Seq/NF inválido. Use o formato 123/456.";
  }
  if (value.includes("BARRAS_OBRIGATORIA")) return "Informe o código de barras.";
  if (value.includes("ENTRADA_NAO_ENCONTRADA")) return "Seq/NF não encontrado na base da entrada.";
  if (value.includes("CONFERENCIA_EM_USO")) return "Conferência em uso por outro usuário.";
  if (value.includes("CONFERENCIA_JA_FINALIZADA_OUTRO_USUARIO")) {
    return "Esta conferência já foi finalizada por outro usuário.";
  }
  if (value.includes("CONFERENCIA_FINALIZADA_SEM_PENDENCIA")) {
    return "Esta Seq/NF já foi finalizada e não possui itens pendentes para retomada.";
  }
  if (value.includes("CONFERENCIA_AVULSA_EM_USO")) return "A conferência avulsa está em uso por outro usuário.";
  if (value.includes("CONFERENCIA_AVULSA_JA_FINALIZADA_OUTRO_USUARIO")) {
    return "A conferência avulsa de hoje já foi finalizada por outro usuário.";
  }
  if (value.includes("ITEM_BLOQUEADO_OUTRO_USUARIO")) {
    return "Item bloqueado: este produto já foi conferido por outro usuário.";
  }
  if (value.includes("PRODUTO_FORA_DA_ENTRADA")) return "Produto fora da entrada selecionada.";
  if (value.includes("PRODUTO_FORA_BASE_AVULSA")) return "Produto fora da base de recebimento deste CD.";
  if (value.includes("PRODUTO_NAO_PERTENCE_A_NENHUM_RECEBIMENTO")) {
    return "Produto sem recebimento disponível neste CD.";
  }
  if (value.includes("SEM_SEQ_NF_DISPONIVEL")) return "Produto sem recebimento disponível neste CD.";
  if (value.includes("BARRAS_NAO_ENCONTRADA")) return "Código de barras inválido. Ele não existe na base db_barras.";
  if (value.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Entre novamente.";
  if (value.includes("CD_SEM_ACESSO")) return "Usuário sem acesso ao CD informado.";
  if (value.includes("BASE_AVULSO_VAZIA") || value.includes("BASE_ENTRADA_NOTAS_VAZIA")) {
    return "A base da Entrada de Notas está vazia para este CD.";
  }
  if (value.includes("CONFERENCIA_EM_ABERTO_OUTRA_ENTRADA") || value.includes("CONFERENCIA_EM_ABERTO_OUTRO_VOLUME")) {
    return "Já existe uma conferência em andamento para sua matrícula. Finalize a conferência atual para iniciar outra.";
  }
  if (value.includes("CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA")) {
    return "Esta conferência não existe mais ou já foi finalizada. Inicie uma nova.";
  }
  return value;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function buildRouteSearchBlob(group: {
  rota: string;
  status: EntradaNotasRouteStatus;
  lojas_conferidas: number;
  lojas_total: number;
  etiquetas_conferidas: number;
  etiquetas_total: number;
}): string {
  return normalizeSearchText([
    group.rota,
    routeStatusLabel(group.status),
    `${group.lojas_conferidas}/${group.lojas_total}`,
    `${group.etiquetas_conferidas}/${group.etiquetas_total}`
  ].join(" "));
}

function buildStoreSearchBlob(item: EntradaNotasRouteOverviewRow): string {
  return normalizeSearchText([
    item.filial_nome ?? "",
    item.filial != null ? String(item.filial) : "",
    item.pedidos_seq ?? "",
    item.seq_entrada != null ? String(item.seq_entrada) : "",
    item.nf != null ? String(item.nf) : "",
    `${item.conferidas}/${item.total_etiquetas}`,
    routeStatusLabel(item.status),
    item.colaborador_nome ?? "",
    item.colaborador_mat ?? ""
  ].join(" "));
}

function normalizeStoreStatus(value: string | null | undefined): EntradaNotasStoreStatus {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "concluido" || normalized === "conferido") return "concluido";
  if (normalized === "em_andamento" || normalized === "em_conferencia" || normalized === "iniciado") return "em_andamento";
  return "pendente";
}

function resolveRouteGroupStatus(filiais: EntradaNotasRouteOverviewRow[]): EntradaNotasRouteStatus {
  if (filiais.length === 0) return "pendente";
  const allPendente = filiais.every((item) => normalizeStoreStatus(item.status) === "pendente");
  if (allPendente) return "pendente";
  const allConcluido = filiais.every((item) => normalizeStoreStatus(item.status) === "concluido");
  if (allConcluido) return "concluido";
  return "iniciado";
}

function routeStatusLabel(status: EntradaNotasRouteStatus | EntradaNotasStoreStatus | string): string {
  if (status === "concluido" || status === "conferido") return "Concluído";
  if (status === "em_andamento" || status === "em_conferencia") return "Em andamento";
  if (status === "iniciado") return "Iniciado";
  return "Pendente";
}

function routeStatusClass(status: EntradaNotasRouteStatus | EntradaNotasStoreStatus | string): "correto" | "andamento" | "falta" {
  if (status === "concluido" || status === "conferido") return "correto";
  if (status === "em_andamento" || status === "em_conferencia" || status === "iniciado") return "andamento";
  return "falta";
}

function isBrowserDesktop(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(min-width: 980px)").matches;
}

function searchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.7-3.7" />
    </svg>
  );
}

export default function ConferenciaEntradaNotasPage({ isOnline, profile }: ConferenciaEntradaNotasPageProps) {
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerTrackRef = useRef<MediaStreamTrack | null>(null);
  const scannerTorchModeRef = useRef<"none" | "controls" | "track">("none");
  const etiquetaRef = useRef<HTMLInputElement | null>(null);
  const barrasRef = useRef<HTMLInputElement | null>(null);
  const scannerInputStateRef = useRef<Record<ScannerInputTarget, ScannerInputState>>({
    etiqueta: createScannerInputState(),
    barras: createScannerInputState()
  });
  const resolveScanFeedbackAnchor = useCallback(() => barrasRef.current, []);
  const {
    scanFeedback,
    scanFeedbackTop,
    showScanFeedback,
    triggerScanErrorAlert
  } = useScanFeedback(resolveScanFeedbackAnchor);
  const {
    inputMode: barcodeInputMode,
    enableSoftKeyboard: enableBarcodeSoftKeyboard,
    disableSoftKeyboard: disableBarcodeSoftKeyboard
  } = useOnDemandSoftKeyboard("text");
  const activeVolumeRef = useRef<EntradaNotasLocalVolume | null>(null);
  const routeContributorsInFlightRef = useRef<Set<string>>(new Set());
  const routeBatchDispatchingRef = useRef(false);

  const [isDesktop, setIsDesktop] = useState<boolean>(() => isBrowserDesktop());
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [manifestReady, setManifestReady] = useState(false);
  const [manifestInfo, setManifestInfo] = useState<string>("");
  const [offlineBaseState, setOfflineBaseState] = useState<OfflineBaseState>({
    entrada_ready: false,
    barras_ready: false,
    stale: true,
    entrada_rows: 0,
    barras_rows: 0,
    entrada_updated_at: null,
    barras_updated_at: null
  });
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingErrors, setPendingErrors] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [routeRows, setRouteRows] = useState<EntradaNotasRouteOverviewRow[]>([]);

  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [cdAtivo, setCdAtivo] = useState<number | null>(null);

  const [etiquetaInput, setEtiquetaInput] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeValidationState, setBarcodeValidationState] = useState<BarcodeValidationState>("idle");
  const [multiploInput, setMultiploInput] = useState("1");

  const [activeVolume, setActiveVolume] = useState<EntradaNotasLocalVolume | null>(null);
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);
  const [editingItemKey, setEditingItemKey] = useState<string | null>(null);
  const [lastAddedItemMarker, setLastAddedItemMarker] = useState<LastAddedItemMarker | null>(null);
  const [editQtdInput, setEditQtdInput] = useState("0");

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<"etiqueta" | "barras">("barras");
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  const [showRoutesModal, setShowRoutesModal] = useState(false);
  const [routeSearchInput, setRouteSearchInput] = useState("");
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
  const [routeContributorsMap, setRouteContributorsMap] = useState<Record<string, RouteContributorsState>>({});
  const [routeBatchSelectionByGroup, setRouteBatchSelectionByGroup] = useState<Record<string, string[]>>({});
  const [routeBatchQueue, setRouteBatchQueue] = useState<string[]>([]);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const [busyManifest, setBusyManifest] = useState(false);
  const [busyOpenVolume, setBusyOpenVolume] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [busyFinalize, setBusyFinalize] = useState(false);
  const [busyCancel, setBusyCancel] = useState(false);
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [pendingBarcodeOpenSelection, setPendingBarcodeOpenSelection] = useState<BarcodeOpenSelection | null>(null);
  const [pendingAvulsaScan, setPendingAvulsaScan] = useState<AvulsaPendingScan | null>(null);

  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const isGlobalAdmin = useMemo(() => profile.role === "admin" && profile.cd_default == null, [profile]);
  const fixedCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const currentCd = isGlobalAdmin ? cdAtivo : fixedCd;
  const canEditActiveVolume = Boolean(
    activeVolume
    && !activeVolume.is_read_only
    && activeVolume.started_by === profile.user_id
  );
  const hasOpenConference = Boolean(activeVolume && activeVolume.status === "em_conferencia" && !activeVolume.is_read_only);
  const isCombinedRouteMode = Boolean(
    activeVolume
    && activeVolume.conference_kind === "avulsa"
    && (activeVolume.combined_seq_nf_labels?.length ?? 0) > 0
  );

  const combinedSeqNfLabels = useMemo(() => {
    if (!activeVolume) return [] as string[];
    return activeVolume.combined_seq_nf_labels ?? [];
  }, [activeVolume]);

  const combinedSeqConfIdByLabel = useMemo(() => {
    const map: Record<string, string> = {};
    const confRows = activeVolume?.combined_seq_conf_ids ?? [];
    for (const row of confRows) {
      const key = buildSeqNfLabelKey(row.seq_entrada, row.nf);
      if (!key) continue;
      const confId = String(row.conf_id ?? "").trim();
      if (!confId) continue;
      map[key] = confId;
    }
    return map;
  }, [activeVolume?.combined_seq_conf_ids]);

  const combinedItemBreakdownByCoddv = useMemo(() => {
    const map: Record<number, Array<{
      seq_entrada: number;
      nf: number;
      qtd_esperada: number;
      qtd_conferida: number;
    }>> = {};
    const allocations = activeVolume?.combined_seq_allocations ?? [];
    for (const row of allocations) {
      if (!map[row.coddv]) map[row.coddv] = [];
      map[row.coddv].push({
        seq_entrada: row.seq_entrada,
        nf: row.nf,
        qtd_esperada: row.qtd_esperada,
        qtd_conferida: row.qtd_conferida
      });
    }
    for (const coddv of Object.keys(map)) {
      map[Number(coddv)].sort((a, b) => {
        if (a.seq_entrada !== b.seq_entrada) return a.seq_entrada - b.seq_entrada;
        return a.nf - b.nf;
      });
    }
    return map;
  }, [activeVolume?.combined_seq_allocations]);

  useEffect(() => {
    activeVolumeRef.current = activeVolume;
  }, [activeVolume]);

  const cameraSupported = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }, []);
  const barcodeIconClassName = `field-icon validation-status${barcodeValidationState === "validating" ? " is-validating" : ""}${barcodeValidationState === "valid" ? " is-valid" : ""}${barcodeValidationState === "invalid" ? " is-invalid" : ""}`;

  const groupedItems = useMemo(() => {
    const empty = {
      falta: [] as Array<ReturnType<typeof withDivergencia>>,
      sobra: [] as Array<ReturnType<typeof withDivergencia>>,
      correto: [] as Array<ReturnType<typeof withDivergencia>>
    };
    if (!activeVolume) return empty;

    const mapped = activeVolume.items.map((item) => withDivergencia(item));
    for (const row of mapped) {
      if (row.divergencia === "falta") empty.falta.push(row);
      else if (row.divergencia === "sobra") empty.sobra.push(row);
      else empty.correto.push(row);
    }

    const sorter = (a: ReturnType<typeof withDivergencia>, b: ReturnType<typeof withDivergencia>) =>
      itemSort(a.item, b.item);
    empty.falta.sort(sorter);
    empty.sobra.sort(sorter);
    empty.correto.sort(sorter);

    return empty;
  }, [activeVolume]);

  const activeLastAddedItemKey = useMemo(() => {
    if (!activeVolume || !lastAddedItemMarker) return null;
    if (lastAddedItemMarker.volumeKey !== activeVolume.local_key) return null;
    return lastAddedItemMarker.itemKey;
  }, [activeVolume, lastAddedItemMarker]);

  const divergenciaTotals = useMemo(() => {
    if (!activeVolume) {
      return { falta: 0, sobra: 0, correto: 0 };
    }
    return {
      falta: groupedItems.falta.length,
      sobra: groupedItems.sobra.length,
      correto: groupedItems.correto.length
    };
  }, [activeVolume, groupedItems]);

  const hasAnyItemInformed = useMemo(() => (
    Boolean(activeVolume?.items.some((item) => item.qtd_conferida > 0))
  ), [activeVolume]);

  const hasOtherUserContributors = useMemo(() => (
    Boolean(activeVolume?.contributors?.some((contributor) => contributor.user_id !== profile.user_id))
  ), [activeVolume?.contributors, profile.user_id]);

  const hasItemsLockedByOtherUser = useMemo(() => (
    Boolean(activeVolume?.items.some((item) => (
      item.qtd_conferida > 0
      && item.locked_by != null
      && item.locked_by !== profile.user_id
    )))
  ), [activeVolume?.items, profile.user_id]);

  const hasInformedItemsFromPreviousSession = useMemo(() => {
    if (!activeVolume || activeVolume.conference_kind !== "seq_nf") return false;
    const startedAtMs = Date.parse(activeVolume.started_at ?? "");
    if (!Number.isFinite(startedAtMs)) return false;
    return activeVolume.items.some((item) => {
      if (item.qtd_conferida <= 0) return false;
      const itemUpdatedMs = Date.parse(item.updated_at ?? "");
      if (!Number.isFinite(itemUpdatedMs)) return false;
      return itemUpdatedMs < startedAtMs;
    });
  }, [activeVolume]);

  const shouldProtectPartialResumeOnCancel = useMemo(() => (
    Boolean(
      activeVolume
      && activeVolume.conference_kind === "seq_nf"
      && activeVolume.status === "em_conferencia"
      && hasAnyItemInformed
      && (
        hasItemsLockedByOtherUser
        || hasOtherUserContributors
        || hasInformedItemsFromPreviousSession
      )
    )
  ), [
    activeVolume,
    hasAnyItemInformed,
    hasItemsLockedByOtherUser,
    hasOtherUserContributors,
    hasInformedItemsFromPreviousSession
  ]);

  const activeContributorsLabel = useMemo(() => {
    const contributors = activeVolume?.contributors ?? [];
    if (!contributors.length) return "";
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const contributor of contributors) {
      const label = formatCollaboratorName({
        nome: contributor.nome,
        mat: contributor.mat
      });
      const normalized = label.toLocaleLowerCase("pt-BR");
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      labels.push(label);
    }
    return labels.join(", ");
  }, [activeVolume?.contributors]);

  const hasMultipleActiveContributors = useMemo(() => {
    const contributors = activeVolume?.contributors ?? [];
    const unique = new Set<string>();
    for (const contributor of contributors) {
      const key = contributor.user_id || `${contributor.mat}|${contributor.nome}`;
      if (key) unique.add(key);
    }
    return unique.size > 1;
  }, [activeVolume?.contributors]);

  const renderCombinedBreakdown = useCallback((item: EntradaNotasLocalItem) => {
    if (!isCombinedRouteMode) return null;
    const breakdown = combinedItemBreakdownByCoddv[item.coddv] ?? [];
    if (!breakdown.length) return null;
    return (
      <div className="entrada-notas-combined-breakdown">
        <p>Distribuição por Seq/NF:</p>
        {breakdown.map((row) => (
          <p key={`${item.coddv}:${row.seq_entrada}/${row.nf}`}>
            Seq/NF {row.seq_entrada}/{row.nf}
            {" | "}
            Esperada {row.qtd_esperada}
            {" | "}
            Conferida {row.qtd_conferida}
            {" | "}
            Pendente {Math.max(row.qtd_esperada - row.qtd_conferida, 0)}
          </p>
        ))}
      </div>
    );
  }, [combinedItemBreakdownByCoddv, isCombinedRouteMode]);

  const offlineBaseBadge = useMemo(() => {
    const overall = offlineBaseState.entrada_ready && offlineBaseState.barras_ready
      ? (offlineBaseState.stale ? "desatualizado" : "completo")
      : (offlineBaseState.entrada_ready || offlineBaseState.barras_ready ? "parcial" : "parcial");
    return {
      overall,
      overallLabel:
        overall === "completo"
          ? "Completo"
          : overall === "desatualizado"
            ? "Desatualizado"
            : "Parcial"
    } as const;
  }, [offlineBaseState]);

  const routeGroups = useMemo<EntradaNotasRouteGroup[]>(() => {
    if (routeRows.length === 0) return [];

    const grouped = new Map<string, Omit<EntradaNotasRouteGroup, "search_blob" | "route_blob">>();

    for (const row of routeRows) {
      const rota = (row.rota || "SEM ROTA").trim() || "SEM ROTA";
      const lojaStatus = normalizeStoreStatus(row.status);
      const current = grouped.get(rota);

      if (!current) {
        grouped.set(rota, {
          rota,
          lojas_total: 1,
          lojas_conferidas: lojaStatus === "concluido" ? 1 : 0,
          etiquetas_total: row.total_etiquetas,
          etiquetas_conferidas: row.conferidas,
          status: lojaStatus === "concluido" ? "concluido" : lojaStatus === "pendente" ? "pendente" : "iniciado",
          filiais: [row]
        });
        continue;
      }

      current.lojas_total += 1;
      current.lojas_conferidas += lojaStatus === "concluido" ? 1 : 0;
      current.etiquetas_total += row.total_etiquetas;
      current.etiquetas_conferidas += row.conferidas;
      current.filiais.push(row);
    }

    return Array.from(grouped.values())
      .map((group) => {
        const filiaisOrdenadas = [...group.filiais].sort((a, b) => {
          const byFilial = (a.filial ?? Number.MAX_SAFE_INTEGER) - (b.filial ?? Number.MAX_SAFE_INTEGER);
          if (byFilial !== 0) return byFilial;
          return (a.filial_nome ?? "").localeCompare(b.filial_nome ?? "", "pt-BR");
        });

        const routeStatus = resolveRouteGroupStatus(filiaisOrdenadas);
        const routeBlob = buildRouteSearchBlob({
          rota: group.rota,
          status: routeStatus,
          lojas_conferidas: group.lojas_conferidas,
          lojas_total: group.lojas_total,
          etiquetas_conferidas: group.etiquetas_conferidas,
          etiquetas_total: group.etiquetas_total
        });

        const searchBlob = normalizeSearchText([
          routeBlob,
          ...filiaisOrdenadas.map((item) => buildStoreSearchBlob(item))
        ].join(" "));

        return {
          ...group,
          status: routeStatus,
          filiais: filiaisOrdenadas,
          route_blob: routeBlob,
          search_blob: searchBlob
        };
      })
      .sort((a, b) => a.rota.localeCompare(b.rota, "pt-BR"));
  }, [routeRows]);

  const filteredRouteGroups = useMemo<EntradaNotasRouteGroupView[]>(() => {
    const query = normalizeSearchText(routeSearchInput);
    if (!query) {
      return routeGroups.map((group) => ({
        ...group,
        visible_filiais: group.filiais,
        force_open: false
      }));
    }

    const mapped: Array<EntradaNotasRouteGroupView | null> = routeGroups.map((group) => {
      const routeMatches = group.route_blob.includes(query);
      const matchedFiliais = group.filiais.filter((item) => buildStoreSearchBlob(item).includes(query));
      if (!routeMatches && matchedFiliais.length === 0) return null;

      return {
        ...group,
        visible_filiais: routeMatches ? group.filiais : matchedFiliais,
        force_open: true
      };
    });

    return mapped.filter((group): group is EntradaNotasRouteGroupView => group !== null);
  }, [routeGroups, routeSearchInput]);

  const isRouteRowSelectableForBatch = useCallback((row: EntradaNotasRouteOverviewRow) => {
    if (!buildSeqNfLabelKey(row.seq_entrada, row.nf)) return false;
    if (normalizeStoreStatus(row.status) === "concluido") return false;
    return true;
  }, []);

  const getRouteBatchSelectableLabels = useCallback((group: RouteBatchGroupSelectionSource): string[] => {
    const labels: string[] = [];
    const seen = new Set<string>();

    for (const row of group.filiais) {
      const seqNfLabel = buildSeqNfLabelKey(row.seq_entrada, row.nf);
      if (!seqNfLabel) continue;
      if (!isRouteRowSelectableForBatch(row)) continue;
      if (seen.has(seqNfLabel)) continue;
      seen.add(seqNfLabel);
      labels.push(seqNfLabel);
    }

    return labels;
  }, [isRouteRowSelectableForBatch]);

  const toggleRouteBatchSelection = useCallback((groupRota: string, seqNfLabel: string, checked: boolean) => {
    setRouteBatchSelectionByGroup((current) => {
      const currentLabels = current[groupRota] ?? [];
      const alreadySelected = currentLabels.includes(seqNfLabel);
      if (checked && alreadySelected) return current;
      if (!checked && !alreadySelected) return current;

      const nextLabels = checked
        ? [...currentLabels, seqNfLabel]
        : currentLabels.filter((value) => value !== seqNfLabel);

      if (nextLabels.length === 0) {
        if (!(groupRota in current)) return current;
        const next = { ...current };
        delete next[groupRota];
        return next;
      }

      return {
        ...current,
        [groupRota]: nextLabels
      };
    });
  }, []);

  const setAllRouteBatchSelection = useCallback((group: RouteBatchGroupSelectionSource, checked: boolean) => {
    const selectable = getRouteBatchSelectableLabels(group);
    setRouteBatchSelectionByGroup((current) => {
      if (!checked || selectable.length === 0) {
        if (!(group.rota in current)) return current;
        const next = { ...current };
        delete next[group.rota];
        return next;
      }

      return {
        ...current,
        [group.rota]: selectable
      };
    });
  }, [getRouteBatchSelectableLabels]);

  const openCombinedRouteConference = useCallback(async (
    group: RouteBatchGroupSelectionSource,
    seqNfLabels: string[]
  ) => {
    if (currentCd == null) {
      setErrorMessage("CD não definido para esta conferência.");
      return;
    }
    if (hasOpenConference) {
      setShowRoutesModal(false);
      setErrorMessage("Existe uma conferência em andamento. Finalize a conferência atual antes de iniciar outra.");
      return;
    }

    const parsedLabels = seqNfLabels
      .map((value) => parseStrictSeqNfInput(value))
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .map((value) => value.label);
    const normalizedLabels = [...new Set(parsedLabels)];

    setBusyOpenVolume(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      if (!isOnline) {
        throw new Error("A conferência conjunta precisa ser iniciada online para abrir todos os Seq/NF em conferência.");
      }

      let manifestItems = await listManifestItemsByCd(profile.user_id, currentCd);
      if (!manifestItems.length) {
        const remoteBundle = await fetchManifestBundle(currentCd, undefined, { includeBarras: false });
        manifestItems = remoteBundle.items;
      }
      if (!manifestItems.length) {
        throw new Error("BASE_ENTRADA_NOTAS_VAZIA");
      }

      const labelSet = new Set(normalizedLabels);
      const parsedTargets = normalizedLabels
        .map((value) => parseStrictSeqNfInput(value))
        .filter((value): value is NonNullable<typeof value> => value !== null)
        .map((value) => ({ seq_entrada: value.seq_entrada, nf: value.nf }));
      const openedVolumes = await openVolumeBatch(parsedTargets, currentCd);
      const combinedSeqConfIds = openedVolumes
        .map((volume) => {
          const seq = volume.seq_entrada ?? null;
          const nf = volume.nf ?? null;
          const confId = String(volume.conf_id ?? "").trim();
          if (seq == null || nf == null || !confId) return null;
          return {
            seq_entrada: seq,
            nf,
            conf_id: confId
          };
        })
        .filter((row): row is { seq_entrada: number; nf: number; conf_id: string } => row !== null);
      const openedLabels = new Set(
        combinedSeqConfIds
          .map((row) => buildSeqNfLabelKey(row.seq_entrada, row.nf))
          .filter((value): value is string => Boolean(value))
      );
      if (openedLabels.size !== normalizedLabels.length) {
        throw new Error("Não foi possível abrir todos os Seq/NF selecionados em modo conferência.");
      }

      const allocationByKey = new Map<string, {
        coddv: number;
        descricao: string;
        barras: string | null;
        seq_entrada: number;
        nf: number;
        qtd_esperada: number;
        qtd_conferida: number;
      }>();
      const itemByCoddv = new Map<number, EntradaNotasLocalItem>();
      const nowIso = new Date().toISOString();

      for (const row of manifestItems) {
        const seq = Number.parseInt(String(row.seq_entrada ?? 0), 10);
        const nf = Number.parseInt(String(row.nf ?? 0), 10);
        const seqLabel = buildSeqNfLabelKey(seq, nf);
        if (!seqLabel || !labelSet.has(seqLabel)) continue;

        const coddv = Number.parseInt(String(row.coddv ?? 0), 10);
        if (!Number.isFinite(coddv) || coddv <= 0) continue;
        const qtdEsperada = Math.max(Number.parseInt(String(row.qtd_esperada ?? 0), 10) || 0, 0);
        if (qtdEsperada <= 0) continue;

        const allocationKey = buildAvulsaItemKey(seq, nf, coddv);
        const currentAllocation = allocationByKey.get(allocationKey);
        if (!currentAllocation) {
          allocationByKey.set(allocationKey, {
            coddv,
            descricao: row.descricao?.trim() || `Produto ${coddv}`,
            barras: null,
            seq_entrada: seq,
            nf,
            qtd_esperada: qtdEsperada,
            qtd_conferida: 0
          });
        } else {
          currentAllocation.qtd_esperada += qtdEsperada;
        }

        const currentItem = itemByCoddv.get(coddv);
        if (!currentItem) {
          itemByCoddv.set(coddv, {
            coddv,
            barras: null,
            descricao: row.descricao?.trim() || `Produto ${coddv}`,
            qtd_esperada: qtdEsperada,
            qtd_conferida: 0,
            updated_at: nowIso,
            item_key: `multi:${coddv}`
          });
        } else {
          currentItem.qtd_esperada += qtdEsperada;
        }
      }

      if (itemByCoddv.size === 0 || allocationByKey.size === 0) {
        throw new Error("Não foi possível montar a conferência conjunta para as Seq/NF selecionadas.");
      }

      const labelOrder = new Map(normalizedLabels.map((label, index) => [label, index]));
      const allocations = [...allocationByKey.values()].sort((a, b) => {
        const aLabel = `${a.seq_entrada}/${a.nf}`;
        const bLabel = `${b.seq_entrada}/${b.nf}`;
        const byOrder = (labelOrder.get(aLabel) ?? Number.MAX_SAFE_INTEGER) - (labelOrder.get(bLabel) ?? Number.MAX_SAFE_INTEGER);
        if (byOrder !== 0) return byOrder;
        return a.coddv - b.coddv;
      });
      const items = [...itemByCoddv.values()].sort((a, b) => {
        const byDescricao = a.descricao.localeCompare(b.descricao, "pt-BR");
        if (byDescricao !== 0) return byDescricao;
        return a.coddv - b.coddv;
      });
      const fornecedores = [...new Set(
        group.filiais
          .map((row) => row.filial_nome?.trim() || row.fornecedor?.trim() || "")
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b, "pt-BR"));
      const fornecedorLabel = fornecedores.join(", ");
      const confDate = todayIsoBrasilia();
      const volumeId = `ROTA:${group.rota}`;
      const localVolume: EntradaNotasLocalVolume = {
        local_key: buildEntradaNotasVolumeKey(profile.user_id, currentCd, confDate, volumeId),
        user_id: profile.user_id,
        conf_date: confDate,
        cd: currentCd,
        conference_kind: "avulsa",
        seq_entrada: 0,
        nf: 0,
        transportadora: group.rota,
        fornecedor: fornecedorLabel || "MÚLTIPLOS",
        nr_volume: `ROTA ${group.rota}`,
        caixa: null,
        pedido: null,
        filial: null,
        filial_nome: fornecedorLabel || "MÚLTIPLOS",
        rota: group.rota,
        remote_conf_id: null,
        status: "em_conferencia",
        falta_motivo: null,
        started_by: profile.user_id,
        started_mat: profile.mat || "",
        started_nome: profile.nome || "Usuário",
        started_at: nowIso,
        finalized_at: null,
        updated_at: nowIso,
        is_read_only: false,
        items,
        avulsa_targets: [],
        avulsa_queue: [],
        combined_seq_nf_labels: normalizedLabels,
        combined_seq_transportadora: group.rota,
        combined_seq_conf_ids: combinedSeqConfIds,
        combined_seq_allocations: allocations,
        contributors: [{
          user_id: profile.user_id,
          mat: profile.mat || "",
          nome: profile.nome || "Usuário",
          first_action_at: nowIso,
          last_action_at: nowIso
        }],
        pending_snapshot: false,
        pending_finalize: false,
        pending_finalize_reason: null,
        pending_cancel: false,
        sync_error: null,
        last_synced_at: null
      };

      await saveLocalVolume(localVolume);
      activeVolumeRef.current = localVolume;
      setActiveVolume(localVolume);
      setEtiquetaInput(localVolume.nr_volume);
      setExpandedItemKey(null);
      setEditingItemKey(null);
      setEditQtdInput("0");
      setPendingAvulsaScan(null);
      setPendingBarcodeOpenSelection(null);
      setShowRoutesModal(false);
      setStatusMessage(`Conferência conjunta iniciada para ${normalizedLabels.length} Seq/NF da transportadora ${group.rota}.`);
      disableBarcodeSoftKeyboard();
      window.requestAnimationFrame(() => {
        barrasRef.current?.focus();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao iniciar conferência conjunta.";
      if (message.includes("CONFERENCIA_EM_ABERTO_OUTRO_VOLUME") || message.includes("CONFERENCIA_EM_ABERTO_OUTRA_ENTRADA")) {
        setShowRoutesModal(false);
      }
      setErrorMessage(normalizeRpcErrorMessage(message));
    } finally {
      setBusyOpenVolume(false);
    }
  }, [
    currentCd,
    disableBarcodeSoftKeyboard,
    fetchManifestBundle,
    isOnline,
    hasOpenConference,
    listManifestItemsByCd,
    openVolumeBatch,
    profile
  ]);

  const startRouteBatchByGroup = useCallback((group: RouteBatchGroupSelectionSource) => {
    const selectable = getRouteBatchSelectableLabels(group);
    const selected = routeBatchSelectionByGroup[group.rota] ?? [];
    const selectedSet = new Set(selected);
    const picked = selectable.filter((seqNfLabel) => selectedSet.has(seqNfLabel));

    if (picked.length === 0) {
      setErrorMessage("Selecione pelo menos uma Seq/NF válida para iniciar a conferência em lote.");
      return;
    }

    if (hasOpenConference) {
      setShowRoutesModal(false);
      setErrorMessage("Existe uma conferência em andamento. Finalize a conferência atual para iniciar o lote.");
      return;
    }

    if (picked.length === 1) {
      setShowRoutesModal(false);
      setErrorMessage(null);
      setRouteBatchSelectionByGroup((current) => {
        if (!(group.rota in current)) return current;
        const next = { ...current };
        delete next[group.rota];
        return next;
      });
      void openVolumeFromEtiqueta(picked[0]);
      return;
    }

    setErrorMessage(null);
    setShowRoutesModal(false);
    void openCombinedRouteConference(group, picked);
    setRouteBatchSelectionByGroup((current) => {
      if (!(group.rota in current)) return current;
      const next = { ...current };
      delete next[group.rota];
      return next;
    });
  }, [
    getRouteBatchSelectableLabels,
    hasOpenConference,
    openCombinedRouteConference,
    routeBatchSelectionByGroup
  ]);

  const focusBarras = useCallback(() => {
    disableBarcodeSoftKeyboard();
    window.requestAnimationFrame(() => {
      barrasRef.current?.focus();
    });
  }, [disableBarcodeSoftKeyboard]);

  const showDialog = useCallback((payload: DialogState) => {
    setDialogState(payload);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogState(null);
  }, []);

  const fetchSeqNfContributors = useCallback(async (volume: EntradaNotasVolumeRow): Promise<EntradaNotasContributor[]> => {
    if (volume.conference_kind === "avulsa") return [];
    try {
      return await fetchVolumeContributors(volume.conf_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      if (message.includes("rpc_conf_entrada_notas_get_contributors")) {
        return [];
      }
      throw error;
    }
  }, []);

  const ensureRouteRowContributors = useCallback(async (row: EntradaNotasRouteOverviewRow) => {
    if (!isOnline || currentCd == null) return;
    const seqNfKey = buildSeqNfLabelKey(row.seq_entrada, row.nf);
    if (!seqNfKey) return;

    const inFlight = routeContributorsInFlightRef.current;
    if (inFlight.has(seqNfKey)) return;

    let shouldFetch = true;
    setRouteContributorsMap((current) => {
      const existing = current[seqNfKey];
      if (existing && (existing.status === "loading" || existing.status === "loaded")) {
        shouldFetch = false;
        return current;
      }
      return {
        ...current,
        [seqNfKey]: {
          status: "loading",
          contributors: existing?.contributors ?? []
        }
      };
    });

    if (!shouldFetch) return;
    inFlight.add(seqNfKey);

    try {
      const partialInfo = await fetchPartialReopenInfo(seqNfKey, currentCd);
      const contributors = await fetchVolumeContributors(partialInfo.conf_id);
      setRouteContributorsMap((current) => ({
        ...current,
        [seqNfKey]: {
          status: "loaded",
          contributors
        }
      }));
    } catch {
      setRouteContributorsMap((current) => ({
        ...current,
        [seqNfKey]: {
          status: "error",
          contributors: current[seqNfKey]?.contributors ?? []
        }
      }));
    } finally {
      inFlight.delete(seqNfKey);
    }
  }, [currentCd, isOnline]);

  const fetchSeqNfVolumeSnapshot = useCallback(async (
    nrVolume: string,
    cd: number
  ): Promise<EntradaNotasLocalVolume> => {
    const remoteVolume = await openVolume(nrVolume, cd);
    const [remoteItems, contributors] = await Promise.all([
      fetchVolumeItems(remoteVolume.conf_id),
      fetchSeqNfContributors(remoteVolume)
    ]);
    const localVolume = createLocalVolumeFromRemote(profile, remoteVolume, remoteItems, contributors);
    await saveLocalVolume(localVolume);
    return localVolume;
  }, [fetchSeqNfContributors, profile]);

  const openReadOnlyVolume = useCallback((volume: EntradaNotasLocalVolume) => {
    setActiveVolume(volume);
    setExpandedItemKey(null);
    setEditingItemKey(null);
    setLastAddedItemMarker(null);
    setEditQtdInput("0");
    setStatusMessage("Conferência aberta em modo leitura.");
  }, []);

  const promptPartialReopen = useCallback(async (
    etiqueta: string,
    selectedCd: number,
    options?: { onOpenReadOnly?: () => void }
  ): Promise<boolean> => {
    const reopenInfo = await fetchPartialReopenInfo(etiqueta, selectedCd);
    const reopenedBySameUser = reopenInfo.previous_started_by === profile.user_id;
    if (reopenedBySameUser) {
      showDialog({
        title: "Conferência já finalizada",
        message:
          `A Seq/NF ${etiqueta} já foi finalizada por você hoje.\n\n`
          + `Itens bloqueados: ${reopenInfo.locked_items}\n`
          + `Itens pendentes: ${reopenInfo.pending_items}\n\n`
          + "Escolha como deseja abrir a conferência:",
        confirmLabel: "Reabrir conferência",
        cancelLabel: "Abrir leitura",
        onCancel: () => {
          closeDialog();
          const openReadOnly = options?.onOpenReadOnly;
          if (openReadOnly) {
            openReadOnly();
            return;
          }
          void (async () => {
            setBusyOpenVolume(true);
            setStatusMessage(null);
            setErrorMessage(null);
            try {
              const readOnlyVolume = await fetchSeqNfVolumeSnapshot(etiqueta, selectedCd);
              openReadOnlyVolume(readOnlyVolume);
              setEtiquetaInput(readOnlyVolume.nr_volume);
            } catch (readOnlyError) {
              const readOnlyMessage = readOnlyError instanceof Error
                ? readOnlyError.message
                : "Falha ao abrir conferência em leitura.";
              setErrorMessage(normalizeRpcErrorMessage(readOnlyMessage));
            } finally {
              setBusyOpenVolume(false);
            }
          })();
        },
        onConfirm: () => {
          void (async () => {
            closeDialog();
            setBusyOpenVolume(true);
            setStatusMessage(null);
            setErrorMessage(null);
            try {
              const reopenedVolume = await reopenPartialConference(etiqueta, selectedCd);
              const [reopenedItems, reopenedContributors] = await Promise.all([
                fetchVolumeItems(reopenedVolume.conf_id),
                fetchSeqNfContributors(reopenedVolume)
              ]);
              const reopenedLocalVolume = createLocalVolumeFromRemote(
                profile,
                reopenedVolume,
                reopenedItems,
                reopenedContributors
              );
              await saveLocalVolume(reopenedLocalVolume);
              setActiveVolume(reopenedLocalVolume);
              setEtiquetaInput(reopenedLocalVolume.nr_volume);
              setExpandedItemKey(null);
              setEditingItemKey(null);
              setEditQtdInput("0");
              setStatusMessage("Conferência reaberta. Você pode editar todos os itens novamente.");
              focusBarras();
            } catch (reopenError) {
              const reopenMessage = reopenError instanceof Error
                ? reopenError.message
                : "Falha ao reabrir conferência.";
              setErrorMessage(normalizeRpcErrorMessage(reopenMessage));
            } finally {
              setBusyOpenVolume(false);
            }
          })();
        }
      });
      return true;
    }

    if (!reopenInfo.can_reopen) {
      return false;
    }

    const previousCollaborator = formatCollaboratorName({
      nome: reopenInfo.previous_started_nome,
      mat: reopenInfo.previous_started_mat
    });

    showDialog({
      title: "Conferência parcialmente finalizada",
      message:
        `A Seq/NF ${etiqueta} foi finalizada em parte por ${reopenedBySameUser ? "você" : previousCollaborator}.\n\n`
        + `Itens bloqueados: ${reopenInfo.locked_items}\n`
        + `Itens pendentes: ${reopenInfo.pending_items}\n\n`
        + "Os itens já conferidos não podem ser alterados. Deseja reabrir para concluir os pendentes?",
      confirmLabel: "Reabrir conferência",
      cancelLabel: "Cancelar",
      onConfirm: () => {
        void (async () => {
          closeDialog();
          setBusyOpenVolume(true);
          setStatusMessage(null);
          setErrorMessage(null);
          try {
            const reopenedVolume = await reopenPartialConference(etiqueta, selectedCd);
            const [reopenedItems, reopenedContributors] = await Promise.all([
              fetchVolumeItems(reopenedVolume.conf_id),
              fetchSeqNfContributors(reopenedVolume)
            ]);
            const reopenedLocalVolume = createLocalVolumeFromRemote(
              profile,
              reopenedVolume,
              reopenedItems,
              reopenedContributors
            );
            await saveLocalVolume(reopenedLocalVolume);
            setActiveVolume(reopenedLocalVolume);
            setEtiquetaInput(reopenedLocalVolume.nr_volume);
            setExpandedItemKey(null);
            setEditingItemKey(null);
            setEditQtdInput("0");
            setStatusMessage("Conferência retomada. Itens já conferidos por outro usuário permanecem bloqueados.");
            focusBarras();
          } catch (reopenError) {
            const reopenMessage = reopenError instanceof Error
              ? reopenError.message
              : "Falha ao reabrir conferência parcial.";
            setErrorMessage(normalizeRpcErrorMessage(reopenMessage));
          } finally {
            setBusyOpenVolume(false);
          }
        })();
      }
    });

    return true;
  }, [
    closeDialog,
    fetchSeqNfVolumeSnapshot,
    fetchSeqNfContributors,
    focusBarras,
    openReadOnlyVolume,
    profile,
    showDialog
  ]);

  const refreshPendingState = useCallback(async () => {
    const pending = await getPendingSummary(profile.user_id);
    setPendingCount(pending.pending_count);
    setPendingErrors(pending.errors_count);
  }, [profile.user_id]);

  const persistPreferences = useCallback(async (next: {
    prefer_offline_mode?: boolean;
    multiplo_padrao?: number;
    cd_ativo?: number | null;
  }) => {
    const current = await getEntradaNotasPreferences(profile.user_id);
    await saveEntradaNotasPreferences(profile.user_id, {
      prefer_offline_mode: next.prefer_offline_mode ?? current.prefer_offline_mode,
      multiplo_padrao: next.multiplo_padrao ?? current.multiplo_padrao,
      cd_ativo: next.cd_ativo ?? current.cd_ativo
    });
  }, [profile.user_id]);

  const resolveScannerTrack = useCallback((): MediaStreamTrack | null => {
    const videoEl = scannerVideoRef.current;
    if (videoEl?.srcObject instanceof MediaStream) {
      const [track] = videoEl.srcObject.getVideoTracks();
      return track ?? null;
    }
    return null;
  }, []);

  const supportsTrackTorch = useCallback((track: MediaStreamTrack | null): boolean => {
    if (!track) return false;
    const trackWithCaps = track as MediaStreamTrack & {
      getCapabilities?: () => MediaTrackCapabilities;
    };
    if (typeof trackWithCaps.getCapabilities !== "function") return false;
    const capabilities = trackWithCaps.getCapabilities();
    return Boolean((capabilities as { torch?: boolean } | null)?.torch);
  }, []);

  const stopScanner = useCallback(() => {
    const controls = scannerControlsRef.current;
    const activeTrack = scannerTrackRef.current ?? resolveScannerTrack();
    if (controls) {
      if (controls.switchTorch && torchEnabled && scannerTorchModeRef.current === "controls") {
        void controls.switchTorch(false).catch(() => {
          // Ignore unsupported torch shutdown.
        });
      }
      controls.stop();
      scannerControlsRef.current = null;
    }

    if (activeTrack && torchEnabled && scannerTorchModeRef.current === "track") {
      const trackWithConstraints = activeTrack as MediaStreamTrack & {
        applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
      };
      if (typeof trackWithConstraints.applyConstraints === "function") {
        void trackWithConstraints
          .applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] })
          .catch(() => {
            // Ignore unsupported torch shutdown.
          });
      }
    }

    const videoEl = scannerVideoRef.current;
    if (videoEl && videoEl.srcObject instanceof MediaStream) {
      for (const track of videoEl.srcObject.getTracks()) {
        track.stop();
      }
      videoEl.srcObject = null;
    }
    scannerTrackRef.current = null;
    scannerTorchModeRef.current = "none";
    setTorchEnabled(false);
    setTorchSupported(false);
  }, [resolveScannerTrack, torchEnabled]);

  const closeScanner = useCallback(() => {
    stopScanner();
    setScannerOpen(false);
    setScannerError(null);
    focusBarras();
  }, [focusBarras, stopScanner]);

  const openScannerFor = useCallback((target: "etiqueta" | "barras") => {
    if (!cameraSupported) {
      setErrorMessage("Câmera não disponível neste dispositivo.");
      return;
    }
    setScannerTarget(target);
    setScannerError(null);
    setScannerOpen(true);
    setTorchEnabled(false);
    setTorchSupported(false);
  }, [cameraSupported]);

  const runPendingSync = useCallback(async (silent = false) => {
    if (!isOnline) return;
    if (busySync) return;
    setBusySync(true);
    if (!silent) {
      setStatusMessage(null);
      setErrorMessage(null);
    }
    try {
      const result = await syncPendingEntradaNotasVolumes(profile.user_id);
      await refreshPendingState();
      if (activeVolume) {
        const refreshed = await getLocalVolume(profile.user_id, activeVolume.cd, activeVolume.conf_date, activeVolume.nr_volume);
        if (refreshed) {
          setActiveVolume(refreshed);
        } else {
          setActiveVolume(null);
          setEtiquetaInput("");
        }
      }
      if (!silent) {
        if (result.failed > 0) {
          setErrorMessage(`${result.failed} pendência(s) da Entrada de Notas falharam na sincronização.`);
        } else if (result.processed > 0) {
          setStatusMessage(`Sincronização concluída (${result.synced} pendência(s) processada(s)).`);
        } else {
          setStatusMessage("Sem pendências de conferência para sincronizar.");
        }
      }
    } catch (error) {
      if (!silent) {
        const message = error instanceof Error ? error.message : "Falha na sincronização.";
        setErrorMessage(normalizeRpcErrorMessage(message));
      }
    } finally {
      setBusySync(false);
    }
  }, [activeVolume, busySync, isOnline, profile.user_id, refreshPendingState]);

  const prepareOfflineManifest = useCallback(async (forceRefresh: boolean, background = false) => {
    if (currentCd == null) throw new Error("Selecione um CD antes de trabalhar offline.");

    setBusyManifest(true);
    setProgressMessage(null);
    if (!background) {
      setErrorMessage(null);
      setStatusMessage(null);
    }

    try {
      const [localMeta, localBarrasMeta] = await Promise.all([
        getManifestMetaLocal(profile.user_id, currentCd),
        getDbBarrasMeta()
      ]);

      if (!isOnline) {
        if (!localMeta || localMeta.row_count <= 0) {
          throw new Error("Sem base local de Entrada de Notas. Conecte-se e sincronize antes de usar offline.");
        }
        if (localBarrasMeta.row_count <= 0) {
          throw new Error("Sem base local de barras. Conecte-se e ative o modo offline para sincronizar.");
        }
        const localRoutes = await getRouteOverviewLocal(profile.user_id, currentCd);
        setRouteRows(localRoutes);
        setManifestReady(true);
        setManifestInfo(
          buildManifestInfoLine({
            termoRows: localMeta.row_count,
            barrasRows: localBarrasMeta.row_count,
            termoUpdatedAt: localMeta.cached_at ?? localMeta.generated_at,
            barrasUpdatedAt: localBarrasMeta.last_sync_at,
            hasEntradaNotasBase: true
          })
        );
        setOfflineBaseState(
          buildOfflineBaseState({
            entradaRows: localMeta.row_count,
            barrasRows: localBarrasMeta.row_count,
            entradaUpdatedAt: localMeta.cached_at ?? localMeta.generated_at,
            barrasUpdatedAt: localBarrasMeta.last_sync_at
          })
        );
        return;
      }

      const remoteMeta = await fetchManifestMeta(currentCd);
      const sameHash = localMeta && localMeta.manifest_hash === remoteMeta.manifest_hash;
      const shouldDownload = forceRefresh || !sameHash || (localMeta?.row_count ?? 0) <= 0;
      let termoRowCount = remoteMeta.row_count;

      if (shouldDownload) {
        const bundle = await fetchManifestBundle(currentCd, (progress) => {
          if (progress.step === "items") {
            if (progress.total > 0) {
              setProgressMessage(
                `Atualizando base de Entrada de Notas... ${progress.percent}% (${progress.rows}/${progress.total})`
              );
              return;
            }
            setProgressMessage(`Atualizando base de Entrada de Notas... ${progress.percent}%`);
            return;
          }
          if (progress.step === "routes") {
            setProgressMessage(`Atualizando transportadoras/fornecedores... ${progress.percent}% (${progress.rows} grupo(s))`);
          }
        }, { includeBarras: false });

        await saveManifestSnapshot({
          user_id: profile.user_id,
          cd: currentCd,
          meta: bundle.meta,
          items: bundle.items,
          barras: [],
          routes: bundle.routes
        });

        setRouteRows(bundle.routes);
        termoRowCount = bundle.meta.row_count;
      } else {
        const routes = await fetchRouteOverview(currentCd);
        await saveRouteOverviewLocal(profile.user_id, currentCd, routes);
        setRouteRows(routes);
      }

      let barrasTotal = localBarrasMeta.row_count;
      if (forceRefresh || localBarrasMeta.row_count <= 0) {
        const barrasSync = await refreshDbBarrasCacheSmart((progress) => {
          if (progress.totalRows > 0) {
            setProgressMessage(
              `Atualizando base de barras... ${progress.percent}% (${progress.rowsFetched}/${progress.totalRows})`
            );
            return;
          }
          setProgressMessage(`Atualizando base de barras... ${progress.percent}%`);
        });
        barrasTotal = barrasSync.total;
      }

      const [metaAfterSync, barrasMetaAfterSync] = await Promise.all([
        getManifestMetaLocal(profile.user_id, currentCd),
        getDbBarrasMeta()
      ]);

      setManifestInfo(
        buildManifestInfoLine({
          termoRows: metaAfterSync?.row_count ?? termoRowCount,
          barrasRows: barrasMetaAfterSync.row_count || barrasTotal,
          termoUpdatedAt: metaAfterSync?.cached_at ?? metaAfterSync?.generated_at ?? remoteMeta.generated_at,
          barrasUpdatedAt: barrasMetaAfterSync.last_sync_at,
          hasEntradaNotasBase: (metaAfterSync?.row_count ?? termoRowCount) > 0
        })
      );

      const nextBaseState = buildOfflineBaseState({
        entradaRows: metaAfterSync?.row_count ?? termoRowCount,
        barrasRows: barrasMetaAfterSync.row_count || barrasTotal,
        entradaUpdatedAt: metaAfterSync?.cached_at ?? metaAfterSync?.generated_at ?? remoteMeta.generated_at,
        barrasUpdatedAt: barrasMetaAfterSync.last_sync_at
      });
      setOfflineBaseState(nextBaseState);
      setManifestReady(nextBaseState.entrada_ready && nextBaseState.barras_ready);
      if (!background) {
        setStatusMessage("Base de Entrada de Notas pronta para trabalho offline.");
      }
    } finally {
      setBusyManifest(false);
      setProgressMessage(null);
    }
  }, [currentCd, isOnline, profile.user_id]);

  const applyVolumeUpdate = useCallback(async (nextVolume: EntradaNotasLocalVolume, focusInput = true) => {
    await saveLocalVolume(nextVolume);
    activeVolumeRef.current = nextVolume;
    setActiveVolume(nextVolume);
    await refreshPendingState();
    if (focusInput) focusBarras();
  }, [focusBarras, refreshPendingState]);

  const resumeRemoteActiveVolume = useCallback(async (
    silent = false,
    options?: { includeAvulsa?: boolean }
  ): Promise<EntradaNotasLocalVolume | null> => {
    if (!isOnline) return null;
    const includeAvulsa = options?.includeAvulsa ?? true;

    const [remoteSeqNf, remoteAvulsa] = await Promise.all([
      fetchActiveVolume(),
      includeAvulsa ? fetchActiveAvulsaVolume() : Promise.resolve(null)
    ]);
    const remoteActive =
      (remoteSeqNf && remoteSeqNf.status === "em_conferencia" ? remoteSeqNf : null)
      ?? (includeAvulsa && remoteAvulsa && remoteAvulsa.status === "em_conferencia" ? remoteAvulsa : null);
    if (!remoteActive) return null;

    if (isGlobalAdmin && cdAtivo !== remoteActive.cd) {
      setCdAtivo(remoteActive.cd);
    }

    const [remoteItems, contributors] = await Promise.all([
      remoteActive.conference_kind === "avulsa"
        ? fetchAvulsaItems(remoteActive.conf_id)
        : fetchVolumeItems(remoteActive.conf_id),
      fetchSeqNfContributors(remoteActive)
    ]);
    const localVolume = createLocalVolumeFromRemote(profile, remoteActive, remoteItems, contributors);
    if (remoteActive.conference_kind === "avulsa") {
      localVolume.avulsa_targets = await fetchAvulsaTargets(remoteActive.conf_id);
    }
    await saveLocalVolume(localVolume);
    setActiveVolume(localVolume);
    setEtiquetaInput(localVolume.nr_volume);

    if (!silent) {
      const label = localVolume.conference_kind === "avulsa"
        ? "Conferência Avulsa"
        : `Seq/NF ${localVolume.nr_volume}`;
      setStatusMessage(`Conferência retomada automaticamente: ${label}.`);
    }

    return localVolume;
  }, [cdAtivo, fetchSeqNfContributors, isGlobalAdmin, isOnline, profile]);

  const openVolumeFromEtiqueta = useCallback(async (rawEtiqueta: string) => {
    const etiqueta = rawEtiqueta.trim();
    if (!etiqueta) {
      setErrorMessage("Informe o Seq/NF para iniciar a conferência.");
      return;
    }
    if (currentCd == null) {
      setErrorMessage("CD não definido para esta conferência.");
      return;
    }
    const selectedCd = currentCd;
    if (hasOpenConference && activeVolume && activeVolume.nr_volume !== etiqueta) {
      setShowRoutesModal(false);
      const activeLabel = activeVolume.conference_kind === "avulsa"
        ? "Conferência Avulsa"
        : `Seq/NF ${activeVolume.nr_volume}`;
      setErrorMessage("Existe uma conferência em andamento para sua matrícula. Finalize a conferência ativa antes de iniciar outra.");
      setStatusMessage(`Conferência ativa: ${activeLabel}.`);
      setEtiquetaInput(activeVolume.nr_volume);
      return;
    }

    setBusyOpenVolume(true);
    setStatusMessage(null);
    setErrorMessage(null);
    let etiquetaFinal = etiqueta;

    try {
      const today = todayIsoBrasilia();
      const waitingOfflineBase = preferOfflineMode && !manifestReady;

      if (preferOfflineMode) {
        if (!manifestReady) {
          if (!isOnline) {
            await prepareOfflineManifest(false);
          } else if (!busyManifest) {
            void prepareOfflineManifest(false, true).catch((error) => {
              const message = error instanceof Error ? error.message : "Falha ao preparar base offline.";
              setErrorMessage(normalizeRpcErrorMessage(message));
            });
          }
        }

        const existingToday = await getLocalVolume(profile.user_id, selectedCd, today, etiqueta);
        if (existingToday) {
          let resolvedExisting = existingToday;
          if (
            isOnline
            && existingToday.conference_kind === "seq_nf"
            && !existingToday.pending_snapshot
            && !existingToday.pending_finalize
            && !existingToday.pending_cancel
          ) {
            resolvedExisting = await fetchSeqNfVolumeSnapshot(existingToday.nr_volume, selectedCd);
            etiquetaFinal = resolvedExisting.nr_volume;
          }

          if (resolvedExisting.status !== "em_conferencia") {
            if (isOnline && resolvedExisting.conference_kind !== "avulsa") {
              try {
                const reopenPrompted = await promptPartialReopen(etiqueta, selectedCd, {
                  onOpenReadOnly: () => {
                    openReadOnlyVolume(resolvedExisting);
                  }
                });
                if (reopenPrompted) return;
              } catch {
                // Em falha de validação de reabertura, mantém opção de leitura.
              }
            }
            showDialog({
              title: "Conferência já finalizada",
              message: "Esta conferência já foi finalizada por você hoje. Deseja abrir em modo leitura?",
              confirmLabel: "Abrir leitura",
              cancelLabel: "Cancelar",
              onConfirm: () => {
                openReadOnlyVolume(resolvedExisting);
                closeDialog();
              }
            });
            return;
          }
          setActiveVolume(resolvedExisting);
          etiquetaFinal = resolvedExisting.nr_volume;
          setExpandedItemKey(null);
          setEditingItemKey(null);
          setEditQtdInput("0");
          setStatusMessage("Conferência retomada do cache local.");
          return;
        }

        if (isOnline) {
          const remoteVolume = await openVolume(etiqueta, selectedCd);
          const [remoteItems, contributors] = await Promise.all([
            fetchVolumeItems(remoteVolume.conf_id),
            fetchSeqNfContributors(remoteVolume)
          ]);
          const localVolume = createLocalVolumeFromRemote(profile, remoteVolume, remoteItems, contributors);
          await saveLocalVolume(localVolume);
          etiquetaFinal = localVolume.nr_volume;
          if (remoteVolume.is_read_only && remoteVolume.conference_kind !== "avulsa") {
            try {
              const reopenPrompted = await promptPartialReopen(etiqueta, selectedCd, {
                onOpenReadOnly: () => {
                  openReadOnlyVolume(localVolume);
                }
              });
              if (reopenPrompted) return;
            } catch {
              // Em falha de validação de reabertura, mantém abertura em leitura.
            }
          }
          setActiveVolume(localVolume);
          setStatusMessage(
            remoteVolume.is_read_only
              ? "Conferência já finalizada. Aberta em leitura."
              : waitingOfflineBase
                ? "Conferência aberta online enquanto a base offline é sincronizada em segundo plano."
                : `Conferência Seq/NF ${etiquetaFinal} aberta para bipagem.`
          );
          return;
        }

        const manifestItems = await getManifestItemsByEtiqueta(profile.user_id, selectedCd, etiqueta);
        if (!manifestItems.length) {
          showDialog({
            title: "Seq/NF inválido",
            message: "Seq/NF não encontrado na base local de Entrada de Notas para este CD."
          });
          return;
        }

        const offlineVolume = createLocalVolumeFromManifest(profile, selectedCd, etiqueta, manifestItems);
        await saveLocalVolume(offlineVolume);
        setActiveVolume(offlineVolume);
        etiquetaFinal = offlineVolume.nr_volume;
        setStatusMessage("Conferência aberta offline. Pendências serão sincronizadas ao voltar a conexão.");
        return;
      }

      if (!isOnline) {
        setErrorMessage("Sem internet no momento. Ative 'Trabalhar offline' para usar a base local.");
        return;
      }

      const remoteVolume = await openVolume(etiqueta, selectedCd);
      const [remoteItems, contributors] = await Promise.all([
        fetchVolumeItems(remoteVolume.conf_id),
        fetchSeqNfContributors(remoteVolume)
      ]);
      const localVolume = createLocalVolumeFromRemote(profile, remoteVolume, remoteItems, contributors);
      await saveLocalVolume(localVolume);
      etiquetaFinal = localVolume.nr_volume;

      if (remoteVolume.is_read_only) {
        if (remoteVolume.conference_kind !== "avulsa") {
          try {
            const reopenPrompted = await promptPartialReopen(etiqueta, selectedCd, {
              onOpenReadOnly: () => {
                openReadOnlyVolume(localVolume);
              }
            });
            if (reopenPrompted) return;
          } catch {
            // Em falha de validação de reabertura, mantém abertura em leitura.
          }
        }
        showDialog({
          title: "Conferência já finalizada",
          message: "Esta conferência já foi finalizada por você hoje. Deseja abrir em modo leitura?",
          confirmLabel: "Abrir leitura",
          cancelLabel: "Cancelar",
          onConfirm: () => {
            openReadOnlyVolume(localVolume);
            closeDialog();
          }
        });
        return;
      }

      setActiveVolume(localVolume);
      setStatusMessage(`Conferência Seq/NF ${etiquetaFinal} aberta para bipagem.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao Iniciar conferência.";
      if (message.includes("CONFERENCIA_JA_FINALIZADA_OUTRO_USUARIO")) {
        try {
          const reopenPrompted = await promptPartialReopen(etiqueta, selectedCd);
          if (!reopenPrompted) {
            setErrorMessage(normalizeRpcErrorMessage("CONFERENCIA_FINALIZADA_SEM_PENDENCIA"));
            return;
          }
          return;
        } catch (reopenInfoError) {
          const reopenInfoMessage = reopenInfoError instanceof Error
            ? reopenInfoError.message
            : message;
          setErrorMessage(normalizeRpcErrorMessage(reopenInfoMessage));
          return;
        }
      }
      if (message.includes("CONFERENCIA_EM_ABERTO_OUTRO_VOLUME") || message.includes("CONFERENCIA_EM_ABERTO_OUTRA_ENTRADA")) {
        setShowRoutesModal(false);
        try {
          const resumed = await resumeRemoteActiveVolume(true);
          if (resumed) {
            etiquetaFinal = resumed.nr_volume;
            setErrorMessage(null);
            const label = resumed.conference_kind === "avulsa"
              ? "Conferência Avulsa"
              : `Seq/NF ${resumed.nr_volume}`;
            setStatusMessage(`Conferência retomada automaticamente: ${label}.`);
            return;
          }
        } catch {
          // Se falhar ao retomar remoto, mantém tratamento padrão abaixo.
        }
      }
      setErrorMessage(normalizeRpcErrorMessage(message));
    } finally {
      setBusyOpenVolume(false);
      setExpandedItemKey(null);
      setEditingItemKey(null);
      setEditQtdInput("0");
      setEtiquetaInput(etiquetaFinal);
      focusBarras();
    }
  }, [
    activeVolume,
    closeDialog,
    currentCd,
    focusBarras,
    hasOpenConference,
    isOnline,
    busyManifest,
    manifestReady,
    preferOfflineMode,
    prepareOfflineManifest,
    profile,
    promptPartialReopen,
    openReadOnlyVolume,
    resumeRemoteActiveVolume,
    showDialog,
    fetchSeqNfVolumeSnapshot,
    fetchSeqNfContributors
  ]);

  const openAvulsaVolumeWithRemoteState = useCallback(async (cd: number) => {
    const remoteVolume = await openAvulsaVolume(cd);
    const [remoteItems, targets] = await Promise.all([
      fetchAvulsaItems(remoteVolume.conf_id),
      fetchAvulsaTargets(remoteVolume.conf_id)
    ]);
    const localVolume = createLocalVolumeFromRemote(profile, remoteVolume, remoteItems);
    localVolume.avulsa_targets = targets;
    localVolume.avulsa_queue = [];
    localVolume.pending_snapshot = false;
    localVolume.pending_finalize = false;
    localVolume.pending_cancel = false;
    localVolume.sync_error = null;
    localVolume.last_synced_at = new Date().toISOString();
    await saveLocalVolume(localVolume);
    return { remoteVolume, localVolume };
  }, [profile]);

  const openAvulsaConference = useCallback(async () => {
    if (currentCd == null) {
      setErrorMessage("CD não definido para esta conferência.");
      return;
    }

    setRouteBatchQueue((current) => (current.length > 0 ? [] : current));

    if (hasOpenConference && activeVolume && activeVolume.conference_kind !== "avulsa") {
      setErrorMessage("Existe uma conferência Seq/NF em andamento. Finalize-a antes de iniciar a avulsa.");
      return;
    }

    setBusyOpenVolume(true);
    setStatusMessage(null);
    setErrorMessage(null);
    let etiquetaFinal = "AVULSA";

    try {
      const today = todayIsoBrasilia();
      const waitingOfflineBase = preferOfflineMode && !manifestReady;

      if (preferOfflineMode) {
        if (!manifestReady) {
          if (!isOnline) {
            await prepareOfflineManifest(false);
          } else if (!busyManifest) {
            void prepareOfflineManifest(false, true).catch((error) => {
              const message = error instanceof Error ? error.message : "Falha ao preparar base offline.";
              setErrorMessage(normalizeRpcErrorMessage(message));
            });
          }
        }

        const existingToday = await getLocalVolume(profile.user_id, currentCd, today, "AVULSA");
        if (existingToday) {
          if (existingToday.status !== "em_conferencia") {
            if (isOnline) {
              const { remoteVolume, localVolume } = await openAvulsaVolumeWithRemoteState(currentCd);
              setActiveVolume(localVolume);
              setEtiquetaInput(localVolume.nr_volume);
              etiquetaFinal = localVolume.nr_volume;
              setStatusMessage(
                remoteVolume.is_read_only
                  ? "Conferência avulsa já finalizada. Aberta em leitura."
                  : waitingOfflineBase
                    ? "Nova conferência avulsa aberta enquanto a base offline sincroniza em segundo plano."
                    : "Nova conferência avulsa aberta para bipagem."
              );
              return;
            }
            showDialog({
              title: "Conferência avulsa já finalizada",
              message: "A conferência avulsa já foi finalizada por você hoje. Deseja abrir em modo leitura?",
              confirmLabel: "Abrir leitura",
              cancelLabel: "Cancelar",
              onConfirm: () => {
                setActiveVolume(existingToday);
                setExpandedItemKey(null);
                setEditingItemKey(null);
                setEditQtdInput("0");
                setStatusMessage("Conferência avulsa aberta em modo leitura.");
                closeDialog();
              }
            });
            return;
          }

          if (isOnline && existingToday.remote_conf_id && existingToday.pending_snapshot) {
            const conflict = await checkAvulsaConflict(existingToday.remote_conf_id);
            const localDiscardItems = existingToday.items.filter((item) => item.qtd_conferida > 0);
            if (conflict.has_remote_data && localDiscardItems.length > 0) {
              const lines = localDiscardItems
                .sort(itemSort)
                .slice(0, 50)
                .map((item) => {
                  const seqLabel = item.seq_entrada != null && item.nf != null
                    ? `Seq ${item.seq_entrada}/NF ${item.nf} - `
                    : "";
                  return `${seqLabel}${item.descricao}: ${item.qtd_conferida}`;
                });
              const moreCount = Math.max(localDiscardItems.length - lines.length, 0);
              showDialog({
                title: "Conflito com dados no banco",
                message:
                  `Já existe conferência salva no banco para esta avulsa.${conflict.seq_nf_list ? `\nSeq/NF no banco: ${conflict.seq_nf_list}` : ""}\n\n` +
                  "Se continuar, o rascunho local abaixo será descartado:\n" +
                  `${lines.join("\n")}${moreCount > 0 ? `\n... e mais ${moreCount} item(ns)` : ""}`,
                confirmLabel: "Descartar rascunho local",
                cancelLabel: "Não continuar",
                onConfirm: () => {
                  void (async () => {
                    closeDialog();
                    try {
                      const { remoteVolume, localVolume } = await openAvulsaVolumeWithRemoteState(currentCd);
                      setActiveVolume(localVolume);
                      setEtiquetaInput(localVolume.nr_volume);
                      etiquetaFinal = localVolume.nr_volume;
                      setStatusMessage(
                        remoteVolume.is_read_only
                          ? "Conferência avulsa já finalizada. Aberta em leitura."
                          : "Rascunho local descartado. Conferência carregada com dados do banco."
                      );
                    } catch (discardError) {
                      const discardMessage = discardError instanceof Error
                        ? discardError.message
                        : "Falha ao recarregar conferência do banco.";
                      setErrorMessage(normalizeRpcErrorMessage(discardMessage));
                    }
                  })();
                }
              });
              return;
            }
          }

          setActiveVolume(existingToday);
          setExpandedItemKey(null);
          setEditingItemKey(null);
          setEditQtdInput("0");
          setStatusMessage("Conferência avulsa retomada do cache local.");
          return;
        }

        if (isOnline) {
          const { remoteVolume, localVolume } = await openAvulsaVolumeWithRemoteState(currentCd);
          setActiveVolume(localVolume);
          etiquetaFinal = localVolume.nr_volume;
          setStatusMessage(
            remoteVolume.is_read_only
              ? "Conferência avulsa já finalizada. Aberta em leitura."
              : waitingOfflineBase
                ? "Conferência avulsa aberta online enquanto a base offline sincroniza em segundo plano."
                : "Conferência avulsa aberta para bipagem."
          );
          return;
        }

        const manifestItems = await listManifestItemsByCd(profile.user_id, currentCd);
        if (!manifestItems.length) {
          showDialog({
            title: "Base indisponível",
            message: "Sem itens de entrada na base local para iniciar a conferência avulsa."
          });
          return;
        }

        const offlineVolume = createLocalAvulsaFromManifest(profile, currentCd, manifestItems);
        await saveLocalVolume(offlineVolume);
        setActiveVolume(offlineVolume);
        etiquetaFinal = offlineVolume.nr_volume;
        setStatusMessage("Conferência avulsa aberta offline. Pendências serão sincronizadas ao reconectar.");
        return;
      }

      if (!isOnline) {
        setErrorMessage("Sem internet no momento. Ative 'Trabalhar offline' para usar a base local.");
        return;
      }

      const { remoteVolume, localVolume } = await openAvulsaVolumeWithRemoteState(currentCd);
      etiquetaFinal = localVolume.nr_volume;

      if (remoteVolume.is_read_only) {
        showDialog({
          title: "Conferência avulsa já finalizada",
          message: "A conferência avulsa já foi finalizada por você hoje. Deseja abrir em modo leitura?",
          confirmLabel: "Abrir leitura",
          cancelLabel: "Cancelar",
          onConfirm: () => {
            setActiveVolume(localVolume);
            closeDialog();
          }
        });
        return;
      }

      setActiveVolume(localVolume);
      setStatusMessage("Conferência avulsa aberta para bipagem.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao iniciar conferência avulsa.";
      if (
        message.includes("CONFERENCIA_EM_ABERTO_OUTRA_ENTRADA")
        || message.includes("CONFERENCIA_AVULSA_EM_USO")
      ) {
        try {
          const resumed = await resumeRemoteActiveVolume(true);
          if (resumed) {
            etiquetaFinal = resumed.nr_volume;
            setErrorMessage(null);
            setStatusMessage("Conferência em andamento retomada automaticamente.");
            return;
          }
        } catch {
          // segue tratamento padrão
        }
      }
      setErrorMessage(normalizeRpcErrorMessage(message));
    } finally {
      setBusyOpenVolume(false);
      setExpandedItemKey(null);
      setEditingItemKey(null);
      setEditQtdInput("0");
      setEtiquetaInput(etiquetaFinal);
      focusBarras();
    }
  }, [
    activeVolume,
    closeDialog,
    currentCd,
    focusBarras,
    hasOpenConference,
    isOnline,
    busyManifest,
    manifestReady,
    preferOfflineMode,
    prepareOfflineManifest,
    profile,
    resumeRemoteActiveVolume,
    showDialog,
    openAvulsaVolumeWithRemoteState
  ]);

  const updateItemQtyLocal = useCallback(async (itemKey: string, qtd: number, barras: string | null = null) => {
    const currentVolume = activeVolumeRef.current;
    if (!currentVolume) return;
    const nowIso = new Date().toISOString();
    const nextQtd = Math.max(0, Math.trunc(qtd));
    const nextItems = currentVolume.items
      .map((item) => (
        (item.item_key ?? String(item.coddv)) === itemKey
          ? {
              ...item,
              barras: barras ?? item.barras ?? null,
              qtd_conferida: nextQtd,
              updated_at: nowIso
            }
          : item
      ))
      .filter((item) => (
        currentVolume.conference_kind !== "avulsa"
          || (item.item_key ?? String(item.coddv)) !== itemKey
          || item.qtd_conferida > 0
      ));

    const nextVolume: EntradaNotasLocalVolume = {
      ...currentVolume,
      items: nextItems.sort(itemSort),
      pending_snapshot: true,
      updated_at: nowIso,
      sync_error: null
    };
    await applyVolumeUpdate(nextVolume);
  }, [applyVolumeUpdate]);

  const upsertAvulsaItemLocal = useCallback(async (params: {
    target_conf_id: string | null;
    seq_entrada: number;
    nf: number;
    coddv: number;
    descricao: string;
    barras: string;
    qtd_esperada: number;
    qtd_conferida: number;
  }) => {
    const currentVolume = activeVolumeRef.current;
    if (!currentVolume) return;
    const nowIso = new Date().toISOString();
    const itemKey = buildAvulsaItemKey(params.seq_entrada, params.nf, params.coddv);
    let found = false;

    const nextItems = currentVolume.items.map((item) => {
      const currentKey = item.item_key ?? String(item.coddv);
      if (currentKey !== itemKey) return item;
      found = true;
      return {
        ...item,
        barras: (params.barras || item.barras) ?? null,
        descricao: params.descricao || item.descricao,
        qtd_esperada: Math.max(params.qtd_esperada, 0),
        qtd_conferida: Math.max(params.qtd_conferida, 0),
        seq_entrada: params.seq_entrada,
        nf: params.nf,
        target_conf_id: params.target_conf_id,
        item_key: itemKey,
        updated_at: nowIso
      } satisfies EntradaNotasLocalItem;
    });

    if (!found) {
      nextItems.push({
        coddv: params.coddv,
        barras: params.barras || null,
        descricao: params.descricao || `Produto ${params.coddv}`,
        qtd_esperada: Math.max(params.qtd_esperada, 0),
        qtd_conferida: Math.max(params.qtd_conferida, 0),
        seq_entrada: params.seq_entrada,
        nf: params.nf,
        target_conf_id: params.target_conf_id,
        item_key: itemKey,
        updated_at: nowIso
      });
    }

    const nextVolume: EntradaNotasLocalVolume = {
      ...currentVolume,
      items: nextItems.sort(itemSort),
      pending_snapshot: true,
      updated_at: nowIso,
      sync_error: null
    };
    await applyVolumeUpdate(nextVolume);
  }, [applyVolumeUpdate]);

  const enqueueAvulsaEvent = useCallback(async (event: {
    kind: "scan" | "set_qtd";
    barras: string;
    coddv: number;
    qtd: number;
    seq_entrada: number;
    nf: number;
    target_conf_id: string | null;
  }) => {
    const currentVolume = activeVolumeRef.current;
    if (!currentVolume) return;
    const nowIso = new Date().toISOString();
    const queue = [...(currentVolume.avulsa_queue ?? [])];
    queue.push({
      event_id: `${nowIso}:${Math.random().toString(16).slice(2)}`,
      kind: event.kind,
      barras: event.barras,
      coddv: event.coddv,
      qtd: Math.max(0, Math.trunc(event.qtd)),
      seq_entrada: event.seq_entrada,
      nf: event.nf,
      target_conf_id: event.target_conf_id,
      created_at: nowIso
    });

    const nextVolume: EntradaNotasLocalVolume = {
      ...currentVolume,
      avulsa_queue: queue,
      pending_snapshot: true,
      updated_at: nowIso,
      sync_error: null
    };
    await applyVolumeUpdate(nextVolume);
  }, [applyVolumeUpdate]);

  const resolveBarcodeProduct = useCallback(async (barras: string) => {
    const normalized = normalizeBarcode(barras);
    if (!normalized) return null;

    const local = await getDbBarrasByBarcode(normalized);
    if (local) return local;

    if (!isOnline) return null;

    try {
      const online = await fetchDbBarrasByBarcodeOnline(normalized);
      if (online) {
        await upsertDbBarrasCacheRow(online);
      }
      return online;
    } catch {
      return null;
    }
  }, [isOnline]);

  const lookupSeqNfOptionsByBarcodeOffline = useCallback(async (
    rawBarras: string
  ): Promise<EntradaNotasBarcodeSeqNfOption[]> => {
    if (currentCd == null) {
      throw new Error("CD_SEM_ACESSO");
    }
    const barras = normalizeBarcode(rawBarras);
    if (!barras) {
      throw new Error("BARRAS_OBRIGATORIA");
    }

    const lookup = await resolveBarcodeProduct(barras);
    if (!lookup) {
      throw new Error("BARRAS_NAO_ENCONTRADA");
    }

    const manifestItems = await listManifestItemsByCd(profile.user_id, currentCd);
    const filtered = manifestItems.filter((row) => row.coddv === lookup.coddv);
    if (!filtered.length) {
      throw new Error("PRODUTO_NAO_PERTENCE_A_NENHUM_RECEBIMENTO");
    }

    const grouped = new Map<string, EntradaNotasBarcodeSeqNfOption>();
    for (const row of filtered) {
      const seqEntrada = Number.parseInt(String(row.seq_entrada ?? 0), 10);
      const nf = Number.parseInt(String(row.nf ?? 0), 10);
      if (!Number.isFinite(seqEntrada) || !Number.isFinite(nf) || seqEntrada <= 0 || nf <= 0) {
        continue;
      }

      const key = `${seqEntrada}/${nf}`;
      const qtdEsperada = Math.max(Number.parseInt(String(row.qtd_esperada ?? 0), 10) || 0, 0);
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          coddv: lookup.coddv,
          descricao: row.descricao?.trim() || lookup.descricao?.trim() || `Produto ${lookup.coddv}`,
          barras: lookup.barras?.trim() || barras,
          seq_entrada: seqEntrada,
          nf,
          transportadora: row.transportadora ?? row.rota ?? "SEM TRANSPORTADORA",
          fornecedor: row.fornecedor ?? row.filial_nome ?? "SEM FORNECEDOR",
          qtd_esperada: qtdEsperada,
          qtd_conferida: 0,
          qtd_pendente: qtdEsperada
        });
      } else {
        current.qtd_esperada += qtdEsperada;
        current.qtd_pendente += qtdEsperada;
      }
    }

    const currentMat = profile.mat?.trim() || "";
    const editableOptions = [...grouped.values()]
      .map((option) => {
        const routeRow = routeRows.find((row) => (
          row.seq_entrada === option.seq_entrada
          && row.nf === option.nf
        ));
        const routeStatus = normalizeStoreStatus(routeRow?.status);
        const routeMat = routeRow?.colaborador_mat?.trim() || "";
        const isLockedByOther = routeStatus === "em_andamento" && routeMat !== "" && routeMat !== currentMat;
        const isConcluido = routeStatus === "concluido";
        const qtdConferida = isConcluido ? option.qtd_esperada : 0;
        const qtdPendente = isConcluido || isLockedByOther ? 0 : Math.max(option.qtd_esperada - qtdConferida, 0);
        return {
          ...option,
          qtd_conferida: qtdConferida,
          qtd_pendente: qtdPendente
        };
      })
      .filter((option) => option.qtd_pendente > 0);

    if (!editableOptions.length) {
      throw new Error("SEM_SEQ_NF_DISPONIVEL");
    }

    return editableOptions.sort((a, b) => (
      a.seq_entrada !== b.seq_entrada
        ? a.seq_entrada - b.seq_entrada
        : a.nf - b.nf
    ));
  }, [currentCd, profile.user_id, profile.mat, resolveBarcodeProduct, routeRows]);

  const resolveOpenOptionsByBarcode = useCallback(async (
    rawBarras: string
  ): Promise<EntradaNotasBarcodeSeqNfOption[]> => {
    if (currentCd == null) {
      throw new Error("CD_SEM_ACESSO");
    }

    const barras = normalizeBarcode(rawBarras);
    if (!barras) {
      throw new Error("BARRAS_OBRIGATORIA");
    }

    if (isOnline) {
      try {
        const onlineOptions = await lookupSeqNfByBarcode(barras, currentCd);
        const editableOnline = onlineOptions.filter((option) => option.qtd_pendente > 0);
        if (editableOnline.length > 0) {
          return editableOnline.sort((a, b) => (
            a.seq_entrada !== b.seq_entrada
              ? a.seq_entrada - b.seq_entrada
              : a.nf - b.nf
          ));
        }
        throw new Error("SEM_SEQ_NF_DISPONIVEL");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "");
        const isBusinessError = (
          message.includes("BARRAS_OBRIGATORIA")
          || message.includes("BARRAS_NAO_ENCONTRADA")
          || message.includes("PRODUTO_NAO_PERTENCE_A_NENHUM_RECEBIMENTO")
          || message.includes("SEM_SEQ_NF_DISPONIVEL")
        );
        if (isBusinessError) {
          throw new Error(message);
        }
      }
    }

    return lookupSeqNfOptionsByBarcodeOffline(barras);
  }, [currentCd, isOnline, lookupSeqNfOptionsByBarcodeOffline]);

  const openConferenceFromInput = useCallback(async (rawInput: string) => {
    const value = String(rawInput ?? "").trim();
    if (!value) {
      setErrorMessage("Informe Seq/NF ou código de barras para iniciar a conferência.");
      return;
    }
    if (currentCd == null) {
      setErrorMessage("CD não definido para esta conferência.");
      return;
    }

    setRouteBatchQueue((current) => (current.length > 0 ? [] : current));

    const parsedSeqNf = parseStrictSeqNfInput(value);
    if (parsedSeqNf) {
      await openVolumeFromEtiqueta(parsedSeqNf.label);
      return;
    }
    if (value.includes("/")) {
      setErrorMessage(normalizeRpcErrorMessage("SEQ_NF_INVALIDO"));
      return;
    }

    setBusyOpenVolume(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const options = await resolveOpenOptionsByBarcode(value);
      if (options.length === 1) {
        const only = options[0];
        const seqNfLabel = `${only.seq_entrada}/${only.nf}`;
        setStatusMessage(`Código encontrado. Seq/NF ${seqNfLabel} será iniciada.`);
        await openVolumeFromEtiqueta(seqNfLabel);
        return;
      }

      setPendingBarcodeOpenSelection({
        barras: normalizeBarcode(value),
        descricao: options[0]?.descricao || "Produto",
        options
      });
      setStatusMessage("Produto encontrado em mais de uma Seq/NF. Selecione qual iniciar.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao localizar Seq/NF por barras.";
      setErrorMessage(normalizeRpcErrorMessage(message));
    } finally {
      setBusyOpenVolume(false);
    }
  }, [currentCd, openVolumeFromEtiqueta, resolveOpenOptionsByBarcode]);

  const handleSelectPendingBarcodeOpen = useCallback(async (option: EntradaNotasBarcodeSeqNfOption) => {
    const seqNfLabel = `${option.seq_entrada}/${option.nf}`;
    setRouteBatchQueue((current) => (current.length > 0 ? [] : current));
    setPendingBarcodeOpenSelection(null);
    setEtiquetaInput(seqNfLabel);
    setStatusMessage(`Código encontrado. Seq/NF ${seqNfLabel} será iniciada.`);
    setErrorMessage(null);
    await openVolumeFromEtiqueta(seqNfLabel);
  }, [openVolumeFromEtiqueta]);

  const resolveAvulsaTargetsOffline = useCallback(async (
    coddv: number,
    barras: string,
    descricaoFallback: string
  ): Promise<EntradaNotasAvulsaTargetOption[]> => {
    if (currentCd == null) return [];
    const manifestItems = await listManifestItemsByCd(profile.user_id, currentCd);
    const filtered = manifestItems.filter((row) => row.coddv === coddv);
    if (!filtered.length) return [];

    const grouped = new Map<string, {
      seq_entrada: number;
      nf: number;
      transportadora: string;
      fornecedor: string;
      qtd_esperada: number;
      descricao: string;
    }>();

    for (const row of filtered) {
      const seq = Number.parseInt(String(row.seq_entrada ?? 0), 10);
      const nf = Number.parseInt(String(row.nf ?? 0), 10);
      if (!Number.isFinite(seq) || !Number.isFinite(nf) || seq <= 0 || nf <= 0) continue;
      const key = `${seq}|${nf}`;
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          seq_entrada: seq,
          nf,
          transportadora: row.transportadora ?? row.rota ?? "SEM TRANSPORTADORA",
          fornecedor: row.fornecedor ?? row.filial_nome ?? "SEM FORNECEDOR",
          qtd_esperada: Math.max(Number.parseInt(String(row.qtd_esperada ?? 0), 10) || 0, 0),
          descricao: row.descricao || descricaoFallback || `Produto ${coddv}`
        });
      } else {
        current.qtd_esperada += Math.max(Number.parseInt(String(row.qtd_esperada ?? 0), 10) || 0, 0);
      }
    }

    const options: EntradaNotasAvulsaTargetOption[] = [];
    for (const entry of grouped.values()) {
      const itemKey = buildAvulsaItemKey(entry.seq_entrada, entry.nf, coddv);
      const localConferida = activeVolume?.items.find((item) => (item.item_key ?? String(item.coddv)) === itemKey)?.qtd_conferida ?? 0;
      const routeRow = routeRows.find((row) => row.seq_entrada === entry.seq_entrada && row.nf === entry.nf);
      const routeStatus = normalizeStoreStatus(routeRow?.status);
      const isConcluido = routeStatus === "concluido";
      const routeMat = routeRow?.colaborador_mat?.trim() || "";
      const currentMat = profile.mat?.trim() || "";
      const isLockedByOther = routeStatus === "em_andamento" && routeMat !== "" && routeMat !== currentMat;
      const qtdPendente = Math.max(entry.qtd_esperada - localConferida, 0);
      options.push({
        coddv,
        descricao: entry.descricao,
        barras,
        seq_entrada: entry.seq_entrada,
        nf: entry.nf,
        transportadora: entry.transportadora,
        fornecedor: entry.fornecedor,
        qtd_esperada: entry.qtd_esperada,
        qtd_conferida: localConferida,
        qtd_pendente: qtdPendente,
        target_conf_id: null,
        target_status: isConcluido ? "finalizado_ok" : "em_conferencia",
        started_by: null,
        started_nome: routeRow?.colaborador_nome ?? null,
        started_mat: routeMat || null,
        is_locked: isLockedByOther,
        is_available: qtdPendente > 0 && !isConcluido && !isLockedByOther
      });
    }

    return options.sort((a, b) => {
      const pendingDiff = Number(b.is_available) - Number(a.is_available);
      if (pendingDiff !== 0) return pendingDiff;
      if (a.seq_entrada !== b.seq_entrada) return a.seq_entrada - b.seq_entrada;
      return a.nf - b.nf;
    });
  }, [activeVolume?.items, currentCd, profile.user_id, routeRows]);

  const clearConferenceScreen = useCallback(() => {
    setShowFinalizeModal(false);
    setFinalizeError(null);
    setPendingBarcodeOpenSelection(null);
    setPendingAvulsaScan(null);
    setExpandedItemKey(null);
    setEditingItemKey(null);
    setLastAddedItemMarker(null);
    setEditQtdInput("0");
    setBarcodeInput("");
    activeVolumeRef.current = null;
    setActiveVolume(null);
    setEtiquetaInput("");
    window.requestAnimationFrame(() => {
      etiquetaRef.current?.focus();
    });
  }, []);

  const handleClosedConferenceError = useCallback(async (rawMessage: string): Promise<boolean> => {
    if (!rawMessage.includes("CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA")) {
      return false;
    }
    if (isOnline && activeVolume) {
      try {
        const remoteVolume = activeVolume.conference_kind === "avulsa"
          ? await openAvulsaVolume(activeVolume.cd)
          : await openVolume(activeVolume.nr_volume, activeVolume.cd);
        const [remoteItems, contributors] = await Promise.all([
          activeVolume.conference_kind === "avulsa"
            ? fetchAvulsaItems(remoteVolume.conf_id)
            : fetchVolumeItems(remoteVolume.conf_id),
          fetchSeqNfContributors(remoteVolume)
        ]);
        const localVolume = createLocalVolumeFromRemote(profile, remoteVolume, remoteItems, contributors);
        if (activeVolume.conference_kind === "avulsa") {
          localVolume.avulsa_targets = await fetchAvulsaTargets(remoteVolume.conf_id);
        }
        await saveLocalVolume(localVolume);
        setActiveVolume(localVolume);
        setEtiquetaInput(localVolume.nr_volume);
        await refreshPendingState();
        setShowFinalizeModal(false);
        setFinalizeError(null);
        if (localVolume.is_read_only || localVolume.status !== "em_conferencia") {
          setStatusMessage("Conferência atualizada: esta entrada já foi finalizada em outro dispositivo.");
        } else {
          setStatusMessage("Conferência retomada automaticamente neste dispositivo.");
        }
        setErrorMessage(null);
        return true;
      } catch {
        // Se não conseguir retomar do servidor, segue fluxo de limpeza local abaixo.
      }
    }
    try {
      if (activeVolume?.local_key) {
        await removeLocalVolume(activeVolume.local_key);
      }
    } catch {
      // Ignora falha local de limpeza.
    }
    await refreshPendingState();
    clearConferenceScreen();
    setShowFinalizeModal(false);
    setFinalizeError(null);
    setStatusMessage(null);
    setErrorMessage(normalizeRpcErrorMessage(rawMessage));
    return true;
  }, [activeVolume, clearConferenceScreen, isOnline, profile, refreshPendingState, fetchSeqNfContributors]);

  const applyAvulsaScanChoice = useCallback(async (
    barras: string,
    qtd: number,
    chosen: EntradaNotasAvulsaTargetOption
  ): Promise<{ produtoRegistrado: string; barrasRegistrada: string; registroRemoto: boolean; itemKey: string }> => {
    if (!activeVolume || activeVolume.conference_kind !== "avulsa") {
      throw new Error("Conferência avulsa não está ativa.");
    }

    const chosenItemKey = buildAvulsaItemKey(chosen.seq_entrada, chosen.nf, chosen.coddv);
    const onlineAvulsa = isOnline && !preferOfflineMode && Boolean(activeVolume.remote_conf_id);

    if (onlineAvulsa && activeVolume.remote_conf_id) {
      const updated = await applyAvulsaScan(
        activeVolume.remote_conf_id,
        barras,
        qtd,
        chosen.seq_entrada,
        chosen.nf
      );
      const nowIso = new Date().toISOString();
      const itemKey = updated.item_key ?? chosenItemKey;
      let found = false;
      const nextItems = activeVolume.items.map((item) => {
        const key = item.item_key ?? String(item.coddv);
        if (key !== itemKey) return item;
        found = true;
        return {
          ...item,
          barras: updated.barras ?? barras,
          descricao: updated.descricao,
          qtd_esperada: updated.qtd_esperada,
          qtd_conferida: updated.qtd_conferida,
          seq_entrada: updated.seq_entrada ?? chosen.seq_entrada,
          nf: updated.nf ?? chosen.nf,
          target_conf_id: updated.target_conf_id ?? updated.conf_id,
          item_key: itemKey,
          updated_at: updated.updated_at
        } satisfies EntradaNotasLocalItem;
      });
      if (!found) {
        nextItems.push({
          coddv: updated.coddv,
          barras: updated.barras ?? barras,
          descricao: updated.descricao,
          qtd_esperada: updated.qtd_esperada,
          qtd_conferida: updated.qtd_conferida,
          seq_entrada: updated.seq_entrada ?? chosen.seq_entrada,
          nf: updated.nf ?? chosen.nf,
          target_conf_id: updated.target_conf_id ?? updated.conf_id,
          item_key: itemKey,
          updated_at: updated.updated_at
        });
      }
      const targets = await fetchAvulsaTargets(activeVolume.remote_conf_id);
      const nextVolume: EntradaNotasLocalVolume = {
        ...activeVolume,
        items: nextItems.sort(itemSort),
        avulsa_targets: targets,
        pending_snapshot: false,
        avulsa_queue: [],
        sync_error: null,
        updated_at: nowIso,
        last_synced_at: nowIso
      };
      await applyVolumeUpdate(nextVolume);
      return {
        produtoRegistrado: `${updated.descricao} (Seq ${updated.seq_entrada ?? chosen.seq_entrada}/NF ${updated.nf ?? chosen.nf})`,
        barrasRegistrada: updated.barras ?? barras,
        registroRemoto: true,
        itemKey
      };
    }

    const current = activeVolume.items.find((item) => (item.item_key ?? String(item.coddv)) === chosenItemKey);
    const nextQtd = (current?.qtd_conferida ?? 0) + qtd;
    await upsertAvulsaItemLocal({
      target_conf_id: current?.target_conf_id ?? chosen.target_conf_id,
      seq_entrada: chosen.seq_entrada,
      nf: chosen.nf,
      coddv: chosen.coddv,
      descricao: chosen.descricao,
      barras,
      qtd_esperada: chosen.qtd_esperada,
      qtd_conferida: nextQtd
    });
    await enqueueAvulsaEvent({
      kind: "scan",
      barras,
      coddv: chosen.coddv,
      qtd,
      seq_entrada: chosen.seq_entrada,
      nf: chosen.nf,
      target_conf_id: chosen.target_conf_id
    });
    if (isOnline && !preferOfflineMode) void runPendingSync(true);
    return {
      produtoRegistrado: `${chosen.descricao} (Seq ${chosen.seq_entrada}/NF ${chosen.nf})`,
      barrasRegistrada: barras,
      registroRemoto: false,
      itemKey: chosenItemKey
    };
  }, [
    activeVolume,
    applyVolumeUpdate,
    enqueueAvulsaEvent,
    isOnline,
    preferOfflineMode,
    runPendingSync,
    upsertAvulsaItemLocal
  ]);

  const handleCollectBarcode = useCallback(async (value: string) => {
    if (!activeVolume) {
      setErrorMessage("Inicie uma conferência para começar a bipagem.");
      setBarcodeValidationState("invalid");
      triggerScanErrorAlert("Inicie uma conferência para começar a bipagem.");
      return;
    }
    if (activeVolume.is_read_only || !canEditActiveVolume) {
      setErrorMessage("Conferência em modo leitura. Não é possível alterar.");
      setBarcodeValidationState("invalid");
      triggerScanErrorAlert("Conferência em modo leitura.");
      return;
    }

    const barras = normalizeBarcode(value);
    if (!barras) {
      setBarcodeValidationState("invalid");
      triggerScanErrorAlert("Código de barras obrigatório.");
      return;
    }

    const qtd = parsePositiveInteger(multiploInput, 1);
    let produtoRegistrado = "";
    let barrasRegistrada = barras;
    let registroRemoto = false;
    let highlightedItemKey: string | null = null;
    setStatusMessage(null);
    setErrorMessage(null);
    setBarcodeValidationState("validating");

    try {
      const isAvulsa = activeVolume.conference_kind === "avulsa";

      if (!isAvulsa) {
        if (preferOfflineMode || !isOnline || !activeVolume.remote_conf_id) {
          const lookup = await resolveBarcodeProduct(barras);
          if (!lookup) {
            showDialog({
              title: "Código de barras inválido",
              message: `O código de barras "${barras}" é inválido. Ele não existe na base db_barras.`
            });
            setBarcodeValidationState("invalid");
            triggerScanErrorAlert("Código de barras inválido.");
            return;
          }
          const target = activeVolume.items.find((item) => item.coddv === lookup.coddv);
          if (!target) {
            const produtoNome = `CODDV ${lookup.coddv} - ${lookup.descricao?.trim() || "Sem descrição"}`;
            showDialog({
              title: "Produto fora da entrada",
              message: `Produto "${produtoNome}" não faz parte da entrada selecionada.`,
              confirmLabel: "OK"
            });
            setBarcodeValidationState("invalid");
            triggerScanErrorAlert("Produto fora da entrada.");
            return;
          }
          const itemKey = target.item_key ?? String(target.coddv);
          produtoRegistrado = target.descricao;
          barrasRegistrada = lookup.barras || barras;
          highlightedItemKey = itemKey;
          await updateItemQtyLocal(itemKey, target.qtd_conferida + qtd, barrasRegistrada);
          if (isOnline) {
            void runPendingSync(true);
          }
        } else {
          const updated = await scanBarcode(activeVolume.remote_conf_id, barras, qtd);
          produtoRegistrado = updated.descricao;
          barrasRegistrada = updated.barras ?? barras;
          registroRemoto = true;
          highlightedItemKey = activeVolume.items.find((item) => item.coddv === updated.coddv)?.item_key ?? String(updated.coddv);
          const nowIso = new Date().toISOString();
          const nextItems = activeVolume.items.map((item) => (
            item.coddv === updated.coddv
              ? {
                  ...item,
                  barras: updated.barras ?? barras,
                  qtd_conferida: updated.qtd_conferida,
                  qtd_esperada: updated.qtd_esperada,
                  is_locked: updated.is_locked === true,
                  locked_by: updated.locked_by ?? null,
                  locked_mat: updated.locked_mat ?? null,
                  locked_nome: updated.locked_nome ?? null,
                  updated_at: updated.updated_at
                }
              : item
          ));
          const nextVolume: EntradaNotasLocalVolume = {
            ...activeVolume,
            items: nextItems.sort(itemSort),
            updated_at: nowIso,
            pending_snapshot: false,
            sync_error: null,
            last_synced_at: nowIso
          };
          await applyVolumeUpdate(nextVolume);
        }
      } else {
        const lookup = await resolveBarcodeProduct(barras);
        if (!lookup) {
          showDialog({
            title: "Código de barras inválido",
            message: `O código de barras "${barras}" é inválido. Ele não existe na base db_barras.`
          });
          setBarcodeValidationState("invalid");
          triggerScanErrorAlert("Código de barras inválido.");
          return;
        }

        if (isCombinedRouteMode && (activeVolume.combined_seq_nf_labels?.length ?? 0) > 0) {
          const selectedLabels = activeVolume.combined_seq_nf_labels ?? [];
          const selectedSet = new Set(selectedLabels);
          const orderMap = new Map(selectedLabels.map((label, index) => [label, index]));
          const allocations = (activeVolume.combined_seq_allocations ?? [])
            .filter((row) => row.coddv === lookup.coddv)
            .filter((row) => selectedSet.has(`${row.seq_entrada}/${row.nf}`))
            .sort((a, b) => {
              const aLabel = `${a.seq_entrada}/${a.nf}`;
              const bLabel = `${b.seq_entrada}/${b.nf}`;
              const byOrder = (orderMap.get(aLabel) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(bLabel) ?? Number.MAX_SAFE_INTEGER);
              if (byOrder !== 0) return byOrder;
              return a.nf - b.nf;
            });

          if (allocations.length === 0) {
            showDialog({
              title: "Produto fora da conferência",
              message: "Este produto não pertence às Seq/NF selecionadas para a conferência conjunta.",
              confirmLabel: "OK"
            });
            setBarcodeValidationState("invalid");
            triggerScanErrorAlert("Produto fora da conferência conjunta.");
            return;
          }

          const totalPendente = allocations.reduce((sum, row) => sum + Math.max(row.qtd_esperada - row.qtd_conferida, 0), 0);
          if (totalPendente <= 0) {
            showDialog({
              title: "Sem pendência disponível",
              message: "Este produto já atingiu a quantidade total esperada nas Seq/NF selecionadas.",
              confirmLabel: "OK"
            });
            setBarcodeValidationState("invalid");
            triggerScanErrorAlert("Produto sem pendência disponível.");
            return;
          }
          if (qtd > totalPendente) {
            showDialog({
              title: "Quantidade acima do pendente",
              message: `Restam ${totalPendente} unidade(s) pendente(s) para este produto nas Seq/NF selecionadas.`,
              confirmLabel: "OK"
            });
            setBarcodeValidationState("invalid");
            triggerScanErrorAlert("Quantidade acima do pendente.");
            return;
          }

          let remaining = qtd;
          const nowIso = new Date().toISOString();
          const nextAllocations = (activeVolume.combined_seq_allocations ?? []).map((row) => ({ ...row }));
          const appliedDetails: string[] = [];
          const shouldWriteRemoteNow = isOnline && !preferOfflineMode;

          for (const allocation of allocations) {
            if (remaining <= 0) break;
            const pending = Math.max(allocation.qtd_esperada - allocation.qtd_conferida, 0);
            if (pending <= 0) continue;
            const toApply = Math.min(pending, remaining);
            remaining -= toApply;
            const targetLabel = `${allocation.seq_entrada}/${allocation.nf}`;
            if (shouldWriteRemoteNow) {
              const targetConfId = combinedSeqConfIdByLabel[targetLabel];
              if (!targetConfId) {
                throw new Error(`Seq/NF ${targetLabel} sem conferência ativa vinculada.`);
              }
              await scanBarcode(targetConfId, lookup.barras || barras, toApply);
            }
            const nextAllocation = nextAllocations.find((row) => (
              row.coddv === allocation.coddv
              && row.seq_entrada === allocation.seq_entrada
              && row.nf === allocation.nf
            ));
            if (!nextAllocation) continue;
            nextAllocation.qtd_conferida += toApply;
            nextAllocation.barras = lookup.barras || barras;
            appliedDetails.push(`Seq/NF ${targetLabel} +${toApply}`);
          }

          const appliedTotal = qtd - remaining;
          const nextItems = activeVolume.items.map((item) => {
            if (item.coddv !== lookup.coddv) return item;
            return {
              ...item,
              barras: lookup.barras || barras,
              qtd_conferida: Math.max(item.qtd_conferida + appliedTotal, 0),
              updated_at: nowIso
            };
          });

          const nextVolume: EntradaNotasLocalVolume = {
            ...activeVolume,
            items: nextItems.sort(itemSort),
            combined_seq_allocations: nextAllocations,
            updated_at: nowIso,
            pending_snapshot: !shouldWriteRemoteNow,
            sync_error: null,
            last_synced_at: shouldWriteRemoteNow ? nowIso : activeVolume.last_synced_at
          };
          await applyVolumeUpdate(nextVolume);
          produtoRegistrado = `${lookup.descricao || `Produto ${lookup.coddv}`}${appliedDetails.length ? ` | ${appliedDetails.join(" | ")}` : ""}`;
          barrasRegistrada = lookup.barras || barras;
          highlightedItemKey = activeVolume.items.find((item) => item.coddv === lookup.coddv)?.item_key ?? `multi:${lookup.coddv}`;
          registroRemoto = false;
        } else {
          const onlineAvulsa = isOnline && !preferOfflineMode && Boolean(activeVolume.remote_conf_id);
          const candidateOptions = onlineAvulsa && activeVolume.remote_conf_id
            ? await resolveAvulsaTargets(activeVolume.remote_conf_id, barras)
            : await resolveAvulsaTargetsOffline(lookup.coddv, lookup.barras || barras, lookup.descricao ?? "");
          const availableOptions = candidateOptions.filter((option) => option.is_available);

          if (availableOptions.length === 0) {
            showDialog({
              title: "Sem pendência disponível",
              message: "Este produto não possui Seq/NF pendente disponível para conferência.",
              confirmLabel: "OK"
            });
            setBarcodeValidationState("invalid");
            triggerScanErrorAlert("Produto sem pendência disponível.");
            return;
          }

          if (availableOptions.length > 1) {
            setBarcodeValidationState("valid");
            setPendingAvulsaScan({
              barras: lookup.barras || barras,
              qtd,
              coddv: lookup.coddv,
              descricao: lookup.descricao || `Produto ${lookup.coddv}`,
              options: availableOptions
            });
            return;
          }

          const chosen = availableOptions[0];
          const result = await applyAvulsaScanChoice(lookup.barras || barras, qtd, chosen);
          produtoRegistrado = result.produtoRegistrado;
          barrasRegistrada = result.barrasRegistrada;
          registroRemoto = result.registroRemoto;
          highlightedItemKey = result.itemKey;
        }
      }

      if (highlightedItemKey) {
        setLastAddedItemMarker({
          volumeKey: activeVolume.local_key,
          itemKey: highlightedItemKey
        });
      }
      setBarcodeInput("");
      setMultiploInput("1");
      await persistPreferences({ multiplo_padrao: 1 });
      const descricao = produtoRegistrado || "Produto";
      const baseMessage = `${descricao} | Barras: ${barrasRegistrada} | +${qtd}`;
      setStatusMessage(
        registroRemoto
          ? `Produto registrado na conferência: ${baseMessage}`
          : `Produto registrado localmente: ${baseMessage}`
      );
      showScanFeedback("success", descricao, `+ ${qtd}`);
      setBarcodeValidationState("valid");
      focusBarras();
    } catch (error) {
      setBarcodeValidationState("invalid");
      const message = error instanceof Error ? error.message : "Falha ao registrar leitura.";
      if (await handleClosedConferenceError(message)) return;
      if (message.includes("BARRAS_NAO_ENCONTRADA")) {
        showDialog({
          title: "Código de barras inválido",
          message: `O código de barras "${barras}" é inválido. Ele não existe na base db_barras.`,
          confirmLabel: "OK"
        });
        triggerScanErrorAlert("Código de barras inválido.");
        return;
      }
      if (message.includes("PRODUTO_FORA_DA_ENTRADA")) {
        const lookup = await resolveBarcodeProduct(barras);
        const produtoNome = lookup
          ? `CODDV ${lookup.coddv} - ${lookup.descricao?.trim() || "Sem descrição"}`
          : `Código de barras ${barras}`;
        showDialog({
          title: activeVolume?.conference_kind === "avulsa" ? "Produto inválido" : "Produto fora da entrada",
          message: activeVolume?.conference_kind === "avulsa"
            ? `Produto "${produtoNome}" não faz parte de nenhum recebimento pendente para esta conferência.`
            : `Produto "${produtoNome}" não faz parte da entrada selecionada.`,
          confirmLabel: "OK"
        });
        triggerScanErrorAlert(activeVolume?.conference_kind === "avulsa" ? "Produto inválido." : "Produto fora da entrada.");
        return;
      }
      if (message.includes("PRODUTO_FORA_BASE_AVULSA")) {
        const lookup = await resolveBarcodeProduct(barras);
        const produtoNome = lookup
          ? `CODDV ${lookup.coddv} - ${lookup.descricao?.trim() || "Sem descrição"}`
          : `Código de barras ${barras}`;
        showDialog({
          title: "Produto inválido",
          message: `Produto "${produtoNome}" não faz parte de nenhum recebimento pendente para esta conferência.`,
          confirmLabel: "OK"
        });
        triggerScanErrorAlert("Produto inválido.");
        return;
      }
      if (message.includes("PRODUTO_NAO_PERTENCE_A_NENHUM_RECEBIMENTO")) {
        const lookup = await resolveBarcodeProduct(barras);
        const produtoNome = lookup
          ? `CODDV ${lookup.coddv} - ${lookup.descricao?.trim() || "Sem descrição"}`
          : `Código de barras ${barras}`;
        showDialog({
          title: "Produto inválido",
          message: `Produto "${produtoNome}" não faz parte de nenhum recebimento pendente para esta conferência.`,
          confirmLabel: "OK"
        });
        triggerScanErrorAlert("Produto inválido.");
        return;
      }
      const normalizedError = normalizeRpcErrorMessage(message);
      setErrorMessage(normalizedError);
      triggerScanErrorAlert(normalizedError);
    }
  }, [
    activeVolume,
    applyAvulsaScanChoice,
    applyVolumeUpdate,
    canEditActiveVolume,
    combinedSeqConfIdByLabel,
    focusBarras,
    isCombinedRouteMode,
    isOnline,
    multiploInput,
    persistPreferences,
    preferOfflineMode,
    resolveAvulsaTargetsOffline,
    resolveBarcodeProduct,
    runPendingSync,
    showDialog,
    showScanFeedback,
    triggerScanErrorAlert,
    updateItemQtyLocal,
    handleClosedConferenceError
  ]);

  const handleSelectPendingAvulsaScan = useCallback(async (option: EntradaNotasAvulsaTargetOption) => {
    if (!pendingAvulsaScan) return;
    try {
      const result = await applyAvulsaScanChoice(pendingAvulsaScan.barras, pendingAvulsaScan.qtd, option);
      setPendingAvulsaScan(null);
      if (activeVolume) {
        setLastAddedItemMarker({
          volumeKey: activeVolume.local_key,
          itemKey: result.itemKey
        });
      }
      setBarcodeInput("");
      setMultiploInput("1");
      await persistPreferences({ multiplo_padrao: 1 });
      const baseMessage = `${result.produtoRegistrado} | Barras: ${result.barrasRegistrada} | +${pendingAvulsaScan.qtd}`;
      setStatusMessage(
        result.registroRemoto
          ? `Produto registrado na conferência: ${baseMessage}`
          : `Produto registrado localmente: ${baseMessage}`
      );
      showScanFeedback("success", result.produtoRegistrado, `+ ${pendingAvulsaScan.qtd}`);
      focusBarras();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao registrar leitura avulsa.";
      if (await handleClosedConferenceError(message)) return;
      const normalizedError = normalizeRpcErrorMessage(message);
      setErrorMessage(normalizedError);
      triggerScanErrorAlert(normalizedError);
    }
  }, [
    activeVolume,
    applyAvulsaScanChoice,
    focusBarras,
    handleClosedConferenceError,
    pendingAvulsaScan,
    persistPreferences,
    showScanFeedback,
    triggerScanErrorAlert
  ]);

  const handleSaveItemEdit = useCallback(async (itemKey: string) => {
    if (!activeVolume) return;
    if (!canEditActiveVolume) return;
    const item = activeVolume.items.find((row) => (row.item_key ?? String(row.coddv)) === itemKey);
    if (!item) return;
    if (item.is_locked) {
      setErrorMessage(normalizeRpcErrorMessage("ITEM_BLOQUEADO_OUTRO_USUARIO"));
      setEditingItemKey(null);
      setEditQtdInput("0");
      return;
    }
    const qtd = parsePositiveInteger(editQtdInput, 0);

    try {
      if (preferOfflineMode || !isOnline || !activeVolume.remote_conf_id) {
        await updateItemQtyLocal(itemKey, qtd, item.barras ?? null);
        if (activeVolume.conference_kind === "avulsa" && item.seq_entrada != null && item.nf != null) {
          await enqueueAvulsaEvent({
            kind: "set_qtd",
            barras: item.barras ?? "",
            coddv: item.coddv,
            qtd,
            seq_entrada: item.seq_entrada,
            nf: item.nf,
            target_conf_id: item.target_conf_id ?? null
          });
        }
        if (isOnline && !preferOfflineMode) void runPendingSync(true);
      } else {
        let targetConfId: string | null = activeVolume.remote_conf_id;
        if (activeVolume.conference_kind === "avulsa") {
          targetConfId = item.target_conf_id ?? null;
          if (!targetConfId && item.seq_entrada != null && item.nf != null) {
            targetConfId = (await openVolume(`${item.seq_entrada}/${item.nf}`, activeVolume.cd)).conf_id;
          }
          if (!targetConfId) throw new Error("ALVO_SEQ_NF_INVALIDO");
        }
        if (!targetConfId) throw new Error("CONFERENCIA_NAO_ENCONTRADA");

        const updated = await setItemQtd(targetConfId, item.coddv, qtd);
        const nowIso = new Date().toISOString();
        const nextItems = activeVolume.items
          .map((row) => {
            const rowKey = row.item_key ?? String(row.coddv);
            if (rowKey !== itemKey) return row;
            return {
              ...row,
              barras: updated.barras ?? row.barras ?? null,
              qtd_conferida: updated.qtd_conferida,
              qtd_esperada: updated.qtd_esperada,
              is_locked: updated.is_locked === true,
              locked_by: updated.locked_by ?? null,
              locked_mat: updated.locked_mat ?? null,
              locked_nome: updated.locked_nome ?? null,
              target_conf_id: activeVolume.conference_kind === "avulsa" ? targetConfId : row.target_conf_id,
              updated_at: updated.updated_at
            };
          })
          .filter((row) => activeVolume.conference_kind !== "avulsa" || row.qtd_conferida > 0);

        const nextVolume: EntradaNotasLocalVolume = {
          ...activeVolume,
          items: nextItems.sort(itemSort),
          updated_at: nowIso,
          pending_snapshot: false,
          sync_error: null,
          last_synced_at: nowIso
        };

        if (activeVolume.conference_kind === "avulsa" && activeVolume.remote_conf_id) {
          nextVolume.avulsa_targets = await fetchAvulsaTargets(activeVolume.remote_conf_id);
          nextVolume.avulsa_queue = [];
        }

        await applyVolumeUpdate(nextVolume);
      }
      setEditingItemKey(null);
      setEditQtdInput("0");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao salvar item.";
      if (await handleClosedConferenceError(message)) return;
      setErrorMessage(normalizeRpcErrorMessage(message));
    }
  }, [
    activeVolume,
    applyVolumeUpdate,
    canEditActiveVolume,
    editQtdInput,
    enqueueAvulsaEvent,
    isOnline,
    preferOfflineMode,
    runPendingSync,
    updateItemQtyLocal,
    handleClosedConferenceError
  ]);

  const requestResetItem = useCallback((itemKey: string) => {
    if (!activeVolume || !canEditActiveVolume) return;
    const item = activeVolume.items.find((row) => (row.item_key ?? String(row.coddv)) === itemKey);
    if (!item || item.qtd_conferida <= 0) return;
    if (item.is_locked) {
      setErrorMessage(normalizeRpcErrorMessage("ITEM_BLOQUEADO_OUTRO_USUARIO"));
      return;
    }

    showDialog({
      title: "Limpar conferência do item",
      message: `O produto "${item.descricao}" está com quantidade ${item.qtd_conferida}. Ao confirmar, a quantidade será alterada para 0. Deseja continuar?`,
      confirmLabel: "Limpar",
      cancelLabel: "Cancelar",
      onConfirm: () => {
        void (async () => {
          try {
            if (preferOfflineMode || !isOnline || !activeVolume.remote_conf_id) {
              await updateItemQtyLocal(itemKey, 0, item.barras ?? null);
              if (activeVolume.conference_kind === "avulsa" && item.seq_entrada != null && item.nf != null) {
                await enqueueAvulsaEvent({
                  kind: "set_qtd",
                  barras: item.barras ?? "",
                  coddv: item.coddv,
                  qtd: 0,
                  seq_entrada: item.seq_entrada,
                  nf: item.nf,
                  target_conf_id: item.target_conf_id ?? null
                });
            }
            if (isOnline && !preferOfflineMode) void runPendingSync(true);
          } else {
              let targetConfId: string | null = activeVolume.remote_conf_id;
              if (activeVolume.conference_kind === "avulsa") {
                targetConfId = item.target_conf_id ?? null;
                if (!targetConfId && item.seq_entrada != null && item.nf != null) {
                  targetConfId = (await openVolume(`${item.seq_entrada}/${item.nf}`, activeVolume.cd)).conf_id;
                }
                if (!targetConfId) throw new Error("ALVO_SEQ_NF_INVALIDO");
              }
              if (!targetConfId) throw new Error("CONFERENCIA_NAO_ENCONTRADA");

              const updated = await setItemQtd(targetConfId, item.coddv, 0);
              const nowIso = new Date().toISOString();
              const nextItems = activeVolume.items
                .map((row) => {
                  const rowKey = row.item_key ?? String(row.coddv);
                  if (rowKey !== itemKey) return row;
                  return {
                    ...row,
                    barras: updated.barras ?? row.barras ?? null,
                    qtd_conferida: updated.qtd_conferida,
                    qtd_esperada: updated.qtd_esperada,
                    is_locked: updated.is_locked === true,
                    locked_by: updated.locked_by ?? null,
                    locked_mat: updated.locked_mat ?? null,
                    locked_nome: updated.locked_nome ?? null,
                    updated_at: updated.updated_at
                  };
                })
                .filter((row) => activeVolume.conference_kind !== "avulsa" || row.qtd_conferida > 0);

              const nextVolume: EntradaNotasLocalVolume = {
                ...activeVolume,
                items: nextItems.sort(itemSort),
                updated_at: nowIso,
                pending_snapshot: false,
                sync_error: null,
                last_synced_at: nowIso
              };

              if (activeVolume.conference_kind === "avulsa" && activeVolume.remote_conf_id) {
                nextVolume.avulsa_targets = await fetchAvulsaTargets(activeVolume.remote_conf_id);
                nextVolume.avulsa_queue = [];
              }

              await applyVolumeUpdate(nextVolume);
            }
            setEditingItemKey(null);
            setEditQtdInput("0");
          } catch (error) {
            const message = error instanceof Error ? error.message : "Falha ao limpar item.";
            if (await handleClosedConferenceError(message)) return;
            setErrorMessage(normalizeRpcErrorMessage(message));
          } finally {
            closeDialog();
          }
        })();
      }
    });
  }, [
    activeVolume,
    applyVolumeUpdate,
    canEditActiveVolume,
    closeDialog,
    enqueueAvulsaEvent,
    isOnline,
    preferOfflineMode,
    runPendingSync,
    showDialog,
    updateItemQtyLocal,
    handleClosedConferenceError
  ]);

  const handleFinalizeVolume = useCallback(async () => {
    if (!activeVolume) return;
    if (!canEditActiveVolume) return;

    setFinalizeError(null);
    const sobra = divergenciaTotals.sobra;
    const falta = divergenciaTotals.falta;

    setBusyFinalize(true);
    try {
      if (isCombinedRouteMode) {
        if (!isOnline) {
          setFinalizeError("A finalização da conferência conjunta exige conexão com a internet.");
          return;
        }
        const seqLabels = activeVolume.combined_seq_nf_labels ?? [];
        const confRows = activeVolume.combined_seq_conf_ids ?? [];
        const confMap = new Map<string, string>();
        for (const row of confRows) {
          const key = buildSeqNfLabelKey(row.seq_entrada, row.nf);
          const confId = String(row.conf_id ?? "").trim();
          if (!key || !confId) continue;
          confMap.set(key, confId);
        }
        const allocations = activeVolume.combined_seq_allocations ?? [];
        if (!seqLabels.length || !allocations.length) {
          setFinalizeError("Conferência conjunta sem dados para distribuir.");
          return;
        }

        for (const seqLabel of seqLabels) {
          const parsed = parseStrictSeqNfInput(seqLabel);
          if (!parsed) {
            throw new Error(`Seq/NF inválido na conferência conjunta: ${seqLabel}.`);
          }
          let targetConfId = confMap.get(parsed.label) ?? null;
          if (!targetConfId) {
            const remote = await openVolume(parsed.label, activeVolume.cd);
            if (remote.is_read_only || remote.status !== "em_conferencia") {
              throw new Error(`Seq/NF ${parsed.label} não está disponível para finalizar em lote.`);
            }
            targetConfId = remote.conf_id;
          }
          if (!targetConfId) {
            throw new Error(`Seq/NF ${parsed.label} sem vínculo remoto para finalizar em lote.`);
          }

          const payload = allocations
            .filter((row) => row.seq_entrada === parsed.seq_entrada && row.nf === parsed.nf)
            .map((row) => ({
              coddv: row.coddv,
              qtd_conferida: Math.max(0, Math.trunc(row.qtd_conferida)),
              barras: row.barras
            }));
          await syncSnapshot(targetConfId, payload);
          await finalizeVolume(targetConfId, null);
        }

        await removeLocalVolume(activeVolume.local_key);
        await refreshPendingState();
        setStatusMessage(`Conferência conjunta finalizada. Distribuição aplicada em ${seqLabels.length} Seq/NF.`);
        clearConferenceScreen();
        return;
      }

      if (preferOfflineMode || !isOnline || !activeVolume.remote_conf_id) {
        const nowIso = new Date().toISOString();
        const nextStatus = falta > 0 || sobra > 0 ? "finalizado_divergencia" : "finalizado_ok";
        const nextVolume: EntradaNotasLocalVolume = {
          ...activeVolume,
          status: nextStatus,
          falta_motivo: null,
          finalized_at: nowIso,
          is_read_only: true,
          pending_snapshot: true,
          pending_finalize: true,
          pending_finalize_reason: null,
          updated_at: nowIso,
          sync_error: null
        };
        await applyVolumeUpdate(nextVolume, false);
        setStatusMessage("Conferência finalizada localmente. Você já pode iniciar outra conferência.");
      } else {
        if (activeVolume.conference_kind === "avulsa") {
          await finalizeAvulsaVolume(activeVolume.remote_conf_id);
        } else {
          await finalizeVolume(activeVolume.remote_conf_id, null);
        }
        await removeLocalVolume(activeVolume.local_key);
        await refreshPendingState();
        setStatusMessage("Conferência finalizada com sucesso. Você já pode iniciar outra conferência.");
      }
      clearConferenceScreen();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao finalizar.";
      if (await handleClosedConferenceError(message)) return;
      setFinalizeError(normalizeRpcErrorMessage(message));
    } finally {
      setBusyFinalize(false);
    }
  }, [
    activeVolume,
    applyVolumeUpdate,
    canEditActiveVolume,
    clearConferenceScreen,
    divergenciaTotals.falta,
    divergenciaTotals.sobra,
    isCombinedRouteMode,
    isOnline,
    preferOfflineMode,
    refreshPendingState,
    handleClosedConferenceError
  ]);

  const syncRouteOverview = useCallback(async () => {
    if (currentCd == null) {
      setRouteRows([]);
      return;
    }
    if (!isOnline) {
      const local = await getRouteOverviewLocal(profile.user_id, currentCd);
      setRouteRows(local);
      return;
    }

    try {
      const rows = await fetchRouteOverview(currentCd);
      setRouteRows(rows);
      await saveRouteOverviewLocal(profile.user_id, currentCd, rows);
    } catch {
      const fallback = await getRouteOverviewLocal(profile.user_id, currentCd);
      setRouteRows(fallback);
    }
  }, [currentCd, isOnline, profile.user_id]);

  const openRoutesModal = useCallback(async () => {
    setRouteSearchInput("");
    setExpandedRoute(null);
    setRouteBatchSelectionByGroup({});
    setShowRoutesModal(true);
    await syncRouteOverview();
  }, [syncRouteOverview]);

  useEffect(() => {
    if (routeBatchQueue.length === 0) return;
    if (busyOpenVolume) return;
    if (hasOpenConference) return;
    if (routeBatchDispatchingRef.current) return;

    const [nextSeqNf, ...remaining] = routeBatchQueue;
    routeBatchDispatchingRef.current = true;
    setRouteBatchQueue(remaining);
    setEtiquetaInput(nextSeqNf);
    setErrorMessage(null);
    setStatusMessage(
      remaining.length > 0
        ? `Abrindo Seq/NF ${nextSeqNf}. Restam ${remaining.length} no lote.`
        : `Abrindo Seq/NF ${nextSeqNf}.`
    );

    void openVolumeFromEtiqueta(nextSeqNf).finally(() => {
      routeBatchDispatchingRef.current = false;
    });
  }, [busyOpenVolume, hasOpenConference, openVolumeFromEtiqueta, routeBatchQueue]);

  const markStorePendingAfterCancel = useCallback(async (volume: EntradaNotasLocalVolume) => {
    if (volume.filial == null) return;
    if (routeRows.length === 0) return;

    const nextRows = routeRows.map((row) => {
      if (row.filial !== volume.filial) return row;
      const totalEtiquetas = Math.max(row.total_etiquetas, 0);
      const adjustedConferidas =
        totalEtiquetas > 0 && row.conferidas >= totalEtiquetas
          ? Math.max(totalEtiquetas - 1, 0)
          : Math.max(row.conferidas, 0);
      const adjustedPendentes = Math.max(totalEtiquetas - adjustedConferidas, 0);

      return {
        ...row,
        conferidas: adjustedConferidas,
        pendentes: adjustedPendentes,
        status: "pendente" as const,
        colaborador_nome: null,
        colaborador_mat: null,
        status_at: null
      };
    });

    setRouteRows(nextRows);
    if (currentCd === volume.cd) {
      await saveRouteOverviewLocal(profile.user_id, volume.cd, nextRows);
    }
  }, [currentCd, profile.user_id, routeRows]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 980px)");
    const onChange = () => setIsDesktop(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadInitial = async () => {
      try {
        await cleanupExpiredEntradaNotasVolumes(profile.user_id);
        const prefs = await getEntradaNotasPreferences(profile.user_id);
        if (cancelled) return;
        setPreferOfflineMode(prefs.prefer_offline_mode);
        setMultiploInput(String(Math.max(1, prefs.multiplo_padrao)));

        if (isGlobalAdmin) {
          if (isOnline) {
            const options = await fetchCdOptions();
            if (cancelled) return;
            setCdOptions(options);
            const preferred = prefs.cd_ativo ?? options[0]?.cd ?? null;
            setCdAtivo(preferred);
          } else {
            setCdAtivo(prefs.cd_ativo ?? null);
          }
        } else {
          setCdAtivo(fixedCd);
        }

        await refreshPendingState();
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Falha ao carregar módulo Entrada de Notas.";
        setErrorMessage(normalizeRpcErrorMessage(message));
      }
    };

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [fixedCd, isGlobalAdmin, isOnline, profile.user_id, refreshPendingState]);

  useEffect(() => {
    if (currentCd == null) return;
    void persistPreferences({ cd_ativo: currentCd });
  }, [currentCd, persistPreferences]);

  useEffect(() => {
    setRouteContributorsMap({});
    routeContributorsInFlightRef.current.clear();
    routeBatchDispatchingRef.current = false;
    setRouteBatchSelectionByGroup({});
    setRouteBatchQueue([]);
  }, [currentCd]);

  useEffect(() => {
    if (!showRoutesModal || !isOnline || currentCd == null) return;
    const targetRows = routeRows.filter((row) => {
      const status = normalizeStoreStatus(row.status);
      return status === "concluido" || status === "em_andamento";
    });
    for (const row of targetRows) {
      void ensureRouteRowContributors(row);
    }
  }, [currentCd, ensureRouteRowContributors, isOnline, routeRows, showRoutesModal]);

  useEffect(() => {
    if (currentCd == null) {
      setManifestReady(false);
      setManifestInfo("");
      setOfflineBaseState({
        entrada_ready: false,
        barras_ready: false,
        stale: true,
        entrada_rows: 0,
        barras_rows: 0,
        entrada_updated_at: null,
        barras_updated_at: null
      });
      setRouteRows([]);
      setActiveVolume(null);
      return;
    }

    let cancelled = false;
    const loadLocalContext = async () => {
      const [localMeta, localRoutes, volumes, barrasMeta] = await Promise.all([
        getManifestMetaLocal(profile.user_id, currentCd),
        getRouteOverviewLocal(profile.user_id, currentCd),
        listUserLocalVolumes(profile.user_id),
        getDbBarrasMeta()
      ]);
      if (cancelled) return;

      const nextBaseState = buildOfflineBaseState({
        entradaRows: localMeta?.row_count ?? 0,
        barrasRows: barrasMeta.row_count,
        entradaUpdatedAt: localMeta?.cached_at ?? localMeta?.generated_at,
        barrasUpdatedAt: barrasMeta.last_sync_at
      });
      setOfflineBaseState(nextBaseState);
      setManifestReady(nextBaseState.entrada_ready && nextBaseState.barras_ready);
      setManifestInfo(
        buildManifestInfoLine({
          termoRows: localMeta?.row_count ?? 0,
          barrasRows: barrasMeta.row_count,
          termoUpdatedAt: localMeta?.cached_at ?? localMeta?.generated_at,
          barrasUpdatedAt: barrasMeta.last_sync_at,
          hasEntradaNotasBase: Boolean(localMeta && localMeta.row_count > 0)
        })
      );
      setRouteRows(localRoutes);

      const latestOpen = volumes.find((row) => {
        const isCombinedLocalConference = (
          row.conference_kind === "avulsa"
          && (row.combined_seq_nf_labels?.length ?? 0) > 0
        );
        return (
          row.status === "em_conferencia"
          && !row.is_read_only
          && (row.conference_kind !== "avulsa" || isCombinedLocalConference)
        );
      }) ?? null;
      if (latestOpen) {
        if (isGlobalAdmin && latestOpen.cd !== currentCd) {
          setCdAtivo(latestOpen.cd);
          return;
        }
        if (latestOpen.cd === currentCd) {
          setActiveVolume(latestOpen);
          setEtiquetaInput(latestOpen.nr_volume);
          return;
        }
      }

      const today = todayIsoBrasilia();
      const latestToday = volumes.find((row) => {
        const isCombinedLocalConference = (
          row.conference_kind === "avulsa"
          && (row.combined_seq_nf_labels?.length ?? 0) > 0
        );
        return (
          row.cd === currentCd
          && row.conf_date === today
          && (row.conference_kind !== "avulsa" || isCombinedLocalConference)
          && (row.status === "em_conferencia" || row.pending_snapshot || row.pending_finalize || row.pending_cancel)
        );
      });
      if (latestToday) {
        let resolvedLatest = latestToday;
        if (
          isOnline
          && latestToday.conference_kind === "seq_nf"
          && !latestToday.pending_snapshot
          && !latestToday.pending_finalize
          && !latestToday.pending_cancel
        ) {
          try {
            resolvedLatest = await fetchSeqNfVolumeSnapshot(latestToday.nr_volume, latestToday.cd);
          } catch {
            // Mantém cache local se não conseguir atualizar snapshot remoto.
          }
        }
        setActiveVolume(resolvedLatest);
        setEtiquetaInput(resolvedLatest.nr_volume);
      } else {
        setActiveVolume(null);
        setEtiquetaInput("");
      }

      if (!isOnline) return;

      try {
        const resumed = await resumeRemoteActiveVolume(true, { includeAvulsa: false });
        if (cancelled || !resumed) return;
        if (isGlobalAdmin && resumed.cd !== currentCd) {
          setCdAtivo(resumed.cd);
          return;
        }
        if (resumed.cd === currentCd) {
          setActiveVolume(resumed);
          setEtiquetaInput(resumed.nr_volume);
        }
      } catch {
        // Mantém apenas contexto local quando não for possível retomar remoto.
      }
    };

    void loadLocalContext();
    return () => {
      cancelled = true;
    };
  }, [currentCd, fetchSeqNfVolumeSnapshot, isGlobalAdmin, isOnline, profile.user_id, resumeRemoteActiveVolume]);

  useEffect(() => {
    void refreshPendingState();
  }, [refreshPendingState]);

  useEffect(() => {
    if (!isOnline) return;
    if (pendingCount <= 0) return;
    const timer = window.setTimeout(() => {
      void runPendingSync(true);
    }, PREFERRED_SYNC_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isOnline, pendingCount, runPendingSync]);

  useEffect(() => {
    if (!scannerOpen) return;

    let cancelled = false;
    let nativeFrameId: number | null = null;
    let nativeStream: MediaStream | null = null;
    let torchProbeTimer: number | null = null;
    let torchProbeAttempts = 0;
    setScannerError(null);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTorchModeRef.current = "none";

    const startScanner = async () => {
      try {
        const videoEl = scannerVideoRef.current;
        if (!videoEl) {
          setScannerError("Falha ao abrir visualização da câmera.");
          return;
        }

        const nativeBarcodeDetectorCtor = (window as Window & {
          BarcodeDetector?: new (options?: { formats?: string[] }) => {
            detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
          };
        }).BarcodeDetector;

        if (nativeBarcodeDetectorCtor && typeof navigator.mediaDevices?.getUserMedia === "function") {
          try {
            const formats = scannerTarget === "etiqueta"
              ? [
                  "qr_code",
                  "code_128",
                  "code_39",
                  "ean_13",
                  "ean_8",
                  "upc_a",
                  "upc_e",
                  "itf",
                  "codabar",
                  "data_matrix",
                  "pdf417",
                  "aztec"
                ]
              : [
                  "code_128",
                  "code_39",
                  "ean_13",
                  "ean_8",
                  "upc_a",
                  "upc_e",
                  "itf",
                  "codabar"
                ];
            const detector = new nativeBarcodeDetectorCtor({ formats });
            nativeStream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
              }
            });
            if (cancelled) {
              nativeStream.getTracks().forEach((track) => track.stop());
              nativeStream = null;
              return;
            }

            videoEl.srcObject = nativeStream;
            await videoEl.play().catch(() => undefined);
            const track = nativeStream.getVideoTracks()[0] ?? null;
            if (track) scannerTrackRef.current = track;

            const runNativeDetect = async () => {
              if (cancelled) return;
              try {
                const detections = await detector.detect(videoEl);
                const first = detections[0];
                const scanned = normalizeBarcode(first?.rawValue ?? "");
                if (scanned) {
                  setScannerOpen(false);
                  stopScanner();
                  setScannerError(null);
                  if (scannerTarget === "etiqueta") {
                    setEtiquetaInput(scanned);
                    void openConferenceFromInput(scanned);
                  } else {
                    setBarcodeInput(scanned);
                    void handleCollectBarcode(scanned);
                  }
                  return;
                }
              } catch {
                // Mantem polling silencioso enquanto a camera busca foco.
              }
              nativeFrameId = window.requestAnimationFrame(() => {
                void runNativeDetect();
              });
            };

            nativeFrameId = window.requestAnimationFrame(() => {
              void runNativeDetect();
            });

            const probeTorchAvailabilityNative = () => {
              if (cancelled) return;
              const activeTrack = resolveScannerTrack();
              if (activeTrack) scannerTrackRef.current = activeTrack;
              if (supportsTrackTorch(activeTrack)) {
                scannerTorchModeRef.current = "track";
                setTorchSupported(true);
              } else {
                scannerTorchModeRef.current = "none";
                setTorchSupported(false);
              }
            };
            probeTorchAvailabilityNative();
            return;
          } catch {
            if (nativeStream) {
              nativeStream.getTracks().forEach((track) => track.stop());
              nativeStream = null;
            }
          }
        }

        const zxing = await import("@zxing/browser");
        if (cancelled) return;

        const reader = new zxing.BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: { facingMode: { ideal: "environment" } }
          },
          videoEl,
          (result, error) => {
            if (cancelled) return;
            if (result) {
              const formatName = result.getBarcodeFormat?.().toString?.() ?? "";
              if (scannerTarget !== "etiqueta" && /QR_CODE/i.test(formatName)) return;
              const scanned = normalizeBarcode(result.getText() ?? "");
              if (!scanned) return;
              setScannerOpen(false);
              stopScanner();
              setScannerError(null);
              if (scannerTarget === "etiqueta") {
                setEtiquetaInput(scanned);
                void openConferenceFromInput(scanned);
              } else {
                setBarcodeInput(scanned);
                void handleCollectBarcode(scanned);
              }
              return;
            }

            const errorName = (error as { name?: string } | null)?.name;
            if (error && errorName !== "NotFoundException" && errorName !== "ChecksumException" && errorName !== "FormatException") {
              setScannerError("Não foi possível ler o código. Ajuste foco/distância e tente novamente.");
            }
          }
        );

        if (cancelled) {
          controls.stop();
          return;
        }

        scannerControlsRef.current = controls;
        const probeTorchAvailability = () => {
          if (cancelled) return;
          const track = resolveScannerTrack();
          if (track) scannerTrackRef.current = track;
          if (supportsTrackTorch(track)) {
            scannerTorchModeRef.current = "track";
            setTorchSupported(true);
            return;
          }
          if (typeof controls.switchTorch === "function") {
            scannerTorchModeRef.current = "controls";
            setTorchSupported(true);
            return;
          }
          if (torchProbeAttempts < 10) {
            torchProbeAttempts += 1;
            torchProbeTimer = window.setTimeout(probeTorchAvailability, 120);
            return;
          }
          scannerTorchModeRef.current = "none";
          setTorchSupported(false);
        };

        probeTorchAvailability();
      } catch (error) {
        setScannerError(error instanceof Error ? error.message : "Falha ao iniciar câmera.");
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      if (nativeFrameId != null) window.cancelAnimationFrame(nativeFrameId);
      if (nativeStream) {
        nativeStream.getTracks().forEach((track) => track.stop());
        nativeStream = null;
      }
      if (torchProbeTimer != null) window.clearTimeout(torchProbeTimer);
      stopScanner();
    };
  }, [handleCollectBarcode, openConferenceFromInput, resolveScannerTrack, scannerOpen, scannerTarget, stopScanner, supportsTrackTorch]);

  const toggleTorch = async () => {
    const controls = scannerControlsRef.current;
    const track = scannerTrackRef.current ?? resolveScannerTrack();
    const hasTrackTorch = supportsTrackTorch(track);
    if (!controls?.switchTorch && !hasTrackTorch) {
      setScannerError("Flash não disponível neste dispositivo.");
      return;
    }
    try {
      const next = !torchEnabled;
      if (hasTrackTorch && track) {
        const trackWithConstraints = track as MediaStreamTrack & {
          applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
        };
        if (!trackWithConstraints || typeof trackWithConstraints.applyConstraints !== "function") {
          throw new Error("Flash indisponível");
        }
        await trackWithConstraints.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
        if (next) {
          window.setTimeout(() => {
            void trackWithConstraints
              .applyConstraints?.({ advanced: [{ torch: true } as MediaTrackConstraintSet] })
              .catch(() => undefined);
          }, 140);
        }
        scannerTorchModeRef.current = "track";
      } else if (controls?.switchTorch) {
        await controls.switchTorch(next);
        scannerTorchModeRef.current = "controls";
      }
      setTorchEnabled(next);
      setScannerError(null);
    } catch {
      setScannerError("Não foi possível alternar o flash.");
    }
  };

  const clearScannerInputTimer = useCallback((target: ScannerInputTarget) => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current[target];
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const commitScannerInput = useCallback(async (target: ScannerInputTarget, rawValue: string) => {
    const normalized = target === "etiqueta" ? rawValue.replace(/\s+/g, "").trim() : normalizeBarcode(rawValue);
    if (!normalized) return;

    const state = scannerInputStateRef.current[target];
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (
      state.lastSubmittedValue === normalized
      && now - state.lastSubmittedAt < SCANNER_INPUT_SUBMIT_COOLDOWN_MS
    ) {
      return;
    }

    clearScannerInputTimer(target);
    state.lastSubmittedValue = normalized;
    state.lastSubmittedAt = now;
    state.lastInputAt = 0;
    state.lastLength = 0;
    state.burstChars = 0;

    if (target === "etiqueta") {
      setEtiquetaInput(normalized);
      await openConferenceFromInput(normalized);
      return;
    }

    setBarcodeInput(normalized);
    await handleCollectBarcode(normalized);
  }, [clearScannerInputTimer, handleCollectBarcode, openConferenceFromInput]);

  const scheduleScannerInputAutoSubmit = useCallback((target: ScannerInputTarget, value: string) => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current[target];
    clearScannerInputTimer(target);
    state.timerId = window.setTimeout(() => {
      state.timerId = null;
      void commitScannerInput(target, value);
    }, SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS);
  }, [clearScannerInputTimer, commitScannerInput]);

  const handleScannerInputChange = useCallback((target: ScannerInputTarget, value: string) => {
    const state = scannerInputStateRef.current[target];
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsed = state.lastInputAt > 0 ? now - state.lastInputAt : Number.POSITIVE_INFINITY;
    const lengthDelta = Math.max(value.length - state.lastLength, 0);

    if (lengthDelta > 0 && elapsed <= SCANNER_INPUT_MAX_INTERVAL_MS) {
      state.burstChars += lengthDelta;
    } else {
      state.burstChars = lengthDelta;
    }
    state.lastInputAt = now;
    state.lastLength = value.length;

    if (!value) {
      state.burstChars = 0;
      clearScannerInputTimer(target);
      return;
    }

    if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) {
      scheduleScannerInputAutoSubmit(target, value);
      return;
    }

    clearScannerInputTimer(target);
  }, [clearScannerInputTimer, scheduleScannerInputAutoSubmit]);

  const onSubmitEtiqueta = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await commitScannerInput("etiqueta", etiquetaInput);
  };

  const onSubmitBarras = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await commitScannerInput("barras", barcodeInput);
  };

  const onEtiquetaInputChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setEtiquetaInput(nextValue);
    handleScannerInputChange("etiqueta", nextValue);
  };

  const onBarcodeInputChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setBarcodeInput(nextValue);
    setBarcodeValidationState("idle");
    handleScannerInputChange("barras", nextValue);
  };

  const onMultiploChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/\D/g, "");
    if (!digits) {
      setMultiploInput("");
      return;
    }
    const parsed = Number.parseInt(digits, 10);
    setMultiploInput(Number.isFinite(parsed) ? String(Math.max(1, parsed)) : "1");
  };

  const shouldHandleScannerTab = (target: ScannerInputTarget, value: string): boolean => {
    if (!value.trim()) return false;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const state = scannerInputStateRef.current[target];
    if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) return true;
    if (state.lastInputAt <= 0) return false;
    return now - state.lastInputAt <= SCANNER_INPUT_MAX_INTERVAL_MS * 2;
  };

  const onEtiquetaKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !shouldHandleScannerTab("etiqueta", etiquetaInput)) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    void commitScannerInput("etiqueta", etiquetaInput);
  };

  const onBarcodeKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !shouldHandleScannerTab("barras", barcodeInput)) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    void commitScannerInput("barras", barcodeInput);
  };

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      const state = scannerInputStateRef.current;
      for (const target of ["etiqueta", "barras"] as const) {
        if (state[target].timerId != null) {
          window.clearTimeout(state[target].timerId);
          state[target].timerId = null;
        }
      }
    };
  }, []);

  const handleToggleOffline = async () => {
    const next = !preferOfflineMode;
    setPreferOfflineMode(next);
    await persistPreferences({ prefer_offline_mode: next });
    if (next) {
      if (isOnline) {
        setStatusMessage("Modo offline ativado. A base será sincronizada em segundo plano.");
        if (!busyManifest) {
          void prepareOfflineManifest(false, true).catch((error) => {
            const message = error instanceof Error ? error.message : "Falha ao preparar base offline.";
            setErrorMessage(normalizeRpcErrorMessage(message));
          });
        }
      } else if (manifestReady) {
        setStatusMessage("Modo offline ativado com base local existente.");
      } else {
        setErrorMessage("Sem base local da Entrada de Notas. Conecte-se para sincronizar a base offline.");
      }
      return;
    }
    setStatusMessage("Modo online ativado.");
  };

  const requestFinalize = () => {
    if (!activeVolume || !hasAnyItemInformed) return;
    setFinalizeError(null);
    setShowFinalizeModal(true);
  };

  const requestCancelConference = useCallback(() => {
    if (!activeVolume || !canEditActiveVolume) return;
    const isCombinedMode = (
      activeVolume.conference_kind === "avulsa"
      && (activeVolume.combined_seq_nf_labels?.length ?? 0) > 0
    );
    const preserveAlreadyCountedData = shouldProtectPartialResumeOnCancel;
    const preserveReasonLabel =
      hasItemsLockedByOtherUser || hasOtherUserContributors
        ? "por outro usuário"
        : hasInformedItemsFromPreviousSession
          ? "em sessão anterior"
          : "em outro momento";

    showDialog({
      title: isCombinedMode ? "Cancelar conferência conjunta" : "Cancelar conferência",
      message: preserveAlreadyCountedData
        ? `A conferência do Seq/NF ${activeVolume.nr_volume} possui itens já conferidos ${preserveReasonLabel}.\n\n`
          + "Ao confirmar, esta retomada será encerrada mantendo tudo que já foi conferido (não haverá descarte)."
        : isCombinedMode
          ? "A conferência conjunta será cancelada e os Seq/NF serão liberados. Deseja continuar?"
        : activeVolume.conference_kind === "avulsa"
          ? "A conferência avulsa será cancelada e todos os dados lançados serão perdidos. Deseja continuar?"
          : `A conferência do Seq/NF ${activeVolume.nr_volume} será cancelada e todos os dados lançados serão perdidos. Deseja continuar?`,
      confirmLabel: preserveAlreadyCountedData ? "Encerrar mantendo dados" : "Cancelar conferência",
      cancelLabel: "Voltar",
      onConfirm: () => {
        void (async () => {
          closeDialog();
          setBusyCancel(true);
          setErrorMessage(null);
          setStatusMessage(null);

          try {
            const isCombinedMode = (
              activeVolume.conference_kind === "avulsa"
              && (activeVolume.combined_seq_nf_labels?.length ?? 0) > 0
            );
            if (isCombinedMode) {
              if (!isOnline) {
                setErrorMessage("A conferência conjunta precisa de internet para cancelar e liberar os Seq/NF.");
                return;
              }
              const combinedConfIds = [...new Set(
                (activeVolume.combined_seq_conf_ids ?? [])
                  .map((row) => String(row.conf_id ?? "").trim())
                  .filter(Boolean)
              )];
              if (combinedConfIds.length === 0) {
                throw new Error("Conferência conjunta sem vínculos remotos para cancelamento.");
              }
              const cancelledRows = await cancelVolumeBatch(combinedConfIds);
              const cancelledSet = new Set(
                cancelledRows
                  .filter((entry) => entry.cancelled)
                  .map((entry) => entry.conf_id)
              );
              const missingCancels = combinedConfIds.filter((confId) => !cancelledSet.has(confId));
              if (missingCancels.length > 0) {
                throw new Error(`Falha ao cancelar ${missingCancels.length} de ${combinedConfIds.length} Seq/NF da conferência conjunta.`);
              }

              await removeLocalVolume(activeVolume.local_key);
              await refreshPendingState();
              clearConferenceScreen();
              setStatusMessage("Conferência conjunta cancelada. Os Seq/NF foram liberados.");
              await syncRouteOverview();
              return;
            }

            if (preserveAlreadyCountedData) {
              if (activeVolume.remote_conf_id && isOnline) {
                await finalizeVolume(activeVolume.remote_conf_id, null);
                await removeLocalVolume(activeVolume.local_key);
                await refreshPendingState();
                clearConferenceScreen();
                setStatusMessage("Retomada encerrada. Os dados já conferidos foram preservados.");
                await syncRouteOverview();
                return;
              }

              if (activeVolume.remote_conf_id && !isOnline) {
                const nowIso = new Date().toISOString();
                const hasDivergencia = activeVolume.items.some((item) => item.qtd_conferida !== item.qtd_esperada);
                const nextStatus = hasDivergencia ? "finalizado_divergencia" : "finalizado_ok";
                const nextVolume: EntradaNotasLocalVolume = {
                  ...activeVolume,
                  status: nextStatus,
                  finalized_at: nowIso,
                  is_read_only: true,
                  pending_snapshot: activeVolume.pending_snapshot,
                  pending_finalize: true,
                  pending_cancel: false,
                  pending_finalize_reason: null,
                  sync_error: null,
                  updated_at: nowIso
                };
                await saveLocalVolume(nextVolume);
                await refreshPendingState();
                clearConferenceScreen();
                setStatusMessage("Retomada encerrada localmente. A finalização será enviada ao reconectar.");
                return;
              }
            }

            if (activeVolume.remote_conf_id && isOnline) {
              if (activeVolume.conference_kind === "avulsa") {
                await cancelAvulsaVolume(activeVolume.remote_conf_id);
              } else {
                await cancelVolume(activeVolume.remote_conf_id);
              }
              await removeLocalVolume(activeVolume.local_key);
              await markStorePendingAfterCancel(activeVolume);
              await refreshPendingState();
              clearConferenceScreen();
              setStatusMessage("Conferência cancelada. Os dados foram descartados.");
              await syncRouteOverview();
              return;
            }

            if (activeVolume.remote_conf_id && !isOnline) {
              const nowIso = new Date().toISOString();
              const nextVolume: EntradaNotasLocalVolume = {
                ...activeVolume,
                pending_cancel: true,
                pending_snapshot: false,
                pending_finalize: false,
                pending_finalize_reason: null,
                sync_error: null,
                updated_at: nowIso
              };
              await saveLocalVolume(nextVolume);
              await markStorePendingAfterCancel(activeVolume);
              await refreshPendingState();
              clearConferenceScreen();
              setStatusMessage("Conferência cancelada localmente. A remoção no banco ocorrerá ao reconectar.");
              return;
            }

            await removeLocalVolume(activeVolume.local_key);
            await markStorePendingAfterCancel(activeVolume);
            await refreshPendingState();
            clearConferenceScreen();
            setStatusMessage("Conferência cancelada. Os dados locais foram descartados.");
          } catch (error) {
            const message = error instanceof Error ? error.message : "Falha ao cancelar conferência.";
            if (await handleClosedConferenceError(message)) return;
            setErrorMessage(normalizeRpcErrorMessage(message));
          } finally {
            setBusyCancel(false);
          }
        })();
      }
    });
  }, [
    activeVolume,
    canEditActiveVolume,
    clearConferenceScreen,
    closeDialog,
    isOnline,
    markStorePendingAfterCancel,
    refreshPendingState,
    showDialog,
    hasInformedItemsFromPreviousSession,
    hasItemsLockedByOtherUser,
    hasOtherUserContributors,
    shouldProtectPartialResumeOnCancel,
    syncRouteOverview,
    handleClosedConferenceError
  ]);

  const showOnlineBadge = (
    <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
      {isOnline ? "🟢 Online" : "🔴 Offline"}
    </span>
  );

  return (
    <>
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
            <span className="module-back-icon" aria-hidden="true">
              <BackIcon />
            </span>
            <span>Início</span>
          </Link>

          <div className="module-topbar-user-side">
            <PendingSyncBadge
              pendingCount={pendingCount}
              errorCount={pendingErrors}
              title="Conferências pendentes de envio"
            />
            {showOnlineBadge}
          </div>
        </div>

        <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
          <span className="module-icon" aria-hidden="true">
            <ModuleIcon name={MODULE_DEF.icon} />
          </span>
          <span className="module-title">{MODULE_DEF.title}</span>
        </div>
      </header>

      <section className="modules-shell termo-shell">
        <div className="termo-head">
          <h2>Olá, {displayUserName}</h2>
          <p>Para trabalhar offline, sincronize a base de Entrada de Notas.</p>
          {manifestInfo ? <p className="termo-meta-line">{manifestInfo}</p> : null}
          <div className={`entrada-base-status is-${offlineBaseBadge.overall}`}>
            <span className="entrada-base-status-title">Bases offline: {offlineBaseBadge.overallLabel}</span>
            <span className={`entrada-base-chip${offlineBaseState.entrada_ready ? " is-ready" : ""}`}>
              db_entrada_notas {offlineBaseState.entrada_ready ? "OK" : "pendente"}
            </span>
            <span className={`entrada-base-chip${offlineBaseState.barras_ready ? " is-ready" : ""}`}>
              db_barras {offlineBaseState.barras_ready ? "OK" : "pendente"}
            </span>
          </div>
        </div>

        <div className="termo-actions-row">
          <button type="button" className="btn btn-muted termo-sync-btn" onClick={() => void runPendingSync()} disabled={busySync}>
            <span aria-hidden="true">{refreshIcon()}</span>
            {busySync ? "Sincronizando..." : "Sincronizar agora"}
          </button>

          {!isDesktop ? (
            <button
              type="button"
              className={`btn btn-muted termo-offline-toggle${preferOfflineMode ? " is-active" : ""}`}
              onClick={() => void handleToggleOffline()}
              disabled={busyManifest}
            >
              {preferOfflineMode ? "📦 Offline ativo" : "📶 Trabalhar offline"}
            </button>
          ) : null}

          <button type="button" className="btn btn-muted termo-route-btn" onClick={() => void openRoutesModal()}>
            <span aria-hidden="true">{listIcon()}</span>
            Transportadora/Fornecedor
          </button>
        </div>

        {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
        {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
        {progressMessage ? <div className="alert success">{progressMessage}</div> : null}
        {routeBatchQueue.length > 0 ? (
          <div className="alert success entrada-notas-route-batch-queue">
            <span>Lote ativo: {routeBatchQueue.length} Seq/NF pendente(s).</span>
            <button
              type="button"
              className="btn btn-muted"
              onClick={() => {
                routeBatchDispatchingRef.current = false;
                setRouteBatchQueue([]);
                setStatusMessage("Lote cancelado.");
              }}
            >
              Cancelar lote
            </button>
          </div>
        ) : null}
        {scanFeedback ? (
          <div
            key={scanFeedback.id}
            className={`termo-scan-feedback ${scanFeedback.tone === "error" ? "is-error" : "is-success"}`}
            role="status"
            aria-live="polite"
            style={scanFeedbackTop != null ? { top: `${scanFeedbackTop}px` } : undefined}
          >
            <strong>{scanFeedback.tone === "error" ? "Erro" : scanFeedback.title}</strong>
            {scanFeedback.detail ? <span>{scanFeedback.detail}</span> : null}
          </div>
        ) : null}

        {isGlobalAdmin ? (
          <div className="termo-cd-selector">
            <label>
              CD
              <select
                value={cdAtivo ?? ""}
                onChange={(event) => setCdAtivo(Number.parseInt(event.target.value, 10))}
              >
                <option value="" disabled>Selecione o CD</option>
                {cdOptions.map((option) => (
                  <option key={option.cd} value={option.cd}>
                    {option.cd_nome || `CD ${String(option.cd).padStart(2, "0")}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {!hasOpenConference ? (
          <form className="termo-form termo-open-form" onSubmit={onSubmitEtiqueta}>
            <h3>Abertura de conferência</h3>
            <label>
              Seq/NF ou código de barras
              <div className="input-icon-wrap with-action">
                <span className="field-icon" aria-hidden="true">{barcodeIcon()}</span>
                <input
                  ref={etiquetaRef}
                  type="text"
                  value={etiquetaInput}
                  onChange={onEtiquetaInputChange}
                  onKeyDown={onEtiquetaKeyDown}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Informe Seq/NF ou barras"
                  required
                />
                <button
                  type="button"
                  className="input-action-btn"
                  onClick={() => openScannerFor("etiqueta")}
                  title="Ler código de abertura pela câmera"
                  aria-label="Ler código de abertura pela câmera"
                  disabled={!cameraSupported}
                >
                  {cameraIcon()}
                </button>
              </div>
            </label>
            <div className="confirm-actions">
              <button className="btn btn-primary" type="submit" disabled={busyOpenVolume || currentCd == null}>
                {busyOpenVolume ? "Abrindo..." : "Iniciar conferência"}
              </button>
            </div>
          </form>
        ) : null}

        {activeVolume ? (
          <article className="termo-volume-card">
            <div className="termo-volume-head">
              <div>
                <h3>
                  {isCombinedRouteMode
                    ? `Conferência conjunta ${activeVolume.combined_seq_transportadora ?? activeVolume.transportadora ?? activeVolume.rota ?? ""}`.trim()
                    : `Conferência ${activeVolume.nr_volume}`}
                </h3>
                <p>
                  Transportadora: {activeVolume.transportadora ?? activeVolume.rota ?? "SEM TRANSPORTADORA"}
                  {" | "}
                  Fornecedor: {activeVolume.fornecedor ?? activeVolume.filial_nome ?? "SEM FORNECEDOR"}
                  {" | "}
                  {activeVolume.conference_kind === "avulsa" ? "Modo: " : "Seq/NF: "}
                  <strong>
                    {isCombinedRouteMode
                      ? "Conferência conjunta"
                      : activeVolume.conference_kind === "avulsa"
                        ? "Conferência Avulsa"
                        : activeVolume.nr_volume}
                  </strong>
                </p>
                <p>
                  Status: {activeVolume.status === "em_conferencia" ? "Em conferência" : activeVolume.status === "finalizado_ok" ? "Finalizado sem divergência" : "Finalizado com divergência"}
                </p>
                {isCombinedRouteMode ? (
                  <p className="entrada-notas-contributors">
                    Seq/NF em conferência: {combinedSeqNfLabels.join(", ")}
                  </p>
                ) : null}
                {activeVolume.conference_kind !== "avulsa" && activeContributorsLabel ? (
                  <p className="entrada-notas-contributors">Colaboradores: {activeContributorsLabel}</p>
                ) : null}
              </div>
              <div className="termo-volume-head-right">
                <span
                  className={`coleta-row-status ${activeVolume.sync_error ? "error" : activeVolume.pending_snapshot || activeVolume.pending_finalize || activeVolume.pending_cancel ? "pending" : "synced"}`}
                  title={activeVolume.sync_error ?? undefined}
                >
                  {activeVolume.sync_error ? "Erro de sync" : activeVolume.pending_snapshot || activeVolume.pending_finalize || activeVolume.pending_cancel ? "Pendente sync" : "Sincronizado"}
                </span>
                {canEditActiveVolume ? (
                  <div className="termo-volume-actions">
                    <button
                      className="btn btn-danger termo-cancel-btn"
                      type="button"
                      onClick={requestCancelConference}
                      disabled={busyCancel || busyFinalize}
                      title="Cancelar conferência"
                    >
                      <span aria-hidden="true">{closeIcon()}</span>
                      {busyCancel ? "Cancelando..." : "Cancelar"}
                    </button>
                    {hasAnyItemInformed ? (
                      <button
                        className="btn btn-primary termo-finalize-btn"
                        type="button"
                        onClick={requestFinalize}
                        disabled={busyCancel || busyFinalize}
                      >
                        <span aria-hidden="true">{checkIcon()}</span>
                        Finalizar
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <form className="termo-form termo-scan-form" onSubmit={onSubmitBarras}>
              <h4>Conferência de produtos</h4>
              <div className="termo-scan-grid">
                <label>
                  Código de barras
                  <div className="input-icon-wrap with-action">
                    <span className={barcodeIconClassName} aria-hidden="true">{barcodeIcon()}</span>
                    <input
                      ref={barrasRef}
                      type="text"
                      inputMode={barcodeInputMode}
                      value={barcodeInput}
                      onChange={onBarcodeInputChange}
                      onKeyDown={onBarcodeKeyDown}
                      onPointerDown={enableBarcodeSoftKeyboard}
                      onBlur={disableBarcodeSoftKeyboard}
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="Bipe, digite ou use câmera"
                      disabled={!canEditActiveVolume}
                    />
                    <button
                      type="button"
                      className="input-action-btn"
                      onClick={() => openScannerFor("barras")}
                      title="Ler barras pela câmera"
                      aria-label="Ler barras pela câmera"
                      disabled={!cameraSupported || !canEditActiveVolume}
                    >
                      {cameraIcon()}
                    </button>
                  </div>
                </label>

                <label>
                  Múltiplo
                  <div className="input-icon-wrap">
                    <span className="field-icon" aria-hidden="true">{quantityIcon()}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={multiploInput}
                      onFocus={(event) => event.currentTarget.select()}
                      onClick={(event) => event.currentTarget.select()}
                      onChange={onMultiploChange}
                      disabled={!canEditActiveVolume}
                    />
                  </div>
                </label>
              </div>
              <button className="btn btn-primary" type="submit" disabled={!canEditActiveVolume}>
                Registrar leitura
              </button>
            </form>

            <div className="termo-list-block">
              <h4>Falta ({groupedItems.falta.length})</h4>
              {groupedItems.falta.length === 0 ? (
                <div className="coleta-empty">Sem itens com falta.</div>
              ) : (
                groupedItems.falta.map(({ item, qtd_falta, qtd_sobra }) => {
                  const itemKey = item.item_key ?? String(item.coddv);
                  const isItemLocked = item.is_locked === true;
                  const isLastAddedItem = activeLastAddedItemKey === itemKey;
                  return (
                  <article key={`falta-${itemKey}`} className={`termo-item-card${expandedItemKey === itemKey ? " is-expanded" : ""}${isLastAddedItem ? " is-last-added" : ""}`}>
                    <button type="button" className="termo-item-line" onClick={() => setExpandedItemKey((current) => current === itemKey ? null : itemKey)}>
                      <div className="termo-item-main">
                        <strong>{item.descricao}</strong>
                        <p>Código: {item.coddv}</p>
                        {item.seq_entrada != null && item.nf != null ? (
                          <p>Seq/NF: {item.seq_entrada}/{item.nf}</p>
                        ) : isCombinedRouteMode ? (
                          <p>Conferência conjunta: {combinedSeqNfLabels.length} Seq/NF</p>
                        ) : null}
                        {item.qtd_conferida > 0 ? (
                          <p>Barras: {item.barras ?? "-"}</p>
                        ) : null}
                        <p>Esperada: {item.qtd_esperada} | Conferida: {item.qtd_conferida} | Pendente: {Math.max(item.qtd_esperada - item.qtd_conferida, 0)}</p>
                      </div>
                      <div className="termo-item-side">
                        {isLastAddedItem ? (
                          <span className="termo-last-added-tag">
                            <span className="termo-last-added-tag-icon" aria-hidden="true">{barcodeIcon()}</span>
                            Último adicionado
                          </span>
                        ) : null}
                        <span className="termo-divergencia falta">Falta {qtd_falta}</span>
                        <span className="coleta-row-expand" aria-hidden="true">{chevronIcon(expandedItemKey === itemKey)}</span>
                      </div>
                    </button>
                    {expandedItemKey === itemKey ? (
                      <div className="termo-item-detail">
                        <p>Última alteração: {formatDateTime(item.updated_at)}</p>
                        {renderCombinedBreakdown(item)}
                        {canEditActiveVolume && !isCombinedRouteMode ? (
                          <div className="termo-item-actions">
                            {editingItemKey === itemKey && item.qtd_conferida > 0 && !isItemLocked ? (
                              <>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={editQtdInput}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onClick={(event) => event.currentTarget.select()}
                                  onChange={(event) => setEditQtdInput(event.target.value.replace(/\D/g, ""))}
                                />
                                <button className="btn btn-primary" type="button" onClick={() => void handleSaveItemEdit(itemKey)}>Salvar</button>
                                <button className="btn btn-muted" type="button" onClick={() => { setEditingItemKey(null); setEditQtdInput("0"); }}>Cancelar</button>
                              </>
                            ) : (
                              <>
                                {item.qtd_conferida > 0 && !isItemLocked ? (
                                  <button className="btn btn-muted" type="button" onClick={() => { setEditingItemKey(itemKey); setEditQtdInput(String(item.qtd_conferida)); }}>
                                    Editar
                                  </button>
                                ) : null}
                                {item.qtd_conferida > 0 && !isItemLocked ? (
                                  <button className="btn btn-muted termo-danger-btn" type="button" onClick={() => requestResetItem(itemKey)}>
                                    Limpar
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                        {hasMultipleActiveContributors && item.qtd_conferida > 0 && (item.locked_nome || item.locked_mat) ? (
                          <p className="entrada-notas-item-owner">
                            Conferido por: {formatLockedItemOwner(item)}
                          </p>
                        ) : null}
                        {canEditActiveVolume && item.qtd_conferida > 0 && isItemLocked ? (
                          <p className="entrada-notas-item-locked">
                            Item bloqueado por {formatLockedItemOwner(item)}. Apenas itens pendentes podem ser alterados.
                          </p>
                        ) : null}
                        {qtd_sobra > 0 ? <p className="termo-inline-note">Sobra detectada: {qtd_sobra}</p> : null}
                      </div>
                    ) : null}
                  </article>
                  );
                })
              )}
            </div>

            <div className="termo-list-block">
              <h4>Sobra ({groupedItems.sobra.length})</h4>
              {groupedItems.sobra.length === 0 ? (
                <div className="coleta-empty">Sem itens com sobra.</div>
              ) : (
                groupedItems.sobra.map(({ item, qtd_sobra }) => {
                  const itemKey = item.item_key ?? String(item.coddv);
                  const isItemLocked = item.is_locked === true;
                  const isLastAddedItem = activeLastAddedItemKey === itemKey;
                  return (
                  <article key={`sobra-${itemKey}`} className={`termo-item-card${expandedItemKey === itemKey ? " is-expanded" : ""}${isLastAddedItem ? " is-last-added" : ""}`}>
                    <button type="button" className="termo-item-line" onClick={() => setExpandedItemKey((current) => current === itemKey ? null : itemKey)}>
                      <div className="termo-item-main">
                        <strong>{item.descricao}</strong>
                        <p>Código: {item.coddv}</p>
                        {item.seq_entrada != null && item.nf != null ? (
                          <p>Seq/NF: {item.seq_entrada}/{item.nf}</p>
                        ) : isCombinedRouteMode ? (
                          <p>Conferência conjunta: {combinedSeqNfLabels.length} Seq/NF</p>
                        ) : null}
                        {item.qtd_conferida > 0 ? (
                          <p>Barras: {item.barras ?? "-"}</p>
                        ) : null}
                        <p>Esperada: {item.qtd_esperada} | Conferida: {item.qtd_conferida} | Pendente: {Math.max(item.qtd_esperada - item.qtd_conferida, 0)}</p>
                      </div>
                      <div className="termo-item-side">
                        {isLastAddedItem ? (
                          <span className="termo-last-added-tag">
                            <span className="termo-last-added-tag-icon" aria-hidden="true">{barcodeIcon()}</span>
                            Último adicionado
                          </span>
                        ) : null}
                        <span className="termo-divergencia sobra">Sobra {qtd_sobra}</span>
                        <span className="coleta-row-expand" aria-hidden="true">{chevronIcon(expandedItemKey === itemKey)}</span>
                      </div>
                    </button>
                    {expandedItemKey === itemKey ? (
                      <div className="termo-item-detail">
                        <p>Última alteração: {formatDateTime(item.updated_at)}</p>
                        {renderCombinedBreakdown(item)}
                        {canEditActiveVolume && !isCombinedRouteMode ? (
                          <div className="termo-item-actions">
                            {editingItemKey === itemKey && item.qtd_conferida > 0 && !isItemLocked ? (
                              <>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={editQtdInput}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onClick={(event) => event.currentTarget.select()}
                                  onChange={(event) => setEditQtdInput(event.target.value.replace(/\D/g, ""))}
                                />
                                <button className="btn btn-primary" type="button" onClick={() => void handleSaveItemEdit(itemKey)}>Salvar</button>
                                <button className="btn btn-muted" type="button" onClick={() => { setEditingItemKey(null); setEditQtdInput("0"); }}>Cancelar</button>
                              </>
                            ) : (
                              <>
                                {item.qtd_conferida > 0 && !isItemLocked ? (
                                  <button className="btn btn-muted" type="button" onClick={() => { setEditingItemKey(itemKey); setEditQtdInput(String(item.qtd_conferida)); }}>
                                    Editar
                                  </button>
                                ) : null}
                                {item.qtd_conferida > 0 && !isItemLocked ? (
                                  <button className="btn btn-muted termo-danger-btn" type="button" onClick={() => requestResetItem(itemKey)}>
                                    Limpar
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                        {hasMultipleActiveContributors && item.qtd_conferida > 0 && (item.locked_nome || item.locked_mat) ? (
                          <p className="entrada-notas-item-owner">
                            Conferido por: {formatLockedItemOwner(item)}
                          </p>
                        ) : null}
                        {canEditActiveVolume && item.qtd_conferida > 0 && isItemLocked ? (
                          <p className="entrada-notas-item-locked">
                            Item bloqueado por {formatLockedItemOwner(item)}. Apenas itens pendentes podem ser alterados.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                  );
                })
              )}
            </div>

            <div className="termo-list-block">
              <h4>Correto ({groupedItems.correto.length})</h4>
              {groupedItems.correto.length === 0 ? (
                <div className="coleta-empty">Sem itens corretos ainda.</div>
              ) : (
                groupedItems.correto.map(({ item }) => {
                  const itemKey = item.item_key ?? String(item.coddv);
                  const isItemLocked = item.is_locked === true;
                  const isLastAddedItem = activeLastAddedItemKey === itemKey;
                  return (
                  <article key={`correto-${itemKey}`} className={`termo-item-card${expandedItemKey === itemKey ? " is-expanded" : ""}${isLastAddedItem ? " is-last-added" : ""}`}>
                    <button type="button" className="termo-item-line" onClick={() => setExpandedItemKey((current) => current === itemKey ? null : itemKey)}>
                      <div className="termo-item-main">
                        <strong>{item.descricao}</strong>
                        <p>Código: {item.coddv}</p>
                        {item.seq_entrada != null && item.nf != null ? (
                          <p>Seq/NF: {item.seq_entrada}/{item.nf}</p>
                        ) : isCombinedRouteMode ? (
                          <p>Conferência conjunta: {combinedSeqNfLabels.length} Seq/NF</p>
                        ) : null}
                        {item.qtd_conferida > 0 ? (
                          <p>Barras: {item.barras ?? "-"}</p>
                        ) : null}
                        <p>Esperada: {item.qtd_esperada} | Conferida: {item.qtd_conferida} | Pendente: {Math.max(item.qtd_esperada - item.qtd_conferida, 0)}</p>
                      </div>
                      <div className="termo-item-side">
                        {isLastAddedItem ? (
                          <span className="termo-last-added-tag">
                            <span className="termo-last-added-tag-icon" aria-hidden="true">{barcodeIcon()}</span>
                            Último adicionado
                          </span>
                        ) : null}
                        <span className="termo-divergencia correto">Correto</span>
                        <span className="coleta-row-expand" aria-hidden="true">{chevronIcon(expandedItemKey === itemKey)}</span>
                      </div>
                    </button>
                    {expandedItemKey === itemKey ? (
                      <div className="termo-item-detail">
                        <p>Última alteração: {formatDateTime(item.updated_at)}</p>
                        {renderCombinedBreakdown(item)}
                        {canEditActiveVolume && !isCombinedRouteMode ? (
                          <div className="termo-item-actions">
                            {editingItemKey === itemKey && item.qtd_conferida > 0 && !isItemLocked ? (
                              <>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={editQtdInput}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onClick={(event) => event.currentTarget.select()}
                                  onChange={(event) => setEditQtdInput(event.target.value.replace(/\D/g, ""))}
                                />
                                <button className="btn btn-primary" type="button" onClick={() => void handleSaveItemEdit(itemKey)}>Salvar</button>
                                <button className="btn btn-muted" type="button" onClick={() => { setEditingItemKey(null); setEditQtdInput("0"); }}>Cancelar</button>
                              </>
                            ) : (
                              <>
                                {item.qtd_conferida > 0 && !isItemLocked ? (
                                  <button className="btn btn-muted" type="button" onClick={() => { setEditingItemKey(itemKey); setEditQtdInput(String(item.qtd_conferida)); }}>
                                    Editar
                                  </button>
                                ) : null}
                                {item.qtd_conferida > 0 && !isItemLocked ? (
                                  <button className="btn btn-muted termo-danger-btn" type="button" onClick={() => requestResetItem(itemKey)}>
                                    Limpar
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                        {hasMultipleActiveContributors && item.qtd_conferida > 0 && (item.locked_nome || item.locked_mat) ? (
                          <p className="entrada-notas-item-owner">
                            Conferido por: {formatLockedItemOwner(item)}
                          </p>
                        ) : null}
                        {canEditActiveVolume && item.qtd_conferida > 0 && isItemLocked ? (
                          <p className="entrada-notas-item-locked">
                            Item bloqueado por {formatLockedItemOwner(item)}. Apenas itens pendentes podem ser alterados.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                  );
                })
              )}
            </div>
          </article>
        ) : (
          <div className="coleta-empty">
            Nenhuma conferência ativa. Informe um Seq/NF ou código de barras para iniciar a conferência.
          </div>
        )}
      </section>

      {showRoutesModal && typeof document !== "undefined"
        ? createPortal(
            <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="termo-rotas-title" onClick={() => setShowRoutesModal(false)}>
              <div className="confirm-dialog termo-routes-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="termo-rotas-title">Transportadora/Fornecedor do dia</h3>
                <div className="input-icon-wrap termo-routes-search">
                  <span className="field-icon" aria-hidden="true">{searchIcon()}</span>
                  <input
                    type="text"
                    value={routeSearchInput}
                    onChange={(event) => setRouteSearchInput(event.target.value)}
                    placeholder="Buscar transportadora, fornecedor, seq, nf ou status..."
                  />
                </div>
                {filteredRouteGroups.length === 0 ? (
                  <p>Sem dados de transportadora/fornecedor disponíveis para este CD.</p>
                ) : (
                  <div className="termo-routes-list">
                    {filteredRouteGroups.map((group, index) => {
                      const routeKey = `${group.rota}::${index}`;
                      const isOpen = group.force_open || expandedRoute === routeKey;
                      const groupStatus = group.status;
                      const selectableBatchSeqNf = getRouteBatchSelectableLabels(group);
                      const selectedBatchSeqNf = routeBatchSelectionByGroup[group.rota] ?? [];
                      const selectedBatchSet = new Set(selectedBatchSeqNf);
                      const selectedBatchCount = selectableBatchSeqNf.filter((label) => selectedBatchSet.has(label)).length;
                      const allBatchSelected = selectableBatchSeqNf.length > 0 && selectedBatchCount === selectableBatchSeqNf.length;
                      const showBatchControls = selectableBatchSeqNf.length > 1;
                      const canToggle = !group.force_open;
                      const toggleRoute = () => {
                        if (!canToggle) return;
                        setExpandedRoute((current) => current === routeKey ? null : routeKey);
                      };
                      return (
                        <div key={routeKey} className={`termo-route-group${isOpen ? " is-open" : ""}`}>
                          <div
                            role="button"
                            tabIndex={canToggle ? 0 : -1}
                            className="termo-route-row-button"
                            onPointerUp={(event) => {
                              if (!canToggle) return;
                              event.stopPropagation();
                              toggleRoute();
                            }}
                            onKeyDown={(event) => {
                              if (!canToggle) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleRoute();
                              }
                            }}
                            aria-expanded={isOpen}
                          >
                            <span className="termo-route-main">
                              <span className="termo-route-title">{group.rota}</span>
                              <span className="termo-route-sub">
                                Fornecedores: {group.lojas_conferidas}/{group.lojas_total} concluídos
                                {" | "}
                                Itens conferidos: {group.etiquetas_conferidas}/{group.etiquetas_total}
                              </span>
                              <span className="termo-route-sub">Status da transportadora: {routeStatusLabel(groupStatus)}</span>
                            </span>
                            <span className="termo-route-metrics">
                              <span>{group.lojas_conferidas}/{group.lojas_total}</span>
                              <span className={`termo-divergencia ${routeStatusClass(groupStatus)}`}>
                                {routeStatusLabel(groupStatus)}
                              </span>
                              {canToggle ? (
                                <span className="coleta-row-expand" aria-hidden="true">{chevronIcon(isOpen)}</span>
                              ) : null}
                            </span>
                          </div>
                          {isOpen ? (
                            <div className="termo-route-stores">
                              {showBatchControls ? (
                                <div className="termo-route-batch-actions">
                                  <p>
                                    Selecionadas para lote: {selectedBatchCount}/{selectableBatchSeqNf.length}
                                  </p>
                                  <div className="termo-route-batch-buttons">
                                    <button
                                      className="btn btn-muted"
                                      type="button"
                                      onClick={() => setAllRouteBatchSelection(group, !allBatchSelected)}
                                      disabled={selectableBatchSeqNf.length === 0}
                                    >
                                      {allBatchSelected ? "Desmarcar todas" : "Marcar todas"}
                                    </button>
                                    <button
                                      className="btn btn-primary"
                                      type="button"
                                      onClick={() => startRouteBatchByGroup(group)}
                                      disabled={selectedBatchCount === 0 || hasOpenConference}
                                    >
                                      {selectedBatchCount > 0 ? `Iniciar selecionadas (${selectedBatchCount})` : "Iniciar selecionadas"}
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                              {group.visible_filiais.map((row) => {
                                const lojaStatus = normalizeStoreStatus(row.status);
                                const colaboradorNome = row.colaborador_nome?.trim() || "";
                                const colaboradorMat = row.colaborador_mat?.trim() || "";
                                const seqLabel = row.pedidos_seq ?? `Seq ${row.seq_entrada ?? "-"} / NF ${row.nf ?? "-"}`;
                                const seqNfKey = buildSeqNfLabelKey(row.seq_entrada, row.nf);
                                const batchSelectable = isRouteRowSelectableForBatch(row);
                                const batchSelected = Boolean(seqNfKey && selectedBatchSet.has(seqNfKey));
                                const contributorsState = seqNfKey ? routeContributorsMap[seqNfKey] : undefined;
                                const contributors = contributorsState?.contributors ?? [];
                                const contributorNames = contributors.length > 0
                                  ? contributors
                                    .map((contributor) => formatCollaboratorName({
                                      nome: contributor.nome,
                                      mat: contributor.mat
                                    }))
                                    .join(", ")
                                  : colaboradorNome
                                    ? `${colaboradorNome}${colaboradorMat ? ` (${colaboradorMat})` : ""}`
                                    : "";
                                return (
                                  <div key={`${group.rota}-${row.seq_entrada}-${row.nf}-${row.filial ?? "na"}`} className="termo-route-store-row">
                                    <div>
                                      <strong>{row.filial_nome}{row.filial != null ? ` (${row.filial})` : ""}</strong>
                                      <p>{seqLabel}</p>
                                      <p>Itens conferidos: {row.conferidas}/{row.total_etiquetas}</p>
                                      {row.produtos_multiplos_seq > 0 ? (
                                        <p>Produtos repetidos em múltiplos Seq/NF: {row.produtos_multiplos_seq}</p>
                                      ) : null}
                                      <p>Status: {routeStatusLabel(lojaStatus)}</p>
                                      <div className="termo-route-store-actions">
                                        {showBatchControls ? (
                                          <label className={`termo-route-store-check${batchSelectable ? "" : " is-disabled"}`}>
                                            <input
                                              type="checkbox"
                                              checked={batchSelected}
                                              disabled={!batchSelectable || !seqNfKey}
                                              onChange={(event) => {
                                                if (!seqNfKey) return;
                                                toggleRouteBatchSelection(group.rota, seqNfKey, event.target.checked);
                                              }}
                                            />
                                            <span>Selecionar no lote</span>
                                          </label>
                                        ) : null}
                                        <button
                                          className="btn btn-primary"
                                          type="button"
                                          onClick={() => {
                                            setRouteBatchQueue((current) => (current.length > 0 ? [] : current));
                                            setShowRoutesModal(false);
                                            void openVolumeFromEtiqueta(`${row.seq_entrada ?? ""}/${row.nf ?? ""}`);
                                          }}
                                        >
                                          {lojaStatus === "pendente" ? "Iniciar conferência" : "Retomar conferência"}
                                        </button>
                                      </div>
                                      {lojaStatus === "em_andamento" && contributorNames ? (
                                        <p>Em andamento por: {contributorNames}</p>
                                      ) : null}
                                      {lojaStatus === "concluido" && contributorNames ? (
                                        <p>Concluído por: {contributorNames}</p>
                                      ) : null}
                                      {contributors.length > 1 ? (
                                        <div className="entrada-notas-route-contributors">
                                          {contributors.map((contributor) => (
                                            <p key={`${seqNfKey ?? "seq"}:${contributor.user_id || contributor.mat || contributor.nome}`}>
                                              {formatCollaboratorName({
                                                nome: contributor.nome,
                                                mat: contributor.mat
                                              })}
                                              {" | Última ação: "}
                                              {formatDateTime(contributor.last_action_at)}
                                            </p>
                                          ))}
                                        </div>
                                      ) : null}
                                      {contributorsState?.status === "loading" ? (
                                        <p className="entrada-notas-route-contributors-loading">Carregando conferentes...</p>
                                      ) : null}
                                      {lojaStatus === "em_andamento" && row.status_at ? (
                                        <p>Iniciado em: {formatDateTime(row.status_at)}</p>
                                      ) : null}
                                      {lojaStatus === "concluido" && row.status_at ? (
                                        <p>Concluído em: {formatDateTime(row.status_at)}</p>
                                      ) : null}
                                    </div>
                                    <span className={`termo-divergencia ${routeStatusClass(lojaStatus)}`}>
                                      {routeStatusLabel(lojaStatus)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="confirm-actions">
                  <button className="btn btn-muted" type="button" onClick={() => setShowRoutesModal(false)}>Fechar</button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {pendingBarcodeOpenSelection && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="entrada-barcode-open-title"
              onClick={() => setPendingBarcodeOpenSelection(null)}
            >
              <div className="confirm-dialog termo-routes-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="entrada-barcode-open-title">Selecionar Seq/NF para conferência</h3>
                <p>
                  Produto: {pendingBarcodeOpenSelection.descricao}
                  {" | "}
                  Barras: {pendingBarcodeOpenSelection.barras}
                </p>
                <div className="termo-routes-list">
                  {pendingBarcodeOpenSelection.options.map((option) => (
                    <div
                      key={`${option.seq_entrada}-${option.nf}-${option.coddv}`}
                      className="termo-route-store-row"
                    >
                      <div>
                        <strong>Seq/NF {option.seq_entrada}/{option.nf}</strong>
                        <p>Transportadora: {option.transportadora}</p>
                        <p>Fornecedor: {option.fornecedor}</p>
                        <p>Pendente: {option.qtd_pendente} | Esperada: {option.qtd_esperada} | Conferida: {option.qtd_conferida}</p>
                      </div>
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => void handleSelectPendingBarcodeOpen(option)}
                      >
                        Iniciar
                      </button>
                    </div>
                  ))}
                </div>
                <div className="confirm-actions">
                  <button className="btn btn-muted" type="button" onClick={() => setPendingBarcodeOpenSelection(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {pendingAvulsaScan && typeof document !== "undefined"
        ? createPortal(
            <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="entrada-avulsa-target-title" onClick={() => setPendingAvulsaScan(null)}>
              <div className="confirm-dialog termo-routes-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="entrada-avulsa-target-title">Selecionar Seq/NF para conferência</h3>
                <p>
                  Produto: {pendingAvulsaScan.descricao} | Barras: {pendingAvulsaScan.barras} | Quantidade: {pendingAvulsaScan.qtd}
                </p>
                <div className="termo-routes-list">
                  {pendingAvulsaScan.options.map((option) => (
                    <div
                      key={`${option.seq_entrada}-${option.nf}-${option.coddv}`}
                      className="termo-route-store-row"
                    >
                      <div>
                        <strong>Seq/NF {option.seq_entrada}/{option.nf}</strong>
                        <p>Transportadora: {option.transportadora}</p>
                        <p>Fornecedor: {option.fornecedor}</p>
                        <p>Pendente: {option.qtd_pendente} | Esperada: {option.qtd_esperada} | Conferida: {option.qtd_conferida}</p>
                      </div>
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => void handleSelectPendingAvulsaScan(option)}
                      >
                        Selecionar
                      </button>
                    </div>
                  ))}
                </div>
                <div className="confirm-actions">
                  <button className="btn btn-muted" type="button" onClick={() => setPendingAvulsaScan(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {showFinalizeModal && activeVolume && hasAnyItemInformed && typeof document !== "undefined"
        ? createPortal(
            <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="termo-finalizar-title" onClick={() => setShowFinalizeModal(false)}>
              <div className="confirm-dialog termo-finalize-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="termo-finalizar-title">Finalizar conferência</h3>
                <p>Resumo: Falta {divergenciaTotals.falta} | Sobra {divergenciaTotals.sobra} | Correto {divergenciaTotals.correto}</p>
                {divergenciaTotals.falta > 0 || divergenciaTotals.sobra > 0 ? (
                  <div className="termo-item-detail">
                    <p>Itens com divergência:</p>
                    <div className="termo-routes-list termo-finalize-list">
                      {groupedItems.falta.map(({ item, qtd_falta }) => (
                        <p key={`fim-falta-${item.item_key ?? item.coddv}`}>
                          {item.seq_entrada != null && item.nf != null ? `Seq ${item.seq_entrada}/NF ${item.nf} - ` : ""}
                          {item.coddv} - {item.descricao || "Item sem descrição"}: Falta {qtd_falta}
                        </p>
                      ))}
                      {groupedItems.sobra.map(({ item, qtd_sobra }) => (
                        <p key={`fim-sobra-${item.item_key ?? item.coddv}`}>
                          {item.seq_entrada != null && item.nf != null ? `Seq ${item.seq_entrada}/NF ${item.nf} - ` : ""}
                          {item.coddv} - {item.descricao || "Item sem descrição"}: Sobra {qtd_sobra}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
                {finalizeError ? <div className="alert error">{finalizeError}</div> : null}
                <div className="confirm-actions">
                  <button className="btn btn-muted" type="button" onClick={() => setShowFinalizeModal(false)} disabled={busyFinalize}>
                    Cancelar
                  </button>
                  <button className="btn btn-primary" type="button" onClick={() => void handleFinalizeVolume()} disabled={busyFinalize}>
                    {busyFinalize ? "Finalizando..." : "Confirmar finalização"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {dialogState && typeof document !== "undefined"
        ? createPortal(
            <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="termo-generic-dialog" onClick={closeDialog}>
              <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="termo-generic-dialog">{dialogState.title}</h3>
                <p style={{ whiteSpace: "pre-line" }}>{dialogState.message}</p>
                <div className="confirm-actions">
                  {dialogState.onConfirm ? (
                    <>
                      <button
                        className="btn btn-muted"
                        type="button"
                        onClick={dialogState.onCancel ?? closeDialog}
                      >
                        {dialogState.cancelLabel ?? "Cancelar"}
                      </button>
                      <button className="btn btn-primary" type="button" onClick={dialogState.onConfirm}>
                        {dialogState.confirmLabel ?? "Confirmar"}
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-primary" type="button" onClick={closeDialog}>
                      {dialogState.confirmLabel ?? "OK"}
                    </button>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {scannerOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="termo-scanner-title" onClick={closeScanner}>
              <div className="scanner-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <div className="scanner-head">
                  <h3 id="termo-scanner-title">
                    {scannerTarget === "etiqueta" ? "Scanner de abertura" : "Scanner de barras"}
                  </h3>
                  <div className="scanner-head-actions">
                    {!isDesktop ? (
                      <button
                        type="button"
                        className={`scanner-flash-btn${torchEnabled ? " is-on" : ""}`}
                        onClick={() => void toggleTorch()}
                        disabled={!torchSupported}
                        title={torchSupported ? (torchEnabled ? "Desligar flash" : "Ligar flash") : "Flash indisponível"}
                      >
                        {flashIcon(torchEnabled)}
                        <span>{torchEnabled ? "Flash on" : "Flash"}</span>
                      </button>
                    ) : null}
                    <button className="scanner-close-btn" type="button" onClick={closeScanner} aria-label="Fechar scanner">
                      {closeIcon()}
                    </button>
                  </div>
                </div>
                <div className="scanner-video-wrap">
                  <video ref={scannerVideoRef} className="scanner-video" autoPlay muted playsInline />
                  <div className="scanner-frame" aria-hidden="true">
                    <div className="scanner-frame-corner top-left" />
                    <div className="scanner-frame-corner top-right" />
                    <div className="scanner-frame-corner bottom-left" />
                    <div className="scanner-frame-corner bottom-right" />
                    <div className="scanner-frame-line" />
                  </div>
                </div>
                <p className="scanner-hint">Aponte a câmera para leitura automática.</p>
                {scannerError ? <div className="alert error">{scannerError}</div> : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
