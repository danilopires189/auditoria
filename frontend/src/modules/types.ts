export type ModuleIconName =
  | "audit"
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
  | "controle-validade"
  | "pvps-alocacao"
  | "atividade-extra"
  | "indicadores"
  | "busca-produto"
  | "validar-enderecamento"
  | "validar-etiqueta-pulmao"
  | "coleta-mercadoria"
  | "check-list"
  | "conferencia-termo"
  | "conferencia-volume-avulso"
  | "conferencia-pedido-direto"
  | "conferencia-entrada-notas"
  | "devolucao-mercadoria"
  | "registro-embarque"
  | "meta-mes"
  | "produtividade"
  | "zerados";

export interface DashboardModule {
  key: DashboardModuleKey;
  path: `/modulos/${DashboardModuleKey}`;
  title: string;
  icon: ModuleIconName;
  tone: ModuleTone;
}
