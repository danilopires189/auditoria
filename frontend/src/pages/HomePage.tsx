import { Link } from "react-router-dom";
import pmImage from "../../assets/pm.png";
import { DASHBOARD_MODULES } from "../modules/registry";
import type { DisplayContext } from "../types/ui";
import { LogoutIcon, ModuleIcon } from "../ui/icons";

interface HomePageProps {
  displayContext: DisplayContext;
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
  isOnline,
  onRequestLogout,
  showCdSwitcher = false,
  onRequestCdSwitcher
}: HomePageProps) {
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
          <h2>Prevenção de Perdas CDs</h2>
          <p>Selecione um módulo para iniciar.</p>
        </div>
        <div className="modules-grid">
          {DASHBOARD_MODULES.map((moduleDef) => (
            <Link key={moduleDef.key} to={moduleDef.path} className={`module-card tone-${moduleDef.tone}`}>
              <span className="module-icon" aria-hidden="true">
                <ModuleIcon name={moduleDef.icon} />
              </span>
              <div className="module-header-main">
                <span className="module-title">{moduleDef.title}</span>
                {moduleDef.key === "coleta-mercadoria"
                || moduleDef.key === "pvps-alocacao"
                || moduleDef.key === "atividade-extra"
                || moduleDef.key === "conferencia-termo"
                || moduleDef.key === "conferencia-volume-avulso"
                || moduleDef.key === "conferencia-pedido-direto"
                || moduleDef.key === "conferencia-entrada-notas"
                || moduleDef.key === "devolucao-mercadoria"
                || moduleDef.key === "zerados" ? (
                  <span className="module-available-pill">Disponível</span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
