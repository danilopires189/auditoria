import { supabase } from "../../lib/supabase";
import type {
  CdOption,
  TransferenciaCdConferenceRow,
  TransferenciaCdConfStatus,
  TransferenciaCdDivergenciaTipo,
  TransferenciaCdEtapa,
  TransferenciaCdItemRow,
  TransferenciaCdNoteRow,
  TransferenciaCdReportCount,
  TransferenciaCdReportFilters,
  TransferenciaCdReportRow
} from "./types";

function extractRawErrorMessage(error: unknown): string {
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

export function toTransferenciaErrorMessage(error: unknown): string {
  const raw = extractRawErrorMessage(error);
  if (!raw) return "Erro inesperado.";
  if (raw.includes("AUTH_REQUIRED")) return "Sessão não autenticada.";
  if (raw.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Entre novamente.";
  if (raw.includes("CD_SEM_ACESSO")) return "Você não possui acesso a este CD.";
  if (raw.includes("CD_FORA_DA_TRANSFERENCIA")) return "Este CD não participa da transferência.";
  if (raw.includes("TRANSFERENCIA_NAO_ENCONTRADA")) return "Transferência não encontrada para esta NF.";
  if (raw.includes("NF_OBRIGATORIA")) return "Informe o número da NF.";
  if (raw.includes("BARRAS_NAO_ENCONTRADA")) return "Código de barras não encontrado.";
  if (raw.includes("PRODUTO_FORA_DA_TRANSFERENCIA")) return "Produto fora desta transferência.";
  if (raw.includes("CONFERENCIA_NAO_ENCONTRADA_OU_FINALIZADA")) return "Conferência não encontrada, finalizada ou aberta por outro usuário.";
  if (raw.includes("SOBRA_PENDENTE")) return "Ajuste os itens com sobra antes de finalizar.";
  if (raw.includes("FALTA_MOTIVO_OBRIGATORIO")) return "Informe o motivo da falta para finalizar.";
  if (raw.includes("APENAS_ADMIN")) return "Recurso disponível apenas para administradores.";
  return raw;
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

function parseStatus(value: unknown): TransferenciaCdConfStatus | null {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "em_conferencia" || raw === "finalizado_ok" || raw === "finalizado_falta") return raw;
  return null;
}

function parseEtapa(value: unknown): TransferenciaCdEtapa {
  return String(value ?? "") === "entrada" ? "entrada" : "saida";
}

function parseDivergencia(value: unknown): TransferenciaCdDivergenciaTipo {
  const raw = String(value ?? "").toLowerCase();
  return raw === "falta" || raw === "sobra" ? raw : "correto";
}

export function normalizeBarcode(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function mapCdOption(row: Record<string, unknown>): CdOption | null {
  const cd = parseInteger(row.cd, -1);
  if (cd < 0) return null;
  return {
    cd,
    cd_nome: String(row.cd_nome ?? `CD ${cd}`)
  };
}

function mapNote(row: Record<string, unknown>): TransferenciaCdNoteRow {
  return {
    dt_nf: String(row.dt_nf ?? ""),
    nf_trf: parseInteger(row.nf_trf),
    sq_nf: parseInteger(row.sq_nf),
    cd_ori: parseInteger(row.cd_ori),
    cd_des: parseInteger(row.cd_des),
    cd_ori_nome: String(row.cd_ori_nome ?? ""),
    cd_des_nome: String(row.cd_des_nome ?? ""),
    etapa: parseEtapa(row.etapa),
    total_itens: parseInteger(row.total_itens),
    qtd_esperada_total: parseInteger(row.qtd_esperada_total),
    saida_status: parseStatus(row.saida_status),
    saida_started_mat: parseNullableString(row.saida_started_mat),
    saida_started_nome: parseNullableString(row.saida_started_nome),
    saida_started_at: parseNullableString(row.saida_started_at),
    saida_finalized_at: parseNullableString(row.saida_finalized_at),
    entrada_status: parseStatus(row.entrada_status),
    entrada_started_mat: parseNullableString(row.entrada_started_mat),
    entrada_started_nome: parseNullableString(row.entrada_started_nome),
    entrada_started_at: parseNullableString(row.entrada_started_at),
    entrada_finalized_at: parseNullableString(row.entrada_finalized_at)
  };
}

function mapConference(row: Record<string, unknown>): TransferenciaCdConferenceRow {
  return {
    conf_id: String(row.conf_id ?? ""),
    conf_date: String(row.conf_date ?? ""),
    dt_nf: String(row.dt_nf ?? ""),
    nf_trf: parseInteger(row.nf_trf),
    sq_nf: parseInteger(row.sq_nf),
    cd_ori: parseInteger(row.cd_ori),
    cd_des: parseInteger(row.cd_des),
    cd_ori_nome: String(row.cd_ori_nome ?? ""),
    cd_des_nome: String(row.cd_des_nome ?? ""),
    etapa: parseEtapa(row.etapa),
    status: parseStatus(row.status) ?? "em_conferencia",
    falta_motivo: parseNullableString(row.falta_motivo),
    started_by: String(row.started_by ?? ""),
    started_mat: String(row.started_mat ?? ""),
    started_nome: String(row.started_nome ?? ""),
    started_at: String(row.started_at ?? new Date().toISOString()),
    finalized_at: parseNullableString(row.finalized_at),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
    is_read_only: row.is_read_only === true,
    origem_status: parseStatus(row.origem_status),
    origem_started_mat: parseNullableString(row.origem_started_mat),
    origem_started_nome: parseNullableString(row.origem_started_nome),
    origem_started_at: parseNullableString(row.origem_started_at),
    origem_finalized_at: parseNullableString(row.origem_finalized_at)
  };
}

function mapItem(row: Record<string, unknown>): TransferenciaCdItemRow {
  return {
    item_id: String(row.item_id ?? ""),
    conf_id: String(row.conf_id ?? ""),
    coddv: parseInteger(row.coddv),
    barras: parseNullableString(row.barras),
    descricao: String(row.descricao ?? "").trim(),
    qtd_esperada: parseInteger(row.qtd_esperada),
    qtd_conferida: parseInteger(row.qtd_conferida),
    qtd_falta: parseInteger(row.qtd_falta),
    qtd_sobra: parseInteger(row.qtd_sobra),
    divergencia_tipo: parseDivergencia(row.divergencia_tipo),
    embcomp_cx: row.embcomp_cx == null ? null : parseInteger(row.embcomp_cx),
    qtd_cxpad: row.qtd_cxpad == null ? null : parseInteger(row.qtd_cxpad),
    updated_at: String(row.updated_at ?? new Date().toISOString())
  };
}

function mapReportCount(row: Record<string, unknown>): TransferenciaCdReportCount {
  return {
    total_notas: parseInteger(row.total_notas),
    total_itens: parseInteger(row.total_itens)
  };
}

function mapReportRow(row: Record<string, unknown>): TransferenciaCdReportRow {
  return {
    dt_nf: String(row.dt_nf ?? ""),
    nf_trf: parseInteger(row.nf_trf),
    sq_nf: parseInteger(row.sq_nf),
    cd_ori: parseInteger(row.cd_ori),
    cd_des: parseInteger(row.cd_des),
    cd_ori_nome: String(row.cd_ori_nome ?? ""),
    cd_des_nome: String(row.cd_des_nome ?? ""),
    saida_status: parseStatus(row.saida_status),
    saida_started_mat: parseNullableString(row.saida_started_mat),
    saida_started_nome: parseNullableString(row.saida_started_nome),
    saida_started_at: parseNullableString(row.saida_started_at),
    saida_finalized_at: parseNullableString(row.saida_finalized_at),
    entrada_status: parseStatus(row.entrada_status),
    entrada_started_mat: parseNullableString(row.entrada_started_mat),
    entrada_started_nome: parseNullableString(row.entrada_started_nome),
    entrada_started_at: parseNullableString(row.entrada_started_at),
    entrada_finalized_at: parseNullableString(row.entrada_finalized_at),
    conciliacao_status: String(row.conciliacao_status ?? "pendente"),
    coddv: parseInteger(row.coddv),
    descricao: String(row.descricao ?? "").trim(),
    qtd_atend: parseInteger(row.qtd_atend),
    qtd_conferida_saida: parseInteger(row.qtd_conferida_saida),
    qtd_conferida_entrada: parseInteger(row.qtd_conferida_entrada),
    diferenca_saida_destino: parseInteger(row.diferenca_saida_destino),
    embcomp_cx: row.embcomp_cx == null ? null : parseInteger(row.embcomp_cx),
    qtd_cxpad: row.qtd_cxpad == null ? null : parseInteger(row.qtd_cxpad)
  };
}

export async function fetchCdOptions(): Promise<CdOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_cd_options");
  if (error) throw new Error(toTransferenciaErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapCdOption(row as Record<string, unknown>)).filter((row): row is CdOption => row != null);
}

export async function searchTransferenciaNotes(cd: number, nfTrf: number): Promise<TransferenciaCdNoteRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_transferencia_cd_note_search", {
    p_cd: cd,
    p_nf_trf: nfTrf
  });
  if (error) throw new Error(toTransferenciaErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapNote(row as Record<string, unknown>));
}

export async function openTransferenciaNote(cd: number, note: TransferenciaCdNoteRow): Promise<TransferenciaCdConferenceRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_transferencia_cd_open_nf", {
    p_cd: cd,
    p_nf_trf: note.nf_trf,
    p_sq_nf: note.sq_nf,
    p_dt_nf: note.dt_nf,
    p_cd_ori: note.cd_ori,
    p_cd_des: note.cd_des
  });
  if (error) throw new Error(toTransferenciaErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao abrir NF.");
  return mapConference(first);
}

export async function fetchTransferenciaItems(confId: string): Promise<TransferenciaCdItemRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_transferencia_cd_get_items", { p_conf_id: confId });
  if (error) throw new Error(toTransferenciaErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapItem(row as Record<string, unknown>));
}

export async function scanTransferenciaBarcode(confId: string, barras: string, qtd: number): Promise<TransferenciaCdItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_transferencia_cd_scan_barcode", {
    p_conf_id: confId,
    p_barras: normalizeBarcode(barras),
    p_qtd: Math.max(1, Math.trunc(qtd))
  });
  if (error) throw new Error(toTransferenciaErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao atualizar item.");
  return mapItem(first);
}

export async function setTransferenciaItemQtd(confId: string, coddv: number, qtdConferida: number): Promise<TransferenciaCdItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_transferencia_cd_set_item_qtd", {
    p_conf_id: confId,
    p_coddv: coddv,
    p_qtd_conferida: Math.max(0, Math.trunc(qtdConferida))
  });
  if (error) throw new Error(toTransferenciaErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao salvar quantidade.");
  return mapItem(first);
}

export async function resetTransferenciaItem(confId: string, coddv: number): Promise<TransferenciaCdItemRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_transferencia_cd_reset_item", {
    p_conf_id: confId,
    p_coddv: coddv
  });
  if (error) throw new Error(toTransferenciaErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao zerar item.");
  return mapItem(first);
}

export async function finalizeTransferencia(confId: string, faltaMotivo: string | null): Promise<{ status: TransferenciaCdConfStatus; falta_motivo: string | null; finalized_at: string | null }> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_transferencia_cd_finalize", {
    p_conf_id: confId,
    p_falta_motivo: faltaMotivo
  });
  if (error) throw new Error(toTransferenciaErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao finalizar conferência.");
  return {
    status: parseStatus(first.status) ?? "em_conferencia",
    falta_motivo: parseNullableString(first.falta_motivo),
    finalized_at: parseNullableString(first.finalized_at)
  };
}

export async function cancelTransferencia(confId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_transferencia_cd_cancel", { p_conf_id: confId });
  if (error) throw new Error(toTransferenciaErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return first?.cancelled === true;
}

export async function countTransferenciaConciliacaoRows(filters: TransferenciaCdReportFilters): Promise<TransferenciaCdReportCount> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_transferencia_cd_conciliacao_count", {
    p_dt_ini: filters.dtIni,
    p_dt_fim: filters.dtFim,
    p_cd: filters.cd
  });
  if (error) throw new Error(toTransferenciaErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return first ? mapReportCount(first) : { total_notas: 0, total_itens: 0 };
}

export async function fetchTransferenciaConciliacaoRows(
  filters: TransferenciaCdReportFilters,
  offset = 0,
  limit = 1000
): Promise<TransferenciaCdReportRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_conf_transferencia_cd_conciliacao_rows", {
    p_dt_ini: filters.dtIni,
    p_dt_fim: filters.dtFim,
    p_cd: filters.cd,
    p_offset: Math.max(offset, 0),
    p_limit: Math.max(1, limit)
  });
  if (error) throw new Error(toTransferenciaErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapReportRow(row as Record<string, unknown>));
}
