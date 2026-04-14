import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { IScannerControls } from "@zxing/browser";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import { PendingSyncDialog } from "../../ui/pending-sync-dialog";
import { formatDateOnlyPtBR, formatDateTimeBrasilia } from "../../shared/brasilia-datetime";
import {
  fetchDbBarrasByBarcodeOnline,
  normalizeBarcode,
  refreshDbBarrasCacheSmart
} from "../../shared/db-barras/sync";
import { shouldTriggerQueuedBackgroundSync } from "../../shared/offline/queue-policy";
import type { DbBarrasCacheRow } from "../../shared/db-barras/types";
import { useOnDemandSoftKeyboard } from "../../shared/use-on-demand-soft-keyboard";
import { useScanFeedback } from "../../shared/use-scan-feedback";
import { formatCountLabel } from "../../shared/inflection";
import {
  getDbBarrasByBarcode,
  getDbBarrasMeta,
  upsertDbBarrasCacheRow
} from "../../shared/db-barras/storage";
import { getModuleByKeyOrThrow } from "../registry";
import {
  clearManifestSnapshotByCd,
  countPendingEventsByCycle,
  getInventarioPreferences,
  getManifestMetaLocal,
  getRemoteStateCache,
  listManifestItemsByCd,
  listPendingEventsByCycle,
  queuePendingEvent,
  removePendingEvent,
  saveInventarioPreferences,
  saveManifestSnapshot,
  saveRemoteStateCache,
  updatePendingEventStatus
} from "./storage";
import {
  applyInventarioAdminManualCoddv,
  applyInventarioAdminSeed,
  applyInventarioEvent,
  clearInventarioAdminBase,
  countReportRows,
  countInventarioErroEnderecoReportRows,
  fetchInventarioAdminZones,
  fetchCdOptions,
  fetchInventarioErroEnderecoReportRows,
  fetchManifestBundle,
  fetchManifestMeta,
  previewInventarioAdminSeed,
  fetchReportRows,
  fetchSyncPull,
  logInventarioErroEndereco
} from "./sync";
import type {
  CdOption,
  InventarioAdminApplyMode,
  InventarioAdminPreviewZoneRow,
  InventarioAdminSeedSummary,
  InventarioAdminStockType,
  InventarioAdminZoneRow,
  InventarioAddressBucket,
  InventarioCountRow,
  InventarioErroEnderecoReportRow,
  InventarioEventType,
  InventarioManifestItemRow,
  InventarioManifestMeta,
  InventarioModuleProfile,
  InventarioPendingEvent,
  InventarioPreferences,
  InventarioReportRow,
  InventarioResultado,
  InventarioReviewRow,
  InventarioStageView,
  InventarioSyncPullState
} from "./types";

interface InventarioPageProps {
  isOnline: boolean;
  profile: InventarioModuleProfile;
}

type StageStatusFilter = "pendente" | "concluido";
type ReviewStatusFilter = "pendente" | "resolvido";
type MobileFlowStep = "stage" | "zone" | "address";
type ScannerTarget = "barras" | "final_barras";
type BarcodeValidationState = "idle" | "validating" | "valid" | "invalid";
type InventarioAdminSeedScope = "zona" | "coddv";
type InventarioAdminManageMode = "zona" | "coddv";
type InventarioAdminStockTypeValue = InventarioAdminStockType | "";
type InventarioAdminConfirmAction =
  | { kind: "apply_zona"; mode: InventarioAdminApplyMode }
  | { kind: "apply_coddv" }
  | { kind: "clear_all" };
type SendEventResult = "queued" | "applied" | "discarded";

interface InventarioAdminConfirmState {
  title: string;
  lines: string[];
  confirm_label: string;
  danger?: boolean;
  action: InventarioAdminConfirmAction;
}

type Row = InventarioManifestItemRow & {
  key: string;
  c1: InventarioCountRow | null;
  c2: InventarioCountRow | null;
  review: InventarioReviewRow | null;
  final: boolean;
};

type AddressBucketView = InventarioAddressBucket & {
  items: Row[];
};

type ZoneBucketView = {
  zona: string;
  total_addresses: number;
  done_addresses: number;
  pending_addresses: number;
};

interface PendingSyncSummary {
  synced: number;
  failed: number;
  discarded: number;
  remaining: number;
}

const MODULE_DEF = getModuleByKeyOrThrow("zerados");
const CYCLE_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());
const CYCLE_DATE_DISPLAY = (() => {
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date());
  const parts = formatted.split(" de ");
  if (parts.length !== 3) return formatted;
  const month = parts[1];
  const monthCapitalized = month.charAt(0).toLocaleUpperCase("pt-BR") + month.slice(1);
  return `${parts[0]} de ${monthCapitalized} de ${parts[2]}`;
})();
const SCANNER_INPUT_MAX_INTERVAL_MS = 45;
const SCANNER_INPUT_MIN_BURST_CHARS = 5;
const SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS = 90;
const SCANNER_INPUT_SUBMIT_COOLDOWN_MS = 280;
const BACKGROUND_PULL_DELAY_MS = 180;

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

function displayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((s) => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1))
    .join(" ");
}

function fixedCd(profile: InventarioModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) return Math.trunc(profile.cd_default);
  const m = /cd\s*0*(\d+)/i.exec(profile.cd_nome ?? "");
  return m ? Number.parseInt(m[1], 10) : null;
}

function keyOf(zona: string, endereco: string, coddv: number): string {
  return `${zona.toUpperCase()}|${endereco.toUpperCase()}|${coddv}`;
}

function addressKeyOf(zona: string, endereco: string): string {
  return `${zona.toUpperCase()}|${endereco.toUpperCase()}`;
}

function resultOf(estoque: number, qtd: number, discarded: boolean): InventarioResultado {
  if (discarded) return "descartado";
  if (qtd > estoque) return "sobra";
  if (qtd < estoque) return "falta";
  return "correto";
}

function parseErr(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "Erro inesperado");
  if (raw.includes("rpc_conf_inventario_manifest_meta_v2") || raw.includes("Could not find the function public.rpc_conf_inventario_manifest_meta_v2")) {
    return "Backend desatualizado para metadados de autoria da base. Execute as migrações mais recentes e tente novamente.";
  }
  if (raw.includes("rpc_conf_inventario_admin_apply_seed_v2") || raw.includes("rpc_conf_inventario_admin_clear_base_v2") || raw.includes("rpc_conf_inventario_admin_apply_manual_coddv_v2")) {
    return "Backend desatualizado para metadados da gestão de base. Execute as migrações mais recentes e tente novamente.";
  }
  if (raw.includes("rpc_conf_inventario_report_rows") && raw.includes("p_offset")) {
    return "Backend desatualizado para paginação do relatório. Execute as migrações mais recentes e tente novamente.";
  }
  if ((raw.includes("rpc_conf_inventario_report_rows") || raw.includes("rpc_conf_inventario_report_count")) && raw.includes("p_snapshot_at")) {
    return "Backend desatualizado para snapshot do relatório. Execute as migrações mais recentes e tente novamente.";
  }
  if (raw.includes("rpc_conf_inventario_erro_end_rows") || raw.includes("rpc_conf_inventario_erro_end_count")) {
    return "Backend desatualizado para relatório de erro de endereço. Execute as migrações mais recentes e tente novamente.";
  }
  if ((raw.includes("rpc_conf_inventario_erro_end_rows") || raw.includes("rpc_conf_inventario_erro_end_count")) && raw.includes("p_snapshot_at")) {
    return "Backend desatualizado para snapshot do relatório de erro de endereço. Execute as migrações mais recentes e tente novamente.";
  }
  if (raw.includes("rpc_conf_inventario_admin_apply_manual_coddv") || raw.includes("Could not find the function public.rpc_conf_inventario_admin_apply_manual_coddv")) {
    return "Backend desatualizado para Código e Dígito (CODDV) manual. Execute as migrações mais recentes e tente novamente.";
  }
  if (raw.toLowerCase().includes("read-only transaction")) {
    return "Backend com função de inventário em modo somente leitura. Execute as migrações mais recentes e sincronize novamente.";
  }
  if (raw.includes("BASE_INVENTARIO_VAZIA")) return "Base do inventário vazia. Use 'Gerir Base' para montar e sincronize novamente.";
  if (raw.includes("RELATORIO_INCOMPLETO")) return "A exportação retornou menos linhas do que o esperado. Tente novamente.";
  if (raw.includes("RELATORIO_ERRO_END_INCOMPLETO")) return "A exportação do relatório de erros de endereço retornou menos linhas do que o esperado. Tente novamente.";
  if (raw.includes("RELATORIO_MUITO_GRANDE")) return "Relatório acima do limite suportado para exportação. Reduza o período e tente novamente.";
  if (raw.includes("BARRAS_INVALIDA_CODDV")) return "Código de barras inválido para este Código e Dígito (CODDV).";
  if (raw.includes("SEGUNDA_CONTAGEM_EXIGE_USUARIO_DIFERENTE")) return "2ª verificação exige usuário diferente.";
  if (raw.includes("ETAPA2_APENAS_QUANDO_SOBRA")) return "2ª verificação só é permitida quando houver sobra na 1ª verificação.";
  if (raw.includes("ETAPA1_OBRIGATORIA")) return "A 1ª verificação precisa ser concluída antes da 2ª.";
  if (raw.includes("ZONA_TRAVADA_OUTRO_USUARIO")) return "Zona/etapa bloqueada por outro usuário.";
  if (raw.includes("APENAS_ADMIN")) return "Apenas admin pode executar esta ação.";
  if (raw.includes("MANIFESTO_INCOMPLETO")) return "Base local incompleta. Sincronize novamente para baixar todos os endereços.";
  if (raw.includes("ETAPA1_APENAS_AUTOR")) return "Apenas o autor pode editar a 1ª verificação.";
  if (raw.includes("ETAPA2_APENAS_AUTOR")) return "Apenas o autor pode editar a 2ª verificação.";
  if (raw.includes("COUNT_DISCARDED_OUTRO_USUARIO")) return "Endereço já concluído por outro usuário e descartado.";
  if (raw.includes("ETAPA1_BLOQUEADA_SEGUNDA_EXISTE")) return "A 1ª verificação não pode ser alterada após existir 2ª verificação.";
  if (raw.includes("ITEM_JA_RESOLVIDO")) return "Endereço já resolvido na conciliação.";
  if (raw.includes("ESTOQUE_FAIXA_INVALIDA")) return "Faixa de estoque inválida. O final deve ser maior ou igual ao inicial.";
  if (raw.includes("TIPO_ESTOQUE_OBRIGATORIO")) return "Selecione o tipo de estoque: Disponível ou Atual.";
  if (raw.includes("AUDITORIA_RECORRENTE_DIAS_INVALIDO")) return "Informe um prazo em dias maior que zero para ignorar endereços auditados.";
  if (raw.includes("ZONAS_OU_CODDV_OBRIGATORIO")) return "Selecione ao menos uma zona ou informe Código e Dígito (CODDV) manual.";
  if (raw.includes("ZONAS_OBRIGATORIAS")) return "Selecione pelo menos uma zona.";
  if (raw.includes("CODDV_MANUAL_OBRIGATORIO")) return "Informe ao menos um Código e Dígito (CODDV) manual para essa ação.";
  if (raw.includes("MODE_INVALIDO")) return "Modo de aplicação inválido.";
  if (raw.includes("SCOPE_INVALIDO")) return "Escopo de limpeza inválido.";
  return raw;
}

function isInventarioAdminStockType(value: string): value is InventarioAdminStockType {
  return value === "disponivel" || value === "atual";
}

function isReportTimeoutError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const normalized = raw.toLowerCase();
  return normalized.includes("a consulta demorou além do limite")
    || normalized.includes("statement timeout")
    || normalized.includes("canceling statement");
}

function formatInventarioAdminStockTypeLabel(value: InventarioAdminStockType): string {
  return value === "atual" ? "Atual" : "Disponível";
}

function extractDiscardConflictCode(rawValue: string): string | null {
  const upper = rawValue.toUpperCase();
  if (upper.includes("COUNT_DISCARDED_OUTRO_USUARIO")) return "COUNT_DISCARDED_OUTRO_USUARIO";
  if (upper.includes("ETAPA1_APENAS_AUTOR")) return "ETAPA1_APENAS_AUTOR";
  if (upper.includes("ETAPA2_APENAS_AUTOR")) return "ETAPA2_APENAS_AUTOR";
  return null;
}

function isDiscardConflict(rawValue: string): boolean {
  return extractDiscardConflictCode(rawValue) != null;
}

function defaultState(): InventarioSyncPullState {
  return { counts: [], reviews: [], locks: [], server_time: null };
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

function searchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.7-3.7" />
    </svg>
  );
}

function reportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
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

function closeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function flashIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {on ? <path d="M7 2h10l-4 7h5l-9 13 2-9H6z" /> : <path d="M7 2h10l-4 7h5l-9 13 2-9H6z" />}
      {!on ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function editIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20l4.6-1 9.8-9.8a1.8 1.8 0 0 0 0-2.5L16.4 5a1.8 1.8 0 0 0-2.5 0L4 14.8z" />
      <path d="M12.6 6.8l4.6 4.6" />
    </svg>
  );
}

function isS1Pending(row: Row): boolean {
  return row.c1 == null;
}

function isS2Eligible(row: Row): boolean {
  return row.c1 != null && row.c1.resultado === "sobra";
}

function isS2Pending(row: Row): boolean {
  return isS2Eligible(row) && row.c2 == null && row.review == null;
}

function isS2BlockedBySameUser(row: Row, userId: string): boolean {
  return isS2Eligible(row) && row.c2 == null && row.review == null && row.c1?.counted_by === userId;
}

function normalizeApplicableReview(
  review: InventarioReviewRow | null,
  c1: InventarioCountRow | null,
  c2: InventarioCountRow | null
): InventarioReviewRow | null {
  if (!review) return null;
  if (review.status === "resolvido") return review;

  if (review.reason_code === "sem_consenso") {
    if (!c1 || !c2) return null;
    if (c1.resultado === "descartado" || c2.resultado === "descartado") return null;
    if (c1.qtd_contada === c2.qtd_contada) return null;
    return review;
  }

  if (review.reason_code === "conflito_lock") {
    if (c2 != null) {
      if (!c1) return review;
      if (c1.resultado === "descartado" || c2.resultado === "descartado") return null;
      if (c1.qtd_contada === c2.qtd_contada) return null;
      return review;
    }
    if (c1 != null && c1.resultado === "sobra") return review;
    return null;
  }

  return null;
}

function isConciliationPending(row: Row): boolean {
  return row.review?.status === "pendente";
}

function rowMatchesStageUniverse(row: Row, stage: InventarioStageView): boolean {
  if (stage === "s1") return true;
  if (stage === "s2") return isS2Eligible(row) && row.review == null;
  if (stage === "conciliation") return row.review != null;
  return row.final;
}

function rowMatchesStageStatus(
  row: Row,
  stage: InventarioStageView,
  statusFilter: StageStatusFilter,
  reviewFilter: ReviewStatusFilter
): boolean {
  if (stage === "s1") {
    return statusFilter === "pendente" ? isS1Pending(row) : !isS1Pending(row);
  }

  if (stage === "s2") {
    return statusFilter === "pendente" ? isS2Pending(row) : !isS2Pending(row);
  }

  if (stage === "conciliation") {
    return reviewFilter === "pendente" ? isConciliationPending(row) : row.review?.status === "resolvido";
  }

  return true;
}

function stageLabel(stage: InventarioStageView): string {
  if (stage === "s1") return "1ª Verificação";
  if (stage === "s2") return "2ª Verificação";
  if (stage === "conciliation") return "Conciliação";
  return "Concluídos";
}

function isPendingForStage(row: Row, stage: InventarioStageView): boolean {
  if (stage === "s1") return isS1Pending(row);
  if (stage === "s2") return isS2Pending(row);
  if (stage === "conciliation") return isConciliationPending(row);
  return !row.final;
}

function completionPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (completed / total) * 100));
}

function formatPercent(value: number): string {
  return `${value.toFixed(0)}%`;
}

function formatDateTime(value: string): string {
  return formatDateTimeBrasilia(value, { emptyFallback: "-", invalidFallback: "value" });
}

function formatDate(value: string): string {
  return formatDateOnlyPtBR(value, "-", "value");
}

function dateKeyBrasiliaFromTimestamp(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(parsed);
}

function isCurrentManifestBase(meta: InventarioManifestMeta | null): boolean {
  if (!meta?.base_atualizado_em) return false;
  return dateKeyBrasiliaFromTimestamp(meta.base_atualizado_em) === CYCLE_DATE;
}

function sumNullable(values: Array<number | null>): number | null {
  let total = 0;
  let hasValue = false;
  for (const value of values) {
    if (value == null) continue;
    total += value;
    hasValue = true;
  }
  return hasValue ? total : null;
}

function labelByCount(count: number, singular: string, plural: string): string {
  return formatCountLabel(count, singular, plural);
}

type CountedDisplayInfo = {
  qtd: number | null;
  mat: string | null;
  nome: string | null;
};

type SnapshotCountInfo = {
  qtd: number | null;
  barras: string | null;
  nome: string | null;
  mat: string | null;
};

function parseSnapshotCountInfo(value: unknown): SnapshotCountInfo | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const qtdRaw = raw.qtd_contada;
  const qtdParsed = qtdRaw == null ? null : Number.parseInt(String(qtdRaw), 10);
  const barras = raw.barras == null ? null : String(raw.barras).trim() || null;
  const nomeSource = raw.counted_nome ?? raw.nome ?? raw.locked_nome ?? null;
  const nome = nomeSource == null ? null : String(nomeSource).trim() || null;
  const matSource = raw.counted_mat ?? raw.mat ?? raw.locked_mat ?? null;
  const mat = matSource == null ? null : String(matSource).trim() || null;

  return {
    qtd: Number.isFinite(qtdParsed ?? NaN) ? Math.max(qtdParsed as number, 0) : null,
    barras,
    nome,
    mat
  };
}

function extractReviewSnapshotCount(review: InventarioReviewRow | null, stage: 1 | 2): SnapshotCountInfo | null {
  if (!review?.snapshot || typeof review.snapshot !== "object") return null;
  const snapshot = review.snapshot as Record<string, unknown>;

  if (review.reason_code === "sem_consenso") {
    return parseSnapshotCountInfo(stage === 1 ? snapshot.primeira : snapshot.segunda);
  }

  if (review.reason_code === "conflito_lock" && stage === 2) {
    const eventInfo = parseSnapshotCountInfo(snapshot.event_payload);
    if (!eventInfo) return null;
    if (eventInfo.nome || eventInfo.mat) return eventInfo;
    const lockedNome = snapshot.locked_nome == null ? null : String(snapshot.locked_nome).trim() || null;
    const lockedMat = snapshot.locked_mat == null ? null : String(snapshot.locked_mat).trim() || null;
    return { ...eventInfo, nome: lockedNome, mat: lockedMat };
  }

  return null;
}

function pickText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const compact = value.trim();
    if (compact) return compact;
  }
  return null;
}

function resolveCountedDisplayInfo(row: Row, stage: InventarioStageView): CountedDisplayInfo | null {
  if (stage === "s1") {
    if (!row.c1) return null;
    return { qtd: row.c1.qtd_contada, mat: row.c1.counted_mat, nome: row.c1.counted_nome };
  }

  if (stage === "s2") {
    if (!row.c2) return null;
    return { qtd: row.c2.qtd_contada, mat: row.c2.counted_mat, nome: row.c2.counted_nome };
  }

  if (stage === "conciliation" || stage === "done") {
    if (row.review?.status === "resolvido") {
      const fallbackSource = row.c2 ?? row.c1 ?? null;
      return {
        qtd: row.review.final_qtd,
        mat: row.review.resolved_mat ?? fallbackSource?.counted_mat ?? null,
        nome: row.review.resolved_nome ?? fallbackSource?.counted_nome ?? null
      };
    }
    if (row.c2) return { qtd: row.c2.qtd_contada, mat: row.c2.counted_mat, nome: row.c2.counted_nome };
    if (row.c1) return { qtd: row.c1.qtd_contada, mat: row.c1.counted_mat, nome: row.c1.counted_nome };
  }

  return null;
}

function formatCountedByLine(nome: string | null): string | null {
  const nomeTrim = (nome ?? "").trim().replace(/\s+/g, " ");
  if (!nomeTrim) return null;

  return nomeTrim
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function formatConcludedByLine(info: CountedDisplayInfo | null): string {
  if (!info) return "Concluído por: Usuário não informado";

  const formattedName = formatCountedByLine(info.nome);
  if (formattedName) return `Concluído por: ${formattedName}`;

  const mat = (info.mat ?? "").trim();
  if (mat) return `Concluído por: Mat ${mat}`;

  return "Concluído por: Usuário não informado";
}

function derive(manifest: InventarioManifestItemRow[], remote: InventarioSyncPullState): Row[] {
  const counts = new Map<string, { c1: InventarioCountRow | null; c2: InventarioCountRow | null }>();
  for (const c of remote.counts) {
    const k = keyOf(c.zona, c.endereco, c.coddv);
    const cur = counts.get(k) ?? { c1: null, c2: null };
    if (c.etapa === 2) cur.c2 = c; else cur.c1 = c;
    counts.set(k, cur);
  }
  const reviews = new Map<string, InventarioReviewRow>();
  for (const r of remote.reviews) reviews.set(keyOf(r.zona, r.endereco, r.coddv), r);

  return manifest.map((m) => {
    const k = keyOf(m.zona, m.endereco, m.coddv);
    const c = counts.get(k) ?? { c1: null, c2: null };
    const rawReview = reviews.get(k) ?? null;
    const review = normalizeApplicableReview(rawReview, c.c1, c.c2);
    const final = review?.status === "resolvido"
      || c.c1?.resultado === "descartado"
      || c.c2?.resultado === "descartado"
      || (c.c1 != null && c.c2 != null && c.c1.qtd_contada === c.c2.qtd_contada)
      || (c.c1 != null && c.c1.resultado !== "sobra" && review == null);
    return { ...m, key: k, c1: c.c1, c2: c.c2, review, final };
  });
}

function optimistic(previous: InventarioSyncPullState, payload: Record<string, unknown>, profile: InventarioModuleProfile): InventarioSyncPullState {
  const cycle = String(payload.cycle_date ?? CYCLE_DATE);
  const cd = Number.parseInt(String(payload.cd ?? ""), 10);
  const zona = String(payload.zona ?? "").trim().toUpperCase();
  const endereco = String(payload.endereco ?? "").trim().toUpperCase();
  const coddv = Number.parseInt(String(payload.coddv ?? ""), 10);
  if (!Number.isFinite(cd) || !zona || !endereco || !Number.isFinite(coddv)) return previous;

  if (String(payload.final_qtd ?? "").length > 0) {
    const q = Math.max(Number.parseInt(String(payload.final_qtd ?? "0"), 10) || 0, 0);
    const estoque = Math.max(Number.parseInt(String(payload.estoque ?? "0"), 10) || 0, 0);
    const nextReviews = [...previous.reviews];
    const idx = nextReviews.findIndex((r) => r.cycle_date === cycle && r.cd === cd && keyOf(r.zona, r.endereco, r.coddv) === keyOf(zona, endereco, coddv));
    if (idx >= 0) {
      nextReviews[idx] = {
        ...nextReviews[idx],
        status: "resolvido",
        final_qtd: q,
        final_barras: q > 0 ? String(payload.final_barras ?? "") || null : null,
        final_resultado: resultOf(estoque, q, false),
        resolved_by: profile.user_id,
        resolved_mat: profile.mat,
        resolved_nome: profile.nome,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }
    return { ...previous, reviews: nextReviews, server_time: new Date().toISOString() };
  }

  const etapa = Number.parseInt(String(payload.etapa ?? "1"), 10) === 2 ? 2 : 1;
  const qtd = payload.discarded === true ? 0 : Math.max(Number.parseInt(String(payload.qtd_contada ?? "0"), 10) || 0, 0);
  const estoque = Math.max(Number.parseInt(String(payload.estoque ?? "0"), 10) || 0, 0);
  const r = resultOf(estoque, qtd, payload.discarded === true);
  const nextCount: InventarioCountRow = {
    cycle_date: cycle,
    cd,
    zona,
    endereco,
    coddv,
    descricao: String(payload.descricao ?? `Código e Dígito ${coddv}`),
    estoque,
    etapa,
    qtd_contada: qtd,
    barras: qtd > 0 && payload.discarded !== true ? String(payload.barras ?? "") || null : null,
    resultado: r,
    counted_by: profile.user_id,
    counted_mat: profile.mat,
    counted_nome: profile.nome,
    updated_at: new Date().toISOString()
  };
  const counts = previous.counts.filter((c) => !(c.cycle_date === cycle && c.cd === cd && keyOf(c.zona, c.endereco, c.coddv) === keyOf(zona, endereco, coddv) && c.etapa === etapa));
  counts.push(nextCount);
  return { ...previous, counts, server_time: new Date().toISOString() };
}

export default function InventarioZeradosPage({ isOnline, profile }: InventarioPageProps) {
  const userName = useMemo(() => displayName(profile.nome), [profile.nome]);
  const fixed = useMemo(() => fixedCd(profile), [profile]);
  const isGlobalAdmin = profile.role === "admin" && fixed == null;
  const canEdit = profile.role !== "viewer";
  const canExport = profile.role === "admin";
  const canManageBase = profile.role === "admin";

  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [cd, setCd] = useState<number | null>(fixed);
  const [preferOffline, setPreferOffline] = useState(false);

  const [manifestMeta, setManifestMeta] = useState<InventarioManifestMeta | null>(null);
  const [manifestItems, setManifestItems] = useState<InventarioManifestItemRow[]>([]);
  const [remoteState, setRemoteState] = useState<InventarioSyncPullState>(defaultState);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingErrors, setPendingErrors] = useState(0);
  const [showPendingSyncModal, setShowPendingSyncModal] = useState(false);
  const [pendingSyncRows, setPendingSyncRows] = useState<InventarioPendingEvent[]>([]);
  const [busyPendingDiscard, setBusyPendingDiscard] = useState(false);
  const [dbBarrasCount, setDbBarrasCount] = useState(0);
  const [dbBarrasLastSyncAt, setDbBarrasLastSyncAt] = useState<string | null>(null);

  const [tab, setTab] = useState<InventarioStageView>("s1");
  const [statusFilter, setStatusFilter] = useState<StageStatusFilter>("pendente");
  const [reviewFilter, setReviewFilter] = useState<ReviewStatusFilter>("pendente");
  const [zone, setZone] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [qtd, setQtd] = useState("0");
  const [barras, setBarras] = useState("");
  const [validatedBarras, setValidatedBarras] = useState<string | null>(null);
  const [validatedFinalBarras, setValidatedFinalBarras] = useState<string | null>(null);
  const [barrasValidationState, setBarrasValidationState] = useState<BarcodeValidationState>("idle");
  const [finalBarrasValidationState, setFinalBarrasValidationState] = useState<BarcodeValidationState>("idle");
  const [countEditMode, setCountEditMode] = useState(true);
  const [finalQtd, setFinalQtd] = useState("0");
  const [finalBarras, setFinalBarras] = useState("");

  const [busy, setBusy] = useState(false);
  const [busyOfflineBase, setBusyOfflineBase] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [popupErr, setPopupErr] = useState<string | null>(null);

  const [dtIni, setDtIni] = useState(CYCLE_DATE);
  const [dtFim, setDtFim] = useState(CYCLE_DATE);
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [adminEntryOpen, setAdminEntryOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminManageMode, setAdminManageMode] = useState<InventarioAdminManageMode | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminZones, setAdminZones] = useState<InventarioAdminZoneRow[]>([]);
  const [adminSelectedZones, setAdminSelectedZones] = useState<string[]>([]);
  const [adminEstoqueIni, setAdminEstoqueIni] = useState("0");
  const [adminEstoqueFim, setAdminEstoqueFim] = useState("0");
  const [adminStockType, setAdminStockType] = useState<InventarioAdminStockTypeValue>("");
  const [adminIgnoreRecentAuditedDays, setAdminIgnoreRecentAuditedDays] = useState("0");
  const [adminIncluirPul, setAdminIncluirPul] = useState(false);
  const [adminManualCoddvCsv, setAdminManualCoddvCsv] = useState("");
  const [adminZoneSearch, setAdminZoneSearch] = useState("");
  const [adminZonesLoading, setAdminZonesLoading] = useState(false);
  const [adminZonePickerOpen, setAdminZonePickerOpen] = useState(false);
  const [adminZoneDraft, setAdminZoneDraft] = useState<string[]>([]);
  const [adminPreviewRows, setAdminPreviewRows] = useState<InventarioAdminPreviewZoneRow[]>([]);
  const [adminPreviewScope, setAdminPreviewScope] = useState<InventarioAdminSeedScope | null>(null);
  const [adminSummary, setAdminSummary] = useState<InventarioAdminSeedSummary | null>(null);
  const [adminSuccessMsg, setAdminSuccessMsg] = useState<string | null>(null);
  const [adminClearHardReset, setAdminClearHardReset] = useState(false);
  const [adminConfirm, setAdminConfirm] = useState<InventarioAdminConfirmState | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth >= 1024;
  });
  const [mobileStep, setMobileStep] = useState<MobileFlowStep>(() => {
    return "stage";
  });
  const [showZonePicker, setShowZonePicker] = useState(false);
  const [zoneSearchInput, setZoneSearchInput] = useState("");
  const [zonePickerKeyboardInset, setZonePickerKeyboardInset] = useState(0);
  const [zonePickerViewportHeight, setZonePickerViewportHeight] = useState<number | null>(null);
  const [editorKeyboardInset, setEditorKeyboardInset] = useState(0);
  const [editorViewportHeight, setEditorViewportHeight] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPopupMotion, setEditorPopupMotion] = useState<"default" | "next">("default");
  const [reportOpen, setReportOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerTarget, setScannerTarget] = useState<ScannerTarget>("barras");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  const syncRef = useRef(false);
  const qtdInputRef = useRef<HTMLInputElement | null>(null);
  const finalQtdInputRef = useRef<HTMLInputElement | null>(null);
  const stageBarrasInputRef = useRef<HTMLInputElement | null>(null);
  const finalBarrasInputRef = useRef<HTMLInputElement | null>(null);
  const reportDtIniInputRef = useRef<HTMLInputElement | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerTrackRef = useRef<MediaStreamTrack | null>(null);
  const scannerTorchModeRef = useRef<"none" | "controls" | "track">("none");
  const pageScrollAnchorRef = useRef<HTMLElement | null>(null);
  const didNormalizeInitialScrollRef = useRef(false);
  const zoneSearchInputRef = useRef<HTMLInputElement | null>(null);
  const scannerInputStateRef = useRef<Record<ScannerTarget, ScannerInputState>>({
    barras: createScannerInputState(),
    final_barras: createScannerInputState()
  });
  const barcodeLookupCacheRef = useRef<Map<string, DbBarrasCacheRow | false>>(new Map());
  const barcodeLookupInFlightRef = useRef<Map<string, Promise<DbBarrasCacheRow | null>>>(new Map());
  const erroEnderecoLogCacheRef = useRef<Map<string, number>>(new Map());
  const autoSyncDebounceTimerRef = useRef<number | null>(null);
  const backgroundPullTimerRef = useRef<number | null>(null);
  const backgroundPullRunningRef = useRef(false);
  const offlineBaseAutoSyncKeyRef = useRef<string>("");
  const barrasValueRef = useRef("");
  const finalBarrasValueRef = useRef("");
  const popupWasOpenRef = useRef(false);
  const popupReturnFocusRef = useRef<HTMLElement | null>(null);
  const popupBodyRef = useRef<HTMLDivElement | null>(null);
  const cameraSupported = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }, []);
  const resolveScanFeedbackAnchor = useCallback(() => {
    if (scannerTarget === "final_barras") {
      return finalBarrasInputRef.current ?? stageBarrasInputRef.current;
    }
    return stageBarrasInputRef.current ?? finalBarrasInputRef.current;
  }, [scannerTarget]);
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
  } = useOnDemandSoftKeyboard("numeric");

  useEffect(() => {
    if (didNormalizeInitialScrollRef.current) return;
    didNormalizeInitialScrollRef.current = true;
    const rafId = window.requestAnimationFrame(() => {
      const anchor = pageScrollAnchorRef.current;
      if (anchor && document.contains(anchor)) {
        anchor.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
      } else {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const closeEditorPopup = useCallback(() => {
    disableBarcodeSoftKeyboard();
    setEditorPopupMotion("default");
    setPopupErr(null);
    setCountEditMode(true);
    setValidatedBarras(null);
    setValidatedFinalBarras(null);
    setBarrasValidationState("idle");
    setFinalBarrasValidationState("idle");
    setScannerOpen(false);
    setScannerError(null);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTrackRef.current = null;
    scannerTorchModeRef.current = "none";
    setEditorOpen(false);
  }, [disableBarcodeSoftKeyboard]);

  const closeAllAdminPopups = useCallback(() => {
    setAdminConfirm(null);
    setAdminZonePickerOpen(false);
    setAdminOpen(false);
    setAdminEntryOpen(false);
    setAdminSuccessMsg(null);
  }, []);

  useEffect(() => {
    if (editorOpen) {
      disableBarcodeSoftKeyboard();
    }
  }, [disableBarcodeSoftKeyboard, editorOpen]);

  const keepFocusedControlVisible = useCallback((event: FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = event.currentTarget;
    window.setTimeout(() => {
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    }, 40);
  }, []);
  const focusAndSelectNumericInput = useCallback((event: FocusEvent<HTMLInputElement>) => {
    event.currentTarget.select();
    keepFocusedControlVisible(event);
  }, [keepFocusedControlVisible]);
  const activateCountEditMode = useCallback(() => {
    setPopupErr(null);
    setCountEditMode(true);
    window.setTimeout(() => {
      const target = qtdInputRef.current;
      if (!target || target.disabled) return;
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
      target.select();
    }, 60);
  }, []);
  useEffect(() => {
    barrasValueRef.current = barras;
  }, [barras]);
  useEffect(() => {
    finalBarrasValueRef.current = finalBarras;
  }, [finalBarras]);

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

  const stopCameraScanner = useCallback(() => {
    const controls = scannerControlsRef.current;
    const activeTrack = scannerTrackRef.current ?? resolveScannerTrack();
    if (controls) {
      if (controls.switchTorch && torchEnabled && scannerTorchModeRef.current === "controls") {
        void controls.switchTorch(false).catch(() => {
          // Ignore torch shutdown failures on unsupported browsers.
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
            // Ignore torch shutdown failures on unsupported browsers.
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
  }, [resolveScannerTrack, torchEnabled]);

  const closeCameraScanner = useCallback(() => {
    stopCameraScanner();
    setScannerOpen(false);
    setScannerError(null);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTrackRef.current = null;
    scannerTorchModeRef.current = "none";
  }, [stopCameraScanner]);

  const openCameraScanner = useCallback((target: ScannerTarget) => {
    if (!cameraSupported) {
      setPopupErr("Câmera não disponível neste navegador/dispositivo.");
      return;
    }
    setPopupErr(null);
    setScannerError(null);
    setScannerTarget(target);
    setTorchEnabled(false);
    setTorchSupported(false);
    scannerTrackRef.current = null;
    scannerTorchModeRef.current = "none";
    setScannerOpen(true);
  }, [cameraSupported]);

  const toggleTorch = useCallback(async () => {
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
          throw new Error("Track sem suporte de constraints");
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
  }, [resolveScannerTrack, supportsTrackTorch, torchEnabled]);

  const refreshPending = useCallback(async () => {
    if (cd == null) {
      setPendingCount(0);
      setPendingErrors(0);
      return;
    }
    const rows = await listPendingEventsByCycle(profile.user_id, cd, CYCLE_DATE);
    setPendingCount(rows.length);
    setPendingErrors(rows.filter((row) => row.status === "error").length);
  }, [cd, profile.user_id]);

  const loadPendingSyncRows = useCallback(async () => {
    if (cd == null) {
      setPendingSyncRows([]);
      return [];
    }
    const rows = await listPendingEventsByCycle(profile.user_id, cd, CYCLE_DATE);
    setPendingSyncRows(rows);
    return rows;
  }, [cd, profile.user_id]);

  const openPendingSyncModal = useCallback(async () => {
    const rows = await loadPendingSyncRows();
    if (rows.length <= 0) {
      setShowPendingSyncModal(false);
      return;
    }
    setShowPendingSyncModal(true);
  }, [loadPendingSyncRows]);

  const discardPendingSyncRow = useCallback(async (eventId: string) => {
    setBusyPendingDiscard(true);
    try {
      await removePendingEvent(eventId);
      const rows = await loadPendingSyncRows();
      await refreshPending();
      if (rows.length <= 0) {
        setShowPendingSyncModal(false);
      }
    } finally {
      setBusyPendingDiscard(false);
    }
  }, [loadPendingSyncRows, refreshPending]);

  const discardAllPendingSyncRows = useCallback(async () => {
    if (pendingSyncRows.length <= 0) {
      setShowPendingSyncModal(false);
      return;
    }
    setBusyPendingDiscard(true);
    try {
      for (const row of pendingSyncRows) {
        await removePendingEvent(row.event_id);
      }
      await refreshPending();
      setPendingSyncRows([]);
      setShowPendingSyncModal(false);
    } finally {
      setBusyPendingDiscard(false);
    }
  }, [pendingSyncRows, refreshPending]);

  const loadLocal = useCallback(async () => {
    if (cd == null) return;
    const [meta, items, state] = await Promise.all([
      getManifestMetaLocal(profile.user_id, cd),
      listManifestItemsByCd(profile.user_id, cd),
      getRemoteStateCache(profile.user_id, cd, CYCLE_DATE)
    ]);
    if (meta && !isCurrentManifestBase(meta)) {
      await clearManifestSnapshotByCd(profile.user_id, cd);
      setManifestMeta(null);
      setManifestItems([]);
      setRemoteState(state ?? defaultState());
      return;
    }
    setManifestMeta(meta);
    setManifestItems(items);
    setRemoteState(state ?? defaultState());
  }, [cd, profile.user_id]);

  const pull = useCallback(async () => {
    if (cd == null) return;
    const pulled = await fetchSyncPull({ cd, cycle_date: CYCLE_DATE, since: null });
    setRemoteState(pulled);
    await saveRemoteStateCache({ user_id: profile.user_id, cd, cycle_date: CYCLE_DATE, state: pulled });
  }, [cd, profile.user_id]);

  const syncPending = useCallback(async (): Promise<PendingSyncSummary> => {
    if (!isOnline || cd == null) {
      return { synced: 0, failed: 0, discarded: 0, remaining: 0 };
    }
    const queue = await listPendingEventsByCycle(profile.user_id, cd, CYCLE_DATE);
    let synced = 0;
    let failed = 0;
    let discarded = 0;
    for (const e of queue) {
      try {
        const result = await applyInventarioEvent({ event_type: e.event_type, payload: e.payload, client_event_id: e.client_event_id });
        await removePendingEvent(e.event_id);
        if (isDiscardConflict(result.info)) {
          discarded += 1;
          continue;
        }
        synced += 1;
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error ?? "");
        if (isDiscardConflict(raw)) {
          await removePendingEvent(e.event_id);
          discarded += 1;
          continue;
        }
        failed += 1;
        await updatePendingEventStatus({ event_id: e.event_id, status: "error", error_message: parseErr(error), increment_attempt: true });
      }
    }
    const remaining = await countPendingEventsByCycle(profile.user_id, cd, CYCLE_DATE);
    await refreshPending();
    return { synced, failed, discarded, remaining };
  }, [cd, isOnline, profile.user_id, refreshPending]);

  const syncNow = useCallback(async (forceManifest = false) => {
    if (!isOnline || cd == null || syncRef.current) return;
    syncRef.current = true;
    if (forceManifest) setBusy(true);
    setErr(null);
    try {
      const remoteMeta = await fetchManifestMeta(cd);
      if (!isCurrentManifestBase(remoteMeta)) {
        await clearManifestSnapshotByCd(profile.user_id, cd);
        setManifestMeta(null);
        setManifestItems([]);
        await pull();
        const bm = await getDbBarrasMeta();
        setDbBarrasCount(bm.row_count);
        setDbBarrasLastSyncAt(bm.last_sync_at);
        setMsg("Base do inventário pertence ao dia anterior. Use 'Gerir Base' para montar a base de hoje.");
        return;
      }
      const localMeta = await getManifestMetaLocal(profile.user_id, cd);
      const localRows = await listManifestItemsByCd(profile.user_id, cd);
      const localCount = localRows.length;
      const manifestChanged = !localMeta || localMeta.manifest_hash !== remoteMeta.manifest_hash;
      const localIncomplete = localCount < Math.max(remoteMeta.row_count, 0);

      if (forceManifest || manifestChanged || localIncomplete) {
        const bundle = await fetchManifestBundle(cd);
        await saveManifestSnapshot({ user_id: profile.user_id, cd, meta: bundle.meta, items: bundle.items });
        setManifestMeta(bundle.meta);
        setManifestItems(bundle.items);
      } else {
        setManifestMeta(remoteMeta);
        if (manifestItems.length === 0 && localRows.length > 0) {
          setManifestItems(localRows);
        }
      }
      const pendingSync = await syncPending();
      await pull();
      const bm = await getDbBarrasMeta();
      setDbBarrasCount(bm.row_count);
      setDbBarrasLastSyncAt(bm.last_sync_at);
      if (pendingSync.discarded > 0) {
        setMsg(`${formatCountLabel(pendingSync.discarded, "endereço já concluído por outro usuário e descartado", "endereços já concluídos por outro usuário e descartados")}.`);
      } else if (pendingSync.failed > 0 && pendingSync.remaining > 0) {
        setMsg(`Sincronização parcial: ${formatCountLabel(pendingSync.failed, "evento", "eventos")} com erro para nova tentativa.`);
      } else {
        setMsg("Sincronização concluída.");
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error ?? "");
      if (raw.includes("BASE_INVENTARIO_VAZIA")) {
        try {
          await clearManifestSnapshotByCd(profile.user_id, cd);
        } catch {
          // Ignore local cache cleanup failures and still report source error.
        }
        setManifestMeta(null);
        setManifestItems([]);
        setRemoteState(defaultState());
      }
      setErr(parseErr(error));
    } finally {
      if (forceManifest) setBusy(false);
      syncRef.current = false;
    }
  }, [cd, isOnline, manifestItems.length, profile.user_id, pull, syncPending]);

  const requestAutoSync = useCallback((delayMs = 700) => {
    if (!isOnline || cd == null) return;
    if (autoSyncDebounceTimerRef.current != null) {
      window.clearTimeout(autoSyncDebounceTimerRef.current);
      autoSyncDebounceTimerRef.current = null;
    }
    autoSyncDebounceTimerRef.current = window.setTimeout(() => {
      autoSyncDebounceTimerRef.current = null;
      void syncNow(false);
    }, delayMs);
  }, [cd, isOnline, syncNow]);

  const parseAdminStock = useCallback((value: string, fallback = 0): number => {
    const parsed = Number.parseInt(String(value ?? "").replace(/\D/g, ""), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(parsed, 0);
  }, []);

  const adminPreviewTotal = useMemo(
    () => adminPreviewRows.length > 0 ? adminPreviewRows[0].total_geral : 0,
    [adminPreviewRows]
  );
  const adminSummaryActorLabel = useMemo(() => {
    if (!adminSummary) return null;
    const nome = (adminSummary.usuario_nome ?? "").trim();
    const mat = (adminSummary.usuario_mat ?? "").trim();
    const at = adminSummary.atualizado_em ? formatDateTime(adminSummary.atualizado_em) : null;
    const who = nome || mat
      ? [nome, mat ? `MAT ${mat}` : null].filter(Boolean).join(" | ")
      : null;
    if (who && at) return `${who} em ${at}`;
    if (who) return who;
    if (at) return at;
    return null;
  }, [adminSummary]);
  const filteredAdminZones = useMemo(() => {
    const query = adminZoneSearch.trim().toUpperCase();
    if (!query) return adminZones;
    return adminZones.filter((row) => row.zona.includes(query));
  }, [adminZoneSearch, adminZones]);
  const openAdminZonePicker = useCallback(() => {
    setAdminZoneDraft([...adminSelectedZones]);
    setAdminZoneSearch("");
    setAdminZonePickerOpen(true);
  }, [adminSelectedZones]);
  const saveAdminZonePicker = useCallback(() => {
    setAdminSelectedZones([...adminZoneDraft].sort((a, b) => a.localeCompare(b)));
    setAdminZonePickerOpen(false);
  }, [adminZoneDraft]);

  const loadAdminZones = useCallback(async () => {
    if (!canManageBase || cd == null) return;
    setAdminZonesLoading(true);
    try {
      const rows = await fetchInventarioAdminZones(cd);
      setAdminZones(rows);
      setAdminSelectedZones((current) => {
        if (current.length > 0) {
          const available = new Set(rows.map((row) => row.zona));
          const kept = current.filter((zona) => available.has(zona));
          return kept;
        }
        return [];
      });
    } catch (error) {
      setErr(parseErr(error));
      setAdminZones([]);
      setAdminSelectedZones([]);
    } finally {
      setAdminZonesLoading(false);
    }
  }, [canManageBase, cd]);

  const openAdminMode = useCallback((mode: InventarioAdminManageMode) => {
    setAdminManageMode(mode);
    setAdminEntryOpen(false);
    setAdminPreviewRows([]);
    setAdminPreviewScope(null);
    setAdminSummary(null);
    setAdminSuccessMsg(null);
    setErr(null);
    setMsg(null);
    setAdminOpen(true);
    if (mode === "zona") {
      void loadAdminZones();
    }
  }, [loadAdminZones]);

  const reloadManifestAfterAdminApply = useCallback(async () => {
    if (cd == null) return;

    const bundle = await fetchManifestBundle(cd);
    await saveManifestSnapshot({ user_id: profile.user_id, cd, meta: bundle.meta, items: bundle.items });
    setManifestMeta(bundle.meta);
    setManifestItems(bundle.items);
    setTab("s1");
    setStatusFilter("pendente");
    setReviewFilter("pendente");
    setZone(null);
    setSearch("");
    setSelectedAddress(null);
    setSelectedItem(null);
    setMobileStep("stage");

    await pull();
    const barrasMeta = await getDbBarrasMeta();
    setDbBarrasCount(barrasMeta.row_count);
    setDbBarrasLastSyncAt(barrasMeta.last_sync_at);
  }, [cd, profile.user_id, pull]);

  const adminStockTypeValid = isInventarioAdminStockType(adminStockType);
  const adminStockTypeLabel = adminStockTypeValid ? formatInventarioAdminStockTypeLabel(adminStockType) : null;
  const adminRecentAuditDaysValue = parseAdminStock(adminIgnoreRecentAuditedDays, 0);
  const ensureAdminStockTypeSelected = useCallback(() => {
    if (adminStockTypeValid) return true;
    setErr("Selecione o tipo de estoque: Disponível ou Atual.");
    return false;
  }, [adminStockTypeValid]);

  const buildAdminSeedPayload = useCallback((scope: InventarioAdminSeedScope) => {
    const isZona = scope === "zona";
    return {
      zonas: isZona ? adminSelectedZones : [],
      estoque_ini: parseAdminStock(adminEstoqueIni, 0),
      estoque_fim: parseAdminStock(adminEstoqueFim, 0),
      estoque_tipo: adminStockTypeValid ? adminStockType : "disponivel",
      ignorar_endereco_auditado: adminRecentAuditDaysValue > 0,
      auditoria_recente_dias: adminRecentAuditDaysValue,
      incluir_pul: adminIncluirPul,
      manual_coddv_csv: isZona ? "" : adminManualCoddvCsv
    };
  }, [adminEstoqueFim, adminEstoqueIni, adminIncluirPul, adminManualCoddvCsv, adminRecentAuditDaysValue, adminSelectedZones, adminStockType, adminStockTypeValid, parseAdminStock]);

  const runAdminPreview = useCallback(async (scope: InventarioAdminSeedScope) => {
    if (!canManageBase || cd == null) return;
    if (!ensureAdminStockTypeSelected()) return;
    if (scope === "zona" && adminSelectedZones.length === 0) {
      setErr("Selecione ao menos uma zona para gerar a prévia por zona.");
      return;
    }
    if (scope === "coddv" && !adminManualCoddvCsv.trim()) {
      setErr("Informe ao menos um Código e Dígito (CODDV) para gerar a prévia desse fluxo.");
      return;
    }
    setAdminBusy(true);
    setErr(null);
    try {
      const rows = await previewInventarioAdminSeed({
        cd,
        ...buildAdminSeedPayload(scope)
      });
      setAdminPreviewScope(scope);
      setAdminPreviewRows(rows);
      setAdminSummary(null);
      setAdminSuccessMsg(null);
      setMsg(rows.length > 0 ? "Pré-visualização atualizada." : "Pré-visualização sem itens.");
    } catch (error) {
      setErr(parseErr(error));
    } finally {
      setAdminBusy(false);
    }
  }, [adminManualCoddvCsv, adminSelectedZones.length, buildAdminSeedPayload, canManageBase, cd, ensureAdminStockTypeSelected]);

  const executeAdminApplyZona = useCallback(async (mode: InventarioAdminApplyMode) => {
    if (!canManageBase || cd == null) return;
    setAdminBusy(true);
    setAdminSuccessMsg(null);
    setErr(null);
    try {
      const summary = await applyInventarioAdminSeed({
        cd,
        ...buildAdminSeedPayload("zona"),
        mode
      });
      setAdminSummary(summary);
      setAdminSuccessMsg("Dados inseridos com sucesso no fluxo por zona.");
      setMsg(`Base por zona aplicada. Itens afetados: ${summary.itens_afetados}. Total atual: ${summary.total_geral}.`);
      await reloadManifestAfterAdminApply();
      await loadAdminZones();
    } catch (error) {
      setErr(parseErr(error));
    } finally {
      setAdminBusy(false);
    }
  }, [buildAdminSeedPayload, canManageBase, cd, loadAdminZones, reloadManifestAfterAdminApply]);

  const runAdminApplyZona = useCallback((mode: InventarioAdminApplyMode) => {
    if (!canManageBase || cd == null) return;
    if (!ensureAdminStockTypeSelected()) return;
    if (adminSelectedZones.length === 0) {
      setErr("Nenhuma zona selecionada. Abra 'Escolher zonas' e salve a seleção.");
      return;
    }
    if (adminPreviewRows.length === 0 || adminPreviewScope !== "zona") {
      setErr("Faça a pré-visualização da inserção por zona antes de confirmar.");
      return;
    }

    setAdminConfirm({
      title: "Confirmar inserção por zona",
      lines: [
        `Modo: ${mode === "replace_cd" ? "Substituir base do CD" : "Recarregar zonas selecionadas"}`,
        `Tipo de estoque: ${adminStockTypeLabel ?? "Não informado"}`,
        `Ignorar auditados recentes: ${adminRecentAuditDaysValue > 0 ? `${adminRecentAuditDaysValue} dia(s)` : "Não"}`,
        `Zonas na prévia: ${adminPreviewRows.length}`,
        `Total geral: ${adminPreviewTotal}`
      ],
      confirm_label: "Confirmar inserção",
      action: { kind: "apply_zona", mode }
    });
  }, [adminPreviewRows.length, adminPreviewScope, adminPreviewTotal, adminRecentAuditDaysValue, adminSelectedZones.length, adminStockTypeLabel, canManageBase, cd, ensureAdminStockTypeSelected]);

  const executeAdminApplyCoddv = useCallback(async () => {
    if (!canManageBase || cd == null) return;
    setAdminBusy(true);
    setAdminSuccessMsg(null);
    setErr(null);
    try {
      const summary = await applyInventarioAdminManualCoddv({
        cd,
        manual_coddv_csv: adminManualCoddvCsv,
        estoque_tipo: adminStockTypeValid ? adminStockType : "disponivel",
        ignorar_endereco_auditado: adminRecentAuditDaysValue > 0,
        auditoria_recente_dias: adminRecentAuditDaysValue,
        incluir_pul: adminIncluirPul
      });
      setAdminSummary(summary);
      setAdminSuccessMsg("Dados inseridos com sucesso no fluxo por Código e Dígito.");
      setMsg(`Código e Dígito (CODDV) manual aplicado. Itens no escopo: ${summary.itens_afetados}. Total atual: ${summary.total_geral}.`);
      await reloadManifestAfterAdminApply();
      await loadAdminZones();
    } catch (error) {
      setErr(parseErr(error));
    } finally {
      setAdminBusy(false);
    }
  }, [adminIncluirPul, adminManualCoddvCsv, adminRecentAuditDaysValue, adminStockType, adminStockTypeValid, canManageBase, cd, loadAdminZones, reloadManifestAfterAdminApply]);

  const runAdminApplyCoddv = useCallback(() => {
    if (!canManageBase || cd == null) return;
    if (!ensureAdminStockTypeSelected()) return;
    if (!adminManualCoddvCsv.trim()) {
      setErr("Informe ao menos um Código e Dígito (CODDV) manual antes de confirmar.");
      return;
    }
    if (adminPreviewRows.length === 0 || adminPreviewScope !== "coddv") {
      setErr("Faça a pré-visualização da inserção por Código e Dígito (CODDV) antes de confirmar.");
      return;
    }

    setAdminConfirm({
      title: "Confirmar inserção por Código e Dígito (CODDV)",
      lines: [
        `Tipo de estoque: ${adminStockTypeLabel ?? "Não informado"}`,
        `Ignorar auditados recentes: ${adminRecentAuditDaysValue > 0 ? `${adminRecentAuditDaysValue} dia(s)` : "Não"}`,
        `Zonas na prévia: ${adminPreviewRows.length}`,
        `Total geral: ${adminPreviewTotal}`
      ],
      confirm_label: "Confirmar inserção",
      action: { kind: "apply_coddv" }
    });
  }, [adminManualCoddvCsv, adminPreviewRows.length, adminPreviewScope, adminPreviewTotal, adminRecentAuditDaysValue, adminStockTypeLabel, canManageBase, cd, ensureAdminStockTypeSelected]);

  const executeAdminClearAll = useCallback(async () => {
    if (!canManageBase || cd == null) return;
    setAdminBusy(true);
    setAdminSuccessMsg(null);
    setErr(null);
    try {
      const summary = await clearInventarioAdminBase({
        cd,
        scope: "all",
        zonas: [],
        hard_reset: adminClearHardReset
      });
      setAdminSummary(summary);
      setAdminPreviewRows([]);
      setAdminPreviewScope(null);
      setAdminSuccessMsg("Base limpa com sucesso.");
      if (summary.total_geral <= 0) {
        await clearManifestSnapshotByCd(profile.user_id, cd);
        const emptyState = defaultState();
        setManifestMeta(null);
        setManifestItems([]);
        setRemoteState(emptyState);
        await saveRemoteStateCache({ user_id: profile.user_id, cd, cycle_date: CYCLE_DATE, state: emptyState });
        setMsg(`Limpeza concluída. Itens afetados: ${summary.itens_afetados}. Base local atualizada (vazia).`);
      } else {
        setMsg(`Limpeza concluída. Itens afetados: ${summary.itens_afetados}. Total atual: ${summary.total_geral}.`);
        await syncNow(true);
      }
      await loadAdminZones();
    } catch (error) {
      setErr(parseErr(error));
    } finally {
      setAdminBusy(false);
    }
  }, [adminClearHardReset, canManageBase, cd, loadAdminZones, profile.user_id, syncNow]);

  const runAdminClearAll = useCallback(() => {
    if (!canManageBase || cd == null) return;
    const modeLabel = adminClearHardReset ? "Reset total (inclui iniciados)" : "Limpeza segura (somente pendentes)";
    setAdminConfirm({
      title: "Confirmar limpeza da base",
      lines: [
        `Tipo: ${modeLabel}`,
        "Essa ação altera imediatamente a base de auditoria do CD."
      ],
      confirm_label: "Confirmar limpeza",
      danger: true,
      action: { kind: "clear_all" }
    });
  }, [adminClearHardReset, canManageBase, cd]);

  const confirmAdminAction = useCallback(async () => {
    if (!adminConfirm) return;
    const action = adminConfirm.action;
    setAdminConfirm(null);
    if (action.kind === "apply_zona") {
      await executeAdminApplyZona(action.mode);
      return;
    }
    if (action.kind === "apply_coddv") {
      await executeAdminApplyCoddv();
      return;
    }
    await executeAdminClearAll();
  }, [adminConfirm, executeAdminApplyCoddv, executeAdminApplyZona, executeAdminClearAll]);

  const prepareOfflineBase = useCallback(async (background = false) => {
    if (cd == null) {
      setErr("Selecione um CD antes de trabalhar offline.");
      return;
    }

    setBusyOfflineBase(true);
    if (!background) {
      setErr(null);
      setMsg(null);
    }

    try {
      const [localMeta, localBarrasMeta] = await Promise.all([
        getManifestMetaLocal(profile.user_id, cd),
        getDbBarrasMeta()
      ]);

      if (!isOnline) {
        if (!localMeta || !isCurrentManifestBase(localMeta) || localMeta.row_count <= 0) {
          throw new Error("Sem base local do inventário. Conecte-se e sincronize antes de usar offline.");
        }
        if (localBarrasMeta.row_count <= 0) {
          throw new Error("Sem base local de barras. Conecte-se e ative o modo offline para sincronizar.");
        }
        setDbBarrasCount(localBarrasMeta.row_count);
        setDbBarrasLastSyncAt(localBarrasMeta.last_sync_at);
        if (!background) {
          setMsg("Offline ativo com bases locais já disponíveis.");
        }
        return;
      }

      setMsg("Atualizando base do inventário...");
      await syncNow(true);

      const barrasSync = await refreshDbBarrasCacheSmart((progress) => {
        const percent = Math.max(0, Math.min(100, progress.percent));
        if (progress.totalRows > 0) {
          setMsg(`Atualizando base de barras... ${percent}% (${progress.rowsFetched}/${progress.totalRows})`);
          return;
        }
        setMsg(`Atualizando base de barras... ${percent}%`);
      });

      const barrasMetaAfterSync = await getDbBarrasMeta();
      const barrasTotal = barrasMetaAfterSync.row_count || barrasSync.total;
      setDbBarrasCount(barrasTotal);
      setDbBarrasLastSyncAt(barrasMetaAfterSync.last_sync_at);
      setMsg("Offline ativo. Bases do inventário e de barras atualizadas neste dispositivo.");
    } catch (error) {
      setErr(parseErr(error));
    } finally {
      setBusyOfflineBase(false);
    }
  }, [cd, isOnline, profile.user_id, syncNow]);

  const scheduleBackgroundPull = useCallback(() => {
    if (typeof window === "undefined") {
      void pull().catch(() => { });
      return;
    }
    if (backgroundPullTimerRef.current != null) return;

    backgroundPullTimerRef.current = window.setTimeout(() => {
      backgroundPullTimerRef.current = null;
      if (backgroundPullRunningRef.current) return;
      backgroundPullRunningRef.current = true;
      void pull()
        .catch(() => { })
        .finally(() => {
          backgroundPullRunningRef.current = false;
        });
    }, BACKGROUND_PULL_DELAY_MS);
  }, [pull]);

  const send = useCallback(async (eventType: InventarioEventType, payload: Record<string, unknown>): Promise<SendEventResult> => {
    if (cd == null) return "discarded";
    const id = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `inv-${Date.now()}`;
    const p: InventarioPendingEvent = {
      event_id: `pending:${id}`,
      client_event_id: id,
      user_id: profile.user_id,
      cd,
      cycle_date: CYCLE_DATE,
      event_type: eventType,
      payload,
      status: "pending",
      attempt_count: 0,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    await queuePendingEvent(p);
    setRemoteState((prev) => {
      const next = optimistic(prev, payload, profile);
      void saveRemoteStateCache({ user_id: profile.user_id, cd, cycle_date: CYCLE_DATE, state: next });
      return next;
    });
    await refreshPending();
    if (shouldTriggerQueuedBackgroundSync(isOnline)) {
      requestAutoSync(150);
      setMsg("Evento salvo. Sincronizando em segundo plano.");
    } else {
      setMsg("Evento salvo offline.");
    }
    return "queued";
  }, [cd, isOnline, profile, refreshPending, requestAutoSync]);

  useEffect(() => {
    let canceled = false;
    const init = async () => {
      try {
        const prefs = await getInventarioPreferences(profile.user_id);
        if (canceled) return;
        setPreferOffline(Boolean(prefs.prefer_offline_mode));
        if (fixed != null) setCd(fixed); else if (prefs.cd_ativo != null) setCd(prefs.cd_ativo);
        if (isGlobalAdmin && isOnline) setCdOptions(await fetchCdOptions());
      } catch (error) {
        if (!canceled) setErr(parseErr(error));
      }
    };
    void init();
    return () => { canceled = true; };
  }, [fixed, isGlobalAdmin, isOnline, profile.user_id]);

  useEffect(() => { if (fixed == null) void saveInventarioPreferences(profile.user_id, { cd_ativo: cd, prefer_offline_mode: preferOffline } satisfies InventarioPreferences); }, [cd, fixed, preferOffline, profile.user_id]);
  useEffect(() => {
    barcodeLookupCacheRef.current.clear();
    barcodeLookupInFlightRef.current.clear();
  }, [cd, dbBarrasCount]);
  useEffect(() => {
    if (cd == null) {
      setDbBarrasCount(0);
      setDbBarrasLastSyncAt(null);
      return;
    }
    void loadLocal();
    void refreshPending();
    void getDbBarrasMeta().then((m) => {
      setDbBarrasCount(m.row_count);
      setDbBarrasLastSyncAt(m.last_sync_at);
    });
    if (isOnline) requestAutoSync(250);
  }, [cd, isOnline, loadLocal, refreshPending, requestAutoSync]);
  useEffect(() => {
    if (!preferOffline || !isOnline || cd == null) return;
    const key = `${cd}|${preferOffline ? "1" : "0"}|${isOnline ? "1" : "0"}`;
    if (offlineBaseAutoSyncKeyRef.current === key) return;
    offlineBaseAutoSyncKeyRef.current = key;
    void prepareOfflineBase(true);
  }, [cd, isOnline, preferOffline, prepareOfflineBase]);
  useEffect(() => {
    if (!isOnline || cd == null) return;
    const id = window.setInterval(() => {
      const popupOpen = editorOpen || reportOpen || scannerOpen || adminEntryOpen || adminOpen || adminZonePickerOpen || adminConfirm != null || showZonePicker;
      if (popupOpen) return;
      requestAutoSync(450);
    }, 30000);
    return () => window.clearInterval(id);
  }, [adminConfirm, adminEntryOpen, adminOpen, adminZonePickerOpen, cd, editorOpen, isOnline, reportOpen, requestAutoSync, scannerOpen, showZonePicker]);
  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    if (!isDesktop) setReportOpen(false);
  }, [isDesktop]);
  useEffect(() => {
    if (!adminOpen || adminManageMode !== "zona" || !canManageBase || cd == null) return;
    void loadAdminZones();
  }, [adminManageMode, adminOpen, canManageBase, cd, loadAdminZones]);
  useEffect(() => {
    if (adminOpen) return;
    setAdminManageMode(null);
    setAdminSuccessMsg(null);
    setAdminZoneSearch("");
    setAdminZonePickerOpen(false);
    setAdminConfirm(null);
    setAdminZoneDraft([]);
    setAdminEntryOpen(false);
  }, [adminOpen]);
  useEffect(() => {
    if (!adminZonePickerOpen) return;
    const available = new Set(adminZones.map((row) => row.zona));
    setAdminZoneDraft((current) => current.filter((zonaItem) => available.has(zonaItem)));
  }, [adminZonePickerOpen, adminZones]);
  useEffect(() => {
    if (!showZonePicker || typeof window === "undefined") {
      setZonePickerKeyboardInset(0);
      setZonePickerViewportHeight(null);
      return;
    }

    const vv = window.visualViewport;
    const updateViewportMetrics = () => {
      const layoutHeight = window.innerHeight;
      if (!vv) {
        setZonePickerKeyboardInset(0);
        setZonePickerViewportHeight(layoutHeight);
        return;
      }

      const inset = Math.max(0, Math.round(layoutHeight - (vv.height + vv.offsetTop)));
      setZonePickerKeyboardInset(inset);
      setZonePickerViewportHeight(Math.max(280, Math.round(vv.height)));
    };

    updateViewportMetrics();
    vv?.addEventListener("resize", updateViewportMetrics);
    vv?.addEventListener("scroll", updateViewportMetrics);
    window.addEventListener("orientationchange", updateViewportMetrics);

    return () => {
      vv?.removeEventListener("resize", updateViewportMetrics);
      vv?.removeEventListener("scroll", updateViewportMetrics);
      window.removeEventListener("orientationchange", updateViewportMetrics);
    };
  }, [showZonePicker]);
  useEffect(() => {
    if (!editorOpen || typeof window === "undefined") {
      setEditorKeyboardInset(0);
      setEditorViewportHeight(null);
      return;
    }

    const vv = window.visualViewport;
    const updateViewportMetrics = () => {
      const layoutHeight = window.innerHeight;
      if (!vv) {
        setEditorKeyboardInset(0);
        setEditorViewportHeight(layoutHeight);
        return;
      }

      const inset = Math.max(0, Math.round(layoutHeight - (vv.height + vv.offsetTop)));
      setEditorKeyboardInset(inset);
      setEditorViewportHeight(Math.max(280, Math.round(vv.height)));
    };

    updateViewportMetrics();
    vv?.addEventListener("resize", updateViewportMetrics);
    vv?.addEventListener("scroll", updateViewportMetrics);
    window.addEventListener("orientationchange", updateViewportMetrics);

    return () => {
      vv?.removeEventListener("resize", updateViewportMetrics);
      vv?.removeEventListener("scroll", updateViewportMetrics);
      window.removeEventListener("orientationchange", updateViewportMetrics);
    };
  }, [editorOpen]);
  useEffect(() => {
    const popupOpen = editorOpen || reportOpen || scannerOpen || adminEntryOpen || adminOpen || adminZonePickerOpen || adminConfirm != null;
    if (popupOpen && !popupWasOpenRef.current) {
      popupReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (!popupOpen && popupWasOpenRef.current) {
      const target = popupReturnFocusRef.current;
      if (target && document.contains(target)) {
        try {
          target.focus({ preventScroll: true });
        } catch {
          target.focus();
        }
      }
      popupReturnFocusRef.current = null;
    }
    popupWasOpenRef.current = popupOpen;
  }, [adminConfirm, adminEntryOpen, adminOpen, adminZonePickerOpen, editorOpen, reportOpen, scannerOpen]);
  useEffect(() => {
    if (!(editorOpen || reportOpen || scannerOpen || adminEntryOpen || adminOpen || adminZonePickerOpen || adminConfirm != null)) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [adminConfirm, adminEntryOpen, adminOpen, adminZonePickerOpen, editorOpen, reportOpen, scannerOpen]);
  useEffect(() => {
    if (!editorOpen) return;
    const id = window.setTimeout(() => {
      popupBodyRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      if (tab === "conciliation") return;
      if ((tab === "s1" || tab === "s2") && statusFilter === "concluido" && !countEditMode) return;

      const target = qtdInputRef.current;
      if (!target || target.disabled) return;
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
      target.select();
    }, 32);
    return () => window.clearTimeout(id);
  }, [countEditMode, editorOpen, selectedItem, statusFilter, tab]);
  useEffect(() => {
    if (!editorOpen && scannerOpen) {
      closeCameraScanner();
    }
  }, [closeCameraScanner, editorOpen, scannerOpen]);
  useEffect(() => {
    if (!reportOpen) return;
    const id = window.setTimeout(() => {
      const target = reportDtIniInputRef.current;
      if (!target) return;
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    }, 80);
    return () => window.clearTimeout(id);
  }, [reportOpen]);
  useEffect(() => {
    if (!(editorOpen || reportOpen || scannerOpen || adminEntryOpen || adminOpen || adminZonePickerOpen || adminConfirm != null)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (scannerOpen) closeCameraScanner();
      else if (adminConfirm != null || adminZonePickerOpen || adminEntryOpen || adminOpen) closeAllAdminPopups();
      else if (reportOpen) setReportOpen(false);
      else closeEditorPopup();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [adminConfirm, adminEntryOpen, adminOpen, adminZonePickerOpen, closeAllAdminPopups, closeCameraScanner, closeEditorPopup, editorOpen, reportOpen, scannerOpen]);

  const rows = useMemo(() => derive(manifestItems, remoteState), [manifestItems, remoteState]);
  const stageUniverse = useMemo(() => rows.filter((r) => rowMatchesStageUniverse(r, tab)), [rows, tab]);
  const zones = useMemo(
    () => Array.from(new Set(stageUniverse.map((r) => r.zona))).sort((a, b) => a.localeCompare(b)),
    [stageUniverse]
  );

  useEffect(() => {
    if (zone && !zones.includes(zone)) setZone(null);
  }, [zone, zones]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    return stageUniverse.filter((r) => {
      if (!rowMatchesStageStatus(r, tab, statusFilter, reviewFilter)) return false;
      if (!q) return true;
      return `${r.zona} ${r.endereco} ${r.coddv} ${r.descricao}`.toLocaleLowerCase("pt-BR").includes(q);
    });
  }, [reviewFilter, search, stageUniverse, statusFilter, tab]);

  const visible = useMemo(
    () => filteredRows.filter((r) => (zone ? r.zona === zone : true)),
    [filteredRows, zone]
  );

  const zoneBuckets = useMemo<ZoneBucketView[]>(() => {
    const zonesInCurrentFilter = new Set(filteredRows.map((row) => row.zona));
    const zoneMap = new Map<string, Map<string, { has_pending: boolean; has_done: boolean }>>();

    for (const row of stageUniverse) {
      if (!zonesInCurrentFilter.has(row.zona)) continue;
      const isPending = tab === "s1"
        ? isS1Pending(row)
        : tab === "s2"
          ? isS2Pending(row)
          : tab === "conciliation"
            ? isConciliationPending(row)
            : false;

      let addressMap = zoneMap.get(row.zona);
      if (!addressMap) {
        addressMap = new Map<string, { has_pending: boolean; has_done: boolean }>();
        zoneMap.set(row.zona, addressMap);
      }

      const addressState = addressMap.get(row.endereco) ?? { has_pending: false, has_done: false };
      if (isPending) addressState.has_pending = true;
      else addressState.has_done = true;
      addressMap.set(row.endereco, addressState);
    }

    return Array.from(zoneMap.entries())
      .map(([zona, addressMap]) => {
        let pending_addresses = 0;
        let done_addresses = 0;

        for (const state of addressMap.values()) {
          if (state.has_pending) pending_addresses += 1;
          else if (state.has_done) done_addresses += 1;
        }

        return {
          zona,
          total_addresses: addressMap.size,
          done_addresses,
          pending_addresses
        };
      })
      .sort((a, b) => a.zona.localeCompare(b.zona));
  }, [filteredRows, stageUniverse, tab]);
  const filteredZoneBuckets = useMemo(() => {
    const query = zoneSearchInput.trim().toLocaleLowerCase("pt-BR");
    if (!query) return zoneBuckets;
    return zoneBuckets.filter((bucket) => {
      return `${bucket.zona} ${bucket.total_addresses} ${bucket.done_addresses} ${bucket.pending_addresses}`.toLocaleLowerCase("pt-BR").includes(query);
    });
  }, [zoneBuckets, zoneSearchInput]);

  const addressBuckets = useMemo<AddressBucketView[]>(() => {
    const map = new Map<string, AddressBucketView>();

    for (const row of visible) {
      const key = addressKeyOf(row.zona, row.endereco);
      const existing = map.get(key);
      const isPending = tab === "s1"
        ? isS1Pending(row)
        : tab === "s2"
          ? isS2Pending(row)
          : tab === "conciliation"
            ? isConciliationPending(row)
            : false;

      if (existing) {
        existing.items.push(row);
        existing.total_items += 1;
        if (isPending) existing.pending_items += 1;
        else existing.done_items += 1;
      } else {
        map.set(key, {
          key,
          zona: row.zona,
          endereco: row.endereco,
          total_items: 1,
          pending_items: isPending ? 1 : 0,
          done_items: isPending ? 0 : 1,
          items: [row]
        });
      }
    }

    const list = Array.from(map.values());
    for (const bucket of list) {
      bucket.items.sort((a, b) => a.coddv - b.coddv);
    }
    list.sort((a, b) => {
      const byEndereco = a.endereco.localeCompare(b.endereco);
      if (byEndereco !== 0) return byEndereco;
      return a.zona.localeCompare(b.zona);
    });
    return list;
  }, [tab, visible]);
  const addressNavigation = useMemo(() => {
    const addressIndexByKey = new Map<string, number>();
    const itemPositionByKey = new Map<string, { addressIndex: number; itemIndex: number }>();

    addressBuckets.forEach((bucket, addressIndex) => {
      addressIndexByKey.set(bucket.key, addressIndex);
      bucket.items.forEach((item, itemIndex) => {
        itemPositionByKey.set(item.key, { addressIndex, itemIndex });
      });
    });

    return { addressIndexByKey, itemPositionByKey };
  }, [addressBuckets]);
  const addressBucketByKey = useMemo(() => {
    const map = new Map<string, AddressBucketView>();
    for (const bucket of addressBuckets) map.set(bucket.key, bucket);
    return map;
  }, [addressBuckets]);

  useEffect(() => {
    if (mobileStep !== "address" || !zone) {
      if (selectedAddress != null) setSelectedAddress(null);
      return;
    }
    if (!selectedAddress || !addressBuckets.some((b) => b.key === selectedAddress)) {
      setSelectedAddress(addressBuckets[0]?.key ?? null);
    }
  }, [addressBuckets, mobileStep, selectedAddress, zone]);

  const activeAddress = useMemo(
    () => (selectedAddress ? addressBucketByKey.get(selectedAddress) ?? null : null),
    [addressBucketByKey, selectedAddress]
  );

  useEffect(() => {
    const items = activeAddress?.items ?? [];
    if (!selectedItem || !items.some((item) => item.key === selectedItem)) {
      setSelectedItem(items[0]?.key ?? null);
    }
  }, [activeAddress, selectedItem]);

  const active = useMemo(() => {
    const items = activeAddress?.items ?? [];
    if (!items.length) return null;
    if (!selectedItem) return items[0];
    return items.find((row) => row.key === selectedItem) ?? items[0];
  }, [activeAddress, selectedItem]);

  useEffect(() => {
    if (!active) {
      setQtd("0");
      setBarras("");
      setValidatedBarras(null);
      setBarrasValidationState("idle");
      setFinalQtd("0");
      setFinalBarras("");
      setValidatedFinalBarras(null);
      setFinalBarrasValidationState("idle");
      return;
    }

    const currentCount = tab === "s2" ? active.c2 : active.c1;
    setQtd(String(currentCount?.qtd_contada ?? 0));
    const currentBarras = normalizeBarcode(currentCount?.barras ?? "");
    setBarras(currentBarras);
    setValidatedBarras(currentBarras || null);
    setBarrasValidationState(currentBarras ? "valid" : "idle");

    const suggestedFinal = active.review?.final_qtd
      ?? active.c2?.qtd_contada
      ?? active.c1?.qtd_contada
      ?? 0;
    setFinalQtd(String(suggestedFinal));
    const currentFinalBarras = normalizeBarcode(active.review?.final_barras ?? "");
    setFinalBarras(currentFinalBarras);
    setValidatedFinalBarras(currentFinalBarras || null);
    setFinalBarrasValidationState(currentFinalBarras ? "valid" : "idle");
  }, [active?.key, active?.c1?.updated_at, active?.c2?.updated_at, active?.review?.updated_at, tab]);

  useEffect(() => {
    if (!editorOpen) return;
    if (!active) closeEditorPopup();
  }, [active, closeEditorPopup, editorOpen]);
  useEffect(() => {
    if (!editorOpen) {
      setPopupErr(null);
      return;
    }
    setPopupErr(null);
  }, [active?.key, editorOpen, tab]);
  useEffect(() => {
    if (!editorOpen) {
      setCountEditMode(true);
      return;
    }

    if ((tab === "s1" || tab === "s2") && statusFilter === "concluido") {
      setCountEditMode(false);
      return;
    }

    setCountEditMode(true);
  }, [active?.key, editorOpen, statusFilter, tab]);

  const canShowStageSelector = mobileStep === "stage";
  const canShowZoneSelector = mobileStep === "zone";
  const canShowAddressList = mobileStep === "address";
  const showTopContextBlocks = canShowStageSelector;
  const isAdminZonaFlow = adminManageMode === "zona";
  const isAdminCoddvFlow = adminManageMode === "coddv";
  const dbBarrasSyncLabel = dbBarrasLastSyncAt
    ? `db_barras atualizada em ${formatDateTime(dbBarrasLastSyncAt)}`
    : "db_barras sem atualização local";
  const dbInventarioActorLabel = useMemo(() => {
    if (!manifestMeta) return null;
    const nome = (manifestMeta.base_usuario_nome ?? "").trim();
    const mat = (manifestMeta.base_usuario_mat ?? "").trim();
    const at = manifestMeta.base_atualizado_em ? formatDateTime(manifestMeta.base_atualizado_em) : null;
    const who = nome || mat ? [nome, mat ? `MAT ${mat}` : null].filter(Boolean).join(" | ") : null;
    if (!who && !at) return null;
    if (who && at) return `db_inventario atualizada por ${who} em ${at}`;
    if (who) return `db_inventario atualizada por ${who}`;
    return `db_inventario atualizada em ${at}`;
  }, [manifestMeta]);
  const handleToggleOffline = useCallback(() => {
    const nextMode = !preferOffline;
    setPreferOffline(nextMode);
    setErr(null);
    if (nextMode) {
      if (isOnline) {
        setMsg("Offline ativado. Atualizando bases em segundo plano...");
        void prepareOfflineBase(true);
      } else {
        void prepareOfflineBase(false);
      }
      return;
    }
    offlineBaseAutoSyncKeyRef.current = "";
    setMsg("Modo online ativado.");
  }, [isOnline, preferOffline, prepareOfflineBase]);

  const handleTabChange = useCallback((nextTab: InventarioStageView) => {
    setTab(nextTab);
    closeEditorPopup();
    setShowZonePicker(false);
    setZoneSearchInput("");
    setZone(null);
    setSelectedAddress(null);
    setSelectedItem(null);
    setSearch("");
    if (nextTab === "s1" || nextTab === "s2") setStatusFilter("pendente");
    if (nextTab === "conciliation") setReviewFilter("pendente");
    setMobileStep("zone");
  }, [closeEditorPopup]);

  const handleZoneSelect = useCallback((value: string) => {
    setShowZonePicker(false);
    setZoneSearchInput("");
    setZone(value);
    setSelectedAddress(null);
    setSelectedItem(null);
    setSearch("");
    setMobileStep("address");
  }, []);
  const clearZoneFilter = useCallback(() => {
    setZone(null);
    setSelectedAddress(null);
    setSelectedItem(null);
    setSearch("");
    if (!isDesktop) {
      setMobileStep("zone");
    }
  }, [isDesktop]);

  const openAddressEditor = useCallback((bucket: AddressBucketView) => {
    setEditorPopupMotion("default");
    setSelectedAddress(bucket.key);
    setSelectedItem(bucket.items[0]?.key ?? null);
    setEditorOpen(true);
  }, []);

  const advanceAfterAction = useCallback((addressKey: string | null, itemKey: string | null) => {
    if (!addressKey || !itemKey) {
      closeEditorPopup();
      return;
    }

    const addressIndex = addressNavigation.addressIndexByKey.get(addressKey) ?? -1;
    if (addressIndex < 0) {
      closeEditorPopup();
      setMobileStep("zone");
      return;
    }

    const sameAddressItems = addressBuckets[addressIndex].items;
    const itemPosition = addressNavigation.itemPositionByKey.get(itemKey);
    const itemIndex = itemPosition?.addressIndex === addressIndex ? itemPosition.itemIndex : -1;
    if (itemIndex >= 0 && itemIndex + 1 < sameAddressItems.length) {
      setEditorPopupMotion("next");
      setSelectedAddress(addressKey);
      setSelectedItem(sameAddressItems[itemIndex + 1].key);
      setEditorOpen(true);
      return;
    }

    for (let index = addressIndex + 1; index < addressBuckets.length; index += 1) {
      const nextBucket = addressBuckets[index];
      if (!nextBucket.items.length) continue;
      setEditorPopupMotion("next");
      setSelectedAddress(nextBucket.key);
      setSelectedItem(nextBucket.items[0].key);
      setEditorOpen(true);
      return;
    }

    closeEditorPopup();
    setSelectedAddress(null);
    setSelectedItem(null);
    setShowZonePicker(false);
    setZoneSearchInput("");
    setZone(null);
    setSearch("");
    setMobileStep("zone");
    setMsg("Zona concluída. Selecione a próxima zona.");
  }, [addressBuckets, addressNavigation, closeEditorPopup]);

  const canEditCount = useCallback((row: Row | null): boolean => {
    if (!row || !canEdit) return false;

    if (tab === "s1") {
      if (row.review?.status === "resolvido") return false;
      if (row.c2 != null) return false;
      if (row.c1 == null) return true;
      return row.c1.counted_by === profile.user_id;
    }

    if (tab === "s2") {
      if (!isS2Eligible(row)) return false;
      if (row.review?.status === "resolvido") return false;
      if (row.c2 == null) return row.c1!.counted_by !== profile.user_id;
      return row.c2.counted_by === profile.user_id;
    }

    return false;
  }, [canEdit, profile.user_id, tab]);

  const activeStageCount = useMemo(() => {
    if (!active || !(tab === "s1" || tab === "s2")) return null;
    return tab === "s2" ? active.c2 : active.c1;
  }, [active, tab]);
  const isConcludedCountFilter = (tab === "s1" || tab === "s2") && statusFilter === "concluido";
  const canEditConcludedCount = Boolean(isConcludedCountFilter && activeStageCount && canEditCount(active));
  const showCountReadOnlyDetails = Boolean(isConcludedCountFilter && activeStageCount && !countEditMode);

  const canResolveConciliation = useMemo(
    () => tab === "conciliation" && active?.review?.status === "pendente",
    [active?.review?.status, tab]
  );

  const qtyParsed = Number.parseInt(qtd, 10);
  const finalQtyParsed = Number.parseInt(finalQtd, 10);
  const requiresBarras = Boolean(
    active
    && (tab === "s1" || tab === "s2")
    && Number.isFinite(qtyParsed)
    && qtyParsed > 0
  );
  const normalizedBarras = normalizeBarcode(barras);
  const barrasValidatedForCurrentInput = Boolean(
    requiresBarras
    && normalizedBarras
    && validatedBarras === normalizedBarras
  );
  const saveCountLabel = requiresBarras && !barrasValidatedForCurrentInput ? "Validar barras" : "Salvar";
  const requiresFinalBarras = Boolean(
    active
    && tab === "conciliation"
    && Number.isFinite(finalQtyParsed)
    && finalQtyParsed > 0
  );
  const normalizedFinalBarras = normalizeBarcode(finalBarras);
  const finalBarrasValidatedForCurrentInput = Boolean(
    requiresFinalBarras
    && normalizedFinalBarras
    && validatedFinalBarras === normalizedFinalBarras
  );
  const barrasIconClassName = `field-icon validation-status inventario-barras-icon${requiresBarras && barrasValidationState === "validating" ? " is-validating" : ""}${requiresBarras && barrasValidatedForCurrentInput && barrasValidationState === "valid" ? " is-valid" : ""}${requiresBarras && barrasValidationState === "invalid" ? " is-invalid" : ""}`;
  const finalBarrasIconClassName = `field-icon validation-status inventario-barras-icon${requiresFinalBarras && finalBarrasValidationState === "validating" ? " is-validating" : ""}${requiresFinalBarras && finalBarrasValidatedForCurrentInput && finalBarrasValidationState === "valid" ? " is-valid" : ""}${requiresFinalBarras && finalBarrasValidationState === "invalid" ? " is-invalid" : ""}`;
  const mobileStageMenu = useMemo(
    () => ([
      { view: "s1" as const, label: "1ª Verificação" },
      { view: "s2" as const, label: "2ª Verificação" },
      { view: "conciliation" as const, label: "Conciliação" },
      { view: "done" as const, label: "Concluídos" }
    ].map((entry) => ({
      ...entry,
      count: rows.filter((row) => rowMatchesStageUniverse(row, entry.view) && rowMatchesStageStatus(row, entry.view, statusFilter, reviewFilter)).length
    }))),
    [reviewFilter, rows, statusFilter]
  );

  const stageAddressStats = useMemo(() => {
    const addressState = new Map<string, { has_pending: boolean; has_done: boolean }>();
    const sourceRows = tab === "done" ? rows : stageUniverse;

    for (const row of sourceRows) {
      const key = addressKeyOf(row.zona, row.endereco);
      const pending = isPendingForStage(row, tab);
      const current = addressState.get(key) ?? { has_pending: false, has_done: false };
      if (pending) current.has_pending = true;
      else current.has_done = true;
      addressState.set(key, current);
    }

    const total = addressState.size;
    const completed = Array.from(addressState.values()).filter((state) => !state.has_pending && state.has_done).length;
    const percent = completionPercent(completed, total);
    return { total, completed, percent };
  }, [rows, stageUniverse, tab]);

  const resolveBarcodeLookup = useCallback(async (value: string): Promise<DbBarrasCacheRow | null> => {
    const normalized = normalizeBarcode(value);
    if (!normalized) return null;

    if (barcodeLookupCacheRef.current.has(normalized)) {
      const cached = barcodeLookupCacheRef.current.get(normalized);
      if (!cached) return null;
      return cached;
    }

    const inFlight = barcodeLookupInFlightRef.current.get(normalized);
    if (inFlight) return inFlight;

    const lookupPromise = (async () => {
      let found = await getDbBarrasByBarcode(normalized);
      if (!found && isOnline && !preferOffline) {
        const online = await fetchDbBarrasByBarcodeOnline(normalized);
        if (online) {
          await upsertDbBarrasCacheRow(online);
          found = online;
        }
      }
      barcodeLookupCacheRef.current.set(normalized, found ?? false);
      return found ?? null;
    })().finally(() => {
      barcodeLookupInFlightRef.current.delete(normalized);
    });

    barcodeLookupInFlightRef.current.set(normalized, lookupPromise);
    return lookupPromise;
  }, [isOnline, preferOffline]);

  const logErroEnderecoMismatch = useCallback(async (params: {
    scannedBarcode: string;
    scannedProduct: DbBarrasCacheRow;
  }): Promise<void> => {
    if (!active || cd == null) return;

    const qtyRaw = tab === "conciliation" ? finalQtd : qtd;
    const parsedQty = Number.parseInt(qtyRaw, 10);
    const qtdInformada = Number.isFinite(parsedQty) && parsedQty >= 0 ? parsedQty : null;
    const contexto = tab === "conciliation"
      ? "conciliacao"
      : tab === "s2"
        ? "segunda_contagem"
        : "primeira_contagem";
    const dedupeKey = [
      CYCLE_DATE,
      cd,
      contexto,
      active.key,
      params.scannedProduct.coddv,
      params.scannedBarcode
    ].join("|");
    const nowTs = Date.now();
    const lastLoggedAt = erroEnderecoLogCacheRef.current.get(dedupeKey) ?? 0;
    if (nowTs - lastLoggedAt < 60_000) return;
    erroEnderecoLogCacheRef.current.set(dedupeKey, nowTs);

    try {
      await logInventarioErroEndereco({
        cycle_date: CYCLE_DATE,
        cd,
        contexto,
        zona_auditada: active.zona,
        endereco_auditado: active.endereco,
        coddv_esperado: active.coddv,
        descricao_esperada: active.descricao,
        estoque_esperado: active.estoque,
        qtd_informada: qtdInformada,
        barras_bipado: params.scannedBarcode
      });
    } catch {
      // O log é auxiliar e não deve bloquear a auditoria nem a validação.
    }
  }, [active, cd, finalQtd, qtd, tab]);

  const validateBarras = useCallback(async (coddv: number, value: string): Promise<string> => {
    const normalized = normalizeBarcode(value);
    if (!normalized) throw new Error("Informe o código de barras.");
    const found = await resolveBarcodeLookup(normalized);
    if (!found) throw new Error("Código de barras não encontrado na base.");
    if (found.coddv !== coddv) {
      void logErroEnderecoMismatch({
        scannedBarcode: normalized,
        scannedProduct: found
      });
      throw new Error("Código de barras inválido para este Código e Dígito (CODDV).");
    }
    return found.barras;
  }, [logErroEnderecoMismatch, resolveBarcodeLookup]);

  const autoValidateStageBarras = useCallback(async (value: string): Promise<boolean> => {
    if (!active || !(tab === "s1" || tab === "s2")) return false;
    if (!requiresBarras) return true;
    const normalized = normalizeBarcode(value);
    if (!normalized) {
      setValidatedBarras(null);
      setBarrasValidationState("invalid");
      triggerScanErrorAlert("Informe o código de barras.");
      return false;
    }
    setBarrasValidationState("validating");
    try {
      const validated = await validateBarras(active.coddv, normalized);
      if (normalizeBarcode(barrasValueRef.current) !== normalized) return false;
      setBarras(validated);
      setValidatedBarras(validated);
      setBarrasValidationState("valid");
      setPopupErr(null);
      return true;
    } catch (error) {
      if (normalizeBarcode(barrasValueRef.current) !== normalized) return false;
      setValidatedBarras(null);
      setBarrasValidationState("invalid");
      const normalizedError = parseErr(error);
      setPopupErr(normalizedError);
      triggerScanErrorAlert(normalizedError);
      return false;
    }
  }, [active, requiresBarras, tab, triggerScanErrorAlert, validateBarras]);

  const autoValidateFinalBarras = useCallback(async (value: string): Promise<boolean> => {
    if (!active || tab !== "conciliation") return false;
    if (!requiresFinalBarras) return true;
    const normalized = normalizeBarcode(value);
    if (!normalized) {
      setValidatedFinalBarras(null);
      setFinalBarrasValidationState("invalid");
      triggerScanErrorAlert("Informe o código de barras final.");
      return false;
    }
    setFinalBarrasValidationState("validating");
    try {
      const validated = await validateBarras(active.coddv, normalized);
      if (normalizeBarcode(finalBarrasValueRef.current) !== normalized) return false;
      setFinalBarras(validated);
      setValidatedFinalBarras(validated);
      setFinalBarrasValidationState("valid");
      setPopupErr(null);
      return true;
    } catch (error) {
      if (normalizeBarcode(finalBarrasValueRef.current) !== normalized) return false;
      setValidatedFinalBarras(null);
      setFinalBarrasValidationState("invalid");
      const normalizedError = parseErr(error);
      setPopupErr(normalizedError);
      triggerScanErrorAlert(normalizedError);
      return false;
    }
  }, [active, requiresFinalBarras, tab, triggerScanErrorAlert, validateBarras]);

  const clearScannerInputTimer = useCallback((target: ScannerTarget) => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current[target];
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const commitScannerInputValidation = useCallback(async (target: ScannerTarget, rawValue: string) => {
    const normalized = normalizeBarcode(rawValue);
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

    if (target === "barras") {
      setBarras(normalized);
      await autoValidateStageBarras(normalized);
      return;
    }

    setFinalBarras(normalized);
    await autoValidateFinalBarras(normalized);
  }, [autoValidateFinalBarras, autoValidateStageBarras, clearScannerInputTimer]);

  const scheduleScannerInputAutoSubmit = useCallback((target: ScannerTarget, value: string) => {
    if (typeof window === "undefined") return;
    const state = scannerInputStateRef.current[target];
    clearScannerInputTimer(target);
    state.timerId = window.setTimeout(() => {
      state.timerId = null;
      void commitScannerInputValidation(target, value);
    }, SCANNER_INPUT_AUTO_SUBMIT_DELAY_MS);
  }, [clearScannerInputTimer, commitScannerInputValidation]);

  const handleScannerInputChange = useCallback((target: ScannerTarget, value: string) => {
    if (target === "barras") {
      setBarras(value);
      setValidatedBarras(null);
      setBarrasValidationState("idle");
    } else {
      setFinalBarras(value);
      setValidatedFinalBarras(null);
      setFinalBarrasValidationState("idle");
    }

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

  const shouldHandleScannerTab = (target: ScannerTarget, value: string): boolean => {
    if (!value.trim()) return false;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const state = scannerInputStateRef.current[target];
    if (state.burstChars >= SCANNER_INPUT_MIN_BURST_CHARS) return true;
    if (state.lastInputAt <= 0) return false;
    return now - state.lastInputAt <= SCANNER_INPUT_MAX_INTERVAL_MS * 2;
  };

  const onStageBarrasKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !shouldHandleScannerTab("barras", barras)) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    void commitScannerInputValidation("barras", event.currentTarget.value);
  };

  const onFinalBarrasKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !shouldHandleScannerTab("final_barras", finalBarras)) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    void commitScannerInputValidation("final_barras", event.currentTarget.value);
  };

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      const state = scannerInputStateRef.current;
      for (const target of ["barras", "final_barras"] as const) {
        if (state[target].timerId != null) {
          window.clearTimeout(state[target].timerId);
          state[target].timerId = null;
        }
      }
    };
  }, []);
  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (autoSyncDebounceTimerRef.current != null) {
        window.clearTimeout(autoSyncDebounceTimerRef.current);
        autoSyncDebounceTimerRef.current = null;
      }
      if (backgroundPullTimerRef.current != null) {
        window.clearTimeout(backgroundPullTimerRef.current);
        backgroundPullTimerRef.current = null;
      }
    };
  }, []);

  const saveCount = useCallback(async (discarded: boolean) => {
    if (!active || cd == null) return;
    if (!(tab === "s1" || tab === "s2")) return;
    if (!canEditCount(active)) {
      setPopupErr("Você não pode editar este endereço nesta etapa.");
      triggerScanErrorAlert("Você não pode editar este endereço nesta etapa.");
      return;
    }

    setPopupErr(null);
    try {
      const currentAddressKey = selectedAddress;
      const currentItemKey = active.key;
      const etapa = tab === "s2" ? 2 : 1;
      const qty = discarded ? 0 : Number.parseInt(qtd, 10);
      if (!discarded && (!Number.isFinite(qty) || qty < 0)) {
        setPopupErr("Quantidade inválida.");
        triggerScanErrorAlert("Quantidade inválida.");
        return;
      }
      let b: string | null = null;
      const needsBarrasValidation = !discarded && qty > 0;
      if (needsBarrasValidation) {
        const normalized = normalizeBarcode(barras);
        if (!normalized) {
          setValidatedBarras(null);
          setPopupErr("Quantidade informada exige código de barras ou descarte.");
          triggerScanErrorAlert("Quantidade informada exige código de barras ou descarte.");
          return;
        }

        if (validatedBarras !== normalized) {
          const validatedNow = await autoValidateStageBarras(normalized);
          if (!validatedNow) return;
        }
        b = normalizeBarcode(barrasValueRef.current);
        if (!b) {
          setValidatedBarras(null);
          setPopupErr("Quantidade informada exige código de barras ou descarte.");
          triggerScanErrorAlert("Quantidade informada exige código de barras ou descarte.");
          return;
        }
      }
      const sendResult = await send("count_upsert", {
        cycle_date: CYCLE_DATE,
        cd,
        zona: active.zona,
        endereco: active.endereco,
        coddv: active.coddv,
        descricao: active.descricao,
        estoque: active.estoque,
        etapa,
        qtd_contada: qty,
        barras: b,
        discarded
      });
      if (sendResult === "discarded") {
        setValidatedBarras(null);
        advanceAfterAction(currentAddressKey, currentItemKey);
        return;
      }
      setValidatedBarras(null);
      showScanFeedback("success", active.descricao, discarded ? "Descartado" : `+ ${qty}`);
      advanceAfterAction(currentAddressKey, currentItemKey);
    } catch (error) {
      setValidatedBarras(null);
      const normalizedError = parseErr(error);
      setPopupErr(normalizedError);
      triggerScanErrorAlert(normalizedError);
    }
  }, [
    active,
    advanceAfterAction,
    autoValidateStageBarras,
    barras,
    canEditCount,
    cd,
    qtd,
    selectedAddress,
    send,
    showScanFeedback,
    tab,
    triggerScanErrorAlert,
    validatedBarras
  ]);

  const resolveReview = useCallback(async () => {
    if (!active || !active.review || cd == null) return;
    if (!canResolveConciliation) {
      setPopupErr("Conciliação já resolvida.");
      triggerScanErrorAlert("Conciliação já resolvida.");
      return;
    }
    setPopupErr(null);
    try {
      const currentAddressKey = selectedAddress;
      const currentItemKey = active.key;
      const qty = Number.parseInt(finalQtd, 10);
      if (!Number.isFinite(qty) || qty < 0) {
        setPopupErr("Quantidade final inválida.");
        triggerScanErrorAlert("Quantidade final inválida.");
        return;
      }
      let b: string | null = null;
      if (qty > 0) {
        const normalized = normalizeBarcode(finalBarras);
        if (!normalized) {
          setPopupErr("Informe código de barras válido do mesmo Código e Dígito (CODDV).");
          triggerScanErrorAlert("Informe código de barras válido do mesmo Código e Dígito (CODDV).");
          return;
        }
        if (validatedFinalBarras !== normalized) {
          const validatedNow = await autoValidateFinalBarras(normalized);
          if (!validatedNow) return;
        }
        b = normalizeBarcode(finalBarrasValueRef.current);
        if (!b) {
          setPopupErr("Informe código de barras válido do mesmo Código e Dígito (CODDV).");
          triggerScanErrorAlert("Informe código de barras válido do mesmo Código e Dígito (CODDV).");
          return;
        }
      }
      const sendResult = await send("review_resolve", {
        cycle_date: CYCLE_DATE,
        cd,
        zona: active.zona,
        endereco: active.endereco,
        coddv: active.coddv,
        estoque: active.estoque,
        final_qtd: qty,
        final_barras: b
      });
      if (sendResult === "discarded") {
        advanceAfterAction(currentAddressKey, currentItemKey);
        return;
      }
      showScanFeedback("success", active.descricao, `Qtd final: ${qty}`);
      advanceAfterAction(currentAddressKey, currentItemKey);
    } catch (error) {
      const normalizedError = parseErr(error);
      setPopupErr(normalizedError);
      triggerScanErrorAlert(normalizedError);
    }
  }, [
    active,
    advanceAfterAction,
    autoValidateFinalBarras,
    canResolveConciliation,
    cd,
    finalBarras,
    finalQtd,
    selectedAddress,
    send,
    showScanFeedback,
    triggerScanErrorAlert,
    validatedFinalBarras
  ]);

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
            const detector = new nativeBarcodeDetectorCtor({
              formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "codabar"]
            });
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
                  if (scannerTarget === "final_barras") {
                    setFinalBarras(scanned);
                    setValidatedFinalBarras(null);
                    void autoValidateFinalBarras(scanned);
                  } else {
                    setBarras(scanned);
                    setValidatedBarras(null);
                    void autoValidateStageBarras(scanned);
                  }
                  closeCameraScanner();
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
              const track = resolveScannerTrack();
              if (track) scannerTrackRef.current = track;
              if (supportsTrackTorch(track)) {
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
            video: {
              facingMode: { ideal: "environment" }
            }
          },
          videoEl,
          (result, error) => {
            if (cancelled) return;

            if (result) {
              const formatName = result.getBarcodeFormat?.().toString?.() ?? "";
              if (/QR_CODE/i.test(formatName)) return;
              const scanned = normalizeBarcode(result.getText() ?? "");
              if (!scanned) return;

              if (scannerTarget === "final_barras") {
                setFinalBarras(scanned);
                setValidatedFinalBarras(null);
                void autoValidateFinalBarras(scanned);
              } else {
                setBarras(scanned);
                setValidatedBarras(null);
                void autoValidateStageBarras(scanned);
              }

              closeCameraScanner();
              return;
            }

            const errorName = (error as { name?: string } | null)?.name;
            if (error && errorName !== "NotFoundException" && errorName !== "ChecksumException" && errorName !== "FormatException") {
              setScannerError("Não foi possível ler o código. Aproxime a câmera e tente novamente.");
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
          if (track) {
            scannerTrackRef.current = track;
          }
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
        setScannerError(error instanceof Error ? error.message : "Falha ao iniciar câmera para leitura.");
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
      if (torchProbeTimer != null) {
        window.clearTimeout(torchProbeTimer);
      }
      stopCameraScanner();
    };
  }, [autoValidateFinalBarras, autoValidateStageBarras, closeCameraScanner, resolveScannerTrack, scannerOpen, scannerTarget, stopCameraScanner, supportsTrackTorch]);

  const exportReport = useCallback(async () => {
    if (!canExport || cd == null || reportBusy) return;
    setErr(null);
    setReportBusy(true);
    setReportStatus("Contando registros do relatório...");

    const loadPagedRows = async <T,>(params: {
      totalRows: number;
      label: string;
      incompleteCode: string;
      fetchPage: (offset: number, limit: number) => Promise<T[]>;
    }): Promise<T[]> => {
      const { totalRows, label, incompleteCode, fetchPage } = params;
      if (totalRows < 1) return [];

      const rows: T[] = [];
      let offset = 0;
      let pageSize = 1000;

      while (rows.length < totalRows) {
        setReportStatus(`${label}: ${rows.length}/${totalRows} registros`);
        try {
          const batch = await fetchPage(offset, pageSize);
          if (!batch.length) {
            throw new Error(`${incompleteCode}: esperado=${totalRows} carregado=${rows.length}`);
          }

          const nextLoaded = rows.length + batch.length;
          if (nextLoaded > totalRows) {
            throw new Error(`${incompleteCode}: esperado=${totalRows} carregado=${nextLoaded}`);
          }

          rows.push(...batch);
          offset += batch.length;
          setReportStatus(`${label}: ${rows.length}/${totalRows} registros`);

          if (batch.length < pageSize && rows.length < totalRows) {
            throw new Error(`${incompleteCode}: esperado=${totalRows} carregado=${rows.length}`);
          }
        } catch (error) {
          if (isReportTimeoutError(error) && pageSize > 100) {
            pageSize = pageSize > 300 ? 300 : 100;
            setReportStatus(`${label}: consulta lenta, reduzindo lote para ${pageSize} registros...`);
            continue;
          }
          throw error;
        }
      }

      if (rows.length !== totalRows) {
        throw new Error(`${incompleteCode}: esperado=${totalRows} carregado=${rows.length}`);
      }

      return rows;
    };

    try {
      const snapshotAt = new Date().toISOString();
      const total = await countReportRows({ dt_ini: dtIni, dt_fim: dtFim, cd, snapshot_at: snapshotAt });
      const totalErroEndereco = await countInventarioErroEnderecoReportRows({ dt_ini: dtIni, dt_fim: dtFim, cd, snapshot_at: snapshotAt });
      setReportCount(total);
      if (total > 50000) {
        throw new Error(`RELATORIO_MUITO_GRANDE_${total}`);
      }

      const rowsReport = await loadPagedRows<InventarioReportRow>({
        totalRows: total,
        label: "Baixando detalhe",
        incompleteCode: "RELATORIO_INCOMPLETO",
        fetchPage: (offset, limit) => fetchReportRows({ dt_ini: dtIni, dt_fim: dtFim, cd, offset, limit, snapshot_at: snapshotAt })
      });
      const erroEnderecoRows = await loadPagedRows<InventarioErroEnderecoReportRow>({
        totalRows: totalErroEndereco,
        label: "Baixando erros de endereço",
        incompleteCode: "RELATORIO_ERRO_END_INCOMPLETO",
        fetchPage: (offset, limit) => fetchInventarioErroEnderecoReportRows({ dt_ini: dtIni, dt_fim: dtFim, cd, offset, limit, snapshot_at: snapshotAt })
      });

      setReportStatus("Montando arquivo XLSX...");
      const XLSX = await import("xlsx");
      const pickFirstBarcode = (rows: InventarioReportRow[]): string | null => {
        for (const getter of [
          (row: InventarioReportRow) => row.review_final_barras,
          (row: InventarioReportRow) => row.barras_segunda,
          (row: InventarioReportRow) => row.barras_primeira
        ]) {
          for (const row of rows) {
            const candidate = getter(row)?.trim();
            if (candidate) return candidate;
          }
        }
        return null;
      };
      const detail = rowsReport.map((r) => ({
        Data: formatDate(r.cycle_date),
        CD: r.cd,
        Zona: r.zona,
        Endereco: r.endereco,
        "Código e Dígito (CODDV)": r.coddv,
        Descricao: r.descricao,
        Estoque: r.estoque,
        QtdPrimeira: r.qtd_primeira,
        QtdSegunda: r.qtd_segunda,
        QtdFinal: r.contado_final,
        BarrasFinal: r.barras_final,
        DivergenciaFinal: r.divergencia_final,
        ValorDivergencia: r.valor_divergencia,
        StatusFinal: r.status_final,
        UsuarioPrimeira: `${r.primeira_nome ?? "-"} (${r.primeira_mat ?? "-"})`,
        UsuarioSegunda: `${r.segunda_nome ?? "-"} (${r.segunda_mat ?? "-"})`,
        UsuarioRevisao: `${r.review_resolved_nome ?? "-"} (${r.review_resolved_mat ?? "-"})`
      }));
      const summary = Array.from(rowsReport.reduce((acc, r) => {
        const z = r.zona;
        const cur = acc.get(z) ?? { Zona: z, Total: 0, Concluidos: 0, Pendentes: 0 };
        cur.Total += 1;
        if (r.status_final === "concluido") cur.Concluidos += 1; else cur.Pendentes += 1;
        acc.set(z, cur);
        return acc;
      }, new Map<string, { Zona: string; Total: number; Concluidos: number; Pendentes: number }>()).values());
      const consolidated = Array.from(rowsReport.reduce((acc, row) => {
        const key = `${row.cycle_date}|${row.cd}|${row.coddv}`;
        const bucket = acc.get(key) ?? { first: row, rows: [] as InventarioReportRow[] };
        bucket.rows.push(row);
        acc.set(key, bucket);
        return acc;
      }, new Map<string, { first: InventarioReportRow; rows: InventarioReportRow[] }>()).values()).map(({ first, rows }) => {
        const statuses = rows.map((row) => row.status_final);
        const statusFinal = statuses.every((status) => status === "concluido")
          ? "concluido"
          : statuses.includes("pendente_revisao")
            ? "pendente_revisao"
            : statuses.includes("pendente_segunda")
              ? "pendente_segunda"
              : statuses.find((status) => status !== "concluido") ?? "pendente_primeira";
        return {
          Data: formatDate(first.cycle_date),
          CD: first.cd,
          "Código e Dígito (CODDV)": first.coddv,
          Descricao: first.descricao,
          Estoque: rows.reduce((totalEstoque, row) => totalEstoque + row.estoque, 0),
          QtdPrimeira: sumNullable(rows.map((row) => row.qtd_primeira)),
          QtdSegunda: sumNullable(rows.map((row) => row.qtd_segunda)),
          QtdFinal: sumNullable(rows.map((row) => row.contado_final)),
          BarrasFinal: pickFirstBarcode(rows),
          DivergenciaFinal: first.divergencia_final,
          ValorDivergencia: first.valor_divergencia,
          StatusFinal: statusFinal
        };
      });
      const erroEnderecoSheet = (erroEnderecoRows.length ? erroEnderecoRows : []).map((row) => ({
        Data: formatDate(row.cycle_date),
        "Data/Hora": formatDateTimeBrasilia(row.created_at),
        CD: row.cd,
        Contexto: row.contexto,
        Usuario: `${row.usuario_nome ?? "-"} (${row.usuario_mat ?? "-"})`,
        ZonaAuditada: row.zona_auditada ?? "-",
        EnderecoAuditado: row.endereco_auditado,
        CODDVEsperado: row.coddv_esperado,
        DescricaoEsperada: row.descricao_esperada ?? "-",
        EstoqueEsperado: row.estoque_esperado ?? "-",
        QtdInformada: row.qtd_informada ?? "-",
        BarrasBipado: row.barras_bipado,
        CODDVBipado: row.coddv_bipado,
        DescricaoBipada: row.descricao_bipada ?? "-",
        ZonasCorretasSEP: row.zonas_sep_corretas ?? "-",
        EnderecosCorretosSEP: row.enderecos_sep_corretos ?? "-",
        EnderecosBaseEnd: row.enderecos_base_end ?? "-",
        TiposBaseEnd: row.tipos_base_end ?? "-"
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "Detalhe");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Resumo por Zona");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(consolidated), "Consolidado");
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          erroEnderecoSheet.length
            ? erroEnderecoSheet
            : [{ Mensagem: "Nenhum erro de endereço encontrado no período." }]
        ),
        "Erros Endereço"
      );
      XLSX.writeFile(wb, `inventario-zerados-${dtIni}-${dtFim}-cd${String(cd).padStart(2, "0")}.xlsx`, { compression: true });
      setMsg(`Relatório exportado com ${rowsReport.length}/${total} registros e ${erroEnderecoRows.length}/${totalErroEndereco} erros de endereço.`);
    } finally {
      setReportBusy(false);
      setReportStatus(null);
    }
  }, [canExport, cd, dtFim, dtIni, reportBusy]);

  return (
    <>
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
            <span className="module-back-icon" aria-hidden="true"><BackIcon /></span>
            <span>Início</span>
          </Link>
          <div className="module-topbar-user-side">
            <PendingSyncBadge
              pendingCount={pendingCount}
              errorCount={pendingErrors}
              title="Eventos pendentes"
              onClick={pendingCount > 0 || pendingErrors > 0 ? () => void openPendingSyncModal() : undefined}
            />
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>{isOnline ? "Online" : "Offline"}</span>
          </div>
        </div>
        <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
          <span className="module-icon" aria-hidden="true"><ModuleIcon name={MODULE_DEF.icon} /></span>
          <span className="module-title">{MODULE_DEF.title}</span>
        </div>
      </header>

      <section ref={pageScrollAnchorRef} className="modules-shell termo-shell inventario-shell">
        {showTopContextBlocks ? (
          <>
            <div className="termo-head">
              <div className="inventario-head-row">
                <h2>Olá, {userName}</h2>
                <div className="inventario-head-actions">
                  {canManageBase ? (
                    <button
                      type="button"
                      className="btn btn-muted termo-route-btn inventario-report-inline-btn"
                      onClick={() => {
                        setAdminEntryOpen(true);
                        setAdminOpen(false);
                        setAdminManageMode(null);
                        setAdminSuccessMsg(null);
                        setAdminZoneSearch("");
                        setAdminZoneDraft([]);
                        setAdminConfirm(null);
                        setAdminPreviewRows([]);
                        setAdminPreviewScope(null);
                      }}
                      title="Gerir Base"
                      aria-label="Gerir Base"
                    >
                      <span aria-hidden="true">{listIcon()}</span>
                      Gerir Base
                    </button>
                  ) : null}
                  {canExport && isDesktop ? (
                    <button
                      type="button"
                      className="btn btn-muted termo-route-btn inventario-report-inline-btn"
                      onClick={() => setReportOpen(true)}
                      title="Gerar Relatório"
                      aria-label="Gerar Relatório"
                    >
                      <span aria-hidden="true">{reportIcon()}</span>
                      Gerar Relatório
                    </button>
                  ) : null}
                </div>
              </div>
              <p className="termo-meta-line">{`Ciclo ${CYCLE_DATE_DISPLAY}`}</p>
              <div className="inventario-base-chips">
                <span className={`inventario-base-chip ${manifestMeta && manifestItems.length >= manifestMeta.row_count ? "ok" : "warn"}`}>{`db_inventario ${manifestItems.length}/${manifestMeta?.row_count ?? 0}`}</span>
                <span className={`inventario-base-chip ${dbBarrasCount > 0 ? "ok" : "warn"}`}>{`db_barras ${dbBarrasCount}`}</span>
              </div>
              {dbInventarioActorLabel ? <p className="inventario-base-sync-info ok">{dbInventarioActorLabel}</p> : null}
              <p className={`inventario-base-sync-info ${dbBarrasLastSyncAt ? "ok" : "warn"}`}>{dbBarrasSyncLabel}</p>
            </div>
            {err ? <div className="alert error">{err}</div> : null}
            {msg ? <div className="alert success">{msg}</div> : null}
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

            <div className="termo-actions-row inventario-toolbar">
              {isGlobalAdmin ? (
                <select value={cd ?? ""} onChange={(e) => setCd(e.target.value ? Number.parseInt(e.target.value, 10) : null)}>
                  <option value="">Selecione CD</option>
                  {cdOptions.map((o) => <option key={o.cd} value={o.cd}>{`CD ${String(o.cd).padStart(2, "0")} - ${o.cd_nome}`}</option>)}
                </select>
              ) : null}
              <button
                type="button"
                className="btn btn-muted termo-sync-btn"
                onClick={() => void syncNow(true)}
                disabled={!isOnline || busy || cd == null}
              >
                <span aria-hidden="true">{refreshIcon()}</span>
                {busy ? "Sincronizando..." : "Sincronizar agora"}
              </button>
              <button
                className={`btn btn-muted termo-offline-toggle${preferOffline ? " is-active" : ""}`}
                type="button"
                onClick={handleToggleOffline}
                disabled={busyOfflineBase}
              >
                {busyOfflineBase ? "Atualizando base..." : preferOffline ? "📦 Offline ativo" : "📶 Trabalhar offline"}
              </button>
            </div>
          </>
        ) : null}

        {canShowStageSelector ? (
          <div className="termo-form inventario-mobile-stage-card">
            <h3>Selecione a etapa</h3>
            <div className="inventario-mobile-stage-list">
              {mobileStageMenu.map((stageEntry) => (
                <button
                  key={stageEntry.view}
                  type="button"
                  className={`inventario-mobile-stage-btn${tab === stageEntry.view ? " active" : ""}`}
                  onClick={() => handleTabChange(stageEntry.view)}
                >
                  <span>{stageEntry.label}</span>
                  <small>{labelByCount(stageEntry.count, "endereço", "endereços")}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {!canShowStageSelector ? (
          <div className="inventario-mobile-nav">
            <button
              type="button"
              className="btn btn-muted inventario-mobile-back-btn"
              onClick={() => {
                closeEditorPopup();
                if (mobileStep === "address") {
                  setSelectedAddress(null);
                  setSelectedItem(null);
                  setShowZonePicker(false);
                  setZoneSearchInput("");
                  setSearch("");
                  setMobileStep("zone");
                  return;
                }
                setShowZonePicker(false);
                setZoneSearchInput("");
                setZone(null);
                setSearch("");
                setMobileStep("stage");
              }}
            >
              Voltar
            </button>
            {mobileStep === "zone" ? (
              <p className="inventario-editor-text">{`Etapa atual: ${stageLabel(tab)}`}</p>
            ) : (
              <div className="inventario-zone-current-row">
                <p className="inventario-editor-text">{`Zona atual: ${zone ?? "-"}`}</p>
                <button
                  type="button"
                  className="btn btn-muted termo-route-btn inventario-change-zone-btn"
                  onClick={() => {
                    setZoneSearchInput("");
                    setShowZonePicker(true);
                  }}
                  disabled={zoneBuckets.length === 0}
                >
                  <span aria-hidden="true">{listIcon()}</span>
                  Alterar Zona
                </button>
              </div>
            )}
          </div>
        ) : null}

        {!canShowStageSelector ? (() => {
          const isPendingView = (tab === "s1" || tab === "s2") && statusFilter === "pendente";
          const pendingCount = stageAddressStats.total - stageAddressStats.completed;
          const pendingPercent = completionPercent(pendingCount, stageAddressStats.total);
          const displayPercent = isPendingView ? pendingPercent : stageAddressStats.percent;
          const displayCount = isPendingView ? pendingCount : stageAddressStats.completed;
          const singularLabel = isPendingView ? "endereço pendente" : "endereço concluído";
          const pluralLabel = isPendingView ? "endereços pendentes" : "endereços concluídos";
          return (
            <div className="inventario-progress-grid" role="status" aria-live="polite">
              <div className="pvps-progress-card">
                <div className="pvps-progress-head">
                  <strong>{`${stageLabel(tab)} • Andamento por Endereços`}</strong>
                  <span>{formatPercent(displayPercent)}</span>
                </div>
                <div className="pvps-progress-track" aria-hidden="true">
                  <span
                    className={`pvps-progress-fill${isPendingView ? " is-pending" : ""}`}
                    style={{ width: `${Math.max(0, Math.min(displayPercent, 100))}%` }}
                  />
                </div>
                <small>
                  {`${displayCount} de ${stageAddressStats.total} ${stageAddressStats.total === 1 ? singularLabel : pluralLabel} nesta etapa.`}
                </small>
              </div>
            </div>
          );
        })() : null}

        {!canShowStageSelector ? (
          <div className="termo-actions-row inventario-subfilters">
            {(tab === "s1" || tab === "s2") ? (
              <>
                <button type="button" className={`btn btn-muted${statusFilter === "pendente" ? " is-active" : ""}`} onClick={() => setStatusFilter("pendente")}>Pendentes</button>
                <button type="button" className={`btn btn-muted${statusFilter === "concluido" ? " is-active" : ""}`} onClick={() => setStatusFilter("concluido")}>Concluídos</button>
              </>
            ) : null}
            {tab === "conciliation" ? (
              <>
                <button type="button" className={`btn btn-muted${reviewFilter === "pendente" ? " is-active" : ""}`} onClick={() => setReviewFilter("pendente")}>Pendentes</button>
                <button type="button" className={`btn btn-muted${reviewFilter === "resolvido" ? " is-active" : ""}`} onClick={() => setReviewFilter("resolvido")}>Resolvidos</button>
              </>
            ) : null}
            {canShowAddressList ? (
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar" />
            ) : null}
          </div>
        ) : null}

        {canShowZoneSelector ? (
          <div className="termo-form inventario-zone-list-mobile">
            <h3>{`Zonas - ${stageLabel(tab)}`}</h3>
            <p className="inventario-editor-text">Use o botão abaixo para escolher entre as zonas disponíveis.</p>
            <button
              type="button"
              className="btn btn-muted termo-route-btn inventario-zone-picker-btn"
              onClick={() => {
                setZoneSearchInput("");
                setShowZonePicker(true);
              }}
              disabled={zoneBuckets.length === 0}
            >
              Escolher zona
            </button>
            {zone ? <p className="inventario-editor-text">{`Zona atual: ${zone}`}</p> : null}
            {zoneBuckets.length === 0 ? (
              <div className="inventario-empty-card"><p>Nenhuma zona para os filtros selecionados.</p></div>
            ) : null}
          </div>
        ) : null}

        {canShowAddressList ? (
          <div className="inventario-layout">
            <div className="termo-form inventario-address-panel">
              <h3 className="inventario-address-title-row">
                <span>{`Endereços - ${stageLabel(tab)}`}</span>
                {zone ? <span className="inventario-address-title-sep">|</span> : null}
                {zone ? <span className="inventario-zone-name-chip">{zone}</span> : null}
                <span className="inventario-zone-total-chip" title={`Total: ${labelByCount(addressBuckets.length, "endereço", "endereços")}`}>
                  {addressBuckets.length}
                </span>
              </h3>

              <div className="inventario-address-list">
                {!editorOpen ? addressBuckets.map((bucket) => {
                  const singleItem = bucket.total_items === 1 ? bucket.items[0] : null;
                  const showConcludedDetails = (
                    ((tab === "s1" || tab === "s2") && statusFilter === "concluido")
                    || (tab === "conciliation" && reviewFilter === "resolvido")
                    || tab === "done"
                  );
                  const blockedForCurrentUser = tab === "s2"
                    && statusFilter === "pendente"
                    && bucket.items.some((row) => isS2BlockedBySameUser(row, profile.user_id));
                  const countedInfo = singleItem ? resolveCountedDisplayInfo(singleItem, tab) : null;
                  const countedByLine = showConcludedDetails ? formatConcludedByLine(countedInfo) : null;
                  const addressMeta = singleItem
                    ? `${singleItem.coddv} - ${singleItem.descricao}`
                    : labelByCount(bucket.total_items, "endereço", "endereços");
                  return (
                    <button
                      type="button"
                      key={bucket.key}
                      className={`inventario-address-card${selectedAddress === bucket.key ? " active" : ""}`}
                      onClick={() => openAddressEditor(bucket)}
                    >
                      <div className="inventario-address-main">
                        <div className="inventario-address-head">
                          <strong>{bucket.endereco}</strong>
                          <span className={`termo-divergencia inventario-address-status ${bucket.pending_items > 0 ? "andamento" : "correto"}`}>
                            {bucket.pending_items > 0
                              ? (bucket.pending_items === 1 ? "pendente" : labelByCount(bucket.pending_items, "pendente", "pendentes"))
                              : (bucket.done_items === 1 ? "concluído" : labelByCount(bucket.done_items, "concluído", "concluídos"))}
                          </span>
                        </div>
                        <p className="inventario-address-meta">{addressMeta}</p>
                        {showConcludedDetails && countedInfo?.qtd != null ? (
                          <p className="inventario-address-extra">{`Estoque: ${singleItem?.estoque ?? "-"} Conferido: ${countedInfo.qtd}`}</p>
                        ) : null}
                        {showConcludedDetails ? (
                          <p className="inventario-address-user">{countedByLine}</p>
                        ) : null}
                        {blockedForCurrentUser ? (
                          <p className="inventario-address-blocked-note">Verificação não disponível para você.</p>
                        ) : null}
                      </div>
                    </button>
                  );
                }) : null}
                {!editorOpen && addressBuckets.length === 0 ? (
                  <div className="inventario-empty-card"><p>Nenhum endereço para os filtros selecionados.</p></div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {showZonePicker && typeof document !== "undefined"
          ? createPortal(
            <div
              className="iz-picker-overlay"
              style={zonePickerKeyboardInset > 0 ? { paddingBottom: `${zonePickerKeyboardInset}px` } : undefined}
              role="dialog"
              aria-modal="true"
              aria-labelledby="inventario-zonas-title"
              onClick={() => {
                setShowZonePicker(false);
                setZoneSearchInput("");
              }}
            >
              <div
                className="iz-picker-sheet"
                style={zonePickerViewportHeight != null
                  ? { maxHeight: `${Math.max(280, Math.floor(zonePickerViewportHeight * 0.88))}px` }
                  : undefined}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="iz-picker-header">
                  <div>
                    <h3 id="inventario-zonas-title" className="iz-picker-title">{stageLabel(tab)}</h3>
                    <p className="iz-picker-sub">Selecione uma zona para trabalhar</p>
                  </div>
                  <button
                    type="button"
                    className="iz-picker-close-btn"
                    onClick={() => {
                      setShowZonePicker(false);
                      setZoneSearchInput("");
                    }}
                    aria-label="Fechar"
                  >
                    {closeIcon()}
                  </button>
                </div>
                <div className="iz-picker-search-wrap">
                  <span className="iz-picker-search-icon" aria-hidden="true">{searchIcon()}</span>
                  <input
                    ref={zoneSearchInputRef}
                    type="text"
                    className="iz-picker-search-input"
                    value={zoneSearchInput}
                    onChange={(event) => setZoneSearchInput(event.target.value)}
                    placeholder="Buscar zona..."
                    inputMode="search"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="search"
                  />
                  <button
                    type="button"
                    className="iz-picker-search-clear"
                    onClick={() => setZoneSearchInput("")}
                    aria-label="Limpar busca de zonas"
                    disabled={zoneSearchInput.trim() === ""}
                    title="Limpar busca"
                  >
                    {closeIcon()}
                  </button>
                </div>
                {zone ? (
                  <div className="iz-picker-filter-row">
                    <span className="iz-picker-filter-chip">{`Zona atual: ${zone}`}</span>
                    <button
                      type="button"
                      className="iz-picker-filter-clear-btn"
                      onClick={clearZoneFilter}
                    >
                      Remover filtro
                    </button>
                  </div>
                ) : null}
                {filteredZoneBuckets.length === 0 ? (
                  <p className="iz-picker-empty">Nenhuma zona encontrada.</p>
                ) : (
                  <div className="iz-picker-grid">
                    {filteredZoneBuckets.map((zoneBucket) => {
                      const isActive = zone === zoneBucket.zona;
                      const donePercent = zoneBucket.total_addresses > 0
                        ? Math.round((zoneBucket.done_addresses / zoneBucket.total_addresses) * 100)
                        : 0;
                      return (
                        <button
                          key={zoneBucket.zona}
                          type="button"
                          className={`iz-zone-card${isActive ? " is-active" : ""}`}
                          onClick={() => handleZoneSelect(zoneBucket.zona)}
                        >
                          <div className="iz-zone-card-top">
                            <span className="iz-zone-name">{zoneBucket.zona}</span>
                            {isActive ? (
                              <span className="iz-zone-check" aria-hidden="true">✓</span>
                            ) : (
                              <span className="iz-zone-total">{zoneBucket.total_addresses}</span>
                            )}
                          </div>
                          <div className="iz-zone-bar-track" aria-hidden="true">
                            <span className="iz-zone-bar-fill" style={{ width: `${donePercent}%` }} />
                          </div>
                          <div className="iz-zone-counts">
                            <span className="iz-zone-count pending">{zoneBucket.pending_addresses} pend.</span>
                            <span className="iz-zone-count done">{zoneBucket.done_addresses} ok</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>,
            document.body
          )
          : null}

        {editorOpen && active && typeof document !== "undefined"
          ? createPortal(
            <div
              className={`inventario-popup-overlay${tab === "conciliation" ? " inventario-popup-overlay-editor" : ""}`}
              style={editorKeyboardInset > 0 ? { paddingBottom: `${editorKeyboardInset}px` } : undefined}
              role="dialog"
              aria-modal="true"
              onClick={closeEditorPopup}
            >
              <div
                key={`iz-editor:${tab}:${active.key}`}
                className={`inventario-popup-card${tab === "conciliation" ? " inventario-editor-popup-card" : ""}${editorPopupMotion === "next" ? " inventario-popup-card-next" : ""}`}
                style={editorViewportHeight != null
                  ? (tab === "conciliation"
                    ? { height: `${Math.max(280, editorViewportHeight)}px`, maxHeight: `${Math.max(280, editorViewportHeight)}px` }
                    : { maxHeight: `${Math.max(320, Math.floor(editorViewportHeight * 0.92))}px` })
                  : undefined}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="inventario-popup-head">
                  <div>
                    <h3>{active.endereco}</h3>
                    <p>{`${stageLabel(tab)} | Código e Dígito (CODDV) ${active.coddv}`}</p>
                    <p className="inventario-popup-head-product">{active.descricao}</p>
                  </div>
                  <div className="inventario-popup-head-actions">
                    {canEditConcludedCount ? (
                      <button
                        type="button"
                        className="inventario-popup-edit"
                        onClick={activateCountEditMode}
                        aria-label="Editar contagem"
                        title="Editar contagem"
                      >
                        {editIcon()}
                        <span>Editar</span>
                      </button>
                    ) : null}
                    <button type="button" className="inventario-popup-close" onClick={closeEditorPopup} aria-label="Fechar popup">Fechar</button>
                  </div>
                </div>
                <div ref={popupBodyRef} className="inventario-popup-body">
                  {popupErr ? <p className="inventario-popup-note error">{popupErr}</p> : null}
                  {(tab === "s1" || tab === "s2") ? (
                    <>
                      {showCountReadOnlyDetails ? (
                        <div className="inventario-count-readonly">
                          <p>{`Quantidade informada: ${activeStageCount?.qtd_contada ?? "-"}`}</p>
                          <p>{`Barras: ${activeStageCount?.barras ?? "-"}`}</p>
                          <p>{`Usuário: ${activeStageCount?.counted_nome ?? "-"} (${activeStageCount?.counted_mat ?? "-"})`}</p>
                        </div>
                      ) : (
                        <>
                          <label>
                            Quantidade
                            <input
                              ref={qtdInputRef}
                              value={qtd}
                              onChange={(e) => {
                                setQtd(e.target.value);
                                setValidatedBarras(null);
                              }}
                              onFocus={focusAndSelectNumericInput}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              enterKeyHint="next"
                              disabled={!canEditCount(active) || busy}
                            />
                          </label>
                          {requiresBarras ? (
                            <p className={`inventario-popup-note ${barrasValidatedForCurrentInput ? "ok" : "warn"}`}>
                              {barrasValidatedForCurrentInput
                                ? "Código de barras validado. Toque em Salvar para concluir."
                                : "Quantidade maior que zero exige barras válido do mesmo Código e Dígito (CODDV) antes de salvar, ou descarte."}
                            </p>
                          ) : null}
                          {requiresBarras ? (
                            <label>
                              Barras (obrigatório)
                              <div className="input-icon-wrap with-action inventario-popup-input-action-wrap">
                                <span className={barrasIconClassName} aria-hidden="true">
                                  {barcodeIcon()}
                                </span>
                                <input
                                  ref={stageBarrasInputRef}
                                  inputMode={barcodeInputMode}
                                  value={barras}
                                  onChange={(e) => handleScannerInputChange("barras", e.target.value)}
                                  onKeyDown={onStageBarrasKeyDown}
                                  onPointerDown={enableBarcodeSoftKeyboard}
                                  onBlur={disableBarcodeSoftKeyboard}
                                  onFocus={keepFocusedControlVisible}
                                  pattern="[0-9]*"
                                  autoCapitalize="off"
                                  autoCorrect="off"
                                  autoComplete="off"
                                  spellCheck={false}
                                  enterKeyHint="done"
                                  disabled={!canEditCount(active) || busy}
                                />
                                <button
                                  type="button"
                                  className="input-action-btn inventario-popup-scan-btn"
                                  onClick={() => openCameraScanner("barras")}
                                  title="Ler código pela câmera"
                                  aria-label="Ler código pela câmera"
                                  disabled={!canEditCount(active) || busy || !cameraSupported}
                                >
                                  {cameraIcon()}
                                </button>
                              </div>
                            </label>
                          ) : null}
                          <div className="inventario-editor-actions">
                            <button className="btn btn-muted" type="button" disabled={!canEditCount(active) || busy} onClick={() => void saveCount(true)}>Descartar</button>
                            <button className="btn btn-primary" type="button" disabled={!canEditCount(active) || busy} onClick={() => void saveCount(false)}>{saveCountLabel}</button>
                          </div>
                        </>
                      )}
                    </>
                  ) : null}
                  {tab === "conciliation" ? (
                    <>
                      <p className="inventario-editor-text">{`Endereço: ${active.endereco} | Código e Dígito (CODDV): ${active.coddv}`}</p>
                      {(() => {
                        const c1Fallback = extractReviewSnapshotCount(active.review, 1);
                        const c2Fallback = extractReviewSnapshotCount(active.review, 2);

                        const c1Qtd = active.c1?.qtd_contada ?? c1Fallback?.qtd ?? "-";
                        const c1Barras = active.c1?.barras ?? c1Fallback?.barras ?? "-";
                        const c1Nome = pickText(
                          active.c1?.counted_nome,
                          c1Fallback?.nome,
                          active.c1?.counted_mat ? `Mat ${active.c1.counted_mat}` : null,
                          c1Fallback?.mat ? `Mat ${c1Fallback.mat}` : null
                        ) ?? "-";

                        const c2Qtd = active.c2?.qtd_contada ?? c2Fallback?.qtd ?? "-";
                        const c2Barras = active.c2?.barras ?? c2Fallback?.barras ?? "-";
                        const c2Nome = pickText(
                          active.c2?.counted_nome,
                          c2Fallback?.nome,
                          active.c2?.counted_mat ? `Mat ${active.c2.counted_mat}` : null,
                          c2Fallback?.mat ? `Mat ${c2Fallback.mat}` : null
                        ) ?? "-";

                        return (
                          <>
                            {active.review?.reason_code === "conflito_lock" && active.c2 == null ? (
                              <p className="inventario-popup-note warn">
                                2ª verificação não registrada por conflito com outro usuário. Resolva pela conciliação.
                              </p>
                            ) : null}
                            <div className="inventario-conciliation-grid">
                              <article className="inventario-conciliation-card">
                                <h4>1ª Verificação</h4>
                                <p>{`Qtd: ${c1Qtd}`}</p>
                                <p>{`Barras: ${c1Barras}`}</p>
                                <p>{`Usuário: ${c1Nome}`}</p>
                              </article>
                              <article className="inventario-conciliation-card">
                                <h4>2ª Verificação</h4>
                                <p>{`Qtd: ${c2Qtd}`}</p>
                                <p>{`Barras: ${c2Barras}`}</p>
                                <p>{`Usuário: ${c2Nome}`}</p>
                              </article>
                            </div>
                          </>
                        );
                      })()}
                      <label>
                        Qtd final
                        <input
                          ref={finalQtdInputRef}
                          value={finalQtd}
                          onChange={(e) => setFinalQtd(e.target.value)}
                          onFocus={focusAndSelectNumericInput}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          enterKeyHint="next"
                          disabled={!canResolveConciliation || busy}
                        />
                      </label>
                      {requiresFinalBarras ? (
                        <p className="inventario-popup-note warn">Quantidade final maior que zero exige barras válido do mesmo Código e Dígito (CODDV).</p>
                      ) : null}
                      {requiresFinalBarras ? (
                        <label>
                          Barras final (obrigatório quando quantidade maior que zero)
                          <div className="input-icon-wrap with-action inventario-popup-input-action-wrap">
                            <span className={finalBarrasIconClassName} aria-hidden="true">
                              {barcodeIcon()}
                            </span>
                            <input
                              ref={finalBarrasInputRef}
                              inputMode={barcodeInputMode}
                              value={finalBarras}
                              onChange={(e) => handleScannerInputChange("final_barras", e.target.value)}
                              onKeyDown={onFinalBarrasKeyDown}
                              onPointerDown={enableBarcodeSoftKeyboard}
                              onBlur={disableBarcodeSoftKeyboard}
                              onFocus={keepFocusedControlVisible}
                              pattern="[0-9]*"
                              autoCapitalize="off"
                              autoCorrect="off"
                              autoComplete="off"
                              spellCheck={false}
                              enterKeyHint="done"
                              disabled={!canResolveConciliation || busy}
                            />
                            <button
                              type="button"
                              className="input-action-btn inventario-popup-scan-btn"
                              onClick={() => openCameraScanner("final_barras")}
                              title="Ler código pela câmera"
                              aria-label="Ler código pela câmera"
                              disabled={!canResolveConciliation || busy || !cameraSupported}
                            >
                              {cameraIcon()}
                            </button>
                          </div>
                        </label>
                      ) : null}
                      <div className="inventario-editor-actions">
                        <button className="btn btn-muted" type="button" onClick={closeEditorPopup}>Fechar</button>
                        <button className="btn btn-primary" type="button" disabled={!canResolveConciliation || busy} onClick={() => void resolveReview()}>Resolver conciliação</button>
                      </div>
                    </>
                  ) : null}
                  {tab === "done" ? <p className="inventario-editor-text">Endereço concluído e não pode ser alterado.</p> : null}
                </div>
              </div>
            </div>,
            document.body
          )
          : null}

        {canManageBase && adminEntryOpen && typeof document !== "undefined" ? createPortal(
          <div className="inventario-popup-overlay" role="dialog" aria-modal="true" onClick={closeAllAdminPopups}>
            <div className="inventario-popup-card inventario-admin-entry-popup" onClick={(event) => event.stopPropagation()}>
              <div className="inventario-popup-head">
                <div>
                  <h3>Escolha o tipo de gestão</h3>
                  <p>Selecione como deseja montar a base para auditoria.</p>
                </div>
                <button type="button" className="inventario-popup-close" onClick={closeAllAdminPopups} aria-label="Fechar popup">Fechar</button>
              </div>
              <div className="inventario-popup-body">
                <div className="inventario-admin-entry-grid">
                  <button type="button" className="inventario-admin-entry-card" onClick={() => openAdminMode("zona")}>
                    <strong>Fluxo por Zona</strong>
                    <span>Escolha zonas de Separação (SEP), faixa de estoque e aplique por zona.</span>
                  </button>
                  <button type="button" className="inventario-admin-entry-card" onClick={() => openAdminMode("coddv")}>
                    <strong>Fluxo por Código e Dígito</strong>
                    <span>Informe Código e Dígito (CODDV) manual para inclusão direta na auditoria.</span>
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

        {canManageBase && adminOpen && adminManageMode != null && typeof document !== "undefined" ? createPortal(
          <div className="inventario-popup-overlay" role="dialog" aria-modal="true" onClick={closeAllAdminPopups}>
            <div className="inventario-popup-card inventario-admin-popup" onClick={(event) => event.stopPropagation()}>
              <div className="inventario-popup-head">
                <div>
                  <h3>{isAdminZonaFlow ? "Gestão da Base - Fluxo por Zona" : "Gestão da Base - Fluxo por Código e Dígito"}</h3>
                  <p>{isAdminZonaFlow
                    ? "Configure zonas e faixa de estoque para montar a base por zona."
                    : "Use Código e Dígito (CODDV) manual para montar a base por produto."}
                  </p>
                </div>
                <button type="button" className="inventario-popup-close" onClick={closeAllAdminPopups} aria-label="Fechar popup">Fechar</button>
              </div>
              <div className="inventario-popup-body">
                {cd == null ? (
                  <p className="inventario-popup-note warn">Selecione um CD para gerenciar a base.</p>
                ) : null}
                {adminSuccessMsg ? (
                  <p className="inventario-popup-note ok">{adminSuccessMsg}</p>
                ) : null}
                {isAdminZonaFlow ? (
                  <>
                    <div className="inventario-admin-section">
                      <h4>Selecao por zona e faixa de estoque</h4>
                      <div className="inventario-admin-grid inventario-admin-grid-stock">
                        <label>
                          Est. Inicial
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={adminEstoqueIni}
                            onChange={(event) => setAdminEstoqueIni(event.target.value)}
                            disabled={adminBusy || cd == null}
                          />
                        </label>
                        <label>
                          Est. Final
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={adminEstoqueFim}
                            onChange={(event) => setAdminEstoqueFim(event.target.value)}
                            disabled={adminBusy || cd == null}
                          />
                        </label>
                        <label className="inventario-admin-field inventario-admin-field-stock-type">
                          Tipo estoque *
                          <select
                            value={adminStockType}
                            onChange={(event) => setAdminStockType(event.target.value as InventarioAdminStockTypeValue)}
                            disabled={adminBusy || cd == null}
                            required
                          >
                            <option value="">Selecione</option>
                            <option value="disponivel">Disponível</option>
                            <option value="atual">Atual</option>
                          </select>
                        </label>
                      </div>
                      <div className="inventario-admin-recent-control">
                        <label className="inventario-admin-recent-title" htmlFor="inventario-admin-recent-days-zona">
                          Ignorar endere&ccedil;os auditados dos &uacute;ltimos:
                        </label>
                        <div className="inventario-admin-recent-inline">
                          <input
                            id="inventario-admin-recent-days-zona"
                            className="inventario-admin-recent-input"
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={adminIgnoreRecentAuditedDays}
                            onChange={(event) => setAdminIgnoreRecentAuditedDays(event.target.value)}
                            disabled={adminBusy || cd == null}
                            placeholder="0"
                            aria-label="Quantidade de dias para ignorar enderecos auditados"
                          />
                          <span className="inventario-admin-recent-unit">dias</span>
                        </div>
                        <p className="inventario-admin-zone-meta inventario-admin-zone-meta-compact">0 = nao filtrar.</p>
                      </div>
                      <label className="inventario-admin-check">
                        <input
                          type="checkbox"
                          checked={adminIncluirPul}
                          onChange={(event) => setAdminIncluirPul(event.target.checked)}
                          disabled={adminBusy || cd == null}
                        />
                        Incluir endereços de Pulmão dos produtos selecionados na zona
                      </label>
                    </div>

                    <div className="inventario-admin-zone-head">
                      <strong>{`Zonas disponível: ${adminZones.length}`}</strong>
                      <div className="inventario-admin-zone-actions">
                        <button
                          type="button"
                          className="btn btn-muted"
                          onClick={openAdminZonePicker}
                          disabled={adminBusy || adminZonesLoading || cd == null || adminZones.length === 0}
                        >
                          Escolher zonas
                        </button>
                        <button
                          type="button"
                          className="btn btn-muted"
                          onClick={() => setAdminSelectedZones([])}
                          disabled={adminBusy || cd == null || adminZones.length === 0}
                        >
                          Limpar seleção
                        </button>
                      </div>
                    </div>
                    <p className="inventario-admin-zone-meta">
                      {adminSelectedZones.length === 0
                        ? "Nenhuma zona selecionada. Abra \"Escolher zonas\" para marcar."
                        : formatCountLabel(adminSelectedZones.length, "zona selecionada", "zonas selecionadas")}
                    </p>

                    <div className="inventario-admin-actions">
                      <button
                        className="btn btn-muted"
                        type="button"
                        disabled={adminBusy || cd == null || !adminStockTypeValid}
                        onClick={() => void runAdminPreview("zona")}
                      >
                        {adminBusy ? "Processando..." : "Prévia  de enderços a auditar"}
                      </button>
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={adminBusy || cd == null || !adminStockTypeValid || adminPreviewRows.length === 0 || adminPreviewScope !== "zona"}
                        onClick={() => void runAdminApplyZona("replace_cd")}
                      >
                        Adicionar (substituir base do CD)
                      </button>
                      <button
                        className="btn btn-muted"
                        type="button"
                        disabled={adminBusy || cd == null || !adminStockTypeValid || adminPreviewRows.length === 0 || adminPreviewScope !== "zona"}
                        onClick={() => void runAdminApplyZona("replace_zones")}
                      >
                        Recarregar zonas selecionadas
                      </button>
                    </div>
                  </>
                ) : null}

                {isAdminCoddvFlow ? (
                  <div className="inventario-admin-section inventario-admin-manual">
                    <h4>Inserção manual por Código e Dígito (CODDV)</h4>
                    <p className="inventario-editor-text">
                      Informe um ou vários Códigos e Dígitos (CODDV) para serem incluídos na base de endereços a auditar.
                    </p>
                    <label>
                      Tipo de estoque *
                      <select
                        value={adminStockType}
                        onChange={(event) => setAdminStockType(event.target.value as InventarioAdminStockTypeValue)}
                        disabled={adminBusy || cd == null}
                        required
                      >
                        <option value="">Selecione</option>
                        <option value="disponivel">Disponível</option>
                        <option value="atual">Atual</option>
                      </select>
                    </label>
                    <div className="inventario-admin-recent-control">
                      <label className="inventario-admin-recent-title" htmlFor="inventario-admin-recent-days-coddv">
                        Ignorar endere&ccedil;os auditados dos &uacute;ltimos:
                      </label>
                      <div className="inventario-admin-recent-inline">
                        <input
                          id="inventario-admin-recent-days-coddv"
                          className="inventario-admin-recent-input"
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={adminIgnoreRecentAuditedDays}
                          onChange={(event) => setAdminIgnoreRecentAuditedDays(event.target.value)}
                          disabled={adminBusy || cd == null}
                          placeholder="0"
                          aria-label="Quantidade de dias para ignorar enderecos auditados"
                        />
                        <span className="inventario-admin-recent-unit">dias</span>
                      </div>
                      <p className="inventario-admin-zone-meta inventario-admin-zone-meta-compact">0 = nao filtrar.</p>
                    </div>
                    <label className="inventario-admin-check">
                      <input
                        type="checkbox"
                        checked={adminIncluirPul}
                        onChange={(event) => setAdminIncluirPul(event.target.checked)}
                        disabled={adminBusy || cd == null}
                      />
                      Incluir endereços de Pulmão dos produtos (CODDV) informados
                    </label>
                    <label>
                      Código e Dígito (CODDV) manual (separado por vírgula)
                      <textarea
                        value={adminManualCoddvCsv}
                        onChange={(event) => setAdminManualCoddvCsv(event.target.value)}
                        placeholder="Ex.: 12345, 67890, 10001"
                        rows={4}
                        disabled={adminBusy || cd == null}
                      />
                    </label>
                    <div className="inventario-admin-actions">
                      <button
                        className="btn btn-muted"
                        type="button"
                        disabled={adminBusy || cd == null || !adminStockTypeValid}
                        onClick={() => void runAdminPreview("coddv")}
                      >
                        {adminBusy ? "Processando..." : "Gerar prévia"}
                      </button>
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={adminBusy || cd == null || !adminStockTypeValid || adminPreviewRows.length === 0 || adminPreviewScope !== "coddv"}
                        onClick={() => void runAdminApplyCoddv()}
                      >
                        Adicionar a base
                      </button>
                    </div>
                  </div>
                ) : null}

                {adminPreviewRows.length > 0 && (
                  (isAdminZonaFlow && adminPreviewScope === "zona")
                  || (isAdminCoddvFlow && adminPreviewScope === "coddv")
                ) ? (
                  <div className="inventario-admin-preview">
                    <h4>{adminPreviewScope === "coddv" ? "Prévia da inserção por Código e Dígito (CODDV)" : "Prévia da inserção por zona"}</h4>
                    <p className="inventario-editor-text">{`Total geral: ${adminPreviewTotal} itens`}</p>
                    {adminPreviewScope === "zona" ? (
                      <p className="inventario-admin-zone-meta">
                        A prévia considera os filtros aplicados: faixa de estoque, tipo de estoque, auditoria recente e Pulmão.
                      </p>
                    ) : null}
                    <div className="inventario-admin-preview-list">
                      {adminPreviewRows.map((row) => (
                        <p key={row.zona}>{`${row.zona}: ${row.itens} itens`}</p>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="inventario-admin-clear">
                  <h4>Limpar dados antigos</h4>
                  <label className="inventario-admin-check">
                    <input
                      type="checkbox"
                      checked={adminClearHardReset}
                      onChange={(event) => setAdminClearHardReset(event.target.checked)}
                      disabled={adminBusy || cd == null}
                    />
                    Hard reset (apaga também itens iniciados)
                  </label>
                  <div className="inventario-admin-actions">
                    <button
                      className="btn btn-muted termo-danger-btn"
                      type="button"
                      disabled={adminBusy || cd == null}
                      onClick={() => void runAdminClearAll()}
                    >
                      Limpar base do CD
                    </button>
                  </div>
                </div>

                {adminSummary ? (
                  <div className="inventario-popup-note ok">
                    <p>{`Itens afetados: ${adminSummary.itens_afetados} | Zonas atuais: ${adminSummary.zonas_afetadas} | Total atual: ${adminSummary.total_geral}`}</p>
                    {adminSummaryActorLabel ? <p>{`Atualizado por: ${adminSummaryActorLabel}`}</p> : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>,
          document.body
        ) : null}

        {canManageBase && adminOpen && isAdminZonaFlow && adminZonePickerOpen && typeof document !== "undefined" ? createPortal(
          <div className="inventario-popup-overlay inventario-popup-overlay-subdialog" role="dialog" aria-modal="true" onClick={() => setAdminZonePickerOpen(false)}>
            <div className="inventario-popup-card inventario-admin-zone-popup" onClick={(event) => event.stopPropagation()}>
              <div className="inventario-popup-head">
                <div>
                  <h3>Selecionar zonas de Separação (SEP)</h3>
                  <p>Marque as zonas para a inserção por zona e salve para voltar.</p>
                </div>
                <button type="button" className="inventario-popup-close" onClick={() => setAdminZonePickerOpen(false)} aria-label="Fechar popup">Fechar</button>
              </div>
              <div className="inventario-popup-body">
                <div className="inventario-admin-zone-actions">
                  <button
                    type="button"
                    className="btn btn-muted"
                    onClick={() => setAdminZoneDraft(adminZones.map((row) => row.zona))}
                    disabled={adminBusy || adminZonesLoading || cd == null || adminZones.length === 0}
                  >
                    Selecionar todas
                  </button>
                  <button
                    type="button"
                    className="btn btn-muted"
                    onClick={() => setAdminZoneDraft([])}
                    disabled={adminBusy || cd == null || adminZones.length === 0}
                  >
                    Limpar marcações
                  </button>
                </div>

                <input
                  type="text"
                  className="inventario-admin-zone-search"
                  value={adminZoneSearch}
                  onChange={(event) => setAdminZoneSearch(event.target.value)}
                  placeholder="Buscar zona (ex.: A101)"
                  disabled={adminBusy || adminZonesLoading || cd == null || adminZones.length === 0}
                />
                <p className="inventario-admin-zone-meta">
                  {formatCountLabel(adminZoneDraft.length, "zona marcada", "zonas marcadas")}
                </p>
                <p className="inventario-admin-zone-meta">
                  Os totais abaixo mostram o volume bruto de endereços SEP por zona, antes dos filtros da prévia.
                </p>

                <div className="inventario-admin-zone-list">
                  {adminZonesLoading ? (
                    <p className="inventario-popup-note">Carregando zonas...</p>
                  ) : adminZones.length === 0 ? (
                    <p className="inventario-popup-note warn">Nenhuma zona de Separação (SEP) encontrada para este CD.</p>
                  ) : filteredAdminZones.length === 0 ? (
                    <p className="inventario-popup-note warn">Nenhuma zona encontrada para o filtro informado.</p>
                  ) : filteredAdminZones.map((row) => {
                    const checked = adminZoneDraft.includes(row.zona);
                    return (
                      <label key={row.zona} className="inventario-admin-zone-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const isChecked = event.target.checked;
                            setAdminZoneDraft((current) => {
                              if (isChecked) {
                                if (current.includes(row.zona)) return current;
                                return [...current, row.zona].sort((a, b) => a.localeCompare(b));
                              }
                              return current.filter((zonaItem) => zonaItem !== row.zona);
                            });
                          }}
                          disabled={adminBusy || cd == null}
                        />
                        <span className="inventario-admin-zone-main">
                          <span>{row.zona}</span>
                          <small>{`${row.itens} endereços SEP totais`}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="inventario-admin-actions">
                  <button className="btn btn-muted" type="button" onClick={() => setAdminZonePickerOpen(false)}>
                    Cancelar
                  </button>
                  <button className="btn btn-primary" type="button" onClick={saveAdminZonePicker}>
                    Salvar seleção
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

        {adminConfirm && typeof document !== "undefined" ? createPortal(
          <div className="inventario-popup-overlay" role="dialog" aria-modal="true" onClick={closeAllAdminPopups}>
            <div className="inventario-popup-card inventario-admin-confirm-popup" onClick={(event) => event.stopPropagation()}>
              <div className="inventario-popup-head">
                <div>
                  <h3>{adminConfirm.title}</h3>
                  <p>Revise os dados antes de continuar.</p>
                </div>
                <button type="button" className="inventario-popup-close" onClick={closeAllAdminPopups} aria-label="Fechar popup">Fechar</button>
              </div>
              <div className="inventario-popup-body">
                <div className="inventario-admin-confirm-lines">
                  {adminConfirm.lines.map((line, index) => (
                    <p key={`${index}-${line}`}>{line}</p>
                  ))}
                </div>
                <div className="inventario-admin-actions">
                  <button className="btn btn-muted" type="button" onClick={() => setAdminConfirm(null)} disabled={adminBusy}>
                    Cancelar
                  </button>
                  <button
                    className={`btn ${adminConfirm.danger ? "btn-muted termo-danger-btn" : "btn-primary"}`}
                    type="button"
                    onClick={() => void confirmAdminAction()}
                    disabled={adminBusy}
                  >
                    {adminBusy ? "Processando..." : adminConfirm.confirm_label}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

        {canExport && isDesktop && reportOpen ? (
          <div className="inventario-popup-overlay" role="dialog" aria-modal="true" onClick={() => setReportOpen(false)}>
            <div className="inventario-popup-card inventario-report-popup" onClick={(event) => event.stopPropagation()}>
              <div className="inventario-popup-head">
                <div>
                  <h3>Relatório XLSX (Admin)</h3>
                  <p>Defina o período e exporte.</p>
                </div>
                <button type="button" className="inventario-popup-close" onClick={() => setReportOpen(false)} aria-label="Fechar popup">Fechar</button>
              </div>
              <div className="inventario-popup-body">
                <div className="inventario-report-filters">
                  <label>
                    Data inicial
                    <input
                      ref={reportDtIniInputRef}
                      type="date"
                      value={dtIni}
                      onChange={(e) => setDtIni(e.target.value)}
                      onFocus={keepFocusedControlVisible}
                    />
                  </label>
                  <label>
                    Data final
                    <input
                      type="date"
                      value={dtFim}
                      onChange={(e) => setDtFim(e.target.value)}
                      onFocus={keepFocusedControlVisible}
                    />
                  </label>
                </div>
                <div className="inventario-report-actions">
                  <button className="btn btn-muted" type="button" onClick={() => void countReportRows({ dt_ini: dtIni, dt_fim: dtFim, cd: cd ?? -1 }).then(setReportCount).catch((e) => setErr(parseErr(e)))} disabled={cd == null || reportBusy}>Contar</button>
                  <button className="btn btn-primary" type="button" onClick={() => void exportReport().catch((e) => setErr(parseErr(e)))} disabled={cd == null || reportBusy}>{reportBusy ? "Exportando..." : "Exportar XLSX"}</button>
                </div>
                {reportCount != null ? <p>{labelByCount(reportCount, "registro", "registros")}</p> : null}
                {reportStatus ? <p>{reportStatus}</p> : null}
              </div>
            </div>
          </div>
        ) : null}
        {scannerOpen && typeof document !== "undefined"
          ? createPortal(
            <div className="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="inventario-scanner-title" onClick={closeCameraScanner}>
              <div className="scanner-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <div className="scanner-head">
                  <h3 id="inventario-scanner-title">Scanner de barras</h3>
                  <div className="scanner-head-actions">
                    {!isDesktop ? (
                      <button
                        type="button"
                        className={`scanner-flash-btn${torchEnabled ? " is-on" : ""}`}
                        onClick={() => void toggleTorch()}
                        aria-label={torchEnabled ? "Desligar flash" : "Ligar flash"}
                        title={torchSupported ? (torchEnabled ? "Desligar flash" : "Ligar flash") : "Flash indisponível"}
                        disabled={!torchSupported}
                      >
                        {flashIcon({ on: torchEnabled })}
                        <span>{torchEnabled ? "Flash on" : "Flash"}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="scanner-close-btn"
                      onClick={closeCameraScanner}
                      aria-label="Fechar scanner"
                      title="Fechar scanner"
                    >
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
                <p className="scanner-hint">Aponte a câmera para o código de barras para leitura automática.</p>
                {scannerError ? <div className="alert error">{scannerError}</div> : null}
              </div>
            </div>,
            document.body
          )
          : null}
      </section>

      <PendingSyncDialog
        isOpen={showPendingSyncModal}
        title="Pendências de sincronização"
        items={pendingSyncRows.map((row) => ({
          id: row.event_id,
          title: `Evento ${row.event_type}`,
          subtitle: `Status ${row.status} | Tentativas ${row.attempt_count}`,
          detail: `Ciclo ${row.cycle_date}`,
          error: row.error_message,
          updatedAt: formatDateTimeBrasilia(row.updated_at, { includeSeconds: true, emptyFallback: "-", invalidFallback: "-" }),
          onDiscard: () => void discardPendingSyncRow(row.event_id)
        }))}
        emptyText="Nenhuma pendência encontrada."
        busy={busyPendingDiscard}
        onClose={() => setShowPendingSyncModal(false)}
        onDiscardAll={pendingSyncRows.length > 0 ? () => void discardAllPendingSyncRows() : undefined}
      />
    </>
  );
}
