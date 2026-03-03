import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import logoImage from "../assets/logo.png";
import pmImage from "../assets/pm.png";
import { supabase, supabaseInitError } from "./lib/supabase";
import { findModuleByPath } from "./modules/registry";
import ControleValidadePage from "./modules/controle-validade/page";
import AtividadeExtraPage from "./modules/atividade-extra/page";
import BuscaProdutoPage from "./modules/busca-produto/page";
import ValidarEnderecamentoPage from "./modules/validar-enderecamento/page";
import CheckListPage from "./modules/check-list/page";
import ColetaMercadoriaPage from "./modules/coleta-mercadoria/page";
import ConferenciaEntradaNotasPage from "./modules/conferencia-entrada-notas/page";
import ConferenciaPedidoDiretoPage from "./modules/conferencia-pedido-direto/page";
import ConferenciaTermoPage from "./modules/conferencia-termo/page";
import ConferenciaVolumeAvulsoPage from "./modules/conferencia-volume-avulso/page";
import DevolucaoMercadoriaPage from "./modules/devolucao-mercadoria/page";
import MetaMesPage from "./modules/meta-mes/page";
import ProdutividadePage from "./modules/produtividade/page";
import PvpsAlocacaoPage from "./modules/pvps-alocacao/page";
import RegistroEmbarquePage from "./modules/registro-embarque/page";
import ZeradosPage from "./modules/zerados/page";
import HomePage from "./pages/HomePage";
import type { AuthMode, ChallengeRow, ProfileContext } from "./types/auth";
import type { ColetaModuleProfile } from "./modules/coleta-mercadoria/types";
import { clearUserColetaSessionCache } from "./modules/coleta-mercadoria/storage";
import type { AtividadeExtraModuleProfile } from "./modules/atividade-extra/types";
import type { BuscaProdutoModuleProfile } from "./modules/busca-produto/types";
import type { ValidarEnderecamentoModuleProfile } from "./modules/validar-enderecamento/types";
import type { PedidoDiretoModuleProfile } from "./modules/conferencia-pedido-direto/types";
import { clearUserPedidoDiretoSessionCache } from "./modules/conferencia-pedido-direto/storage";
import type { EntradaNotasModuleProfile } from "./modules/conferencia-entrada-notas/types";
import { clearUserEntradaNotasSessionCache } from "./modules/conferencia-entrada-notas/storage";
import type { TermoModuleProfile } from "./modules/conferencia-termo/types";
import { clearUserTermoSessionCache } from "./modules/conferencia-termo/storage";
import type { VolumeAvulsoModuleProfile } from "./modules/conferencia-volume-avulso/types";
import { clearUserVolumeAvulsoSessionCache } from "./modules/conferencia-volume-avulso/storage";
import type { DevolucaoMercadoriaModuleProfile } from "./modules/devolucao-mercadoria/types";
import { clearUserDevolucaoSessionCache } from "./modules/devolucao-mercadoria/storage";
import type { InventarioModuleProfile } from "./modules/zerados/types";
import { clearUserInventarioSessionCache } from "./modules/zerados/storage";
import type { PvpsAlocacaoModuleProfile } from "./modules/pvps-alocacao/types";
import type { ProdutividadeModuleProfile } from "./modules/produtividade/types";
import type { ControleValidadeModuleProfile } from "./modules/controle-validade/types";
import { clearUserControleValidadeCache } from "./modules/controle-validade/storage";

const PASSWORD_HINT = "A senha deve ter ao menos 8 caracteres, com letras e números.";
const GLOBAL_CD_STORAGE_PREFIX = "auditoria.global_cd.v1:";
const DEFAULT_GLOBAL_CD = 2;
const SESSION_DEVICE_STORAGE_KEY = "auditoria.session_device_id.v1";
const SESSION_ACTIVITY_STORAGE_PREFIX = "auditoria.last_activity.v1:";
const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const SESSION_GUARD_CHECK_INTERVAL_MS = 60 * 1000;
const SESSION_ACTIVITY_PING_THROTTLE_MS = 15 * 1000;
const AUTH_REQUEST_TIMEOUT_MS = 25_000;
const LOGIN_RPC_TIMEOUT_MS = 15_000;
const PROFILE_RPC_TIMEOUT_MS = 12_000;
const SESSION_GUARD_RELEASE_TIMEOUT_MS = 8_000;
const SIGN_OUT_REQUEST_TIMEOUT_MS = 10_000;
const SIGN_OUT_LOCAL_TIMEOUT_MS = 4_000;
const ADMIN_EMAIL_CANDIDATES = [
  "1@pmenos.com.br",
  "0001@pmenos.com.br",
  "mat_1@login.auditoria.local",
  "mat_0001@login.auditoria.local"
];

interface CdOption {
  cd: number;
  cd_nome: string;
}

function globalCdSelectionKey(userId: string): string {
  return `${GLOBAL_CD_STORAGE_PREFIX}${userId}`;
}

function sessionActivityStorageKey(userId: string): string {
  return `${SESSION_ACTIVITY_STORAGE_PREFIX}${userId}`;
}

function resolveClientDeviceId(): string {
  if (typeof window === "undefined") return "server";

  try {
    const cached = window.localStorage.getItem(SESSION_DEVICE_STORAGE_KEY);
    if (cached && cached.trim() !== "") return cached;
  } catch {
    // Ignore storage failures and fallback to runtime id generation.
  }

  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    window.localStorage.setItem(SESSION_DEVICE_STORAGE_KEY, generated);
  } catch {
    // Ignore storage failures.
  }
  return generated;
}

function readLastActivityAt(userId: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(sessionActivityStorageKey(userId));
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeLastActivityAt(userId: string, value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(sessionActivityStorageKey(userId), String(Math.max(0, Math.trunc(value))));
  } catch {
    // Ignore storage failures.
  }
}

function clearLastActivityAt(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(sessionActivityStorageKey(userId));
  } catch {
    // Ignore storage failures.
  }
}

function normalizeMat(value: string): string {
  return value.replace(/\D/g, "");
}

function canonicalMat(value: string): string {
  const normalized = normalizeMat(value);
  const stripped = normalized.replace(/^0+(?=\d)/, "");
  return stripped || normalized;
}

type RequestTimeoutError = Error & { code: "REQUEST_TIMEOUT" };

function createRequestTimeoutError(operation: string, timeoutMs: number): RequestTimeoutError {
  const error = new Error(`REQUEST_TIMEOUT:${operation}:${timeoutMs}`) as RequestTimeoutError;
  error.code = "REQUEST_TIMEOUT";
  return error;
}

function isRequestTimeoutError(error: unknown): error is RequestTimeoutError {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "REQUEST_TIMEOUT";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const timeoutId = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(createRequestTimeoutError(operation, timeoutMs));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withTimeoutRetry<T>(
  operationFactory: () => Promise<T>,
  timeoutMs: number,
  operation: string,
  retries = 1
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await withTimeout(operationFactory(), timeoutMs, operation);
    } catch (error) {
      if (!isRequestTimeoutError(error) || attempt >= retries) {
        throw error;
      }
      attempt += 1;
      await delayMs(Math.min(600, attempt * 300));
    }
  }
}

function extractMatFromLoginEmail(email: string | undefined): string {
  if (!email) return "";
  const matched = /^(?:mat_)?(\d+)@(login\.auditoria\.local|pmenos\.com\.br)$/i.exec(email);
  return matched ? matched[1] : "";
}

function passwordIsStrong(password: string): boolean {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
}

function asErrorMessage(error: unknown): string {
  if (isRequestTimeoutError(error)) {
    return "Tempo de resposta do servidor excedido. Tente novamente.";
  }

  let raw = "Erro inesperado.";
  if (error instanceof Error) {
    raw = error.message;
  } else if (typeof error === "string") {
    raw = error;
  } else if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : typeof candidate.error_description === "string"
          ? candidate.error_description
          : null;
    const details = typeof candidate.details === "string" ? candidate.details : null;
    raw = [message, details].filter(Boolean).join(" - ") || "Erro inesperado.";
  }

  if (raw.includes("Invalid login credentials")) return "Matrícula ou senha inválida.";
  if (raw.includes("Email not confirmed")) {
    return "Cadastro criado, mas a conta não foi confirmada. Se necessário, desative confirmação de e-mail no Supabase Auth.";
  }
  if (raw.includes("MATRICULA_INVALIDA")) return "Matrícula inválida.";
  if (raw.includes("MATRICULA_OU_DATAS_INVALIDAS")) return "Matrícula, data de nascimento ou data de admissão inválidas.";
  if (raw.includes("MATRICULA_JA_CADASTRADA")) return "Esta matrícula já está cadastrada.";
  if (raw.includes("USUARIO_NAO_CADASTRADO")) {
    return "Matrícula encontrada no BD_USUARIO, mas sem conta no app. Faça o cadastro primeiro.";
  }
  if (raw.includes("MATRICULA_MULTIPLOS_CDS")) {
    return "Esta matrícula está associada a mais de um CD. Ajuste os dados de origem para manter 1 CD por usuário.";
  }
  if (raw.includes("SENHA_FRACA_MIN_8") || raw.includes("SENHA_DEVE_TER_LETRAS_E_NUMEROS")) {
    return PASSWORD_HINT;
  }
  if (raw.includes("Failed to fetch") || raw.includes("NetworkError") || raw.includes("Load failed")) {
    return "Sem conexão com o servidor. Verifique sua internet e tente novamente.";
  }
  if (raw.includes("AUTH_REQUIRED")) return "Sessão não autenticada para concluir cadastro.";
  if (raw.includes("JÃ¡ utilizada") || raw.includes("Já utilizada")) {
    return "Validação já utilizada. Refaça a validação dos dados.";
  }
  if (raw.includes("CHALLENGE_EXPIRADO")) return "Validação expirada. Valide os dados novamente.";
  if (raw.includes("CHALLENGE_INVALIDO")) return "Validação inválida. Refaça a validação dos dados.";
  if (raw.includes("CHALLENGE_JA_CONSUMIDO")) return "Validação já utilizada. Refaça a validação.";
  return raw;
}

function cdDescriptionOnly(value: string): string {
  return value
    .replace(/^cd\s*\d+\s*[-–]\s*/i, "")
    .replace(/^cd\s*\d+\s*/i, "")
    .trim();
}

function parseCdNumber(rawCd: string, cdDefault: number | null): number | null {
  if (typeof cdDefault === "number" && Number.isFinite(cdDefault)) {
    return Math.trunc(cdDefault);
  }
  const matched = /cd\s*0*(\d+)/i.exec(rawCd);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCdLabel(rawCd: string, cdDefault: number | null, isGlobalAdmin: boolean): string {
  if (isGlobalAdmin) return "Todos CDs";

  const cdNumber = parseCdNumber(rawCd, cdDefault);
  const cdDescription = cdDescriptionOnly(rawCd);

  if (cdNumber != null && cdDescription) {
    return `CD ${String(cdNumber).padStart(2, "0")} - ${cdDescription}`;
  }
  if (cdNumber != null) {
    return `CD ${String(cdNumber).padStart(2, "0")}`;
  }
  if (cdDescription) {
    return cdDescription;
  }
  return "CD não definido";
}

function formatCdOptionLabel(cd: number, cdNome: string): string {
  const base = `CD ${String(cd).padStart(2, "0")}`;
  const compactNome = cdNome.trim().replace(/\s+/g, " ");
  if (!compactNome) return base;
  const cdDescription = compactNome
    .replace(/^cd\s*0*\d+\s*[-–]?\s*/i, "")
    .trim();
  if (!cdDescription) return base;
  return `${base} - ${cdDescription}`;
}

function roleLabel(role: "admin" | "auditor" | "viewer" | null): string {
  if (role === "admin") return "Admin";
  if (role === "viewer") return "Viewer";
  return "Auditor";
}

const CARGO_EXACT_LABELS: Record<string, string> = {
  "ASSISTENTE PREVENCAO DE PERDAS": "Assistente de Prevenção de Perdas",
  "SUPERVISOR PREVENCAO DE PERDAS": "Supervisor de Prevenção de Perdas",
  "ANALISTA PREVENCAO DE PERDAS": "Analista de Prevenção de Perdas",
  "COORDENADOR PREVENCAO DE PERDAS": "Coordenador de Prevenção de Perdas",
  "GERENTE PREVENCAO DE PERDAS": "Gerente de Prevenção de Perdas",
  "LIDER PREVENCAO DE PERDAS": "Líder de Prevenção de Perdas"
};

function titleCasePtBr(value: string): string {
  const skipWords = new Set(["de", "da", "do", "das", "dos", "e"]);
  return value
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((token, index) => {
      if (!token) return token;
      if (index > 0 && skipWords.has(token)) return token;
      return token.charAt(0).toLocaleUpperCase("pt-BR") + token.slice(1);
    })
    .join(" ");
}

function normalizeCargoLabel(rawCargo: string | null | undefined): string {
  const compact = (rawCargo ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!compact) return "Cargo não informado";

  const exact = CARGO_EXACT_LABELS[compact.toUpperCase()];
  if (exact) return exact;

  const corrected = compact
    .replace(/\bPREVENCAO\b/gi, "prevenção")
    .replace(/\bLIDER\b/gi, "líder")
    .replace(/\bLOGISTICA\b/gi, "logística")
    .replace(/\bOPERACAO\b/gi, "operação")
    .replace(/\bSUPERVISAO\b/gi, "supervisão")
    .replace(/\bCONFERENCIA\b/gi, "conferência")
    .replace(/\bADMINISTRACAO\b/gi, "administração");

  return titleCasePtBr(corrected);
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function hasProfileCargoAndCd(context: ProfileContext): boolean {
  const hasCargo = hasText(context.cargo);
  const hasCd = context.cd_default != null || hasText(context.cd_nome);
  return hasCargo && hasCd;
}

function hasProfileRole(context: ProfileContext): boolean {
  return context.role === "admin" || context.role === "auditor" || context.role === "viewer";
}

const PROFILE_CACHE_PREFIX = "auditoria.profile_context.v1:";

function profileCacheKey(userId: string): string {
  return `${PROFILE_CACHE_PREFIX}${userId}`;
}

function parseRole(value: unknown): ProfileContext["role"] {
  return value === "admin" || value === "auditor" || value === "viewer" ? value : null;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readCachedProfileContext(userId: string): ProfileContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(profileCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProfileContext> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.user_id !== "string" || parsed.user_id !== userId) return null;
    return {
      user_id: parsed.user_id,
      nome: typeof parsed.nome === "string" ? parsed.nome : null,
      mat: typeof parsed.mat === "string" ? normalizeMat(parsed.mat) : null,
      role: parseRole(parsed.role),
      cargo: typeof parsed.cargo === "string" ? parsed.cargo : null,
      cd_default: parseInteger(parsed.cd_default),
      cd_nome: typeof parsed.cd_nome === "string" ? parsed.cd_nome : null
    };
  } catch {
    return null;
  }
}

function writeCachedProfileContext(context: ProfileContext): void {
  if (typeof window === "undefined" || !context.user_id) return;
  try {
    window.localStorage.setItem(profileCacheKey(context.user_id), JSON.stringify(context));
  } catch {
    // Ignore storage failures (private mode/quota/etc).
  }
}

function mergeProfileContext(primary: ProfileContext, fallback: ProfileContext | null): ProfileContext {
  if (!fallback) return primary;
  const keepPrimaryCd = primary.cd_default != null || (primary.role === "admin" && primary.cd_default == null);
  const mergedCdDefault = keepPrimaryCd ? primary.cd_default : fallback.cd_default;
  const primaryCdNome = hasText(primary.cd_nome) ? primary.cd_nome : null;
  const fallbackCdNome = hasText(fallback.cd_nome) ? fallback.cd_nome : null;
  const mergedCdNome =
    primaryCdNome
    || (keepPrimaryCd && primary.role === "admin" && primary.cd_default == null ? "Todos CDs" : null)
    || fallbackCdNome;

  return {
    user_id: primary.user_id || fallback.user_id,
    nome: primary.nome || fallback.nome,
    mat: primary.mat || fallback.mat,
    role: primary.role || fallback.role,
    cargo: hasText(primary.cargo) ? primary.cargo : (hasText(fallback.cargo) ? fallback.cargo : null),
    cd_default: mergedCdDefault,
    cd_nome: mergedCdNome
  };
}

async function probeInternetConnection(timeoutMs = 3500): Promise<boolean> {
  if (typeof window === "undefined") return true;
  if (!navigator.onLine) return false;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const probeUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.origin);
    probeUrl.searchParams.set("_", `${Date.now()}`);

    const response = await fetch(probeUrl.toString(), {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
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

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M4 10h16" />
    </svg>
  );
}

interface PasswordFieldProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  visible: boolean;
  onToggleVisible: () => void;
}

function PasswordField({
  name,
  value,
  onChange,
  autoComplete,
  visible,
  onToggleVisible
}: PasswordFieldProps) {
  return (
    <div className="password-wrap">
      <span className="field-icon" aria-hidden="true">
        <LockIcon />
      </span>
      <input
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        data-lpignore="true"
        data-1p-ignore="true"
        data-form-type="other"
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

function formatDateForDisplay(value: string): string {
  if (!value) return "";
  const [yyyy, mm, dd] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!yyyy || !mm || !dd) return value;
  const parsed = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(parsed);
}

interface DateInputFieldProps {
  value: string;
  disabled?: boolean;
  required?: boolean;
  onChange: (value: string) => void;
}

function DateInputField({ value, disabled, required, onChange }: DateInputFieldProps) {
  const displayValue = formatDateForDisplay(value);
  return (
    <div className="input-icon-wrap date-input-wrap">
      <span className="field-icon" aria-hidden="true">
        <CalendarIcon />
      </span>
      <input
        className="date-native-input"
        type="date"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
      <span className={`date-display-text${displayValue ? "" : " placeholder"}`} aria-hidden="true">
        {displayValue || "DD/MM/AAAA"}
      </span>
      <span className="date-picker-hint" aria-hidden="true">
        <CalendarIcon />
      </span>
    </div>
  );
}

async function rpcLoginEmailFromMat(mat: string): Promise<string> {
  const { data, error } = await withTimeoutRetry(
    () => Promise.resolve(supabase!.rpc("rpc_login_email_from_mat", {
      p_mat: normalizeMat(mat)
    })),
    LOGIN_RPC_TIMEOUT_MS,
    "rpc_login_email_from_mat",
    1
  );
  if (error) throw error;
  if (typeof data !== "string" || !data) {
    throw new Error("Não foi possível resolver o login por matrícula.");
  }
  return data;
}

async function rpcHasProfileByMat(mat: string): Promise<boolean> {
  const { data, error } = await withTimeoutRetry(
    () => Promise.resolve(supabase!.rpc("rpc_has_profile_by_mat", {
      p_mat: normalizeMat(mat)
    })),
    LOGIN_RPC_TIMEOUT_MS,
    "rpc_has_profile_by_mat",
    1
  );
  if (error) throw error;
  return data === true;
}

async function loginWithMatAndPassword(mat: string, password: string): Promise<Session> {
  const trySignIn = async (email: string): Promise<{ session: Session | null; invalid: boolean }> => {
    const { data, error } = await withTimeoutRetry(
      () => supabase!.auth.signInWithPassword({
        email,
        password
      }),
      AUTH_REQUEST_TIMEOUT_MS,
      "auth.signInWithPassword",
      1
    );

    if (!error && data.session) {
      return { session: data.session, invalid: false };
    }

    if (!error && !data.session) {
      return { session: null, invalid: true };
    }

    if (error?.message?.includes("Invalid login credentials")) {
      return { session: null, invalid: true };
    }

    throw error;
  };

  const rawLogin = mat.trim();
  if (rawLogin.includes("@")) {
    const direct = await trySignIn(rawLogin.toLowerCase());
    if (!direct.session) {
      throw new Error("Invalid login credentials");
    }
    return direct.session;
  }

  const normalizedMat = normalizeMat(rawLogin);
  if (!normalizedMat) {
    throw new Error("Matrícula ou login inválido.");
  }
  const canonical = canonicalMat(normalizedMat);
  const loginCandidates = new Set<string>();

  const addPatternCandidates = (matToken: string) => {
    if (!matToken) return;
    loginCandidates.add(`${matToken}@pmenos.com.br`.toLowerCase());
    loginCandidates.add(`mat_${matToken}@login.auditoria.local`.toLowerCase());
  };

  addPatternCandidates(normalizedMat);
  if (canonical && canonical !== normalizedMat) {
    addPatternCandidates(canonical);
  }

  if (normalizedMat === "1" || canonical === "1") {
    for (const email of ADMIN_EMAIL_CANDIDATES) {
      loginCandidates.add(email.toLowerCase());
    }
  }

  let gotInvalidCredentials = false;
  const attemptedEmails = new Set<string>();

  const tryCandidate = async (email: string): Promise<Session | null> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || attemptedEmails.has(normalizedEmail)) return null;
    attemptedEmails.add(normalizedEmail);

    const attempt = await trySignIn(normalizedEmail);
    if (attempt.session) {
      return attempt.session;
    }
    if (attempt.invalid) {
      gotInvalidCredentials = true;
    }
    return null;
  };

  for (const email of loginCandidates) {
    const session = await tryCandidate(email);
    if (session) return session;
  }

  const resolvedByRpc = new Set<string>();
  try {
    resolvedByRpc.add((await rpcLoginEmailFromMat(normalizedMat)).toLowerCase());
  } catch {
    // RPC is best-effort. Keep local pattern candidates.
  }

  if (canonical && canonical !== normalizedMat) {
    try {
      resolvedByRpc.add((await rpcLoginEmailFromMat(canonical)).toLowerCase());
    } catch {
      // RPC is best-effort. Keep local pattern candidates.
    }
  }

  for (const email of resolvedByRpc) {
    const session = await tryCandidate(email);
    if (session) return session;
  }

  if (gotInvalidCredentials) {
    throw new Error("Invalid login credentials");
  }

  throw new Error("Falha inesperada no login.");
}

async function rpcListAvailableCds(): Promise<CdOption[]> {
  const { data, error } = await supabase!.rpc("rpc_list_available_cds");
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      const parsedCd = parseInteger((row as Record<string, unknown>).cd);
      if (parsedCd == null) return null;
      const parsedName = (row as Record<string, unknown>).cd_nome;
      const cd_nome =
        typeof parsedName === "string" && parsedName.trim() !== ""
          ? parsedName.trim()
          : `CD ${String(parsedCd).padStart(2, "0")}`;
      return { cd: parsedCd, cd_nome };
    })
    .filter((row): row is CdOption => row != null)
    .sort((a, b) => a.cd - b.cd);
}

type SessionGuardStatus = "OK" | "REPLACED" | "IDLE_TIMEOUT";

async function rpcSessionGuardPing(params: {
  deviceId: string;
  touchActivity?: boolean;
  allowTakeover?: boolean;
  idleMinutes?: number;
}): Promise<SessionGuardStatus> {
  const { data, error } = await supabase!.rpc("rpc_session_guard_ping", {
    p_device_id: params.deviceId,
    p_touch_activity: params.touchActivity === true,
    p_allow_takeover: params.allowTakeover === true,
    p_idle_minutes: params.idleMinutes ?? 60
  });
  if (error) throw error;
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  const rawStatus = typeof row?.status === "string" ? row.status.toUpperCase() : "OK";
  if (rawStatus === "REPLACED" || rawStatus === "IDLE_TIMEOUT") return rawStatus;
  return "OK";
}

async function rpcSessionGuardRelease(deviceId: string): Promise<boolean> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase!.rpc("rpc_session_guard_release", {
      p_device_id: deviceId
    })),
    SESSION_GUARD_RELEASE_TIMEOUT_MS,
    "rpc_session_guard_release"
  );
  if (error) throw error;
  return data === true;
}

function isRecoverableSignOutError(error: unknown): boolean {
  if (isRequestTimeoutError(error)) return true;
  const friendly = asErrorMessage(error);
  return friendly === "Sem conexão com o servidor. Verifique sua internet e tente novamente.";
}

async function signOutWithFallback(): Promise<{ usedLocalFallback: boolean }> {
  try {
    const { error } = await withTimeout(
      Promise.resolve(supabase!.auth.signOut()),
      SIGN_OUT_REQUEST_TIMEOUT_MS,
      "auth.signOut"
    );
    if (error) throw error;
    return { usedLocalFallback: false };
  } catch (error) {
    if (!isRecoverableSignOutError(error)) throw error;
    const { error: localError } = await withTimeout(
      Promise.resolve(supabase!.auth.signOut({ scope: "local" })),
      SIGN_OUT_LOCAL_TIMEOUT_MS,
      "auth.signOut.local"
    );
    if (localError) throw localError;
    return { usedLocalFallback: true };
  }
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
  const meta = session.user.user_metadata ?? {};
  const matByMeta = typeof meta.mat === "string" ? meta.mat : "";
  const nomeByMeta = typeof meta.nome === "string" ? meta.nome : "";
  const cargoByMeta = typeof meta.cargo === "string" ? meta.cargo : "";
  const cdNomeByMeta = typeof meta.cd_nome === "string" ? meta.cd_nome : "";
  const cdDefaultByMeta = parseInteger(meta.cd_default);
  const roleByMeta = parseRole(meta.role);

  return {
    user_id: session.user.id,
    nome: nomeByMeta || "Usuário",
    mat: normalizeMat(matByMeta || extractMatFromLoginEmail(session.user.email)),
    role: roleByMeta,
    cargo: cargoByMeta || null,
    cd_default: cdDefaultByMeta,
    cd_nome: cdNomeByMeta || null
  };
}

async function rpcCurrentProfileContext(session: Session): Promise<ProfileContext> {
  try {
    const v2Result = await withTimeout(
      Promise.resolve(supabase!.rpc("rpc_current_profile_context_v2")),
      PROFILE_RPC_TIMEOUT_MS,
      "rpc_current_profile_context_v2"
    );
    if (!v2Result.error) {
      const row = Array.isArray(v2Result.data) ? v2Result.data[0] : null;
      if (row && typeof row === "object") {
        return row as ProfileContext;
      }
    }
  } catch (error) {
    if (isRequestTimeoutError(error)) {
      return fallbackProfileFromSession(session);
    }
  }

  let legacyResult;
  try {
    legacyResult = await withTimeout(
      Promise.resolve(supabase!.rpc("rpc_current_profile_context")),
      PROFILE_RPC_TIMEOUT_MS,
      "rpc_current_profile_context"
    );
  } catch {
    return fallbackProfileFromSession(session);
  }

  const legacyRow = Array.isArray(legacyResult.data) ? legacyResult.data[0] : null;
  if (legacyResult.error || !legacyRow || typeof legacyRow !== "object") {
    return fallbackProfileFromSession(session);
  }

  return {
    ...(legacyRow as Omit<ProfileContext, "cargo">),
    cargo: null
  };
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

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
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  const [loadingSession, setLoadingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [forcedLogoutNotice, setForcedLogoutNotice] = useState<{ title: string; message: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const inactivityLastActivityAtRef = useRef<number>(Date.now());
  const lastActivityPingAtRef = useRef(0);
  const forceLogoutInFlightRef = useRef(false);
  const refreshProfileRunIdRef = useRef(0);

  const [loginMat, setLoginMat] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [globalCdOptions, setGlobalCdOptions] = useState<CdOption[]>([]);
  const [globalCdSelection, setGlobalCdSelection] = useState<number | null>(null);
  const [globalCdLoading, setGlobalCdLoading] = useState(false);
  const [showGlobalCdSwitcher, setShowGlobalCdSwitcher] = useState(false);
  const [pendingGlobalCdSelection, setPendingGlobalCdSelection] = useState<number | null>(null);

  const [registerMat, setRegisterMat] = useState("");
  const [registerDtNasc, setRegisterDtNasc] = useState("");
  const [registerDtAdm, setRegisterDtAdm] = useState("");
  const [registerChallenge, setRegisterChallenge] = useState<ChallengeRow | null>(null);
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterPasswordConfirm, setShowRegisterPasswordConfirm] = useState(false);

  const [resetMat, setResetMat] = useState("");
  const [resetDtNasc, setResetDtNasc] = useState("");
  const [resetDtAdm, setResetDtAdm] = useState("");
  const [resetChallenge, setResetChallenge] = useState<ChallengeRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetPasswordConfirm, setShowResetPasswordConfirm] = useState(false);

  const clearAlerts = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const clearRegisterValidation = () => {
    setRegisterChallenge(null);
    setRegisterPassword("");
    setRegisterPasswordConfirm("");
    setShowRegisterPassword(false);
    setShowRegisterPasswordConfirm(false);
  };

  const clearResetValidation = () => {
    setResetChallenge(null);
    setResetPassword("");
    setResetPasswordConfirm("");
    setShowResetPassword(false);
    setShowResetPasswordConfirm(false);
  };

  const refreshProfile = useCallback(async (activeSession: Session | null) => {
    const runId = refreshProfileRunIdRef.current + 1;
    refreshProfileRunIdRef.current = runId;

    if (!activeSession) {
      setProfile(null);
      return;
    }

    const isCurrentRun = () => refreshProfileRunIdRef.current === runId;
    const commitProfile = (next: ProfileContext) => {
      if (!isCurrentRun()) return;
      setProfile((current) => {
        if (!current || current.user_id !== next.user_id) return next;
        return mergeProfileContext(next, current);
      });
    };

    const cachedContext = readCachedProfileContext(activeSession.user.id);

    try {
      await withTimeout(
        Promise.resolve(supabase!.rpc("rpc_reconcile_current_profile")),
        PROFILE_RPC_TIMEOUT_MS,
        "rpc_reconcile_current_profile"
      );
    } catch {
      // Keep login flow resilient if reconcile RPC is unavailable.
    }
    const firstFetchedContext = await rpcCurrentProfileContext(activeSession);
    if (!isCurrentRun()) return;
    const firstContext = mergeProfileContext(firstFetchedContext, cachedContext);

    if (hasProfileCargoAndCd(firstContext) && hasProfileRole(firstContext)) {
      commitProfile(firstContext);
      if (isCurrentRun()) {
        writeCachedProfileContext(firstContext);
      }
      return;
    }

    const matHint = normalizeMat(
      firstContext.mat
      || fallbackProfileFromSession(activeSession).mat
      || extractMatFromLoginEmail(activeSession.user.email)
    );

    if (matHint) {
      try {
        await withTimeout(
          Promise.resolve(supabase!.rpc("rpc_reconcile_profile_by_mat", { p_mat: matHint })),
          PROFILE_RPC_TIMEOUT_MS,
          "rpc_reconcile_profile_by_mat"
        );
      } catch {
        // Keep login resilient even when reconcile by mat is unavailable.
      }
    }

    const secondFetchedContext = await rpcCurrentProfileContext(activeSession);
    if (!isCurrentRun()) return;
    const secondContext = mergeProfileContext(secondFetchedContext, firstContext);
    const resolvedContext =
      hasProfileCargoAndCd(secondContext) && hasProfileRole(secondContext)
        ? secondContext
        : firstContext;

    commitProfile(resolvedContext);
    if (isCurrentRun() && hasProfileCargoAndCd(resolvedContext) && hasProfileRole(resolvedContext)) {
      writeCachedProfileContext(resolvedContext);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const bootstrapSession = async () => {
      try {
        const { data } = await supabase!.auth.getSession();
        if (!mounted) return;
        setSession(data.session);
        void refreshProfile(data.session);
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

  useEffect(() => {
    if (!session) {
      document.title = authMode === "register" ? "Cadastro" : authMode === "reset" ? "Redefinir senha" : "Login";
      return;
    }
    const activeModule = findModuleByPath(location.pathname);
    document.title = activeModule ? activeModule.title : "Início";
  }, [authMode, location.pathname, session]);

  useEffect(() => {
    let mounted = true;
    let inFlight = false;

    const checkConnectivity = async () => {
      if (inFlight) return;
      inFlight = true;
      const connected = await probeInternetConnection();
      if (mounted) {
        setIsOnline(connected);
      }
      inFlight = false;
    };

    const handleOnline = () => {
      void checkConnectivity();
    };

    const handleOffline = () => {
      if (mounted) {
        setIsOnline(false);
      }
    };

    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void checkConnectivity();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisible);

    void checkConnectivity();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkConnectivity();
      }
    }, 15000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, []);

  useEffect(() => {
    if (!showLogoutConfirm) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !logoutBusy) {
        setShowLogoutConfirm(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showLogoutConfirm, logoutBusy]);

  useEffect(() => {
    if (!forcedLogoutNotice) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setForcedLogoutNotice(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [forcedLogoutNotice]);

  const onLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAlerts();
    setBusy(true);
    try {
      const activeSession = await loginWithMatAndPassword(loginMat, loginPassword);
      void refreshProfile(activeSession);
      setSuccessMessage("Login realizado com sucesso.");
      setLoginPassword("");
      navigate("/inicio", { replace: true });
    } catch (error) {
      const friendly = asErrorMessage(error);
      if (friendly === "Matrícula ou senha inválida.") {
        const normalizedLoginMat = normalizeMat(loginMat);
        if (normalizedLoginMat) {
          try {
            const hasProfile = await rpcHasProfileByMat(normalizedLoginMat);
            if (!hasProfile) {
              setErrorMessage("Matrícula sem cadastro. Use \"Quero me cadastrar\" para criar sua conta.");
            } else {
              setErrorMessage(friendly);
            }
          } catch {
            setErrorMessage(friendly);
          }
        } else {
          setErrorMessage(friendly);
        }
      } else {
        setErrorMessage(friendly);
      }
    } finally {
      setBusy(false);
    }
  };

  const onValidateRegisterIdentity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAlerts();
    setBusy(true);
    try {
      const challenge = await rpcStartIdentityChallenge(
        registerMat,
        registerDtNasc,
        registerDtAdm,
        "register"
      );
      setRegisterChallenge(challenge);
      setSuccessMessage("Dados validados. Agora defina sua senha.");
    } catch (error) {
      setErrorMessage(asErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAlerts();
    setBusy(true);
    try {
      if (!registerChallenge) {
        throw new Error("Valide matrícula e datas antes de definir a senha.");
      }
      if (registerPassword !== registerPasswordConfirm) {
        throw new Error("As senhas não conferem.");
      }
      if (!passwordIsStrong(registerPassword)) {
        throw new Error(PASSWORD_HINT);
      }

      const email = await rpcLoginEmailFromMat(registerMat);

      const signUpResult = await supabase!.auth.signUp({
        email,
        password: registerPassword,
        options: {
          data: {
            mat: normalizeMat(registerMat),
            nome: registerChallenge.nome
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
        p_challenge_id: registerChallenge.challenge_id
      });
      if (completeError) throw completeError;

      const { data: sessionData } = await supabase!.auth.getSession();
      await refreshProfile(sessionData.session);
      setSuccessMessage("Cadastro concluído com sucesso. Você já está logado.");
      setAuthMode("login");
      setRegisterMat("");
      setRegisterDtNasc("");
      setRegisterDtAdm("");
      clearRegisterValidation();
      navigate("/inicio", { replace: true });
    } catch (error) {
      setErrorMessage(asErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const onValidateResetIdentity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAlerts();
    setBusy(true);
    try {
      const challenge = await rpcStartIdentityChallenge(
        resetMat,
        resetDtNasc,
        resetDtAdm,
        "reset_password"
      );
      setResetChallenge(challenge);
      setSuccessMessage("Dados validados. Agora defina a nova senha.");
    } catch (error) {
      const friendly = asErrorMessage(error);
      if (friendly.includes("sem conta no app")) {
        try {
          const { data: reconciled, error: reconcileError } = await supabase!.rpc(
            "rpc_reconcile_profile_by_mat",
            { p_mat: normalizeMat(resetMat) }
          );
          if (reconcileError) throw reconcileError;

          if (reconciled === true) {
            const challenge = await rpcStartIdentityChallenge(
              resetMat,
              resetDtNasc,
              resetDtAdm,
              "reset_password"
            );
            setResetChallenge(challenge);
            setSuccessMessage("Conta reconciliada com sucesso. Agora defina a nova senha.");
            return;
          }
        } catch {
          // Fall through to cadastro hint when reconcile cannot confirm account/profile.
        }

        setRegisterMat(resetMat);
        setRegisterDtNasc(resetDtNasc);
        setRegisterDtAdm(resetDtAdm);
        clearRegisterValidation();
        clearResetValidation();
        setAuthMode("register");
        setSuccessMessage("Esta matrícula ainda não tem conta. Continue em Cadastro para criar a senha.");
      } else {
        setErrorMessage(friendly);
      }
    } finally {
      setBusy(false);
    }
  };

  const onResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAlerts();
    setBusy(true);
    try {
      if (!resetChallenge) {
        throw new Error("Valide matrícula e datas antes de definir a nova senha.");
      }
      if (resetPassword !== resetPasswordConfirm) {
        throw new Error("As senhas não conferem.");
      }
      if (!passwordIsStrong(resetPassword)) {
        throw new Error(PASSWORD_HINT);
      }

      const { data, error } = await supabase!.rpc("rpc_reset_password_with_challenge", {
        p_challenge_id: resetChallenge.challenge_id,
        p_new_password: resetPassword
      });
      if (error) throw error;
      if (data !== true) {
        throw new Error("Não foi possível redefinir a senha.");
      }

      setSuccessMessage("Senha redefinida com sucesso. Faça login novamente.");
      setAuthMode("login");
      setLoginMat(resetMat);
      setResetMat("");
      setResetDtNasc("");
      setResetDtAdm("");
      clearResetValidation();
    } catch (error) {
      setErrorMessage(asErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openLogoutConfirm = () => {
    setShowLogoutConfirm(true);
  };

  const closeLogoutConfirm = () => {
    if (logoutBusy) return;
    setShowLogoutConfirm(false);
  };

  const executeSignOut = useCallback(async (options?: { successMessage?: string; releaseSessionGuard?: boolean }) => {
    const shouldReleaseSessionGuard = options?.releaseSessionGuard !== false;
    const nextSuccessMessage = options?.successMessage ?? "";
    setLogoutBusy(true);
    clearAlerts();
    try {
      const currentUserId = session?.user.id;
      const deviceId = resolveClientDeviceId();
      if (currentUserId && shouldReleaseSessionGuard) {
        try {
          await rpcSessionGuardRelease(deviceId);
        } catch {
          // Ignore release failures and continue with local cleanup/signout.
        }
      }
      if (currentUserId) {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(globalCdSelectionKey(currentUserId));
        }
        clearLastActivityAt(currentUserId);
        try {
          await clearUserColetaSessionCache(currentUserId);
        } catch {
          // Ignore local cleanup failures and proceed with logout.
        }
        try {
          await clearUserControleValidadeCache(currentUserId);
        } catch {
          // Ignore local cleanup failures and proceed with logout.
        }
        try {
          await clearUserTermoSessionCache(currentUserId);
        } catch {
          // Ignore local cleanup failures and proceed with logout.
        }
        try {
          await clearUserPedidoDiretoSessionCache(currentUserId);
        } catch {
          // Ignore local cleanup failures and proceed with logout.
        }
        try {
          await clearUserVolumeAvulsoSessionCache(currentUserId);
        } catch {
          // Ignore local cleanup failures and proceed with logout.
        }
        try {
          await clearUserEntradaNotasSessionCache(currentUserId);
        } catch {
          // Ignore local cleanup failures and proceed with logout.
        }
        try {
          await clearUserDevolucaoSessionCache(currentUserId);
        } catch {
          // Ignore local cleanup failures and proceed with logout.
        }
        try {
          await clearUserInventarioSessionCache(currentUserId);
        } catch {
          // Ignore local cleanup failures and proceed with logout.
        }
      }
      const signOutResult = await signOutWithFallback();
      setAuthMode("login");
      clearRegisterValidation();
      clearResetValidation();
      if (signOutResult.usedLocalFallback && nextSuccessMessage) {
        setSuccessMessage("Sessão local encerrada. O servidor não respondeu ao logout.");
      } else if (nextSuccessMessage) {
        setSuccessMessage(nextSuccessMessage);
      }
      navigate("/", { replace: true });
    } catch (error) {
      setErrorMessage(asErrorMessage(error));
    } finally {
      setLogoutBusy(false);
      setShowLogoutConfirm(false);
    }
  }, [navigate, session?.user.id]);

  const onLogout = async () => {
    setForcedLogoutNotice(null);
    await executeSignOut({ successMessage: "Sessão encerrada.", releaseSessionGuard: true });
  };

  const handleForcedLogout = useCallback(async (reason: "replaced" | "idle_timeout") => {
    if (forceLogoutInFlightRef.current) return;
    forceLogoutInFlightRef.current = true;

    const notice =
      reason === "replaced"
        ? {
            title: "Sessão encerrada por segurança",
            message: "Seu acesso foi iniciado em outro dispositivo. Esta sessão foi encerrada automaticamente."
          }
        : {
            title: "Sessão encerrada por inatividade",
            message: "Você ficou 1 hora sem atividade. Faça login novamente para continuar."
          };

    setForcedLogoutNotice(notice);
    try {
      await executeSignOut({ successMessage: "", releaseSessionGuard: false });
    } finally {
      forceLogoutInFlightRef.current = false;
    }
  }, [executeSignOut]);

  useEffect(() => {
    if (!session) return;

    const userId = session.user.id;
    const deviceId = resolveClientDeviceId();
    const now = Date.now();
    const storedLastActivity = readLastActivityAt(userId);
    const effectiveLastActivity = storedLastActivity ?? now;

    inactivityLastActivityAtRef.current = effectiveLastActivity;
    lastActivityPingAtRef.current = 0;

    if (now - effectiveLastActivity >= SESSION_IDLE_TIMEOUT_MS) {
      void handleForcedLogout("idle_timeout");
      return;
    }

    writeLastActivityAt(userId, effectiveLastActivity);

    let cancelled = false;
    let guardInFlight = false;

    const processGuardStatus = (status: SessionGuardStatus) => {
      if (cancelled) return;
      if (status === "REPLACED") {
        void handleForcedLogout("replaced");
        return;
      }
      if (status === "IDLE_TIMEOUT") {
        void handleForcedLogout("idle_timeout");
      }
    };

    const pingGuard = async (touchActivity: boolean, allowTakeover: boolean) => {
      if (guardInFlight || cancelled) return;
      guardInFlight = true;
      try {
        const status = await rpcSessionGuardPing({
          deviceId,
          touchActivity,
          allowTakeover,
          idleMinutes: 60
        });
        processGuardStatus(status);
      } catch {
        // Keep the app usable if session guard RPC is temporarily unavailable.
      } finally {
        guardInFlight = false;
      }
    };

    void pingGuard(true, true);

    const touchActivity = () => {
      const activityAt = Date.now();
      inactivityLastActivityAtRef.current = activityAt;
      writeLastActivityAt(userId, activityAt);
      if (activityAt - lastActivityPingAtRef.current < SESSION_ACTIVITY_PING_THROTTLE_MS) return;
      lastActivityPingAtRef.current = activityAt;
      void pingGuard(true, false);
    };

    const checkIdleAndGuard = () => {
      const idleMs = Date.now() - inactivityLastActivityAtRef.current;
      if (idleMs >= SESSION_IDLE_TIMEOUT_MS) {
        void handleForcedLogout("idle_timeout");
        return;
      }
      void pingGuard(false, false);
    };

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      checkIdleAndGuard();
    };

    const activityEvents: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "wheel"];
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, touchActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", handleVisibility);

    const guardIntervalId = window.setInterval(checkIdleAndGuard, SESSION_GUARD_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(guardIntervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, touchActivity);
      }
    };
  }, [handleForcedLogout, session]);

  const effectiveProfile = useMemo<ProfileContext | null>(() => {
    if (!session) return null;
    const fallback = fallbackProfileFromSession(session);
    const merged = profile ? mergeProfileContext(profile, fallback) : fallback;
    return {
      ...merged,
      user_id: session.user.id
    };
  }, [profile, session]);

  const isGlobalProfile = useMemo(
    () => Boolean(effectiveProfile && effectiveProfile.role === "admin" && effectiveProfile.cd_default == null),
    [effectiveProfile]
  );

  useEffect(() => {
    if (!session) {
      setGlobalCdOptions([]);
      setGlobalCdSelection(null);
      setGlobalCdLoading(false);
      return;
    }

    if (!isGlobalProfile) {
      setGlobalCdOptions([]);
      setGlobalCdSelection(null);
      setGlobalCdLoading(false);
      return;
    }

    let mounted = true;
    const storageKey = globalCdSelectionKey(session.user.id);
    let preferredCd = DEFAULT_GLOBAL_CD;
    if (typeof window !== "undefined") {
      const cached = parseInteger(window.localStorage.getItem(storageKey));
      if (cached != null) {
        preferredCd = cached;
      }
    }
    setGlobalCdSelection((current) => current ?? preferredCd);

    const loadOptions = async () => {
      setGlobalCdLoading(true);
      try {
        const options = await rpcListAvailableCds();
        if (!mounted) return;
        setGlobalCdOptions(options);

        const nextCd =
          options.some((item) => item.cd === preferredCd)
            ? preferredCd
            : (options[0]?.cd ?? null);

        setGlobalCdSelection(nextCd);
        if (nextCd != null && typeof window !== "undefined") {
          window.localStorage.setItem(storageKey, String(nextCd));
        }
      } catch (error) {
        if (!mounted) return;
        setGlobalCdOptions([]);
        setGlobalCdSelection(preferredCd);
        setErrorMessage(asErrorMessage(error));
      } finally {
        if (mounted) {
          setGlobalCdLoading(false);
        }
      }
    };

    void loadOptions();
    return () => {
      mounted = false;
    };
  }, [isGlobalProfile, session]);

  const effectiveProfileWithCd = useMemo<ProfileContext | null>(() => {
    if (!effectiveProfile) return null;
    if (!isGlobalProfile) return effectiveProfile;

    const selectedCd = globalCdSelection ?? DEFAULT_GLOBAL_CD;
    const selectedCdName = globalCdOptions.find((item) => item.cd === selectedCd)?.cd_nome ?? null;
    return {
      ...effectiveProfile,
      cd_default: selectedCd,
      cd_nome: selectedCdName
    };
  }, [effectiveProfile, globalCdOptions, globalCdSelection, isGlobalProfile]);

  const coletaProfile = useMemo<ColetaModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const controleValidadeProfile = useMemo<ControleValidadeModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const atividadeExtraProfile = useMemo<AtividadeExtraModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const buscaProdutoProfile = useMemo<BuscaProdutoModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const validarEnderecamentoProfile = useMemo<ValidarEnderecamentoModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const termoProfile = useMemo<TermoModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const pedidoDiretoProfile = useMemo<PedidoDiretoModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const volumeAvulsoProfile = useMemo<VolumeAvulsoModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const entradaNotasProfile = useMemo<EntradaNotasModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const devolucaoProfile = useMemo<DevolucaoMercadoriaModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const inventarioProfile = useMemo<InventarioModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const pvpsAlocacaoProfile = useMemo<PvpsAlocacaoModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const produtividadeProfile = useMemo<ProdutividadeModuleProfile | null>(() => {
    if (!session || !effectiveProfileWithCd) return null;
    return {
      user_id: effectiveProfileWithCd.user_id || session.user.id,
      nome: effectiveProfileWithCd.nome || "Usuário",
      mat: normalizeMat(effectiveProfileWithCd.mat || extractMatFromLoginEmail(session.user.email)),
      role: effectiveProfileWithCd.role || "auditor",
      cd_default: effectiveProfileWithCd.cd_default,
      cd_nome: effectiveProfileWithCd.cd_nome
    };
  }, [effectiveProfileWithCd, session]);

  const displayContext = useMemo(() => {
    if (!session || !effectiveProfileWithCd) return null;
    const merged = effectiveProfileWithCd;
    const role = merged.role || "auditor";
    const isGlobalAdmin = role === "admin" && merged.cd_default == null;
    const rawCd =
      merged.cd_nome
      || (isGlobalAdmin ? "Todos CDs" : merged.cd_default != null ? `CD ${merged.cd_default}` : "CD não definido");

    return {
      nome: merged.nome || "Usuário",
      mat: merged.mat || normalizeMat(extractMatFromLoginEmail(session.user.email)),
      cargo: normalizeCargoLabel(merged.cargo),
      cdLabel: formatCdLabel(rawCd, merged.cd_default, isGlobalAdmin),
      roleLabel: roleLabel(isGlobalAdmin ? "admin" : role)
    };
  }, [effectiveProfileWithCd, session]);

  const isModuleRoute = useMemo(() => findModuleByPath(location.pathname) != null, [location.pathname]);
  if (loadingSession) {
    return (
      <div className="page-shell">
        <div className="loading-card surface-enter">
          <div className="loading-brands">
            <img className="loading-logo" src={logoImage} alt="Logo" />
            <img className="loading-pm" src={pmImage} alt="PM" />
          </div>
          <p>Carregando sessão...</p>
        </div>
      </div>
    );
  }

  if (session && displayContext) {
    return (
      <div className={`app-shell surface-enter${isModuleRoute ? " app-shell-module" : ""}`}>
        <Routes>
          <Route
            path="/inicio"
            element={(
              <HomePage
                displayContext={displayContext}
                isOnline={isOnline}
                onRequestLogout={openLogoutConfirm}
                showCdSwitcher={isGlobalProfile && globalCdOptions.length > 0}
                onRequestCdSwitcher={() => {
                  setPendingGlobalCdSelection(globalCdSelection);
                  setShowGlobalCdSwitcher(true);
                }}
              />
            )}
          />
          <Route
            path="/modulos/controle-validade"
            element={
              controleValidadeProfile ? (
                <ControleValidadePage isOnline={isOnline} profile={controleValidadeProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route
            path="/modulos/pvps-alocacao"
            element={
              pvpsAlocacaoProfile ? (
                <PvpsAlocacaoPage isOnline={isOnline} profile={pvpsAlocacaoProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route
            path="/modulos/atividade-extra"
            element={
              atividadeExtraProfile ? (
                <AtividadeExtraPage isOnline={isOnline} profile={atividadeExtraProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route
            path="/modulos/busca-produto"
            element={
              buscaProdutoProfile ? (
                <BuscaProdutoPage isOnline={isOnline} profile={buscaProdutoProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route
            path="/modulos/validar-enderecamento"
            element={
              validarEnderecamentoProfile ? (
                <ValidarEnderecamentoPage isOnline={isOnline} profile={validarEnderecamentoProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route path="/modulos/check-list" element={<CheckListPage isOnline={isOnline} userName={displayContext.nome} />} />
          <Route
            path="/modulos/coleta-mercadoria"
            element={
              coletaProfile ? (
                <ColetaMercadoriaPage isOnline={isOnline} profile={coletaProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route
            path="/modulos/conferencia-termo"
            element={
              termoProfile ? (
                <ConferenciaTermoPage isOnline={isOnline} profile={termoProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route
            path="/modulos/conferencia-volume-avulso"
            element={
              volumeAvulsoProfile ? (
                <ConferenciaVolumeAvulsoPage isOnline={isOnline} profile={volumeAvulsoProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route
            path="/modulos/conferencia-pedido-direto"
            element={
              pedidoDiretoProfile ? (
                <ConferenciaPedidoDiretoPage isOnline={isOnline} profile={pedidoDiretoProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route
            path="/modulos/conferencia-entrada-notas"
            element={
              entradaNotasProfile ? (
                <ConferenciaEntradaNotasPage isOnline={isOnline} profile={entradaNotasProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route
            path="/modulos/devolucao-mercadoria"
            element={
              devolucaoProfile ? (
                <DevolucaoMercadoriaPage isOnline={isOnline} profile={devolucaoProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route path="/modulos/registro-embarque" element={<RegistroEmbarquePage isOnline={isOnline} userName={displayContext.nome} />} />
          <Route path="/modulos/meta-mes" element={<MetaMesPage isOnline={isOnline} userName={displayContext.nome} />} />
          <Route
            path="/modulos/produtividade"
            element={
              produtividadeProfile ? (
                <ProdutividadePage isOnline={isOnline} profile={produtividadeProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route
            path="/modulos/zerados"
            element={
              inventarioProfile ? (
                <ZeradosPage isOnline={isOnline} profile={inventarioProfile} />
              ) : (
                <Navigate to="/inicio" replace />
              )
            }
          />
          <Route path="*" element={<Navigate to="/inicio" replace />} />
        </Routes>

        {showLogoutConfirm && typeof document !== "undefined"
          ? createPortal(
              <div
                className="confirm-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="logout-confirm-title"
                onClick={closeLogoutConfirm}
              >
                <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                  <h3 id="logout-confirm-title">Encerrar sessão</h3>
                  <p>Deseja realmente sair da sua conta neste dispositivo?</p>
                  <div className="confirm-actions">
                    <button
                      className="btn btn-muted"
                      type="button"
                      onClick={closeLogoutConfirm}
                      disabled={logoutBusy}
                    >
                      Cancelar
                    </button>
                    <button className="btn btn-danger" type="button" onClick={onLogout} disabled={logoutBusy}>
                      {logoutBusy ? "Saindo..." : "Sair agora"}
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}

        {showGlobalCdSwitcher && typeof document !== "undefined"
          ? createPortal(
              <div
                className="confirm-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="global-cd-switch-title"
                onClick={() => setShowGlobalCdSwitcher(false)}
              >
                <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                  <h3 id="global-cd-switch-title">Trocar CD</h3>
                  <p>Selecione o CD para continuar sem sair da conta.</p>
                  <div className="global-cd-picker" role="listbox" aria-label="Centros de distribuição disponíveis">
                    {globalCdLoading ? <div className="global-cd-picker-loading">Carregando CDs...</div> : null}
                    {!globalCdLoading && globalCdOptions.length === 0 ? (
                      <div className="global-cd-picker-empty">Nenhum CD disponível no momento.</div>
                    ) : null}
                    {!globalCdLoading
                      ? globalCdOptions.map((option) => (
                          <button
                            key={option.cd}
                            type="button"
                            className={`global-cd-option${pendingGlobalCdSelection === option.cd ? " is-selected" : ""}`}
                            onClick={() => setPendingGlobalCdSelection(option.cd)}
                          >
                            <span className="global-cd-option-label">{formatCdOptionLabel(option.cd, option.cd_nome)}</span>
                          </button>
                        ))
                      : null}
                  </div>
                  <div className="confirm-actions">
                    <button
                      className="btn btn-muted"
                      type="button"
                      onClick={() => setShowGlobalCdSwitcher(false)}
                      disabled={globalCdLoading}
                    >
                      Cancelar
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={pendingGlobalCdSelection == null || globalCdLoading}
                      onClick={() => {
                        if (!session || pendingGlobalCdSelection == null) return;
                        setGlobalCdSelection(pendingGlobalCdSelection);
                        if (typeof window !== "undefined") {
                          window.localStorage.setItem(
                            globalCdSelectionKey(session.user.id),
                            String(pendingGlobalCdSelection)
                          );
                        }
                        setShowGlobalCdSwitcher(false);
                        navigate("/inicio", { replace: true });
                      }}
                    >
                      Aplicar CD
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}

        {forcedLogoutNotice && typeof document !== "undefined"
          ? createPortal(
              <div
                className="confirm-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="forced-logout-title"
                onClick={() => setForcedLogoutNotice(null)}
              >
                <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                  <h3 id="forced-logout-title">{forcedLogoutNotice.title}</h3>
                  <p>{forcedLogoutNotice.message}</p>
                  <div className="confirm-actions">
                    <button className="btn btn-primary" type="button" onClick={() => setForcedLogoutNotice(null)}>
                      Entendi
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}
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
        <p className="auth-brand-caption">Prevenção de Perdas CDs</p>

        <section key={authMode} className="auth-panel panel-enter">
          <h1>{authMode === "login" ? "Login" : authMode === "register" ? "Cadastro" : "Redefinir senha"}</h1>
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
                    clearRegisterValidation();
                    clearResetValidation();
                  }}
              >
                ← Voltar para login
              </button>
            </div>
          ) : null}

          {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
          {successMessage ? <div className="alert success">{successMessage}</div> : null}

          {authMode === "login" && (
            <form className="form-grid" autoComplete="off" onSubmit={onLogin}>
              <label>
                Matrícula
                <div className="input-icon-wrap">
                  <span className="field-icon" aria-hidden="true">
                    <UserIcon />
                  </span>
                  <input
                    name="login_mat_no_store"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    value={loginMat}
                    onChange={(event) => setLoginMat(event.target.value.replace(/\D/g, ""))}
                    required
                  />
                </div>
              </label>
              <label>
                Senha
                <PasswordField
                  name="login_password_no_store"
                  autoComplete="new-password"
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
                    clearResetValidation();
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
                    clearRegisterValidation();
                  }}
                >
                  Esqueci minha senha
                </button>
              </div>
            </form>
          )}

          {authMode === "register" && (
            <form
              className="form-grid"
              autoComplete="off"
              onSubmit={registerChallenge ? onRegister : onValidateRegisterIdentity}
            >
              <label>
                Matrícula
                <div className="input-icon-wrap">
                  <span className="field-icon" aria-hidden="true">
                    <UserIcon />
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={registerMat}
                    disabled={Boolean(registerChallenge)}
                    onChange={(event) => {
                      setRegisterMat(event.target.value);
                      clearRegisterValidation();
                    }}
                    required
                  />
                </div>
              </label>
              <label>
                Data de nascimento
                <DateInputField
                  value={registerDtNasc}
                  disabled={Boolean(registerChallenge)}
                  onChange={(value) => {
                    setRegisterDtNasc(value);
                    clearRegisterValidation();
                  }}
                  required
                />
              </label>
              <label>
                Data de admissão
                <DateInputField
                  value={registerDtAdm}
                  disabled={Boolean(registerChallenge)}
                  onChange={(value) => {
                    setRegisterDtAdm(value);
                    clearRegisterValidation();
                  }}
                  required
                />
              </label>

              {registerChallenge ? (
                <>
                  <div className="validation-card">
                    <strong>Dados validados</strong>
                    <span>{registerChallenge.nome}</span>
                  </div>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      clearAlerts();
                      clearRegisterValidation();
                    }}
                  >
                    Alterar dados validados
                  </button>
                  <label>
                    Senha
                    <PasswordField
                      name="register_password_new"
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
                      name="register_password_confirm_new"
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
                </>
              ) : (
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? "Validando..." : "Validar dados"}
                </button>
              )}
            </form>
          )}

          {authMode === "reset" && (
            <form
              className="form-grid"
              autoComplete="off"
              onSubmit={resetChallenge ? onResetPassword : onValidateResetIdentity}
            >
              <label>
                Matrícula
                <div className="input-icon-wrap">
                  <span className="field-icon" aria-hidden="true">
                    <UserIcon />
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={resetMat}
                    disabled={Boolean(resetChallenge)}
                    onChange={(event) => {
                      setResetMat(event.target.value);
                      clearResetValidation();
                    }}
                    required
                  />
                </div>
              </label>
              <label>
                Data de nascimento
                <DateInputField
                  value={resetDtNasc}
                  disabled={Boolean(resetChallenge)}
                  onChange={(value) => {
                    setResetDtNasc(value);
                    clearResetValidation();
                  }}
                  required
                />
              </label>
              <label>
                Data de admissão
                <DateInputField
                  value={resetDtAdm}
                  disabled={Boolean(resetChallenge)}
                  onChange={(value) => {
                    setResetDtAdm(value);
                    clearResetValidation();
                  }}
                  required
                />
              </label>

              {resetChallenge ? (
                <>
                  <div className="validation-card">
                    <strong>Dados validados</strong>
                    <span>{resetChallenge.nome}</span>
                  </div>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      clearAlerts();
                      clearResetValidation();
                    }}
                  >
                    Alterar dados validados
                  </button>
                  <label>
                    Nova senha
                    <PasswordField
                      name="reset_password_new"
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
                      name="reset_password_confirm_new"
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
                </>
              ) : (
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? "Validando..." : "Validar dados"}
                </button>
              )}
            </form>
          )}
        </section>
      </div>
      {forcedLogoutNotice && typeof document !== "undefined"
        ? createPortal(
            <div
              className="confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="forced-logout-title"
              onClick={() => setForcedLogoutNotice(null)}
            >
              <div className="confirm-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
                <h3 id="forced-logout-title">{forcedLogoutNotice.title}</h3>
                <p>{forcedLogoutNotice.message}</p>
                <div className="confirm-actions">
                  <button className="btn btn-primary" type="button" onClick={() => setForcedLogoutNotice(null)}>
                    Entendi
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
