import type { Money } from '@moviq/contracts';
import { useEffect, useRef } from 'react';

import { useLocale } from '../../shared/i18n';
import { formatMoney } from '../../shared/journey/money';
import { useTicketsT, type TicketsDict } from './texts';
import './ticket-pass.css';

/** A ticket as the pass shows it, whether Sara bought it or it comes from the wallet of tickets. */
export interface PassTicket {
  readonly id: string;
  readonly name: string;
  readonly operator: string;
  readonly price: Money;
  readonly paidWith: 'wallet' | 'paypal';
  readonly paypalOrderId: string | null;
}

interface Bar {
  readonly x: number;
  readonly w: number;
}

const CODE_WIDTH = 200;

/** A 32-bit FNV-1a hash of the id: the same ticket always draws the same stripes. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** Stripes in a 200-unit band, from a small seeded generator; a picture, never a scannable code. */
function stripes(id: string): readonly Bar[] {
  let seed = hash(id);
  const next = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const bars: Bar[] = [
    { x: 0, w: 2 },
    { x: 3, w: 1 },
  ];
  let x = 6;
  while (x < CODE_WIDTH - 8) {
    const w = 1 + Math.floor(next() * 3);
    bars.push({ x, w });
    x += w + 1 + Math.floor(next() * 2);
  }
  bars.push({ x: CODE_WIDTH - 4, w: 1 }, { x: CODE_WIDTH - 2, w: 2 });
  return bars;
}

const shortId = (id: string) => id.slice(0, 8);

const paidText = (ticket: PassTicket, t: TicketsDict) =>
  ticket.paidWith === 'paypal' ? t.pass.paidPayPal : t.pass.paidWallet;

function Stripes({ id, label }: { id: string; label: string }) {
  return (
    <svg
      className="tp-code"
      viewBox={`0 0 ${String(CODE_WIDTH)} 80`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {stripes(id).map((bar) => (
        <rect key={bar.x} x={bar.x} y="0" width={bar.w} height="80" />
      ))}
    </svg>
  );
}

function PassFace({ ticket, refunded }: { ticket: PassTicket; refunded: boolean }) {
  const t = useTicketsT();
  const locale = useLocale();
  return (
    <div className={refunded ? 'ticket-pass is-refunded' : 'ticket-pass'}>
      <div className="tp-main">
        <span className="tp-operator">{ticket.operator}</span>
        <strong className="tp-name">{ticket.name}</strong>
        <span className="tp-price">{formatMoney(ticket.price, locale)}</span>
        <span className="tp-paid">{paidText(ticket, t)}</span>
        {ticket.paypalOrderId !== null && (
          <span className="tp-order">
            {t.pass.order} · {ticket.paypalOrderId}
          </span>
        )}
        {refunded && <span className="tp-stamp">{t.pass.refunded}</span>}
      </div>
      <div className="tp-stub">
        <Stripes id={ticket.id} label={t.pass.code} />
        <span className="tp-id">
          {t.pass.ticketId} {shortId(ticket.id)}
        </span>
      </div>
      <span className="tp-legend">{t.pass.legend}</span>
    </div>
  );
}

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

const clip = (text: string, size: number) =>
  text.length > size ? `${text.slice(0, size - 1)}…` : text;

const SANS = "Helvetica, Arial, 'Segoe UI', sans-serif";
const MONO = 'Menlo, Consolas, monospace';

/** The pass as a self-contained SVG file: its own text, stripes and generic fonts. */
function passSvg(ticket: PassTicket, t: TicketsDict, locale: string): string {
  const line = (x: number, y: number, size: number, text: string, extra: string) =>
    `<text x="${String(x)}" y="${String(y)}" font-size="${String(size)}" ${extra}>` +
    `${escapeXml(text)}</text>`;
  const scale = 172 / CODE_WIDTH;
  const bars = stripes(ticket.id)
    .map(
      (bar) =>
        `<rect x="${(584 + bar.x * scale).toFixed(2)}" y="104" ` +
        `width="${(bar.w * scale).toFixed(2)}" height="150"/>`,
    )
    .join('');
  const order =
    ticket.paypalOrderId === null
      ? ''
      : line(
          56,
          268,
          14,
          `${t.pass.order} · ${clip(ticket.paypalOrderId, 40)}`,
          `font-family="${MONO}" fill="#56606b"`,
        );
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="380" viewBox="0 0 800 380">',
    '<rect width="800" height="380" fill="#f4f5f3"/>',
    '<rect x="20" y="20" width="760" height="340" rx="22" fill="#ffffff" stroke="#c9cfc8"/>',
    '<line x1="548" y1="40" x2="548" y2="340" stroke="#c9cfc8" stroke-dasharray="6 6"/>',
    '<circle cx="548" cy="20" r="14" fill="#f4f5f3" stroke="#c9cfc8"/>',
    '<circle cx="548" cy="360" r="14" fill="#f4f5f3" stroke="#c9cfc8"/>',
    '<rect x="534" y="0" width="28" height="20" fill="#f4f5f3"/>',
    '<rect x="534" y="360" width="28" height="20" fill="#f4f5f3"/>',
    line(
      56,
      80,
      14,
      ticket.operator.toUpperCase(),
      `font-family="${MONO}" letter-spacing="2" fill="#56606b"`,
    ),
    line(56, 124, 28, clip(ticket.name, 30), `font-family="${SANS}" font-weight="700"`),
    line(
      56,
      200,
      44,
      formatMoney(ticket.price, locale),
      `font-family="${SANS}" font-weight="700" fill="#0a7a6a"`,
    ),
    line(56, 238, 16, paidText(ticket, t), `font-family="${SANS}" fill="#0e1318"`),
    order,
    line(56, 334, 13, t.pass.legend, `font-family="${MONO}" fill="#a15c00"`),
    line(584, 80, 15, 'MovIQ', `font-family="${SANS}" font-weight="700" fill="#4d7c0f"`),
    `<g fill="#0e1318">${bars}</g>`,
    line(
      584,
      282,
      13,
      `${t.pass.ticketId} ${shortId(ticket.id)}`,
      `font-family="${MONO}" fill="#56606b"`,
    ),
    '</svg>',
  ].join('');
}

function download(ticket: PassTicket, t: TicketsDict, locale: string) {
  const blob = new Blob([passSvg(ticket, t, locale)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `moviq-ticket-${shortId(ticket.id)}.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/** A ticket drawn as a pass, to view large or download as an SVG; a refunded one is not offered. */
export function TicketPass({
  ticket,
  refunded = false,
}: {
  readonly ticket: PassTicket;
  readonly refunded?: boolean;
}) {
  const t = useTicketsT();
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = dialog.current;
    if (node === null) return;
    const restore = () => {
      opener.current?.focus();
    };
    node.addEventListener('close', restore);
    return () => {
      node.removeEventListener('close', restore);
    };
  }, []);
  function open() {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
  }
  return (
    <article className="tp" aria-label={t.pass.label(ticket.name)}>
      <PassFace ticket={ticket} refunded={refunded} />
      <div className="tp-actions">
        <button type="button" className="tp-btn" onClick={open}>
          {t.pass.view}
        </button>
        {!refunded && (
          <button
            type="button"
            className="tp-btn tp-primary"
            onClick={() => {
              download(ticket, t, locale);
            }}
          >
            {t.pass.download}
          </button>
        )}
      </div>
      <dialog ref={dialog} className="tp-dialog" aria-label={t.pass.label(ticket.name)}>
        <PassFace ticket={ticket} refunded={refunded} />
        <div className="tp-actions">
          {!refunded && (
            <button
              type="button"
              className="tp-btn tp-primary"
              onClick={() => {
                download(ticket, t, locale);
              }}
            >
              {t.pass.download}
            </button>
          )}
          <button
            type="button"
            className="tp-btn"
            onClick={() => {
              dialog.current?.close();
            }}
          >
            {t.pass.close}
          </button>
        </div>
      </dialog>
    </article>
  );
}
