import type { CityLayerId } from '@moviq/contracts';

import { iconPath } from '../../../../shared/ui/Icon';

/** Strokes of the city layers drawn in the same family as the shared icons (24 px, 1.75). */
const OWN = {
  document: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  camera: 'M4 8h3l2-2h6l2 2h3v11H4zM12 10a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  plug: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5',
  heart:
    'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10zM8.5 12h2l1-2l1.5 4l1-2h1.5',
  stairs: 'M4 19h4v-4h4v-4h4V7h4',
  restroom: 'M12 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4M9.5 21v-5H8l1.5-6h5l1.5 6h-1.5v5',
  meter: 'M8 3h8v9a4 4 0 0 1-8 0zM12 16v5M10 7h4',
  sign: 'M7 3h10v12H7zM12 15v6M10 7h4M10 11h4',
  wave: 'M3 10c2-2 4-2 6 0s4 2 6 0s4-2 6 0M3 16c2-2 4-2 6 0s4 2 6 0s4-2 6 0',
  anchor: 'M12 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4M12 8v13M5 13a7 7 0 0 0 14 0M9 11h6',
  road: 'M8 3l-3 18M16 3l3 18M12 5v2M12 11v2M12 17v2',
  cloud: 'M7 18h10a4 4 0 0 0 0-8a5 5 0 0 0-9.6-1.5A3.5 3.5 0 0 0 7 18z',
  radar: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 12l5.5-5.5',
} as const;

const PATHS: Record<CityLayerId | 'radar', string> = {
  'transit-alerts': iconPath('subway'),
  incidents: iconPath('alert'),
  closures: iconPath('cross'),
  construction: iconPath('wrench'),
  'street-permits': OWN.document,
  'permitted-events': iconPath('flag'),
  cameras: OWN.camera,
  chargers: OWN.plug,
  defibrillators: OWN.heart,
  restrooms: OWN.restroom,
  landmarks: iconPath('pin'),
  'subway-entrances': OWN.stairs,
  'parking-meters': OWN.meter,
  'parking-signs': OWN.sign,
  'vessel-calls': iconPath('ferry'),
  'harbor-conditions': OWN.wave,
  'coast-guard': OWN.anchor,
  'road-conditions': OWN.road,
  'weather-alerts': OWN.cloud,
  radar: OWN.radar,
};

/** The mark of a city layer in the panel, monochrome and in the colour of the text. */
export function LayerIcon({ layer }: { layer: CityLayerId | 'radar' }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[layer]} />
    </svg>
  );
}
