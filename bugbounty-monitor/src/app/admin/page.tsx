import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { candidates, discoveryEvents, programs, runs } from '@/db/schema';
import { Shell } from '@/components/Shell';
import { Badge, Card, EmptyState, SectionTitle, StatTile } from '@/components/ui';
import { AdminControls } from '@/components/AdminControls';
import { CandidateReview } from '@/components/CandidateReview';
import { formatRelative } from '@/lib/dates';
import { displayUrl } from '@/lib/url';
import { SOURCE_KIND_LABELS, type SourceKind } from '@/lib/constants';
import { env } from '@/lib/env';
import { getSession } from '@/server/auth';
import { allSources } from '@/pipeline/discovery';
import { allChannels } from '@/server/notifications/dispatcher';
import { getCrawlerStats } from '@/server/repos/statsRepo';
import { isQueueAvailable } from '@/jobs/queue';

export const dynamic = 'force-dynamic';

/** Operator console: trigger work, review candidates, inspect failures. */
export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') {
    return (
      <Shell current="/admin" title="Admin">
        <EmptyState
          title="Administrator access required"
          hint="Your account does not have the admin role. The first account created on an instance becomes its administrator."
        />
      </Shell>
    );
  }

  const config = env();
  const [stats, queueUp, recentRuns, pendingCandidates, recentErrors, lowConfidence] = await Promise.all([
    getCrawlerStats(),
    isQueueAvailable(),
    db().select().from(runs).orderBy(desc(runs.startedAt)).limit(10),
    db()
      .select()
      .from(candidates)
      .where(eq(candidates.status, 'pending'))
      .orderBy(desc(candidates.priority))
      .limit(25),
    db()
      .select()
      .from(discoveryEvents)
      .where(sql`${discoveryEvents.eventType} in ('error','rejected')`)
      .orderBy(desc(discoveryEvents.createdAt))
      .limit(25),
    // Accepted but low-confidence programs are the ones an operator should
    // eyeball before they are trusted.
    db()
      .select({
        id: programs.id,
        name: programs.name,
        companyDomain: programs.companyDomain,
        confidenceScore: programs.confidenceScore,
        programType: programs.programType,
      })
      .from(programs)
      .where(
        and(
          eq(programs.reviewed, false),
          eq(programs.falsePositive, false),
          lt(programs.confidenceScore, 70),
        ),
      )
      .orderBy(asc(programs.confidenceScore))
      .limit(20),
  ]);

  return (
    <Shell
      current="/admin"
      title="Admin"
      subtitle="Crawler controls, candidate review and discovery diagnostics."
    >
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Pending candidates" value={stats.candidatesPending} tone="accent" />
        <StatTile label="Accepted" value={stats.candidatesAccepted} tone="new" />
        <StatTile label="Rejected" value={stats.candidatesRejected} />
        <StatTile label="Errors" value={stats.candidatesError} tone="paid" />
        <StatTile label="Events today" value={stats.eventsToday} />
        <StatTile label="Errors today" value={stats.errorsToday} tone={stats.errorsToday > 0 ? 'paid' : 'neutral'} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AdminControls queueAvailable={queueUp} />
        </div>

        <Card>
          <SectionTitle>Crawler configuration</SectionTitle>
          <dl className="flex flex-col gap-1.5 text-[12px]">
            <Setting label="Crawler enabled" value={config.CRAWLER_ENABLED ? 'Yes' : 'No'} tone={config.CRAWLER_ENABLED ? 'ok' : 'danger'} />
            <Setting label="Respects robots.txt" value={config.CRAWLER_RESPECT_ROBOTS ? 'Yes' : 'No'} tone={config.CRAWLER_RESPECT_ROBOTS ? 'ok' : 'warn'} />
            <Setting label="Per-host delay" value={`${config.CRAWLER_PER_HOST_DELAY_MS} ms`} />
            <Setting label="Global concurrency" value={String(config.CRAWLER_GLOBAL_CONCURRENCY)} />
            <Setting label="Request timeout" value={`${config.CRAWLER_REQUEST_TIMEOUT_MS} ms`} />
            <Setting label="Confidence floor" value={String(config.MIN_CONFIDENCE_TO_PUBLISH)} />
            <Setting label="Job queue" value={queueUp ? 'Connected' : 'Unavailable'} tone={queueUp ? 'ok' : 'warn'} />
          </dl>
          <p className="mt-2 break-all font-mono text-[10px] text-faint">{config.CRAWLER_USER_AGENT}</p>
        </Card>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle hint="A source with no configuration required is always available.">
            Discovery sources
          </SectionTitle>
          <ul className="flex flex-col gap-2">
            {allSources().map((source) => (
              <li key={source.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{source.label}</p>
                  {!source.isEnabled() && source.disabledReason?.() ? (
                    <p className="text-[11px] text-faint">{source.disabledReason()}</p>
                  ) : null}
                </div>
                <Badge tone={source.isEnabled() ? 'ok' : 'neutral'}>
                  {source.isEnabled() ? 'Enabled' : 'Off'}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <SectionTitle hint="Channels activate as soon as their credentials are present.">
            Notification channels
          </SectionTitle>
          <ul className="flex flex-col gap-2">
            {allChannels().map((channel) => (
              <li key={channel.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{channel.label}</p>
                  {!channel.isConfigured() && channel.unavailableReason?.() ? (
                    <p className="text-[11px] text-faint">{channel.unavailableReason()}</p>
                  ) : null}
                </div>
                <Badge tone={channel.isConfigured() ? 'ok' : 'neutral'}>
                  {channel.isConfigured() ? 'Ready' : 'Not configured'}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Candidate review */}
      <Card className="mb-4">
        <SectionTitle hint="URLs waiting to be fetched and classified. Approving one bypasses the confidence floor.">
          Candidate queue
        </SectionTitle>
        <CandidateReview
          initial={pendingCandidates.map((candidate) => ({
            id: candidate.id,
            url: candidate.url,
            domain: candidate.domain,
            sourceKind: candidate.sourceKind,
            priority: candidate.priority,
            discoveredAt: candidate.discoveredAt.toISOString(),
          }))}
        />
      </Card>

      {/* Needs review */}
      <Card className="mb-4">
        <SectionTitle hint="Accepted programs whose confidence is below 70. Confirm or mark them false positives.">
          Needs review
        </SectionTitle>
        {lowConfidence.length === 0 ? (
          <p className="text-[13px] text-faint italic">Nothing awaiting review.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {lowConfidence.map((program) => (
              <li key={program.id} className="flex items-center justify-between gap-2 border-b border-border pb-1.5 last:border-0">
                <Link href={`/programs/${program.id}`} className="min-w-0 text-[13px] hover:text-accent">
                  <span className="font-semibold">{program.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-faint">{program.companyDomain}</span>
                </Link>
                <Badge tone={program.confidenceScore >= 60 ? 'info' : 'warn'} mono>
                  {program.confidenceScore}%
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Runs */}
        <Card>
          <SectionTitle>Recent runs</SectionTitle>
          {recentRuns.length === 0 ? (
            <p className="text-[13px] text-faint italic">No runs recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recentRuns.map((run) => (
                <li key={run.id} className="border-b border-border pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold capitalize">{run.kind}</span>
                    <Badge
                      tone={run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'danger' : 'info'}
                    >
                      {run.status}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-faint">
                    {formatRelative(run.startedAt)} · {run.triggeredBy}
                  </p>
                  {Object.keys(run.stats).length > 0 ? (
                    <p className="mt-0.5 font-mono text-[11px] text-muted">
                      {Object.entries(run.stats)
                        .filter(([, value]) => value > 0)
                        .map(([key, value]) => `${key}=${value}`)
                        .join(' ') || 'no results'}
                    </p>
                  ) : null}
                  {run.error ? <p className="mt-0.5 text-[11px] text-danger">{run.error}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Errors and rejections */}
        <Card>
          <SectionTitle hint="Why candidates were rejected — the main tool for tuning false-positive rules.">
            Recent rejections and errors
          </SectionTitle>
          {recentErrors.length === 0 ? (
            <p className="text-[13px] text-faint italic">No errors or rejections recorded.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {recentErrors.map((event) => (
                <li key={event.id} className="border-b border-border pb-1.5 last:border-0">
                  <div className="flex items-center gap-1.5">
                    <Badge tone={event.eventType === 'error' ? 'danger' : 'neutral'}>{event.eventType}</Badge>
                    {event.sourceKind ? (
                      <span className="text-[11px] text-faint">
                        {SOURCE_KIND_LABELS[event.sourceKind as SourceKind] ?? event.sourceKind}
                      </span>
                    ) : null}
                    <span className="text-[11px] text-faint">{formatRelative(event.createdAt)}</span>
                  </div>
                  {event.url ? (
                    <p className="break-all font-mono text-[11px] text-muted">{displayUrl(event.url, 70)}</p>
                  ) : null}
                  {event.message ? <p className="text-[11px] text-faint">{event.message}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}

function Setting({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'danger' | 'neutral';
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-faint">{label}</dt>
      <dd>
        {tone === 'neutral' ? (
          <span className="tabular font-mono font-semibold">{value}</span>
        ) : (
          <Badge tone={tone}>{value}</Badge>
        )}
      </dd>
    </div>
  );
}
