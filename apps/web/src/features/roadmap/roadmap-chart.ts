import { StringHelper, type DomConfig, type Model } from '@bryntum/core-community';
import type { GanttColumnConfig, TaskModel } from '@bryntum/gantt-community';
import type { BryntumGanttProps } from '@bryntum/gantt-react-community';

import { localeOf, type Lang } from '../../shared/i18n/lang';

import { NEW_YORK, nyWallClock } from './ny-time';
import { ROADMAP_TEXT, type RoadmapLeg } from './roadmap-text';

const MINUTE = 60_000;

/** The columns beside the chart, and the ones left at a phone's width. */
const COLUMN_WIDTH = { leg: 124, line: 60, route: 248, minutes: 64 } as const;
export const NARROW_FRAME = 640;

/** A minute tick never gets narrower than this: below it, the chart scrolls sideways. */
const MIN_TICK = 34;
const MAX_TICK = 120;

/** A leg as a row and a bar, with what its cells and tooltip say already written. */
interface RoadmapTask {
  readonly id: string;
  readonly name: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly manuallyScheduled: true;
  readonly cls: string;
  readonly mode: RoadmapLeg['mode'];
  readonly line: string;
  readonly route: string;
  readonly minutes: string;
  readonly times: string;
}

interface RoadmapDependency {
  readonly id: string;
  readonly fromTask: string;
  readonly toTask: string;
}

export interface RoadmapData {
  readonly tasks: RoadmapTask[];
  readonly dependencies: RoadmapDependency[];
  readonly startDate: Date;
  readonly endDate: Date;
  /** Minutes between two ticks of the axis. */
  readonly step: number;
}

const minutesOf = (leg: RoadmapLeg): number =>
  Math.max(0, Math.round((leg.end.getTime() - leg.start.getTime()) / MINUTE));

/** The axis step that keeps a trip readable: finer for a short trip, coarser for a long one. */
function stepFor(totalMinutes: number): number {
  if (totalMinutes <= 45) return 5;
  if (totalMinutes <= 120) return 10;
  return 15;
}

function floorTo(date: Date, step: number): Date {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  copy.setMinutes(copy.getMinutes() - (copy.getMinutes() % step));
  return copy;
}

/** The legs as the rows and arrows of the chart, on New York's clock. */
export function toRoadmapData(legs: readonly RoadmapLeg[], lang: Lang): RoadmapData {
  const text = ROADMAP_TEXT[lang];
  const clock = new Intl.DateTimeFormat(localeOf(lang), {
    timeZone: NEW_YORK,
    hour: 'numeric',
    minute: '2-digit',
  });
  const tasks = legs.map((leg) => ({
    id: leg.id,
    name: leg.name,
    startDate: nyWallClock(leg.start),
    endDate: nyWallClock(leg.end),
    manuallyScheduled: true as const,
    cls: `mq-roadmap-${leg.mode}`,
    mode: leg.mode,
    line: leg.line ?? '',
    route: `${leg.from} → ${leg.to}`,
    minutes: text.minutesTaken(minutesOf(leg)),
    times: `${clock.formatRange(leg.start, leg.end)} · ${text.timeZone}`,
  }));
  const dependencies = legs.slice(1).map((leg, index) => {
    const before = legs[index]?.id ?? leg.id;
    return { id: `${before}>${leg.id}`, fromTask: before, toTask: leg.id };
  });
  const first = tasks.at(0)?.startDate ?? nyWallClock(new Date());
  const last = tasks.at(-1)?.endDate ?? first;
  const step = stepFor((last.getTime() - first.getTime()) / MINUTE);
  const startDate = floorTo(first, step);
  // At least one step after the arrival, so the last bar never touches the edge.
  const endDate = new Date(floorTo(last, step).getTime() + 2 * step * MINUTE);
  return { tasks, dependencies, startDate, endDate, step };
}

/** The width of the table beside the chart at the frame's width. */
export const tableWidth = (narrow: boolean): number =>
  COLUMN_WIDTH.leg + COLUMN_WIDTH.minutes + (narrow ? 0 : COLUMN_WIDTH.line + COLUMN_WIDTH.route);

/** The width of a tick: the whole trip fills the room beside the table, within limits. */
export function tickWidth(data: RoadmapData, room: number): number {
  const ticks = (data.endDate.getTime() - data.startDate.getTime()) / (data.step * MINUTE);
  return Math.min(MAX_TICK, Math.max(MIN_TICK, Math.floor(room / Math.max(1, ticks))));
}

const span = (className: string, text: string): DomConfig => ({ tag: 'span', className, text });
const read = (record: Model, field: string): string => String(record.getData(field) ?? '');

/** The columns of the table; on a narrow screen the line and route stay in the bar and tooltip. */
export function roadmapColumns(lang: Lang, narrow: boolean): GanttColumnConfig[] {
  const text = ROADMAP_TEXT[lang];
  const fixed = { editor: false, sortable: false, draggable: false, groupable: false } as const;
  return [
    {
      ...fixed,
      // Gantt keeps one tree column; the trip has no branches, so it holds the kind of leg.
      type: 'name',
      field: 'name',
      text: text.leg,
      width: COLUMN_WIDTH.leg,
      minWidth: COLUMN_WIDTH.leg,
      renderer: ({ record }: { record: Model }) => ({
        tag: 'span',
        className: 'mq-roadmap-leg',
        children: [
          { tag: 'span', className: `mq-roadmap-swatch mq-roadmap-${read(record, 'mode')}` },
          span('', read(record, 'name')),
        ],
      }),
    },
    {
      ...fixed,
      field: 'line',
      text: text.line,
      width: COLUMN_WIDTH.line,
      hidden: narrow,
      renderer: ({ record }: { record: Model }) => {
        const line = read(record, 'line');
        return line === '' ? span('mq-roadmap-none', '—') : span('mq-roadmap-line', line);
      },
    },
    {
      ...fixed,
      field: 'route',
      text: text.route,
      width: COLUMN_WIDTH.route,
      hidden: narrow,
      renderer: ({ record }: { record: Model }) => {
        const route = read(record, 'route');
        return { tag: 'span', className: 'mq-roadmap-route', title: route, text: route };
      },
    },
    {
      ...fixed,
      field: 'minutes',
      text: text.minutes,
      width: COLUMN_WIDTH.minutes,
      align: 'end',
      renderer: ({ record }: { record: Model }) =>
        span('mq-roadmap-minutes', read(record, 'minutes')),
    },
  ];
}

/** The line or the kind of a leg, inside its bar. */
function barContent({ taskRecord }: { taskRecord: TaskModel }): DomConfig[] {
  const line = read(taskRecord, 'line');
  return [span('mq-roadmap-bar', line === '' ? read(taskRecord, 'name') : line)];
}

/** A leg's tooltip as escaped HTML: Bryntum's task tooltip takes a string. */
function tooltip({ taskRecord }: { taskRecord: TaskModel }): string {
  const line = read(taskRecord, 'line');
  const title = line === '' ? read(taskRecord, 'name') : `${read(taskRecord, 'name')} · ${line}`;
  return [
    StringHelper.xss`<p class="mq-roadmap-tip-title">${title}</p>`,
    StringHelper.xss`<p class="mq-roadmap-tip-line">${read(taskRecord, 'route')}</p>`,
    StringHelper.xss`<p class="mq-roadmap-tip-line">${read(taskRecord, 'times')}</p>`,
    StringHelper.xss`<p class="mq-roadmap-tip-line">${read(taskRecord, 'minutes')}</p>`,
  ].join('');
}

/** Hours above, minutes below, on New York's clock in the reader's own style. */
export function roadmapPreset(lang: Lang, step: number) {
  return {
    base: 'minuteAndHour',
    timeResolution: { unit: 'minute' as const, increment: 1 },
    headers: [
      { unit: 'hour' as const, dateFormat: lang === 'es' ? 'H:00' : 'h A' },
      { unit: 'minute' as const, increment: step, dateFormat: 'mm' },
    ],
  };
}

/** A chart to read, not to edit: every gesture that would change the trip is off. */
export const ROADMAP_CONFIG = {
  readOnly: true,
  autoHeight: true,
  rowHeight: 46,
  barMargin: 11,
  taskStore: {
    fields: ['mode', 'line', 'route', 'minutes', 'times'].map((name) => ({ name, type: 'string' })),
  },
  taskRenderer: barContent,
  taskTooltipFeature: { template: tooltip },
  dependenciesFeature: { allowCreate: false, showTooltip: false, enableDelete: false },
  cellEditFeature: false,
  taskDragFeature: false,
  taskResizeFeature: false,
  taskDragCreateFeature: false,
  basicTaskEditFeature: false,
  taskMenuFeature: false,
  scheduleMenuFeature: false,
  cellMenuFeature: false,
  headerMenuFeature: false,
  timeAxisHeaderMenuFeature: false,
  columnReorderFeature: false,
  sortFeature: false,
  columnLinesFeature: true,
  zoomOnMouseWheel: false,
  zoomOnTimeAxisDoubleClick: false,
  subGridConfigs: { locked: { width: tableWidth(false) } },
} satisfies BryntumGanttProps;
