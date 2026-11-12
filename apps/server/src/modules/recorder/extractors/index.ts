import type { Extractor } from '../extractor.js';
import { busExtractors } from './bus.js';
import { countExtractors } from './counts.js';
import { incidentExtractors } from './incidents.js';
import { positionExtractors } from './positions.js';
import { sampleExtractors } from './samples.js';
import { subwayExtractors } from './subway.js';

/**
 * Every source the recorder knows how to read, one entry per source. A new source joins with
 * one file in this folder and one line here; until then it shows as "no extractor".
 */
export const recorderExtractors: readonly Extractor[] = [
  ...subwayExtractors,
  ...busExtractors,
  ...incidentExtractors,
  ...sampleExtractors,
  ...positionExtractors,
  ...countExtractors,
];
