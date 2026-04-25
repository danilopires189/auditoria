export type ModuleIconName =
  | "audit"
  | "box"
  | "chart"
  | "numbers"
  | "calendar"
  | "expiry"
  | "extra"
  | "search"
  | "barcode"
  | "cold"
  | "thermal-box"
  | "fridge"
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
  | "truck"
  | "goal"
  | "productivity"
  | "zero"
  | "damage";

export type ModuleTone = "blue" | "red" | "teal" | "amber" | "graphite" | "green";

export type DashboardModuleKey =
  | "apoio-gestor"
  | "atividade-extra"
  | "auditoria-caixa"
  | "busca-produto"
  | "check-list"
  | "coleta-mercadoria"
  | "conferencia-entrada-notas"
  | "conferencia-pedido-direto"
  | "controle-avarias"
  | "controle-logistico-volume"
  | "conferencia-termo"
  | "conferencia-volume-avulso"
  | "controle-validade"
  | "devolucao-mercadoria"
  | "gestao-estoque"
  | "gestao-conservadoras"
  | "indicadores"
  | "meta-mes"
  | "pvps-alocacao"
  | "produtividade"
  | "registro-embarque"
  | "registro-embarque-caixa-termica"
  | "ronda"
  | "transferencia-cd"
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
