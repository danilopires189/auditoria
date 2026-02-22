export type AtividadeExtraVisibilityMode = "public_cd" | "owner_only";

export interface AtividadeExtraModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface AtividadeExtraVisibilityRow {
  cd: number;
  visibility_mode: AtividadeExtraVisibilityMode;
  updated_by: string | null;
  updated_at: string | null;
}

export interface AtividadeExtraCollaboratorRow {
  user_id: string;
  mat: string;
  nome: string;
  pontos_soma: number;
  tempo_total_segundos: number;
  tempo_total_hms: string;
  atividades_count: number;
}

export interface AtividadeExtraEntryRow {
  id: string;
  cd: number;
  user_id: string;
  mat: string;
  nome: string;
  data_inicio: string;
  hora_inicio: string;
  data_fim: string;
  hora_fim: string;
  duracao_segundos: number;
  tempo_gasto_hms: string;
  pontos: number;
  descricao: string;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
}

export interface AtividadeExtraCreatePayload {
  cd: number;
  data_inicio: string;
  hora_inicio: string;
  data_fim: string;
  hora_fim: string;
  descricao: string;
}

export interface AtividadeExtraUpdatePayload {
  id: string;
  data_inicio: string;
  hora_inicio: string;
  data_fim: string;
  hora_fim: string;
  descricao: string;
}
