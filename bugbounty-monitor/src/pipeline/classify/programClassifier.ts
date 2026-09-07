import type { ProgramStatus, ProgramType } from '@/lib/constants';
import type { ClassificationResult, ParsedPage } from '../types';
import { detectFalsePositive } from './falsePositive';

/**
 * Decides (a) whether a page really is a vulnerability disclosure / bug bounty
 * program, and (b) which kind it is.
 *
 * The bar for "is a program" is evidence that the page tells a researcher HOW
 * to report a vulnerability to THIS organisation. Merely discussing bug
 * bounties is not enough — see `falsePositive.ts`.
 */

interface SignalGroup {
  id: string;
  weight: number;
  patterns: RegExp[];
}

/**
 * Evidence that the page provides a reporting process. Without at least one of
 * these the page is rejected, no matter how often it says "bug bounty".
 */
const REPORTING_PROCESS_SIGNALS: SignalGroup[] = [
  {
    id: 'reporting_instruction',
    weight: 3,
    patterns: [
      /\b(?:please\s+)?(?:report|submit|send|email|e-mail|disclose)\s+(?:any\s+|all\s+|the\s+|a\s+|your\s+)?(?:suspected\s+|potential\s+|security\s+)?(?:vulnerabilit|security\s+(?:issue|bug|flaw|concern|finding)|bug|finding|weakness)/i,
      /\bhow\s+to\s+report\s+(?:a\s+)?(?:security\s+)?(?:vulnerabilit|issue|bug)/i,
      /\breport\s+(?:a\s+|an\s+)?(?:security\s+)?(?:vulnerabilit|issue|bug|concern)\b/i,
      /\bto\s+report\s+(?:a\s+)?(?:security\s+)?(?:vulnerabilit|issue|bug)/i,
      /\bvulnerability\s+report(?:ing|s)?\s+(?:process|procedure|guidelines?|form|channel)/i,
      /\bsubmit(?:ting)?\s+(?:a\s+)?report\b/i,
      /\bmelden\s+sie\b|\bsignaler\s+une\s+vuln|\bsegnalare\s+una\s+vulnerab|\breportar\s+una\s+vulnerab/i,
    ],
  },
  {
    id: 'security_contact',
    weight: 3,
    patterns: [
      /\bsecurity@[\w.-]+\.\w+/i,
      /\b(?:psirt|vulnerability|vuln|disclosure|bugbounty|bug-bounty|abuse|infosec|soc)@[\w.-]+\.\w+/i,
      /\bcontact\s+(?:our\s+|the\s+)?security\s+team\b/i,
      /\bsecurity\s+team\s+at\b/i,
    ],
  },
  {
    id: 'submission_channel',
    weight: 2,
    patterns: [
      /\b(?:submission|report(?:ing)?)\s+form\b/i,
      /\bpgp\s+(?:key|public\s+key|fingerprint)\b/i,
      /\bencrypt(?:ed)?\s+(?:your\s+)?(?:report|submission|email)\b/i,
      /\bsecurity\.txt\b/i,
      /\bvia\s+(?:this|the)\s+form\b/i,
    ],
  },
  {
    id: 'policy_terms',
    weight: 2,
    patterns: [
      /\bsafe\s+harbou?r\b/i,
      /\bwe\s+will\s+not\s+(?:pursue|take|initiate)\s+(?:any\s+)?legal\s+action\b/i,
      /\blegal\s+action\b.{0,80}\bgood\s+faith\b/i,
      /\bgood\s+faith\s+(?:security\s+)?research\b/i,
      /\bdisclosure\s+policy\b/i,
      /\brules\s+of\s+engagement\b/i,
      /\bcoordinated\s+(?:vulnerability\s+)?disclosure\b/i,
      /\bresponse\s+(?:time|sla)\b.{0,60}\b(?:report|disclosure)\b/i,
    ],
  },
  {
    id: 'scope_statement',
    weight: 2,
    patterns: [
      /\b(?:in|within)\s+scope\b/i,
      /\bout\s+of\s+scope\b/i,
      /\bscope\s+of\s+(?:this|the|our)\s+(?:program|policy)\b/i,
      /\beligible\s+(?:domains|assets|targets|properties|vulnerabilit)/i,
      /\bqualifying\s+vulnerabilit/i,
      /\bnon[- ]qualifying\b/i,
    ],
  },
];

/** Signals that the organisation actually pays. */
const BOUNTY_SIGNALS: SignalGroup[] = [
  {
    id: 'bounty_program_named',
    weight: 3,
    patterns: [
      /\bbug\s*bounty\s+program(?:me)?\b/i,
      /\bsecurity\s+bounty\s+program(?:me)?\b/i,
      /\bvulnerability\s+reward\s+program(?:me)?\b/i,
      /\bbounty\s+program(?:me)?\b/i,
    ],
  },
  {
    id: 'reward_offer',
    weight: 3,
    patterns: [
      /\bwe\s+(?:offer|pay|award|provide|grant)\b.{0,60}\b(?:bount|reward|monetary|cash|compensation)/i,
      /\b(?:reward|bounty|payout|payment)s?\s+(?:range|start|up\s+to|of|from|between)\b/i,
      /\bmonetary\s+(?:reward|compensation)\b/i,
      /\b(?:up\s+to|as\s+much\s+as|maximum\s+of)\s*[$€£₹]\s?[\d,]+/i,
      /[$€£₹]\s?[\d,]{3,}\b/,
      /\b(?:usd|eur|gbp|inr)\s?[\d,]{3,}\b/i,
      /\bbounty\s+(?:table|tiers?|amounts?|ranges?)\b/i,
    ],
  },
];

const HALL_OF_FAME_SIGNALS: RegExp[] = [
  /\bhall\s+of\s+fame\b/i,
  /\bsecurity\s+(?:researchers?\s+)?(?:acknowledg|credit|thank)/i,
  /\bwall\s+of\s+fame\b/i,
  /\backnowledg(?:e?ments?|ing)\s+page\b/i,
  /\bresearcher\s+recognition\b/i,
];

const SWAG_SIGNALS: RegExp[] = [
  /\bswag\b/i,
  /\b(?:t-?shirts?|hoodies?|stickers?|merchandise|goodies)\b/i,
];

const NO_REWARD_SIGNALS: RegExp[] = [
  /\bwe\s+(?:do\s+not|don'?t)\s+(?:currently\s+)?(?:offer|provide|pay|award)\b.{0,40}\b(?:bount|monetary|financial|reward|compensation)/i,
  /\bno\s+(?:monetary|financial|cash)\s+(?:reward|compensation|bount)/i,
  /\bthis\s+is\s+not\s+a\s+(?:paid\s+)?bug\s*bounty\s+program/i,
  /\bunpaid\s+(?:program|disclosure)\b/i,
  /\bwithout\s+(?:any\s+)?(?:monetary\s+)?compensation\b/i,
];

const VDP_SIGNALS: RegExp[] = [
  /\bvulnerability\s+disclosure\s+(?:program(?:me)?|policy)\b/i,
  /\b\bvdp\b/i,
  /\bcoordinated\s+vulnerability\s+disclosure\b/i,
];

const RESPONSIBLE_DISCLOSURE_SIGNALS: RegExp[] = [
  /\bresponsible\s+disclosure\b/i,
  /\bresponsible\s+vulnerability\s+disclosure\b/i,
];

const SECURITY_RESEARCH_SIGNALS: RegExp[] = [
  /\bsecurity\s+research(?:er)?\s+program(?:me)?\b/i,
  /\bresearcher\s+program(?:me)?\b/i,
  /\bsecurity\s+researchers?\s+(?:are\s+)?(?:welcome|invited|encouraged)\b/i,
];

/** Language indicating the program is not currently taking reports. */
const INACTIVE_SIGNALS: RegExp[] = [
  /\b(?:program(?:me)?|bounty)\s+(?:is\s+)?(?:currently\s+)?(?:closed|paused|suspended|discontinued|retired|on\s+hold|no\s+longer\s+active)/i,
  /\bwe\s+(?:have\s+)?(?:closed|discontinued|retired|ended|sunset)\b.{0,40}\b(?:program|bounty)/i,
  /\bno\s+longer\s+(?:accepting|receiving)\s+(?:new\s+)?(?:report|submission)/i,
  /\b(?:temporarily|indefinitely)\s+(?:paused|suspended|closed)\b/i,
  /\bthis\s+program\s+has\s+ended\b/i,
];

const ACTIVE_SIGNALS: RegExp[] = [
  /\bwe\s+(?:welcome|encourage|invite|appreciate)\b.{0,60}\b(?:report|research|disclosur|submission)/i,
  /\b(?:currently|actively)\s+(?:accepting|running|operating)\b/i,
  /\bis\s+(?:now\s+)?(?:live|open|active)\b/i,
  /\bplease\s+report\b/i,
  /\bwe\s+are\s+committed\s+to\b.{0,60}\bsecurity\b/i,
];

function countMatches(text: string, groups: SignalGroup[]): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  for (const group of groups) {
    if (group.patterns.some((p) => p.test(text))) {
      score += group.weight;
      matched.push(group.id);
    }
  }
  return { score, matched };
}

/**
 * Classify a parsed page.
 *
 * `programScore` is 0..1 and expresses how confident we are that this is a
 * genuine, self-published program page.
 */
export function classifyProgram(page: ParsedPage): ClassificationResult {
  // Search the visible text plus the structured bits that carry meaning.
  const haystack = [
    page.title ?? '',
    page.metaDescription ?? '',
    page.headings.map((h) => h.text).join(' '),
    page.text,
  ].join('\n');

  const falsePositive = detectFalsePositive(page);

  const process = countMatches(haystack, REPORTING_PROCESS_SIGNALS);
  const bounty = countMatches(haystack, BOUNTY_SIGNALS);
  const matchedSignals = [...process.matched, ...bounty.matched];

  const hasSecurityContact =
    process.matched.includes('security_contact') ||
    page.emails.some((e) => /^(security|psirt|vulnerability|vuln|disclosure|bugbounty|abuse|infosec)@/i.test(e));

  // Hard gate: no reporting process => not a program page.
  const hasReportingProcess = process.score >= 3 || hasSecurityContact;

  if (falsePositive.isFalsePositive) {
    return {
      programType: 'unknown',
      status: 'unknown',
      programScore: 0,
      isFalsePositive: true,
      rejectionReason: falsePositive.reason,
      matchedSignals,
    };
  }

  if (!hasReportingProcess) {
    return {
      programType: 'unknown',
      status: 'unknown',
      programScore: Math.min(0.35, process.score / 12),
      isFalsePositive: true,
      rejectionReason:
        'Page does not describe how to report a vulnerability to this organisation',
      matchedSignals,
    };
  }

  const programType = determineType(haystack, page, bounty.score);
  const status = determineStatus(haystack);

  // Score is driven by how much of a real policy the page contains.
  const evidence = Math.min(12, process.score) / 12;
  const bountyBoost = bounty.score > 0 ? 0.12 : 0;
  const contactBoost = hasSecurityContact ? 0.12 : 0;
  const scopeBoost = process.matched.includes('scope_statement') ? 0.08 : 0;
  const policyBoost = process.matched.includes('policy_terms') ? 0.08 : 0;

  const programScore = Math.min(
    1,
    Number((evidence * 0.6 + bountyBoost + contactBoost + scopeBoost + policyBoost).toFixed(3)),
  );

  return {
    programType,
    status,
    programScore,
    isFalsePositive: false,
    rejectionReason: null,
    matchedSignals,
  };
}

function determineType(text: string, page: ParsedPage, bountyScore: number): ProgramType {
  const titleAndHeadings = [page.title ?? '', ...page.headings.map((h) => h.text)].join(' ');
  const paysMoney = bountyScore >= 3 && !NO_REWARD_SIGNALS.some((p) => p.test(text));

  // An explicit "we don't pay" beats bounty-shaped vocabulary.
  if (NO_REWARD_SIGNALS.some((p) => p.test(text))) {
    if (VDP_SIGNALS.some((p) => p.test(text))) return 'vdp';
    if (RESPONSIBLE_DISCLOSURE_SIGNALS.some((p) => p.test(text))) return 'responsible_disclosure';
    return 'vdp';
  }

  if (paysMoney) return 'bug_bounty';

  // Titles are the strongest naming signal when nothing indicates payment.
  if (VDP_SIGNALS.some((p) => p.test(titleAndHeadings))) return 'vdp';
  if (RESPONSIBLE_DISCLOSURE_SIGNALS.some((p) => p.test(titleAndHeadings))) {
    return 'responsible_disclosure';
  }
  if (SECURITY_RESEARCH_SIGNALS.some((p) => p.test(titleAndHeadings))) return 'security_research';

  if (VDP_SIGNALS.some((p) => p.test(text))) return 'vdp';
  if (RESPONSIBLE_DISCLOSURE_SIGNALS.some((p) => p.test(text))) return 'responsible_disclosure';
  if (SECURITY_RESEARCH_SIGNALS.some((p) => p.test(text))) return 'security_research';

  // A reporting process with no payment language is, by definition, a VDP.
  return 'vdp';
}

function determineStatus(text: string): ProgramStatus {
  if (INACTIVE_SIGNALS.some((p) => p.test(text))) return 'inactive';
  if (ACTIVE_SIGNALS.some((p) => p.test(text))) return 'active';
  return 'unknown';
}

/** Exposed for the reward extractor, which needs the same vocabulary. */
export const rewardLanguage = {
  bountySignals: BOUNTY_SIGNALS,
  hallOfFame: HALL_OF_FAME_SIGNALS,
  swag: SWAG_SIGNALS,
  noReward: NO_REWARD_SIGNALS,
};
