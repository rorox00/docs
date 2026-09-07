import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { Badge, Card, EmptyState, Pill, SectionTitle } from '@/components/ui';
import { CHANGE_TYPE_LABELS, type ChangeType } from '@/lib/constants';
import { formatDate, formatRelative } from '@/lib/dates';
import { listChanges } from '@/server/repos/queryRepo';
import { flatten } from '../page';

export const dynamic = 'force-dynamic';

const SEVERITIES = [
  { id: 'high', label: 'High', tone: 'danger' as const },
  { id: 'medium', label: 'Medium', tone: 'warn' as const },
  { id: 'low', label: 'Low', tone: 'info' as const },
  { id: 'info', label: 'Info', tone: 'neutral' as const },
];

const WINDOWS = [
  { days: '1', label: 'Last 24h' },
  { days: '3', label: 'Last 3 days' },
  { days: '7', label: 'Last 7 days' },
  { days: '30', label: 'Last 30 days' },
  { days: undefined, label: 'All time' },
];

/** The change feed: what moved on programs we already track. */
export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatten(await searchParams);
  const days = params.days ? Number.parseInt(params.days, 10) : 7;
  const severity = params.severity ? [params.severity] : undefined;
  const page = params.page ? Math.max(1, Number.parseInt(params.page, 10)) : 1;

  const result = await listChanges({
    days: params.days === undefined && !params.all ? days : params.all ? undefined : days,
    severity,
    page,
    pageSize: 100,
  });

  const href = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...changes, page: undefined })) {
      if (value) next.set(key, value);
    }
    const query = next.toString();
    return query ? `/changes?${query}` : '/changes';
  };

  return (
    <Shell
      current="/changes"
      title="Change feed"
      subtitle="Scope expansions, reward changes, closures and policy updates on tracked programs."
    >
      <Card className="mb-3">
        <SectionTitle>Filters</SectionTitle>
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 text-[11px] font-semibold uppercase tracking-wide text-faint">Window</span>
            {WINDOWS.map((window) => (
              <Pill
                key={window.label}
                href={href({ days: window.days, all: window.days ? undefined : 'true' })}
                active={window.days ? params.days === window.days || (!params.days && window.days === '7' && !params.all) : params.all === 'true'}
              >
                {window.label}
              </Pill>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 text-[11px] font-semibold uppercase tracking-wide text-faint">Severity</span>
            {SEVERITIES.map((option) => (
              <Pill
                key={option.id}
                href={href({ severity: params.severity === option.id ? undefined : option.id })}
                active={params.severity === option.id}
              >
                {option.label}
              </Pill>
            ))}
          </div>
        </div>
      </Card>

      {result.items.length === 0 ? (
        <EmptyState
          title="No changes recorded in this window"
          hint="Changes appear once a program has been crawled at least twice and its published content differs."
        />
      ) : (
        <div className="rounded-[10px] border border-border bg-surface shadow-[var(--shadow)]">
          <ul>
            {result.items.map((change) => {
              const tone =
                change.severity === 'high'
                  ? 'danger'
                  : change.severity === 'medium'
                    ? 'warn'
                    : change.severity === 'low'
                      ? 'info'
                      : 'neutral';
              return (
                <li key={change.id} className="border-b border-border px-4 py-3 last:border-0 hover:bg-surface-hover">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={tone}>
                          {CHANGE_TYPE_LABELS[change.changeType as ChangeType] ?? change.changeType}
                        </Badge>
                        <Link
                          href={`/programs/${change.programId}`}
                          className="text-[13px] font-semibold hover:text-accent"
                        >
                          {change.companyName}
                        </Link>
                        <span className="font-mono text-[11px] text-faint">{change.companyDomain}</span>
                      </div>
                      <p className="mt-1 text-[13px]">{change.summary}</p>
                      {change.previousValue || change.newValue ? (
                        <p className="mt-0.5 font-mono text-[11px] text-faint">
                          {change.previousValue ? <span className="line-through">{change.previousValue.slice(0, 100)}</span> : null}
                          {change.previousValue && change.newValue ? ' → ' : ''}
                          {change.newValue ? <span className="text-ok">{change.newValue.slice(0, 100)}</span> : null}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-[12px] font-semibold">{formatDate(change.detectedAt)}</p>
                      <p className="text-[11px] text-faint">{formatRelative(change.detectedAt)}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {result.total > result.pageSize ? (
        <nav className="mt-3 flex items-center justify-between" aria-label="Pagination">
          <span className="tabular text-xs text-faint">
            {result.total.toLocaleString()} changes · page {result.page}
          </span>
          <div className="flex gap-1.5">
            {result.page > 1 ? <Pill href={`${href({})}${href({}).includes('?') ? '&' : '?'}page=${result.page - 1}`}>← Previous</Pill> : null}
            {result.page * result.pageSize < result.total ? (
              <Pill href={`${href({})}${href({}).includes('?') ? '&' : '?'}page=${result.page + 1}`}>Next →</Pill>
            ) : null}
          </div>
        </nav>
      ) : null}
    </Shell>
  );
}
