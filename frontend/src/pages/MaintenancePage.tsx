import logoImage from "../../assets/logo.png";
import pmImage from "../../assets/pm.png";

interface MaintenancePageProps {
  appHeading: string;
}

export default function MaintenancePage({ appHeading }: MaintenancePageProps) {
  return (
    <div className="page-shell maintenance-shell">
      <section className="maintenance-card surface-enter" aria-labelledby="maintenance-title">
        <div className="auth-top maintenance-top">
          <img className="brand-logo" src={logoImage} alt="Logo Auditoria" />
          <img className="brand-stamp" src={pmImage} alt="Marca interna" />
        </div>
        <p className="auth-brand-caption">{appHeading}</p>

        <div className="maintenance-layout">
          <div className="maintenance-copy">
            <span className="maintenance-pill">Sistema indisponível</span>
            <h1 id="maintenance-title">Aplicação desabilitada por tempo indeterminado</h1>
            <p className="subtitle maintenance-subtitle">
              O acesso ao sistema está temporariamente indisponível. Tente novamente mais tarde.
            </p>
          </div>

          <div className="maintenance-illustration" aria-hidden="true">
            <svg viewBox="0 0 360 220" role="presentation">
              <defs>
                <linearGradient id="plug-card-glow" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#eff6ff" />
                  <stop offset="100%" stopColor="#dce9ff" />
                </linearGradient>
                <linearGradient id="plug-body" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#173766" />
                  <stop offset="100%" stopColor="#0f2343" />
                </linearGradient>
                <linearGradient id="plug-head" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#2f69c8" />
                  <stop offset="100%" stopColor="#194a98" />
                </linearGradient>
              </defs>

              <rect x="28" y="20" width="304" height="180" rx="32" fill="url(#plug-card-glow)" />
              <path
                d="M205 108C221 108 236 121 246 133C258 148 277 155 303 155"
                fill="none"
                stroke="#15305f"
                strokeWidth="14"
                strokeLinecap="round"
              />
              <path
                d="M58 152C75 141 94 132 115 125"
                fill="none"
                stroke="#15305f"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray="10 16"
              />
              <rect x="102" y="92" width="88" height="56" rx="18" fill="url(#plug-body)" />
              <rect x="170" y="102" width="42" height="36" rx="14" fill="url(#plug-head)" />
              <rect x="113" y="80" width="10" height="26" rx="5" fill="#f7f8fb" />
              <rect x="137" y="80" width="10" height="26" rx="5" fill="#f7f8fb" />
              <circle cx="88" cy="104" r="9" fill="#f23f5f" />
              <circle cx="76" cy="128" r="6" fill="#f7b267" />
              <circle cx="97" cy="135" r="5" fill="#2f69c8" />
              <rect x="238" y="115" width="62" height="52" rx="16" fill="#f7f8fb" stroke="#bdd0ee" strokeWidth="6" />
              <rect x="258" y="132" width="10" height="18" rx="5" fill="#1b4588" />
              <rect x="276" y="132" width="10" height="18" rx="5" fill="#1b4588" />
            </svg>
          </div>
        </div>
      </section>
    </div>
  );
}
