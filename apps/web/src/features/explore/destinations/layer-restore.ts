/** Layers to toggle to restore the person's choices after leaving a specialised view. */
export function layersToRestore<T>(current: ReadonlySet<T>, saved: ReadonlySet<T>): T[] {
  return [...new Set([...current, ...saved])].filter(
    (layer) => current.has(layer) !== saved.has(layer),
  );
}
