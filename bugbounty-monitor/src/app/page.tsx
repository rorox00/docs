import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { FilterPanel, DatePresets, CustomDateRange, Pagination, SortControl } from '@/components/Filters';
import { ProgramTable } from '@/components/ProgramTable';
import { Card, SectionTitle, StatTile } from '@/components/ui';
import { parseFilters } from '@/server/filters';
import { listPrograms } from '@/server/repos/queryRepo';
import { getDashboardStats } from '@/server/repos/statsRepo';
import { formatAmountShort } from '@/pipeline/extract/rewards';

export const dynamic = 'force-dynamic';

/**
 * The primary screen: newly discovered self-hosted programs.
 *
 * Defaults to the last 7 days, newest first, self-hosted only — the view a
 * researcher wants on opening the app.
 */
export default async function NewProgramsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = flatten(raw);

  // Default window, unless the visitor chose one.
  const effective = { ...params };
  if (!effective.days && !effective.from && !effective.to && !effective.launchedWithinDays) {
    effective.days = '7';
  }

  const filter = parseFilters(effective);
  const [result, stats] = await Promise.all([listPrograms(filter), getDashboardStats()]);

  return (
    <Shell
      current="/"
      title="New self-hosted programs"
      subtitle="Vulnerability disclosure and bug bounty programs published on companies' own domains."
      actions={
        <Link
          href="/programs"
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-semibold text-muted hover:bg-surface-hover hover:text-text"
        >
          Browse all programs →
        </Link>
      }
    >
      {/* Counter strip */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
        <StatTile label="New today" value={stats.newToday} tone="new" href="/?days=0" />
        <StatTile label="New 7 days" value={stats.newThisWeek} tone="new" href="/?days=7" />
        <StatTile label="New 30 days" value={stats.newThisMonth} href="/?days=30" />
        <StatTile label="Total" value={stats.totalPrograms} href="/programs" />
        <StatTile label="Active" value={stats.activePrograms} tone="accent" href="/programs?status=active" />
        <StatTile label="Paid" value={stats.paidPrograms} tone="paid" href="/programs?paid=true" />
        <StatTile label="With API" value={stats.programsWithApi} href="/programs?hasApi=true" />
        <StatTile
          label="Changed 7d"
          value={stats.changedThisWeek}
          href="/changes?days=7"
          hint={
            stats.highestBounty
              ? `Top bounty ${formatAmountShort(stats.highestBounty.amount, stats.highestBounty.currency)}`
              : undefined
          }
        />
      </div>

      {/* Date window */}
      <Card className="mb-3">
        <SectionTitle hint="Programs are ranked by launch date where known, otherwise by when we first discovered them.">
          Discovery window
        </SectionTitle>
        <div className="flex flex-col gap-3">
          <DatePresets base="/" params={params} />
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">
              Launched within
            </span>
            <DatePresets base="/" params={params} field="launchedWithinDays" />
          </div>
          <div className="border-t border-border pt-3">
            <CustomDateRange base="/" params={params} />
          </div>
        </div>
      </Card>

      <div className="mb-3">
        <FilterPanel base="/" params={params} total={result.total} />
      </div>

      <div className="mb-2.5">
        <SortControl base="/" params={params} />
      </div>

      <ProgramTable
        programs={result.items}
        emptyTitle="No new programs in this window"
        emptyHint="Widen the date range, relax the filters, or run a discovery pass from the admin panel to populate the database."
      />

      <div className="mt-3">
        <Pagination base="/" params={params} page={result.page} totalPages={result.totalPages} />
      </div>
    </Shell>
  );
}

/** Next gives repeated query params as arrays; the filters work on scalars. */
export function flatten(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}
