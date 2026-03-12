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
                <linearGradient id="satellite-body" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#173766" />
                  <stop offset="100%" stopColor="#0f2343" />
                </linearGradient>
                <linearGradient id="satellite-panel" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#2f69c8" />
                  <stop offset="100%" stopColor="#194a98" />
                </linearGradient>
              </defs>

              <rect x="28" y="20" width="304" height="180" rx="32" fill="url(#plug-card-glow)" />
              <circle cx="94" cy="102" r="12" fill="#f23f5f" />
              <circle cx="76" cy="130" r="8" fill="#f7b267" />
              <circle cx="96" cy="140" r="6" fill="#88adf1" />
              <rect x="132" y="102" width="76" height="48" rx="18" fill="url(#satellite-body)" />
              <rect x="95" y="94" width="32" height="16" rx="8" fill="url(#satellite-panel)" transform="rotate(-30 95 94)" />
              <rect x="88" y="116" width="32" height="16" rx="8" fill="url(#satellite-panel)" transform="rotate(-30 88 116)" />
              <rect x="204" y="94" width="32" height="16" rx="8" fill="url(#satellite-panel)" transform="rotate(30 204 94)" />
              <rect x="211" y="116" width="32" height="16" rx="8" fill="url(#satellite-panel)" transform="rotate(30 211 116)" />
              <circle cx="170" cy="126" r="8" fill="#90b5f3" />
              <path
                d="M166 134L148 162"
                fill="none"
                stroke="#173766"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M148 162L174 184"
                fill="none"
                stroke="#173766"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M148 162L116 184"
                fill="none"
                stroke="#173766"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M222 98C246 90 268 94 286 108"
                fill="none"
                stroke="#89aae0"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <path
                d="M230 85C259 72 289 77 313 97"
                fill="none"
                stroke="#b1c8ef"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <path
                d="M228 145L304 69"
                fill="none"
                stroke="#f23f5f"
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                d="M304 145L228 69"
                fill="none"
                stroke="#f23f5f"
                strokeWidth="10"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      </section>
    </div>
  );
}
