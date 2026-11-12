import { useSyncExternalStore } from 'react';

// A navigation preference for this browser tab, never an authorization check.
const KEY = 'moviq-traveller-entry';
let fallback = false;
const listeners = new Set<() => void>();

export function travellerEntered(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return fallback;
  }
}

export function setTravellerEntered(value: boolean): void {
  fallback = value;
  try {
    if (value) sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch {
    // The in-memory preference still works until this page is reloaded.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The view follows completed entry even when the current URL is already home. */
export function useTravellerEntered(): boolean {
  return useSyncExternalStore(subscribe, travellerEntered, travellerEntered);
}
