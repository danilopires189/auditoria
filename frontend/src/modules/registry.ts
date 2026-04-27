import type { DashboardModule, DashboardModuleKey } from "./types";

export const DASHBOARD_MODULES: DashboardModule[] = [
  { key: "apoio-gestor", path: "/modulos/apoio-gestor", title: "Apoio ao Gestor", icon: "numbers", tone: "graphite" },
  { key: "auditoria-caixa", path: "/modulos/auditoria-caixa", title: "Auditoria de caixa", icon: "box", tone: "blue" },
  { key: "pvps-alocacao", path: "/modulos/pvps-alocacao", title: "Auditoria de PVPS e Alocação", icon: "calendar", tone: "blue" },
  { key: "atividade-extra", path: "/modulos/atividade-extra", title: "Atividade Extra", icon: "extra", tone: "amber" },
  { key: "busca-produto", path: "/modulos/busca-produto", title: "Busca por Produto", icon: "search", tone: "blue" },
  { key: "check-list", path: "/modulos/check-list", title: "Check List", icon: "checklist", tone: "blue" },
  { key: "coleta-mercadoria", path: "/modulos/coleta-mercadoria", title: "Coleta de Mercadoria", icon: "barcode", tone: "teal" },
  { key: "conferencia-entrada-notas", path: "/modulos/conferencia-entrada-notas", title: "Conferência de Entrada de Notas", icon: "notes", tone: "blue" },
  { key: "controle-avarias", path: "/modulos/controle-avarias", title: "Controle de Avarias", icon: "damage", tone: "red" },
  { key: "conferencia-pedido-direto", path: "/modulos/conferencia-pedido-direto", title: "Conferência de Pedido Direto", icon: "direct", tone: "blue" },
  { key: "conferencia-termo", path: "/modulos/conferencia-termo", title: "Conferência de Termo", icon: "cold", tone: "blue" },
  { key: "conferencia-volume-avulso", path: "/modulos/conferencia-volume-avulso", title: "Conferência de Volume Avulso", icon: "carton-meds", tone: "teal" },
  { key: "controle-logistico-volume", path: "/modulos/controle-logistico-volume", title: "Controle de Volumes", icon: "volume", tone: "green" },
  { key: "controle-validade", path: "/modulos/controle-validade", title: "Controle de Validade", icon: "expiry", tone: "blue" },
  { key: "devolucao-mercadoria", path: "/modulos/devolucao-mercadoria", title: "Devolução de Mercadoria", icon: "return", tone: "red" },
  { key: "gestao-estoque", path: "/modulos/gestao-estoque", title: "Gestão de Estoque", icon: "audit", tone: "blue" },
  { key: "gestao-conservadoras", path: "/modulos/gestao-conservadoras", title: "Gestão de Conservadoras Térmicas", icon: "fridge", tone: "teal" },
  { key: "indicadores", path: "/modulos/indicadores", title: "Indicadores", icon: "chart", tone: "blue" },
  { key: "indicadores-logisticos", path: "/modulos/indicadores-logisticos", title: "Indicadores Logísticos", icon: "chart", tone: "green" },
  { key: "zerados", path: "/modulos/zerados", title: "Inventário (zerados)", icon: "zero", tone: "red" },
  { key: "meta-mes", path: "/modulos/meta-mes", title: "Meta Mês", icon: "goal", tone: "amber" },
  { key: "produtividade", path: "/modulos/produtividade", title: "Produtividade", icon: "worker", tone: "amber" },
  { key: "registro-embarque", path: "/modulos/registro-embarque", title: "Registro de Embarque", icon: "ship", tone: "teal" },
  { key: "registro-embarque-caixa-termica", path: "/modulos/registro-embarque-caixa-termica", title: "Registro de Embarque - Caixa Térmica", icon: "thermal-box", tone: "teal" },
  { key: "ronda", path: "/modulos/ronda", title: "Ronda de Qualidade", icon: "path", tone: "blue" },
  { key: "transferencia-cd", path: "/modulos/transferencia-cd", title: "Conferência de Transferência CD", icon: "truck", tone: "teal" },
  { key: "validar-enderecamento", path: "/modulos/validar-enderecamento", title: "Validar Endereçamento", icon: "location", tone: "blue" },
  { key: "validar-etiqueta-pulmao", path: "/modulos/validar-etiqueta-pulmao", title: "Validar Etiqueta Pulmão", icon: "qr", tone: "blue" }
];

export const MODULE_BY_KEY: Record<DashboardModuleKey, DashboardModule> = DASHBOARD_MODULES.reduce(
  (acc, moduleDef) => {
    acc[moduleDef.key] = moduleDef;
    return acc;
  },
  {} as Record<DashboardModuleKey, DashboardModule>
);

export function getModuleByKeyOrThrow(moduleKey: DashboardModuleKey): DashboardModule {
  return MODULE_BY_KEY[moduleKey];
}

export function findModuleByPath(pathname: string): DashboardModule | null {
  return DASHBOARD_MODULES.find((moduleDef) => pathname === moduleDef.path || pathname.startsWith(`${moduleDef.path}/`)) ?? null;
}
