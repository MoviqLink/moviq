/** A point of a shape, in degrees. */
export interface ShapePoint {
  readonly lat: number;
  readonly lon: number;
}

/**
 * Five decimals, as in the Google encoded polyline format: 1e-5 degrees is 1.1 m of latitude,
 * finer than the six decimals the MTA writes are worth for a vehicle on a street or a track.
 */
const SCALE = 1e5;
/** Every character of an encoded polyline is one of these (ASCII 63 to 126). */
export const POLYLINE_PATTERN = /^[?-~]*$/;

function encodeNumber(value: number): string {
  let rest = value < 0 ? ~(value << 1) : value << 1;
  let text = '';
  while (rest >= 0x20) {
    text += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
    rest >>= 5;
  }
  return text + String.fromCharCode(rest + 63);
}

/** The points as one encoded polyline string, each coordinate as the difference to the last. */
export function encodePolyline(points: readonly ShapePoint[]): string {
  let lat = 0;
  let lon = 0;
  let text = '';
  for (const point of points) {
    const nextLat = Math.round(point.lat * SCALE);
    const nextLon = Math.round(point.lon * SCALE);
    text += encodeNumber(nextLat - lat) + encodeNumber(nextLon - lon);
    lat = nextLat;
    lon = nextLon;
  }
  return text;
}

/** Reads one number from `at`; undefined when the text ends inside it. */
function decodeNumber(text: string, at: number): { value: number; next: number } | undefined {
  let result = 0;
  let shift = 0;
  let index = at;
  for (;;) {
    if (index >= text.length) return undefined;
    const chunk = text.charCodeAt(index) - 63;
    index += 1;
    result |= (chunk & 0x1f) << shift;
    shift += 5;
    if (chunk < 0x20) break;
  }
  return { value: result & 1 ? ~(result >> 1) : result >> 1, next: index };
}

/**
 * The points of an encoded polyline, or undefined when the text is not one: a character outside
 * the format, a number cut short or a coordinate outside the Earth.
 */
export function decodePolyline(text: string): ShapePoint[] | undefined {
  if (!POLYLINE_PATTERN.test(text)) return undefined;
  const points: ShapePoint[] = [];
  let lat = 0;
  let lon = 0;
  let at = 0;
  while (at < text.length) {
    const dLat = decodeNumber(text, at);
    const dLon = dLat && decodeNumber(text, dLat.next);
    if (dLat === undefined || dLon === undefined) return undefined;
    lat += dLat.value;
    lon += dLon.value;
    at = dLon.next;
    const point = { lat: lat / SCALE, lon: lon / SCALE };
    if (Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) return undefined;
    points.push(point);
  }
  return points;
}
