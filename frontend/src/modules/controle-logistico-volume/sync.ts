import { supabase } from "../../lib/supabase";
import {
  listClvPendingOperations,
  removeClvPendingOperation,
  saveClvPendingOperation
} from "./storage";
import type {
  CdOption,
  ClvEtapa,
  ClvFeedRow,
  ClvFracionadoTipo,
  ClvMovimento,
  ClvPendingOperation,
  ClvRecebimentoPayload,
  ClvStagePayload
} from "./types";

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.error_description === "string") return candidate.error_description;
    if (typeof candidate.details === "string") return candidate.details;
  }
  return "";
}

export function toClvErrorMessage(error: unknown): string {
  const raw = rawErrorMessage(error);
  if (!raw) return "Erro inesperado.";
  if (/statement timeout|canceling statement/i.test(raw)) return "A consulta demorou além do limite. Tente novamente.";
  if (raw.includes("AUTH_REQUIRED")) return "Sessão não autenticada.";
  if (raw.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Entre novamente.";
  if (raw.includes("CLV_ACESSO_RESTRITO")) return "Módulo disponível apenas para a matrícula 88885.";
  if (raw.includes("CD_SEM_ACESSO")) return "Você não possui acesso a este CD.";
  if (raw.includes("CD_OBRIGATORIO")) return "Selecione o CD antes de continuar.";
  if (raw.includes("ETIQUETA") || raw.includes("PEDIDO_INVALIDO") || raw.includes("FILIAL_INVALIDA")) {
    return "Etiqueta inválida, revise e tente novamente!";
  }
  if (raw.includes("ID_KNAPP_INVALIDO")) return "Etiqueta Knapp inválida, revise e tente novamente!";
  if (raw.includes("TOTAL_VOLUME_INVALIDO")) return "Informe a quantidade total de volumes da loja.";
  if (raw.includes("TOTAL_VOLUME_MENOR_QUE_BIPADO")) return "Total informado menor que o volume já bipado.";
  if (raw.includes("FRACIONADO_QTD_INVALIDA")) return "Informe a quantidade fracionada.";
  if (raw.includes("FRACIONADO_TIPO_INVALIDO")) return "Selecione Pedido Direto ou Termolábeis.";
  if (raw.includes("VOLUME_JA_INFORMADO")) return "Este volume já foi informado no recebimento.";
  if (raw.includes("VOLUME_JA_CONFIRMADO")) return "Este volume já foi confirmado nesta etapa.";
  if (raw.includes("LOTE_NAO_RECEBIDO") || raw.includes("VOLUME_NAO_RECEBIDO")) {
    return "Volume não encontrado no recebimento inicial.";
  }
  if (raw.includes("FILIAL_DIVERGENTE")) return "Volume pertence a outra filial. Troque a filial ativa para continuar.";
  if (raw.includes("PEDIDO_OBRIGATORIO")) return "Informe o pedido para carregar os volumes.";
  if (raw.includes("ETAPA_INVALIDA")) return "Etapa inválida.";
  if (/duplicate key value/i.test(raw)) return "Volume repetido. Registro não gravado.";
  return raw;
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

function parseEtapa(value: unknown): ClvEtapa {
  const raw = String(value ?? "");
  if (raw === "entrada_galpao" || raw === "saida_galpao" || raw === "entrega_filial") return raw;
  return "recebimento_cd";
}

function parseFracionadoTipo(value: unknown): ClvFracionadoTipo | null {
  const raw = String(value ?? "");
  if (raw === "pedido_direto" || raw === "termolabeis") return raw;
  return null;
}

function mapMovimento(raw: Record<string, unknown>): ClvMovimento {
  return {
    mov_id: String(raw.mov_id ?? ""),
    etapa: parseEtapa(raw.etapa),
    etiqueta: String(raw.etiqueta ?? ""),
    id_knapp: parseNullableString(raw.id_knapp),
    volume: parseNullableString(raw.volume),
    volume_key: String(raw.volume_key ?? ""),
    fracionado: raw.fracionado === true,
    fracionado_qtd: raw.fracionado_qtd == null ? null : parseInteger(raw.fracionado_qtd),
    fracionado_tipo: parseFracionadoTipo(raw.fracionado_tipo),
    mat_operador: String(raw.mat_operador ?? ""),
    nome_operador: String(raw.nome_operador ?? ""),
    data_hr: String(raw.data_hr ?? new Date().toISOString())
  };
}

function mapFeedRow(raw: Record<string, unknown>): ClvFeedRow {
  const movimentosRaw = Array.isArray(raw.movimentos) ? raw.movimentos : [];
  return {
    lote_id: String(raw.lote_id ?? ""),
    cd: parseInteger(raw.cd),
    pedido: parseInteger(raw.pedido),
    data_pedido: parseNullableString(raw.data_pedido),
    dv: parseNullableString(raw.dv),
    filial: parseInteger(raw.filial),
    filial_nome: parseNullableString(raw.filial_nome),
    rota: parseNullableString(raw.rota),
    volume_total_informado: Math.max(parseInteger(raw.volume_total_informado), 0),
    recebido_count: Math.max(parseInteger(raw.recebido_count), 0),
    entrada_count: Math.max(parseInteger(raw.entrada_count), 0),
    saida_count: Math.max(parseInteger(raw.saida_count), 0),
    entrega_count: Math.max(parseInteger(raw.entrega_count), 0),
    pendente_recebimento: Math.max(parseInteger(raw.pendente_recebimento), 0),
    pendente_entrada: Math.max(parseInteger(raw.pendente_entrada), 0),
    pendente_saida: Math.max(parseInteger(raw.pendente_saida), 0),
    pendente_entrega: Math.max(parseInteger(raw.pendente_entrega), 0),
    updated_at: String(raw.updated_at ?? new Date().toISOString()),
    movimentos: movimentosRaw.map((item) => mapMovimento(item as Record<string, unknown>))
  };
}

function isUuid(value: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

export async function fetchCdOptions(): Promise<CdOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_cd_options");
  if (error) throw new Error(toClvErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      const raw = row as Record<string, unknown>;
      const cd = parseInteger(raw.cd, Number.NaN);
      if (!Number.isFinite(cd)) return null;
      return { cd, cd_nome: String(raw.cd_nome ?? `CD ${cd}`) } satisfies CdOption;
    })
    .filter((row): row is CdOption => row != null);
}

export async function fetchClvTodayFeed(cd: number): Promise<ClvFeedRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_clv_today_feed", { p_cd: cd });
  if (error) throw new Error(toClvErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapFeedRow(row as Record<string, unknown>));
}

export async function fetchClvPedidoManifest(cd: number, pedido: number, etapa: ClvEtapa): Promise<ClvFeedRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_clv_pedido_manifest", {
    p_cd: cd,
    p_pedido: pedido,
    p_etapa: etapa
  });
  if (error) throw new Error(toClvErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapFeedRow(row as Record<string, unknown>));
}

export async function scanClvRecebimento(payload: ClvRecebimentoPayload): Promise<ClvFeedRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_clv_recebimento_scan", {
    p_cd: payload.cd,
    p_etiqueta: payload.etiqueta,
    p_id_knapp: payload.id_knapp,
    p_volume_total_informado: payload.volume_total_informado,
    p_fracionado: payload.fracionado,
    p_fracionado_qtd: payload.fracionado_qtd,
    p_fracionado_tipo: payload.fracionado_tipo,
    p_data_hr: payload.data_hr
  });
  if (error) throw new Error(toClvErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Resposta inválida ao registrar recebimento.");
  return mapFeedRow(first);
}

export async function scanClvStage(payload: ClvStagePayload): Promise<ClvFeedRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_clv_stage_scan", {
    p_etapa: payload.etapa,
    p_etiqueta: payload.etiqueta,
    p_id_knapp: payload.id_knapp,
    p_lote_id: isUuid(payload.lote_id) ? payload.lote_id : null,
    p_cd: payload.cd,
    p_data_hr: payload.data_hr
  });
  if (error) throw new Error(toClvErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Resposta inválida ao confirmar volume.");
  return mapFeedRow(first);
}

function patchOperationError(operation: ClvPendingOperation, message: string): ClvPendingOperation {
  return {
    ...operation,
    sync_status: "error",
    sync_error: message,
    updated_at: new Date().toISOString()
  } as ClvPendingOperation;
}

export async function syncPendingClvOperations(userId: string): Promise<{
  processed: number;
  synced: number;
  failed: number;
  pending: number;
}> {
  const pending = await listClvPendingOperations(userId);
  let synced = 0;
  let failed = 0;

  for (const operation of pending) {
    try {
      if (operation.kind === "recebimento") {
        await scanClvRecebimento(operation.payload);
      } else {
        await scanClvStage(operation.payload);
      }
      await removeClvPendingOperation(operation.local_id);
      synced += 1;
    } catch (error) {
      failed += 1;
      await saveClvPendingOperation(patchOperationError(operation, toClvErrorMessage(error)));
    }
  }

  const remaining = await listClvPendingOperations(userId);
  return {
    processed: pending.length,
    synced,
    failed,
    pending: remaining.length
  };
}
