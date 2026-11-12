import { useEffect, useRef, type ReactNode } from 'react';

import { useLocale } from '../../../shared/i18n';
import { formatCityTime } from '../../../shared/time/city';
import { useMerchantT } from '../texts';

let firstScreen = true;

interface Props {
  readonly title: string;
  readonly lead: string;
  /** When the data on screen arrived, said beside the title. */
  readonly receivedAt?: number | null;
  readonly children?: ReactNode;
}

/**
 * The screen's title, lead and the time of its data (New York time). After a navigation the title takes the
 * focus, so keyboard and screen reader users start reading the new screen from it.
 */
export function Head({ title, lead, receivedAt = null, children }: Props) {
  const t = useMerchantT();
  const locale = useLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (firstScreen) firstScreen = false;
    else heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <header className="mc-head">
      <div>
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        <p className="mc-lead">{lead}</p>
      </div>
      <div className="mc-head-aside">
        {receivedAt !== null && (
          <p className="mc-updated">
            {t.updated(formatCityTime(new Date(receivedAt).toISOString(), locale))}
          </p>
        )}
        {children}
      </div>
    </header>
  );
}
