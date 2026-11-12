import { useT } from '../shared/i18n';
import { useLang } from '../shared/i18n/lang';
import { travellerHref } from '../shared/routing/hrefs';
import { TopBar } from '../shared/ui/TopBar';
import { useHomeT } from '../features/home/texts';
import './welcome.css';

const WORDS = {
  en: {
    kicker: 'Welcome to MovIQ',
    title: 'Your urban mobility assistant.',
    body:
      'Tell Sara where you are going. She plans the route, watches delays live and buys your ' +
      'tickets with PayPal.',
    start: 'Talk to Sara',
    map: 'See the city live',
  },
  es: {
    kicker: 'Bienvenido a MovIQ',
    title: 'Tu asistente de movilidad urbana.',
    body:
      'Dile a Sara adónde vas. Ella calcula la ruta, vigila los retrasos en directo y compra ' +
      'tus billetes con PayPal.',
    start: 'Habla con Sara',
    map: 'Ver la ciudad en directo',
  },
} as const;

/** The traveller's home once inside: what MovIQ is, in one line, and the way to Sara. */
export function WelcomeScreen() {
  const words = WORDS[useLang()];
  const t = useT();
  const home = useHomeT();
  return (
    <>
      <TopBar variant="photo" homeLabel={home.home} skipLabel={t.app.skip} />
      <main id="main" className="welcome" tabIndex={-1}>
        <div className="welcome-copy">
          <p className="welcome-kicker">{words.kicker}</p>
          <h1>{words.title}</h1>
          <p className="welcome-body">{words.body}</p>
          <div className="welcome-actions">
            <a className="welcome-start" href={travellerHref.agents}>
              {words.start} <span aria-hidden="true">→</span>
            </a>
            <a className="welcome-map" href={travellerHref.explore}>
              {words.map}
            </a>
          </div>
        </div>
      </main>
    </>
  );
}
