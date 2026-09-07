import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { companies, notifications, programChanges, programs, userFilters, users } from '@/db/schema';
import { PROGRAM_TYPE_SHORT, type ChangeSeverity } from '@/lib/constants';
import { env } from '@/lib/env';
import { formatDate } from '@/lib/dates';
import { createLogger } from '@/lib/logger';
import { formatAmount } from '@/pipeline/extract/rewards';
import { programFilterSchema, type ProgramFilter } from '../filters';
import { listProgramsByIds, type ProgramListItem } from '../repos/queryRepo';
import type { DeliveryResult, NotificationChannel, NotificationMessage } from './channel';
import { InAppChannel } from './channels/inApp';
import { EmailChannel } from './channels/email';
import { DiscordChannel, SlackChannel, TelegramChannel } from './channels/webhooks';
import { programMatchesFilter } from './matcher';

const log = createLogger('notify');

/** Every known channel. Adding one here makes it selectable in saved filters. */
export function allChannels(): NotificationChannel[] {
  return [new InAppChannel(), new EmailChannel(), new SlackChannel(), new DiscordChannel(), new TelegramChannel()];
}

function channelMap(): Map<string, NotificationChannel> {
  return new Map(allChannels().map((c) => [c.id, c]));
}

export interface DispatchSummary {
  matched: number;
  delivered: number;
  failed: number;
  skipped: number;
  results: DeliveryResult[];
}

/**
 * Notify subscribers about newly discovered programs.
 *
 * Each saved filter is evaluated against each program; the unique index on
 * notifications makes repeat runs harmless.
 */
export async function notifyNewPrograms(programIds: number[]): Promise<DispatchSummary> {
  const summary: DispatchSummary = { matched: 0, delivered: 0, failed: 0, skipped: 0, results: [] };
  if (programIds.length === 0) return summary;

  const subscriptions = await loadSubscriptions('new_program');
  if (subscriptions.length === 0) return summary;

  const items = await loadProgramItems(programIds);
  const appUrl = env().APP_URL.replace(/\/$/, '');

  for (const program of items) {
    for (const subscription of subscriptions) {
      if (!programMatchesFilter(program, subscription.criteria)) continue;
      summary.matched += 1;

      const message: NotificationMessage = {
        userId: subscription.userId,
        email: subscription.email,
        kind: 'new_program',
        severity: 'medium',
        programId: program.id,
        title: `New self-hosted program: ${program.companyName}`,
        body: buildProgramBody(program),
        url: `${appUrl}/programs/${program.id}`,
        fields: buildProgramFields(program),
      };

      await deliver(message, subscription.channels, summary);
    }
  }

  log.info('New-program notifications dispatched', {
    programs: items.length,
    matched: summary.matched,
    delivered: summary.delivered,
  });
  return summary;
}

/** Notify subscribers about detected changes, honouring per-event opt-ins. */
export async function notifyChanges(changeIds: number[]): Promise<DispatchSummary> {
  const summary: DispatchSummary = { matched: 0, delivered: 0, failed: 0, skipped: 0, results: [] };
  if (changeIds.length === 0) return summary;

  const changes = await db()
    .select({
      id: programChanges.id,
      programId: programChanges.programId,
      changeType: programChanges.changeType,
      severity: programChanges.severity,
      summary: programChanges.summary,
      previousValue: programChanges.previousValue,
      newValue: programChanges.newValue,
      companyName: companies.name,
      programName: programs.name,
    })
    .from(programChanges)
    .innerJoin(programs, eq(programs.id, programChanges.programId))
    .innerJoin(companies, eq(companies.id, programs.companyId))
    .where(
      and(
        inArray(programChanges.id, changeIds),
        eq(programChanges.notified, false),
        eq(programs.falsePositive, false),
        eq(programs.hidden, false),
        sql`${programChanges.changeType} <> 'program_discovered'`,
      ),
    );

  if (changes.length === 0) return summary;

  const subscriptions = await loadSubscriptions('change');
  const items = new Map(
    (await loadProgramItems([...new Set(changes.map((c) => c.programId))])).map((p) => [p.id, p]),
  );
  const appUrl = env().APP_URL.replace(/\/$/, '');

  for (const change of changes) {
    const program = items.get(change.programId);
    if (!program) continue;

    for (const subscription of subscriptions) {
      if (!subscribedToChange(subscription, change.changeType)) continue;
      if (!programMatchesFilter(program, subscription.criteria)) continue;
      summary.matched += 1;

      const message: NotificationMessage = {
        userId: subscription.userId,
        email: subscription.email,
        kind: 'change',
        severity: change.severity as ChangeSeverity,
        programId: program.id,
        changeId: change.id,
        title: `${change.companyName}: ${change.summary}`,
        body: `${change.programName}\n${change.summary}`,
        url: `${appUrl}/programs/${program.id}`,
        fields: [
          { label: 'Change', value: change.changeType.replace(/_/g, ' ') },
          { label: 'Severity', value: change.severity },
          ...(change.previousValue ? [{ label: 'Previous', value: change.previousValue.slice(0, 200) }] : []),
          ...(change.newValue ? [{ label: 'New', value: change.newValue.slice(0, 200) }] : []),
        ],
      };

      await deliver(message, subscription.channels, summary);
    }
  }

  await db()
    .update(programChanges)
    .set({ notified: true })
    .where(inArray(programChanges.id, changes.map((c) => c.id)));

  return summary;
}

/* ------------------------------------------------------------------ */

interface Subscription {
  filterId: number;
  userId: number;
  email: string | null;
  channels: string[];
  criteria: ProgramFilter;
  onNewProgram: boolean;
  onScopeChange: boolean;
  onRewardChange: boolean;
  onProgramClosed: boolean;
}

async function loadSubscriptions(event: 'new_program' | 'change'): Promise<Subscription[]> {
  const rows = await db()
    .select({
      filterId: userFilters.id,
      userId: userFilters.userId,
      email: users.email,
      emailNotifications: users.emailNotifications,
      channels: userFilters.channels,
      criteria: userFilters.criteria,
      onNewProgram: userFilters.onNewProgram,
      onScopeChange: userFilters.onScopeChange,
      onRewardChange: userFilters.onRewardChange,
      onProgramClosed: userFilters.onProgramClosed,
    })
    .from(userFilters)
    .innerJoin(users, eq(users.id, userFilters.userId))
    .where(eq(userFilters.enabled, true));

  return rows
    .filter((row) =>
      event === 'new_program'
        ? row.onNewProgram
        : row.onScopeChange || row.onRewardChange || row.onProgramClosed,
    )
    .map((row) => {
      const parsed = programFilterSchema.safeParse(row.criteria ?? {});
      return {
        filterId: row.filterId,
        userId: row.userId,
        // Respect the per-user email switch even when a filter names the channel.
        email: row.emailNotifications ? row.email : null,
        channels: row.channels.length > 0 ? row.channels : ['in_app'],
        criteria: parsed.success ? parsed.data : {},
        onNewProgram: row.onNewProgram,
        onScopeChange: row.onScopeChange,
        onRewardChange: row.onRewardChange,
        onProgramClosed: row.onProgramClosed,
      };
    });
}

function subscribedToChange(subscription: Subscription, changeType: string): boolean {
  if (/scope|asset/.test(changeType)) return subscription.onScopeChange;
  if (/reward|bounty|tier/.test(changeType)) return subscription.onRewardChange;
  if (/closed|reopened|status/.test(changeType)) return subscription.onProgramClosed;
  // Policy and contact changes ride along with the scope subscription.
  return subscription.onScopeChange;
}

/**
 * Load the programs a dispatch concerns. False positives and hidden programs
 * are filtered out here so they can never reach a subscriber's inbox.
 */
async function loadProgramItems(programIds: number[]): Promise<ProgramListItem[]> {
  const items = await listProgramsByIds(programIds);
  return items.filter((item) => !item.falsePositive && !item.hidden);
}

async function deliver(
  message: NotificationMessage,
  channels: string[],
  summary: DispatchSummary,
): Promise<void> {
  const registry = channelMap();
  for (const channelId of channels) {
    const channel = registry.get(channelId);
    if (!channel) continue;
    if (!channel.isConfigured()) {
      summary.skipped += 1;
      summary.results.push({ channel: channelId, status: 'skipped', error: channel.unavailableReason?.() ?? undefined });
      continue;
    }
    const result = await channel.send(message);
    summary.results.push(result);
    if (result.status === 'sent') summary.delivered += 1;
    else if (result.status === 'failed') summary.failed += 1;
    else summary.skipped += 1;
  }
}

function buildProgramBody(program: ProgramListItem): string {
  const parts = [
    `${program.companyName} published a ${PROGRAM_TYPE_SHORT[program.programType as keyof typeof PROGRAM_TYPE_SHORT] ?? program.programType}.`,
  ];
  if (program.summary) parts.push(program.summary.slice(0, 300));
  return parts.join('\n\n');
}

function buildProgramFields(program: ProgramListItem): Array<{ label: string; value: string }> {
  return [
    { label: 'Type', value: PROGRAM_TYPE_SHORT[program.programType as keyof typeof PROGRAM_TYPE_SHORT] ?? program.programType },
    {
      label: 'Launch date',
      value: program.launchDate ? formatDate(program.launchDate) : 'Unknown',
    },
    { label: 'Discovered', value: formatDate(program.firstSeenAt) },
    {
      label: 'Maximum bounty',
      value: program.maxBounty !== null ? formatAmount(program.maxBounty, program.bountyCurrency) : 'Not specified',
    },
    { label: 'Confidence', value: `${program.confidenceScore}%` },
    { label: 'Assets in scope', value: String(program.assetCount) },
    { label: 'Program URL', value: program.programUrl },
  ];
}

/* ------------------------------------------------------------------ */
/* Reading notifications (bell menu)                                   */
/* ------------------------------------------------------------------ */

export async function listNotifications(userId: number, limit = 50) {
  return db()
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(sql`${notifications.createdAt} desc`)
    .limit(limit);
}

export async function countUnread(userId: number): Promise<number> {
  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return count;
}

export async function markAllRead(userId: number): Promise<void> {
  await db()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function markRead(userId: number, notificationId: number): Promise<void> {
  await db()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.id, notificationId)));
}
