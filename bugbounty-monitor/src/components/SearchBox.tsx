'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Global search. Submits to /programs so results land on the filterable list,
 * and binds `/` as a focus shortcut the way researcher tooling usually does.
 */
export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(params.get('q') ?? '');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === 'Escape') inputRef.current?.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        router.push(query ? `/programs?q=${encodeURIComponent(query)}` : '/programs');
      }}
      className="relative"
    >
      <span aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-faint">
        ⌕
      </span>
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search company, asset, tech…"
        aria-label="Search programs"
        className="w-40 rounded-lg border border-border bg-surface-2 py-1.5 pl-6 pr-7 text-[13px] text-text placeholder:text-faint focus:w-56 focus:border-accent focus:outline-none sm:w-52"
      />
      <kbd
        aria-hidden
        className="pointer-events-none absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1 text-[10px] text-faint sm:block"
      >
        /
      </kbd>
    </form>
  );
}
