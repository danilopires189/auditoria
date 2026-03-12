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
                <linearGradient id="signal-core" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#1b4588" />
                  <stop offset="100%" stopColor="#11294d" />
                </linearGradient>
              </defs>

              <rect x="28" y="20" width="304" height="180" rx="32" fill="url(#plug-card-glow)" />
              <circle cx="180" cy="112" r="58" fill="#f6f9ff" stroke="#c6d7f1" strokeWidth="6" />
              <circle cx="180" cy="136" r="8" fill="url(#signal-core)" />
              <path
                d="M180 132L180 98"
                fill="none"
                stroke="url(#signal-core)"
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                d="M180 98L156 116"
                fill="none"
                stroke="url(#signal-core)"
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                d="M180 98L204 116"
                fill="none"
                stroke="url(#signal-core)"
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                d="M152 132C162 120 174 114 180 114C186 114 198 120 208 132"
                fill="none"
                stroke="#9fbce9"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M134 120C149 102 168 92 180 92C192 92 211 102 226 120"
                fill="none"
                stroke="#c1d4f3"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M214 78L146 146"
                fill="none"
                stroke="#f23f5f"
                strokeWidth="12"
                strokeLinecap="round"
              />
              <path
                d="M106 152H254"
                fill="none"
                stroke="#d5e1f4"
                strokeWidth="6"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      </section>
    </div>
  );
}
