export interface BuscaProdutoModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export interface BuscaProdutoAddressRow {
  endereco: string;
  andar: string | null;
  validade: string | null;
}

export interface BuscaProdutoExcludedAddressRow {
  endereco: string;
  exclusao: string | null;
}

export interface BuscaProdutoLookupResult {
  cd: number;
  coddv: number;
  descricao: string;
  barras: string;
  barras_lista: string[];
  qtd_est_disp: number;
  qtd_est_atual: number;
  estoque_updated_at: string | null;
  dat_ult_compra: string | null;
  enderecos_sep: BuscaProdutoAddressRow[];
  enderecos_pul: BuscaProdutoAddressRow[];
  enderecos_excluidos: BuscaProdutoExcludedAddressRow[];
}
