import type {
  ValidarEnderecamentoAuditPayload,
  ValidarEnderecamentoPendingAuditRow,
  ValidarEnderecamentoPreferences
} from "./types";

const PREFS_PREFIX = "validar_enderecamento:prefs:v1:";
const PENDING_PREFIX = "validar_enderecamento:pending:v1:";
const MAX_PENDING_ROWS = 2000;

function prefsKey(userId: string): string {
  return `${PREFS_PREFIX}${userId}`;
}

function pendingKey(userId: string): string {
  return `${PENDING_PREFIX}${userId}`;
}

function defaultPreferences(): ValidarEnderecamentoPreferences {
  return {
    prefer_offline_mode: false
  };
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function toIsoOrNull(value: unknown): string | null {
  const raw = normalizeString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeAuditPayload(payload: ValidarEnderecamentoAuditPayload): ValidarEnderecamentoAuditPayload {
  return {
    cd: Number.isFinite(payload.cd) ? Math.trunc(payload.cd) : 0,
    barras: normalizeString(payload.barras),
    coddv: Number.isFinite(payload.coddv) ? Math.trunc(payload.coddv) : 0,
    descricao: normalizeString(payload.descricao),
    end_infor: normalizeString(payload.end_infor).toUpperCase(),
    end_corret: normalizeString(payload.end_corret).toUpperCase(),
    validado: Boolean(payload.validado),
    data_hr: toIsoOrNull(payload.data_hr)
  };
}

function isValidAuditPayload(payload: ValidarEnderecamentoAuditPayload): boolean {
  return payload.cd > 0
    && payload.coddv > 0
    && Boolean(payload.barras)
    && Boolean(payload.end_infor)
    && Boolean(payload.end_corret);
}

function parsePendingRows(raw: string | null): ValidarEnderecamentoPendingAuditRow[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const result: ValidarEnderecamentoPendingAuditRow[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const payloadRaw = row.payload;
      if (!payloadRaw || typeof payloadRaw !== "object") continue;
      const normalizedPayload = normalizeAuditPayload(payloadRaw as ValidarEnderecamentoAuditPayload);
      if (!isValidAuditPayload(normalizedPayload)) continue;

      const localId = normalizeString(row.local_id);
      if (!localId) continue;

      const createdAt = toIsoOrNull(row.created_at) ?? new Date().toISOString();
      const attempts = Number.parseInt(String(row.attempts ?? "0"), 10);

      result.push({
        local_id: localId,
        created_at: createdAt,
        attempts: Number.isFinite(attempts) && attempts > 0 ? attempts : 0,
        last_error: normalizeString(row.last_error) || null,
        payload: normalizedPayload
      });
    }

    result.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return result.slice(-MAX_PENDING_ROWS);
  } catch {
    return [];
  }
}

function savePendingRows(userId: string, rows: ValidarEnderecamentoPendingAuditRow[]): void {
  if (typeof window === "undefined") return;
  try {
    const normalizedRows = [...rows]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(-MAX_PENDING_ROWS);
    window.localStorage.setItem(pendingKey(userId), JSON.stringify(normalizedRows));
  } catch {
    // Ignore storage failures.
  }
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

export async function getPendingValidarEnderecamentoAudits(userId: string): Promise<ValidarEnderecamentoPendingAuditRow[]> {
  if (typeof window === "undefined") return [];
  return parsePendingRows(window.localStorage.getItem(pendingKey(userId)));
}

export async function enqueueValidarEnderecamentoAudit(
  userId: string,
  payload: ValidarEnderecamentoAuditPayload
): Promise<ValidarEnderecamentoPendingAuditRow | null> {
  if (typeof window === "undefined") return null;
  const normalizedPayload = normalizeAuditPayload(payload);
  if (!isValidAuditPayload(normalizedPayload)) return null;

  const rows = parsePendingRows(window.localStorage.getItem(pendingKey(userId)));
  const now = new Date().toISOString();
  const row: ValidarEnderecamentoPendingAuditRow = {
    local_id: `pending:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    created_at: now,
    attempts: 0,
    last_error: null,
    payload: normalizedPayload
  };
  rows.push(row);
  savePendingRows(userId, rows);
  return row;
}

export async function removePendingValidarEnderecamentoAudit(userId: string, localId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const normalizedId = normalizeString(localId);
  if (!normalizedId) return;

  const rows = parsePendingRows(window.localStorage.getItem(pendingKey(userId)));
  const filtered = rows.filter((item) => item.local_id !== normalizedId);
  savePendingRows(userId, filtered);
}

export async function markPendingValidarEnderecamentoAuditError(
  userId: string,
  localId: string,
  errorMessage: string
): Promise<void> {
  if (typeof window === "undefined") return;
  const normalizedId = normalizeString(localId);
  if (!normalizedId) return;

  const rows = parsePendingRows(window.localStorage.getItem(pendingKey(userId)));
  const next = rows.map((item) => {
    if (item.local_id !== normalizedId) return item;
    return {
      ...item,
      attempts: item.attempts + 1,
      last_error: normalizeString(errorMessage) || "Falha ao enviar registro."
    };
  });
  savePendingRows(userId, next);
}
