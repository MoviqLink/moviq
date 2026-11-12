import { useT } from '../i18n';
import { useHashSegments } from '../routing/hash';
import { travellerHref, travellerSection, type TravellerSection } from '../routing/hrefs';
import { Icon, type IconName } from './Icon';
import './nav.css';

const PLACES: readonly { id: TravellerSection; href: string; icon: IconName }[] = [
  { id: 'dashboard', href: travellerHref.dashboard, icon: 'gauge' },
  { id: 'agents', href: travellerHref.agents, icon: 'ring' },
  { id: 'explore', href: travellerHref.explore, icon: 'map' },
];

/**
 * Dashboard, Agent and Live map: in the header on a wide screen, docked at the foot on a phone.
 * The place of the current address is marked for the eye and for assistive technology.
 */
export function TravellerNav({ docked }: { docked: boolean }) {
  const t = useT().nav;
  const current = travellerSection(useHashSegments());
  return (
    <nav className={docked ? 'tnav tnav-dock' : 'tnav'} aria-label={t.label}>
      {PLACES.map((place) => (
        <a
          key={place.id}
          className="tnav-item"
          href={place.href}
          aria-current={current === place.id ? 'page' : undefined}
        >
          {docked && <Icon name={place.icon} />}
          <span>{t[place.id]}</span>
        </a>
      ))}
    </nav>
  );
}
