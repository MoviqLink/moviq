import type { Place } from '@moviq/contracts';

// Places and paths of the scene the fixtures share: from East Harlem to LaGuardia Terminal B.

export type Lang = 'en' | 'es';
export type Position = [number, number];

const place = (
  label: string,
  lat: number,
  lon: number,
  kind: Place['kind'],
  stopId: string | null = null,
): Place => ({
  label,
  lat,
  lon,
  kind,
  stopId,
});

export const HOME = place('E 125 St & Lexington Av', 40.8007, -73.9395, 'address');
export const BOARD = place('Lexington Av / E 125 St', 40.8044, -73.9373, 'stop', 'MTA_401736');
export const ASTORIA = place('Astoria Blvd / 31 St', 40.7705, -73.918, 'stop', 'MTA_550110');
export const ALIGHT = place('LaGuardia Terminal B', 40.7741, -73.8722, 'stop', 'MTA_551231');
export const TERMINAL = place('LaGuardia Airport, Terminal B', 40.7738, -73.8712, 'airport');
export const SUBWAY = place('125 St station', 40.8045, -73.9377, 'station', 'MTA_621');
export const ASTORIA_DITMARS = place(
  'Astoria Blvd station',
  40.7701,
  -73.9179,
  'station',
  'MTA_R04',
);

export const WALK_IN: Position[] = [
  [-73.9395, 40.8007],
  [-73.9389, 40.8016],
  [-73.9383, 40.8025],
  [-73.9378, 40.8035],
  [-73.9373, 40.8044],
];
export const BUS: Position[] = [
  [-73.9373, 40.8044],
  [-73.934, 40.8031],
  [-73.93, 40.8016],
  [-73.9252, 40.8001],
  [-73.9216, 40.7977],
  [-73.9224, 40.7902],
  [-73.9229, 40.7822],
  [-73.9214, 40.7761],
  [-73.918, 40.7705],
  [-73.908, 40.769],
  [-73.8962, 40.7681],
  [-73.885, 40.7696],
  [-73.8781, 40.772],
  [-73.8722, 40.7741],
];
export const TAXI: Position[] = [
  [-73.918, 40.7705],
  [-73.9138, 40.7741],
  [-73.9002, 40.7738],
  [-73.8879, 40.7762],
  [-73.879, 40.7766],
  [-73.8722, 40.7741],
];
export const WALK_OUT: Position[] = [
  [-73.8722, 40.7741],
  [-73.8716, 40.774],
  [-73.8712, 40.7738],
];
