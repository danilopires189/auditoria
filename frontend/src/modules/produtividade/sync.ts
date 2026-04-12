import { supabase } from "../../lib/supabase";
import type {
  ProdutividadeActivityTotalRow,
  ProdutividadeCollaboratorRow,
  ProdutividadeDailyRow,
  ProdutividadeEntryRow,
  ProdutividadeRankingRow,
  ProdutividadeVisibilityMode,
  ProdutividadeVisibilityRow
} from "./types";

function toErrorMessage(error: unknown): string {
  const mapCode = (raw: string): string => {
    const normalized = raw.trim().toUpperCase();
    if (normalized.includes("AUTH_REQUIRED")) return "Sessão inválida. Faça login novamente.";
    if (normalized.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Faça login novamente.";
    if (normalized.includes("CD_NAO_DEFINIDO_USUARIO")) return "CD não definido para este usuário.";
    if (normalized.includes("CD_SEM_ACESSO")) return "Sem acesso ao CD selecionado.";
    if (normalized.includes("PROFILE_NAO_ENCONTRADO")) return "Perfil do usuário não encontrado.";
    if (normalized.includes("APENAS_ADMIN")) return "Apenas admin pode alterar a visibilidade.";
    if (normalized.includes("VISIBILIDADE_INVALIDA")) return "Modo de visibilidade inválido.";
    if (normalized.includes("SEM_PERMISSAO_VISUALIZAR_COLABORADOR")) return "Sem permissão para visualizar este colaborador.";
    if (normalized.includes("ATIVIDADE_INVALIDA")) return "Atividade inválida para filtro.";
    return raw;
  };

  if (error instanceof Error) return mapCode(error.message);
  if (typeof error === "string") return mapCode(error);
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.message === "string") return mapCode(candidate.message);
    if (typeof candidate.error_description === "string") return mapCode(candidate.error_description);
    if (typeof candidate.details === "string") return mapCode(candidate.details);
  }
  return "Erro inesperado.";
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumber(value: unknown, fallback = 0): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

function parseVisibility(value: unknown): ProdutividadeVisibilityMode {
  return String(value) === "owner_only" ? "owner_only" : "public_cd";
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data)) return null;
  const row = data[0];
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

function mapVisibilityRow(raw: Record<string, unknown>): ProdutividadeVisibilityRow {
  return {
    cd: parseInteger(raw.cd),
    visibility_mode: parseVisibility(raw.visibility_mode),
    updated_by: parseNullableString(raw.updated_by),
    updated_at: parseNullableString(raw.updated_at)
  };
}

function mapCollaboratorRow(raw: Record<string, unknown>): ProdutividadeCollaboratorRow {
  return {
    user_id: parseString(raw.user_id),
    mat: parseString(raw.mat),
    nome: parseString(raw.nome),
    registros_count: parseInteger(raw.registros_count),
    dias_ativos: parseInteger(raw.dias_ativos),
    atividades_count: parseInteger(raw.atividades_count),
    valor_total: parseNumber(raw.valor_total)
  };
}

function mapActivityTotalRow(raw: Record<string, unknown>): ProdutividadeActivityTotalRow {
  return {
    sort_order: parseInteger(raw.sort_order),
    activity_key: parseString(raw.activity_key),
    activity_label: parseString(raw.activity_label),
    unit_label: parseString(raw.unit_label),
    registros_count: parseInteger(raw.registros_count),
    valor_total: parseNumber(raw.valor_total),
    last_event_date: parseNullableString(raw.last_event_date)
  };
}

function mapDailyRow(raw: Record<string, unknown>): ProdutividadeDailyRow {
  return {
    date_ref: parseString(raw.date_ref),
    activity_key: parseString(raw.activity_key),
    activity_label: parseString(raw.activity_label),
    unit_label: parseString(raw.unit_label),
    registros_count: parseInteger(raw.registros_count),
    valor_total: parseNumber(raw.valor_total)
  };
}

function mapRankingRow(raw: Record<string, unknown>): ProdutividadeRankingRow {
  return {
    user_id: parseString(raw.user_id),
    mat: parseString(raw.mat),
    nome: parseString(raw.nome),
    posicao: parseInteger(raw.posicao),
    pvps_pontos: parseNumber(raw.pvps_pontos),
    pvps_qtd: parseNumber(raw.pvps_qtd),
    vol_pontos: parseNumber(raw.vol_pontos),
    vol_qtd: parseNumber(raw.vol_qtd),
    blitz_pontos: parseNumber(raw.blitz_pontos),
    blitz_qtd: parseNumber(raw.blitz_qtd),
    zerados_pontos: parseNumber(raw.zerados_pontos),
    zerados_qtd: parseNumber(raw.zerados_qtd),
    atividade_extra_pontos: parseNumber(raw.atividade_extra_pontos),
    atividade_extra_qtd: parseNumber(raw.atividade_extra_qtd),
    alocacao_pontos: parseNumber(raw.alocacao_pontos),
    alocacao_qtd: parseNumber(raw.alocacao_qtd),
    devolucao_pontos: parseNumber(raw.devolucao_pontos),
    devolucao_qtd: parseNumber(raw.devolucao_qtd),
    conf_termo_pontos: parseNumber(raw.conf_termo_pontos),
    conf_termo_qtd: parseNumber(raw.conf_termo_qtd),
    conf_avulso_pontos: parseNumber(raw.conf_avulso_pontos),
    conf_avulso_qtd: parseNumber(raw.conf_avulso_qtd),
    conf_entrada_pontos: parseNumber(raw.conf_entrada_pontos),
    conf_entrada_qtd: parseNumber(raw.conf_entrada_qtd),
    conf_transferencia_cd_pontos: parseNumber(raw.conf_transferencia_cd_pontos),
    conf_transferencia_cd_qtd: parseNumber(raw.conf_transferencia_cd_qtd),
    conf_lojas_pontos: parseNumber(raw.conf_lojas_pontos),
    conf_lojas_qtd: parseNumber(raw.conf_lojas_qtd),
    aud_caixa_pontos: parseNumber(raw.aud_caixa_pontos),
    aud_caixa_qtd: parseNumber(raw.aud_caixa_qtd),
    ronda_quality_pontos: parseNumber(raw.ronda_quality_pontos),
    ronda_quality_qtd: parseNumber(raw.ronda_quality_qtd),
    total_pontos: parseNumber(raw.total_pontos)
  };
}

function mapEntryRow(raw: Record<string, unknown>): ProdutividadeEntryRow {
  return {
    entry_id: parseString(raw.entry_id),
    event_at: parseNullableString(raw.event_at),
    event_date: parseString(raw.event_date),
    activity_key: parseString(raw.activity_key),
    activity_label: parseString(raw.activity_label),
    unit_label: parseString(raw.unit_label),
    metric_value: parseNumber(raw.metric_value),
    detail: parseString(raw.detail),
    source_ref: parseNullableString(raw.source_ref)
  };
}

export async function fetchProdutividadeVisibility(cd: number | null): Promise<ProdutividadeVisibilityRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_produtividade_visibility_get", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao carregar visibilidade.");
  return mapVisibilityRow(row);
}

export async function setProdutividadeVisibility(cd: number, visibilityMode: ProdutividadeVisibilityMode): Promise<ProdutividadeVisibilityRow> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_produtividade_visibility_set", {
    p_cd: cd,
    p_visibility_mode: visibilityMode
  });
  if (error) throw new Error(toErrorMessage(error));

  const row = firstRow(data);
  if (!row) throw new Error("Falha ao atualizar visibilidade.");
  return mapVisibilityRow(row);
}

export async function fetchProdutividadeCollaborators(params: {
  cd: number | null;
  dtIni: string | null;
  dtFim: string | null;
}): Promise<ProdutividadeCollaboratorRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_produtividade_collaborators", {
    p_cd: params.cd,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapCollaboratorRow(row as Record<string, unknown>));
}

export async function fetchProdutividadeActivityTotals(params: {
  cd: number | null;
  targetUserId: string | null;
  dtIni: string | null;
  dtFim: string | null;
}): Promise<ProdutividadeActivityTotalRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_produtividade_activity_totals", {
    p_cd: params.cd,
    p_target_user_id: params.targetUserId,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapActivityTotalRow(row as Record<string, unknown>));
}

export async function fetchProdutividadeDaily(params: {
  cd: number | null;
  targetUserId: string | null;
  dtIni: string | null;
  dtFim: string | null;
}): Promise<ProdutividadeDailyRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_produtividade_daily", {
    p_cd: params.cd,
    p_target_user_id: params.targetUserId,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapDailyRow(row as Record<string, unknown>));
}

export async function fetchProdutividadeEntries(params: {
  cd: number | null;
  targetUserId: string | null;
  dtIni: string | null;
  dtFim: string | null;
  activityKey: string | null;
  limit?: number;
}): Promise<ProdutividadeEntryRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_produtividade_entries", {
    p_cd: params.cd,
    p_target_user_id: params.targetUserId,
    p_dt_ini: params.dtIni,
    p_dt_fim: params.dtFim,
    p_activity_key: params.activityKey,
    p_limit: params.limit ?? 400
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapEntryRow(row as Record<string, unknown>));
}

export async function fetchProdutividadeRanking(params: {
  cd: number | null;
  mes: number | null;
  ano: number | null;
}): Promise<ProdutividadeRankingRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_produtividade_ranking", {
    p_cd: params.cd,
    p_mes: params.mes,
    p_ano: params.ano
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((row) => mapRankingRow(row as Record<string, unknown>));
}
