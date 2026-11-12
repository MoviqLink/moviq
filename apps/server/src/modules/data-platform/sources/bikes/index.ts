import type { SourceDefinition } from '../../definition.js';
import { citiBikeStationsSource, citiBikeStatusSource } from './citi-bike.js';

/** Citi Bike stations and their live status, from Lyft's GBFS feed. */
export const bikeSources: readonly SourceDefinition[] = [
  citiBikeStationsSource,
  citiBikeStatusSource,
];
