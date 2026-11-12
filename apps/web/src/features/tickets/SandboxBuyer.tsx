import { demoBuyerSchema, demoBuyerStatusSchema } from '@moviq/contracts';
import { useEffect, useState } from 'react';

import { api } from '../../shared/api/client';
import { useLang } from '../../shared/i18n/lang';

interface Buyer {
  readonly email: string;
  readonly password: string;
}

function CopyField({ label, value, hidden }: { label: string; value: string; hidden?: boolean }) {
  const es = useLang() === 'es';
  const [visible, setVisible] = useState(!hidden);
  const [message, setMessage] = useState('');
  const copy = () => {
    const fallback = () => {
      setVisible(true);
      setMessage(
        es ? 'Selecciona el texto y cópialo manualmente.' : 'Select the text and copy it manually.',
      );
    };
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(value))
      .then(() => {
        setMessage(es ? 'Copiado' : 'Copied');
      }, fallback);
  };
  return (
    <div className="sandbox-field">
      <label>
        {label}
        <input
          readOnly
          value={value}
          type={visible ? 'text' : 'password'}
          onFocus={(event) => {
            if (visible) event.currentTarget.select();
          }}
        />
      </label>
      <div>
        {hidden && (
          <button
            type="button"
            onClick={() => {
              setVisible(!visible);
            }}
          >
            {visible ? (es ? 'Ocultar' : 'Hide') : es ? 'Mostrar' : 'Show'}
          </button>
        )}{' '}
        <button type="button" onClick={copy}>
          {es ? 'Copiar' : 'Copy'}
        </button>
      </div>
      <span role="status">{message}</span>
    </div>
  );
}

export function SandboxBuyer() {
  const es = useLang() === 'es';
  const [available, setAvailable] = useState(false);
  const [buyer, setBuyer] = useState<Buyer | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api
      .json('/api/tickets/demo/buyer-status', demoBuyerStatusSchema, { signal: controller.signal })
      .then(
        (status) => {
          setAvailable(status.available);
        },
        () => {
          /* Optional help remains hidden when unavailable. */
        },
      );
    return () => {
      controller.abort();
    };
  }, []);
  if (!available) return null;
  const load = () => {
    setError(false);
    void api.json('/api/tickets/demo/buyer', demoBuyerSchema).then(setBuyer, () => {
      setError(true);
    });
  };
  return (
    <div className="sandbox-buyer">
      {buyer === null ? (
        <button type="button" onClick={load}>
          {es ? 'Mostrar datos de prueba' : 'Show test account'}
        </button>
      ) : (
        <>
          <CopyField label={es ? 'Correo de prueba' : 'Test email'} value={buyer.email} />
          <CopyField
            label={es ? 'Contraseña de prueba' : 'Test password'}
            value={buyer.password}
            hidden
          />
        </>
      )}
      {error && (
        <p role="alert">
          {es
            ? 'No se pudieron cargar los datos. Inténtalo de nuevo.'
            : 'Could not load the account. Try again.'}
        </p>
      )}
    </div>
  );
}
