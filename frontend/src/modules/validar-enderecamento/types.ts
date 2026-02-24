export interface ValidarEnderecamentoModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface ValidarEnderecamentoPreferences {
  prefer_offline_mode: boolean;
}

export interface ValidarEnderecamentoLookupResult {
  cd: number;
  coddv: number;
  descricao: string;
  barras: string;
  barras_lista: string[];
  enderecos_sep: string[];
}

export interface ValidarEnderecamentoAuditPayload {
  cd: number;
  barras: string;
  coddv: number;
  descricao: string;
  end_infor: string;
  end_corret: string;
  validado: boolean;
  data_hr?: string | null;
}

export interface ValidarEnderecamentoPendingAuditRow {
  local_id: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
  payload: ValidarEnderecamentoAuditPayload;
}
