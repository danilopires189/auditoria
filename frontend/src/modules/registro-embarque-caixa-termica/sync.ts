import { supabase } from "../../lib/supabase";
import {
  countPendingCaixaTermicaBoxes,
  getCaixaTermicaBoxByCodigo,
  getPendingCaixaTermicaBoxes,
  upsertCaixaTermicaBox,
  upsertCaixaTermicaMov
} from "./storage";
import type {
  CaixaTermicaBox,
  CaixaTermicaFeedRow,
  CaixaTermicaMov,
  CaixaTermicaTipoMov
} from "./types";

// ── Error handling ───────────────────────────────────────────

function toErrorMessage(error: unknown): string {
  const mapCode = (raw: string): string => {
    const n = raw.trim().toUpperCase();
    if (n.includes("AUTH_REQUIRED")) return "Sessão inválida. Faça login novamente.";
    if (n.includes("SESSAO_EXPIRADA")) return "Sessão expirada. Faça login novamente.";
    if (n.includes("CD_NAO_DEFINIDO_USUARIO")) return "CD não definido para este usuário.";
    if (n.includes("CAIXA_JA_CADASTRADA")) return "Já existe uma caixa com este código neste CD.";
    if (n.includes("CAIXA_NAO_ENCONTRADA")) return "Caixa não encontrada neste CD.";
    if (n.includes("CAIXA_NAO_DISPONIVEL")) return "Esta caixa não está disponível para expedição.";
    if (n.includes("CAIXA_NAO_EM_TRANSITO")) return "Esta caixa não está em trânsito para recebimento.";
    if (n.includes("CODIGO_OBRIGATORIO")) return "O código da caixa é obrigatório.";
    if (n.includes("DESCRICAO_OBRIGATORIA")) return "A descrição da caixa é obrigatória.";
    if (n.includes("CAIXA_ID_OBRIGATORIO")) return "ID da caixa não informado.";
    if (/statement timeout|canceling statement/i.test(raw)) {
      return "A consulta demorou além do limite. Tente novamente em instantes.";
    }
    return raw;
  };

  if (error instanceof Error) return mapCode(error.message);
  if (typeof error === "string") return mapCode(error);
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    const rawMessage = typeof candidate.message === "string"
      ? candidate.message
      : typeof candidate.error_description === "string"
        ? candidate.error_description
        : typeof candidate.details === "string"
          ? candidate.details
          : "";
    if (rawMessage) return mapCode(rawMessage);
  }
  return "Erro inesperado.";
}

// ── Row mappers ──────────────────────────────────────────────

function parseString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function parseNullableString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableInteger(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTipoMov(value: unknown): CaixaTermicaTipoMov | null {
  return value === "expedicao" || value === "recebimento" ? value : null;
}

function mapRpcBoxRow(raw: Record<string, unknown>): CaixaTermicaBox {
  const remoteId = parseNullableString(raw.id);
  return {
    id: parseString(raw.id),
    local_id: remoteId ? `remote:${remoteId}` : `local:${String(Date.now())}`,
    remote_id: remoteId,
    cd: parseInteger(raw.cd),
    codigo: parseString(raw.codigo).toUpperCase(),
    descricao: parseString(raw.descricao),
    observacoes: parseNullableString(raw.observacoes),
    status: raw.status === "em_transito" ? "em_transito" : "disponivel",
    created_at: parseString(raw.created_at),
    created_by: parseString(raw.created_by),
    updated_at: parseString(raw.updated_at),
    sync_status: "synced",
    sync_error: null,
    last_mov_tipo: parseTipoMov(raw.last_mov_tipo),
    last_mov_data_hr: parseNullableString(raw.last_mov_data_hr),
    last_mov_placa: parseNullableString(raw.last_mov_placa),
    last_mov_rota: parseNullableString(raw.last_mov_rota),
    last_mov_filial: parseNullableInteger(raw.last_mov_filial),
    last_mov_filial_nome: parseNullableString(raw.last_mov_filial_nome)
  };
}

function mapRpcMovRow(raw: Record<string, unknown>): CaixaTermicaMov {
  return {
    id: parseString(raw.id),
    caixa_id: parseString(raw.caixa_id),
    tipo: raw.tipo === "expedicao" ? "expedicao" : "recebimento",
    cd: parseInteger(raw.cd),
    etiqueta_volume: parseNullableString(raw.etiqueta_volume),
    filial: parseNullableInteger(raw.filial),
    filial_nome: parseNullableString(raw.filial_nome),
    rota: parseNullableString(raw.rota),
    placa: parseNullableString(raw.placa),
    obs_recebimento: parseNullableString(raw.obs_recebimento),
    mat_resp: parseString(raw.mat_resp),
    nome_resp: parseString(raw.nome_resp),
    data_hr: parseString(raw.data_hr),
    created_at: parseString(raw.created_at),
    transit_minutes: null
  };
}

function computeTransitMinutes(movs: CaixaTermicaMov[]): CaixaTermicaMov[] {
  return movs.map((mov, idx) => {
    if (mov.tipo !== "recebimento") return mov;
    // Find the last expedition before this reception
    const prevExpedicao = [...movs].slice(0, idx).reverse().find((m) => m.tipo === "expedicao");
    if (!prevExpedicao) return mov;
    const diffMs = Date.parse(mov.data_hr) - Date.parse(prevExpedicao.data_hr);
    if (!Number.isFinite(diffMs) || diffMs < 0) return mov;
    return { ...mov, transit_minutes: Math.round(diffMs / 60_000) };
  });
}

// ── Public API ───────────────────────────────────────────────

export async function fetchAndCacheCaixaTermicaBoxes(
  userId: string,
  cd: number
): Promise<CaixaTermicaBox[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_caixa_termica_list", { p_cd: cd });
  if (error) throw new Error(toErrorMessage(error));

  const rows = Array.isArray(data)
    ? (data as Record<string, unknown>[]).map(mapRpcBoxRow)
    : [];

  // Upsert into local cache
  await Promise.all(rows.map((box) => upsertCaixaTermicaBox(box)));
  return rows;
}

export async function lookupCaixaTermicaByCodigo(
  userId: string,
  cd: number,
  codigo: string,
  isOnline: boolean
): Promise<CaixaTermicaBox | null> {
  // Try local first
  const local = await getCaixaTermicaBoxByCodigo(userId, cd, codigo);
  if (local) return local;

  // Remote fallback
  if (!isOnline) return null;

  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_caixa_termica_by_codigo", {
    p_cd: cd,
    p_codigo: codigo
  });
  if (error) throw new Error(toErrorMessage(error));

  const rows = Array.isArray(data)
    ? (data as Record<string, unknown>[]).map(mapRpcBoxRow)
    : [];

  if (rows.length === 0) return null;

  const box = rows[0];
  await upsertCaixaTermicaBox(box);
  return box;
}

export async function rpcInsertCaixaTermica(params: {
  cd: number;
  codigo: string;
  descricao: string;
  observacoes: string | null;
  userId: string;
  mat: string;
  nome: string;
}): Promise<CaixaTermicaBox> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_caixa_termica_insert", {
    p_cd: params.cd,
    p_codigo: params.codigo,
    p_descricao: params.descricao,
    p_observacoes: params.observacoes,
    p_user_id: params.userId,
    p_mat: params.mat,
    p_nome: params.nome
  });

  if (error) throw new Error(toErrorMessage(error));

  const rows = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : [];
  if (rows.length === 0) throw new Error("Nenhum dado retornado pelo servidor.");

  const raw = rows[0];
  const box: CaixaTermicaBox = {
    id: parseString(raw.id),
    local_id: `remote:${parseString(raw.id)}`,
    remote_id: parseString(raw.id),
    cd: parseInteger(raw.cd),
    codigo: parseString(raw.codigo).toUpperCase(),
    descricao: parseString(raw.descricao),
    observacoes: parseNullableString(raw.observacoes),
    status: "disponivel",
    created_at: parseString(raw.created_at),
    created_by: params.userId,
    updated_at: parseString(raw.updated_at),
    sync_status: "synced",
    sync_error: null,
    last_mov_tipo: null,
    last_mov_data_hr: null,
    last_mov_placa: null,
    last_mov_rota: null,
    last_mov_filial: null,
    last_mov_filial_nome: null
  };

  await upsertCaixaTermicaBox(box);
  return box;
}

export async function rpcExpedirCaixaTermica(params: {
  caixaId: string;
  cd: number;
  etiquetaVolume: string | null;
  filial: number | null;
  filialNome: string | null;
  rota: string | null;
  placa: string;
  mat: string;
  nome: string;
  userId: string;
}): Promise<{ box: CaixaTermicaBox; mov: CaixaTermicaMov }> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_caixa_termica_expedir", {
    p_caixa_id: params.caixaId,
    p_cd: params.cd,
    p_etiqueta_volume: params.etiquetaVolume,
    p_filial: params.filial,
    p_filial_nome: params.filialNome,
    p_rota: params.rota,
    p_placa: params.placa,
    p_user_id: params.userId,
    p_mat: params.mat,
    p_nome: params.nome
  });

  if (error) throw new Error(toErrorMessage(error));

  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  if (rows.length === 0) throw new Error("Nenhum dado retornado pelo servidor.");

  const raw = rows[0];

  const box: CaixaTermicaBox = {
    id: parseString(raw.box_id),
    local_id: `remote:${parseString(raw.box_id)}`,
    remote_id: parseString(raw.box_id),
    cd: params.cd,
    codigo: parseString(raw.box_codigo).toUpperCase(),
    descricao: "",
    observacoes: null,
    status: "em_transito",
    created_at: "",
    created_by: params.userId,
    updated_at: parseString(raw.box_updated_at),
    sync_status: "synced",
    sync_error: null,
    last_mov_tipo: "expedicao",
    last_mov_data_hr: parseNullableString(raw.mov_data_hr),
    last_mov_placa: parseNullableString(raw.mov_placa),
    last_mov_rota: parseNullableString(raw.mov_rota),
    last_mov_filial: parseNullableInteger(raw.mov_filial),
    last_mov_filial_nome: parseNullableString(raw.mov_filial_nome)
  };

  const mov: CaixaTermicaMov = {
    id: parseString(raw.mov_id),
    caixa_id: params.caixaId,
    tipo: "expedicao",
    cd: params.cd,
    etiqueta_volume: parseNullableString(raw.mov_etiqueta_volume),
    filial: parseNullableInteger(raw.mov_filial),
    filial_nome: parseNullableString(raw.mov_filial_nome),
    rota: parseNullableString(raw.mov_rota),
    placa: parseNullableString(raw.mov_placa),
    obs_recebimento: null,
    mat_resp: params.mat,
    nome_resp: params.nome,
    data_hr: parseString(raw.mov_data_hr),
    created_at: parseString(raw.mov_data_hr),
    transit_minutes: null
  };

  await Promise.all([
    upsertCaixaTermicaBox(box),
    upsertCaixaTermicaMov(mov)
  ]);

  return { box, mov };
}

export async function rpcReceberCaixaTermica(params: {
  caixaId: string;
  cd: number;
  obsRecebimento: string | null;
  mat: string;
  nome: string;
  userId: string;
}): Promise<{ box: CaixaTermicaBox; mov: CaixaTermicaMov }> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_caixa_termica_receber", {
    p_caixa_id: params.caixaId,
    p_cd: params.cd,
    p_obs_recebimento: params.obsRecebimento,
    p_user_id: params.userId,
    p_mat: params.mat,
    p_nome: params.nome
  });

  if (error) throw new Error(toErrorMessage(error));

  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  if (rows.length === 0) throw new Error("Nenhum dado retornado pelo servidor.");

  const raw = rows[0];

  const box: CaixaTermicaBox = {
    id: parseString(raw.box_id),
    local_id: `remote:${parseString(raw.box_id)}`,
    remote_id: parseString(raw.box_id),
    cd: params.cd,
    codigo: parseString(raw.box_codigo).toUpperCase(),
    descricao: "",
    observacoes: null,
    status: "disponivel",
    created_at: "",
    created_by: params.userId,
    updated_at: parseString(raw.box_updated_at),
    sync_status: "synced",
    sync_error: null,
    last_mov_tipo: "recebimento",
    last_mov_data_hr: parseNullableString(raw.mov_data_hr),
    last_mov_placa: null,
    last_mov_rota: null,
    last_mov_filial: null,
    last_mov_filial_nome: null
  };

  const mov: CaixaTermicaMov = {
    id: parseString(raw.mov_id),
    caixa_id: params.caixaId,
    tipo: "recebimento",
    cd: params.cd,
    etiqueta_volume: null,
    filial: null,
    filial_nome: null,
    rota: null,
    placa: null,
    obs_recebimento: params.obsRecebimento,
    mat_resp: params.mat,
    nome_resp: params.nome,
    data_hr: parseString(raw.mov_data_hr),
    created_at: parseString(raw.mov_data_hr),
    transit_minutes: null
  };

  await Promise.all([
    upsertCaixaTermicaBox(box),
    upsertCaixaTermicaMov(mov)
  ]);

  return { box, mov };
}

export async function fetchCaixaTermicaHistorico(
  caixaId: string
): Promise<CaixaTermicaMov[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data, error } = await supabase.rpc("rpc_caixa_termica_historico", {
    p_caixa_id: caixaId
  });
  if (error) throw new Error(toErrorMessage(error));

  const rows = Array.isArray(data)
    ? (data as Record<string, unknown>[]).map(mapRpcMovRow)
    : [];

  const withTransit = computeTransitMinutes(rows);

  await Promise.all(withTransit.map((mov) => upsertCaixaTermicaMov(mov)));
  return withTransit;
}

export async function fetchCaixaTermicaFeedDiario(
  cd: number,
  data: string
): Promise<CaixaTermicaFeedRow[]> {
  if (!supabase) throw new Error("Supabase não inicializado.");
  const { data: rpcData, error } = await supabase.rpc("rpc_caixa_termica_feed_diario", {
    p_cd: cd,
    p_data: data
  });
  if (error) throw new Error(toErrorMessage(error));

  if (!Array.isArray(rpcData)) return [];

  return (rpcData as Record<string, unknown>[]).map((row) => {
    const caixasRaw = row.caixas;
    const caixas = Array.isArray(caixasRaw)
      ? (caixasRaw as Record<string, unknown>[]).map((c) => ({
          codigo: parseString(c.codigo),
          tipo: (c.tipo === "expedicao" ? "expedicao" : "recebimento") as CaixaTermicaTipoMov,
          data_hr: parseString(c.data_hr)
        }))
      : [];

    return {
      rota: parseNullableString(row.rota),
      filial: parseNullableInteger(row.filial),
      filial_nome: parseNullableString(row.filial_nome),
      expedicoes: parseInteger(row.expedicoes),
      recebimentos: parseInteger(row.recebimentos),
      ultimo_mov: parseNullableString(row.ultimo_mov),
      caixas
    };
  });
}

export async function syncPendingCaixaTermicaBoxes(
  userId: string
): Promise<{ processed: number; synced: number; failed: number; pending: number }> {
  const pending = await getPendingCaixaTermicaBoxes(userId);

  let synced = 0;
  let failed = 0;

  for (const box of pending) {
    try {
      if (!supabase) throw new Error("Supabase não inicializado.");
      const { data, error } = await supabase.rpc("rpc_caixa_termica_insert", {
        p_cd: box.cd,
        p_codigo: box.codigo,
        p_descricao: box.descricao,
        p_observacoes: box.observacoes,
        p_user_id: userId,
        p_mat: "",
        p_nome: ""
      });

      if (error) {
        const msg = toErrorMessage(error);
        // Already registered remotely — mark as synced
        if (msg.includes("Já existe uma caixa")) {
          await upsertCaixaTermicaBox({ ...box, sync_status: "synced", sync_error: null });
          synced++;
        } else {
          await upsertCaixaTermicaBox({ ...box, sync_status: "error", sync_error: msg });
          failed++;
        }
        continue;
      }

      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      if (rows.length > 0) {
        const syncedBox = mapRpcBoxRow(rows[0]);
        await upsertCaixaTermicaBox({ ...syncedBox, local_id: box.local_id });
      } else {
        await upsertCaixaTermicaBox({ ...box, sync_status: "synced", sync_error: null });
      }
      synced++;
    } catch (err) {
      const msg = toErrorMessage(err);
      await upsertCaixaTermicaBox({ ...box, sync_status: "error", sync_error: msg });
      failed++;
    }
  }

  const remainingPending = await countPendingCaixaTermicaBoxes(userId);

  return {
    processed: pending.length,
    synced,
    failed,
    pending: remainingPending
  };
}
