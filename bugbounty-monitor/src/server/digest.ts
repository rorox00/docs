import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { PROGRAM_TYPE_SHORT } from '@/lib/constants';
import { formatDate } from '@/lib/dates';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { formatAmount } from '@/pipeline/extract/rewards';
import { allChannels } from './notifications/dispatcher';
import type { NotificationMessage } from './notifications/channel';
import { getDailyDigest, type DailyDigest } from './repos/statsRepo';

const log = createLogger('digest');

export interface DigestSummary {
  date: string;
  newProgramCount: number;
  changeCount: number;
  recipients: number;
  delivered: number;
  skipped: number;
}

/**
 * Build and send the daily digest to every user who opted in.
 *
 * The digest deliberately reports counts and the day's highlights rather than
 * every row — the dashboard is the place for the full list.
 */
export async function sendDailyDigest(day: Date = new Date()): Promise<DigestSummary> {
  const digest = await getDailyDigest(day);
  const recipients = await db().select().from(users).where(eq(users.digestEnabled, true));

  const summary: DigestSummary = {
    date: digest.date,
    newProgramCount: digest.newProgramCount,
    changeCount: digest.changes.length,
    recipients: recipients.length,
    delivered: 0,
    skipped: 0,
  };

  // Nothing happened: do not send an empty email.
  if (digest.newProgramCount === 0 && digest.changes.length === 0) {
    log.info('Digest skipped: nothing to report', { date: digest.date });
    return summary;
  }

  const channels = allChannels().filter((c) => c.isConfigured());
  const appUrl = env().APP_URL.replace(/\/$/, '');

  for (const user of recipients) {
    const message: NotificationMessage = {
      userId: user.id,
      email: user.emailNotifications ? user.email : null,
      kind: 'digest',
      severity: 'info',
      title: `Daily bug bounty digest — ${formatDate(new Date(`${digest.date}T00:00:00Z`))}`,
      body: renderDigestText(digest),
      url: `${appUrl}/digest?date=${digest.date}`,
      fields: buildDigestFields(digest),
    };

    for (const channel of channels) {
      // Chat webhooks broadcast to a room; sending one per user would spam it.
      if (channel.id !== 'in_app' && channel.id !== 'email') continue;
      const result = await channel.send(message);
      if (result.status === 'sent') summary.delivered += 1;
      else summary.skipped += 1;
    }
  }

  log.info('Digest sent', summary as unknown as Record<string, unknown>);
  return summary;
}

export function renderDigestText(digest: DailyDigest): string {
  const lines = [
    `${digest.newProgramCount} new self-hosted program${digest.newProgramCount === 1 ? '' : 's'} discovered.`,
  ];

  if (digest.highestReward) {
    lines.push(
      `Highest reward: ${digest.highestReward.companyName} — ${formatAmount(digest.highestReward.amount, digest.highestReward.currency)}`,
    );
  }
  if (digest.mobileCount > 0) {
    lines.push(`${digest.mobileCount} program${digest.mobileCount === 1 ? '' : 's'} include Android/iOS targets.`);
  }
  if (digest.apiCount > 0) {
    lines.push(`${digest.apiCount} program${digest.apiCount === 1 ? '' : 's'} include API targets.`);
  }
  if (digest.wildcardCount > 0) {
    lines.push(`${digest.wildcardCount} program${digest.wildcardCount === 1 ? '' : 's'} include wildcard domains.`);
  }
  if (digest.changes.length > 0) {
    lines.push('', `${digest.changes.length} change${digest.changes.length === 1 ? '' : 's'} detected on existing programs.`);
  }

  if (digest.newPrograms.length > 0) {
    lines.push('', 'Newest:');
    for (const program of digest.newPrograms.slice(0, 10)) {
      const reward = program.maxBounty !== null ? formatAmount(program.maxBounty, program.currency) : 'No stated bounty';
      const type = PROGRAM_TYPE_SHORT[program.programType as keyof typeof PROGRAM_TYPE_SHORT] ?? program.programType;
      lines.push(`  • ${program.companyName} — ${type} — ${reward} — ${program.confidenceScore}% confidence`);
    }
  }

  return lines.join('\n');
}

function buildDigestFields(digest: DailyDigest): Array<{ label: string; value: string }> {
  const fields = [{ label: 'New programs', value: String(digest.newProgramCount) }];
  if (digest.highestReward) {
    fields.push({
      label: 'Highest reward',
      value: `${digest.highestReward.companyName} — ${formatAmount(digest.highestReward.amount, digest.highestReward.currency)}`,
    });
  }
  fields.push(
    { label: 'With API targets', value: String(digest.apiCount) },
    { label: 'With mobile targets', value: String(digest.mobileCount) },
    { label: 'Changes detected', value: String(digest.changes.length) },
  );
  return fields;
}
