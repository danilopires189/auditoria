const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

const ISO_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRAZIL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const HOUR_MINUTE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: BRAZIL_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const DATE_ONLY_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRAZIL_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRAZIL_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const DATE_TIME_SECONDS_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRAZIL_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

const TIME_SECONDS_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRAZIL_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

type InvalidFallback = "value" | string;

function resolveFallback(raw: string, fallback: InvalidFallback): string {
  return fallback === "value" ? raw : fallback;
}

export function todayIsoBrasilia(now = new Date()): string {
  return ISO_DAY_FORMATTER.format(now);
}

export function nowHourMinuteBrasilia(now = new Date()): string {
  return HOUR_MINUTE_FORMATTER.format(now);
}

export function monthStartIsoBrasilia(now = new Date()): string {
  return `${todayIsoBrasilia(now).slice(0, 7)}-01`;
}

export function monthKeyBrasilia(now = new Date()): string {
  return todayIsoBrasilia(now).slice(0, 7);
}

export function formatDateOnlyPtBR(
  value: string | null | undefined,
  emptyFallback = "-",
  invalidFallback: InvalidFallback = "value"
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return emptyFallback;

  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!matched) return resolveFallback(raw, invalidFallback);

  const year = Number.parseInt(matched[1], 10);
  const month = Number.parseInt(matched[2], 10);
  const day = Number.parseInt(matched[3], 10);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (Number.isNaN(parsed.getTime())) return resolveFallback(raw, invalidFallback);

  return DATE_ONLY_FORMATTER.format(parsed);
}

export function formatDateTimeBrasilia(
  value: string | null | undefined,
  options?: {
    includeSeconds?: boolean;
    emptyFallback?: string;
    invalidFallback?: InvalidFallback;
  }
): string {
  const raw = String(value ?? "").trim();
  const emptyFallback = options?.emptyFallback ?? "-";
  const invalidFallback = options?.invalidFallback ?? "value";

  if (!raw) return emptyFallback;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return resolveFallback(raw, invalidFallback);

  return (options?.includeSeconds ? DATE_TIME_SECONDS_FORMATTER : DATE_TIME_FORMATTER).format(parsed);
}

export function formatTimeBrasilia(
  value: string | null | undefined,
  emptyFallback = "-",
  invalidFallback: InvalidFallback = "value"
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return emptyFallback;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return resolveFallback(raw, invalidFallback);

  return TIME_SECONDS_FORMATTER.format(parsed);
}

export { BRAZIL_TIME_ZONE };
