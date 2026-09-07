'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SOURCE_KIND_LABELS, type SourceKind } from '@/lib/constants';
import { displayUrl } from '@/lib/url';
import { Badge, EmptyState } from './ui';

export interface CandidateRow {
  id: number;
  url: string;
  domain: string;
  sourceKind: string;
  priority: number;
  discoveredAt: string;
}

/**
 * Approve or reject queued candidate URLs.
 *
 * Approving runs the full pipeline on the URL immediately and bypasses the
 * confidence floor, because an operator has already judged it worth keeping.
 */
export function CandidateReview({ initial }: { initial: CandidateRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, string>>({});

  async function act(id: number, action: 'approve' | 'reject') {
    setBusy(id);
    try {
      const response = await fetch('/api/admin/candidates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const payload = (await response.json()) as {
        data?: { status?: string; reason?: string };
        error?: string;
      };

      if (!response.ok) {
        setResults((prev) => ({ ...prev, [id]: payload.error ?? 'Failed' }));
        return;
      }

      const status = payload.data?.status ?? action;
      setResults((prev) => ({
        ...prev,
        [id]: payload.data?.reason ? `${status}: ${payload.data.reason}` : status,
      }));
      // Rejections vanish immediately; approvals stay visible with their result
      // so the operator can see how the classifier read the page.
      if (action === 'reject') setRows((prev) => prev.filter((row) => row.id !== id));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No candidates awaiting review"
        hint="Run discovery to populate the queue, or submit a URL directly above."
      />
    );
  }

  return (
    <div className="scroll-x">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-1.5 pr-3 text-[11px] font-bold uppercase tracking-wide text-faint">URL</th>
            <th className="py-1.5 pr-3 text-[11px] font-bold uppercase tracking-wide text-faint">Source</th>
            <th className="py-1.5 pr-3 text-right text-[11px] font-bold uppercase tracking-wide text-faint">Priority</th>
            <th className="py-1.5 text-right text-[11px] font-bold uppercase tracking-wide text-faint">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-0">
              <td className="py-2 pr-3">
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer noopener nofollow"
                  className="break-all font-mono text-[12px] hover:text-accent"
                >
                  {displayUrl(row.url, 70)}
                </a>
                {results[row.id] ? (
                  <p className="mt-0.5 text-[11px] text-muted">{results[row.id]}</p>
                ) : null}
              </td>
              <td className="py-2 pr-3">
                <Badge tone="neutral">
                  {SOURCE_KIND_LABELS[row.sourceKind as SourceKind] ?? row.sourceKind}
                </Badge>
              </td>
              <td className="tabular py-2 pr-3 text-right font-semibold">{row.priority}</td>
              <td className="py-2 text-right">
                <span className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act(row.id, 'approve')}
                    className="rounded-md border border-ok px-2 py-0.5 text-[11px] font-semibold text-ok hover:bg-ok-soft disabled:opacity-50"
                  >
                    {busy === row.id ? '…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act(row.id, 'reject')}
                    className="rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-muted hover:bg-surface-hover disabled:opacity-50"
                  >
                    Reject
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
