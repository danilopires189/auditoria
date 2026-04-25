import { useState } from "react";
import { Link } from "react-router-dom";
import pmImage from "../../assets/pm.png";
import { DASHBOARD_MODULES } from "../modules/registry";
import type { DashboardModuleKey } from "../modules/types";
import type { DisplayContext, HomeModulesViewMode } from "../types/ui";
import { LogoutIcon, ModuleIcon, ViewGridIcon, ViewListIcon } from "../ui/icons";

const AVAILABLE_MODULE_KEYS = new Set([
  "apoio-gestor",
  "auditoria-caixa",
  "atividade-extra",
  "busca-produto",
  "check-list",
  "coleta-mercadoria",
  "conferencia-entrada-notas",
  "conferencia-pedido-direto",
  "conferencia-termo",
  "conferencia-volume-avulso",
  "controle-avarias",
  "controle-logistico-volume",
  "controle-validade",
  "devolucao-mercadoria",
  "gestao-estoque",
  "gestao-conservadoras",
  "indicadores",
  "meta-mes",
  "produtividade",
  "pvps-alocacao",
  "registro-embarque-caixa-termica",
  "ronda",
  "transferencia-cd",
  "validar-enderecamento",
  "validar-etiqueta-pulmao",
  "zerados"
]);

interface HomePageProps {
  displayContext: DisplayContext;
  appHeading: string;
  hiddenModuleKeys?: DashboardModuleKey[];
  allowedModuleKeys?: DashboardModuleKey[] | null;
  atividadeExtraPendingApprovalsCount?: number;
  isOnline: boolean;
  onRequestLogout: () => void;
  modulesViewMode: HomeModulesViewMode;
  onToggleModulesViewMode: (nextMode: HomeModulesViewMode) => void;
  showCdSwitcher?: boolean;
  onRequestCdSwitcher?: () => void;
  brandLogoSrc?: string;
  brandLogoAlt?: string;
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6" />
      <circle cx="12" cy="7.2" r="1" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function PendingApprovalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export default function HomePage({
  displayContext,
  appHeading,
  hiddenModuleKeys = [],
  allowedModuleKeys = null,
  atividadeExtraPendingApprovalsCount = 0,
  isOnline,
  onRequestLogout,
  modulesViewMode,
  onToggleModulesViewMode,
  showCdSwitcher = false,
  onRequestCdSwitcher,
  brandLogoSrc = pmImage,
  brandLogoAlt = "PM"
}: HomePageProps) {
  const hiddenModuleSet = new Set(hiddenModuleKeys);
  const allowedModuleSet = allowedModuleKeys ? new Set(allowedModuleKeys) : null;
  const nextViewMode = modulesViewMode === "list" ? "grid" : "list";
  const viewToggleLabel = nextViewMode === "grid" ? "Mudar visual para ícones" : "Mudar visual para lista";
  const moduleCollator = new Intl.Collator("pt-BR", { sensitivity: "base" });
  const [moduleSearch, setModuleSearch] = useState("");
  const normalizedModuleSearch = moduleSearch.trim().toLocaleLowerCase("pt-BR");
  const sortedVisibleModules = [...DASHBOARD_MODULES]
    .filter((moduleDef) => !hiddenModuleSet.has(moduleDef.key) && (!allowedModuleSet || allowedModuleSet.has(moduleDef.key)))
    .filter((moduleDef) => (
      normalizedModuleSearch === ""
        ? true
        : moduleDef.title.toLocaleLowerCase("pt-BR").includes(normalizedModuleSearch)
    ))
    .sort((left, right) => moduleCollator.compare(left.title, right.title));

  return (
    <>
      <header className="app-topbar">
        <div className="topbar-id">
          <img src={brandLogoSrc} alt={brandLogoAlt} />
          <div className="topbar-user">
            <div className="topbar-user-row">
              <strong>{displayContext.nome}</strong>
            </div>
            <span>Matrícula: {displayContext.mat || "-"}</span>
            <span className="topbar-cargo">{displayContext.cargo}</span>
          </div>
        </div>
        <div className="topbar-right">
          <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
            {isOnline ? "🟢 Online" : "🔴 Offline"}
          </span>
          <button
            className="btn btn-logout"
            onClick={onRequestLogout}
            type="button"
            aria-label="Sair"
            title="Sair"
          >
            <span className="logout-icon" aria-hidden="true">
              <LogoutIcon />
            </span>
          </button>
        </div>
        <div className="topbar-meta">
          <span className="topbar-meta-cd">
            <span>{displayContext.cdLabel}</span>
            {showCdSwitcher && onRequestCdSwitcher ? (
              <button
                type="button"
                className="topbar-cd-info-btn"
                onClick={onRequestCdSwitcher}
                aria-label="Ajustar CD"
                title="Ajustar CD"
              >
                <InfoIcon />
              </button>
            ) : null}
          </span>
          <span>Perfil: {displayContext.roleLabel}</span>
          <button
            className="btn btn-view-toggle topbar-view-toggle"
            onClick={() => onToggleModulesViewMode(nextViewMode)}
            type="button"
            aria-label={viewToggleLabel}
            title={viewToggleLabel}
          >
            <span className="view-toggle-icon" aria-hidden="true">
              {modulesViewMode === "list" ? <ViewGridIcon /> : <ViewListIcon />}
            </span>
          </button>
        </div>
      </header>

      <section className="modules-shell">
        <div className="modules-head">
          <div className="modules-head-row">
            <h2>{appHeading}</h2>
            <label className="modules-head-search" aria-label="Buscar módulo pelo nome">
              <span className="modules-head-search-icon" aria-hidden="true">
                <ModuleIcon name="search" />
              </span>
              <input
                type="text"
                className="modules-head-search-input"
                value={moduleSearch}
                onChange={(event) => setModuleSearch(event.target.value)}
                placeholder="Buscar módulo..."
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
              />
              <button
                type="button"
                className="modules-head-search-clear"
                onClick={() => setModuleSearch("")}
                aria-label="Limpar busca de módulos"
                disabled={normalizedModuleSearch === ""}
                title="Limpar busca"
              >
                <ClearIcon />
              </button>
            </label>
          </div>
          <p>Selecione um módulo para iniciar.</p>
        </div>
        <div className={`modules-grid ${modulesViewMode === "grid" ? "is-icon-view" : "is-list-view"}`}>
          {sortedVisibleModules.map((moduleDef) => {
            const showAtividadeExtraPendingBadge = moduleDef.key === "atividade-extra" && atividadeExtraPendingApprovalsCount > 0;

            return (
            <Link
              key={moduleDef.key}
              to={moduleDef.path}
              className={`module-card tone-${moduleDef.tone}${modulesViewMode === "grid" ? " is-icon-view" : ""}`}
            >
              <span className="module-icon" aria-hidden="true">
                <ModuleIcon name={moduleDef.icon} />
              </span>
              <div className="module-header-main">
                <span className="module-title">
                  <span>{moduleDef.title}</span>
                  {showAtividadeExtraPendingBadge ? (
                    <span
                      className="module-title-pending-badge"
                      title="Atividades aguardando aprovação no mês atual"
                    >
                      <span className="module-title-pending-badge-icon" aria-hidden="true">
                        <PendingApprovalIcon />
                      </span>
                      <strong>{atividadeExtraPendingApprovalsCount}</strong>
                    </span>
                  ) : null}
                </span>
                {AVAILABLE_MODULE_KEYS.has(moduleDef.key) ? (
                  <span className="module-available-pill">Disponível</span>
                ) : moduleDef.key === "produtividade" ? (
                  <span className="module-test-pill">Em teste</span>
                ) : null}
              </div>
            </Link>
            );
          })}
        </div>
        {sortedVisibleModules.length === 0 ? (
          <p className="modules-empty-state">Nenhum módulo encontrado para essa busca.</p>
        ) : null}
      </section>
    </>
  );
}
