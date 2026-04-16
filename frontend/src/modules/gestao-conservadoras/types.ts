export type ConservadoraStatus =
  | "em_transito"
  | "aguardando_documento"
  | "documentacao_em_atraso"
  | "documentacao_recebida";

export interface ConservadoraModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface ConservadoraShipmentCard {
  embarque_key: string;
  cd: number;
  rota: string;
  placa: string;
  seq_ped: string;
  dt_ped: string | null;
  dt_lib: string | null;
  encerramento: string | null;
  event_at: string | null;
  responsavel_mat: string | null;
  responsavel_nome: string | null;
  transportadora_id: string | null;
  transportadora_nome: string | null;
  transportadora_ativa: boolean;
  document_confirmed_at: string | null;
  document_confirmed_mat: string | null;
  document_confirmed_nome: string | null;
  next_embarque_at: string | null;
  status: ConservadoraStatus;
}

export interface ConservadoraHistoryFilters {
  search?: string | null;
  status?: ConservadoraStatus | "" | null;
  dtIni?: string | null;
  dtFim?: string | null;
  offset?: number;
  limit?: number;
}

export interface ConservadoraTransportadora {
  id: string;
  cd: number;
  nome: string;
  ativo: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface ConservadoraRouteBinding {
  rota_descricao: string;
  transportadora_id: string | null;
  transportadora_nome: string | null;
  transportadora_ativa: boolean;
}
