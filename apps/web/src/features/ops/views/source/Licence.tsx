import type { SourceDetail } from '@moviq/contracts';

import { useT } from '../../../../shared/i18n';
import { Icon } from '../../../../shared/ui/Icon';
import { SectionHead } from '../../ui/Facts';

/** Only web addresses are turned into links; anything else is shown as text. */
function isWebAddress(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** The licence the data is used under and the attribution it asks for. */
export function Licence({ licence }: { licence: SourceDetail['licence'] }) {
  const t = useT().ops.source;
  return (
    <section className="panel" aria-labelledby="licence-title">
      <SectionHead id="licence-title" title={t.licence} />
      <p className="licence-name">
        {isWebAddress(licence.url) ? (
          <a className="link" href={licence.url} target="_blank" rel="noreferrer">
            {licence.name}
            <Icon name="external" />
          </a>
        ) : (
          licence.name
        )}
      </p>
      <p className="muted">{licence.attribution}</p>
    </section>
  );
}
