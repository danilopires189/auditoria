import { SyncArrowUpIcon } from "./icons";

interface PendingSyncBadgeProps {
  pendingCount: number;
  errorCount?: number;
  title?: string;
  onClick?: () => void;
}

export function PendingSyncBadge({ pendingCount, errorCount = 0, title, onClick }: PendingSyncBadgeProps) {
  const hasPending = pendingCount > 0;
  const hasErrors = errorCount > 0;
  const tone = hasPending || hasErrors ? "is-pending" : "is-clear";
  const clickable = typeof onClick === "function";

  return (
    <span
      className={`sync-pending-badge ${tone}${clickable ? " is-clickable" : ""}`}
      title={title}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={clickable ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      style={clickable ? { cursor: "pointer" } : undefined}
    >
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
