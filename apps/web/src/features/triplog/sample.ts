/**
 * A sample travel history for the demonstration account: trips written by hand to show what the
 * dashboard looks like once MovIQ has followed someone for a month. They were not travelled and
 * every screen that shows them says so. Lines, places and the $3.00 fare are New York's own.
 */

type SampleMode = 'subway' | 'bus' | 'rail' | 'ferry';

export interface SampleLeg {
  readonly line: string;
  readonly mode: SampleMode;
}

export interface SampleTrip {
  readonly id: string;
  /** Days from today: negative for a trip in the history, positive for a scheduled one. */
  readonly dayOffset: number;
  /** New York wall clock time of departure, HH:mm. */
  readonly departs: string;
  readonly from: string;
  readonly to: string;
  readonly legs: readonly SampleLeg[];
  readonly plannedMinutes: number;
  /** Minutes the trip took; equal to `plannedMinutes` for a scheduled trip. */
  readonly actualMinutes: number;
  /** What Sara did on the way, when something changed; null on an uneventful trip. */
  readonly rerouted: { readonly en: string; readonly es: string } | null;
  readonly tickets: number;
  readonly fareMinor: number;
}

export const SAMPLE_NOTICE = {
  en: 'Sample history for this demonstration: these trips were not travelled.',
  es: 'Historial de muestra para esta demostración: estos viajes no se han hecho.',
} as const;

const trip = (
  id: string,
  dayOffset: number,
  departs: string,
  from: string,
  to: string,
  legs: readonly SampleLeg[],
  plannedMinutes: number,
  actualMinutes: number,
  tickets: number,
  rerouted: SampleTrip['rerouted'] = null,
): SampleTrip => ({
  id,
  dayOffset,
  departs,
  from,
  to,
  legs,
  plannedMinutes,
  actualMinutes,
  rerouted,
  tickets,
  fareMinor: tickets * 300,
});

const subway = (line: string): SampleLeg => ({ line, mode: 'subway' });
const bus = (line: string): SampleLeg => ({ line, mode: 'bus' });

export const SAMPLE_TRIPS: readonly SampleTrip[] = [
  trip(
    's-01',
    -1,
    '08:12',
    'Times Sq-42 St',
    'Brooklyn Museum',
    [subway('Q'), subway('3')],
    35,
    36,
    1,
  ),
  trip(
    's-02',
    -2,
    '18:40',
    'Grand Central-42 St',
    'Astoria-Ditmars Blvd',
    [subway('7'), subway('N')],
    31,
    31,
    1,
  ),
  trip('s-03', -3, '07:55', '125 St', 'LaGuardia Terminal B', [bus('M60-SBS')], 38, 47, 1, {
    en: 'Traffic on the RFK Bridge: Sara warned 12 minutes ahead.',
    es: 'Tráfico en el puente RFK: Sara avisó con 12 minutos de margen.',
  }),
  trip('s-04', -5, '09:05', 'Union Sq-14 St', 'Yankee Stadium', [subway('4')], 27, 27, 1),
  trip('s-05', -6, '17:30', 'Bryant Park', 'Coney Island-Stillwell Av', [subway('D')], 52, 58, 1, {
    en: 'D held at DeKalb Av: Sara moved you to the N across the platform.',
    es: 'El D se detuvo en DeKalb Av: Sara te pasó al N en el mismo andén.',
  }),
  trip('s-06', -8, '08:20', 'Jackson Hts-Roosevelt Av', 'Hudson Yards', [subway('7')], 29, 28, 1),
  trip('s-07', -9, '13:10', 'Chambers St', 'Columbia University', [subway('1')], 33, 33, 1),
  trip(
    's-08',
    -12,
    '10:45',
    'Atlantic Av-Barclays Ctr',
    'The Met Museum',
    [subway('4'), bus('M86-SBS')],
    41,
    44,
    1,
  ),
  trip(
    's-09',
    -14,
    '19:15',
    'Lincoln Center',
    'Williamsburg Bridge Plaza',
    [subway('1'), subway('L'), bus('B62')],
    44,
    43,
    2,
  ),
  trip('s-10', -17, '08:02', 'Flushing-Main St', 'Wall St', [subway('7'), subway('5')], 48, 55, 1, {
    en: 'Signal problem on the 7: Sara left 9 minutes earlier to keep your arrival.',
    es: 'Avería de señales en la 7: Sara adelantó la salida 9 minutos para llegar a tiempo.',
  }),
  trip('s-11', -20, '16:25', 'Fulton St', 'Bronx Zoo', [subway('2')], 46, 46, 1),
  trip(
    's-12',
    -24,
    '11:30',
    'Prospect Park',
    'Roosevelt Island',
    [subway('Q'), subway('F')],
    37,
    38,
    1,
  ),
  trip(
    's-13',
    1,
    '08:10',
    'Times Sq-42 St',
    'Brooklyn Museum',
    [subway('Q'), subway('3')],
    35,
    35,
    1,
  ),
  trip('s-14', 3, '17:45', 'Grand Central-42 St', 'Barclays Center', [subway('4')], 24, 24, 1),
  trip('s-15', 6, '06:50', '125 St', 'LaGuardia Terminal B', [bus('M60-SBS')], 38, 38, 1),
];

/** A trip is on time when it took at most this many minutes more than planned. */
const ON_TIME_MARGIN_MINUTES = 5;

export interface SampleStats {
  readonly trips: number;
  readonly onTime: number;
  readonly onTimePercent: number;
  readonly rerouted: number;
  readonly tickets: number;
  readonly spentMinor: number;
  readonly minutesTravelled: number;
  readonly scheduled: number;
}

/** The figures of the sample history: everything counted from `SAMPLE_TRIPS`, nothing typed in. */
export function sampleStats(trips: readonly SampleTrip[] = SAMPLE_TRIPS): SampleStats {
  const past = trips.filter((item) => item.dayOffset < 0);
  const onTime = past.filter(
    (item) => item.actualMinutes - item.plannedMinutes <= ON_TIME_MARGIN_MINUTES,
  ).length;
  return {
    trips: past.length,
    onTime,
    onTimePercent: past.length === 0 ? 0 : Math.round((onTime / past.length) * 100),
    rerouted: past.filter((item) => item.rerouted !== null).length,
    tickets: past.reduce((sum, item) => sum + item.tickets, 0),
    spentMinor: past.reduce((sum, item) => sum + item.fareMinor, 0),
    minutesTravelled: past.reduce((sum, item) => sum + item.actualMinutes, 0),
    scheduled: trips.length - past.length,
  };
}

/** The calendar day of a sample trip, counted from `today` in the browser's own time zone. */
export function sampleDate(item: SampleTrip, today: Date = new Date()): Date {
  const [hour = 0, minute = 0] = item.departs.split(':').map(Number);
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute);
  date.setDate(date.getDate() + item.dayOffset);
  return date;
}
