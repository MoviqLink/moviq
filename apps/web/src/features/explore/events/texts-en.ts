import type { EventCategory, EventStatus } from '@moviq/contracts';

import type { EventRange } from './model/range';

const s = String;

// The events layer's words. Spanish has exactly the same keys: TypeScript and the tests check it.
export const eventsEn = {
  layer: 'Events',
  tourist: 'Tourist mode',
  touristScope:
    'Explore published events and designated landmarks. Tourist experiences are not available here yet.',
  show: 'Show events on the map',
  ranges: {
    label: 'When',
    today: 'Today',
    tonight: 'Tonight',
    weekend: 'This weekend',
  } satisfies Record<EventRange | 'label', string>,
  all: 'All',
  categoriesLabel: 'Kind of event',
  categories: {
    music: 'Music',
    sports: 'Sports',
    arts: 'Arts and theatre',
    family: 'Family',
    fitness: 'Fitness',
    outdoors: 'Outdoors',
    community: 'Community',
    food: 'Food',
    festival: 'Festivals',
    other: 'Other',
  } satisfies Record<EventCategory, string>,
  status: {
    scheduled: 'As planned',
    rescheduled: 'New date',
    postponed: 'Postponed',
    cancelled: 'Cancelled',
  } satisfies Record<EventStatus, string>,
  loading: 'Reading the events of the city…',
  failed: 'The events did not load. We try again on our own.',
  none: 'No event listed for this time.',
  count: (n: number) => (n === 1 ? '1 event' : `${s(n)} events`),
  more: (n: number) => `and ${s(n)} more on the map`,
  missing: (names: string) => `Missing or incomplete now: ${names}.`,
  open: (name: string) => `Open ${name}`,
  card: {
    kind: 'Event',
    close: 'Close',
    when: 'When',
    starts: 'Starts',
    ends: 'Ends',
    noEnd: 'End not published',
    venue: 'Venue',
    source: 'Source',
    sources: 'Sources',
    listedAt: (age: string) => `listing ${age} old`,
    official: 'Official page',
    officialNote: 'Opens in a new tab. Tickets, if any, are sold only there: MovIQ sells none.',
    onTime: 'How to get there on time',
    onTimeNote: (time: string) => `Plan with Sara to arrive by ${time}.`,
    callOff: 'As its source lists it: check the official page.',
  },
};

export type EventsDict = typeof eventsEn;
