import { supabase } from "../../lib/supabase";
import type {
  AlocacaoManifestRow,
  AlocacaoSubmitResult,
  PvpsAdminBlacklistRow,
  PvpsAdminClearZoneResult,
  PvpsAdminPriorityZoneRow,
  PvpsModulo,
  PvpsManifestRow,
  PvpsPulItemRow,
  PvpsPulSubmitResult,
  PvpsSepSubmitResult,
  PvpsStatus,
  PvpsEndSit
} from "./types";

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

function parseString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = parseString(value).toLowerCase().trim();
  return normalized === "true" || normalized === "t" || normalized === "1";
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

function parsePvpsStatus(value: unknown): PvpsStatus {
  const normalized = parseString(value).toLowerCase();
  if (normalized === "pendente_pul" || normalized === "concluido" || normalized === "nao_conforme") {
    return normalized;
  }
  return "pendente_sep";
}

function parseEndSit(value: unknown): PvpsEndSit | null {
  const normalized = parseString(value).toLowerCase();
  if (normalized === "vazio" || normalized === "obstruido") return normalized;
  return null;
}

function mapPvpsManifest(raw: Record<string, unknown>): PvpsManifestRow {
  return {
    cd: parseInteger(raw.cd),
    zona: parseString(raw.zona, "SEM ZONA").toUpperCase(),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao),
    end_sep: parseString(raw.end_sep).toUpperCase(),
    pul_total: Math.max(parseInteger(raw.pul_total), 0),
    pul_auditados: Math.max(parseInteger(raw.pul_auditados), 0),
    status: parsePvpsStatus(raw.status),
    end_sit: parseEndSit(raw.end_sit),
    val_sep: parseNullableString(raw.val_sep),
    audit_id: parseNullableString(raw.audit_id),
    dat_ult_compra: parseString(raw.dat_ult_compra),
    qtd_est_disp: Math.max(parseInteger(raw.qtd_est_disp), 0)
  };
}

function mapPvpsPul(raw: Record<string, unknown>): PvpsPulItemRow {
  return {
    end_pul: parseString(raw.end_pul).toUpperCase(),
    val_pul: parseNullableString(raw.val_pul),
    auditado: parseBoolean(raw.auditado)
  };
}

function mapAlocacaoManifest(raw: Record<string, unknown>): AlocacaoManifestRow {
  return {
    queue_id: parseString(raw.queue_id),
    cd: parseInteger(raw.cd),
    zona: parseString(raw.zona, "SEM ZONA").toUpperCase(),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao),
    endereco: parseString(raw.endereco).toUpperCase(),
    nivel: parseNullableString(raw.nivel),
    val_sist: parseString(raw.val_sist),
    dat_ult_compra: parseString(raw.dat_ult_compra),
    qtd_est_disp: Math.max(parseInteger(raw.qtd_est_disp), 0)
  };
}

export async function fetchPvpsManifest(params?: { zona?: string | null }): Promise<PvpsManifestRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_manifest_items_page", {
    p_zona: params?.zona ?? null,
    p_offset: 0,
    p_limit: 500
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapPvpsManifest(row as Record<string, unknown>));
}

export async function fetchPvpsPulItems(coddv: number, endSep: string): Promise<PvpsPulItemRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_pul_items", {
    p_coddv: coddv,
    p_end_sep: endSep
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapPvpsPul(row as Record<string, unknown>));
}

export async function submitPvpsSep(params: {
  coddv: number;
  end_sep: string;
  end_sit?: PvpsEndSit | null;
  val_sep: string;
}): Promise<PvpsSepSubmitResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_submit_sep", {
    p_coddv: params.coddv,
    p_end_sep: params.end_sep,
    p_end_sit: params.end_sit ?? null,
    p_val_sep: params.val_sep
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao salvar etapa SEP.");

  return {
    audit_id: parseString(first.audit_id),
    status: parsePvpsStatus(first.status),
    val_sep: parseString(first.val_sep),
    end_sit: parseEndSit(first.end_sit),
    pul_total: Math.max(parseInteger(first.pul_total), 0),
    pul_auditados: Math.max(parseInteger(first.pul_auditados), 0)
  };
}

function parseModulo(value: unknown): PvpsModulo {
  const normalized = parseString(value).toLowerCase();
  if (normalized === "pvps" || normalized === "alocacao") return normalized;
  return "ambos";
}

export async function fetchAdminBlacklist(modulo: PvpsModulo = "ambos"): Promise<PvpsAdminBlacklistRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_blacklist_list", {
    p_modulo: modulo
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const raw = row as Record<string, unknown>;
    return {
      blacklist_id: parseString(raw.blacklist_id),
      cd: parseInteger(raw.cd),
      modulo: parseModulo(raw.modulo),
      zona: parseString(raw.zona, "SEM ZONA").toUpperCase(),
      coddv: parseInteger(raw.coddv),
      created_at: parseString(raw.created_at)
    };
  });
}

export async function upsertAdminBlacklist(params: {
  modulo: PvpsModulo;
  zona: string;
  coddv: number;
}): Promise<PvpsAdminBlacklistRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_blacklist_upsert", {
    p_modulo: params.modulo,
    p_zona: params.zona,
    p_coddv: params.coddv
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao salvar blacklist.");
  return {
    blacklist_id: parseString(first.blacklist_id),
    cd: parseInteger(first.cd),
    modulo: parseModulo(first.modulo),
    zona: parseString(first.zona, "SEM ZONA").toUpperCase(),
    coddv: parseInteger(first.coddv),
    created_at: parseString(first.created_at)
  };
}

export async function removeAdminBlacklist(blacklistId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_blacklist_delete", {
    p_blacklist_id: blacklistId
  });
  if (error) throw new Error(toErrorMessage(error));
  return parseBoolean(data);
}

export async function fetchAdminPriorityZones(modulo: PvpsModulo = "ambos"): Promise<PvpsAdminPriorityZoneRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_priority_zone_list", {
    p_modulo: modulo
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const raw = row as Record<string, unknown>;
    return {
      priority_id: parseString(raw.priority_id),
      cd: parseInteger(raw.cd),
      modulo: parseModulo(raw.modulo),
      zona: parseString(raw.zona, "SEM ZONA").toUpperCase(),
      prioridade: parseInteger(raw.prioridade, 100),
      updated_at: parseString(raw.updated_at)
    };
  });
}

export async function upsertAdminPriorityZone(params: {
  modulo: PvpsModulo;
  zona: string;
  prioridade: number;
}): Promise<PvpsAdminPriorityZoneRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_priority_zone_upsert", {
    p_modulo: params.modulo,
    p_zona: params.zona,
    p_prioridade: Math.max(1, Math.trunc(params.prioridade))
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao salvar zona prioritária.");
  return {
    priority_id: parseString(first.priority_id),
    cd: parseInteger(first.cd),
    modulo: parseModulo(first.modulo),
    zona: parseString(first.zona, "SEM ZONA").toUpperCase(),
    prioridade: parseInteger(first.prioridade, 100),
    updated_at: parseString(first.updated_at)
  };
}

export async function removeAdminPriorityZone(priorityId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_priority_zone_delete", {
    p_priority_id: priorityId
  });
  if (error) throw new Error(toErrorMessage(error));
  return parseBoolean(data);
}

export async function clearZone(params: {
  modulo: PvpsModulo;
  zona: string;
  repor_automatico: boolean;
}): Promise<PvpsAdminClearZoneResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_clear_zone", {
    p_modulo: params.modulo,
    p_zona: params.zona,
    p_repor_automatico: params.repor_automatico
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao limpar zona.");
  return {
    cleared_pvps: Math.max(parseInteger(first.cleared_pvps), 0),
    cleared_alocacao: Math.max(parseInteger(first.cleared_alocacao), 0),
    reposto_pvps: Math.max(parseInteger(first.reposto_pvps), 0),
    reposto_alocacao: Math.max(parseInteger(first.reposto_alocacao), 0)
  };
}

export async function reseedByZone(params: {
  modulo: PvpsModulo;
  zona: string;
}): Promise<PvpsAdminClearZoneResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_reseed_zone", {
    p_modulo: params.modulo,
    p_zona: params.zona
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao repor zona.");
  return {
    cleared_pvps: 0,
    cleared_alocacao: 0,
    reposto_pvps: Math.max(parseInteger(first.reposto_pvps), 0),
    reposto_alocacao: Math.max(parseInteger(first.reposto_alocacao), 0)
  };
}

export async function submitPvpsPul(params: {
  audit_id: string;
  end_pul: string;
  val_pul: string;
}): Promise<PvpsPulSubmitResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_submit_pul", {
    p_audit_id: params.audit_id,
    p_end_pul: params.end_pul,
    p_val_pul: params.val_pul
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao salvar etapa PUL.");

  return {
    audit_id: parseString(first.audit_id),
    status: parsePvpsStatus(first.status),
    pul_total: Math.max(parseInteger(first.pul_total), 0),
    pul_auditados: Math.max(parseInteger(first.pul_auditados), 0),
    conforme: parseBoolean(first.conforme)
  };
}

export async function fetchAlocacaoManifest(params?: { zona?: string | null }): Promise<AlocacaoManifestRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_alocacao_manifest_items_page", {
    p_zona: params?.zona ?? null,
    p_offset: 0,
    p_limit: 500
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapAlocacaoManifest(row as Record<string, unknown>));
}

export async function submitAlocacao(params: {
  queue_id: string;
  end_sit: PvpsEndSit;
  val_conf: string;
}): Promise<AlocacaoSubmitResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_alocacao_submit", {
    p_queue_id: params.queue_id,
    p_end_sit: params.end_sit,
    p_val_conf: params.val_conf
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao salvar auditoria de alocação.");

  const audSitRaw = parseString(first.aud_sit).toLowerCase();
  const audSit = audSitRaw === "conforme" ? "conforme" : "nao_conforme";
  return {
    audit_id: parseString(first.audit_id),
    aud_sit: audSit,
    val_sist: parseString(first.val_sist),
    val_conf: parseString(first.val_conf)
  };
}
