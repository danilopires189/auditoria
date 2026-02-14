import { Link } from "react-router-dom";
import type { DashboardModule } from "./types";
import { BackIcon, ModuleIcon } from "../ui/icons";

interface ModulePageTemplateProps {
  moduleDef: DashboardModule;
  isOnline: boolean;
}

export default function ModulePageTemplate({ moduleDef, isOnline }: ModulePageTemplateProps) {
  return (
    <>
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
            <span className="module-back-icon" aria-hidden="true">
              <BackIcon />
            </span>
            <span>Início</span>
          </Link>
          <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
            {isOnline ? "🟢 Online" : "🔴 Offline"}
          </span>
        </div>
        <div className={`module-card module-card-static module-header-card tone-${moduleDef.tone}`}>
          <span className="module-icon" aria-hidden="true">
            <ModuleIcon name={moduleDef.icon} />
          </span>
          <span className="module-title">{moduleDef.title}</span>
        </div>
      </header>

      <section className="modules-shell">
        <article className="module-screen surface-enter">
          <div className="module-screen-body">
            <p>Em construção. Volte depois.</p>
          </div>
        </article>
      </section>
    </>
  );
}
