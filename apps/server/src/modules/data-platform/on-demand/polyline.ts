/**
 * Decodes a Google encoded polyline into `[longitude, latitude]` pairs, with `precision` decimal
 * digits (MOTIS states it next to each polyline). `undefined` when the text is not a whole
 * polyline: a value cut short, a character outside the encoding or a point off the globe.
 */
export function decodePolyline(encoded: string, precision: number): [number, number][] | undefined {
  const factor = 10 ** precision;
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    const latStep = readValue(encoded, index);
    if (latStep === undefined) return undefined;
    const lonStep = readValue(encoded, latStep.next);
    if (lonStep === undefined) return undefined;
    index = lonStep.next;
    lat += latStep.value;
    lon += lonStep.value;
    const point: [number, number] = [
      round(lon / factor, precision),
      round(lat / factor, precision),
    ];
    if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return undefined;
    points.push(point);
  }
  return points;
}

/** One zig-zag encoded integer, in chunks of five bits; plain arithmetic avoids 32-bit overflow. */
function readValue(
  encoded: string,
  start: number,
): { readonly value: number; readonly next: number } | undefined {
  let result = 0;
  let shift = 0;
  let index = start;
  for (;;) {
    if (index >= encoded.length || shift > 30) return undefined;
    const chunk = encoded.charCodeAt(index) - 63;
    index += 1;
    if (chunk < 0 || chunk > 63) return undefined;
    result += (chunk % 32) * 2 ** shift;
    shift += 5;
    if (chunk < 32) break;
  }
  const value = result % 2 === 1 ? -(result + 1) / 2 : result / 2;
  return { value, next: index };
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
