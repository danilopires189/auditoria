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
                d="M55 158C71 148 83 137 95 126"
                fill="none"
                stroke="#173766"
                strokeWidth="12"
                strokeLinecap="round"
              />
              <circle cx="82" cy="138" r="7" fill="#2f69c8" />
              <circle cx="92" cy="132" r="5" fill="#90b5f3" />
              <circle cx="74" cy="128" r="7" fill="#f7b267" />
              <circle cx="88" cy="104" r="11" fill="#f23f5f" />
              <path
                d="M191 107C214 110 233 122 247 139"
                fill="none"
                stroke="#15305f"
                strokeWidth="14"
                strokeLinecap="round"
              />
              <path
                d="M246 139C261 158 286 164 312 159"
                fill="none"
                stroke="#15305f"
                strokeWidth="14"
                strokeLinecap="round"
              />
              <rect x="96" y="92" width="96" height="58" rx="19" fill="url(#plug-body)" />
              <rect x="172" y="104" width="48" height="34" rx="14" fill="url(#plug-head)" />
              <rect x="110" y="78" width="12" height="28" rx="6" fill="#f7f8fb" />
              <rect x="136" y="78" width="12" height="28" rx="6" fill="#f7f8fb" />
              <rect
                x="230"
                y="115"
                width="78"
                height="56"
                rx="18"
                fill="#f7f8fb"
                stroke="#b7c9e6"
                strokeWidth="6"
              />
              <rect x="258" y="132" width="11" height="20" rx="5.5" fill="#1b4588" />
              <rect x="280" y="132" width="11" height="20" rx="5.5" fill="#1b4588" />
              <rect x="206" y="112" width="7" height="12" rx="3.5" fill="#f4f7fd" transform="rotate(23 206 112)" />
              <rect x="214" y="124" width="7" height="12" rx="3.5" fill="#f4f7fd" transform="rotate(23 214 124)" />
              <path
                d="M224 118C231 115 237 116 242 121"
                fill="none"
                stroke="#7ea4df"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      </section>
    </div>
  );
}
