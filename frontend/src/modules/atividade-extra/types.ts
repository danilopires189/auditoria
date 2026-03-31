export type AtividadeExtraVisibilityMode = "public_cd" | "owner_only";
export type AtividadeExtraApprovalStatus = "pending" | "approved";
export type AtividadeExtraEntryMode = "timed" | "manual_points";

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

export interface AtividadeExtraAssignableUserRow {
  user_id: string;
  mat: string;
  nome: string;
}

export interface AtividadeExtraEntryRow {
  id: string;
  cd: number;
  user_id: string;
  mat: string;
  nome: string;
  entry_mode: AtividadeExtraEntryMode;
  data_inicio: string;
  hora_inicio: string;
  data_fim: string;
  hora_fim: string;
  duracao_segundos: number;
  tempo_gasto_hms: string;
  pontos: number;
  descricao: string;
  approval_status: AtividadeExtraApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
  approved_by_mat: string | null;
  approved_by_nome: string | null;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
  can_approve: boolean;
}

export interface AtividadeExtraCreatePayload {
  cd: number;
  data_inicio: string;
  hora_inicio: string;
  data_fim: string;
  hora_fim: string;
  descricao: string;
}

export interface AtividadeExtraAdminPointsCreatePayload {
  cd: number;
  target_user_id: string;
  data_atividade: string;
  pontos: number;
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
