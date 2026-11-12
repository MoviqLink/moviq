import { useRef, useState, type PointerEvent, type ReactNode } from 'react';

import { useTripT } from '../texts';

/** How far a drag must go before it counts as a drag and not a tap. */
const DRAG_PX = 8;

/**
 * The trip panel on a phone: a bottom sheet that leaves the map visible. Dragging its handle
 * moves it between half and nearly full height; a tap or the keyboard toggles it.
 */
export function Sheet({ children }: { children: ReactNode }) {
  const t = useTripT().sheet;
  const [expanded, setExpanded] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<number | null>(null);
  const dragged = useRef(false);

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    start.current = event.clientY;
    dragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (start.current !== null) setDrag(event.clientY - start.current);
  };
  const up = () => {
    if (drag !== null && Math.abs(drag) > DRAG_PX) {
      dragged.current = true;
      setExpanded(drag < 0);
    }
    start.current = null;
    setDrag(null);
  };
  // A drag ends with a click too; only a real tap (or Enter and Space) toggles.
  const tap = () => {
    if (dragged.current) dragged.current = false;
    else setExpanded((open) => !open);
  };

  const height = expanded ? 88 : 46;
  const style =
    drag === null ? undefined : { height: `calc(${String(height)}svh - ${String(drag)}px)` };
  return (
    <aside
      className={`sheet${expanded ? ' expanded' : ''}${drag === null ? '' : ' dragging'}`}
      style={style}
    >
      <button
        type="button"
        className="sheet-handle"
        aria-expanded={expanded}
        aria-label={expanded ? t.collapse : t.expand}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={tap}
      >
        <i aria-hidden="true" />
      </button>
      <div className="sheet-body">{children}</div>
    </aside>
  );
}
