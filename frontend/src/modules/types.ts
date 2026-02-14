export type ModuleIconName =
  | "audit"
  | "extra"
  | "collect"
  | "term"
  | "volume"
  | "direct"
  | "notes"
  | "return"
  | "ship"
  | "goal"
  | "productivity"
  | "zero";

export type ModuleTone = "blue" | "red" | "teal" | "amber";

export type DashboardModuleKey =
  | "pvps-alocacao"
  | "atividade-extra"
  | "coleta-mercadoria"
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
