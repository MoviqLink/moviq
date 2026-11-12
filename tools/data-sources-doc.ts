import type { SourceDefinition } from '../apps/server/src/modules/data-platform/definition.js';
import { formatDuration } from '../apps/server/src/modules/data-platform/health.js';

/** `docs/data-sources.md`, written from the catalogue so credits never drift from the code. */
export function renderDataSources(definitions: readonly SourceDefinition[]): string {
  const sorted = [...definitions].sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id),
  );
  const rows = sorted.map((definition) => {
    const { rhythm, freshness } = definition;
    const interval = formatDuration(rhythm.baseIntervalMs);
    const fast =
      rhythm.interestIntervalMs === undefined
        ? ''
        : `, ${formatDuration(rhythm.interestIntervalMs)} with interest`;
    const limits = [freshness.degradedAfterMs, freshness.staleAfterMs, freshness.unavailableAfterMs]
      .map(formatDuration)
      .join(' / ');
    const licence = `[${definition.licence.name}](${definition.licence.url})`;
    const cells = [
      `\`${definition.id}\``,
      definition.title,
      definition.provider,
      licence,
      `${rhythm.class}: ${interval}${fast}`,
      limits,
      definition.integration ?? 'none',
    ];
    return `| ${cells.join(' | ')} |`;
  });
  const credits = [...new Set(sorted.map((definition) => definition.licence.attribution))].map(
    (credit) => `- ${credit}`,
  );
  return [
    '# Data sources',
    '',
    'Every source MovIQ collects, generated from the catalogue by `npm run docs:sources`;',
    '`npm run verify` fails if this file is out of date. Freshness is measured on the time of the',
    'data itself; the three limits are when a source becomes degraded, stale and unavailable.',
    '',
    '| Source | What | Provider | Licence | Rhythm | Freshness limits | Credential |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Credits',
    '',
    ...credits,
    '',
  ].join('\n');
}
