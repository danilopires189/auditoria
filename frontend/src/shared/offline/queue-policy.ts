export const ALWAYS_QUEUE_MUTATIONS_WHEN_ONLINE = true;
export const QUEUED_WRITE_EVENT_MIN_INTERVAL_MS = 5_000;
export const QUEUED_WRITE_FLUSH_INTERVAL_MS = 45_000;
export const READS_SILENT_REFRESH_INTERVAL_MS = 60_000;
export const OFFLINE_BASE_REFRESH_INTERVAL_MS = 60_000;

type QueuedSyncReason = "manual" | "mutation" | "online" | "focus" | "visibility" | "interval";

interface QueuedBackgroundSyncParams {
  isOnline: boolean;
  pendingCount?: number;
  reason?: QueuedSyncReason;
  now?: number;
  lastAttemptAt?: number | null;
  lastMutationAt?: number | null;
  lastSuccessfulMutationAt?: number | null;
  minIntervalMs?: number;
}

interface SilentRefreshParams {
  isOnline: boolean;
  visibilityState?: string;
  now?: number;
  lastRefreshAt?: number | null;
  minIntervalMs?: number;
}

export function shouldUseQueuedMutationFlow(params: {
  isOnline: boolean;
  preferOfflineMode?: boolean;
  hasRemoteTarget?: boolean;
}): boolean {
  if (ALWAYS_QUEUE_MUTATIONS_WHEN_ONLINE) {
    return true;
  }
  return Boolean(params.preferOfflineMode) || !params.isOnline || !Boolean(params.hasRemoteTarget);
}

export function shouldTriggerQueuedBackgroundSync(
  params: boolean | QueuedBackgroundSyncParams
): boolean {
  if (typeof params === "boolean") {
    return params;
  }

  if (!params.isOnline) return false;

  const reason = params.reason ?? "interval";
  const now = params.now ?? Date.now();
  const lastAttemptAt = params.lastAttemptAt ?? 0;
  const lastMutationAt = params.lastMutationAt ?? 0;
  const lastSuccessfulMutationAt = params.lastSuccessfulMutationAt ?? 0;
  const hasUnsyncedChanges = lastMutationAt > lastSuccessfulMutationAt;
  const minIntervalMs = params.minIntervalMs
    ?? (reason === "interval" ? QUEUED_WRITE_FLUSH_INTERVAL_MS : QUEUED_WRITE_EVENT_MIN_INTERVAL_MS);

  if (reason !== "mutation" && reason !== "manual" && typeof params.pendingCount === "number" && params.pendingCount <= 0) {
    return false;
  }

  if (reason === "manual") return true;
  if (reason === "mutation") {
    return now - lastAttemptAt >= minIntervalMs;
  }

  if (reason === "online" || reason === "focus" || reason === "visibility") {
    if (!hasUnsyncedChanges && typeof params.pendingCount === "number" && params.pendingCount <= 0) {
      return false;
    }
    return now - lastAttemptAt >= minIntervalMs;
  }

  if (!hasUnsyncedChanges) {
    return false;
  }

  return now - lastAttemptAt >= minIntervalMs;
}

export function shouldRunReadSilentRefresh(params: SilentRefreshParams): boolean {
  if (!params.isOnline) return false;
  if (params.visibilityState === "hidden") return false;

  const now = params.now ?? Date.now();
  const lastRefreshAt = params.lastRefreshAt ?? 0;
  const minIntervalMs = params.minIntervalMs ?? READS_SILENT_REFRESH_INTERVAL_MS;

  return now - lastRefreshAt >= minIntervalMs;
}

export function shouldRunOfflineBaseRefresh(params: SilentRefreshParams): boolean {
  if (!params.isOnline) return false;

  const now = params.now ?? Date.now();
  const lastRefreshAt = params.lastRefreshAt ?? 0;
  const minIntervalMs = params.minIntervalMs ?? OFFLINE_BASE_REFRESH_INTERVAL_MS;

  return now - lastRefreshAt >= minIntervalMs;
}
