import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { PendingSyncBadge } from "../../ui/pending-sync-badge";
import { PendingSyncDialog } from "../../ui/pending-sync-dialog";
import { formatDateOnlyPtBR, formatDateTimeBrasilia } from "../../shared/brasilia-datetime";
import { getModuleByKeyOrThrow } from "../registry";
import {
  CLV_ETAPA_LABELS,
  CLV_FRACIONADO_TIPO_LABELS,
  CLV_INVALID_KNAPP_MESSAGE,
  CLV_MAX_LENGTH,
  CLV_STAGE_ETAPAS,
  canAccessClv,
  clampEtiquetaInput,
  etapaCountKey,
  etapaPendingKey,
  normalizeFracionadoTipo,
  normalizeSearchText,
  parseClvEtiqueta,
  requiresKnappId,
  toDisplayName
} from "./logic";
import {
  countClvPendingOperations,
  getClvPreferences,
  listClvPendingOperations,
  removeClvPendingOperation,
  saveClvPendingOperation,
  saveClvPreferences
} from "./storage";
import {
  fetchCdOptions,
  fetchClvPedidoManifest,
  fetchClvTodayFeed,
  scanClvRecebimento,
  scanClvStage,
  syncPendingClvOperations,
  toClvErrorMessage
} from "./sync";
import type {
  CdOption,
  ClvEtapa,
  ClvFeedRow,
  ClvFracionadoTipo,
  ClvMovimento,
  ClvPendingOperation,
  ClvStageEtapa,
  ControleLogisticoVolumeModuleProfile
} from "./types";
import type { ModuleIconName, ModuleTone } from "../types";

interface ControleLogisticoVolumePageProps {
  isOnline: boolean;
  profile: ControleLogisticoVolumeModuleProfile;
}

const MODULE_DEF = getModuleByKeyOrThrow("controle-logistico-volume");
const SYNC_INTERVAL_MS = 45_000;

const CLV_STAGE_META: Record<ClvEtapa, { title: string; description: string; icon: ModuleIconName; tone: ModuleTone; tag: string }> = {
  recebimento_cd: {
    title: "Recebimento CD",
    description: "Bipe o primeiro volume da loja e informe o total.",
    icon: "volume",
    tone: "green",
    tag: "Início da loja"
  },
  entrada_galpao: {
    title: "Entrada no galpão",
    description: "Confirme volumes recebidos para entrada operacional.",
    icon: "barcode",
    tone: "teal",
    tag: "Conferência interna"
  },
  saida_galpao: {
    title: "Saída do galpão",
    description: "Registre volumes liberados para rota.",
    icon: "truck",
    tone: "amber",
    tag: "Expedição"
  },
  entrega_filial: {
    title: "Entrega na filial",
    description: "Confirme a entrega dos volumes na filial.",
    icon: "location",
    tone: "blue",
    tag: "Finalização"
  }
};

const CLV_STAGE_ORDER = Object.keys(CLV_STAGE_META) as ClvEtapa[];

function safeUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDateTime(value: string | null | undefined): string {
  return formatDateTimeBrasilia(value ?? "", {
    includeSeconds: true,
    emptyFallback: "-",
    invalidFallback: "-"
  });
}

function cdCodeLabel(cd: number | null): string {
  return cd == null ? "CD não definido" : `CD ${String(cd).padStart(2, "0")}`;
}

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: ControleLogisticoVolumeModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) {
    return Math.trunc(profile.cd_default);
  }
  return parseCdFromLabel(profile.cd_nome);
}

function isGlobalAdmin(profile: ControleLogisticoVolumeModuleProfile): boolean {
  return profile.role === "admin" && profile.cd_default == null;
}

function movementFromPending(operation: ClvPendingOperation): ClvMovimento {
  return {
    mov_id: operation.local_id,
    etapa: operation.kind === "recebimento" ? "recebimento_cd" : operation.payload.etapa,
    etiqueta: operation.parsed.etiqueta,
    id_knapp: operation.parsed.id_knapp,
    volume: operation.parsed.volume,
    volume_key: operation.parsed.volume_key,
    fracionado: operation.kind === "recebimento" ? operation.payload.fracionado : false,
    fracionado_qtd: operation.kind === "recebimento" ? operation.payload.fracionado_qtd : null,
    fracionado_tipo: operation.kind === "recebimento" ? operation.payload.fracionado_tipo : null,
    mat_operador: "",
    nome_operador: "Pendente local",
    data_hr: operation.payload.data_hr,
    is_local: true
  };
}

function emptyLocalRow(operation: ClvPendingOperation): ClvFeedRow {
  const parsed = operation.parsed;
  const total = operation.kind === "recebimento" ? operation.payload.volume_total_informado : 0;
  return {
    lote_id: `local:${operation.local_id}`,
    cd: operation.payload.cd,
    pedido: parsed.pedido,
    data_pedido: parsed.data_pedido,
    dv: parsed.dv,
    filial: parsed.filial,
    filial_nome: null,
    rota: "Sem rota",
    volume_total_informado: total,
    recebido_count: 0,
    entrada_count: 0,
    saida_count: 0,
    entrega_count: 0,
    pendente_recebimento: total,
    pendente_entrada: 0,
    pendente_saida: 0,
    pendente_entrega: 0,
    updated_at: operation.updated_at,
    movimentos: [],
    is_local: true
  };
}

function recomputePending(row: ClvFeedRow): ClvFeedRow {
  return {
    ...row,
    pendente_recebimento: Math.max(row.volume_total_informado - row.recebido_count, 0),
    pendente_entrada: Math.max(row.recebido_count - row.entrada_count, 0),
    pendente_saida: Math.max(row.recebido_count - row.saida_count, 0),
    pendente_entrega: Math.max(row.recebido_count - row.entrega_count, 0)
  };
}

function applyPendingOperations(rows: ClvFeedRow[], operations: ClvPendingOperation[], cd: number | null): ClvFeedRow[] {
  const map = new Map<string, ClvFeedRow>();

  for (const row of rows) {
    map.set(`${row.cd}:${row.pedido}:${row.filial}`, {
      ...row,
      movimentos: [...row.movimentos]
    });
  }

  for (const operation of operations) {
    if (cd != null && operation.payload.cd !== cd) continue;
    const key = `${operation.payload.cd}:${operation.parsed.pedido}:${operation.parsed.filial}`;
    const current = map.get(key) ?? emptyLocalRow(operation);
    const etapa = operation.kind === "recebimento" ? "recebimento_cd" : operation.payload.etapa;
    if (current.movimentos.some((mov) => mov.etapa === etapa && mov.volume_key === operation.parsed.volume_key)) {
      map.set(key, current);
      continue;
    }

    const countKey = etapaCountKey(etapa);
    const next: ClvFeedRow = {
      ...current,
      volume_total_informado: operation.kind === "recebimento"
        ? Math.max(current.volume_total_informado, operation.payload.volume_total_informado)
        : current.volume_total_informado,
      [countKey]: current[countKey] + 1,
      updated_at: operation.updated_at,
      movimentos: [movementFromPending(operation), ...current.movimentos]
    };
    map.set(key, recomputePending(next));
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.filial !== b.filial) return a.filial - b.filial;
    if (a.pedido !== b.pedido) return a.pedido - b.pedido;
    return (a.filial_nome ?? "").localeCompare(b.filial_nome ?? "", "pt-BR");
  });
}

function mergeRow(rows: ClvFeedRow[], nextRow: ClvFeedRow): ClvFeedRow[] {
  const replaced = rows.some((row) => row.lote_id === nextRow.lote_id);
  const next = replaced ? rows.map((row) => (row.lote_id === nextRow.lote_id ? nextRow : row)) : [nextRow, ...rows];
  return next.sort((a, b) => {
    if (a.filial !== b.filial) return a.filial - b.filial;
    if (a.pedido !== b.pedido) return a.pedido - b.pedido;
    return (a.filial_nome ?? "").localeCompare(b.filial_nome ?? "", "pt-BR");
  });
}

function findRowForParsed(rows: ClvFeedRow[], parsed: { pedido: number; filial: number }): ClvFeedRow | null {
  return rows.find((row) => row.pedido === parsed.pedido && row.filial === parsed.filial) ?? null;
}

function rowContainsVolume(row: ClvFeedRow, volumeKey: string, etapa: ClvEtapa): boolean {
  return row.movimentos.some((mov) => mov.etapa === etapa && mov.volume_key === volumeKey);
}

function hasEtapaVolume(rows: ClvFeedRow[], etapa: ClvEtapa, volumeKey: string): boolean {
  return rows.some((row) => rowContainsVolume(row, volumeKey, etapa));
}

function stageReadyMessage(etapa: ClvEtapa, row: ClvFeedRow): string {
  const countKey = etapaCountKey(etapa);
  const pendingKey = etapaPendingKey(etapa);
  return `${row[countKey]}/${row.recebido_count || row.volume_total_informado} volumes | Pendentes ${row[pendingKey]}`;
}

export default function ControleLogisticoVolumePage({ isOnline, profile }: ControleLogisticoVolumePageProps) {
  const allowed = canAccessClv(profile.mat);
  const globalAdmin = isGlobalAdmin(profile);
  const fixedCd = fixedCdFromProfile(profile);
  const etiquetaRef = useRef<HTMLInputElement | null>(null);
  const syncTimerRef = useRef<number | null>(null);

  const [etapa, setEtapa] = useState<ClvEtapa | null>(null);
  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [cdAtivo, setCdAtivo] = useState<number | null>(fixedCd);
  const [preferOfflineMode, setPreferOfflineMode] = useState(false);
  const [feedRows, setFeedRows] = useState<ClvFeedRow[]>([]);
  const [manifestRows, setManifestRows] = useState<ClvFeedRow[]>([]);
  const [pendingOps, setPendingOps] = useState<ClvPendingOperation[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingErrors, setPendingErrors] = useState(0);
  const [showPendingSyncModal, setShowPendingSyncModal] = useState(false);
  const [showStagePicker, setShowStagePicker] = useState(true);
  const [busyPendingDiscard, setBusyPendingDiscard] = useState(false);
  const [busyRefresh, setBusyRefresh] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [busySubmit, setBusySubmit] = useState(false);
  const [receiptArmed, setReceiptArmed] = useState(false);
  const [activeReceiptRow, setActiveReceiptRow] = useState<ClvFeedRow | null>(null);
  const [activeDeliveryRow, setActiveDeliveryRow] = useState<ClvFeedRow | null>(null);
  const [pedidoInput, setPedidoInput] = useState("");
  const [loadedPedido, setLoadedPedido] = useState<number | null>(null);
  const [etiquetaInput, setEtiquetaInput] = useState("");
  const [idKnappInput, setIdKnappInput] = useState("");
  const [volumeTotalInput, setVolumeTotalInput] = useState("");
  const [fracionado, setFracionado] = useState(false);
  const [fracionadoQtd, setFracionadoQtd] = useState("");
  const [fracionadoTipo, setFracionadoTipo] = useState<ClvFracionadoTipo>("pedido_direto");
  const [feedSearch, setFeedSearch] = useState("");
  const [expandedLoteId, setExpandedLoteId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const currentCd = globalAdmin ? cdAtivo : fixedCd;

  const visibleBaseRows = etapa === "recebimento_cd" ? feedRows : manifestRows;
  const visibleRows = useMemo(
    () => applyPendingOperations(visibleBaseRows, pendingOps, currentCd),
    [currentCd, pendingOps, visibleBaseRows]
  );
  const filteredRows = useMemo(() => {
    const query = normalizeSearchText(feedSearch);
    if (!query) return visibleRows;
    return visibleRows.filter((row) => {
      const haystack = normalizeSearchText([
        row.pedido,
        row.filial,
        row.filial_nome ?? "",
        row.rota ?? "",
        row.movimentos.map((mov) => `${mov.etiqueta} ${mov.volume ?? ""}`).join(" ")
      ].join(" "));
      return haystack.includes(query);
    });
  }, [feedSearch, visibleRows]);

  const totals = useMemo(() => {
    const rows = visibleRows;
    const etapaAtual = etapa ?? "recebimento_cd";
    const countKey = etapaCountKey(etapaAtual);
    const pendingKey = etapaPendingKey(etapaAtual);
    return {
      informado: rows.reduce((sum, row) => sum + row.volume_total_informado, 0),
      recebido: rows.reduce((sum, row) => sum + row.recebido_count, 0),
      etapa: rows.reduce((sum, row) => sum + row[countKey], 0),
      pendente: rows.reduce((sum, row) => sum + row[pendingKey], 0)
    };
  }, [etapa, visibleRows]);

  const loadPending = useCallback(async () => {
    const [ops, summary] = await Promise.all([
      listClvPendingOperations(profile.user_id),
      countClvPendingOperations(profile.user_id)
    ]);
    setPendingOps(ops);
    setPendingCount(summary.pending_count);
    setPendingErrors(summary.error_count);
  }, [profile.user_id]);

  const refreshFeed = useCallback(async () => {
    if (!allowed || !isOnline || currentCd == null) return;
    setBusyRefresh(true);
    try {
      const rows = await fetchClvTodayFeed(currentCd);
      setFeedRows(rows);
      if (loadedPedido != null && etapa && etapa !== "recebimento_cd") {
        const manifest = await fetchClvPedidoManifest(currentCd, loadedPedido, etapa);
        setManifestRows(manifest);
      }
    } catch (error) {
      setErrorMessage(toClvErrorMessage(error));
    } finally {
      setBusyRefresh(false);
    }
  }, [allowed, currentCd, etapa, isOnline, loadedPedido]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  useEffect(() => {
    let cancelled = false;
    async function loadPrefs() {
      const prefs = await getClvPreferences(profile.user_id);
      if (cancelled) return;
      setPreferOfflineMode(prefs.prefer_offline_mode);
      if (globalAdmin && prefs.cd_ativo != null) setCdAtivo(prefs.cd_ativo);
    }
    void loadPrefs();
    return () => { cancelled = true; };
  }, [globalAdmin, profile.user_id]);

  useEffect(() => {
    if (!allowed || !globalAdmin || !isOnline) return;
    let cancelled = false;
    async function loadOptions() {
      try {
        const options = await fetchCdOptions();
        if (!cancelled) setCdOptions(options);
      } catch {
        if (!cancelled) setCdOptions([]);
      }
    }
    void loadOptions();
    return () => { cancelled = true; };
  }, [allowed, globalAdmin, isOnline]);

  useEffect(() => {
    if (!allowed) return;
    void saveClvPreferences(profile.user_id, {
      cd_ativo: currentCd,
      prefer_offline_mode: preferOfflineMode
    });
  }, [allowed, currentCd, preferOfflineMode, profile.user_id]);

  useEffect(() => {
    void refreshFeed();
  }, [refreshFeed]);

  const runSync = useCallback(async (quiet = false) => {
    if (!allowed || !isOnline || busySync) return;
    setBusySync(true);
    if (!quiet) {
      setErrorMessage(null);
      setStatusMessage(null);
    }
    try {
      const result = await syncPendingClvOperations(profile.user_id);
      await loadPending();
      await refreshFeed();
      if (!quiet && result.processed > 0) {
        setStatusMessage(`${result.synced} pendências sincronizadas. Restantes: ${result.pending}.`);
      }
    } catch (error) {
      if (!quiet) setErrorMessage(toClvErrorMessage(error));
    } finally {
      setBusySync(false);
    }
  }, [allowed, busySync, isOnline, loadPending, profile.user_id, refreshFeed]);

  useEffect(() => {
    if (!allowed || !isOnline || pendingCount <= 0) return;
    if (syncTimerRef.current != null) window.clearInterval(syncTimerRef.current);
    syncTimerRef.current = window.setInterval(() => {
      void runSync(true);
    }, SYNC_INTERVAL_MS);
    return () => {
      if (syncTimerRef.current != null) window.clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    };
  }, [allowed, isOnline, pendingCount, runSync]);

  useEffect(() => {
    if (isOnline && pendingCount > 0) void runSync(true);
  }, [isOnline, pendingCount, runSync]);

  const queueOperation = useCallback(async (operation: ClvPendingOperation) => {
    await saveClvPendingOperation(operation);
    await loadPending();
    setStatusMessage("Leitura salva localmente. Será enviada quando houver conexão.");
  }, [loadPending]);

  const clearScanInputs = useCallback(() => {
    setEtiquetaInput("");
    setIdKnappInput("");
    setFracionado(false);
    setFracionadoQtd("");
    setFracionadoTipo("pedido_direto");
    window.requestAnimationFrame(() => etiquetaRef.current?.focus({ preventScroll: true }));
  }, []);

  const chooseStage = useCallback((nextEtapa: ClvEtapa) => {
    setEtapa(nextEtapa);
    setShowStagePicker(false);
    setErrorMessage(null);
    setStatusMessage(null);
    setLoadedPedido(null);
    setManifestRows([]);
    setActiveDeliveryRow(null);
    setActiveReceiptRow(null);
    setReceiptArmed(false);
    setPedidoInput("");
    setVolumeTotalInput("");
    setFeedSearch("");
    setExpandedLoteId(null);
    clearScanInputs();
  }, [clearScanInputs]);

  const loadPedidoManifest = useCallback(async () => {
    if (!etapa || etapa === "recebimento_cd") return;
    if (currentCd == null) {
      setErrorMessage("Selecione o CD antes de carregar o pedido.");
      return;
    }
    const pedido = Number.parseInt(pedidoInput.replace(/\D/g, ""), 10);
    if (!Number.isFinite(pedido)) {
      setErrorMessage("Informe o número do pedido.");
      return;
    }
    if (!isOnline) {
      setErrorMessage("Conecte-se para carregar os volumes do pedido.");
      return;
    }
    setBusyRefresh(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const rows = await fetchClvPedidoManifest(currentCd, pedido, etapa);
      setManifestRows(rows);
      setLoadedPedido(pedido);
      setActiveDeliveryRow(null);
      setStatusMessage(rows.length > 0 ? `${rows.length} loja(s) carregada(s) para o pedido ${pedido}.` : "Nenhum volume recebido para este pedido.");
    } catch (error) {
      setErrorMessage(toClvErrorMessage(error));
    } finally {
      setBusyRefresh(false);
    }
  }, [currentCd, etapa, isOnline, pedidoInput]);

  const validateCommonScan = useCallback(() => {
    if (!etapa) throw new Error("Selecione uma etapa.");
    if (currentCd == null) throw new Error("Selecione o CD antes de continuar.");
    const parsed = parseClvEtiqueta(etiquetaInput, idKnappInput, { currentCd });
    if (requiresKnappId(parsed.length) && !parsed.id_knapp) throw new Error(CLV_INVALID_KNAPP_MESSAGE);
    return { parsed, cd: currentCd };
  }, [currentCd, etapa, etiquetaInput, idKnappInput]);

  const submitRecebimento = useCallback(async () => {
    if (!receiptArmed) {
      setErrorMessage("Clique em Iniciar loja ou Trocar loja antes de bipar.");
      return;
    }
    const { parsed, cd } = validateCommonScan();
    const total = Number.parseInt(volumeTotalInput.replace(/\D/g, ""), 10);
    if (!Number.isFinite(total) || total <= 0) throw new Error("Informe a quantidade total de volumes da loja.");
    if (activeReceiptRow && (activeReceiptRow.pedido !== parsed.pedido || activeReceiptRow.filial !== parsed.filial)) {
      throw new Error("Volume pertence a outra loja ou pedido. Clique em Trocar loja para alterar.");
    }
    if (activeReceiptRow && total < activeReceiptRow.recebido_count + 1) {
      throw new Error("Total informado menor que o volume já bipado.");
    }
    if (hasEtapaVolume(visibleRows, "recebimento_cd", parsed.volume_key)) {
      throw new Error("Este volume já foi informado no recebimento.");
    }
    const fractionType = normalizeFracionadoTipo(fracionadoTipo);
    const fractionQty = fracionado ? Number.parseInt(fracionadoQtd.replace(/\D/g, ""), 10) : null;
    if (fracionado && (!Number.isFinite(fractionQty) || (fractionQty ?? 0) <= 0)) {
      throw new Error("Informe a quantidade fracionada.");
    }
    if (fracionado && !fractionType) throw new Error("Selecione Pedido Direto ou Termolábeis.");

    const nowIso = new Date().toISOString();
    const payload = {
      cd,
      etiqueta: parsed.etiqueta,
      id_knapp: parsed.id_knapp,
      volume_total_informado: total,
      fracionado,
      fracionado_qtd: fracionado ? fractionQty : null,
      fracionado_tipo: fracionado ? fractionType : null,
      data_hr: nowIso
    };

    if (!isOnline || preferOfflineMode) {
      const localOperation: ClvPendingOperation = {
        local_id: safeUuid(),
        user_id: profile.user_id,
        kind: "recebimento",
        payload,
        parsed,
        sync_status: "pending",
        sync_error: null,
        created_at: nowIso,
        updated_at: nowIso
      };
      await queueOperation({
        ...localOperation
      });
      setActiveReceiptRow((current) => {
        const row = current ?? emptyLocalRow(localOperation);
        return recomputePending({
          ...row,
          volume_total_informado: total,
          recebido_count: row.recebido_count + 1,
          updated_at: nowIso,
          movimentos: [movementFromPending(localOperation), ...row.movimentos]
        });
      });
      setReceiptArmed(true);
      clearScanInputs();
      return;
    }

    const row = await scanClvRecebimento(payload);
    setFeedRows((current) => mergeRow(current, row));
    setActiveReceiptRow(row);
    setReceiptArmed(true);
    setVolumeTotalInput(String(row.volume_total_informado));
    setExpandedLoteId(row.lote_id);
    setStatusMessage(`Recebimento registrado: filial ${row.filial} | pedido ${row.pedido}.`);
    clearScanInputs();
  }, [
    activeReceiptRow,
    clearScanInputs,
    fracionado,
    fracionadoQtd,
    fracionadoTipo,
    isOnline,
    preferOfflineMode,
    profile.user_id,
    queueOperation,
    receiptArmed,
    validateCommonScan,
    visibleRows,
    volumeTotalInput
  ]);

  const submitStage = useCallback(async () => {
    if (!etapa || etapa === "recebimento_cd") return;
    const { parsed, cd } = validateCommonScan();
    if (loadedPedido == null || parsed.pedido !== loadedPedido) {
      throw new Error("Carregue o pedido antes de confirmar volumes.");
    }
    const targetRow = findRowForParsed(visibleRows, parsed);
    if (!targetRow) throw new Error("Volume não encontrado no recebimento inicial.");
    if (!rowContainsVolume(targetRow, parsed.volume_key, "recebimento_cd")) {
      throw new Error("Volume não encontrado no recebimento inicial.");
    }
    if (hasEtapaVolume(visibleRows, etapa, parsed.volume_key)) {
      throw new Error("Este volume já foi confirmado nesta etapa.");
    }
    if (etapa === "entrega_filial") {
      if (!activeDeliveryRow) throw new Error("Inicie a entrega de uma filial antes de bipar.");
      if (activeDeliveryRow.pedido !== parsed.pedido || activeDeliveryRow.filial !== parsed.filial) {
        throw new Error("Volume pertence a outra filial. Troque a filial ativa para continuar.");
      }
    }

    const nowIso = new Date().toISOString();
    const payload = {
      cd,
      etapa: etapa as ClvStageEtapa,
      etiqueta: parsed.etiqueta,
      id_knapp: parsed.id_knapp,
      lote_id: etapa === "entrega_filial" ? activeDeliveryRow?.lote_id ?? null : targetRow.lote_id,
      data_hr: nowIso
    };

    if (!isOnline || preferOfflineMode) {
      await queueOperation({
        local_id: safeUuid(),
        user_id: profile.user_id,
        kind: "stage",
        payload,
        parsed,
        sync_status: "pending",
        sync_error: null,
        created_at: nowIso,
        updated_at: nowIso
      });
      clearScanInputs();
      return;
    }

    const row = await scanClvStage(payload);
    setManifestRows((current) => mergeRow(current, row));
    setExpandedLoteId(row.lote_id);
    setStatusMessage(`${CLV_ETAPA_LABELS[etapa]}: volume confirmado para filial ${row.filial}.`);
    clearScanInputs();
  }, [
    activeDeliveryRow,
    clearScanInputs,
    etapa,
    isOnline,
    loadedPedido,
    preferOfflineMode,
    profile.user_id,
    queueOperation,
    validateCommonScan,
    visibleRows
  ]);

  const onSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (busySubmit) return;
    setBusySubmit(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      if (etapa === "recebimento_cd") {
        await submitRecebimento();
      } else {
        await submitStage();
      }
    } catch (error) {
      setErrorMessage(toClvErrorMessage(error));
    } finally {
      setBusySubmit(false);
    }
  }, [busySubmit, etapa, submitRecebimento, submitStage]);

  const discardPending = useCallback(async (localId: string) => {
    setBusyPendingDiscard(true);
    try {
      await removeClvPendingOperation(localId);
      await loadPending();
    } finally {
      setBusyPendingDiscard(false);
    }
  }, [loadPending]);

  const discardAllPending = useCallback(async () => {
    setBusyPendingDiscard(true);
    try {
      for (const operation of pendingOps) {
        await removeClvPendingOperation(operation.local_id);
      }
      await loadPending();
      setShowPendingSyncModal(false);
    } finally {
      setBusyPendingDiscard(false);
    }
  }, [loadPending, pendingOps]);

  const currentStageMeta = etapa ? CLV_STAGE_META[etapa] : null;
  const moduleHeader = (
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
            title="Pendências locais"
            onClick={pendingCount > 0 || pendingErrors > 0 ? () => setShowPendingSyncModal(true) : undefined}
          />
          <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
            {isOnline ? "🟢 Online" : "🔴 Offline"}
          </span>
        </div>
      </div>

      <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
        <span className="module-icon" aria-hidden="true">
          <ModuleIcon name={currentStageMeta?.icon ?? MODULE_DEF.icon} />
        </span>
        <span className="module-title clv-module-title">
          <span>{currentStageMeta?.title ?? MODULE_DEF.title}</span>
          {allowed && currentStageMeta ? (
            <button
              type="button"
              className="clv-header-stage-change"
              onClick={() => setShowStagePicker(true)}
              aria-label="Trocar etapa"
              title="Trocar etapa"
            >
              🔄
            </button>
          ) : null}
        </span>
      </div>
    </header>
  );

  if (!allowed) {
    return (
      <>
        {moduleHeader}

        <section className="modules-shell clv-shell">
          <div className="coleta-head">
            <h2>Acesso indisponível</h2>
            <p>Módulo disponível apenas para a matrícula 88885.</p>
          </div>
        </section>
      </>
    );
  }

  const stageNeedsPedido = etapa != null && etapa !== "recebimento_cd";
  const scanDisabled = currentCd == null
    || busySubmit
    || etapa == null
    || (etapa === "recebimento_cd" && !receiptArmed)
    || (stageNeedsPedido && loadedPedido == null)
    || (etapa === "entrega_filial" && !activeDeliveryRow);

  return (
    <>
      {moduleHeader}

      <section className="modules-shell clv-shell">
        <div className="coleta-head">
          <h2>Controle Logístico</h2>
          <p>Fluxo de volumes por loja, pedido e etapa logística.</p>
        </div>

        <div className="coleta-actions-row clv-toolbar">
          <button className="btn btn-muted coleta-sync-btn" type="button" onClick={() => void refreshFeed()} disabled={!isOnline || busyRefresh}>
            {busyRefresh ? "Atualizando..." : "Atualizar"}
          </button>
          <button
            className={`btn btn-muted termo-offline-toggle${preferOfflineMode ? " is-active" : ""}`}
            type="button"
            onClick={() => setPreferOfflineMode((value) => !value)}
            title={preferOfflineMode ? "Desativar modo offline local" : "Ativar modo offline local"}
          >
            {preferOfflineMode ? "📦 Offline ativo" : "📶 Trabalhar offline"}
          </button>
        </div>

        {globalAdmin ? (
          <div className="coleta-form clv-cd-panel">
            <label>
              Depósito
              <select value={cdAtivo ?? ""} onChange={(event) => setCdAtivo(event.target.value ? Number.parseInt(event.target.value, 10) : null)}>
                <option value="" disabled>Selecione o CD</option>
                {cdOptions.map((option) => (
                  <option key={option.cd} value={option.cd}>{cdCodeLabel(option.cd)}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {etapa && currentStageMeta ? (
          <>
            <div className="clv-summary-grid">
              <div className="clv-summary-card"><span>Informado</span><strong>{totals.informado}</strong></div>
              <div className="clv-summary-card"><span>Bipado etapa</span><strong>{totals.etapa}</strong></div>
              <div className="clv-summary-card is-pending"><span>Pendente</span><strong>{totals.pendente}</strong></div>
              <div className="clv-summary-card"><span>Recebido</span><strong>{totals.recebido}</strong></div>
            </div>

            {stageNeedsPedido ? (
              <div className="coleta-form clv-pedido-panel">
                <label>
                  Pedido
                  <input
                    type="text"
                    inputMode="numeric"
                    value={pedidoInput}
                    onChange={(event) => setPedidoInput(event.target.value.replace(/\D/g, ""))}
                    placeholder="Número do pedido"
                  />
                </label>
                <button className="btn btn-primary" type="button" onClick={() => void loadPedidoManifest()} disabled={currentCd == null || busyRefresh}>
                  {busyRefresh ? "Carregando..." : "Carregar pedido"}
                </button>
              </div>
            ) : null}

            {etapa === "recebimento_cd" ? (
              <div className="aud-caixa-store-context-bar">
                <button
                  type="button"
                  className={`aud-caixa-store-context-btn${receiptArmed ? " is-active" : ""}`}
                  onClick={() => {
                    setReceiptArmed(true);
                    setActiveReceiptRow(null);
                    setVolumeTotalInput("");
                    clearScanInputs();
                    setStatusMessage("Loja armada. Bipe o primeiro volume e informe o total.");
                  }}
                  disabled={currentCd == null}
                >
                  <span aria-hidden="true"><ModuleIcon name="volume" /></span>
                  {receiptArmed || activeReceiptRow ? "Trocar loja" : "Iniciar loja"}
                </button>
                <span className={`aud-caixa-store-context-pill${receiptArmed || activeReceiptRow ? " is-active" : ""}`}>
                  {receiptArmed && activeReceiptRow
                    ? `Loja ativa: filial ${activeReceiptRow.filial} | pedido ${activeReceiptRow.pedido}`
                    : receiptArmed
                    ? "Aguardando primeiro bip da loja"
                    : activeReceiptRow
                    ? `Última loja: filial ${activeReceiptRow.filial} | pedido ${activeReceiptRow.pedido}`
                    : "Nenhuma loja iniciada"}
                </span>
              </div>
            ) : null}

            {etapa === "entrega_filial" && loadedPedido != null ? (
              <div className="clv-delivery-picker">
                {visibleRows.map((row) => (
                  <button
                    key={row.lote_id}
                    type="button"
                    className={`clv-delivery-chip${activeDeliveryRow?.lote_id === row.lote_id ? " is-active" : ""}`}
                    onClick={() => {
                      setActiveDeliveryRow(row);
                      setStatusMessage(`Entrega iniciada: filial ${row.filial} | pedido ${row.pedido}.`);
                    }}
                  >
                    Filial {row.filial} · {stageReadyMessage("entrega_filial", row)}
                  </button>
                ))}
              </div>
            ) : null}

            <form className="coleta-form clv-scan-form" onSubmit={onSubmit}>
              <div className="coleta-form-grid aud-caixa-form-grid">
                <label>
                  Etiqueta de volume
                  <input
                    ref={etiquetaRef}
                    type="text"
                    inputMode="numeric"
                    value={etiquetaInput}
                    onChange={(event) => setEtiquetaInput(clampEtiquetaInput(event.target.value))}
                    maxLength={CLV_MAX_LENGTH}
                    placeholder="Bipe ou digite a etiqueta"
                    disabled={scanDisabled}
                    autoComplete="off"
                  />
                </label>
                <label>
                  ID Knapp
                  <input
                    type="text"
                    inputMode="numeric"
                    value={idKnappInput}
                    onChange={(event) => setIdKnappInput(event.target.value.replace(/\D/g, "").slice(0, 8))}
                    placeholder="Obrigatório para Knapp"
                    disabled={scanDisabled}
                    autoComplete="off"
                  />
                </label>
                {etapa === "recebimento_cd" ? (
                  <label>
                    Total de volumes
                    <input
                      type="text"
                      inputMode="numeric"
                      value={volumeTotalInput}
                      onChange={(event) => setVolumeTotalInput(event.target.value.replace(/\D/g, ""))}
                      placeholder="Quantidade total"
                      disabled={currentCd == null || busySubmit || !receiptArmed}
                    />
                  </label>
                ) : null}
              </div>

              {etapa === "recebimento_cd" ? (
                <div className="clv-fraction-row">
                  <label className="clv-check-row">
                    <input type="checkbox" checked={fracionado} onChange={(event) => setFracionado(event.target.checked)} disabled={scanDisabled} />
                    Volume fracionado
                  </label>
                  <label>
                    Quantidade
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fracionadoQtd}
                      onChange={(event) => setFracionadoQtd(event.target.value.replace(/\D/g, ""))}
                      disabled={scanDisabled || !fracionado}
                    />
                  </label>
                  <label>
                    Tipo
                    <select value={fracionadoTipo} onChange={(event) => setFracionadoTipo(event.target.value as ClvFracionadoTipo)} disabled={scanDisabled || !fracionado}>
                      {Object.entries(CLV_FRACIONADO_TIPO_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              <button className="btn btn-primary coleta-submit" type="submit" disabled={scanDisabled}>
                {busySubmit ? "Salvando..." : etapa === "recebimento_cd" ? "Registrar recebimento" : "Confirmar volume"}
              </button>
            </form>

            {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
            {statusMessage ? <div className="alert success">{statusMessage}</div> : null}

            <div className="coleta-list-head">
              <h3>{etapa === "recebimento_cd" ? "Feed de recebimento" : loadedPedido ? `Pedido ${loadedPedido}` : "Volumes do pedido"}</h3>
              <span>{filteredRows.length} loja(s)</span>
            </div>

            <div className="input-icon-wrap aud-caixa-feed-search">
              <span className="field-icon" aria-hidden="true"><ModuleIcon name="search" /></span>
              <input
                type="text"
                value={feedSearch}
                onChange={(event) => setFeedSearch(event.target.value)}
                placeholder="Buscar por filial, pedido, rota ou etiqueta..."
                autoComplete="off"
              />
            </div>

            <div className="aud-caixa-feed clv-feed">
              {filteredRows.length === 0 ? (
                <div className="coleta-empty">
                  {stageNeedsPedido ? "Carregue um pedido para visualizar as lojas." : "Nenhum volume registrado para este CD."}
                </div>
              ) : filteredRows.map((row) => {
                const countKey = etapaCountKey(etapa);
                const pendingKey = etapaPendingKey(etapa);
                const expanded = expandedLoteId === row.lote_id;
                return (
                  <article key={row.lote_id} className={`coleta-row-card clv-row-card${row[pendingKey] > 0 ? " has-pending" : ""}`}>
                    <button
                      type="button"
                      className="coleta-row-line"
                      onClick={() => setExpandedLoteId(expanded ? null : row.lote_id)}
                    >
                      <div className="coleta-row-line-main">
                        <strong>Filial {row.filial}{row.filial_nome ? ` · ${row.filial_nome}` : ""}</strong>
                        <p>Pedido {row.pedido} · {row.rota ?? "Sem rota"}</p>
                      </div>
                      <div className="clv-row-counts">
                        <span>{row[countKey]}/{etapa === "recebimento_cd" ? row.volume_total_informado : row.recebido_count}</span>
                        <strong>{row[pendingKey]} pend.</strong>
                      </div>
                    </button>
                    {expanded ? (
                      <div className="coleta-row-edit-card">
                        <div className="coleta-row-detail-grid">
                          <div className="coleta-row-detail"><span>Volume informado</span><strong>{row.volume_total_informado}</strong></div>
                          <div className="coleta-row-detail"><span>Recebido</span><strong>{row.recebido_count}</strong></div>
                          <div className="coleta-row-detail"><span>Entrada</span><strong>{row.entrada_count}</strong></div>
                          <div className="coleta-row-detail"><span>Saída</span><strong>{row.saida_count}</strong></div>
                          <div className="coleta-row-detail"><span>Entrega</span><strong>{row.entrega_count}</strong></div>
                          <div className="coleta-row-detail"><span>Data pedido</span><strong>{formatDateOnlyPtBR(row.data_pedido)}</strong></div>
                        </div>
                        <div className="clv-mov-list">
                          {row.movimentos.map((mov) => (
                            <div key={`${mov.mov_id}:${mov.etapa}`} className={`clv-mov-item${mov.is_local ? " is-local" : ""}`}>
                              <strong>{CLV_ETAPA_LABELS[mov.etapa]}</strong>
                              <span>{mov.etiqueta} · Vol {mov.volume ?? "-"}</span>
                              <span>
                                {mov.fracionado ? `Fracionado ${mov.fracionado_qtd ?? "-"} · ${mov.fracionado_tipo ? CLV_FRACIONADO_TIPO_LABELS[mov.fracionado_tipo] : "-"}` : "Inteiro"}
                              </span>
                              <small>{mov.is_local ? "Pendente local" : `${toDisplayName(mov.nome_operador)} · ${formatDateTime(mov.data_hr)}`}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="coleta-empty clv-stage-empty">
            Escolha uma etapa para iniciar o controle logístico.
          </div>
        )}
      </section>

      {showStagePicker ? (
        <div className="confirm-overlay clv-stage-modal-backdrop" role="presentation">
          <div
            className="confirm-dialog clv-stage-modal surface-enter"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clv-stage-modal-title"
          >
            <div className="clv-stage-modal-head">
              <div>
                <h3 id="clv-stage-modal-title">Personalize a etapa</h3>
                <p>Escolha o ponto do fluxo logístico que o funcionário vai operar agora.</p>
              </div>
              {etapa ? (
                <button type="button" className="clv-stage-modal-close" onClick={() => setShowStagePicker(false)} aria-label="Fechar escolha de etapa">
                  x
                </button>
              ) : null}
            </div>
            <div className="clv-stage-picker" aria-label="Etapas do controle logístico">
              {CLV_STAGE_ORDER.map((item, index) => {
                const meta = CLV_STAGE_META[item];
                return (
                  <button
                    key={item}
                    type="button"
                    className={`clv-stage-card tone-${meta.tone}${etapa === item ? " is-active" : ""}`}
                    onClick={() => chooseStage(item)}
                  >
                    <span className="clv-stage-card-index">0{index + 1}</span>
                    <span className="clv-stage-card-icon" aria-hidden="true"><ModuleIcon name={meta.icon} /></span>
                    <span className="clv-stage-card-copy">
                      <small className="clv-stage-card-tag">{meta.tag}</small>
                      <strong>{meta.title}</strong>
                      <small>{meta.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <PendingSyncDialog
        isOpen={showPendingSyncModal}
        title="Pendências de sincronização"
        items={pendingOps.map((operation) => ({
          id: operation.local_id,
          title: operation.kind === "recebimento" ? "Recebimento" : CLV_ETAPA_LABELS[operation.payload.etapa],
          subtitle: `Etiqueta ${operation.parsed.etiqueta}`,
          detail: `Pedido ${operation.parsed.pedido} | Filial ${operation.parsed.filial}`,
          error: operation.sync_error,
          updatedAt: formatDateTime(operation.updated_at),
          onDiscard: () => void discardPending(operation.local_id)
        }))}
        emptyText="Nenhuma pendência encontrada."
        busy={busyPendingDiscard}
        onClose={() => setShowPendingSyncModal(false)}
        onDiscardAll={pendingOps.length > 0 ? () => void discardAllPending() : undefined}
      />
    </>
  );
}
