import type { ModuleIconName } from "../modules/types";

export function ModuleIcon({ name }: { name: ModuleIconName }) {
  switch (name) {
    case "chart":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 20h16" />
          <path d="M7 20v-7" />
          <path d="M12 20V9" />
          <path d="M17 20v-4" />
          <path d="M6 11l5-4 4 2 3-3" />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4" />
          <path d="M16 3v4" />
          <path d="M4 10h16" />
          <path d="M8 14h3" />
          <path d="M13 14h3" />
          <path d="M8 17h3" />
        </svg>
      );
    case "expiry":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 3h12v6l-6 4-6-4z" />
          <path d="M6 21h12" />
          <path d="M9 17h6" />
        </svg>
      );
    case "audit":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h16v12H4z" />
          <path d="M8 20h8" />
          <path d="M9 10l2 2 4-4" />
        </svg>
      );
    case "box":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 8l8-4 8 4-8 4-8-4z" />
          <path d="M4 8v8l8 4 8-4V8" />
          <path d="M12 12v8" />
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
    case "search":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6" />
          <path d="M16 16l4 4" />
        </svg>
      );
    case "barcode":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6v12" />
          <path d="M7 6v12" />
          <path d="M10 6v12" />
          <path d="M14 6v12" />
          <path d="M17 6v12" />
          <path d="M20 6v12" />
          <path d="M3 4h18" />
          <path d="M3 20h18" />
        </svg>
      );
    case "cold":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v18" />
          <path d="M12 7l-3-2" />
          <path d="M12 7l3-2" />
          <path d="M12 17l-3 2" />
          <path d="M12 17l3 2" />
          <path d="M4.5 8l15 8" />
          <path d="M7.5 6.8v3.6" />
          <path d="M16.5 13.6v3.6" />
          <path d="M19.5 8L4.5 16" />
          <path d="M16.5 6.8v3.6" />
          <path d="M7.5 13.6v3.6" />
        </svg>
      );
    case "carton-meds":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 8l8-4 8 4-8 4-8-4z" />
          <path d="M4 8v8l8 4 8-4V8" />
          <path d="M12 12v8" />
          <path d="M9.5 6.8h5" />
          <path d="M12 4.8v4" />
        </svg>
      );
    case "worker":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 9V8a4 4 0 0 1 8 0v1" />
          <path d="M7 10h10" />
          <path d="M9 10v2a3 3 0 0 0 6 0v-2" />
          <path d="M10 6h4" />
          <path d="M8.5 15.5a5.5 5.5 0 0 0 7 0" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      );
    case "location":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11z" />
          <path d="M9.5 10.5h5" />
          <path d="M12 8v5" />
        </svg>
      );
    case "collect":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 10h16v9H4z" />
          <path d="M8 10V8a4 4 0 0 1 8 0v2" />
        </svg>
      );
    case "checklist":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 5h11" />
          <path d="M9 12h11" />
          <path d="M9 19h11" />
          <path d="M4 5l1.8 1.8L8 4.6" />
          <path d="M4 12l1.8 1.8L8 11.6" />
          <path d="M4 19l1.8 1.8L8 18.6" />
        </svg>
      );
    case "path":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 20c0-3 4-3 4-6s-4-3-4-6 4-3 4-4" />
          <circle cx="7" cy="20" r="1.5" />
          <circle cx="11" cy="14" r="1.5" />
          <circle cx="7" cy="8" r="1.5" />
          <circle cx="11" cy="4" r="1.5" />
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
    case "qr":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="6" height="6" rx="1" />
          <rect x="14" y="4" width="6" height="6" rx="1" />
          <rect x="4" y="14" width="6" height="6" rx="1" />
          <path d="M7 6.5h0" />
          <path d="M17 6.5h0" />
          <path d="M7 16.5h0" />
          <path d="M13 13h2" />
          <path d="M13 17v3" />
          <path d="M17 13v2" />
          <path d="M16 16h4" />
          <path d="M18 19h2" />
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

export function HolidayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M4 10h16" />
      <path d="M9 14l6 0" />
      <path d="M12 13l0 6" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
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

export function ViewGridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" />
    </svg>
  );
}

export function ViewListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="7" r="1.2" />
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="6" cy="17" r="1.2" />
      <path d="M10 7h10" />
      <path d="M10 12h10" />
      <path d="M10 17h10" />
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
