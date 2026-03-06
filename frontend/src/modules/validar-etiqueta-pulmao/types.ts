export interface ValidarEtiquetaPulmaoModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface ValidarEtiquetaPulmaoPreferences {
  prefer_offline_mode: boolean;
}

export interface ValidarEtiquetaPulmaoLookupResult {
  cd: number;
  coddv: number;
  descricao: string;
  barras: string;
  barras_lista: string[];
}

export interface ValidarEtiquetaPulmaoAuditPayload {
  cd: number;
  codigo_interno: number;
  barras: string;
  coddv_resolvido: number | null;
  descricao: string | null;
  validado: boolean;
  data_hr?: string | null;
}

export interface ValidarEtiquetaPulmaoPendingAuditRow {
  local_id: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
  payload: ValidarEtiquetaPulmaoAuditPayload;
}
