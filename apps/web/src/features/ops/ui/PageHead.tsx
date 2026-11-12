import { useEffect, useRef, type ReactNode } from 'react';

import { useT } from '../../../shared/i18n';

let firstScreen = true;

/**
 * The screen's title. It names the browser tab and, after a navigation, takes the focus, so
 * keyboard and screen reader users start reading the new screen from its heading.
 */
export function PageHead(props: { title: string; lead?: string; children?: ReactNode }) {
  const brand = useT().ops.title;
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${props.title} · MovIQ ${brand}`;
  }, [props.title, brand]);

  useEffect(() => {
    if (firstScreen) firstScreen = false;
    else heading.current?.focus({ preventScroll: false });
  }, []);

  return (
    <header className="page-head">
      <div className="page-title">
        <h1 ref={heading} tabIndex={-1}>
          {props.title}
        </h1>
        {props.lead !== undefined && <p className="lead">{props.lead}</p>}
      </div>
      {props.children !== undefined && <div className="page-aside">{props.children}</div>}
    </header>
  );
}
