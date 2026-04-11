import { supabase } from "../../lib/supabase";
import {
  countPendingAuditoriaCaixaRows,
  getPendingAuditoriaCaixaRows,
  removeAuditoriaCaixaRow,
  replaceDbRotasCache,
  upsertAuditoriaCaixaRow
} from "./storage";
import {
  normalizeOccurrenceInput,
  normalizeEtiquetaInput,
  normalizeKnappIdInput
} from "./logic";
import type {
  AuditoriaCaixaOccurrence,
  AuditoriaCaixaReportFilters,
  AuditoriaCaixaReportRow,
  AuditoriaCaixaRow,
  CdOption,
  DbRotasCacheRow
} from "./types";

const DB_ROTAS_PAGE_SIZE = 1000;
const DB_ROTAS_RETRY_PAGE_SIZE = 300;

type DbRotasProgress = {
  pagesFetched: number;
  rowsFetched: number;
  totalRows: number;
  percent: number;
};

function toErrorMessage(error: unknown): string {
  const rawMessage = (() => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const candidate = error as Record<string, unknown>;
      return typeof candidate.message === "string"
        ? candidate.message
        : typeof candidate.error_description === "string"
          ? candidate.error_description
          : typeof candidate.details === "string"
            ? candidate.details
            : "";
    }
    return "";
  })();

  const normalized = rawMessage.trim();
  if (!normalized) return "Erro inesperado.";
  if (/statement timeout|canceling statement/i.test(normalized)) {
    return "A consulta demorou além do limite. Tente novamente em alguns segundos.";
  }
  if (normalized.includes("AUTH_REQUIRED")) return "Sessão inválida. Faça login novamente.";
  if (normalized.includes("SESSAO_EXPIRADA")) return "Sua sessão expirou. Faça login novamente.";
  if (normalized.includes("CD_SEM_ACESSO")) return "Você não possui acesso ao CD informado.";
  if (normalized.includes("CD_OBRIGATORIO")) return "Selecione um CD antes de continuar.";
  if (normalized.includes("ETIQUETA_OBRIGATORIA")) return "Informe a etiqueta para continuar.";
  if (normalized.includes("ETIQUETA_TAMANHO_INVALIDO")) return "Etiqueta inválida. Use 17, 18, 23, 25, 26 ou 27 caracteres.";
  if (normalized.includes("ETIQUETA_INVALIDA_PREFIXO")) return "Etiqueta inválida. O primeiro caractere deve estar entre 1 e 9.";
  if (normalized.includes("ETIQUETA_INVALIDA_ANO")) return "Etiqueta inválida. O ano deve estar entre 2024 e o ano atual.";
  if (normalized.includes("PEDIDO_INVALIDO")) return "Etiqueta inválida. Não foi possível extrair o pedido.";
  if (normalized.includes("FILIAL_INVALIDA")) return "Etiqueta inválida. Não foi possível extrair a filial.";
  if (normalized.includes("ID_KNAPP_INVALIDO")) return "O ID knapp deve ter exatamente 8 dígitos.";
  if (normalized.includes("ETIQUETA_DUPLICADA_EXIGE_ID_KNAPP")) {
    return "Esta etiqueta já existe. Informe o ID knapp para diferenciar a leitura.";
  }
  if (normalized.includes("ETIQUETA_ID_KNAPP_DUPLICADO")) {
    return "Esta etiqueta com o mesmo ID knapp já foi informada anteriormente.";
  }
  if (normalized.includes("ETIQUETA_DUPLICADA")) {
    return "Esta etiqueta já foi informada anteriormente.";
  }
  if (normalized.includes("OCORRENCIA_INVALIDA")) return "Ocorrência inválida.";
  if (normalized.includes("APENAS_ADMIN")) return "Apenas administradores podem gerar este relatório.";
  if (normalized.includes("PERIODO_OBRIGATORIO")) return "Informe data inicial e final para gerar o relatório.";
  if (normalized.includes("PERIODO_INVALIDO")) return "A data final não pode ser menor que a data inicial.";
  if (normalized.includes("JANELA_MAX_31_DIAS")) return "O período máximo permitido é de 31 dias.";
  if (normalized.includes("RELATORIO_MUITO_GRANDE")) return "O relatório excede o limite de linhas. Reduza o período ou filtre por CD.";
  return normalized;
}

function isStatementTimeout(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes("statement timeout")
    || message.includes("canceling statement due to statement timeout")
    || message.includes("canceling statement");
}

function isRequiresKnappError(error: unknown): boolean {
  const message = toErrorMessage(error);
  return message.includes("ID knapp");
}

function isDiscardableDuplicateConflict(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const normalized = `${raw}\n${toErrorMessage(error)}`.toUpperCase();
  return normalized.includes("ETIQUETA_DUPLICADA")
    || normalized.includes("ETIQUETA_ID_KNAPP_DUPLICADO")
    || normalized.includes("DUPLICATE KEY VALUE")
    || normalized.includes("ESTA ETIQUETA JA FOI INFORMADA ANTERIORMENTE")
    || normalized.includes("ESTA ETIQUETA COM O MESMO ID KNAPP JA FOI INFORMADA ANTERIORMENTE");
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

function mapOccurrence(value: unknown): AuditoriaCaixaOccurrence {
  return normalizeOccurrenceInput(parseNullableString(value));
}

function mapRpcRowToAuditoriaCaixaRow(raw: Record<string, unknown>, userIdFallback = ""): AuditoriaCaixaRow {
  const id = parseNullableString(raw.id) ?? "";
  const dataHr = parseNullableString(raw.data_hr) ?? new Date().toISOString();
  const createdAt = parseNullableString(raw.created_at) ?? dataHr;
  const updatedAt = parseNullableString(raw.updated_at) ?? dataHr;

  return {
    local_id: id ? `remote:${id}` : `remote:${Date.now()}`,
    remote_id: id || null,
    user_id: parseNullableString(raw.user_id) ?? userIdFallback,
    cd: parseInteger(raw.cd),
    etiqueta: normalizeEtiquetaInput(String(raw.etiqueta ?? "")),
    id_knapp: normalizeKnappIdInput(parseNullableString(raw.id_knapp)),
    pedido: parseInteger(raw.pedido),
    data_pedido: parseNullableString(raw.data_pedido),
    dv: parseNullableString(raw.dv),
    filial: parseInteger(raw.filial),
    filial_nome: parseNullableString(raw.filial_nome),
    uf: parseNullableString(raw.uf),
    rota: parseNullableString(raw.rota),
    volume: parseNullableString(raw.volume),
    ocorrencia: mapOccurrence(raw.ocorrencia),
    mat_aud: parseNullableString(raw.mat_aud) ?? "",
    nome_aud: parseNullableString(raw.nome_aud) ?? "",
    data_hr: dataHr,
    created_at: createdAt,
    updated_at: updatedAt,
    sync_status: "synced",
    sync_error: null
  };
}

function mapRpcRowToReport(raw: Record<string, unknown>): AuditoriaCaixaReportRow {
  return {
    id: parseNullableString(raw.id) ?? "",
    etiqueta: normalizeEtiquetaInput(String(raw.etiqueta ?? "")),
    id_knapp: normalizeKnappIdInput(parseNullableString(raw.id_knapp)),
    cd: parseInteger(raw.cd),
    pedido: parseInteger(raw.pedido),
    data_pedido: parseNullableString(raw.data_pedido),
    dv: parseNullableString(raw.dv),
    filial: parseInteger(raw.filial),
    filial_nome: parseNullableString(raw.filial_nome),
    uf: parseNullableString(raw.uf),
    rota: parseNullableString(raw.rota),
    volume: parseNullableString(raw.volume),
    ocorrencia: mapOccurrence(raw.ocorrencia),
    mat_aud: parseNullableString(raw.mat_aud) ?? "",
    nome_aud: parseNullableString(raw.nome_aud) ?? "",
    user_id: parseNullableString(raw.user_id) ?? "",
    data_hr: parseNullableString(raw.data_hr) ?? "",
    created_at: parseNullableString(raw.created_at) ?? "",
    updated_at: parseNullableString(raw.updated_at) ?? ""
  };
}

function patchError(row: AuditoriaCaixaRow, message: string): AuditoriaCaixaRow {
  return {
    ...row,
    sync_status: "error",
    sync_error: message,
    updated_at: new Date().toISOString()
  };
}

function toPercent(current: number, total: number): number {
  if (total <= 0) return current > 0 ? 100 : 0;
  const ratio = Math.max(0, Math.min(1, current / total));
  return Math.round(ratio * 100);
}

export async function fetchCdOptions(): Promise<CdOption[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_cd_options");
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data
    .map((row) => {
      const cd = parseInteger((row as Record<string, unknown>).cd, Number.NaN);
      const cdNomeRaw = (row as Record<string, unknown>).cd_nome;
      const cdNome = typeof cdNomeRaw === "string" ? cdNomeRaw : `CD ${cd}`;
      if (!Number.isFinite(cd)) return null;
      return { cd, cd_nome: cdNome } satisfies CdOption;
    })
    .filter((row): row is CdOption => row != null);
}

export async function fetchDbRotasMetaRemote(cd: number): Promise<{ row_count: number; updated_max: string | null }> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_db_rotas_meta", {
    p_cd: cd
  });
  if (error) throw new Error(toErrorMessage(error));

  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return {
    row_count: parseInteger(first?.row_count, 0),
    updated_max: parseNullableString(first?.updated_max)
  };
}

async function fetchDbRotasPage(cd: number, offset: number, limit: number): Promise<DbRotasCacheRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_db_rotas_page", {
    p_cd: cd,
    p_offset: offset,
    p_limit: limit
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => {
      const raw = item as Record<string, unknown>;
      const filial = parseInteger(raw.filial, Number.NaN);
      if (!Number.isFinite(filial)) return null;
      return {
        filial,
        uf: parseNullableString(raw.uf),
        nome: parseNullableString(raw.nome),
        rota: parseNullableString(raw.rota),
        updated_at: parseNullableString(raw.updated_at)
      } satisfies DbRotasCacheRow;
    })
    .filter((item): item is DbRotasCacheRow => item != null);
}

export async function refreshDbRotasCache(
  userId: string,
  cd: number,
  onProgress?: (progress: DbRotasProgress) => void
): Promise<{ rows: number; pages: number; totalRows: number; syncedAt: string | null }> {
  const remoteMeta = await fetchDbRotasMetaRemote(cd);
  const totalRows = Math.max(remoteMeta.row_count, 0);
  let offset = 0;
  let pageSize = DB_ROTAS_PAGE_SIZE;
  let retriedWithSmallerPage = false;
  let pages = 0;
  const allRows: DbRotasCacheRow[] = [];

  while (true) {
    try {
      const page = await fetchDbRotasPage(cd, offset, pageSize);
      if (page.length === 0) break;

      allRows.push(...page);
      pages += 1;
      offset += page.length;
      onProgress?.({
        pagesFetched: pages,
        rowsFetched: allRows.length,
        totalRows,
        percent: toPercent(allRows.length, totalRows)
      });
    } catch (error) {
      if (isStatementTimeout(error) && !retriedWithSmallerPage && pageSize > DB_ROTAS_RETRY_PAGE_SIZE) {
        retriedWithSmallerPage = true;
        pageSize = DB_ROTAS_RETRY_PAGE_SIZE;
        offset = 0;
        pages = 0;
        allRows.length = 0;
        continue;
      }
      throw error;
    }
  }

  await replaceDbRotasCache({
    user_id: userId,
    cd,
    rows: allRows,
    synced_at: remoteMeta.updated_max
  });

  return {
    rows: allRows.length,
    pages,
    totalRows,
    syncedAt: remoteMeta.updated_max
  };
}

export async function fetchTodaySharedAuditoriaCaixaRows(cd: number, limit = 1200): Promise<AuditoriaCaixaRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_aud_caixa_today", {
    p_cd: cd,
    p_limit: limit
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => mapRpcRowToAuditoriaCaixaRow(item as Record<string, unknown>))
    .filter((item) => item.remote_id != null);
}

async function syncInsert(row: AuditoriaCaixaRow): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_aud_caixa_insert", {
    p_cd: row.cd,
    p_etiqueta: row.etiqueta,
    p_id_knapp: row.id_knapp,
    p_ocorrencia: row.ocorrencia,
    p_data_hr: row.data_hr
  });
  if (error) throw new Error(toErrorMessage(error));

  const first = Array.isArray(data) ? data[0] : null;
  if (!first || typeof first !== "object") {
    throw new Error("Resposta inválida ao inserir auditoria de caixa.");
  }
}

async function syncUpdate(row: AuditoriaCaixaRow): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  if (!row.remote_id) {
    await syncInsert(row);
    return;
  }

  const { data, error } = await supabase.rpc("rpc_aud_caixa_update", {
    p_id: row.remote_id,
    p_etiqueta: row.etiqueta,
    p_id_knapp: row.id_knapp,
    p_ocorrencia: row.ocorrencia
  });
  if (error) throw new Error(toErrorMessage(error));

  const first = Array.isArray(data) ? data[0] : null;
  if (!first || typeof first !== "object") {
    throw new Error("Resposta inválida ao atualizar auditoria de caixa.");
  }
}

async function syncDelete(row: AuditoriaCaixaRow): Promise<void> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  if (!row.remote_id) {
    await removeAuditoriaCaixaRow(row.local_id);
    return;
  }

  const { data, error } = await supabase.rpc("rpc_aud_caixa_delete", {
    p_id: row.remote_id
  });
  if (error) throw new Error(toErrorMessage(error));
  if (data !== true) throw new Error("Registro não encontrado para exclusão.");

  await removeAuditoriaCaixaRow(row.local_id);
}

export async function syncPendingAuditoriaCaixaRows(userId: string): Promise<{
  processed: number;
  synced: number;
  failed: number;
  pending: number;
  discarded: number;
}> {
  const pendingRows = await getPendingAuditoriaCaixaRows(userId);
  let synced = 0;
  let failed = 0;
  let discarded = 0;

  for (const row of pendingRows) {
    try {
      if (row.sync_status === "pending_delete") {
        await syncDelete(row);
      } else if (row.sync_status === "pending_update") {
        await syncUpdate(row);
        await removeAuditoriaCaixaRow(row.local_id);
      } else {
        await syncInsert(row);
        await removeAuditoriaCaixaRow(row.local_id);
      }
      synced += 1;
    } catch (error) {
      if (!row.remote_id && !isRequiresKnappError(error) && isDiscardableDuplicateConflict(error)) {
        await removeAuditoriaCaixaRow(row.local_id);
        discarded += 1;
        continue;
      }

      failed += 1;
      await upsertAuditoriaCaixaRow(patchError(row, toErrorMessage(error)));
    }
  }

  const pending = await countPendingAuditoriaCaixaRows(userId);
  return {
    processed: pendingRows.length,
    synced,
    failed,
    pending,
    discarded
  };
}

export async function countAuditoriaCaixaReportRows(filters: AuditoriaCaixaReportFilters): Promise<number> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_aud_caixa_report_count", {
    p_dt_ini: filters.dtIni,
    p_dt_fim: filters.dtFim,
    p_cd: filters.cd
  });
  if (error) throw new Error(toErrorMessage(error));

  return parseInteger(data, 0);
}

export async function fetchAuditoriaCaixaReportRows(
  filters: AuditoriaCaixaReportFilters,
  limit = 20000
): Promise<AuditoriaCaixaReportRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");

  const { data, error } = await supabase.rpc("rpc_aud_caixa_report_rows", {
    p_dt_ini: filters.dtIni,
    p_dt_fim: filters.dtFim,
    p_cd: filters.cd,
    p_limit: limit
  });
  if (error) throw new Error(toErrorMessage(error));
  if (!Array.isArray(data)) return [];

  return data.map((item) => mapRpcRowToReport(item as Record<string, unknown>));
}
