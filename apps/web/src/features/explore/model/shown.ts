import { liveModeSchema, type LiveMode } from '@moviq/contracts';

/**
 * Off when Explore opens: Citi Bike's stations and the scooters and bikes parked by Lime, Veo and
 * Bird, thousands of points that would cover the map. The traveller turns each on from its mode.
 */
export const FIRST_HIDDEN: ReadonlySet<LiveMode> = new Set(['bike-station', 'micromobility']);

/** The modes asked of the server: every mode but those the traveller has turned off. */
export const modesShown = (hidden: ReadonlySet<LiveMode>): LiveMode[] =>
  liveModeSchema.options.filter((mode) => !hidden.has(mode));
