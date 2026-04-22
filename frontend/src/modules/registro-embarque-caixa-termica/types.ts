export type CaixaTermicaStatus = "disponivel" | "em_transito";
export type CaixaTermicaTipoMov = "expedicao" | "recebimento";
export type CaixaTermicaSyncStatus = "pending_insert" | "synced" | "error";
export type CaixaTermicaMarca = "Ecobox" | "Coleman" | "Isopor genérica";

export interface CaixaTermicaModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface CaixaTermicaBox {
  id: string;
  local_id: string;
  remote_id: string | null;
  cd: number;
  codigo: string;
  descricao: string;
  observacoes: string | null;
  capacidade_litros: number | null;
  marca: CaixaTermicaMarca | null;
  status: CaixaTermicaStatus;
  created_at: string;
  created_by: string;
  created_mat: string | null;
  created_nome: string | null;
  updated_at: string;
  updated_by: string | null;
  updated_mat: string | null;
  updated_nome: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_mat: string | null;
  deleted_nome: string | null;
  sync_status: CaixaTermicaSyncStatus;
  sync_error: string | null;
  // Desnormalizado do último mov
  last_mov_tipo: CaixaTermicaTipoMov | null;
  last_mov_data_hr: string | null;
  last_mov_placa: string | null;
  last_mov_rota: string | null;
  last_mov_filial: number | null;
  last_mov_filial_nome: string | null;
  last_mov_pedido: number | null;
  last_mov_data_pedido: string | null;
  last_mov_mat_resp: string | null;
  last_mov_nome_resp: string | null;
}

export interface CaixaTermicaMov {
  id: string;
  caixa_id: string;
  tipo: CaixaTermicaTipoMov;
  cd: number;
  etiqueta_volume: string | null;
  filial: number | null;
  filial_nome: string | null;
  rota: string | null;
  pedido: number | null;
  data_pedido: string | null;
  placa: string | null;
  obs_recebimento: string | null;
  mat_resp: string;
  nome_resp: string;
  data_hr: string;
  created_at: string;
  transit_minutes: number | null;
}

export interface NovaCaixaDraft {
  codigo: string;
  descricao: string;
  capacidadeLitros: string;
  marca: CaixaTermicaMarca | "";
  observacoes: string;
}

export interface EditarCaixaDraft {
  caixaId: string;
  codigoOriginal: string;
  codigo: string;
  descricao: string;
  capacidadeLitros: string;
  marca: CaixaTermicaMarca | "";
  observacoes: string;
}

export interface ExpedicaoDraft {
  caixaId: string;
  codigo: string;
  descricao: string;
  observacoes: string | null;
  etiquetaVolume: string;
  filial: number | null;
  filialNome: string | null;
  rota: string | null;
  pedido: number | null;
  dataPedido: string | null;
  placa: string;
  placaError: string | null;
}

export interface RecebimentoDraft {
  caixaId: string;
  codigo: string;
  descricao: string;
  observacoes: string | null;
  obsRecebimento: string;
  semAvarias: boolean;
}

export interface CaixaTermicaFeedRow {
  rota: string | null;
  filial: number | null;
  filial_nome: string | null;
  expedicoes: number;
  recebimentos: number;
  ultimo_mov: string | null;
  caixas: {
    codigo: string;
    tipo: CaixaTermicaTipoMov;
    data_hr: string;
    pedido: number | null;
    data_pedido: string | null;
    mat_resp: string | null;
    nome_resp: string | null;
  }[];
}

export interface CaixaTermicaPrefs {
  cd_ativo: number | null;
  prefer_offline_mode: boolean;
}

export type CaixaTermicaView = "list" | "feed";
