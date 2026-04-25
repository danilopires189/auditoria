export type ClvEtapa = "recebimento_cd" | "entrada_galpao" | "saida_galpao" | "entrega_filial";
export type ClvStageEtapa = Exclude<ClvEtapa, "recebimento_cd">;
export type ClvSyncStatus = "pending" | "error";
export type ClvFracionadoTipo = "pedido_direto" | "termolabeis";

export interface ControleLogisticoVolumeModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface CdOption {
  cd: number;
  cd_nome: string;
}

export interface ClvParsedEtiqueta {
  etiqueta: string;
  id_knapp: string | null;
  length: 17 | 18 | 23 | 25 | 26 | 27;
  pedido: number;
  data_pedido: string | null;
  dv: string | null;
  filial: number;
  volume: string | null;
  volume_key: string;
}

export interface ClvMovimento {
  mov_id: string;
  etapa: ClvEtapa;
  etiqueta: string;
  id_knapp: string | null;
  volume: string | null;
  volume_key: string;
  fracionado: boolean;
  fracionado_qtd: number | null;
  fracionado_tipo: ClvFracionadoTipo | null;
  mat_operador: string;
  nome_operador: string;
  data_hr: string;
  is_local?: boolean;
}

export interface ClvFeedRow {
  lote_id: string;
  cd: number;
  pedido: number;
  data_pedido: string | null;
  dv: string | null;
  filial: number;
  filial_nome: string | null;
  rota: string | null;
  volume_total_informado: number;
  recebido_count: number;
  entrada_count: number;
  saida_count: number;
  entrega_count: number;
  pendente_recebimento: number;
  pendente_entrada: number;
  pendente_saida: number;
  pendente_entrega: number;
  updated_at: string;
  movimentos: ClvMovimento[];
  is_local?: boolean;
}

export interface ClvRecebimentoPayload {
  cd: number;
  etiqueta: string;
  id_knapp: string | null;
  volume_total_informado: number;
  fracionado: boolean;
  fracionado_qtd: number | null;
  fracionado_tipo: ClvFracionadoTipo | null;
  data_hr: string;
}

export interface ClvStagePayload {
  cd: number;
  etapa: ClvStageEtapa;
  etiqueta: string;
  id_knapp: string | null;
  lote_id: string | null;
  data_hr: string;
}

export type ClvPendingOperation =
  | {
      local_id: string;
      user_id: string;
      kind: "recebimento";
      payload: ClvRecebimentoPayload;
      parsed: ClvParsedEtiqueta;
      sync_status: ClvSyncStatus;
      sync_error: string | null;
      created_at: string;
      updated_at: string;
    }
  | {
      local_id: string;
      user_id: string;
      kind: "stage";
      payload: ClvStagePayload;
      parsed: ClvParsedEtiqueta;
      sync_status: ClvSyncStatus;
      sync_error: string | null;
      created_at: string;
      updated_at: string;
    };

export interface ClvPreferences {
  cd_ativo: number | null;
  prefer_offline_mode: boolean;
}

export interface ClvPendingSummary {
  pending_count: number;
  error_count: number;
}
