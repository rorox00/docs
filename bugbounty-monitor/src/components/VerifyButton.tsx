'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** Admin action: re-crawl a single program on demand. */
export function VerifyButton({ programId }: { programId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/programs/${programId}/verify`, { method: 'POST' });
      const body = (await response.json()) as { queued?: boolean; error?: string; changed?: number };
      if (!response.ok) {
        setStatus(body.error ?? 'Verification failed');
        return;
      }
      setStatus(body.queued ? 'Queued for verification' : `Verified (${body.changed ?? 0} change(s))`);
      startTransition(() => router.refresh());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={verify}
        disabled={busy || pending}
        className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-semibold text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
      >
        {busy || pending ? 'Verifying…' : 'Verify now'}
      </button>
      {status ? <span className="text-[11px] text-faint">{status}</span> : null}
    </span>
  );
}
