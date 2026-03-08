export const ALWAYS_QUEUE_MUTATIONS_WHEN_ONLINE = true;

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

export function shouldTriggerQueuedBackgroundSync(isOnline: boolean): boolean {
  return isOnline;
}
