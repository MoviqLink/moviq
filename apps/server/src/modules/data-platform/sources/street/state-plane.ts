/**
 * NAD83 / New York Long Island (ftUS), EPSG:2263: the coordinates of NYC's street datasets, in
 * US survey feet. Lambert Conformal Conic with two standard parallels on the GRS80 ellipsoid
 * (EPSG guidance note 7-2, method 9802). NAD83 and WGS84 differ by about a metre in New York,
 * well below the size of a curb, so latitude and longitude are given as WGS84.
 */
const A = 6_378_137;
const F = 1 / 298.257_222_101;
const E = Math.sqrt(2 * F - F * F);
const US_FOOT = 1200 / 3937;
const RADIAN = Math.PI / 180;

const LATITUDE_1 = (41 + 2 / 60) * RADIAN;
const LATITUDE_2 = (40 + 40 / 60) * RADIAN;
const LATITUDE_0 = (40 + 10 / 60) * RADIAN;
const LONGITUDE_0 = -74 * RADIAN;
/** 300,000 m. */
const FALSE_EASTING_FEET = 300_000 / US_FOOT;

function m(latitude: number): number {
  const sin = Math.sin(latitude);
  return Math.cos(latitude) / Math.sqrt(1 - E * E * sin * sin);
}

function t(latitude: number): number {
  const sin = Math.sin(latitude);
  return Math.tan(Math.PI / 4 - latitude / 2) / ((1 - E * sin) / (1 + E * sin)) ** (E / 2);
}

const N =
  (Math.log(m(LATITUDE_1)) - Math.log(m(LATITUDE_2))) /
  (Math.log(t(LATITUDE_1)) - Math.log(t(LATITUDE_2)));
const AF = (A * m(LATITUDE_1)) / (N * t(LATITUDE_1) ** N);
const RHO_0 = AF * t(LATITUDE_0) ** N;

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

export interface StatePlane {
  /** Feet east. */
  readonly x: number;
  /** Feet north. */
  readonly y: number;
}

export function toStatePlane(point: LatLon): StatePlane {
  const rho = AF * t(point.lat * RADIAN) ** N;
  const theta = N * (point.lon * RADIAN - LONGITUDE_0);
  return {
    x: FALSE_EASTING_FEET + (rho * Math.sin(theta)) / US_FOOT,
    y: (RHO_0 - rho * Math.cos(theta)) / US_FOOT,
  };
}

export function fromStatePlane(point: StatePlane): LatLon {
  const east = point.x * US_FOOT - FALSE_EASTING_FEET * US_FOOT;
  const north = RHO_0 - point.y * US_FOOT;
  const rho = Math.sign(N) * Math.hypot(east, north);
  const tPrime = (rho / AF) ** (1 / N);
  let latitude = Math.PI / 2 - 2 * Math.atan(tPrime);
  for (let pass = 0; pass < 8; pass += 1) {
    const sin = Math.sin(latitude);
    latitude = Math.PI / 2 - 2 * Math.atan(tPrime * ((1 - E * sin) / (1 + E * sin)) ** (E / 2));
  }
  return {
    lat: latitude / RADIAN,
    lon: (Math.atan2(east, north) / N + LONGITUDE_0) / RADIAN,
  };
}
