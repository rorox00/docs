import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/LoginForm';
import { ThemeScript } from '@/components/ThemeToggle';
import { env } from '@/lib/env';
import { getSession } from '@/server/auth';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getSession()) redirect('/');

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <ThemeScript />
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-contrast"
          >
            ⌖
          </span>
          <span className="text-sm font-bold uppercase tracking-[0.1em]">Bug Bounty Monitor</span>
        </Link>

        <div className="rounded-[10px] border border-border bg-surface p-5 shadow-[var(--shadow)]">
          <LoginForm allowSignup={env().ALLOW_SIGNUP} />
        </div>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-faint">
          Signing in unlocks saved filters, notifications and, for administrators, the crawler
          controls. Browsing programs does not require an account.
        </p>
      </div>
    </div>
  );
}
