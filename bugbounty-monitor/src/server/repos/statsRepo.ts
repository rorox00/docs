import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { companies, discoveryEvents, programChanges, programs, runs } from '@/db/schema';
import { startOfUtcDay, subDays } from '@/lib/dates';

/** Aggregations for the dashboard header, the charts and the daily digest. */

export interface DashboardStats {
  totalPrograms: number;
  newToday: number;
  newThisWeek: number;
  newThisMonth: number;
  activePrograms: number;
  paidPrograms: number;
  programsWithApi: number;
  programsWithMobile: number;
  programsWithWildcard: number;
  changedThisWeek: number;
  averageConfidence: number;
  highestBounty: { amount: number; currency: string | null; programId: number; companyName: string } | null;
}

const visible = () => and(eq(programs.falsePositive, false), eq(programs.hidden, false), eq(programs.selfHosted, true))!;

export async function getDashboardStats(now = new Date()): Promise<DashboardStats> {
  const todayStart = startOfUtcDay(now);
  const weekAgo = subDays(now, 7);
  const monthAgo = subDays(now, 30);

  const [row] = await db()
    .select({
      totalPrograms: sql<number>`count(*)::int`,
      newToday: sql<number>`count(*) filter (where ${programs.firstSeenAt} >= ${todayStart})::int`,
      newThisWeek: sql<number>`count(*) filter (where ${programs.firstSeenAt} >= ${weekAgo})::int`,
      newThisMonth: sql<number>`count(*) filter (where ${programs.firstSeenAt} >= ${monthAgo})::int`,
      activePrograms: sql<number>`count(*) filter (where ${programs.status} = 'active')::int`,
      paidPrograms: sql<number>`count(*) filter (where ${programs.rewardKind} = 'paid')::int`,
      programsWithApi: sql<number>`count(*) filter (where ${programs.hasApi})::int`,
      programsWithMobile: sql<number>`count(*) filter (where ${programs.hasMobile})::int`,
      programsWithWildcard: sql<number>`count(*) filter (where ${programs.hasWildcard})::int`,
      changedThisWeek: sql<number>`count(*) filter (where ${programs.lastChangedAt} >= ${weekAgo})::int`,
      averageConfidence: sql<number>`coalesce(round(avg(${programs.confidenceScore}))::int, 0)`,
    })
    .from(programs)
    .where(visible());

  const [top] = await db()
    .select({
      amount: programs.maxBounty,
      currency: programs.bountyCurrency,
      programId: programs.id,
      companyName: companies.name,
    })
    .from(programs)
    .innerJoin(companies, eq(companies.id, programs.companyId))
    .where(and(visible(), isNotNull(programs.maxBounty)))
    .orderBy(desc(programs.maxBounty))
    .limit(1);

  return {
    ...row,
    highestBounty: top
      ? {
          amount: Number(top.amount),
          currency: top.currency,
          programId: top.programId,
          companyName: top.companyName,
        }
      : null,
  };
}

export interface TimeSeriesPoint {
  date: string;
  count: number;
}

/** Programs first seen per day, gap-filled so charts have no holes. */
export async function getDiscoveriesPerDay(days = 30, now = new Date()): Promise<TimeSeriesPoint[]> {
  const from = startOfUtcDay(subDays(now, days - 1));

  const rows = await db()
    .select({
      date: sql<string>`to_char(date_trunc('day', ${programs.firstSeenAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(programs)
    .where(and(visible(), gte(programs.firstSeenAt, from)))
    .groupBy(sql`date_trunc('day', ${programs.firstSeenAt} at time zone 'UTC')`)
    .orderBy(sql`date_trunc('day', ${programs.firstSeenAt} at time zone 'UTC')`);

  const byDate = new Map(rows.map((r) => [r.date, r.count]));
  const out: TimeSeriesPoint[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: day, count: byDate.get(day) ?? 0 });
  }
  return out;
}

export async function getDiscoveriesPerWeek(weeks = 12, now = new Date()): Promise<TimeSeriesPoint[]> {
  const from = startOfUtcDay(subDays(now, weeks * 7));
  const rows = await db()
    .select({
      date: sql<string>`to_char(date_trunc('week', ${programs.firstSeenAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(programs)
    .where(and(visible(), gte(programs.firstSeenAt, from)))
    .groupBy(sql`date_trunc('week', ${programs.firstSeenAt} at time zone 'UTC')`)
    .orderBy(sql`date_trunc('week', ${programs.firstSeenAt} at time zone 'UTC')`);
  return rows;
}

export interface Breakdown {
  key: string;
  label: string;
  count: number;
}

export async function getProgramTypeBreakdown(): Promise<Breakdown[]> {
  const rows = await db()
    .select({ key: programs.programType, count: sql<number>`count(*)::int` })
    .from(programs)
    .where(visible())
    .groupBy(programs.programType)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ key: r.key, label: r.key, count: r.count }));
}

export async function getRewardRangeBreakdown(): Promise<Breakdown[]> {
  const rows = await db()
    .select({
      key: sql<string>`case
        when ${programs.rewardKind} <> 'paid' then 'unpaid'
        when ${programs.maxBounty} is null then 'amount_unknown'
        when ${programs.maxBounty} < 500 then 'lt_500'
        when ${programs.maxBounty} < 1000 then '500_1k'
        when ${programs.maxBounty} < 5000 then '1k_5k'
        when ${programs.maxBounty} < 10000 then '5k_10k'
        when ${programs.maxBounty} < 50000 then '10k_50k'
        else 'gte_50k' end`,
      count: sql<number>`count(*)::int`,
    })
    .from(programs)
    .where(visible())
    .groupBy(sql`1`);

  const labels: Record<string, string> = {
    unpaid: 'No monetary reward',
    amount_unknown: 'Paid, amount unknown',
    lt_500: 'Under $500',
    '500_1k': '$500 – $1K',
    '1k_5k': '$1K – $5K',
    '5k_10k': '$5K – $10K',
    '10k_50k': '$10K – $50K',
    gte_50k: '$50K+',
  };
  const order = Object.keys(labels);
  return rows
    .map((r) => ({ key: r.key, label: labels[r.key] ?? r.key, count: r.count }))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

export async function getTopCountries(limit = 10): Promise<Breakdown[]> {
  const rows = await db()
    .select({
      key: sql<string>`coalesce(${companies.countryCode}, 'unknown')`,
      label: sql<string>`coalesce(${companies.countryName}, 'Unknown')`,
      count: sql<number>`count(*)::int`,
    })
    .from(programs)
    .innerJoin(companies, eq(companies.id, programs.companyId))
    .where(visible())
    .groupBy(sql`1, 2`)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows;
}

export async function getScopeCategoryBreakdown(): Promise<Breakdown[]> {
  const [row] = await db()
    .select({
      web: sql<number>`count(*) filter (where ${programs.hasWeb})::int`,
      api: sql<number>`count(*) filter (where ${programs.hasApi})::int`,
      android: sql<number>`count(*) filter (where ${programs.hasAndroid})::int`,
      ios: sql<number>`count(*) filter (where ${programs.hasIos})::int`,
      cloud: sql<number>`count(*) filter (where ${programs.hasCloud})::int`,
      wildcard: sql<number>`count(*) filter (where ${programs.hasWildcard})::int`,
    })
    .from(programs)
    .where(visible());

  return [
    { key: 'web', label: 'Web', count: row.web },
    { key: 'api', label: 'API', count: row.api },
    { key: 'android', label: 'Android', count: row.android },
    { key: 'ios', label: 'iOS', count: row.ios },
    { key: 'cloud', label: 'Cloud', count: row.cloud },
    { key: 'wildcard', label: 'Wildcard', count: row.wildcard },
  ].sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ */
/* Crawler health (admin panel)                                        */
/* ------------------------------------------------------------------ */

export interface CrawlerStats {
  candidatesPending: number;
  candidatesAccepted: number;
  candidatesRejected: number;
  candidatesError: number;
  eventsToday: number;
  errorsToday: number;
  lastRun: { id: string; kind: string; status: string; startedAt: Date; finishedAt: Date | null; stats: Record<string, number> } | null;
}

export async function getCrawlerStats(now = new Date()): Promise<CrawlerStats> {
  const todayStart = startOfUtcDay(now);

  const [candidateCounts] = await db().execute<{
    pending: number; accepted: number; rejected: number; error: number;
  }>(sql`
    select
      count(*) filter (where status = 'pending')::int  as pending,
      count(*) filter (where status = 'accepted')::int as accepted,
      count(*) filter (where status = 'rejected')::int as rejected,
      count(*) filter (where status = 'error')::int    as error
    from candidates
  `).then((r) => r.rows);

  const [eventCounts] = await db()
    .select({
      eventsToday: sql<number>`count(*)::int`,
      errorsToday: sql<number>`count(*) filter (where ${discoveryEvents.eventType} = 'error')::int`,
    })
    .from(discoveryEvents)
    .where(gte(discoveryEvents.createdAt, todayStart));

  const [lastRun] = await db().select().from(runs).orderBy(desc(runs.startedAt)).limit(1);

  return {
    candidatesPending: candidateCounts?.pending ?? 0,
    candidatesAccepted: candidateCounts?.accepted ?? 0,
    candidatesRejected: candidateCounts?.rejected ?? 0,
    candidatesError: candidateCounts?.error ?? 0,
    eventsToday: eventCounts?.eventsToday ?? 0,
    errorsToday: eventCounts?.errorsToday ?? 0,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          kind: lastRun.kind,
          status: lastRun.status,
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
          stats: lastRun.stats,
        }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Daily digest                                                        */
/* ------------------------------------------------------------------ */

export interface DailyDigest {
  date: string;
  newPrograms: Array<{
    id: number;
    name: string;
    companyName: string;
    programType: string;
    maxBounty: number | null;
    currency: string | null;
    confidenceScore: number;
    launchDate: Date | null;
    firstSeenAt: Date;
    programUrl: string;
  }>;
  newProgramCount: number;
  highestReward: { programId: number; companyName: string; amount: number; currency: string | null } | null;
  mobileCount: number;
  apiCount: number;
  wildcardCount: number;
  changes: Array<{
    id: number;
    programId: number;
    companyName: string;
    summary: string;
    severity: string;
    changeType: string;
  }>;
}

/** Everything that happened on one UTC day. */
export async function getDailyDigest(day: Date = new Date()): Promise<DailyDigest> {
  const start = startOfUtcDay(day);
  const end = new Date(start.getTime() + 86_400_000);

  const inDay = and(
    visible(),
    gte(programs.firstSeenAt, start),
    sql`${programs.firstSeenAt} < ${end}`,
  )!;

  const newPrograms = await db()
    .select({
      id: programs.id,
      name: programs.name,
      companyName: companies.name,
      programType: programs.programType,
      maxBounty: programs.maxBounty,
      currency: programs.bountyCurrency,
      confidenceScore: programs.confidenceScore,
      launchDate: programs.launchDate,
      firstSeenAt: programs.firstSeenAt,
      programUrl: programs.programUrl,
      hasMobile: programs.hasMobile,
      hasApi: programs.hasApi,
      hasWildcard: programs.hasWildcard,
    })
    .from(programs)
    .innerJoin(companies, eq(companies.id, programs.companyId))
    .where(inDay)
    .orderBy(desc(programs.confidenceScore), desc(programs.firstSeenAt))
    .limit(100);

  const changes = await db()
    .select({
      id: programChanges.id,
      programId: programChanges.programId,
      companyName: companies.name,
      summary: programChanges.summary,
      severity: programChanges.severity,
      changeType: programChanges.changeType,
    })
    .from(programChanges)
    .innerJoin(programs, eq(programs.id, programChanges.programId))
    .innerJoin(companies, eq(companies.id, programs.companyId))
    .where(
      and(
        gte(programChanges.detectedAt, start),
        sql`${programChanges.detectedAt} < ${end}`,
        sql`${programChanges.changeType} <> 'program_discovered'`,
        eq(programs.falsePositive, false),
        eq(programs.hidden, false),
      ),
    )
    .orderBy(desc(programChanges.detectedAt))
    .limit(100);

  const withAmounts = newPrograms
    .filter((p) => p.maxBounty !== null)
    .map((p) => ({ ...p, amount: Number(p.maxBounty) }))
    .sort((a, b) => b.amount - a.amount);

  return {
    date: start.toISOString().slice(0, 10),
    newPrograms: newPrograms.map((p) => ({
      id: p.id,
      name: p.name,
      companyName: p.companyName,
      programType: p.programType,
      maxBounty: p.maxBounty === null ? null : Number(p.maxBounty),
      currency: p.currency,
      confidenceScore: p.confidenceScore,
      launchDate: p.launchDate,
      firstSeenAt: p.firstSeenAt,
      programUrl: p.programUrl,
    })),
    newProgramCount: newPrograms.length,
    highestReward: withAmounts[0]
      ? {
          programId: withAmounts[0].id,
          companyName: withAmounts[0].companyName,
          amount: withAmounts[0].amount,
          currency: withAmounts[0].currency,
        }
      : null,
    mobileCount: newPrograms.filter((p) => p.hasMobile).length,
    apiCount: newPrograms.filter((p) => p.hasApi).length,
    wildcardCount: newPrograms.filter((p) => p.hasWildcard).length,
    changes,
  };
}
