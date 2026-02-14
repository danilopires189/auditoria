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
      <header className="module-topbar module-topbar-compact">
        <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
          <span className="module-back-icon" aria-hidden="true">
            <BackIcon />
          </span>
          <span>Início</span>
        </Link>
        <div className={`module-topbar-title tone-${moduleDef.tone}`}>
          <span className="module-icon" aria-hidden="true">
            <ModuleIcon name={moduleDef.icon} />
          </span>
          <strong>{moduleDef.title}</strong>
        </div>
        <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
          {isOnline ? "🟢 Online" : "🔴 Offline"}
        </span>
      </header>

      <section className="modules-shell module-shell-compact">
        <article className="module-screen module-screen-compact surface-enter">
          <div className="module-screen-body">
            <p>Em construção. Volte depois.</p>
          </div>
        </article>
      </section>
    </>
  );
}
