import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { Nav } from './Nav';

/** Page chrome: sticky nav, centred content column, footer. */
export function Shell({
  current,
  title,
  subtitle,
  actions,
  children,
}: {
  current: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg">
      <Suspense fallback={<div className="h-12 border-b border-border bg-surface" />}>
        <Nav current={current} />
      </Suspense>

      <main className="mx-auto max-w-[1600px] px-4 py-5">
        {title ? (
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight">{title}</h1>
              {subtitle ? <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        {children}
      </main>

      <footer className="mx-auto max-w-[1600px] px-4 pb-8 pt-4">
        <p className="text-[11px] leading-relaxed text-faint">
          Bug Bounty Monitor observes publicly published vulnerability disclosure information only. It
          performs no scanning, exploitation or testing of any kind against the programs it lists.
          Always read a program&rsquo;s own policy before testing.
        </p>
      </footer>
    </div>
  );
}
