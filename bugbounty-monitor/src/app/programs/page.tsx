import { Shell } from '@/components/Shell';
import { FilterPanel, CustomDateRange, DatePresets, Pagination, SortControl } from '@/components/Filters';
import { ProgramTable } from '@/components/ProgramTable';
import { Card, SectionTitle } from '@/components/ui';
import { describeFilter, parseFilters } from '@/server/filters';
import { listPrograms } from '@/server/repos/queryRepo';
import { flatten } from '../page';

export const dynamic = 'force-dynamic';

/** The full catalogue, with no default date window. */
export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatten(await searchParams);
  const filter = parseFilters(params);
  const result = await listPrograms(filter);
  const description = describeFilter(filter);

  return (
    <Shell
      current="/programs"
      title="All programs"
      subtitle={
        description.length > 0
          ? `Filtered by ${description.join(' · ')}`
          : 'Every self-hosted program the crawler has verified.'
      }
    >
      <Card className="mb-3">
        <SectionTitle>Date window</SectionTitle>
        <div className="flex flex-col gap-3">
          <DatePresets base="/programs" params={params} />
          <div className="border-t border-border pt-3">
            <CustomDateRange base="/programs" params={params} />
          </div>
        </div>
      </Card>

      <div className="mb-3">
        <FilterPanel base="/programs" params={params} total={result.total} />
      </div>

      <div className="mb-2.5">
        <SortControl base="/programs" params={params} />
      </div>

      <ProgramTable
        programs={result.items}
        emptyTitle="No programs match these filters"
        emptyHint="Try clearing a filter, or search for a company, asset or technology."
      />

      <div className="mt-3">
        <Pagination base="/programs" params={params} page={result.page} totalPages={result.totalPages} />
      </div>
    </Shell>
  );
}
