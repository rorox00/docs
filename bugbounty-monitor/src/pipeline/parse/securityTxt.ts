import { parseLooseDate } from '@/lib/dates';
import { resolveUrl } from '@/lib/url';

/**
 * RFC 9116 security.txt parser.
 *
 * A security.txt is the single strongest signal that an organisation runs a
 * disclosure process, and its `Policy` field usually points straight at the
 * program page we want to monitor.
 */
export interface SecurityTxt {
  contact: string[];
  policy: string[];
  acknowledgments: string[];
  hiring: string[];
  encryption: string[];
  expires: Date | null;
  preferredLanguages: string[];
  canonical: string[];
  raw: string;
}

const FIELD_PATTERN = /^([A-Za-z-]+)\s*:\s*(.+?)\s*$/;

export function parseSecurityTxt(text: string, baseUrl?: string): SecurityTxt {
  const result: SecurityTxt = {
    contact: [],
    policy: [],
    acknowledgments: [],
    hiring: [],
    encryption: [],
    expires: null,
    preferredLanguages: [],
    canonical: [],
    raw: text.slice(0, 20_000),
  };

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(FIELD_PATTERN);
    if (!match) continue;

    const field = match[1].toLowerCase();
    let value = match[2].trim();
    if (!value) continue;

    // Values other than Contact/Expires are URIs; resolve relative ones.
    const asUrl = () => (baseUrl && !/^[a-z]+:/i.test(value) ? resolveUrl(baseUrl, value) ?? value : value);

    switch (field) {
      case 'contact':
        result.contact.push(value);
        break;
      case 'policy':
        result.policy.push(asUrl());
        break;
      case 'acknowledgments':
      case 'acknowledgements':
        result.acknowledgments.push(asUrl());
        break;
      case 'hiring':
        result.hiring.push(asUrl());
        break;
      case 'encryption':
        result.encryption.push(asUrl());
        break;
      case 'expires':
        result.expires = parseLooseDate(value, new Date(Date.now() + 10 * 365 * 86_400_000));
        break;
      case 'preferred-languages':
        result.preferredLanguages.push(...value.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
        break;
      case 'canonical':
        result.canonical.push(asUrl());
        break;
      default:
        break;
    }
  }

  return result;
}

/** True when the body actually looks like a security.txt rather than an HTML 404. */
export function looksLikeSecurityTxt(body: string): boolean {
  if (!body || body.length > 100_000) return false;
  if (/<html|<!doctype/i.test(body.slice(0, 500))) return false;
  return /^\s*(?:#[^\n]*\n)*\s*contact\s*:/im.test(body);
}

/**
 * Program pages a security.txt points at. `Policy` is the canonical field;
 * `Acknowledgments` (a hall-of-fame page) is a weaker but still useful hint.
 */
export function programUrlsFromSecurityTxt(parsed: SecurityTxt): string[] {
  const urls = new Set<string>();
  for (const url of parsed.policy) {
    if (/^https?:\/\//i.test(url)) urls.add(url);
  }
  for (const contact of parsed.contact) {
    if (/^https?:\/\//i.test(contact)) urls.add(contact);
  }
  return [...urls];
}
