import type { ReactNode } from 'react';

import type { Resource } from '../useResource';
import { useMerchantT } from '../texts';
import { ProblemNote } from './ProblemNote';

/**
 * A resource on screen: a quiet sentence while the first answer comes, what went wrong if it did
 * not, and the last good answer otherwise, kept on screen while a later request fails.
 */
export function Loaded<T>(props: { resource: Resource<T>; children: (data: T) => ReactNode }) {
  const t = useMerchantT();
  const { data, failure, loading, reload } = props.resource;
  return (
    <>
      <ProblemNote failure={failure} onRetry={reload} retrying={loading} />
      {data === null
        ? failure === null && (
            <p className="mc-quiet" role="status">
              {t.loading}
            </p>
          )
        : props.children(data)}
    </>
  );
}
