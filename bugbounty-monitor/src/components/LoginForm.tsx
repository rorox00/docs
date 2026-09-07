'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Sign in / register. The first account created becomes the administrator. */
export function LoginForm({ allowSignup }: { allowSignup: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'register' ? { email, password, name } : { email, password }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Something went wrong');
        return;
      }
      router.push('/');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h1 className="text-base font-bold">{mode === 'login' ? 'Sign in' : 'Create an account'}</h1>

      {mode === 'register' ? (
        <Field label="Name (optional)">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            className="w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-text focus:border-accent focus:outline-none"
          />
        </Field>
      ) : null}

      <Field label="Email">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-text focus:border-accent focus:outline-none"
        />
      </Field>

      <Field label="Password" hint={mode === 'register' ? 'At least 10 characters' : undefined}>
        <input
          type="password"
          required
          minLength={mode === 'register' ? 10 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          className="w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-text focus:border-accent focus:outline-none"
        />
      </Field>

      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-accent-contrast hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>

      {allowSignup ? (
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
          className="text-[12px] text-muted hover:text-accent"
        >
          {mode === 'login' ? 'Need an account? Register' : 'Already have an account? Sign in'}
        </button>
      ) : null}
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
    </label>
  );
}
