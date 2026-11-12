import { useEffect, useRef } from 'react';

interface Props {
  readonly disabled: boolean;
  readonly onClick: () => void;
}

/**
 * PayPal's official button, the `<paypal-button>` element drawn by its SDK. The click starts the
 * payment straight away, so the browser lets PayPal open its approval window.
 */
export function PayPalButton({ disabled, onClick }: Props) {
  const slot = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLElementTagNameMap['paypal-button'] | null>(null);
  const click = useRef(onClick);

  useEffect(() => {
    click.current = onClick;
  });

  useEffect(() => {
    const host = slot.current;
    if (host === null) return;
    const element = document.createElement('paypal-button');
    element.type = 'pay';
    const handle = () => {
      click.current();
    };
    element.addEventListener('click', handle);
    host.append(element);
    button.current = element;
    return () => {
      element.removeEventListener('click', handle);
      element.remove();
      button.current = null;
    };
  }, []);

  useEffect(() => {
    if (button.current !== null) button.current.disabled = disabled;
  }, [disabled]);

  return <div className="paypal-slot" ref={slot} aria-busy={disabled} />;
}
