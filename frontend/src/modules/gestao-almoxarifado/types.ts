export interface GestaoAlmoxarifadoModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export type AlmoxSolicitacaoTipo = "compra" | "retirada";
export type AlmoxSolicitacaoStatus = "pendente" | "aprovada" | "reprovada";
export type AlmoxMovimentoTipo = "inventario" | "retirada_aprovada" | "nota_aplicada";

export interface AlmoxProduto {
  produto_id: string;
  codigo: string;
  descricao: string;
  marca: string;
  tamanho: string | null;
  estoque_atual: number;
  ultimo_custo: number;
  created_at: string;
  updated_at: string;
}

export interface AlmoxSolicitacaoItemDraft {
  codigo: string;
  quantidade: number;
}

export interface AlmoxSolicitacaoItem {
  item_id: string;
  solicitacao_id: string;
  produto_id: string;
  codigo: string;
  descricao: string;
  marca: string;
  tamanho: string | null;
  quantidade: number;
  estoque_snapshot: number;
  valor_unitario: number;
  valor_total: number;
}

export interface AlmoxSolicitacao {
  solicitacao_id: string;
  tipo: AlmoxSolicitacaoTipo;
  status: AlmoxSolicitacaoStatus;
  motivo: string | null;
  total_valor: number;
  solicitante_nome: string;
  solicitante_mat: string;
  created_at: string;
  aprovador_nome: string | null;
  aprovador_mat: string | null;
  aprovado_at: string | null;
  decisao_observacao: string | null;
  itens: AlmoxSolicitacaoItem[];
}

export interface AlmoxMovimento {
  movimento_id: string;
  tipo: AlmoxMovimentoTipo;
  codigo: string;
  descricao: string;
  quantidade_delta: number;
  estoque_antes: number;
  estoque_depois: number;
  valor_unitario: number;
  valor_total: number;
  actor_nome: string;
  actor_mat: string;
  created_at: string;
  origem_label: string | null;
}

export interface AlmoxNfExtractedItem {
  codigo: string;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
}

export interface AlmoxNfExtraction {
  numero_nf: string;
  fornecedor: string;
  data_emissao: string | null;
  itens: AlmoxNfExtractedItem[];
  alertas?: string[];
}

export interface AlmoxNfImport {
  import_id: string;
  numero_nf: string | null;
  fornecedor: string | null;
  data_emissao: string | null;
  status: "extraida" | "aplicada";
  alertas: string[];
  created_at: string;
  applied_at: string | null;
}

export interface AlmoxNfValidationRow extends AlmoxNfExtractedItem {
  produto_id: string | null;
  produto_existe: boolean;
  estoque_atual: number;
}
