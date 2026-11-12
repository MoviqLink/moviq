import type { ReactNode } from 'react';

import { LangSwitch } from '../../../shared/i18n/LangSwitch';
import { ThemeSwitch } from '../../../shared/theme/ThemeSwitch';
import { Icon } from '../../../shared/ui/Icon';
import { Logo } from '../../../shared/ui/Logo';
import { MERCHANT_SECTIONS, merchantHref, type MerchantSection } from '../routes';
import type { DemoMerchant } from '../schemas';
import { useMerchantT } from '../texts';

interface Props {
  /** The open merchant, or null before one is chosen. */
  readonly merchant: DemoMerchant | null;
  readonly current: MerchantSection | null;
  readonly onSignOut: () => void;
  readonly children: ReactNode;
}

/** The panel's frame: the logo, the merchant marked demo, its sections, preferences and exit. */
export function Shell({ merchant, current, onSignOut, children }: Props) {
  const t = useMerchantT();
  return (
    <div className="mc">
      <a className="skip" href="#main">
        {t.skip}
      </a>
      <header className="mc-bar">
        <div className="mc-bar-in">
          <a className="mc-brand" href={merchantHref.today} aria-label={t.home}>
            <Logo />
            <span className="mc-area">{t.title}</span>
          </a>
          {merchant !== null && (
            <p className="mc-who">
              <span className="mc-who-name">{merchant.name}</span>
              <span className="mc-demo">{t.demo}</span>
            </p>
          )}
          <div className="mc-bar-end">
            <ThemeSwitch />
            <LangSwitch />
            {merchant !== null && (
              <button
                type="button"
                className="mc-icon-btn"
                aria-label={t.signOut}
                title={t.signOut}
                onClick={onSignOut}
              >
                <Icon name="signOut" />
              </button>
            )}
          </div>
        </div>
        {merchant !== null && (
          <nav className="mc-tabs" aria-label={t.nav.label}>
            {MERCHANT_SECTIONS.map((section) => (
              <a
                key={section}
                href={merchantHref[section]}
                aria-current={current === section ? 'page' : undefined}
              >
                {t.nav[section]}
              </a>
            ))}
          </nav>
        )}
      </header>
      <main id="main" className="mc-page" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
