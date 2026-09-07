import { Shell } from '@/components/Shell';
import { BarChart, BreakdownList } from '@/components/Charts';
import { Card, SectionTitle, StatTile } from '@/components/ui';
import { PROGRAM_TYPE_SHORT, type ProgramType } from '@/lib/constants';
import { formatAmountShort } from '@/pipeline/extract/rewards';
import {
  getDashboardStats,
  getDiscoveriesPerDay,
  getDiscoveriesPerWeek,
  getProgramTypeBreakdown,
  getRewardRangeBreakdown,
  getScopeCategoryBreakdown,
  getTopCountries,
} from '@/server/repos/statsRepo';

export const dynamic = 'force-dynamic';

export default async function StatsPage() {
  const [summary, perDay, perWeek, types, rewards, countries, scope] = await Promise.all([
    getDashboardStats(),
    getDiscoveriesPerDay(30),
    getDiscoveriesPerWeek(12),
    getProgramTypeBreakdown(),
    getRewardRangeBreakdown(),
    getTopCountries(10),
    getScopeCategoryBreakdown(),
  ]);

  return (
    <Shell
      current="/stats"
      title="Statistics"
      subtitle="Discovery volume, program composition and scope coverage across the catalogue."
    >
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
        <StatTile label="Total programs" value={summary.totalPrograms} />
        <StatTile label="New today" value={summary.newToday} tone="new" />
        <StatTile label="New this week" value={summary.newThisWeek} tone="new" />
        <StatTile label="Active" value={summary.activePrograms} tone="accent" />
        <StatTile label="Paid" value={summary.paidPrograms} tone="paid" />
        <StatTile label="With APIs" value={summary.programsWithApi} />
        <StatTile label="With mobile apps" value={summary.programsWithMobile} />
        <StatTile label="Changed this week" value={summary.changedThisWeek} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle hint="Programs first discovered per day, last 30 days.">
            Discoveries per day
          </SectionTitle>
          <BarChart data={perDay} label="Programs discovered per day" />
        </Card>

        <Card>
          <SectionTitle hint="Programs first discovered per week, last 12 weeks.">
            Discoveries per week
          </SectionTitle>
          <BarChart data={perWeek} label="Programs discovered per week" />
        </Card>

        <Card>
          <SectionTitle>Program types</SectionTitle>
          <BreakdownList
            data={types}
            label="Program types"
            formatKey={(key) => PROGRAM_TYPE_SHORT[key as ProgramType] ?? key}
          />
        </Card>

        <Card>
          <SectionTitle hint="Based on the maximum bounty published on each program page.">
            Reward ranges
          </SectionTitle>
          <BreakdownList data={rewards} label="Reward ranges" />
        </Card>

        <Card>
          <SectionTitle hint="Derived from structured data, ccTLD or a published address.">
            Top countries
          </SectionTitle>
          <BreakdownList data={countries} label="Top countries" />
        </Card>

        <Card>
          <SectionTitle hint="How many programs include each kind of asset in scope.">
            Scope categories
          </SectionTitle>
          <BreakdownList data={scope} label="Scope categories" />
        </Card>
      </div>

      <Card className="mt-4">
        <SectionTitle>Catalogue summary</SectionTitle>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
          <Row label="Average confidence" value={`${summary.averageConfidence}%`} />
          <Row label="Programs with wildcards" value={String(summary.programsWithWildcard)} />
          <Row label="New in last 30 days" value={String(summary.newThisMonth)} />
          <Row
            label="Highest known bounty"
            value={
              summary.highestBounty
                ? `${formatAmountShort(summary.highestBounty.amount, summary.highestBounty.currency)} · ${summary.highestBounty.companyName}`
                : 'Not specified'
            }
          />
        </dl>
      </Card>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="tabular mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}
