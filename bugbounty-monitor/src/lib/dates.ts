/** Date helpers shared by extraction, scoring and the UI. */

export const MS_PER_DAY = 86_400_000;

/**
 * Parse a date from arbitrary page text or metadata.
 * Returns null rather than guessing — a wrong launch date is worse than none.
 */
export function parseLooseDate(input: string | null | undefined, now = new Date()): Date | null {
  if (!input) return null;
  const text = input.trim();
  if (!text) return null;

  // ISO 8601 (also covers datePublished/dateModified/OpenGraph values).
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const built = buildUtc(+iso[1], +iso[2], +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0));
    if (built && plausible(built, now)) return built;
  }

  // RFC 1123 / HTTP dates and other formats Date can handle unambiguously.
  if (/\b\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}\b/.test(text) || /^[A-Za-z]{3},\s/.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime()) && plausible(parsed, now)) return parsed;
  }

  // "September 7, 2026" / "Sep 7 2026" / "7 September 2026"
  const monthName = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
  );
  if (monthName) {
    const month = monthIndex(monthName[1]);
    const built = buildUtc(+monthName[3], month + 1, +monthName[2]);
    if (built && plausible(built, now)) return built;
  }

  const dayFirst = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?,?\s+(\d{4})\b/i,
  );
  if (dayFirst) {
    const month = monthIndex(dayFirst[2]);
    const built = buildUtc(+dayFirst[3], month + 1, +dayFirst[1]);
    if (built && plausible(built, now)) return built;
  }

  // "2026/09/07" — unambiguous because the year leads.
  const ymdSlash = text.match(/\b(\d{4})\/(\d{1,2})\/(\d{1,2})\b/);
  if (ymdSlash) {
    const built = buildUtc(+ymdSlash[1], +ymdSlash[2], +ymdSlash[3]);
    if (built && plausible(built, now)) return built;
  }

  // "September 2026" — month precision only; anchor to the 1st.
  const monthYear = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{4})\b/i,
  );
  if (monthYear) {
    const built = buildUtc(+monthYear[2], monthIndex(monthYear[1]) + 1, 1);
    if (built && plausible(built, now)) return built;
  }

  // NOTE: bare `07/09/2026` is intentionally NOT parsed — DD/MM vs MM/DD is
  // ambiguous and a wrong launch date is worse than an unknown one.
  return null;
}

function monthIndex(name: string): number {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return months.indexOf(name.slice(0, 3).toLowerCase());
}

function buildUtc(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date | null {
  if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null; // e.g. Feb 30
  return date;
}

/** Reject nonsense: pre-1998 (before bug bounties existed) or far-future dates. */
export function plausible(date: Date, now = new Date()): boolean {
  const year = date.getUTCFullYear();
  if (year < 1998) return false;
  return date.getTime() <= now.getTime() + 2 * MS_PER_DAY;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / MS_PER_DAY);
}

export function daysSince(date: Date, now = new Date()): number {
  return daysBetween(date, now);
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * MS_PER_DAY);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** `Sep 7, 2026` */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return 'Unknown';
  const value = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return 'Unknown';
  return value.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** `2026-09-07` */
export function toIsoDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const value = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

export function formatRelative(date: Date | string | null | undefined, now = new Date()): string {
  if (!date) return 'Unknown';
  const value = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return 'Unknown';
  const diffMs = now.getTime() - value.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = daysSince(value, now);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}
