import type { DashboardModule, DashboardModuleKey } from "./types";

export const DASHBOARD_MODULES: DashboardModule[] = [
  { key: "pvps-alocacao", path: "/modulos/pvps-alocacao", title: "Auditoria de PVPs e Alocação", icon: "audit", tone: "blue" },
  { key: "atividade-extra", path: "/modulos/atividade-extra", title: "Atividade Extra", icon: "extra", tone: "amber" },
  { key: "coleta-mercadoria", path: "/modulos/coleta-mercadoria", title: "Coleta de Mercadoria", icon: "collect", tone: "teal" },
  { key: "check-list", path: "/modulos/check-list", title: "Check List", icon: "checklist", tone: "blue" },
  { key: "conferencia-termo", path: "/modulos/conferencia-termo", title: "Conferência de Termo", icon: "term", tone: "blue" },
  { key: "conferencia-volume-avulso", path: "/modulos/conferencia-volume-avulso", title: "Conferência de Volume Avulso", icon: "volume", tone: "teal" },
  { key: "conferencia-pedido-direto", path: "/modulos/conferencia-pedido-direto", title: "Conferência de Pedido Direto", icon: "direct", tone: "blue" },
  { key: "conferencia-entrada-notas", path: "/modulos/conferencia-entrada-notas", title: "Conferência de Entrada de Notas", icon: "notes", tone: "blue" },
  { key: "devolucao-mercadoria", path: "/modulos/devolucao-mercadoria", title: "Devolução de Mercadoria", icon: "return", tone: "red" },
  { key: "registro-embarque", path: "/modulos/registro-embarque", title: "Registro de Embarque", icon: "ship", tone: "teal" },
  { key: "meta-mes", path: "/modulos/meta-mes", title: "Meta Mês", icon: "goal", tone: "amber" },
  { key: "produtividade", path: "/modulos/produtividade", title: "Produtividade", icon: "productivity", tone: "amber" },
  { key: "zerados", path: "/modulos/zerados", title: "Zerados", icon: "zero", tone: "red" }
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
  return DASHBOARD_MODULES.find((moduleDef) => moduleDef.path === pathname) ?? null;
}
