import type { ReactNode } from 'react';
import { confidenceBand, PROGRAM_TYPE_SHORT, type ProgramType } from '@/lib/constants';

/** Small presentational primitives shared across the dashboard. */

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'new' | 'paid';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-neutral-soft text-muted',
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  new: 'bg-new-soft text-new',
  paid: 'bg-paid-soft text-paid',
};

export function Badge({
  children,
  tone = 'neutral',
  title,
  mono = false,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
  mono?: boolean;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap ${TONE_CLASSES[tone]} ${mono ? 'font-mono' : ''}`}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`rounded-[10px] border border-border bg-surface shadow-[var(--shadow)] ${padded ? 'p-4' : ''} ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  children,
  actions,
  hint,
}: {
  children: ReactNode;
  actions?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted">{children}</h2>
        {hint ? <p className="mt-0.5 text-xs text-faint">{hint}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A headline counter for the dashboard strip. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
  href?: string;
}) {
  const accentText =
    tone === 'new' ? 'text-new' : tone === 'paid' ? 'text-paid' : tone === 'accent' ? 'text-accent' : 'text-text';

  const inner = (
    <div className="rounded-[10px] border border-border bg-surface p-3 shadow-[var(--shadow)] transition-colors hover:bg-surface-hover">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{label}</p>
      <p className={`tabular mt-1 text-2xl font-bold leading-none ${accentText}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-faint">{hint}</p> : null}
    </div>
  );

  return href ? (
    <a href={href} className="block">
      {inner}
    </a>
  ) : (
    inner
  );
}

/** Consistent rendering of a value we could not establish. */
export function Unknown({ label = 'Unknown' }: { label?: string }) {
  return <span className="text-faint italic">{label}</span>;
}

export function ProgramTypeBadge({ type }: { type: string }) {
  const label = PROGRAM_TYPE_SHORT[type as ProgramType] ?? type;
  const tone: Tone = type === 'bug_bounty' ? 'paid' : type === 'unknown' ? 'neutral' : 'info';
  return <Badge tone={tone}>{label}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Tone = status === 'active' ? 'ok' : status === 'inactive' ? 'danger' : 'neutral';
  const dot = status === 'active' ? '●' : status === 'inactive' ? '●' : '○';
  return (
    <Badge tone={tone} title={`Program status: ${status}`}>
      <span aria-hidden>{dot}</span>
      {status === 'unknown' ? 'Unknown' : status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

/**
 * Confidence is shown as a number *and* a band, because a bare percentage
 * invites more trust than the underlying evidence justifies.
 */
export function ConfidenceBadge({ score }: { score: number }) {
  const tone: Tone = score >= 80 ? 'ok' : score >= 60 ? 'info' : score >= 40 ? 'warn' : 'danger';
  return (
    <Badge tone={tone} title={`Confidence: ${confidenceBand(score)}`} mono>
      {score}%
    </Badge>
  );
}

export function SelfHostedBadge({
  selfHosted,
  hasThirdParty,
}: {
  selfHosted: boolean;
  hasThirdParty: boolean;
}) {
  if (!selfHosted) return <Badge tone="danger">Third-party</Badge>;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone="accent" title="Published on the organisation's own domain">
        Self-hosted
      </Badge>
      {hasThirdParty ? (
        <Badge tone="neutral" title="A third-party platform program also exists">
          + platform
        </Badge>
      ) : null}
    </span>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-border bg-surface-2 px-6 py-12 text-center">
      <p className="text-sm font-semibold">{title}</p>
      {hint ? <p className="max-w-md text-xs leading-relaxed text-muted">{hint}</p> : null}
      {action}
    </div>
  );
}

export function Pill({
  active,
  children,
  href,
  title,
}: {
  active?: boolean;
  children: ReactNode;
  href: string;
  title?: string;
}) {
  return (
    <a
      href={href}
      title={title}
      className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
        active
          ? 'border-accent bg-accent text-accent-contrast'
          : 'border-border bg-surface text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text'
      }`}
    >
      {children}
    </a>
  );
}
