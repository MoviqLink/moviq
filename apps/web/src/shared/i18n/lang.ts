import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'es';

const KEY = 'moviq-lang';
const listeners = new Set<() => void>();

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    // Storage blocked: the browser language decides.
  }
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

let current: Lang = initial();

/** The BCP 47 locale for dates and numbers in the language in use. */
export const localeOf = (lang: Lang): string => (lang === 'es' ? 'es-ES' : 'en-US');

export function setLang(lang: Lang): void {
  current = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Private mode: the choice still applies to this visit.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The language in use; the component re-renders when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}

/** Puts the saved or browser language on the document before the first render. */
export function applyInitialLang(): void {
  document.documentElement.lang = current;
}
