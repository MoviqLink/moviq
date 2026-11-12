import type { LiveSource } from '@moviq/contracts';

import type { SourceDefinition } from '../data-platform/definition.js';
import type { SourceReading } from '../data-platform/reader.js';

/** When the provider published a static file it dates; a live source or an undated file has none. */
function publishedAt(definition: SourceDefinition, reading: SourceReading<unknown>): string | null {
  const dated = definition.kind === 'static' && definition.dataTimeSource !== 'receipt';
  return dated ? reading.provenance.dataTime : null;
}

/** A source as Explore cites it: its title, its attribution, its kind and how fresh it is now. */
export function liveSource(
  definition: SourceDefinition,
  reading: SourceReading<unknown>,
): LiveSource {
  return {
    title: definition.title,
    attribution: definition.licence.attribution,
    kind: definition.kind,
    publishedAt: publishedAt(definition, reading),
    provenance: reading.provenance,
  };
}
