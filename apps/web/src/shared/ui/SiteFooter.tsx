import { useT } from '../i18n';
import { useLang } from '../i18n/lang';
import { travellerHref } from '../routing/hrefs';
import './nav.css';

/**
 * The foot of the traveller's pages and a link to the credits of every source.
 */
export function SiteFooter() {
  const t = useT();
  const lang = useLang();
  return (
    <footer className="site-foot">
      <p className="site-foot-brand">
        <span className="site-foot-name">
          MOV<b>IQ</b>
        </span>
        <span>{t.brand.role}</span>
        <span lang="en">{t.brand.tagline}</span>
      </p>
      <nav className="site-foot-nav" aria-label={t.footer.label}>
        <a className="site-foot-link" href={travellerHref.credits(lang)}>
          {t.footer.credits}
        </a>
      </nav>
    </footer>
  );
}
