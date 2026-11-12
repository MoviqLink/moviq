import type { MouseEvent } from 'react';

import { LangSwitch } from '../i18n/LangSwitch';
import { useT } from '../i18n';
import { travellerHref } from '../routing/hrefs';
import { ThemeSwitch } from '../theme/ThemeSwitch';
import { Logo } from './Logo';
import { Icon } from './Icon';
import { SiteMenu } from './SiteMenu';
import { TravellerNav } from './TravellerNav';
import { useMediaQuery } from './useMediaQuery';
import './traveller.css';

/** Below this width the navigation leaves the header and docks at the foot of the screen. */
const DOCKED = '(max-width: 719px)';

interface Props {
  /**
   * `solid` sits on top of a page, `floating` is a translucent strip over the map and `photo`
   * lies on the home page's picture, in the night colours of the logo.
   */
  readonly variant: 'solid' | 'floating' | 'photo';
  readonly homeLabel: string;
  readonly skipLabel: string;
}

/** The address is the router's: the skip link moves the focus, never the hash. */
function skipToMain(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
  document.getElementById('main')?.focus();
}

/** The traveller's header: the logo to the home page, the navigation, appearance and language. */
export function TopBar({ variant, homeLabel, skipLabel }: Props) {
  const docked = useMediaQuery(DOCKED);
  const changeProfile = useT().nav.changeProfile;
  return (
    <>
      <a className="skip" href="#main" onClick={skipToMain}>
        {skipLabel}
      </a>
      <header className={`topbar topbar-${variant}`}>
        <SiteMenu />
        <a className="topbar-brand" href={travellerHref.home} aria-label={homeLabel}>
          <Logo />
        </a>
        {!docked && <TravellerNav docked={false} />}
        <div className="topbar-end">
          <a
            className="topbar-profile"
            href="#/access"
            aria-label={changeProfile}
            title={changeProfile}
          >
            <Icon name="signOut" />
          </a>
          <ThemeSwitch />
          <LangSwitch />
        </div>
      </header>
      {docked && <TravellerNav docked />}
    </>
  );
}
