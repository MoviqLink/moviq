import { Marker, type Map as MapLibre } from 'maplibre-gl';

import { iconPath, type IconName } from '../../../shared/ui/Icon';
import type { Stop } from './geometry';

const SVG = 'http://www.w3.org/2000/svg';

function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', iconPath(name));
  svg.append(path);
  return svg;
}

const iconFor = (stop: Stop): IconName =>
  stop.kind === 'start' ? 'pin' : stop.kind === 'end' ? 'flag' : stop.mode;

function element(stop: Stop, time: string): HTMLElement {
  const root = document.createElement('div');
  root.className = `pin ${stop.kind}${stop.mode === 'taxi' ? ' taxi' : ''}`;
  const dot = document.createElement('span');
  dot.className = 'pin-dot';
  dot.append(icon(iconFor(stop)));
  const label = document.createElement('span');
  label.className = 'pin-label';
  const name = document.createElement('b');
  name.textContent = stop.label;
  const when = document.createElement('span');
  when.textContent = time;
  label.append(name, when);
  // The start sits next to the first boarding; its name is in the panel, so only its dot is drawn.
  if (stop.kind === 'start') root.append(dot);
  else root.append(label, dot);
  return root;
}

/** Puts the stops on the map as quiet labelled pins; returns what takes them off again. */
export function placeStops(
  map: MapLibre,
  stops: readonly Stop[],
  timeOf: (instant: string) => string,
): () => void {
  const markers = stops.map((stop) =>
    new Marker({ element: element(stop, timeOf(stop.time)), anchor: 'bottom', offset: [0, 15] })
      .setLngLat(stop.at)
      .addTo(map),
  );
  return () => {
    for (const marker of markers) marker.remove();
  };
}
