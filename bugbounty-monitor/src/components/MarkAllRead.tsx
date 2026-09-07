'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch('/api/notifications/read', { method: 'POST' });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-semibold text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
    >
      {busy ? 'Marking…' : 'Mark all read'}
    </button>
  );
}
