import type { RewardKind } from '@/lib/constants';
import type { ExtractedRewardTier, ExtractedRewards, ParsedPage } from '../types';
import { rewardLanguage } from '../classify/programClassifier';

/**
 * Reward extraction.
 *
 * Hard rule from the product spec: never invent a bounty value. Every amount
 * here traces back to literal text on the page, kept in `rawText` so a
 * researcher can check our reading.
 */

interface CurrencyDef {
  code: string;
  symbols: string[];
  /** Word forms, matched case-insensitively on word boundaries. */
  words: string[];
}

const CURRENCIES: CurrencyDef[] = [
  { code: 'USD', symbols: ['$', 'US$', 'USD$'], words: ['usd', 'us dollars?', 'dollars?'] },
  { code: 'EUR', symbols: ['€'], words: ['eur', 'euros?'] },
  { code: 'GBP', symbols: ['£'], words: ['gbp', 'pounds?', 'pounds? sterling'] },
  { code: 'INR', symbols: ['₹', 'Rs.', 'Rs'], words: ['inr', 'rupees?'] },
  { code: 'CAD', symbols: ['C$', 'CA$'], words: ['cad', 'canadian dollars?'] },
  { code: 'AUD', symbols: ['A$', 'AU$'], words: ['aud', 'australian dollars?'] },
  { code: 'JPY', symbols: ['¥'], words: ['jpy', 'yen'] },
  { code: 'CHF', symbols: [], words: ['chf', 'swiss francs?'] },
  { code: 'SEK', symbols: [], words: ['sek', 'kronor'] },
  { code: 'BTC', symbols: ['₿'], words: ['btc', 'bitcoins?'] },
  { code: 'ETH', symbols: [], words: ['eth', 'ether'] },
  { code: 'USDC', symbols: [], words: ['usdc'] },
];

/**
 * Matches an amount with its currency, e.g. `$10,000`, `EUR 5.000`, `10k USD`,
 * `0.5 BTC`. Group 1/2 = leading symbol or code, group 3 = number,
 * group 4 = magnitude suffix, group 5 = trailing code.
 */
const AMOUNT_PATTERN = new RegExp(
  String.raw`(?:(\$|€|£|₹|¥|₿|US\$|C\$|CA\$|A\$|AU\$|Rs\.?)|\b(USD|EUR|GBP|INR|CAD|AUD|JPY|CHF|SEK|BTC|ETH|USDC)\b)?\s*` +
    String.raw`([0-9][0-9,._ ]*(?:\.[0-9]+)?)\s*` +
    // The magnitude suffix must end on a word boundary, otherwise the `m` of
    // "maximum" is read as a million-multiplier.
    String.raw`(?:(k|K|m|M|thousand|million)\b)?\s*` +
    String.raw`(?:\b(USD|EUR|GBP|INR|CAD|AUD|JPY|CHF|SEK|BTC|ETH|USDC|dollars?|euros?|pounds?|rupees?)\b)?`,
  'g',
);

interface ParsedAmount {
  value: number;
  currency: string | null;
  raw: string;
  index: number;
}

function symbolToCode(symbol: string): string | null {
  const clean = symbol.trim();
  for (const currency of CURRENCIES) {
    if (currency.symbols.some((s) => s.toLowerCase() === clean.toLowerCase())) return currency.code;
  }
  return null;
}

function wordToCode(word: string): string | null {
  const clean = word.trim().toLowerCase();
  for (const currency of CURRENCIES) {
    if (currency.code.toLowerCase() === clean) return currency.code;
    if (currency.words.some((w) => new RegExp(`^${w}$`, 'i').test(clean))) return currency.code;
  }
  return null;
}

/** Parse a number that may use `,` or `.` or spaces as separators. */
function parseNumber(text: string): number | null {
  let cleaned = text.trim().replace(/[\s_]/g, '');
  if (!cleaned) return null;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    // The last separator is the decimal one: `1.234,56` vs `1,234.56`.
    cleaned =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (hasComma) {
    // `1,500` is a thousands separator; `0,5` is a decimal comma.
    cleaned = /,\d{3}(?!\d)/.test(cleaned) ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  } else if (hasDot) {
    // `1.500` with exactly three trailing digits and no other dot is European.
    if (/^\d{1,3}(?:\.\d{3})+$/.test(cleaned)) cleaned = cleaned.replace(/\./g, '');
  }

  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Find every currency amount in `text`, in order of appearance.
 *
 * `defaultCurrency` lets a bare number inside an already-currency-scoped block
 * (a reward table whose header says USD) be read as an amount. Callers working
 * on free prose should pass `requireExplicitCurrency` so that stray numbers —
 * years, item counts, CVSS scores — are never mistaken for bounties.
 */
export function findAmounts(
  text: string,
  defaultCurrency: string | null = null,
  requireExplicitCurrency = false,
): ParsedAmount[] {
  const results: ParsedAmount[] = [];
  AMOUNT_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const [raw, symbol, leadingCode, numberText, magnitude, trailingCode] = match;
    if (!numberText) continue;

    const currency =
      (symbol ? symbolToCode(symbol) : null) ??
      (leadingCode ? wordToCode(leadingCode) : null) ??
      (trailingCode ? wordToCode(trailingCode) : null);

    // Without a currency marker a bare number is not a bounty — it could be a
    // CVSS score, a day count or a version. Only accept it when the surrounding
    // text already established a currency, and never in free prose.
    if (!currency && (requireExplicitCurrency || !defaultCurrency)) continue;

    // A bare four-digit number in the year range is a date, not an amount.
    if (!currency && !magnitude && /^\s*(?:19|20)\d{2}\s*$/.test(numberText)) continue;

    let value = parseNumber(numberText);
    if (value === null) continue;

    if (magnitude) {
      const suffix = magnitude.toLowerCase();
      if (suffix === 'k' || suffix === 'thousand') value *= 1_000;
      else if (suffix === 'm' || suffix === 'million') value *= 1_000_000;
    }

    const resolved = currency ?? defaultCurrency;
    // Ignore implausible values: crypto amounts are small, fiat bounties are not
    // fractions of a unit, and nine-figure "bounties" are page noise.
    if (resolved && !['BTC', 'ETH'].includes(resolved)) {
      if (value < 1 || value > 100_000_000) continue;
    } else if (value <= 0 || value > 10_000) {
      continue;
    }

    results.push({ value, currency: resolved, raw: raw.trim(), index: match.index ?? 0 });
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* Tier extraction                                                     */
/* ------------------------------------------------------------------ */

const SEVERITY_TIERS: Array<{ name: string; rank: number; pattern: RegExp }> = [
  { name: 'Critical', rank: 5, pattern: /\bcritical\b|\bp1\b|\bseverity\s*1\b/i },
  { name: 'High', rank: 4, pattern: /\bhigh\b|\bp2\b|\bseverity\s*2\b/i },
  { name: 'Medium', rank: 3, pattern: /\bmedium\b|\bmoderate\b|\bp3\b|\bseverity\s*3\b/i },
  { name: 'Low', rank: 2, pattern: /\blow\b|\bp4\b|\bseverity\s*4\b/i },
  { name: 'Informational', rank: 1, pattern: /\binformational\b|\binfo\b|\bp5\b|\bnone\b/i },
];

const MAX_PATTERNS: RegExp[] = [
  /\b(?:maximum|max\.?|highest|up\s+to|as\s+much\s+as)\s+(?:bounty|reward|payout|payment|award)?\s*(?:of|is|:)?\s*([^.\n]{0,60})/i,
  /\b(?:bount(?:y|ies)|rewards?|payouts?)\s+(?:of\s+)?up\s+to\s+([^.\n]{0,60})/i,
];

const MIN_PATTERNS: RegExp[] = [
  /\b(?:minimum|min\.?|lowest|starting\s+at|start\s+(?:at|from)|from)\s+(?:bounty|reward|payout|payment|award)?\s*(?:of|is|:)?\s*([^.\n]{0,60})/i,
  /\b(?:bount(?:y|ies)|rewards?|payouts?)\s+start\s+(?:at|from)\s+([^.\n]{0,60})/i,
];

/**
 * Pull reward tiers out of tables and severity-labelled lines.
 * A tier is only produced when both a label and an amount are present.
 */
function extractTiers(page: ParsedPage, defaultCurrency: string | null): ExtractedRewardTier[] {
  const tiers = new Map<string, ExtractedRewardTier>();

  const record = (name: string, rank: number, amounts: ParsedAmount[], rawText: string) => {
    if (amounts.length === 0) return;
    const values = amounts.map((a) => a.value).sort((a, b) => a - b);
    const currency = amounts.find((a) => a.currency)?.currency ?? defaultCurrency;
    const existing = tiers.get(name);
    const tier: ExtractedRewardTier = {
      tier: name,
      tierRank: rank,
      minAmount: values[0],
      maxAmount: values[values.length - 1],
      currency,
      rawText: rawText.slice(0, 300),
    };
    // Keep the widest range seen for a tier.
    if (existing) {
      tier.minAmount = Math.min(existing.minAmount ?? tier.minAmount!, tier.minAmount!);
      tier.maxAmount = Math.max(existing.maxAmount ?? tier.maxAmount!, tier.maxAmount!);
    }
    tiers.set(name, tier);
  };

  // 1. Reward tables: one row per severity.
  for (const table of page.tables) {
    const heading = `${table.heading ?? ''}`;
    const tableText = table.rows.flat().join(' ');
    const isRewardTable =
      /\b(?:bounty|reward|payout|payment|amount|severity|critical|high|medium|low)\b/i.test(
        `${heading} ${tableText}`,
      ) && findAmounts(tableText, defaultCurrency).length > 0;
    if (!isRewardTable) continue;

    for (const row of table.rows) {
      const label = row[0] ?? '';
      const rest = row.slice(1).join(' ');
      const severity = SEVERITY_TIERS.find((t) => t.pattern.test(label));
      if (!severity) continue;
      record(severity.name, severity.rank, findAmounts(rest || label, defaultCurrency), row.join(' — '));
    }
  }

  // 2. Severity-labelled lines, e.g. "Critical: $5,000-$10,000".
  const lines = [
    ...page.lists.flatMap((l) => l.items),
    ...page.text.split(/(?<=[.!?;])\s+|\n/),
  ];
  for (const line of lines) {
    if (line.length > 300) continue;
    const severity = SEVERITY_TIERS.find((t) => t.pattern.test(line));
    if (!severity) continue;
    const amounts = findAmounts(line, defaultCurrency, true);
    if (amounts.length === 0) continue;
    record(severity.name, severity.rank, amounts, line);
  }

  return [...tiers.values()].sort((a, b) => b.tierRank - a.tierRank);
}

/** Dominant currency on the page, used to interpret bare numbers nearby. */
function detectCurrency(text: string): string | null {
  const counts = new Map<string, number>();
  for (const currency of CURRENCIES) {
    let count = 0;
    for (const symbol of currency.symbols) {
      count += text.split(symbol).length - 1;
    }
    for (const word of currency.words) {
      count += (text.match(new RegExp(`\\b${word}\\b`, 'gi')) ?? []).length;
    }
    if (count > 0) counts.set(currency.code, count);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function extractRewards(page: ParsedPage): ExtractedRewards {
  const text = page.text;
  const currency = detectCurrency(text);

  const noReward = rewardLanguage.noReward.some((p) => p.test(text));
  const hallOfFame = rewardLanguage.hallOfFame.some((p) => p.test(text));
  const swag = rewardLanguage.swag.some((p) => p.test(text));

  const tiers = extractTiers(page, currency);

  // Explicit maximum/minimum statements.
  let minBounty: number | null = null;
  let maxBounty: number | null = null;

  if (!noReward) {
    for (const pattern of MAX_PATTERNS) {
      const match = text.match(pattern);
      if (!match?.[1]) continue;
      const amounts = findAmounts(match[1], currency, true);
      if (amounts.length > 0) {
        maxBounty = Math.max(...amounts.map((a) => a.value));
        break;
      }
    }
    for (const pattern of MIN_PATTERNS) {
      const match = text.match(pattern);
      if (!match?.[1]) continue;
      const amounts = findAmounts(match[1], currency, true);
      if (amounts.length > 0) {
        minBounty = Math.min(...amounts.map((a) => a.value));
        break;
      }
    }

    // Fall back to the tier table when no explicit min/max sentence exists.
    const tierMaxes = tiers.map((t) => t.maxAmount).filter((v): v is number => v !== null);
    const tierMins = tiers.map((t) => t.minAmount).filter((v): v is number => v !== null);
    if (maxBounty === null && tierMaxes.length > 0) maxBounty = Math.max(...tierMaxes);
    if (minBounty === null && tierMins.length > 0) minBounty = Math.min(...tierMins);
  }

  if (minBounty !== null && maxBounty !== null && minBounty > maxBounty) {
    [minBounty, maxBounty] = [maxBounty, minBounty];
  }

  const hasAmounts = minBounty !== null || maxBounty !== null || tiers.length > 0;
  const paysMoney = !noReward && (hasAmounts || rewardLanguage.bountySignals.some((g) => g.patterns.some((p) => p.test(text))));

  let kind: RewardKind;
  if (noReward && !hasAmounts) {
    kind = hallOfFame ? 'hall_of_fame' : swag ? 'swag' : 'none';
  } else if (paysMoney) {
    kind = 'paid';
  } else if (hallOfFame) {
    kind = 'hall_of_fame';
  } else if (swag) {
    kind = 'swag';
  } else {
    kind = 'unknown';
  }

  // Record an explicit "Maximum bounty" pseudo-tier so the detail page can show
  // the headline figure alongside per-severity rows.
  const allTiers = [...tiers];
  if (maxBounty !== null && !tiers.some((t) => t.maxAmount === maxBounty)) {
    allTiers.unshift({
      tier: 'Maximum bounty',
      tierRank: 10,
      minAmount: null,
      maxAmount: maxBounty,
      currency,
      rawText: 'Stated maximum bounty',
    });
  }

  return {
    kind,
    currency: kind === 'paid' ? currency : hasAmounts ? currency : null,
    minBounty: kind === 'paid' ? minBounty : null,
    maxBounty: kind === 'paid' ? maxBounty : null,
    tiers: kind === 'paid' ? allTiers : [],
  };
}

/** `$10,000` / `€5,000` / `0.5 BTC` — used across the UI. */
export function formatAmount(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return 'Not specified';
  const code = currency ?? 'USD';
  if (['BTC', 'ETH', 'USDC'].includes(code)) {
    return `${amount.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${code}`;
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString('en-US')} ${code}`;
  }
}

/** Compact form for dense tables: `$10K`, `$1.5M`. */
export function formatAmountShort(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const symbol = CURRENCIES.find((c) => c.code === (currency ?? 'USD'))?.symbols[0] ?? '';
  const prefix = symbol || `${currency ?? ''} `;
  if (amount >= 1_000_000) return `${prefix}${(amount / 1_000_000).toFixed(amount % 1_000_000 === 0 ? 0 : 1)}M`;
  if (amount >= 1_000) return `${prefix}${(amount / 1_000).toFixed(amount % 1_000 === 0 ? 0 : 1)}K`;
  return `${prefix}${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
