export type ModuleIconName =
  | "audit"
  | "expiry"
  | "extra"
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
