import Link from 'next/link';
import { getSession } from '@/server/auth';
import { countUnread } from '@/server/notifications/dispatcher';
import { ThemeToggle } from './ThemeToggle';
import { SearchBox } from './SearchBox';

const LINKS = [
  { href: '/', label: 'New Programs' },
  { href: '/programs', label: 'All Programs' },
  { href: '/changes', label: 'Changes' },
  { href: '/digest', label: 'Digest' },
  { href: '/stats', label: 'Statistics' },
];

export async function Nav({ current }: { current: string }) {
  const session = await getSession();
  const unread = session ? await countUnread(session.userId) : 0;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span
            aria-hidden
            className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[13px] font-bold text-accent-contrast"
          >
            ⌖
          </span>
          <span className="text-[13px] font-bold uppercase tracking-[0.1em]">Bug Bounty Monitor</span>
        </Link>

        <nav className="flex flex-1 flex-wrap items-center gap-0.5" aria-label="Main">
          {LINKS.map((link) => {
            const active = link.href === '/' ? current === '/' : current.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-md px-2.5 py-1.5 text-[13px] font-semibold transition-colors ${
                  active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-hover hover:text-text'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          {session?.role === 'admin' ? (
            <Link
              href="/admin"
              aria-current={current.startsWith('/admin') ? 'page' : undefined}
              className={`rounded-md px-2.5 py-1.5 text-[13px] font-semibold transition-colors ${
                current.startsWith('/admin')
                  ? 'bg-accent-soft text-accent'
                  : 'text-muted hover:bg-surface-hover hover:text-text'
              }`}
            >
              Admin
            </Link>
          ) : null}
        </nav>

        <div className="flex items-center gap-2">
          <SearchBox />
          {session ? (
            <>
              <Link
                href="/notifications"
                className="relative rounded-md px-2 py-1.5 text-[13px] text-muted hover:bg-surface-hover hover:text-text"
                title="Notifications"
              >
                <span aria-hidden>🔔</span>
                <span className="sr-only">Notifications</span>
                {unread > 0 ? (
                  <span className="tabular absolute -right-0.5 -top-0.5 rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                ) : null}
              </Link>
              <form action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  className="rounded-md px-2 py-1.5 text-[13px] font-semibold text-muted hover:bg-surface-hover hover:text-text"
                  title={session.email}
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg border border-border px-2.5 py-1 text-[13px] font-semibold text-muted hover:bg-surface-hover hover:text-text"
            >
              Sign in
            </Link>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
