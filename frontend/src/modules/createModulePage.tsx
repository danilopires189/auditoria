import ModulePageTemplate from "./ModulePageTemplate";
import { getModuleByKeyOrThrow } from "./registry";
import type { DashboardModuleKey } from "./types";

export interface ModulePageProps {
  isOnline: boolean;
}

export function createModulePage(moduleKey: DashboardModuleKey) {
  return function ModulePage({ isOnline }: ModulePageProps) {
    const moduleDef = getModuleByKeyOrThrow(moduleKey);
    return <ModulePageTemplate moduleDef={moduleDef} isOnline={isOnline} />;
  };
}
