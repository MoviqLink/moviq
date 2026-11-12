// One family of stroke icons, 1.75 px, drawn in the text colour.
const PATHS = {
  check: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8.2 12.2l2.6 2.6l5-5.2',
  degraded: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 3v18M12 7.5h5.5M12 12h7M12 16.5h5.5',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7.5V12l3 2',
  cross: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M9 9l6 6M15 9l-6 6',
  gauge: 'M4.5 17a8.5 8.5 0 1 1 15 0M12 13.5l3.5-4M3 17h3M18 17h3',
  wrench:
    'M14.7 6.3a4 4 0 0 0-5.4 5.1l-5 5a1.8 1.8 0 0 0 2.6 2.6l5-5a4 4 0 0 0 5.1-5.4l-2.3 2.3l-2.3-.6l-.6-2.3z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  question:
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7M12 17h.01',
  sun:
    'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2' +
    'M4.6 4.6l1.4 1.4M18 18l1.4 1.4M4.6 19.4L6 18M18 6l1.4-1.4',
  contrast: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 3v18a9 9 0 0 0 0-18z',
  back: 'M19 12H5M11 6l-6 6l6 6',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  signOut: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4l4 4M6 12h10',
  close: 'M6 6l12 12M18 6L6 18',
  menu: 'M4 7h16M4 12h16M4 17h16',
  offline:
    'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.2-2.4M12 20h.01M19 13a10 10 0 0 0-2.7-1.9',
  walk:
    'M13 3a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3M10.5 21l2.2-6.2l-2.7-2.6l1.2-4.7l3.3 3.1l3 .9' +
    'M12.7 14.8l2.3 2.7V21M10 12.2l-2.5 2.3',
  bus: 'M6 4h12a1 1 0 0 1 1 1v11H5V5a1 1 0 0 1 1-1zM5 11h14M8 19v-3M16 19v-3M8.5 13.5h.01M15.5 13.5h.01',
  subway:
    'M7 3h10a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM5 10h14M9 13.5h.01' +
    'M15 13.5h.01M8 21l1.5-4M16 21l-1.5-4',
  rail: 'M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM5 11h14M12 3v8M7 21l2-4M17 21l-2-4',
  ferry:
    'M4 17c1.5 1.3 3 1.3 4.5 0c1.5 1.3 3 1.3 4.5 0c1.5 1.3 3 1.3 4.5 0M5 14l1-5h12l1 5M9 9V6h6v3M12 3v3',
  taxi: 'M5 15l2-6h10l2 6v3H5zM10 9V7h4v2M8 15.5h.01M16 15.5h.01',
  plane: 'M4 13l16-6l-5 12l-3-5z',
  send: 'M5 12h13M13 6l6 6l-6 6',
  pin: 'M12 21s-6-5.6-6-10.5a6 6 0 1 1 12 0C18 15.4 12 21 12 21zM12 8.5a2 2 0 1 0 0 4a2 2 0 1 0 0-4',
  flag: 'M6 21V4M6 4h11l-2 4l2 4H6',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  chevron: 'M6 9l6 6l6-6',
  // Sara has no face: her mark is the ring of the logo, two arcs with their gaps.
  ring: 'M4.81 8.49A8 8 0 0 1 19.19 8.49M19.19 15.51A8 8 0 0 1 8.75 19.31',
  map: 'M9 4L3 6.5V20l6-2.5l6 2.5l6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20',
  route:
    'M6 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4M18 17a2 2 0 1 0 0 4a2 2 0 1 0 0-4M6 7v4a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3',
} as const;

export type IconName = keyof typeof PATHS;

/** The path of an icon, for elements drawn outside React such as map markers. */
export const iconPath = (name: IconName): string => PATHS[name];

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className === undefined ? 'icon' : `icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
