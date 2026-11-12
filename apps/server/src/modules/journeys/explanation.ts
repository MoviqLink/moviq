import type { Alternative, Journey } from '@moviq/contracts';

export type WatchExplanation = NonNullable<Journey['watch']['explanation']>;

/** The parts of a journey an explanation is about. */
interface Explained {
  readonly state: Journey['state'];
  readonly watch: Pick<Journey['watch'], 'status'>;
  readonly incidents: readonly { readonly id: string }[];
  readonly alternatives: readonly Alternative[];
}

/**
 * What Sara's explanation is about: the verdict, the incidents by id and the options by their
 * rides and whether they cost money. Null when there is nothing to explain: a journey no longer
 * watched, or one on track (or not checked yet) with no incident and no option.
 */
export function explanationSubject(journey: Explained): string | null {
  const { status } = journey.watch;
  if (journey.state !== 'watching') return null;
  const worrying = status === 'at-risk' || status === 'late';
  if (!worrying && journey.incidents.length === 0 && journey.alternatives.length === 0) {
    return null;
  }
  const incidents = journey.incidents.map((incident) => incident.id).sort();
  const options = journey.alternatives.map((alternative) => {
    const rides = alternative.itinerary.legs.map((leg) => leg.route?.shortName ?? leg.mode);
    return `${rides.join('>')}${alternative.price === null ? '' : '+paid'}`;
  });
  return [status, incidents.join(','), options.join(';')].join('|');
}

/**
 * The explanation the journey had, while it still explains its new verdict, incidents and
 * options: Sara's words never stay under a change they do not tell.
 */
export function keptExplanation(
  before: Pick<Journey, 'state' | 'watch'>,
  verdict: Pick<Explained, 'incidents'> & { readonly status: Journey['watch']['status'] },
  alternatives: readonly Alternative[],
): WatchExplanation | null {
  const explanation = before.watch.explanation;
  if (explanation === undefined || explanation === null) return null;
  const now = { state: before.state, watch: verdict, incidents: verdict.incidents, alternatives };
  return explanation.about === explanationSubject(now) ? explanation : null;
}
