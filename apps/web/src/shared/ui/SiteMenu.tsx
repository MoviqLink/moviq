import { useRef } from 'react';
import { createPortal } from 'react-dom';

import { useLang } from '../i18n/lang';
import { travellerHref } from '../routing/hrefs';
import { Icon } from './Icon';
import './site-menu.css';

const WORDS = {
  en: {
    open: 'Open menu',
    close: 'Close menu',
    title: 'Menu',
    home: 'Home',
    dashboard: 'Dashboard',
    agents: 'Agent',
    live: 'Live map',
    traffic: 'Traffic',
    incidents: 'Incidents',
    stations: 'Stations and lines',
  },
  es: {
    open: 'Abrir menú',
    close: 'Cerrar menú',
    title: 'Menú',
    home: 'Inicio',
    dashboard: 'Panel',
    agents: 'Agente',
    live: 'Mapa en vivo',
    traffic: 'Tráfico',
    incidents: 'Incidencias',
    stations: 'Estaciones y líneas',
  },
} as const;

/** A modal drawer keeps keyboard focus inside and returns it to its opener on close. */
export function SiteMenu() {
  const lang = useLang();
  const t = WORDS[lang];
  const dialog = useRef<HTMLDialogElement>(null);
  const links = [
    [t.home, travellerHref.home],
    [t.dashboard, travellerHref.dashboard],
    [t.agents, travellerHref.agents],
    [t.live, travellerHref.explore],
    [t.traffic, `${travellerHref.explore}?view=traffic`],
    [t.incidents, `${travellerHref.explore}?view=incidents`],
    [t.stations, `${travellerHref.explore}?view=stations`],
  ];
  return (
    <>
      <button
        className="site-menu-trigger"
        type="button"
        aria-label={t.open}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <Icon name="menu" />
      </button>
      {createPortal(
        <dialog ref={dialog} className="site-menu" aria-labelledby="site-menu-title">
          <div className="site-menu-head">
            <h2 id="site-menu-title">{t.title}</h2>
            <button
              className="site-menu-trigger"
              type="button"
              aria-label={t.close}
              onClick={() => dialog.current?.close()}
            >
              <Icon name="close" />
            </button>
          </div>
          <nav aria-label={t.title}>
            {links.map(([label, href]) => (
              <a key={href} href={href} onClick={() => dialog.current?.close()}>
                {label}
              </a>
            ))}
          </nav>
        </dialog>,
        document.body,
      )}
    </>
  );
}
