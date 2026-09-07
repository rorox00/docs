import type { Breakdown, TimeSeriesPoint } from '@/server/repos/statsRepo';

/**
 * Charts are rendered as inline SVG/CSS on the server.
 *
 * A monitoring dashboard should not ship a charting library to draw six small
 * plots, and server rendering keeps them correct with JavaScript disabled.
 * Colours come from theme tokens, so both themes work without extra work.
 */

/** Bars sit on a shared baseline so day-to-day differences read at a glance. */
export function BarChart({
  data,
  label,
  height = 120,
}: {
  data: TimeSeriesPoint[];
  label: string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {label}: {total} across {data.length} periods
      </figcaption>
      <div
        className="flex items-end gap-[2px]"
        style={{ height }}
        role="img"
        aria-label={`${label}. ${data
          .slice(-7)
          .map((d) => `${d.date}: ${d.count}`)
          .join(', ')}`}
      >
        {data.map((point) => {
          const ratio = point.count / max;
          return (
            <div
              key={point.date}
              className="group relative flex-1 rounded-t-sm bg-accent transition-opacity hover:opacity-80"
              style={{
                height: `${Math.max(point.count > 0 ? 4 : 1, ratio * 100)}%`,
                opacity: point.count === 0 ? 0.18 : 0.55 + ratio * 0.45,
              }}
              title={`${point.date}: ${point.count}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-faint">
        <span>{data[0]?.date ?? ''}</span>
        <span className="tabular font-semibold">{total} total</span>
        <span>{data[data.length - 1]?.date ?? ''}</span>
      </div>
    </figure>
  );
}

/** Horizontal bars for categorical breakdowns. */
export function BreakdownList({
  data,
  label,
  formatKey,
}: {
  data: Breakdown[];
  label: string;
  formatKey?: (key: string) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));

  if (data.length === 0) {
    return <p className="text-[13px] text-faint italic">No data yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5" aria-label={label}>
      {data.map((item) => (
        <li key={item.key} className="flex items-center gap-2">
          <span className="w-32 shrink-0 truncate text-[12px] text-muted" title={item.label}>
            {formatKey ? formatKey(item.key) : item.label}
          </span>
          <div className="h-4 flex-1 overflow-hidden rounded-sm bg-neutral-soft">
            <div
              className="h-full rounded-sm bg-accent"
              style={{ width: `${Math.max(2, (item.count / max) * 100)}%`, opacity: 0.55 + (item.count / max) * 0.45 }}
            />
          </div>
          <span className="tabular w-10 shrink-0 text-right text-[12px] font-semibold">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Sparkline used inside cards where a full chart would be too heavy. */
export function Sparkline({ data, width = 160, height = 32 }: { data: TimeSeriesPoint[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(1, ...data.map((d) => d.count));
  const step = width / (data.length - 1);
  const points = data
    .map((point, index) => `${(index * step).toFixed(1)},${(height - (point.count / max) * (height - 2) - 1).toFixed(1)}`)
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Discovery trend" className="overflow-visible">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
