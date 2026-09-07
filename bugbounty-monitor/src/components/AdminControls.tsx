'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, SectionTitle } from './ui';

/** Manual triggers: run discovery, submit a URL, run verification. */
export function AdminControls({ queueAvailable }: { queueAvailable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [domains, setDomains] = useState('');
  const [submitUrl, setSubmitUrl] = useState('');

  async function call(action: string, path: string, body: unknown) {
    setBusy(action);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setError(String(payload.error ?? `Request failed (${response.status})`));
        return;
      }
      setMessage(summarise(payload));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
    } finally {
      setBusy(null);
    }
  }

  const domainList = domains
    .split(/[\s,]+/)
    .map((d) => d.trim())
    .filter(Boolean);

  return (
    <Card>
      <SectionTitle
        hint={
          queueAvailable
            ? 'Jobs are queued to the background worker.'
            : 'No job queue detected — actions run inline and may take a while.'
        }
      >
        Manual actions
      </SectionTitle>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-faint" htmlFor="admin-domains">
            Target domains (optional, space or comma separated)
          </label>
          <input
            id="admin-domains"
            type="text"
            value={domains}
            onChange={(event) => setDomains(event.target.value)}
            placeholder="example.com acme.io"
            className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
          />
          <p className="text-[11px] text-faint">
            Leave empty to walk the seed list, least recently crawled first.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Action
            label="Run discovery"
            busy={busy === 'discovery'}
            disabled={busy !== null}
            onClick={() =>
              call('discovery', '/api/discovery/run', {
                domains: domainList.length > 0 ? domainList : undefined,
                inline: !queueAvailable,
                ingestLimit: queueAvailable ? undefined : 20,
              })
            }
            primary
          />
          <Action
            label="Run verification"
            busy={busy === 'verify'}
            disabled={busy !== null}
            onClick={() =>
              call('verify', '/api/verification/run', {
                inline: !queueAvailable,
                limit: queueAvailable ? undefined : 10,
              })
            }
          />
        </div>

        <form
          className="flex flex-col gap-1.5 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void call('submit', '/api/discovery/submit', { url: submitUrl });
          }}
        >
          <label className="text-[11px] font-semibold uppercase tracking-wide text-faint" htmlFor="admin-url">
            Submit a program URL directly
          </label>
          <div className="flex gap-2">
            <input
              id="admin-url"
              type="url"
              required
              value={submitUrl}
              onChange={(event) => setSubmitUrl(event.target.value)}
              placeholder="https://example.com/security/bug-bounty"
              className="flex-1 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-semibold text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
            >
              {busy === 'submit' ? 'Fetching…' : 'Fetch & classify'}
            </button>
          </div>
          <p className="text-[11px] text-faint">
            Bypasses the confidence floor so you can see exactly how the classifier reads a page.
          </p>
        </form>

        {message ? (
          <p className="rounded-lg bg-ok-soft px-2.5 py-1.5 font-mono text-[11px] text-ok">{message}</p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function Action({
  label,
  busy,
  disabled,
  onClick,
  primary,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50 ${
        primary
          ? 'bg-accent text-accent-contrast hover:opacity-90'
          : 'border border-border bg-surface text-muted hover:bg-surface-hover hover:text-text'
      }`}
    >
      {busy ? 'Running…' : label}
    </button>
  );
}

function summarise(payload: Record<string, unknown>): string {
  if (payload.queued) return `Queued (job ${String(payload.jobId ?? '?')})`;
  const stats = payload.stats as Record<string, number> | undefined;
  if (stats) {
    return Object.entries(stats)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ') || 'Run completed with no new results';
  }
  const data = payload.data as Record<string, unknown> | undefined;
  if (data?.status) return `${String(data.status)}${data.reason ? `: ${String(data.reason)}` : ''}`;
  return 'Done';
}
