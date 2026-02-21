import { supabase } from "../../lib/supabase";
import type {
  AlocacaoCompletedRow,
  AlocacaoManifestRow,
  AlocacaoSubmitResult,
  PvpsAdminBlacklistRow,
  PvpsAdminRuleActiveRow,
  PvpsAdminRuleCreateResult,
  PvpsAdminRuleHistoryRow,
  PvpsAdminRulePreviewResult,
  PvpsRuleApplyMode,
  PvpsRuleKind,
  PvpsRuleTargetType,
  PvpsAdminClearZoneResult,
  PvpsAdminPriorityZoneRow,
  PvpsCompletedRow,
  PvpsModulo,
  PvpsManifestRow,
  PvpsPulItemRow,
  PvpsPulSubmitResult,
  PvpsSepSubmitResult,
  PvpsStatus,
  PvpsEndSit
} from "./types";

function toErrorMessage(error: unknown): string {
  const translate = (raw: string): string => {
    const normalized = raw.trim().toUpperCase();
    if (normalized.includes("ITEM_BLOQUEADO_BLACKLIST")) {
      return "Item bloqueado por blacklist ativa. Atualize a fila para continuar.";
    }
    return raw;
  };
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return translate(error);
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.message === "string") return translate(candidate.message);
    if (typeof candidate.error_description === "string") return translate(candidate.error_description);
    if (typeof candidate.details === "string") return translate(candidate.details);
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

function parseAudSit(value: unknown): "conforme" | "nao_conforme" | "ocorrencia" {
  const normalized = parseString(value).toLowerCase();
  if (normalized === "conforme") return "conforme";
  if (normalized === "ocorrencia") return "ocorrencia";
  return "nao_conforme";
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
    qtd_est_disp: Math.max(parseInteger(raw.qtd_est_disp), 0),
    priority_score: Math.max(parseInteger(raw.priority_score, 9999), 1)
  };
}

function mapPvpsPul(raw: Record<string, unknown>): PvpsPulItemRow {
  return {
    end_pul: parseString(raw.end_pul).toUpperCase(),
    val_pul: parseNullableString(raw.val_pul),
    end_sit: parseEndSit(raw.end_sit),
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
    qtd_est_disp: Math.max(parseInteger(raw.qtd_est_disp), 0),
    priority_score: Math.max(parseInteger(raw.priority_score, 9999), 1)
  };
}

function mapPvpsCompleted(raw: Record<string, unknown>): PvpsCompletedRow {
  return {
    audit_id: parseString(raw.audit_id),
    auditor_id: parseString(raw.auditor_id),
    cd: parseInteger(raw.cd),
    zona: parseString(raw.zona, "SEM ZONA").toUpperCase(),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao),
    end_sep: parseString(raw.end_sep).toUpperCase(),
    status: parsePvpsStatus(raw.status),
    end_sit: parseEndSit(raw.end_sit),
    val_sep: parseNullableString(raw.val_sep),
    pul_total: Math.max(parseInteger(raw.pul_total), 0),
    pul_auditados: Math.max(parseInteger(raw.pul_auditados), 0),
    pul_has_lower: parseBoolean(raw.pul_has_lower),
    pul_lower_end: parseNullableString(raw.pul_lower_end),
    pul_lower_val: parseNullableString(raw.pul_lower_val),
    dt_hr: parseString(raw.dt_hr),
    auditor_nome: parseString(raw.auditor_nome, "USUARIO")
  };
}

function mapAlocacaoCompleted(raw: Record<string, unknown>): AlocacaoCompletedRow {
  return {
    audit_id: parseString(raw.audit_id),
    auditor_id: parseString(raw.auditor_id),
    queue_id: parseString(raw.queue_id),
    cd: parseInteger(raw.cd),
    zona: parseString(raw.zona, "SEM ZONA").toUpperCase(),
    coddv: parseInteger(raw.coddv),
    descricao: parseString(raw.descricao),
    endereco: parseString(raw.endereco).toUpperCase(),
    nivel: parseNullableString(raw.nivel),
    end_sit: parseEndSit(raw.end_sit),
    val_sist: parseString(raw.val_sist),
    val_conf: parseNullableString(raw.val_conf),
    aud_sit: parseAudSit(raw.aud_sit),
    dt_hr: parseString(raw.dt_hr),
    auditor_nome: parseString(raw.auditor_nome, "USUARIO")
  };
}

export async function fetchPvpsManifest(params?: { p_cd?: number | null; zona?: string | null }): Promise<PvpsManifestRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const pageSize = 500;
  const rows: PvpsManifestRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc("rpc_pvps_manifest_items_page", {
      p_cd: params?.p_cd ?? null,
      p_zona: params?.zona ?? null,
      p_offset: offset,
      p_limit: pageSize
    });
    if (error) throw new Error(toErrorMessage(error));
    const page = Array.isArray(data) ? data.map((row) => mapPvpsManifest(row as Record<string, unknown>)) : [];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

export async function fetchPvpsZoneOptions(params?: { p_cd?: number | null }): Promise<string[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_zone_options", {
    p_cd: params?.p_cd ?? null
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  const zones = data
    .map((row) => parseString((row as Record<string, unknown>).zona, "").toUpperCase())
    .filter((zone) => zone.length > 0);
  return Array.from(new Set(zones)).sort((a, b) => a.localeCompare(b));
}

export async function fetchPvpsPulItems(coddv: number, endSep: string, pCd?: number | null): Promise<PvpsPulItemRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_pul_items", {
    p_cd: pCd ?? null,
    p_coddv: coddv,
    p_end_sep: endSep
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapPvpsPul(row as Record<string, unknown>));
}

export async function submitPvpsSep(params: {
  p_cd?: number | null;
  coddv: number;
  end_sep: string;
  end_sit?: PvpsEndSit | null;
  val_sep?: string | null;
}): Promise<PvpsSepSubmitResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_submit_sep", {
    p_cd: params.p_cd ?? null,
    p_coddv: params.coddv,
    p_end_sep: params.end_sep,
    p_end_sit: params.end_sit ?? null,
    p_val_sep: params.val_sep ?? null
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao salvar etapa SEP.");

  return {
    audit_id: parseString(first.audit_id),
    status: parsePvpsStatus(first.status),
    val_sep: parseNullableString(first.val_sep),
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

function parseRuleKind(value: unknown): PvpsRuleKind {
  return parseString(value).toLowerCase() === "priority" ? "priority" : "blacklist";
}

function parseRuleTargetType(value: unknown): PvpsRuleTargetType {
  return parseString(value).toLowerCase() === "coddv" ? "coddv" : "zona";
}

function parseRuleApplyMode(value: unknown): PvpsRuleApplyMode {
  return parseString(value).toLowerCase() === "next_inclusions" ? "next_inclusions" : "apply_now";
}

function parseRuleActionType(value: unknown): "create" | "remove" {
  return parseString(value).toLowerCase() === "remove" ? "remove" : "create";
}

export async function fetchAdminRulesActive(modulo: PvpsModulo = "ambos", pCd?: number | null): Promise<PvpsAdminRuleActiveRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_rules_active_list", {
    p_cd: pCd ?? null,
    p_modulo: modulo
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const raw = row as Record<string, unknown>;
    return {
      rule_id: parseString(raw.rule_id),
      cd: parseInteger(raw.cd),
      modulo: parseModulo(raw.modulo),
      rule_kind: parseRuleKind(raw.rule_kind),
      target_type: parseRuleTargetType(raw.target_type),
      target_value: parseString(raw.target_value),
      priority_value: parseNullableString(raw.priority_value) == null ? null : parseInteger(raw.priority_value),
      created_by: parseNullableString(raw.created_by),
      created_at: parseString(raw.created_at)
    };
  });
}

export async function fetchAdminRulesHistory(params?: {
  p_cd?: number | null;
  modulo?: PvpsModulo;
  limit?: number;
  offset?: number;
}): Promise<PvpsAdminRuleHistoryRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_rules_history_list", {
    p_cd: params?.p_cd ?? null,
    p_modulo: params?.modulo ?? "ambos",
    p_limit: Math.max(1, Math.min(params?.limit ?? 250, 1000)),
    p_offset: Math.max(0, params?.offset ?? 0)
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const raw = row as Record<string, unknown>;
    return {
      history_id: parseString(raw.history_id),
      rule_id: parseNullableString(raw.rule_id),
      cd: parseInteger(raw.cd),
      modulo: parseModulo(raw.modulo),
      rule_kind: parseRuleKind(raw.rule_kind),
      target_type: parseRuleTargetType(raw.target_type),
      target_value: parseString(raw.target_value),
      priority_value: parseNullableString(raw.priority_value) == null ? null : parseInteger(raw.priority_value),
      action_type: parseRuleActionType(raw.action_type),
      apply_mode: raw.apply_mode == null ? null : parseRuleApplyMode(raw.apply_mode),
      affected_pvps: Math.max(parseInteger(raw.affected_pvps), 0),
      affected_alocacao: Math.max(parseInteger(raw.affected_alocacao), 0),
      actor_user_id: parseNullableString(raw.actor_user_id),
      created_at: parseString(raw.created_at)
    };
  });
}

export async function previewAdminRuleImpact(params: {
  p_cd?: number | null;
  modulo: PvpsModulo;
  rule_kind: PvpsRuleKind;
  target_type: PvpsRuleTargetType;
  target_value: string;
  priority_value?: number | null;
}): Promise<PvpsAdminRulePreviewResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_rule_preview", {
    p_cd: params.p_cd ?? null,
    p_modulo: params.modulo,
    p_rule_kind: params.rule_kind,
    p_target_type: params.target_type,
    p_target_value: params.target_value,
    p_priority_value: params.priority_value ?? null
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao pré-visualizar impacto da regra.");
  const affectedPvps = Math.max(parseInteger(first.affected_pvps), 0);
  const affectedAlocacao = Math.max(parseInteger(first.affected_alocacao), 0);
  const affectedTotal = Math.max(parseInteger(first.affected_total, affectedPvps + affectedAlocacao), 0);
  return {
    affected_pvps: affectedPvps,
    affected_alocacao: affectedAlocacao,
    affected_total: affectedTotal
  };
}

export async function createAdminRule(params: {
  p_cd?: number | null;
  modulo: PvpsModulo;
  rule_kind: PvpsRuleKind;
  target_type: PvpsRuleTargetType;
  target_value: string;
  priority_value?: number | null;
  apply_mode: PvpsRuleApplyMode;
}): Promise<PvpsAdminRuleCreateResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_rule_create", {
    p_cd: params.p_cd ?? null,
    p_modulo: params.modulo,
    p_rule_kind: params.rule_kind,
    p_target_type: params.target_type,
    p_target_value: params.target_value,
    p_priority_value: params.priority_value ?? null,
    p_apply_mode: params.apply_mode
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao criar regra administrativa.");
  return {
    rule_id: parseString(first.rule_id),
    cd: parseInteger(first.cd),
    modulo: parseModulo(first.modulo),
    rule_kind: parseRuleKind(first.rule_kind),
    target_type: parseRuleTargetType(first.target_type),
    target_value: parseString(first.target_value),
    priority_value: parseNullableString(first.priority_value) == null ? null : parseInteger(first.priority_value),
    apply_mode: parseRuleApplyMode(first.apply_mode),
    affected_pvps: Math.max(parseInteger(first.affected_pvps), 0),
    affected_alocacao: Math.max(parseInteger(first.affected_alocacao), 0),
    created_at: parseString(first.created_at)
  };
}

export async function removeAdminRule(params: {
  p_cd?: number | null;
  rule_id: string;
}): Promise<boolean> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_rule_remove", {
    p_cd: params.p_cd ?? null,
    p_rule_id: params.rule_id
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) return false;
  return parseBoolean(first.removed);
}

export async function fetchAdminBlacklist(modulo: PvpsModulo = "ambos", pCd?: number | null): Promise<PvpsAdminBlacklistRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_blacklist_list", {
    p_cd: pCd ?? null,
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
  p_cd?: number | null;
  modulo: PvpsModulo;
  zona: string;
  coddv: number;
}): Promise<PvpsAdminBlacklistRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_blacklist_upsert", {
    p_cd: params.p_cd ?? null,
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

export async function fetchAdminPriorityZones(modulo: PvpsModulo = "ambos", pCd?: number | null): Promise<PvpsAdminPriorityZoneRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_priority_zone_list", {
    p_cd: pCd ?? null,
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
  p_cd?: number | null;
  modulo: PvpsModulo;
  zona: string;
  prioridade: number;
}): Promise<PvpsAdminPriorityZoneRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_priority_zone_upsert", {
    p_cd: params.p_cd ?? null,
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
  p_cd?: number | null;
  modulo: PvpsModulo;
  zona: string;
  repor_automatico: boolean;
}): Promise<PvpsAdminClearZoneResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_clear_zone", {
    p_cd: params.p_cd ?? null,
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
  p_cd?: number | null;
  modulo: PvpsModulo;
  zona: string;
}): Promise<PvpsAdminClearZoneResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_admin_reseed_zone", {
    p_cd: params.p_cd ?? null,
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
  p_cd?: number | null;
  audit_id: string;
  end_pul: string;
  val_pul?: string | null;
  end_sit?: PvpsEndSit | null;
}): Promise<PvpsPulSubmitResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_pvps_submit_pul", {
    p_cd: params.p_cd ?? null,
    p_audit_id: params.audit_id,
    p_end_pul: params.end_pul,
    p_val_pul: params.val_pul ?? null,
    p_end_sit: params.end_sit ?? null
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

export async function fetchAlocacaoManifest(params?: { p_cd?: number | null; zona?: string | null }): Promise<AlocacaoManifestRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const pageSize = 500;
  const rows: AlocacaoManifestRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc("rpc_alocacao_manifest_items_page", {
      p_cd: params?.p_cd ?? null,
      p_zona: params?.zona ?? null,
      p_offset: offset,
      p_limit: pageSize
    });
    if (error) throw new Error(toErrorMessage(error));
    const page = Array.isArray(data) ? data.map((row) => mapAlocacaoManifest(row as Record<string, unknown>)) : [];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

export async function submitAlocacao(params: {
  p_cd?: number | null;
  queue_id: string;
  end_sit?: PvpsEndSit | null;
  val_conf?: string | null;
}): Promise<AlocacaoSubmitResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_alocacao_submit", {
    p_cd: params.p_cd ?? null,
    p_queue_id: params.queue_id,
    p_end_sit: params.end_sit ?? null,
    p_val_conf: params.val_conf ?? null
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao salvar auditoria de alocação.");

  return {
    audit_id: parseString(first.audit_id),
    aud_sit: parseAudSit(first.aud_sit),
    val_sist: parseString(first.val_sist),
    val_conf: parseNullableString(first.val_conf)
  };
}

export async function fetchPvpsCompletedItemsDayAll(params?: {
  p_cd?: number | null;
  p_ref_date_brt?: string | null;
  pageSize?: number;
}): Promise<PvpsCompletedRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const pageSize = Math.max(1, Math.min(params?.pageSize ?? 1000, 1000));
  const rows: PvpsCompletedRow[] = [];
  let offset = 0;
  // Technical pagination to satisfy "no functional limit".
  for (;;) {
    const { data, error } = await supabase.rpc("rpc_pvps_completed_items_day", {
      p_cd: params?.p_cd ?? null,
      p_ref_date_brt: params?.p_ref_date_brt ?? null,
      p_offset: offset,
      p_limit: pageSize
    });
    if (error) throw new Error(toErrorMessage(error));
    const page = Array.isArray(data) ? data.map((row) => mapPvpsCompleted(row as Record<string, unknown>)) : [];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

export async function fetchAlocacaoCompletedItemsDayAll(params?: {
  p_cd?: number | null;
  p_ref_date_brt?: string | null;
  pageSize?: number;
}): Promise<AlocacaoCompletedRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const pageSize = Math.max(1, Math.min(params?.pageSize ?? 1000, 1000));
  const rows: AlocacaoCompletedRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc("rpc_alocacao_completed_items_day", {
      p_cd: params?.p_cd ?? null,
      p_ref_date_brt: params?.p_ref_date_brt ?? null,
      p_offset: offset,
      p_limit: pageSize
    });
    if (error) throw new Error(toErrorMessage(error));
    const page = Array.isArray(data) ? data.map((row) => mapAlocacaoCompleted(row as Record<string, unknown>)) : [];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

export async function submitAlocacaoCompletedEdit(params: {
  p_cd?: number | null;
  audit_id: string;
  end_sit?: PvpsEndSit | null;
  val_conf?: string | null;
}): Promise<AlocacaoSubmitResult> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_alocacao_edit_completed", {
    p_cd: params.p_cd ?? null,
    p_audit_id: params.audit_id,
    p_end_sit: params.end_sit ?? null,
    p_val_conf: params.val_conf ?? null
  });
  if (error) throw new Error(toErrorMessage(error));
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Error("Falha ao editar auditoria de alocação.");
  return {
    audit_id: parseString(first.audit_id),
    aud_sit: parseAudSit(first.aud_sit),
    val_sist: parseString(first.val_sist),
    val_conf: parseNullableString(first.val_conf)
  };
}
