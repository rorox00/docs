import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { Badge, Card, ConfidenceBadge, EmptyState, Pill, ProgramTypeBadge, SectionTitle, StatTile, Unknown } from '@/components/ui';
import { formatDate, subDays, toIsoDate } from '@/lib/dates';
import { formatAmount } from '@/pipeline/extract/rewards';
import { getDailyDigest } from '@/server/repos/statsRepo';
import { flatten } from '../page';

export const dynamic = 'force-dynamic';

/** The daily summary a researcher can skim in ten seconds. */
export default async function DigestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatten(await searchParams);
  const requested = params.date ? new Date(`${params.date}T00:00:00Z`) : new Date();
  const day = Number.isNaN(requested.getTime()) ? new Date() : requested;

  const digest = await getDailyDigest(day);
  const previous = toIsoDate(subDays(day, 1));
  const next = toIsoDate(new Date(day.getTime() + 86_400_000));
  const isToday = toIsoDate(day) === toIsoDate(new Date());

  return (
    <Shell
      current="/digest"
      title="Daily digest"
      subtitle={formatDate(new Date(`${digest.date}T00:00:00Z`))}
      actions={
        <div className="flex items-center gap-1.5">
          <Pill href={`/digest?date=${previous}`}>← Previous day</Pill>
          {!isToday ? <Pill href={`/digest?date=${next}`}>Next day →</Pill> : null}
          <Pill href="/digest">Today</Pill>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="New programs" value={digest.newProgramCount} tone="new" />
        <StatTile label="With API targets" value={digest.apiCount} />
        <StatTile label="With mobile targets" value={digest.mobileCount} />
        <StatTile label="With wildcards" value={digest.wildcardCount} />
        <StatTile label="Changes detected" value={digest.changes.length} tone="accent" />
      </div>

      {digest.highestReward ? (
        <Card className="mb-4">
          <SectionTitle>Highest reward of the day</SectionTitle>
          <div className="flex flex-wrap items-baseline gap-3">
            <Link
              href={`/programs/${digest.highestReward.programId}`}
              className="text-lg font-bold hover:text-accent"
            >
              {digest.highestReward.companyName}
            </Link>
            <span className="tabular text-xl font-bold text-paid">
              {formatAmount(digest.highestReward.amount, digest.highestReward.currency)}
            </span>
          </div>
        </Card>
      ) : null}

      <Card className="mb-4">
        <SectionTitle hint="Programs first discovered on this date.">Newly discovered</SectionTitle>
        {digest.newPrograms.length === 0 ? (
          <EmptyState
            title="No new programs discovered on this date"
            hint="Discovery runs on a schedule; check a different day or trigger a run from the admin panel."
          />
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-1.5 pr-3 text-[11px] font-bold uppercase tracking-wide text-faint">Company</th>
                  <th className="py-1.5 pr-3 text-[11px] font-bold uppercase tracking-wide text-faint">Type</th>
                  <th className="py-1.5 pr-3 text-[11px] font-bold uppercase tracking-wide text-faint">Launch date</th>
                  <th className="py-1.5 pr-3 text-right text-[11px] font-bold uppercase tracking-wide text-faint">Reward</th>
                  <th className="py-1.5 text-right text-[11px] font-bold uppercase tracking-wide text-faint">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {digest.newPrograms.map((program) => (
                  <tr key={program.id} className="border-b border-border last:border-0 hover:bg-surface-hover">
                    <td className="py-2 pr-3">
                      <Link href={`/programs/${program.id}`} className="font-semibold hover:text-accent">
                        {program.companyName}
                      </Link>
                      <span className="block text-[11px] text-faint">{program.name}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <ProgramTypeBadge type={program.programType} />
                    </td>
                    <td className="tabular py-2 pr-3">
                      {program.launchDate ? formatDate(program.launchDate) : <Unknown />}
                    </td>
                    <td className="tabular py-2 pr-3 text-right font-semibold text-paid">
                      {program.maxBounty !== null ? (
                        formatAmount(program.maxBounty, program.currency)
                      ) : (
                        <span className="font-normal text-faint italic">Not specified</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <ConfidenceBadge score={program.confidenceScore} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {digest.changes.length > 0 ? (
        <Card>
          <SectionTitle>Changes on existing programs</SectionTitle>
          <ul className="flex flex-col">
            {digest.changes.map((change) => (
              <li key={change.id} className="flex items-center gap-2 border-b border-border py-2 last:border-0">
                <Badge
                  tone={
                    change.severity === 'high'
                      ? 'danger'
                      : change.severity === 'medium'
                        ? 'warn'
                        : change.severity === 'low'
                          ? 'info'
                          : 'neutral'
                  }
                >
                  {change.severity}
                </Badge>
                <Link href={`/programs/${change.programId}`} className="font-semibold hover:text-accent">
                  {change.companyName}
                </Link>
                <span className="text-muted">{change.summary}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Shell>
  );
}
