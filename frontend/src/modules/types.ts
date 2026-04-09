export type ModuleIconName =
  | "audit"
  | "box"
  | "chart"
  | "calendar"
  | "expiry"
  | "extra"
  | "search"
  | "barcode"
  | "cold"
  | "carton-meds"
  | "worker"
  | "location"
  | "collect"
  | "checklist"
  | "path"
  | "term"
  | "volume"
  | "direct"
  | "notes"
  | "qr"
  | "return"
  | "ship"
  | "goal"
  | "productivity"
  | "zero";

export type ModuleTone = "blue" | "red" | "teal" | "amber";

export type DashboardModuleKey =
  | "atividade-extra"
  | "auditoria-caixa"
  | "busca-produto"
  | "check-list"
  | "coleta-mercadoria"
  | "conferencia-entrada-notas"
  | "conferencia-pedido-direto"
  | "conferencia-termo"
  | "conferencia-volume-avulso"
  | "controle-validade"
  | "devolucao-mercadoria"
  | "gestao-estoque"
  | "indicadores"
  | "meta-mes"
  | "pvps-alocacao"
  | "produtividade"
  | "registro-embarque"
  | "ronda"
  | "validar-enderecamento"
  | "validar-etiqueta-pulmao"
  | "zerados";

export interface DashboardModule {
  key: DashboardModuleKey;
  path: `/modulos/${DashboardModuleKey}`;
  title: string;
  icon: ModuleIconName;
  tone: ModuleTone;
}
