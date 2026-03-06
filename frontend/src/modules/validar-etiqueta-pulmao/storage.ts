import type {
  ValidarEtiquetaPulmaoAuditPayload,
  ValidarEtiquetaPulmaoPendingAuditRow,
  ValidarEtiquetaPulmaoPreferences
} from "./types";

const PREFS_PREFIX = "validar_etiqueta_pulmao:prefs:v1:";
const PENDING_PREFIX = "validar_etiqueta_pulmao:pending:v1:";
const MAX_PENDING_ROWS = 2000;

function prefsKey(userId: string): string {
  return `${PREFS_PREFIX}${userId}`;
}

function pendingKey(userId: string): string {
  return `${PENDING_PREFIX}${userId}`;
}

function defaultPreferences(): ValidarEtiquetaPulmaoPreferences {
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

function normalizeNullableInteger(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 0 ? parsed : null;
}

function normalizeNullableString(value: unknown): string | null {
  const raw = normalizeString(value);
  return raw || null;
}

function normalizeAuditPayload(payload: ValidarEtiquetaPulmaoAuditPayload): ValidarEtiquetaPulmaoAuditPayload {
  return {
    cd: Number.isFinite(payload.cd) ? Math.trunc(payload.cd) : 0,
    codigo_interno: Number.isFinite(payload.codigo_interno) ? Math.trunc(payload.codigo_interno) : 0,
    barras: normalizeString(payload.barras),
    coddv_resolvido: normalizeNullableInteger(payload.coddv_resolvido),
    descricao: normalizeNullableString(payload.descricao),
    validado: Boolean(payload.validado),
    data_hr: toIsoOrNull(payload.data_hr)
  };
}

function isValidAuditPayload(payload: ValidarEtiquetaPulmaoAuditPayload): boolean {
  return payload.cd > 0
    && payload.codigo_interno > 0
    && Boolean(payload.barras);
}

function parsePendingRows(raw: string | null): ValidarEtiquetaPulmaoPendingAuditRow[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const result: ValidarEtiquetaPulmaoPendingAuditRow[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const payloadRaw = row.payload;
      if (!payloadRaw || typeof payloadRaw !== "object") continue;
      const normalizedPayload = normalizeAuditPayload(payloadRaw as ValidarEtiquetaPulmaoAuditPayload);
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

function savePendingRows(userId: string, rows: ValidarEtiquetaPulmaoPendingAuditRow[]): void {
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

export async function getValidarEtiquetaPulmaoPreferences(userId: string): Promise<ValidarEtiquetaPulmaoPreferences> {
  if (typeof window === "undefined") return defaultPreferences();

  try {
    const raw = window.localStorage.getItem(prefsKey(userId));
    if (!raw) return defaultPreferences();
    const parsed = JSON.parse(raw) as Partial<ValidarEtiquetaPulmaoPreferences> | null;
    return {
      prefer_offline_mode: Boolean(parsed?.prefer_offline_mode)
    };
  } catch {
    return defaultPreferences();
  }
}

export async function saveValidarEtiquetaPulmaoPreferences(
  userId: string,
  preferences: ValidarEtiquetaPulmaoPreferences
): Promise<void> {
  if (typeof window === "undefined") return;

  const payload: ValidarEtiquetaPulmaoPreferences = {
    prefer_offline_mode: Boolean(preferences.prefer_offline_mode)
  };

  try {
    window.localStorage.setItem(prefsKey(userId), JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}

export async function getPendingValidarEtiquetaPulmaoAudits(userId: string): Promise<ValidarEtiquetaPulmaoPendingAuditRow[]> {
  if (typeof window === "undefined") return [];
  return parsePendingRows(window.localStorage.getItem(pendingKey(userId)));
}

export async function enqueueValidarEtiquetaPulmaoAudit(
  userId: string,
  payload: ValidarEtiquetaPulmaoAuditPayload
): Promise<ValidarEtiquetaPulmaoPendingAuditRow | null> {
  if (typeof window === "undefined") return null;
  const normalizedPayload = normalizeAuditPayload(payload);
  if (!isValidAuditPayload(normalizedPayload)) return null;

  const rows = parsePendingRows(window.localStorage.getItem(pendingKey(userId)));
  const now = new Date().toISOString();
  const row: ValidarEtiquetaPulmaoPendingAuditRow = {
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

export async function removePendingValidarEtiquetaPulmaoAudit(userId: string, localId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const normalizedId = normalizeString(localId);
  if (!normalizedId) return;

  const rows = parsePendingRows(window.localStorage.getItem(pendingKey(userId)));
  const filtered = rows.filter((item) => item.local_id !== normalizedId);
  savePendingRows(userId, filtered);
}

export async function markPendingValidarEtiquetaPulmaoAuditError(
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
