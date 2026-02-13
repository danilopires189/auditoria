import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import logoImage from "../assets/logo.png";
import pmImage from "../assets/pm.png";
import { supabase, supabaseInitError } from "./lib/supabase";
import type { AuthMode, ChallengeRow, ProfileContext } from "./types/auth";

const PASSWORD_HINT = "A senha deve ter ao menos 8 caracteres, com letras e números.";
const ADMIN_EMAIL_CANDIDATES = ["mat_1@login.auditoria.local", "mat_0001@login.auditoria.local"];

function normalizeMat(value: string): string {
  return value.replace(/\D/g, "");
}

function extractMatFromLoginEmail(email: string | undefined): string {
  if (!email) return "";
  const matched = /^mat_(\d+)@login\.auditoria\.local$/i.exec(email);
  return matched ? matched[1] : "";
}

function passwordIsStrong(password: string): boolean {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
}

function asErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Erro inesperado.";

  if (raw.includes("Invalid login credentials")) return "Matrícula ou senha inválida.";
  if (raw.includes("Email not confirmed")) {
    return "Cadastro criado, mas a conta não foi confirmada. Se necessário, desative confirmação de e-mail no Supabase Auth.";
  }
  if (raw.includes("MATRICULA_INVALIDA")) return "Matrícula inválida.";
  if (raw.includes("MATRICULA_OU_DATAS_INVALIDAS")) return "Matrícula, data de nascimento ou data de admissão inválidas.";
  if (raw.includes("MATRICULA_JA_CADASTRADA")) return "Esta matrícula já está cadastrada.";
  if (raw.includes("USUARIO_NAO_CADASTRADO")) return "Matrícula ainda não cadastrada.";
  if (raw.includes("MATRICULA_MULTIPLOS_CDS")) {
    return "Esta matrícula está associada a mais de um CD. Ajuste os dados de origem para manter 1 CD por usuário.";
  }
  if (raw.includes("SENHA_FRACA_MIN_8") || raw.includes("SENHA_DEVE_TER_LETRAS_E_NUMEROS")) {
    return PASSWORD_HINT;
  }
  if (raw.includes("AUTH_REQUIRED")) return "Sessão não autenticada para concluir cadastro.";
  return raw;
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.2A11 11 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.4 4.3" />
      <path d="M6.7 6.8A17.7 17.7 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  visible: boolean;
  onToggleVisible: () => void;
}

function PasswordField({
  value,
  onChange,
  autoComplete,
  visible,
  onToggleVisible
}: PasswordFieldProps) {
  return (
    <div className="password-wrap">
      <input
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
      <button
        type="button"
        className={`password-toggle ${visible ? "active" : ""}`}
        onClick={onToggleVisible}
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        title={visible ? "Ocultar senha" : "Mostrar senha"}
      >
        <EyeIcon open={visible} />
      </button>
    </div>
  );
}

async function rpcLoginEmailFromMat(mat: string): Promise<string> {
  const { data, error } = await supabase!.rpc("rpc_login_email_from_mat", {
    p_mat: normalizeMat(mat)
  });
  if (error) throw error;
  if (typeof data !== "string" || !data) {
    throw new Error("Não foi possível resolver o login por matrícula.");
  }
  return data;
}

async function loginWithMatAndPassword(mat: string, password: string): Promise<Session> {
  const normalizedMat = normalizeMat(mat);
  const rpcEmail = await rpcLoginEmailFromMat(normalizedMat);

  const candidates = new Set<string>([rpcEmail.toLowerCase()]);
  if (normalizedMat === "1") {
    for (const email of ADMIN_EMAIL_CANDIDATES) {
      candidates.add(email.toLowerCase());
    }
  }

  let gotInvalidCredentials = false;

  for (const email of candidates) {
    const { data, error } = await supabase!.auth.signInWithPassword({
      email,
      password
    });

    if (!error && data.session) {
      return data.session;
    }

    if (error?.message?.includes("Invalid login credentials")) {
      gotInvalidCredentials = true;
      continue;
    }

    if (error) {
      throw error;
    }
  }

  if (gotInvalidCredentials) {
    throw new Error("Invalid login credentials");
  }

  throw new Error("Falha inesperada no login.");
}

async function rpcStartIdentityChallenge(
  mat: string,
  dtNasc: string,
  dtAdm: string,
  purpose: "register" | "reset_password"
): Promise<ChallengeRow> {
  const { data, error } = await supabase!.rpc("rpc_start_identity_challenge", {
    p_mat: normalizeMat(mat),
    p_dt_nasc: dtNasc,
    p_dt_adm: dtAdm,
    p_purpose: purpose
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : null;
  if (!row || typeof row !== "object") {
    throw new Error("Challenge inválido retornado pelo backend.");
  }

  return row as ChallengeRow;
}

function fallbackProfileFromSession(session: Session): ProfileContext {
  const matByMeta = typeof session.user.user_metadata?.mat === "string" ? session.user.user_metadata.mat : "";
  const nomeByMeta = typeof session.user.user_metadata?.nome === "string" ? session.user.user_metadata.nome : "";

  return {
    user_id: session.user.id,
    nome: nomeByMeta || "Usuário",
    mat: normalizeMat(matByMeta || extractMatFromLoginEmail(session.user.email)),
    role: null,
    cd_default: null,
    cd_nome: null
  };
}

async function rpcCurrentProfileContext(session: Session): Promise<ProfileContext> {
  const { data, error } = await supabase!.rpc("rpc_current_profile_context");
  if (error) {
    return fallbackProfileFromSession(session);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row || typeof row !== "object") {
    return fallbackProfileFromSession(session);
  }

  return row as ProfileContext;
}

export default function App() {
  if (!supabase || supabaseInitError) {
    return (
      <div className="page-shell">
        <div className="auth-card surface-enter">
          <h1>Configuração pendente</h1>
          <p className="subtitle">
            O frontend não conseguiu inicializar o Supabase.
          </p>
          <div className="alert error">{supabaseInitError}</div>
          <div className="form-grid">
            <small>Defina no Vercel (Production e Preview):</small>
            <small>
              <strong>VITE_SUPABASE_URL</strong> = https://gpgqklqhomsaomdnccvu.supabase.co
            </small>
            <small>
              <strong>VITE_SUPABASE_ANON_KEY</strong> = chave publishable/anon do projeto Supabase
            </small>
            <small>Depois faça redeploy.</small>
          </div>
        </div>
      </div>
    );
  }

  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileContext | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [loginMat, setLoginMat] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [registerMat, setRegisterMat] = useState("");
  const [registerDtNasc, setRegisterDtNasc] = useState("");
  const [registerDtAdm, setRegisterDtAdm] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterPasswordConfirm, setShowRegisterPasswordConfirm] = useState(false);

  const [resetMat, setResetMat] = useState("");
  const [resetDtNasc, setResetDtNasc] = useState("");
  const [resetDtAdm, setResetDtAdm] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetPasswordConfirm, setShowResetPasswordConfirm] = useState(false);

  const clearAlerts = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const refreshProfile = useCallback(async (activeSession: Session | null) => {
    if (!activeSession) {
      setProfile(null);
      return;
    }
    const context = await rpcCurrentProfileContext(activeSession);
    setProfile(context);
  }, []);

  useEffect(() => {
    let mounted = true;

    const bootstrapSession = async () => {
      try {
        const { data } = await supabase!.auth.getSession();
        if (!mounted) return;
        setSession(data.session);
        await refreshProfile(data.session);
      } catch (error) {
        if (!mounted) return;
        setErrorMessage(asErrorMessage(error));
      } finally {
        if (mounted) setLoadingSession(false);
      }
    };

    void bootstrapSession();

    const { data: listener } = supabase!.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      void refreshProfile(nextSession);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [refreshProfile]);

  const onLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAlerts();
    setBusy(true);
    try {
      const activeSession = await loginWithMatAndPassword(loginMat, loginPassword);
      await refreshProfile(activeSession);
      setSuccessMessage("Login realizado com sucesso.");
      setLoginPassword("");
    } catch (error) {
      const friendly = asErrorMessage(error);
      if (
        friendly === "Matrícula ou senha inválida." &&
        normalizeMat(loginMat) === "1" &&
        loginPassword === "admin"
      ) {
        setErrorMessage(
          "Admin inválido neste ambiente. Confirme se o frontend está apontando para o mesmo projeto Supabase do backend e execute bootstrap no backend para garantir o seed do admin."
        );
      } else {
        setErrorMessage(friendly);
      }
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAlerts();
    setBusy(true);
    try {
      if (registerPassword !== registerPasswordConfirm) {
        throw new Error("As senhas não conferem.");
      }
      if (!passwordIsStrong(registerPassword)) {
        throw new Error(PASSWORD_HINT);
      }

      const challenge = await rpcStartIdentityChallenge(
        registerMat,
        registerDtNasc,
        registerDtAdm,
        "register"
      );

      const email = await rpcLoginEmailFromMat(registerMat);

      const signUpResult = await supabase!.auth.signUp({
        email,
        password: registerPassword,
        options: {
          data: {
            mat: normalizeMat(registerMat),
            nome: challenge.nome
          }
        }
      });
      if (signUpResult.error) throw signUpResult.error;

      if (!signUpResult.data.session) {
        const signInResult = await supabase!.auth.signInWithPassword({
          email,
          password: registerPassword
        });
        if (signInResult.error) throw signInResult.error;
      }

      const { error: completeError } = await supabase!.rpc("rpc_complete_registration", {
        p_challenge_id: challenge.challenge_id
      });
      if (completeError) throw completeError;

      const { data: sessionData } = await supabase!.auth.getSession();
      await refreshProfile(sessionData.session);
      setSuccessMessage("Cadastro concluído com sucesso. Você já está logado.");
      setAuthMode("login");
      setRegisterPassword("");
      setRegisterPasswordConfirm("");
    } catch (error) {
      setErrorMessage(asErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const onResetPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAlerts();
    setBusy(true);
    try {
      if (resetPassword !== resetPasswordConfirm) {
        throw new Error("As senhas não conferem.");
      }
      if (!passwordIsStrong(resetPassword)) {
        throw new Error(PASSWORD_HINT);
      }

      const challenge = await rpcStartIdentityChallenge(
        resetMat,
        resetDtNasc,
        resetDtAdm,
        "reset_password"
      );
      const { data, error } = await supabase!.rpc("rpc_reset_password_with_challenge", {
        p_challenge_id: challenge.challenge_id,
        p_new_password: resetPassword
      });
      if (error) throw error;
      if (data !== true) {
        throw new Error("Não foi possível redefinir a senha.");
      }

      setSuccessMessage("Senha redefinida com sucesso. Faça login novamente.");
      setAuthMode("login");
      setLoginMat(resetMat);
      setResetPassword("");
      setResetPasswordConfirm("");
    } catch (error) {
      setErrorMessage(asErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const onLogout = async () => {
    clearAlerts();
    await supabase!.auth.signOut();
    setAuthMode("login");
    setSuccessMessage("Sessão encerrada.");
  };

  const displayContext = useMemo(() => {
    if (!session) return null;
    const fallback = fallbackProfileFromSession(session);
    const merged = profile ?? fallback;
    return {
      nome: merged.nome || "Usuário",
      mat: merged.mat || normalizeMat(extractMatFromLoginEmail(session.user.email)),
      cdNome: merged.cd_nome || (merged.role === "admin" ? "Todos CDs" : "CD não definido"),
      role: merged.role || "auditor"
    };
  }, [profile, session]);

  if (loadingSession) {
    return (
      <div className="page-shell">
        <div className="loading-card surface-enter">
          <img className="loading-logo" src={logoImage} alt="Logo" />
          <p>Carregando sessão...</p>
        </div>
      </div>
    );
  }

  if (session && displayContext) {
    return (
      <div className="app-shell surface-enter">
        <header className="app-header">
          <div className="header-brand">
            <img src={logoImage} alt="Logo Auditoria" />
            <span>Painel Auditoria</span>
          </div>
          <button className="btn btn-ghost" onClick={onLogout} type="button">
            Sair
          </button>
        </header>

        <section className="profile-banner">
          <img src={pmImage} alt="Marca" />
          <div className="profile-info">
            <h1>{displayContext.nome}</h1>
            <p>Matrícula: {displayContext.mat || "-"}</p>
            <p>CD: {displayContext.cdNome}</p>
            <p>Perfil: {displayContext.role}</p>
          </div>
        </section>

        <main className="app-main">
          <article className="placeholder-card">
            <h2>Login concluído</h2>
            <p>Primeira etapa pronta. Próximo passo: telas de consulta e auditoria.</p>
          </article>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="auth-card surface-enter">
        <div className="auth-top">
          <img className="brand-logo" src={logoImage} alt="Logo Auditoria" />
          <img className="brand-stamp" src={pmImage} alt="Marca interna" />
        </div>

        <section key={authMode} className="auth-panel panel-enter">
          <h1>Acesso Auditoria</h1>
          <p className="subtitle">
            {authMode === "login"
              ? "Entre com matrícula e senha."
              : authMode === "register"
                ? "Cadastro por matrícula, nascimento e admissão."
                : "Recupere a senha com matrícula, nascimento e admissão."}
          </p>

          {authMode !== "login" ? (
            <div className="mode-head">
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  clearAlerts();
                  setAuthMode("login");
                }}
              >
                ← Voltar para login
              </button>
            </div>
          ) : null}

          {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
          {successMessage ? <div className="alert success">{successMessage}</div> : null}

          {authMode === "login" && (
            <form className="form-grid" onSubmit={onLogin}>
              <label>
                Matrícula
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="username"
                  value={loginMat}
                  onChange={(event) => setLoginMat(event.target.value)}
                  required
                />
              </label>
              <label>
                Senha
                <PasswordField
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={setLoginPassword}
                  visible={showLoginPassword}
                  onToggleVisible={() => setShowLoginPassword((value) => !value)}
                />
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Entrando..." : "Entrar"}
              </button>
              <div className="auth-links">
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    clearAlerts();
                    setAuthMode("register");
                  }}
                >
                  Quero me cadastrar
                </button>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    clearAlerts();
                    setAuthMode("reset");
                  }}
                >
                  Esqueci minha senha
                </button>
              </div>
            </form>
          )}

          {authMode === "register" && (
            <form className="form-grid" onSubmit={onRegister}>
              <label>
                Matrícula
                <input
                  type="text"
                  inputMode="numeric"
                  value={registerMat}
                  onChange={(event) => setRegisterMat(event.target.value)}
                  required
                />
              </label>
              <label>
                Data de nascimento
                <input
                  type="date"
                  value={registerDtNasc}
                  onChange={(event) => setRegisterDtNasc(event.target.value)}
                  required
                />
              </label>
              <label>
                Data de admissão
                <input
                  type="date"
                  value={registerDtAdm}
                  onChange={(event) => setRegisterDtAdm(event.target.value)}
                  required
                />
              </label>
              <label>
                Senha
                <PasswordField
                  autoComplete="new-password"
                  value={registerPassword}
                  onChange={setRegisterPassword}
                  visible={showRegisterPassword}
                  onToggleVisible={() => setShowRegisterPassword((value) => !value)}
                />
              </label>
              <label>
                Confirmar senha
                <PasswordField
                  autoComplete="new-password"
                  value={registerPasswordConfirm}
                  onChange={setRegisterPasswordConfirm}
                  visible={showRegisterPasswordConfirm}
                  onToggleVisible={() => setShowRegisterPasswordConfirm((value) => !value)}
                />
              </label>
              <small>{PASSWORD_HINT}</small>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Cadastrando..." : "Cadastrar"}
              </button>
            </form>
          )}

          {authMode === "reset" && (
            <form className="form-grid" onSubmit={onResetPassword}>
              <label>
                Matrícula
                <input
                  type="text"
                  inputMode="numeric"
                  value={resetMat}
                  onChange={(event) => setResetMat(event.target.value)}
                  required
                />
              </label>
              <label>
                Data de nascimento
                <input
                  type="date"
                  value={resetDtNasc}
                  onChange={(event) => setResetDtNasc(event.target.value)}
                  required
                />
              </label>
              <label>
                Data de admissão
                <input
                  type="date"
                  value={resetDtAdm}
                  onChange={(event) => setResetDtAdm(event.target.value)}
                  required
                />
              </label>
              <label>
                Nova senha
                <PasswordField
                  autoComplete="new-password"
                  value={resetPassword}
                  onChange={setResetPassword}
                  visible={showResetPassword}
                  onToggleVisible={() => setShowResetPassword((value) => !value)}
                />
              </label>
              <label>
                Confirmar nova senha
                <PasswordField
                  autoComplete="new-password"
                  value={resetPasswordConfirm}
                  onChange={setResetPasswordConfirm}
                  visible={showResetPasswordConfirm}
                  onToggleVisible={() => setShowResetPasswordConfirm((value) => !value)}
                />
              </label>
              <small>{PASSWORD_HINT}</small>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Atualizando..." : "Redefinir senha"}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
