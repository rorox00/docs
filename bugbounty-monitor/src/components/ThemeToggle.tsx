'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'bbm-theme';

/**
 * Theme switcher.
 *
 * "System" leaves the root element unstamped so `prefers-color-scheme` decides;
 * an explicit choice stamps `data-theme`, which the CSS gives precedence to.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === 'light' || stored === 'dark' || stored === 'system') setTheme(stored);
    } catch {
      /* private mode or blocked storage: fall back to system */
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* nothing to do — the choice simply will not persist */
    }
  }, [theme, mounted]);

  const options: Array<{ id: Theme; label: string; icon: string }> = [
    { id: 'light', label: 'Light', icon: '☀' },
    { id: 'dark', label: 'Dark', icon: '☾' },
    { id: 'system', label: 'System', icon: '◐' },
  ];

  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-surface p-0.5" role="group" aria-label="Colour theme">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => setTheme(option.id)}
          aria-pressed={mounted && theme === option.id}
          title={`${option.label} theme`}
          className={`rounded-md px-2 py-1 text-xs transition-colors ${
            mounted && theme === option.id
              ? 'bg-accent text-accent-contrast'
              : 'text-muted hover:bg-surface-hover hover:text-text'
          }`}
        >
          <span aria-hidden>{option.icon}</span>
          <span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Applies the stored theme before first paint so a dark-mode user never sees a
 * white flash. Injected as an inline script in the document head.
 */
export function ThemeScript() {
  const script = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
