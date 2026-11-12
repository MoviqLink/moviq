import { type ReactElement, useId } from 'react';

import { travellerHref } from '../../shared/routing/hrefs';
import { TopBar } from '../../shared/ui/TopBar';
import { useHomeT } from './texts';
import './home.css';

/**
 * How it works: who Sara is, the four things she does for you, what stays in your hands, and the
 * way in to her.
 */
function HowItWorks() {
  const t = useHomeT();
  const how = t.how;
  const steps = useId();
  const control = useId();
  return (
    <div className="home">
      <TopBar variant="photo" homeLabel={t.home} skipLabel={t.skip} />
      <main id="main" className="how" tabIndex={-1}>
        <div className="how-photo" role="img" aria-label={t.photo} />
        <header className="how-head">
          <p className="how-kicker">{how.kicker}</p>
          <h1>{how.title}</h1>
          <p className="how-lead">{how.lead}</p>
        </header>

        <section className="how-steps" aria-labelledby={steps}>
          <h2 id={steps} className="visually-hidden">
            {how.stepsTitle}
          </h2>
          <ol>
            {how.steps.map((step, index) => (
              <li key={step.title} className="how-step">
                <span className="how-num" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="how-control" aria-labelledby={control}>
          <h2 id={control}>{how.controlTitle}</h2>
          <ul>
            {how.control.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="how-sandbox">{how.sandbox}</p>
        </section>

        <div className="how-actions">
          <a className="how-start" href={travellerHref.agents}>
            {how.start}
          </a>
          <a className="how-city" href={travellerHref.explore}>
            {how.city}
          </a>
        </div>
      </main>
    </div>
  );
}

/** The app still hands the page Sara's sender; this page sends nothing, it leads to her. */
export const HomeScreen: (props: { onAsk?: (message: string) => void }) => ReactElement =
  HowItWorks;
