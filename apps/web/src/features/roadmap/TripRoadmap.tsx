import '@bryntum/gantt-community/gantt.css';
import '@bryntum/gantt-community/svalbard.css';
import './roadmap.css';

import { BryntumGantt } from '@bryntum/gantt-react-community';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { useLang } from '../../shared/i18n/lang';

import { nyWallClock } from './ny-time';
import {
  NARROW_FRAME,
  ROADMAP_CONFIG,
  roadmapColumns,
  roadmapPreset,
  tableWidth,
  tickWidth,
  toRoadmapData,
} from './roadmap-chart';
import { ROADMAP_TEXT, type RoadmapLeg } from './roadmap-text';

interface TripRoadmapProps {
  readonly legs: readonly RoadmapLeg[];
  readonly title?: string;
}

/** How often the "now" mark is placed again: it steps along the trip, never glides. */
const NOW_EVERY_MS = 30_000;

/** The width of the frame, measured before it is painted and followed as it changes. */
function useFrameWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { ref, width };
}

/**
 * Where New York's "now" falls across the body of the chart, in pixels from the frame's left
 * edge, or null when it is outside the trip. Bryntum Community has no time ranges, so the mark is
 * a layer of its own, placed with the chart's own coordinate of the moment.
 */
function useNowLine(
  gantt: RefObject<BryntumGantt | null>,
  frame: RefObject<HTMLDivElement | null>,
  span: { readonly start: Date; readonly end: Date; readonly table: number; readonly tick: number },
): number | null {
  const [left, setLeft] = useState<number | null>(null);
  const { start, end, table, tick } = span;
  useEffect(() => {
    const chart = gantt.current?.instance;
    const box = frame.current;
    if (chart === undefined || box === null) return undefined;
    const place = () => {
      const now = nyWallClock(new Date());
      if (now < start || now > end) {
        setLeft(null);
        return;
      }
      const page = chart.getCoordinateFromDate(now, false);
      const x = page - box.getBoundingClientRect().left - window.scrollX;
      setLeft(Number.isFinite(x) && x > table ? x : null);
    };
    place();
    const timer = window.setInterval(place, NOW_EVERY_MS);
    // Bryntum answers `on` with the function that removes the listeners again.
    const detach = chart.on({ horizontalScroll: place, resize: place }) as () => void;
    return () => {
      window.clearInterval(timer);
      detach();
    };
  }, [gantt, frame, start, end, table, tick]);
  return left;
}

/**
 * The trip as a roadmap on Bryntum Gantt: each leg a bar on New York's clock, chained to the
 * next, with what it is, its line, where it goes and how long it takes beside it. Read only.
 */
export function TripRoadmap({ legs, title }: TripRoadmapProps) {
  const lang = useLang();
  const text = ROADMAP_TEXT[lang];
  const data = useMemo(() => toRoadmapData(legs, lang), [legs, lang]);
  const { ref, width } = useFrameWidth();
  const narrow = width > 0 && width < NARROW_FRAME;
  const table = tableWidth(narrow);
  const tick = tickWidth(data, width - table - 2);
  const columns = useMemo(() => roadmapColumns(lang, narrow), [lang, narrow]);
  const preset = useMemo(() => roadmapPreset(lang, data.step), [lang, data.step]);
  const gantt = useRef<BryntumGantt>(null);
  // Rows and arrows load together: loading the rows alone drops the arrows of the rows replaced.
  useEffect(() => {
    const project = gantt.current?.instance.project;
    if (project !== undefined) {
      project.inlineData = { tasks: data.tasks, dependencies: data.dependencies };
    }
  }, [data]);
  // The table narrows on a phone; set on the widget, as a new config would build a second table.
  useEffect(() => {
    const locked = gantt.current?.instance.subGrids['locked'];
    if (locked !== undefined) {
      locked.setConfig({ width: table });
    }
  }, [table]);
  const first = data.tasks.at(0)?.startDate ?? data.startDate;
  const last = data.tasks.at(-1)?.endDate ?? data.endDate;
  const nowAt = useNowLine(gantt, ref, { start: first, end: last, table, tick });
  const heading = title ?? text.title;
  return (
    <section className="mq-roadmap" aria-label={heading}>
      <header className="mq-roadmap-head">
        <h3 className="mq-roadmap-title">{heading}</h3>
        <span className="mq-roadmap-zone">{text.timeZone}</span>
      </header>
      <div ref={ref} className="mq-roadmap-frame">
        {nowAt !== null && (
          <span className="mq-roadmap-now" style={{ left: nowAt }} aria-hidden="true">
            <span className="mq-roadmap-now-label">{text.now}</span>
          </span>
        )}
        <BryntumGantt
          ref={gantt}
          {...ROADMAP_CONFIG}
          columns={columns}
          viewPreset={preset}
          tickSize={tick}
          startDate={data.startDate}
          endDate={data.endDate}
          ariaLabel={text.chart}
        />
      </div>
    </section>
  );
}
