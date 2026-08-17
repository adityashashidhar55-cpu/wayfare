import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'wayfare-theme';
const listeners = new Set<() => void>();

function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  listeners.forEach((l) => l());
}

/** Set and persist the theme. Also syncs every useTheme() consumer. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable */
  }
  applyTheme(theme);
}

export function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemChange = () => {
    // Follow the system only while the user has no explicit preference.
    if (!getStoredTheme()) applyTheme(systemTheme());
  };
  mq.addEventListener('change', onSystemChange);
  return () => {
    listeners.delete(callback);
    mq.removeEventListener('change', onSystemChange);
  };
}

/**
 * Theme state (`.dark` class on <html>) backed by localStorage with a
 * system-preference default. Synced across every component instance.
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light' as Theme);

  // Ensure the class is applied on first client render (inline script in
  // index.html normally does this pre-paint).
  useEffect(() => {
    applyTheme(getStoredTheme() ?? (document.documentElement.classList.contains('dark') ? 'dark' : systemTheme()));
  }, []);

  const toggle = useCallback(() => toggleTheme(), []);
  const set = useCallback((t: Theme) => setTheme(t), []);

  return { theme, isDark: theme === 'dark', toggleTheme: toggle, setTheme: set };
}
