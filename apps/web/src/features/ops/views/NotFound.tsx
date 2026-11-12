import { useT } from '../../../shared/i18n';
import { opsHref } from '../routes';
import { PageHead } from '../ui/PageHead';

/** An address the control room does not know. */
export function NotFound() {
  const t = useT().app;
  return (
    <section className="stack">
      <PageHead title={t.notFoundTitle} lead={t.notFoundBody} />
      <p>
        <a className="link" href={opsHref.summary}>
          {t.notFoundLink}
        </a>
      </p>
    </section>
  );
}
