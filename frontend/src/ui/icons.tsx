import type { ModuleIconName } from "../modules/types";

export function ModuleIcon({ name }: { name: ModuleIconName }) {
  switch (name) {
    case "audit":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h16v12H4z" />
          <path d="M8 20h8" />
          <path d="M9 10l2 2 4-4" />
        </svg>
      );
    case "extra":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "collect":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 10h16v9H4z" />
          <path d="M8 10V8a4 4 0 0 1 8 0v2" />
        </svg>
      );
    case "term":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 3h9l3 3v15H6z" />
          <path d="M15 3v3h3" />
          <path d="M9 12h6" />
          <path d="M9 16h6" />
        </svg>
      );
    case "volume":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 8l9-5 9 5-9 5-9-5z" />
          <path d="M3 8v8l9 5 9-5V8" />
        </svg>
      );
    case "direct":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h16v12H4z" />
          <path d="M8 10h8" />
          <path d="M8 14h5" />
        </svg>
      );
    case "notes":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 4h14v16H5z" />
          <path d="M8 9h8" />
          <path d="M8 13h8" />
          <path d="M8 17h5" />
        </svg>
      );
    case "return":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 7H4v5" />
          <path d="M4 12a8 8 0 1 0 2-5" />
        </svg>
      );
    case "ship":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 7h12v8H3z" />
          <path d="M15 10h4l2 2v3h-6z" />
          <circle cx="7" cy="17" r="2" />
          <circle cx="18" cy="17" r="2" />
        </svg>
      );
    case "goal":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2" />
          <path d="M12 19v2" />
          <path d="M3 12h2" />
          <path d="M19 12h2" />
        </svg>
      );
    case "productivity":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v18" />
          <path d="M4 12h16" />
          <path d="M7 7l10 10" />
          <path d="M17 7L7 17" />
        </svg>
      );
    case "zero":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M8.5 8.5l7 7" />
          <path d="M15.5 8.5l-7 7" />
        </svg>
      );
    default:
      return null;
  }
}

export function EyeIcon({ open }: { open: boolean }) {
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

export function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M4 10h16" />
    </svg>
  );
}

export function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M10 12h10" />
      <path d="M16 8l4 4-4 4" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
      <path d="M9 12h10" />
    </svg>
  );
}

export function SyncArrowUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V7" />
      <path d="M8.5 10.5L12 7l3.5 3.5" />
      <path d="M5 20h14" />
    </svg>
  );
}
