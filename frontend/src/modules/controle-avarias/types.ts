export type ControleAvariasSyncStatus = "pending_insert" | "pending_update" | "pending_delete" | "synced" | "error";

export type ControleAvariasMotivo = string;
export type ControleAvariasOrigem = "Blitz" | "Entrada" | "Expedição" | "Pulmão" | "Separação";
export type ControleAvariasSituacao =
  | "Amassado"
  | "Furado"
  | "Manchado"
  | "Molhado"
  | "Quebrado"
  | "Rasgado"
  | "Vazando"
  | "Vazio";

export interface ControleAvariasModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface DbBarrasCacheRow {
  barras: string;
  coddv: number;
  descricao: string;
  updated_at: string | null;
}

export interface ControleAvariasRow {
  local_id: string;
  remote_id: string | null;
  user_id: string;
  etiqueta: string | null;
  cd: number;
  barras: string;
  coddv: number;
  descricao: string;
  qtd: number;
  motivo: ControleAvariasMotivo;
  situacao: ControleAvariasSituacao | null;
  origem: ControleAvariasOrigem;
  lote: string | null;
  val_mmaa: string | null;
  mat_aud: string;
  nome_aud: string;
  data_hr: string;
  created_at: string;
  updated_at: string;
  sync_status: ControleAvariasSyncStatus;
  sync_error: string | null;
}

export interface ControleAvariasPreferences {
  multiplo_padrao: number;
  cd_ativo: number | null;
  prefer_offline_mode: boolean;
}

export interface DbBarrasSyncMeta {
  last_sync_at: string | null;
  row_count: number;
}

export interface CdOption {
  cd: number;
  cd_nome: string;
}

export interface ControleAvariasReportFilters {
  dtIni: string;
  dtFim: string;
  cd: number | null;
}

export interface ControleAvariasReportRow {
  id: string;
  etiqueta: string | null;
  cd: number;
  barras: string;
  coddv: number;
  descricao: string;
  qtd: number;
  motivo: ControleAvariasMotivo;
  situacao: ControleAvariasSituacao | null;
  origem: ControleAvariasOrigem;
  lote: string | null;
  val_mmaa: string | null;
  mat_aud: string;
  nome_aud: string;
  user_id: string;
  data_hr: string;
  created_at: string;
  updated_at: string;
}


