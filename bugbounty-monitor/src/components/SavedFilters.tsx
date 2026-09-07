'use client';

import { useEffect, useState } from 'react';
import { Card, SectionTitle } from './ui';

interface SavedFilter {
  id: number;
  name: string;
  enabled: boolean;
  criteria: Record<string, unknown>;
  channels: string[];
  onNewProgram: boolean;
  onScopeChange: boolean;
  onRewardChange: boolean;
  onProgramClosed: boolean;
}

interface ChannelInfo {
  id: string;
  label: string;
  configured: boolean;
  reason: string | null;
}

/**
 * Saved subscriptions.
 *
 * The criteria field takes the same query string the dashboard produces, so a
 * researcher can build a view with the filter panel, copy the URL's query and
 * subscribe to exactly that.
 */
export function SavedFilters() {
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [name, setName] = useState('');
  const [criteria, setCriteria] = useState('days=7&paid=true&hasApi=true');
  const [selected, setSelected] = useState<string[]>(['in_app']);
  const [events, setEvents] = useState({ onNewProgram: true, onScopeChange: false, onRewardChange: false, onProgramClosed: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch('/api/filters');
    if (!response.ok) return;
    const body = (await response.json()) as { data: SavedFilter[]; availableChannels: ChannelInfo[] };
    setFilters(body.data);
    setChannels(body.availableChannels);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const parsed = Object.fromEntries(new URLSearchParams(criteria).entries());
      const response = await fetch('/api/filters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, criteria: parsed, channels: selected, ...events }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Could not save the filter');
        return;
      }
      setName('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    await fetch(`/api/filters?id=${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <Card>
      <SectionTitle hint="Subscribe to a filter to be notified when matching programs appear or change.">
        Saved filters
      </SectionTitle>

      {filters.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-2">
          {filters.map((filter) => (
            <li key={filter.id} className="rounded-lg border border-border bg-surface-2 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{filter.name}</p>
                  <p className="break-all font-mono text-[11px] text-faint">
                    {new URLSearchParams(filter.criteria as Record<string, string>).toString() || 'no criteria'}
                  </p>
                  <p className="mt-1 text-[11px] text-faint">
                    {[
                      filter.onNewProgram && 'new programs',
                      filter.onScopeChange && 'scope changes',
                      filter.onRewardChange && 'reward changes',
                      filter.onProgramClosed && 'closures',
                    ]
                      .filter(Boolean)
                      .join(', ') || 'no events'}
                    {' · '}
                    {filter.channels.join(', ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(filter.id)}
                  className="shrink-0 text-[11px] font-semibold text-danger hover:underline"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={create} className="flex flex-col gap-2 border-t border-border pt-3">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Filter name, e.g. Paid API programs"
          className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <input
          type="text"
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          placeholder="days=7&paid=true&hasApi=true"
          className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <p className="text-[11px] text-faint">
          Paste the query string from any dashboard URL to subscribe to that exact view.
        </p>

        <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Notify on</legend>
          {(
            [
              ['onNewProgram', 'New programs'],
              ['onScopeChange', 'Scope changes'],
              ['onRewardChange', 'Reward changes'],
              ['onProgramClosed', 'Closures'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 text-[12px]">
              <input
                type="checkbox"
                checked={events[key]}
                onChange={(e) => setEvents({ ...events, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Channels</legend>
          {channels.map((channel) => (
            <label
              key={channel.id}
              className={`flex items-center gap-1.5 text-[12px] ${channel.configured ? '' : 'text-faint'}`}
              title={channel.reason ?? undefined}
            >
              <input
                type="checkbox"
                disabled={!channel.configured}
                checked={selected.includes(channel.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, channel.id]
                      : selected.filter((id) => id !== channel.id),
                  )
                }
              />
              {channel.label}
              {!channel.configured ? ' (not configured)' : ''}
            </label>
          ))}
        </fieldset>

        {error ? <p className="text-[12px] text-danger">{error}</p> : null}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-contrast hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save filter'}
        </button>
      </form>
    </Card>
  );
}
