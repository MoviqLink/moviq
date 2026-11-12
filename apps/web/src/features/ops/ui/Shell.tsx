import type { ReactNode } from 'react';

import { LangSwitch } from '../../../shared/i18n/LangSwitch';
import { useLocale, useT } from '../../../shared/i18n';
import { ThemeSwitch } from '../../../shared/theme/ThemeSwitch';
import { useNow } from '../../../shared/time/clock';
import { formatClock } from '../../../shared/time/instant';
import { Icon } from '../../../shared/ui/Icon';
import { Logo } from '../../../shared/ui/Logo';
import { opsHref, type OpsRoute } from '../routes';
import type { SessionValue } from '../session';
import { useMoneyT } from '../views/money/texts';

type Section = 'summary' | 'sources' | 'jobs' | 'money' | 'audit';

const SECTIONS: readonly Section[] = ['summary', 'sources', 'jobs', 'money', 'audit'];

function sectionOf(route: OpsRoute): Section | null {
  if (route.name === 'source') return 'sources';
  return route.name === 'not-found' ? null : route.name;
}

function SessionBox({ value, onSignOut }: { value: SessionValue; onSignOut: () => void }) {
  const t = useT().ops.session;
  const locale = useLocale();
  const until = formatClock(value.session.expiresAt, locale, useNow());
  return (
    <div className="session">
      <span className="session-role">{t[value.session.role]}</span>
      <span className="session-until">{t.until(until)}</span>
      <button
        type="button"
        className="icon-btn"
        aria-label={t.signOut}
        title={t.signOut}
        onClick={onSignOut}
      >
        <Icon name="signOut" />
      </button>
    </div>
  );
}

interface Props {
  readonly route: OpsRoute | null;
  readonly session: SessionValue | null;
  readonly onSignOut: () => void;
  readonly children: ReactNode;
}

/** The control room frame: logo, sections, session and preferences, then the screen. */
export function Shell({ route, session, onSignOut, children }: Props) {
  const t = useT();
  const names = { ...t.ops.nav, money: useMoneyT().nav };
  const current = route === null ? null : sectionOf(route);
  return (
    <>
      <a className="skip" href="#main">
        {t.app.skip}
      </a>
      <header className="bar">
        <div className="bar-in">
          <a className="brand" href={opsHref.summary} aria-label={t.app.home}>
            <Logo />
            <span className="brand-area">{t.ops.title}</span>
          </a>
          {session !== null && (
            <nav className="tabs" aria-label={t.ops.nav.label}>
              {SECTIONS.map((section) => (
                <a
                  key={section}
                  href={opsHref[section]}
                  aria-current={current === section ? 'page' : undefined}
                >
                  {names[section]}
                </a>
              ))}
            </nav>
          )}
          <div className="bar-end">
            {session !== null && <SessionBox value={session} onSignOut={onSignOut} />}
            <ThemeSwitch />
            <LangSwitch />
          </div>
        </div>
      </header>
      <main id="main" className="page" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
