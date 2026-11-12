import type { ReactNode } from 'react';

/** A list of label and value pairs, laid out as a quiet two-column table of facts. */
export function Facts({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="facts">
      {items.map(([label, value]) => (
        <div key={label} className="fact">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A section title on the route line: a dot, the words and a thin line to the right edge. */
export function SectionHead({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="sec-head">
      <h2 id={id}>{title}</h2>
      {children}
    </div>
  );
}
