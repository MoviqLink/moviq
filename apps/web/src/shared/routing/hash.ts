import { useSyncExternalStore } from 'react';

/** The path in the address after `#/`, split into segments: `#/ops/jobs` is `['ops', 'jobs']`. */
export function hashSegments(hash: string): string[] {
  return (
    hash
      .replace(/^#\/?/, '')
      .split('?')[0]
      ?.split('/')
      .filter((segment) => segment !== '') ?? []
  );
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => {
    window.removeEventListener('hashchange', listener);
  };
}

const snapshot = (): string => window.location.hash;

/** The current hash path segments; the component re-renders on navigation. */
export function useHashSegments(): string[] {
  return hashSegments(useSyncExternalStore(subscribe, snapshot, snapshot));
}
