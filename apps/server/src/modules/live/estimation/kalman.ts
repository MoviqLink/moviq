/**
 * The state of a vehicle along its line: metres travelled and speed in m/s, with their
 * covariance (`dd` in m², `dv` in m²/s, `vv` in m²/s²).
 */
export interface AlongLine {
  readonly meters: number;
  readonly speed: number;
  readonly dd: number;
  readonly dv: number;
  readonly vv: number;
}

export interface FilterParameters {
  /** How much the speed may change unannounced, as white-noise acceleration (m²/s³). */
  readonly q: number;
  /** The typical error of one GPS report along the line (m). */
  readonly r: number;
  /** The fastest the vehicle runs (m/s); the speed is held between 0 and this. */
  readonly maxSpeed: number;
  /** How long the speed takes to settle on the typical speed of the stretch, when known (s). */
  readonly settleSeconds: number;
}

/** A first report: the vehicle is where it was seen, with its speed not yet known. */
export function startAt(meters: number, parameters: FilterParameters, speedSd: number): AlongLine {
  return { meters, speed: 0, dd: parameters.r ** 2, dv: 0, vv: speedSd ** 2 };
}

const held = (speed: number, max: number) => Math.min(max, Math.max(0, speed));

/**
 * The state `seconds` later. Without a typical speed the vehicle keeps its speed (constant
 * velocity); with one, its speed settles on it with time constant `settleSeconds`, so
 * v(s) = v̄ + (v − v̄)·e^(−s/τ) and the metres are its integral. The covariance follows the same
 * transition, plus the white-noise acceleration `q`.
 */
export function predict(
  state: AlongLine,
  seconds: number,
  parameters: FilterParameters,
  typicalSpeed: number | null,
): AlongLine {
  if (!(seconds > 0)) return state;
  const tau = parameters.settleSeconds;
  const decay = typicalSpeed === null ? 1 : Math.exp(-seconds / tau);
  const reach = typicalSpeed === null ? seconds : tau * (1 - decay);
  const target = typicalSpeed ?? state.speed;
  const meters = state.meters + target * seconds + (state.speed - target) * reach;
  const speed = target + (state.speed - target) * decay;
  const { q } = parameters;
  const s = seconds;
  return {
    meters,
    speed: held(speed, parameters.maxSpeed),
    dd: state.dd + 2 * reach * state.dv + reach * reach * state.vv + (q * s ** 3) / 3,
    dv: decay * state.dv + reach * decay * state.vv + (q * s ** 2) / 2,
    vv: decay * decay * state.vv + q * s,
  };
}

/** The state corrected by a GPS report placed `measured` metres along the line. */
export function correct(
  state: AlongLine,
  measured: number,
  parameters: FilterParameters,
): AlongLine {
  const innovation = measured - state.meters;
  const spread = state.dd + parameters.r ** 2;
  const gainMeters = state.dd / spread;
  const gainSpeed = state.dv / spread;
  return {
    meters: state.meters + gainMeters * innovation,
    speed: held(state.speed + gainSpeed * innovation, parameters.maxSpeed),
    dd: (1 - gainMeters) * state.dd,
    dv: (1 - gainMeters) * state.dv,
    vv: state.vv - gainSpeed * state.dv,
  };
}
