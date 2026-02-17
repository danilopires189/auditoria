export interface DbBarrasCacheRow {
  barras: string;
  coddv: number;
  descricao: string;
  updated_at: string | null;
}

export interface DbBarrasSyncMeta {
  last_sync_at: string | null;
  row_count: number;
}

export interface DbBarrasProgress {
  mode: "full" | "delta";
  pagesFetched: number;
  rowsFetched: number;
  totalRows: number;
  percent: number;
}
