import { useEffect } from "react";
import { Link } from "react-router-dom";
import type { DashboardModule } from "./types";
import { BackIcon, ModuleIcon } from "../ui/icons";

interface ModulePageTemplateProps {
  moduleDef: DashboardModule;
  isOnline: boolean;
  userName: string;
}

function toUserDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

export default function ModulePageTemplate({ moduleDef, isOnline, userName }: ModulePageTemplateProps) {
  const displayUserName = toUserDisplayName(userName);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo(0, 0);
  }, [moduleDef.key]);

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
          <div className="module-topbar-user-side">
            <span className="module-user-greeting">Olá, {displayUserName}</span>
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
              {isOnline ? "🟢 Online" : "🔴 Offline"}
            </span>
          </div>
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
          <div className="module-screen-body module-screen-body-large">
            <p>Em construção. Volte depois.</p>
          </div>
        </article>
      </section>
    </>
  );
}
