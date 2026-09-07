import { PROGRAM_TYPES, PROGRAM_TYPE_SHORT, type ProgramType } from '@/lib/constants';
import { DATE_PRESETS, SORT_LABELS, SORT_OPTIONS, type ProgramFilter } from '@/server/filters';
import { Pill } from './ui';

/**
 * Filter and sort controls.
 *
 * Every control is a link that rewrites the query string, so filters are
 * shareable URLs, work without JavaScript, and can be saved verbatim as a
 * notification subscription.
 */

type Params = Record<string, string | undefined>;

function buildHref(base: string, params: Params, changes: Params): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...changes })) {
    if (value === undefined || value === '') continue;
    next.set(key, value);
  }
  // Any filter change resets paging — page 3 of the old result set is meaningless.
  next.delete('page');
  const query = next.toString();
  return query ? `${base}?${query}` : base;
}

/** Toggle a boolean facet on/off. */
function toggle(params: Params, key: string): Params {
  return { [key]: params[key] === 'true' ? undefined : 'true' };
}

export function DatePresets({
  base,
  params,
  field = 'days',
}: {
  base: string;
  params: Params;
  field?: 'days' | 'launchedWithinDays';
}) {
  const current = params[field];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {DATE_PRESETS.map((preset) => {
        const value = preset.days === null ? undefined : String(preset.days);
        const active = preset.days === null ? current === undefined : current === value;
        return (
          <Pill key={preset.id} href={buildHref(base, params, { [field]: value, from: undefined, to: undefined })} active={active}>
            {preset.label}
          </Pill>
        );
      })}
    </div>
  );
}

export function CustomDateRange({ base, params }: { base: string; params: Params }) {
  return (
    <form action={base} method="get" className="flex flex-wrap items-end gap-2">
      {/* Preserve the other active filters across a range submission. */}
      {Object.entries(params)
        .filter(([key]) => !['from', 'to', 'days', 'page', 'dateField'].includes(key))
        .map(([key, value]) =>
          value ? <input key={key} type="hidden" name={key} value={value} /> : null,
        )}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">From</span>
        <input
          type="date"
          name="from"
          defaultValue={params.from ?? ''}
          className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-[13px] text-text focus:border-accent focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">To</span>
        <input
          type="date"
          name="to"
          defaultValue={params.to ?? ''}
          className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-[13px] text-text focus:border-accent focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">Date field</span>
        <select
          name="dateField"
          defaultValue={params.dateField ?? 'discovered'}
          className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-[13px] text-text focus:border-accent focus:outline-none"
        >
          <option value="discovered">Discovered</option>
          <option value="launch">Launch date</option>
          <option value="verified">Last verified</option>
          <option value="changed">Last changed</option>
        </select>
      </label>
      <button
        type="submit"
        className="rounded-lg border border-accent bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-contrast hover:opacity-90"
      >
        Apply range
      </button>
    </form>
  );
}

export function SortControl({ base, params }: { base: string; params: Params }) {
  const current = params.sort ?? 'newest';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">Sort</span>
      {SORT_OPTIONS.map((option) => (
        <Pill
          key={option}
          href={buildHref(base, params, { sort: option === 'newest' ? undefined : option })}
          active={current === option}
        >
          {SORT_LABELS[option]}
        </Pill>
      ))}
    </div>
  );
}

const FACETS: Array<{ key: string; label: string; title: string }> = [
  { key: 'paid', label: 'Paid', title: 'Programs that pay monetary rewards' },
  { key: 'hasApi', label: 'API', title: 'API targets in scope' },
  { key: 'hasAndroid', label: 'Android', title: 'Android application in scope' },
  { key: 'hasIos', label: 'iOS', title: 'iOS application in scope' },
  { key: 'hasMobile', label: 'Mobile', title: 'Any mobile application in scope' },
  { key: 'hasWildcard', label: 'Wildcard', title: 'Wildcard domain in scope' },
  { key: 'hasCloud', label: 'Cloud', title: 'Cloud assets in scope' },
  { key: 'hasWeb', label: 'Web', title: 'Web applications in scope' },
  { key: 'recentlyChanged', label: 'Recently changed', title: 'Changed in the last 7 days' },
  { key: 'hasThirdParty', label: 'Also on a platform', title: 'A third-party platform program also exists' },
];

export function FilterPanel({
  base,
  params,
  total,
}: {
  base: string;
  params: Params;
  total: number;
}) {
  const activeCount = Object.entries(params).filter(
    ([key, value]) => value && !['sort', 'page', 'pageSize'].includes(key),
  ).length;

  return (
    <section className="rounded-[10px] border border-border bg-surface p-3 shadow-[var(--shadow)]">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Filters</h2>
        <div className="flex items-center gap-2 text-[11px] text-faint">
          <span className="tabular">{total.toLocaleString()} matching</span>
          {activeCount > 0 ? (
            <a href={base} className="font-semibold text-accent hover:underline">
              Clear all
            </a>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {/* Program type */}
        <Row label="Type">
          {PROGRAM_TYPES.filter((t) => t !== 'unknown').map((type) => (
            <Pill
              key={type}
              href={buildHref(base, params, { type: params.type === type ? undefined : type })}
              active={params.type === type}
            >
              {PROGRAM_TYPE_SHORT[type as ProgramType]}
            </Pill>
          ))}
        </Row>

        {/* Status */}
        <Row label="Status">
          {['active', 'inactive', 'unknown'].map((status) => (
            <Pill
              key={status}
              href={buildHref(base, params, { status: params.status === status ? undefined : status })}
              active={params.status === status}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Pill>
          ))}
        </Row>

        {/* Scope + reward facets */}
        <Row label="Scope">
          {FACETS.map((facet) => (
            <Pill
              key={facet.key}
              href={buildHref(base, params, toggle(params, facet.key))}
              active={params[facet.key] === 'true'}
              title={facet.title}
            >
              {facet.label}
            </Pill>
          ))}
        </Row>

        {/* Minimum bounty */}
        <Row label="Min bounty">
          {[100, 500, 1000, 5000, 10000, 25000].map((amount) => (
            <Pill
              key={amount}
              href={buildHref(base, params, {
                minBounty: params.minBounty === String(amount) ? undefined : String(amount),
              })}
              active={params.minBounty === String(amount)}
            >
              ${amount >= 1000 ? `${amount / 1000}K` : amount}+
            </Pill>
          ))}
        </Row>

        {/* Confidence floor */}
        <Row label="Confidence">
          {[
            { value: '40', label: 'Low+' },
            { value: '60', label: 'Medium+' },
            { value: '80', label: 'High+' },
            { value: '95', label: 'Very high' },
          ].map((option) => (
            <Pill
              key={option.value}
              href={buildHref(base, params, {
                minConfidence: params.minConfidence === option.value ? undefined : option.value,
              })}
              active={params.minConfidence === option.value}
            >
              {option.label}
            </Pill>
          ))}
        </Row>

        {/* Free-text scoped filters */}
        <form action={base} method="get" className="flex flex-wrap items-end gap-2 border-t border-border pt-2.5">
          {Object.entries(params)
            .filter(([key]) => !['country', 'technology', 'asset', 'domain', 'page'].includes(key))
            .map(([key, value]) => (value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
          <TextFilter name="country" label="Country" placeholder="US, Germany…" value={params.country} />
          <TextFilter name="technology" label="Technology" placeholder="GraphQL, AWS…" value={params.technology} />
          <TextFilter name="asset" label="Asset" placeholder="api.example.com" value={params.asset} />
          <TextFilter name="domain" label="Domain" placeholder="example.com" value={params.domain} />
          <button
            type="submit"
            className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[13px] font-semibold text-text hover:bg-surface-hover"
          >
            Apply
          </button>
        </form>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-faint">
        {label}
      </span>
      {children}
    </div>
  );
}

function TextFilter({
  name,
  label,
  placeholder,
  value,
}: {
  name: string;
  label: string;
  placeholder: string;
  value?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      <input
        type="text"
        name={name}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        className="w-36 rounded-lg border border-border bg-surface-2 px-2 py-1 text-[13px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
      />
    </label>
  );
}

/** Page navigation for long result sets. */
export function Pagination({
  base,
  params,
  page,
  totalPages,
}: {
  base: string;
  params: Params;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  const href = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) next.set(key, value);
    next.set('page', String(target));
    return `${base}?${next.toString()}`;
  };

  return (
    <nav className="flex items-center justify-between gap-2 pt-1" aria-label="Pagination">
      <span className="tabular text-xs text-faint">
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-1.5">
        {page > 1 ? <Pill href={href(page - 1)}>← Previous</Pill> : null}
        {page < totalPages ? <Pill href={href(page + 1)}>Next →</Pill> : null}
      </div>
    </nav>
  );
}

export function describeActiveFilters(filter: ProgramFilter): string[] {
  const parts: string[] = [];
  if (filter.q) parts.push(`"${filter.q}"`);
  if (filter.type?.length) parts.push(filter.type.map((t) => PROGRAM_TYPE_SHORT[t]).join(', '));
  if (filter.paid) parts.push('paid');
  return parts;
}
