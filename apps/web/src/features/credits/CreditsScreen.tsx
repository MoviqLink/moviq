import { useId } from 'react';

import { Icon } from '../../shared/ui/Icon';
import { TopBar } from '../../shared/ui/TopBar';
import { CREDIT_GROUPS, NYC_DOT_DISCLAIMER, catalogueSources, type Credit } from './sources';
import { useCreditsT } from './texts';
import './credits.css';

const FEEDS = catalogueSources(CREDIT_GROUPS).length;

/** The licence's name, linked to the page that states it when there is one. */
function LicenceLink({ licence }: { licence: Credit['licence'] }) {
  const t = useCreditsT();
  if (licence.url === null) return <span className="credit-licence">{licence.name}</span>;
  return (
    <a className="credit-licence" href={licence.url} target="_blank" rel="noreferrer" lang="en">
      {licence.name}
      <Icon name="external" />
      <span className="visually-hidden">{t.newTab}</span>
    </a>
  );
}

/** One holder: who they are and what they give, then their credit, word for word, and licence. */
function CreditRow({ credit }: { credit: Credit }) {
  const t = useCreditsT();
  const words = t.credits[credit.id];
  const feeds = credit.sources.length;
  return (
    <li className="credit">
      <div className="credit-who">
        <h3>{words.name}</h3>
        <p>{words.what}</p>
        {feeds > 0 && <p className="credit-feeds num">{t.feeds(feeds)}</p>}
      </div>
      <dl className="credit-terms">
        <dt>{t.credit}</dt>
        {credit.attribution.map((line) => (
          <dd key={line} className="credit-line" lang="en">
            {line}
          </dd>
        ))}
        <dt>{t.licence}</dt>
        <dd>
          <LicenceLink licence={credit.licence} />
        </dd>
      </dl>
    </li>
  );
}

function Group({ group }: { group: (typeof CREDIT_GROUPS)[number] }) {
  const t = useCreditsT();
  const title = useId();
  return (
    <section className="credit-group" aria-labelledby={title}>
      <h2 id={title}>{t.groups[group.id]}</h2>
      <ul className="credit-list">
        {group.credits.map((credit) => (
          <CreditRow key={credit.id} credit={credit} />
        ))}
      </ul>
    </section>
  );
}

/** `#/credits` and `#/creditos`: every source MovIQ uses, by kind, with its credit and licence. */
export function CreditsScreen() {
  const t = useCreditsT();
  const notice = useId();
  return (
    <>
      <TopBar variant="solid" homeLabel={t.home} skipLabel={t.skip} />
      <main id="main" className="credits" tabIndex={-1}>
        <header className="credits-head">
          <h1>{t.title}</h1>
          <p className="credits-lead">{t.lead}</p>
          <p className="credits-number">
            <b className="mono">{FEEDS}</b>
            <span>{t.feedsLine}</span>
          </p>
        </header>
        {CREDIT_GROUPS.map((group) => (
          <Group key={group.id} group={group} />
        ))}
        <section className="credits-notice" aria-labelledby={notice}>
          <h2 id={notice}>{t.notice}</h2>
          <p>{t.noticeLead}</p>
          <blockquote lang="en">{NYC_DOT_DISCLAIMER}</blockquote>
        </section>
      </main>
    </>
  );
}
