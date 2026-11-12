import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'auto';

const KEY = 'moviq-theme';
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage blocked: follow the system.
  }
  return 'auto';
}

let current: ThemeChoice = readChoice();

/** `auto` leaves the attribute off, so the stylesheet follows `prefers-color-scheme`. */
function apply(choice: ThemeChoice): void {
  if (choice === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
}

export function setTheme(choice: ThemeChoice): void {
  current = choice;
  apply(choice);
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Private mode: the choice still applies to this visit.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}

/** Applies the saved choice before the first render. */
export function applyInitialTheme(): void {
  apply(current);
}
