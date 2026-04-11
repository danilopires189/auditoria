export const AUDITORIA_CAIXA_OCCURRENCIAS = [
  "Basqueta quebrada",
  "Sem lacre",
  "Lacramento não conforme",
  "Duplicidade",
  "Sem etiqueta",
  "Volume misturado",
  "Avaria",
  "Termo embagalem (N/OK)",
  "Caixa papelão não conforme",
  "Falta",
  "Sobra",
  "Altura não conforme"
] as const;

export type AuditoriaCaixaOccurrence = typeof AUDITORIA_CAIXA_OCCURRENCIAS[number] | null;

export type AuditoriaCaixaSyncStatus = "pending_insert" | "pending_update" | "pending_delete" | "synced" | "error";

export interface AuditoriaCaixaModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface DbRotasCacheRow {
  filial: number;
  uf: string | null;
  nome: string | null;
  rota: string | null;
  updated_at: string | null;
}

export interface DbRotasSyncMeta {
  last_sync_at: string | null;
  row_count: number;
}

export interface AuditoriaCaixaRow {
  local_id: string;
  remote_id: string | null;
  user_id: string;
  cd: number;
  etiqueta: string;
  id_knapp: string | null;
  pedido: number;
  data_pedido: string | null;
  dv: string | null;
  filial: number;
  filial_nome: string | null;
  uf: string | null;
  rota: string | null;
  volume: string | null;
  ocorrencia: AuditoriaCaixaOccurrence;
  mat_aud: string;
  nome_aud: string;
  data_hr: string;
  created_at: string;
  updated_at: string;
  sync_status: AuditoriaCaixaSyncStatus;
  sync_error: string | null;
}

export interface AuditoriaCaixaPreferences {
  cd_ativo: number | null;
  prefer_offline_mode: boolean;
}

export interface CdOption {
  cd: number;
  cd_nome: string;
}

export interface AuditoriaCaixaReportFilters {
  dtIni: string;
  dtFim: string;
  cd: number | null;
}

export interface AuditoriaCaixaReportRow {
  id: string;
  etiqueta: string;
  id_knapp: string | null;
  cd: number;
  pedido: number;
  data_pedido: string | null;
  dv: string | null;
  filial: number;
  filial_nome: string | null;
  uf: string | null;
  rota: string | null;
  volume: string | null;
  ocorrencia: AuditoriaCaixaOccurrence;
  mat_aud: string;
  nome_aud: string;
  user_id: string;
  data_hr: string;
  created_at: string;
  updated_at: string;
}
