import { SyncArrowUpIcon } from "./icons";

interface PendingSyncBadgeProps {
  pendingCount: number;
  errorCount?: number;
  title?: string;
}

export function PendingSyncBadge({ pendingCount, errorCount = 0, title }: PendingSyncBadgeProps) {
  const hasPending = pendingCount > 0;
  const hasErrors = errorCount > 0;
  const tone = hasPending || hasErrors ? "is-pending" : "is-clear";

  return (
    <span className={`sync-pending-badge ${tone}`} title={title}>
      <span className={`sync-pending-badge-icon ${tone}`} aria-hidden="true">
        <SyncArrowUpIcon />
      </span>
      <span>
        Pendentes: {pendingCount}
        {hasErrors ? ` | Erros: ${errorCount}` : ""}
      </span>
    </span>
  );
}

