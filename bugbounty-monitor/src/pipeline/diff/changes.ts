import type { ChangeSeverity, ChangeType, ProgramStatus, ProgramType, RewardKind } from '@/lib/constants';
import { CHANGE_TYPE_LABELS } from '@/lib/constants';
import { formatAmount } from '../extract/rewards';
import type { ExtractedAsset, ExtractedRewardTier } from '../types';

/**
 * Change detection.
 *
 * Compares two snapshots of a program and produces a list of human-readable,
 * severity-tagged changes. Severity drives notifications: a reward increase or
 * a scope expansion is what a researcher wants to be woken up for; a wording
 * tweak is not.
 */

export interface ProgramSnapshot {
  programType: ProgramType;
  status: ProgramStatus;
  rewardKind: RewardKind;
  minBounty: number | null;
  maxBounty: number | null;
  bountyCurrency: string | null;
  assets: Array<Pick<ExtractedAsset, 'identifier' | 'normalizedIdentifier' | 'category' | 'inScope'>>;
  rewardTiers: Array<Pick<ExtractedRewardTier, 'tier' | 'minAmount' | 'maxAmount' | 'currency'>>;
  contactMethods: string[];
  policyText: string | null;
  contentHash: string;
}

export interface DetectedChange {
  changeType: ChangeType;
  severity: ChangeSeverity;
  summary: string;
  previousValue: string | null;
  newValue: string | null;
  details?: Record<string, unknown>;
}

export function detectChanges(
  previous: ProgramSnapshot,
  next: ProgramSnapshot,
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  /* ---- Status ---- */
  if (previous.status !== next.status) {
    if (next.status === 'inactive') {
      changes.push({
        changeType: 'program_closed',
        severity: 'high',
        summary: 'Program appears to have closed or been paused',
        previousValue: previous.status,
        newValue: next.status,
      });
    } else if (previous.status === 'inactive' && next.status === 'active') {
      changes.push({
        changeType: 'program_reopened',
        severity: 'high',
        summary: 'Program reopened',
        previousValue: previous.status,
        newValue: next.status,
      });
    } else {
      changes.push({
        changeType: 'status_changed',
        severity: 'medium',
        summary: `Status changed from ${previous.status} to ${next.status}`,
        previousValue: previous.status,
        newValue: next.status,
      });
    }
  }

  /* ---- Program type ---- */
  if (previous.programType !== next.programType) {
    changes.push({
      changeType: 'program_type_changed',
      severity: 'medium',
      summary: `Program type changed from ${previous.programType} to ${next.programType}`,
      previousValue: previous.programType,
      newValue: next.programType,
    });
  }

  /* ---- Scope ---- */
  const previousInScope = keyed(previous.assets.filter((a) => a.inScope));
  const nextInScope = keyed(next.assets.filter((a) => a.inScope));

  const added = [...nextInScope.entries()].filter(([key]) => !previousInScope.has(key));
  const removed = [...previousInScope.entries()].filter(([key]) => !nextInScope.has(key));

  for (const [, asset] of added) {
    changes.push({
      changeType: 'asset_added',
      severity: 'medium',
      summary: `Added to scope: ${asset.identifier}`,
      previousValue: null,
      newValue: asset.identifier,
      details: { category: asset.category },
    });
  }
  for (const [, asset] of removed) {
    changes.push({
      changeType: 'asset_removed',
      severity: 'low',
      summary: `Removed from scope: ${asset.identifier}`,
      previousValue: asset.identifier,
      newValue: null,
      details: { category: asset.category },
    });
  }

  // A net expansion/reduction is its own headline alongside the per-asset rows.
  if (added.length > 0 && added.length > removed.length) {
    changes.push({
      changeType: 'scope_expanded',
      severity: added.length >= 3 ? 'high' : 'medium',
      summary: `Scope expanded by ${added.length} asset${added.length === 1 ? '' : 's'}`,
      previousValue: String(previousInScope.size),
      newValue: String(nextInScope.size),
      details: { added: added.map(([, a]) => a.identifier) },
    });
  } else if (removed.length > 0 && removed.length > added.length) {
    changes.push({
      changeType: 'scope_reduced',
      severity: 'medium',
      summary: `Scope reduced by ${removed.length} asset${removed.length === 1 ? '' : 's'}`,
      previousValue: String(previousInScope.size),
      newValue: String(nextInScope.size),
      details: { removed: removed.map(([, a]) => a.identifier) },
    });
  }

  /* ---- Rewards ---- */
  const currency = next.bountyCurrency ?? previous.bountyCurrency;

  if (previous.maxBounty !== null && next.maxBounty !== null && previous.maxBounty !== next.maxBounty) {
    const increased = next.maxBounty > previous.maxBounty;
    changes.push({
      changeType: increased ? 'reward_increased' : 'reward_decreased',
      severity: increased ? 'high' : 'medium',
      summary: `Maximum bounty ${increased ? 'increased' : 'decreased'}: ${formatAmount(previous.maxBounty, currency)} → ${formatAmount(next.maxBounty, currency)}`,
      previousValue: String(previous.maxBounty),
      newValue: String(next.maxBounty),
      details: { field: 'max_bounty', currency },
    });
  } else if (previous.maxBounty === null && next.maxBounty !== null) {
    changes.push({
      changeType: 'reward_increased',
      severity: 'high',
      summary: `Maximum bounty published: ${formatAmount(next.maxBounty, currency)}`,
      previousValue: null,
      newValue: String(next.maxBounty),
      details: { field: 'max_bounty', currency },
    });
  }

  if (previous.minBounty !== null && next.minBounty !== null && previous.minBounty !== next.minBounty) {
    const increased = next.minBounty > previous.minBounty;
    changes.push({
      changeType: increased ? 'reward_increased' : 'reward_decreased',
      severity: 'medium',
      summary: `Minimum bounty ${increased ? 'increased' : 'decreased'}: ${formatAmount(previous.minBounty, currency)} → ${formatAmount(next.minBounty, currency)}`,
      previousValue: String(previous.minBounty),
      newValue: String(next.minBounty),
      details: { field: 'min_bounty', currency },
    });
  }

  if (previous.rewardKind !== next.rewardKind) {
    const becamePaid = next.rewardKind === 'paid';
    changes.push({
      changeType: becamePaid ? 'reward_increased' : 'policy_changed',
      severity: becamePaid ? 'high' : 'medium',
      summary: `Reward model changed from ${previous.rewardKind} to ${next.rewardKind}`,
      previousValue: previous.rewardKind,
      newValue: next.rewardKind,
    });
  }

  /* ---- Reward tiers ---- */
  // The extractor synthesises a "Maximum bounty" row so the detail page can show
  // the headline figure. It is not a severity tier, and the maximum is already
  // diffed above, so excluding it here avoids reporting the same change twice.
  const isSeverityTier = (tier: { tier: string }) => tier.tier.toLowerCase() !== 'maximum bounty';

  const previousTiers = new Map(
    previous.rewardTiers.filter(isSeverityTier).map((t) => [t.tier.toLowerCase(), t]),
  );
  const nextTiers = new Map(next.rewardTiers.filter(isSeverityTier).map((t) => [t.tier.toLowerCase(), t]));

  for (const [key, tier] of nextTiers) {
    const before = previousTiers.get(key);
    if (!before) {
      changes.push({
        changeType: 'reward_tier_added',
        severity: 'medium',
        summary: `New bounty tier: ${tier.tier} (${formatRange(tier)})`,
        previousValue: null,
        newValue: `${tier.tier}: ${formatRange(tier)}`,
      });
      continue;
    }

    // The tier still exists but its amounts moved.
    if (before.minAmount !== tier.minAmount || before.maxAmount !== tier.maxAmount) {
      const previousTop = before.maxAmount ?? before.minAmount;
      const nextTop = tier.maxAmount ?? tier.minAmount;
      const increased = previousTop !== null && nextTop !== null && nextTop > previousTop;
      changes.push({
        changeType: increased ? 'reward_increased' : 'reward_decreased',
        severity: increased ? 'high' : 'medium',
        summary: `${tier.tier} bounty ${increased ? 'increased' : 'changed'}: ${formatRange(before)} → ${formatRange(tier)}`,
        previousValue: formatRange(before),
        newValue: formatRange(tier),
        details: { tier: tier.tier, field: 'tier_amount' },
      });
    }
  }
  for (const [key, tier] of previousTiers) {
    if (nextTiers.has(key)) continue;
    changes.push({
      changeType: 'reward_tier_removed',
      severity: 'low',
      summary: `Bounty tier removed: ${tier.tier}`,
      previousValue: `${tier.tier}: ${formatRange(tier)}`,
      newValue: null,
    });
  }

  /* ---- Contact methods ---- */
  const previousContacts = new Set(previous.contactMethods);
  const nextContacts = new Set(next.contactMethods);
  const contactsAdded = [...nextContacts].filter((c) => !previousContacts.has(c));
  const contactsRemoved = [...previousContacts].filter((c) => !nextContacts.has(c));

  if (contactsAdded.length > 0 || contactsRemoved.length > 0) {
    changes.push({
      changeType: 'contact_changed',
      severity: 'medium',
      summary: 'Reporting contact method changed',
      previousValue: [...previousContacts].join(', ') || null,
      newValue: [...nextContacts].join(', ') || null,
      details: { added: contactsAdded, removed: contactsRemoved },
    });
  }

  /* ---- Policy wording ---- */
  const policyChanged = normalisePolicy(previous.policyText) !== normalisePolicy(next.policyText);
  if (policyChanged) {
    changes.push({
      changeType: 'policy_changed',
      severity: 'low',
      summary: 'Policy text was updated',
      previousValue: truncate(previous.policyText),
      newValue: truncate(next.policyText),
    });
  }

  // A content hash change with no attributable difference still matters, but
  // only as an informational note — it is usually a footer or a timestamp.
  if (changes.length === 0 && previous.contentHash !== next.contentHash) {
    changes.push({
      changeType: 'policy_changed',
      severity: 'info',
      summary: 'Page content changed (no structural difference detected)',
      previousValue: previous.contentHash.slice(0, 12),
      newValue: next.contentHash.slice(0, 12),
    });
  }

  return changes;
}

function keyed<T extends { normalizedIdentifier: string }>(assets: T[]): Map<string, T> {
  return new Map(assets.map((a) => [a.normalizedIdentifier, a]));
}

function formatRange(tier: Pick<ExtractedRewardTier, 'minAmount' | 'maxAmount' | 'currency'>): string {
  if (tier.minAmount !== null && tier.maxAmount !== null && tier.minAmount !== tier.maxAmount) {
    return `${formatAmount(tier.minAmount, tier.currency)}–${formatAmount(tier.maxAmount, tier.currency)}`;
  }
  const single = tier.maxAmount ?? tier.minAmount;
  return single !== null ? formatAmount(single, tier.currency) : 'amount not specified';
}

function normalisePolicy(text: string | null): string {
  return (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function truncate(text: string | null, max = 500): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Highest severity across a set of changes; used to rank the changes feed. */
export function overallSeverity(changes: DetectedChange[]): ChangeSeverity {
  const order: ChangeSeverity[] = ['info', 'low', 'medium', 'high'];
  return changes.reduce<ChangeSeverity>(
    (worst, change) => (order.indexOf(change.severity) > order.indexOf(worst) ? change.severity : worst),
    'info',
  );
}

export function changeLabel(type: ChangeType): string {
  return CHANGE_TYPE_LABELS[type] ?? type;
}
