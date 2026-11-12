import type { SourceDefinition } from './definition.js';
import { accessibilitySources } from './sources/accessibility/index.js';
import { airSources } from './sources/air/index.js';
import { amtrakSources } from './sources/amtrak/index.js';
import { bikeSources } from './sources/bikes/index.js';
import { citySources } from './sources/city/index.js';
import { cityOpsSources } from './sources/city-ops/index.js';
import { eventSources } from './sources/events/index.js';
import { ferrySources } from './sources/ferries/index.js';
import { harborSources } from './sources/harbor/index.js';
import { micromobilitySources } from './sources/micromobility/index.js';
import { mtaSources } from './sources/mta/index.js';
import { ny511Sources } from './sources/ny511/index.js';
import { recorderSources } from './sources/recorder/index.js';
import { regionalSources } from './sources/regional/index.js';
import { seaSources } from './sources/sea/index.js';
import { shuttleSources } from './sources/shuttles/index.js';
import { streetSources } from './sources/street/index.js';
import { westchesterSources } from './sources/westchester/index.js';

/** Every source the platform collects. Product modules read them only through the platform. */
export const sourceCatalog: readonly SourceDefinition[] = [
  ...mtaSources,
  ...accessibilitySources,
  ...regionalSources,
  ...amtrakSources,
  ...westchesterSources,
  ...shuttleSources,
  ...ferrySources,
  ...harborSources,
  ...bikeSources,
  ...micromobilitySources,
  ...airSources,
  ...seaSources,
  ...citySources,
  ...ny511Sources,
  ...streetSources,
  ...eventSources,
  ...recorderSources,
  ...cityOpsSources,
];
