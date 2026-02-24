import type { ValidarEnderecamentoPreferences } from "./types";

const PREFS_PREFIX = "validar_enderecamento:prefs:v1:";

function prefsKey(userId: string): string {
  return `${PREFS_PREFIX}${userId}`;
}

function defaultPreferences(): ValidarEnderecamentoPreferences {
  return {
    prefer_offline_mode: false
  };
}

export async function getValidarEnderecamentoPreferences(userId: string): Promise<ValidarEnderecamentoPreferences> {
  if (typeof window === "undefined") return defaultPreferences();

  try {
    const raw = window.localStorage.getItem(prefsKey(userId));
    if (!raw) return defaultPreferences();
    const parsed = JSON.parse(raw) as Partial<ValidarEnderecamentoPreferences> | null;
    return {
      prefer_offline_mode: Boolean(parsed?.prefer_offline_mode)
    };
  } catch {
    return defaultPreferences();
  }
}

export async function saveValidarEnderecamentoPreferences(
  userId: string,
  preferences: ValidarEnderecamentoPreferences
): Promise<void> {
  if (typeof window === "undefined") return;

  const payload: ValidarEnderecamentoPreferences = {
    prefer_offline_mode: Boolean(preferences.prefer_offline_mode)
  };

  try {
    window.localStorage.setItem(prefsKey(userId), JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}
