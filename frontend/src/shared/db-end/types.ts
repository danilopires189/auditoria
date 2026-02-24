export interface DbEndCacheRow {
  cd: number;
  coddv: number;
  descricao: string;
  endereco: string;
  tipo: string;
  andar: string | null;
  validade: string | null;
  updated_at: string | null;
}

export interface DbEndSyncMeta {
  cd: number;
  last_sync_at: string | null;
  row_count: number;
}

export interface DbEndProgress {
  mode: "full" | "delta";
  pagesFetched: number;
  rowsFetched: number;
  totalRows: number;
  percent: number;
}
