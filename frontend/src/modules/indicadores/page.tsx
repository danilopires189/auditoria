import { Link } from "react-router-dom";
import pmImage from "../../../assets/pm.png";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import type { IndicadoresModuleProfile } from "./types";

interface IndicadoresPageProps {
  isOnline: boolean;
  profile: IndicadoresModuleProfile;
}

const MODULE_DEF = getModuleByKeyOrThrow("indicadores");

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

export default function IndicadoresPage({ isOnline, profile }: IndicadoresPageProps) {
  return (
    <>
      <header className="module-topbar module-topbar-fixed indicadores-topbar">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
            <span className="module-back-icon" aria-hidden="true">
              <BackIcon />
            </span>
            <span>Início</span>
          </Link>
          <div className="module-topbar-user-side">
            <span className="module-user-greeting">Olá, {toDisplayName(profile.nome)}</span>
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
              {isOnline ? "🟢 Online" : "🔴 Offline"}
            </span>
          </div>
        </div>
        <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
          <span className="module-icon" aria-hidden="true">
            <ModuleIcon name={MODULE_DEF.icon} />
          </span>
          <span className="module-title">{MODULE_DEF.title}</span>
        </div>
      </header>

      <section className="modules-shell indicadores-shell">
        <article className="module-screen surface-enter indicadores-screen">
          <div className="module-screen-header">
            <div className="module-screen-title-row">
              <div className="module-screen-title">
                <img className="indicadores-screen-logo" src={pmImage} alt="PM" />
                <div>
                  <h2>Selecione um indicador</h2>
                  <span className="module-status">Primeiro painel disponível para o CD ativo.</span>
                </div>
              </div>
            </div>
          </div>

          <div className="indicadores-entry-grid">
            <Link to="/modulos/indicadores/blitz" className="indicadores-entry-card">
              <div className="indicadores-entry-head">
                <span className="indicadores-entry-chip">Indicador</span>
                <span className="indicadores-entry-live">Ativo</span>
              </div>
              <div className="indicadores-entry-main">
                <strong>Blitz</strong>
                <p>Divergências do mês, zonas com mais erros e lista diária filtrável.</p>
              </div>
              <span className="indicadores-entry-action">Abrir dashboard</span>
            </Link>
          </div>
        </article>
      </section>
    </>
  );
}
