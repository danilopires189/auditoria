import { Link } from "react-router-dom";
import pmImage from "../../assets/pm.png";
import { DASHBOARD_MODULES } from "../modules/registry";
import type { DashboardModuleKey } from "../modules/types";
import type { DisplayContext } from "../types/ui";
import { LogoutIcon, ModuleIcon } from "../ui/icons";

const AVAILABLE_MODULE_KEYS = new Set([
  "controle-validade",
  "coleta-mercadoria",
  "pvps-alocacao",
  "atividade-extra",
  "conferencia-termo",
  "conferencia-volume-avulso",
  "conferencia-pedido-direto",
  "conferencia-entrada-notas",
  "devolucao-mercadoria",
  "zerados",
  "produtividade",
  "busca-produto",
  "validar-enderecamento",
  "validar-etiqueta-pulmao"
]);

interface HomePageProps {
  displayContext: DisplayContext;
  appHeading: string;
  hiddenModuleKeys?: DashboardModuleKey[];
  isOnline: boolean;
  onRequestLogout: () => void;
  showCdSwitcher?: boolean;
  onRequestCdSwitcher?: () => void;
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

export default function HomePage({
  displayContext,
  appHeading,
  hiddenModuleKeys = [],
  isOnline,
  onRequestLogout,
  showCdSwitcher = false,
  onRequestCdSwitcher
}: HomePageProps) {
  const hiddenModuleSet = new Set(hiddenModuleKeys);

  return (
    <>
      <header className="app-topbar">
        <div className="topbar-id">
          <img src={pmImage} alt="PM" />
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
        </div>
      </header>

      <section className="modules-shell">
        <div className="modules-head">
          <h2>{appHeading}</h2>
          <p>Selecione um módulo para iniciar.</p>
        </div>
        <div className="modules-grid">
          {DASHBOARD_MODULES.filter((moduleDef) => !hiddenModuleSet.has(moduleDef.key)).map((moduleDef) => (
            <Link key={moduleDef.key} to={moduleDef.path} className={`module-card tone-${moduleDef.tone}`}>
              <span className="module-icon" aria-hidden="true">
                <ModuleIcon name={moduleDef.icon} />
              </span>
              <div className="module-header-main">
                <span className="module-title">{moduleDef.title}</span>
                {AVAILABLE_MODULE_KEYS.has(moduleDef.key) ? (
                  <span className="module-available-pill">Disponível</span>
                ) : moduleDef.key === "produtividade" ? (
                  <span className="module-test-pill">Em teste</span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
