import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import logoImage from "../assets/logo.png";
import pmImage from "../assets/pm.png";
import { supabase } from "./lib/supabase";
import type { AuthMode, ChallengeRow, ProfileContext } from "./types/auth";

const PASSWORD_HINT = "A senha deve ter ao menos 8 caracteres, com letras e números.";

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

async function rpcLoginEmailFromMat(mat: string): Promise<string> {
  const { data, error } = await supabase.rpc("rpc_login_email_from_mat", {
    p_mat: normalizeMat(mat)
  });
  if (error) throw error;
  if (typeof data !== "string" || !data) {
    throw new Error("Não foi possível resolver o login por matrícula.");
  }
  return data;
}

async function rpcStartIdentityChallenge(
  mat: string,
  dtNasc: string,
  dtAdm: string,
  purpose: "register" | "reset_password"
): Promise<ChallengeRow> {
  const { data, error } = await supabase.rpc("rpc_start_identity_challenge", {
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
  const { data, error } = await supabase.rpc("rpc_current_profile_context");
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
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileContext | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [loginMat, setLoginMat] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [registerMat, setRegisterMat] = useState("");
  const [registerDtNasc, setRegisterDtNasc] = useState("");
  const [registerDtAdm, setRegisterDtAdm] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");

  const [resetMat, setResetMat] = useState("");
  const [resetDtNasc, setResetDtNasc] = useState("");
  const [resetDtAdm, setResetDtAdm] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");

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
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      await refreshProfile(data.session);
      setLoadingSession(false);
    };

    void bootstrapSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
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
      const email = await rpcLoginEmailFromMat(loginMat);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: loginPassword
      });
      if (error) throw error;
      await refreshProfile(data.session);
      setSuccessMessage("Login realizado com sucesso.");
      setLoginPassword("");
    } catch (error) {
      setErrorMessage(asErrorMessage(error));
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

      const signUpResult = await supabase.auth.signUp({
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
        const signInResult = await supabase.auth.signInWithPassword({
          email,
          password: registerPassword
        });
        if (signInResult.error) throw signInResult.error;
      }

      const { error: completeError } = await supabase.rpc("rpc_complete_registration", {
        p_challenge_id: challenge.challenge_id
      });
      if (completeError) throw completeError;

      const { data: sessionData } = await supabase.auth.getSession();
      await refreshProfile(sessionData.session);
      setSuccessMessage("Cadastro concluído com sucesso. Você já está logado.");
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
      const { data, error } = await supabase.rpc("rpc_reset_password_with_challenge", {
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
    await supabase.auth.signOut();
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
        <div className="loading-card">
          <img className="loading-logo" src={logoImage} alt="Logo" />
          <p>Carregando sessão...</p>
        </div>
      </div>
    );
  }

  if (session && displayContext) {
    return (
      <div className="app-shell">
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
      <div className="auth-card">
        <div className="auth-top">
          <img className="brand-logo" src={logoImage} alt="Logo Auditoria" />
          <img className="brand-stamp" src={pmImage} alt="Marca interna" />
        </div>

        <h1>Acesso Auditoria</h1>
        <p className="subtitle">Entrar, cadastrar ou redefinir senha por matrícula.</p>

        <div className="tabs">
          <button
            type="button"
            className={`tab ${authMode === "login" ? "active" : ""}`}
            onClick={() => {
              clearAlerts();
              setAuthMode("login");
            }}
          >
            Login
          </button>
          <button
            type="button"
            className={`tab ${authMode === "register" ? "active" : ""}`}
            onClick={() => {
              clearAlerts();
              setAuthMode("register");
            }}
          >
            Cadastro
          </button>
          <button
            type="button"
            className={`tab ${authMode === "reset" ? "active" : ""}`}
            onClick={() => {
              clearAlerts();
              setAuthMode("reset");
            }}
          >
            Redefinir
          </button>
        </div>

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
              <input
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                required
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Entrando..." : "Entrar"}
            </button>
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
              <input
                type="password"
                autoComplete="new-password"
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
                required
              />
            </label>
            <label>
              Confirmar senha
              <input
                type="password"
                autoComplete="new-password"
                value={registerPasswordConfirm}
                onChange={(event) => setRegisterPasswordConfirm(event.target.value)}
                required
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
              <input
                type="password"
                autoComplete="new-password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                required
              />
            </label>
            <label>
              Confirmar nova senha
              <input
                type="password"
                autoComplete="new-password"
                value={resetPasswordConfirm}
                onChange={(event) => setResetPasswordConfirm(event.target.value)}
                required
              />
            </label>
            <small>{PASSWORD_HINT}</small>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Atualizando..." : "Redefinir senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
