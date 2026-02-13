export type AuthMode = "login" | "register" | "reset";

export interface ChallengeRow {
  challenge_id: string;
  nome: string;
  cargo: string;
  role_suggested: "admin" | "auditor";
  cd_default: number | null;
  cds: number[];
  expires_at: string;
}

export interface ProfileContext {
  user_id: string;
  nome: string | null;
  mat: string | null;
  role: "admin" | "auditor" | "viewer" | null;
  cd_default: number | null;
  cd_nome: string | null;
}
