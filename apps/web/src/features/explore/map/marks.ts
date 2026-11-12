import {
  liveModeSchema,
  type LiveMode,
  type LiveStation,
  type LiveVehicle,
} from '@moviq/contracts';
import type { Map as MapLibre } from 'maplibre-gl';

import type { LngLat } from './motion';

/** Each mode in the colours of MovIQ, never in an operator's: one accent and calm neutrals. */
export const modeColours = (dark: boolean): Record<LiveMode, string> =>
  dark
    ? {
        bus: '#3fc5b4',
        subway: '#e9edf0',
        rail: '#9d94ff',
        ferry: '#7fb4d6',
        shuttle: '#5fb3a6',
        aircraft: '#b8c2cc',
        ship: '#9fb6c8',
        'bike-station': '#5fd6c6',
        'rail-station': '#9d94ff',
        micromobility: '#8d99a3',
        airport: '#e9edf0',
      }
    : {
        bus: '#0e9f8a',
        subway: '#0e1318',
        rail: '#5b4ef0',
        ferry: '#2f6f96',
        shuttle: '#0b6e62',
        aircraft: '#56606b',
        ship: '#4f6f88',
        'bike-station': '#0a7a6a',
        'rail-station': '#5b4ef0',
        micromobility: '#7f8b95',
        airport: '#0e1318',
      };

const SIZE = 44;

/** The silhouette of a mark, pointing north: a vehicle on a line, an aircraft or a hull. */
type Shape = 'arrow' | 'plane' | 'hull' | 'disc' | 'subway' | 'rail';

const OUTLINES: Record<
  Exclude<Shape, 'disc' | 'subway' | 'rail'>,
  readonly (readonly [number, number])[]
> = {
  arrow: [
    [0, -17],
    [12, 13],
    [0, 7],
    [-12, 13],
  ],
  plane: [
    [0, -18],
    [3, -6],
    [15, 4],
    [3, 2],
    [5, 15],
    [0, 12],
    [-5, 15],
    [-3, 2],
    [-15, 4],
    [-3, -6],
  ],
  hull: [
    [0, -18],
    [7, -7],
    [7, 15],
    [-7, 15],
    [-7, -7],
  ],
};

const SHAPE_OF: Partial<Record<LiveMode, Shape>> = {
  bus: 'disc',
  shuttle: 'disc',
  subway: 'subway',
  rail: 'rail',
  ferry: 'hull',
  aircraft: 'plane',
  ship: 'hull',
};

function drawMark(colour: string, outline: string, shape: Shape): ImageData | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d');
  if (context === null) return undefined;
  context.translate(SIZE / 2, SIZE / 2);
  context.lineJoin = 'round';
  context.lineWidth = 3;
  context.strokeStyle = outline;
  context.fillStyle = colour;
  context.beginPath();
  if (shape === 'disc') {
    context.arc(0, 0, 10, 0, Math.PI * 2);
  } else if (shape === 'subway' || shape === 'rail') {
    context.roundRect(-12, -16, 24, 30, shape === 'subway' ? 6 : 3);
  } else {
    for (const [index, [x, y]] of OUTLINES[shape].entries()) {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
  }
  context.stroke();
  context.fill();
  if (shape === 'subway' || shape === 'rail') {
    context.fillStyle = outline;
    context.fillRect(-8, -11, 16, shape === 'subway' ? 8 : 6);
    if (shape === 'rail') context.fillRect(-8, -2, 16, 4);
    context.beginPath();
    context.arc(-7, 8, 2, 0, Math.PI * 2);
    context.arc(7, 8, 2, 0, Math.PI * 2);
    context.fill();
  }
  return context.getImageData(0, 0, SIZE, SIZE);
}

/** Registers the marks of every mode for this theme: its silhouette, and a disc without course. */
export function addMarkImages(map: MapLibre, dark: boolean): void {
  const outline = dark ? '#0c1014' : '#ffffff';
  const colours = modeColours(dark);
  for (const mode of liveModeSchema.options) {
    const shapes = [
      ['pointer', SHAPE_OF[mode] ?? 'arrow'],
      ['disc', SHAPE_OF[mode] === 'subway' || SHAPE_OF[mode] === 'rail' ? SHAPE_OF[mode] : 'disc'],
    ] as const;
    for (const [kind, shape] of shapes) {
      const image = drawMark(colours[mode], outline, shape);
      const id = `${mode}-${kind}`;
      if (image !== undefined && !map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 });
    }
  }
}

interface Feature {
  readonly type: 'Feature';
  readonly properties: Record<string, string | number>;
  readonly geometry: { readonly type: 'Point'; readonly coordinates: [number, number] };
}

export interface FeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: readonly Feature[];
}

/** Trains and craft turn along their course; the bus pictogram stays upright. */
export function vehicleSymbol(vehicle: LiveVehicle): { icon: string; bearing: number } {
  const directional =
    vehicle.mode === 'aircraft' ||
    vehicle.mode === 'ship' ||
    vehicle.mode === 'ferry' ||
    vehicle.mode === 'subway' ||
    vehicle.mode === 'rail';
  return {
    icon: `${vehicle.mode}-${vehicle.bearing === null ? 'disc' : 'pointer'}`,
    bearing: directional ? (vehicle.bearing?.degrees ?? 0) : 0,
  };
}

/** The vehicles where they are drawn now, each with its mark, course and selection. */
export function vehicleFeatures(
  vehicles: readonly LiveVehicle[],
  drawn: ReadonlyMap<string, LngLat>,
  selected: string | null,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles.map((vehicle) => {
      const at = drawn.get(vehicle.id) ?? [vehicle.position.lon, vehicle.position.lat];
      const symbol = vehicleSymbol(vehicle);
      return {
        type: 'Feature',
        properties: {
          id: vehicle.id,
          ...symbol,
          selected: vehicle.id === selected ? 1 : 0,
        },
        geometry: { type: 'Point', coordinates: [at[0], at[1]] },
      };
    }),
  };
}

/** The short text on a place: an airport's code and the bikes of a station; none for others. */
function labelOf(station: LiveStation): string {
  if (station.mode === 'airport') return station.code;
  if (station.mode === 'bike-station') return String(station.bikes);
  return '';
}

/** Places with a live state: they do not move and are drawn anew with each answer. */
export function stationFeatures(
  stations: readonly LiveStation[],
  selected: string | null,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stations.map((station) => ({
      type: 'Feature',
      properties: {
        id: station.id,
        mode: station.mode,
        label: labelOf(station),
        alert: station.mode === 'airport' && station.programs.length > 0 ? 1 : 0,
        selected: station.id === selected ? 1 : 0,
      },
      geometry: { type: 'Point', coordinates: [station.lon, station.lat] },
    })),
  };
}
