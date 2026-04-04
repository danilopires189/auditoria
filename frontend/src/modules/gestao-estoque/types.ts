export interface GestaoEstoqueModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export type GestaoEstoqueMovementType = "baixa" | "entrada";

export interface GestaoEstoqueAvailableDay {
  movement_date: string;
  item_count: number;
  updated_at: string | null;
  is_today: boolean;
}

export interface GestaoEstoqueItemRow {
  id: string;
  movement_date: string;
  movement_type: GestaoEstoqueMovementType;
  coddv: number;
  barras_informado: string | null;
  quantidade: number;
  descricao: string;
  endereco_sep: string | null;
  endereco_pul: string | null;
  qtd_est_atual: number;
  qtd_est_disp: number;
  estoque_updated_at: string | null;
  dat_ult_compra: string | null;
  custo_unitario: number | null;
  custo_total: number;
  created_nome: string;
  created_mat: string;
  created_at: string;
  updated_nome: string;
  updated_mat: string;
  updated_at: string;
  resolved_refreshed_at: string | null;
  is_frozen: boolean;
}

export interface GestaoEstoqueAddResult {
  status: "added" | "already_exists";
  message: string;
  row: GestaoEstoqueItemRow;
}
