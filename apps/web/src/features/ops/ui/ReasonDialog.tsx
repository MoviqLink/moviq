import { opsActionRequestSchema } from '@moviq/contracts';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';

import { ApiRequestError } from '../../../shared/api/errors';
import { useT } from '../../../shared/i18n';
import { Icon } from '../../../shared/ui/Icon';

type Dict = ReturnType<typeof useT>['ops']['reason'];

function refusal(error: unknown, t: Dict): string {
  if (!(error instanceof ApiRequestError)) return t.failed;
  if (error.code === 'forbidden') return t.forbidden;
  if (error.code === 'conflict') return t.conflict;
  return t.failed;
}

interface FieldProps {
  readonly value: string;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
}

/** The reason box with its rule and, when the reason or the server refused, why. */
function ReasonField({ value, error, onChange }: FieldProps) {
  const t = useT().ops.reason;
  const ids = { input: useId(), hint: useId(), error: useId() };
  return (
    <div className="field">
      <label htmlFor={ids.input}>{t.label}</label>
      <textarea
        id={ids.input}
        value={value}
        maxLength={300}
        required
        aria-invalid={error !== null}
        aria-describedby={error === null ? ids.hint : `${ids.hint} ${ids.error}`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <span id={ids.hint} className="hint">
        {t.hint}
      </span>
      {error !== null && (
        <span id={ids.error} className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

interface Props {
  readonly title: string;
  readonly lead: string;
  readonly onConfirm: (reason: string) => Promise<void>;
  readonly onClose: () => void;
}

/** Asks why before a sensitive action. The rule for a valid reason is the API contract's own. */
export function ReasonDialog({ title, lead, onConfirm, onClose }: Props) {
  const t = useT().ops.reason;
  const ref = useRef<HTMLDialogElement>(null);
  const ids = { title: useId(), lead: useId() };
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const close = () => ref.current?.close();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = opsActionRequestSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(t.tooShort);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await onConfirm(parsed.data.reason);
      close();
    } catch (failure) {
      setError(refusal(failure, t));
      setSending(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={ids.title}
      aria-describedby={ids.lead}
      onClose={onClose}
    >
      <form className="sheet-in" onSubmit={(event) => void submit(event)} noValidate>
        <div className="sheet-head">
          <h2 id={ids.title}>{title}</h2>
          <button type="button" className="icon-btn" aria-label={t.close} onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        <p id={ids.lead} className="muted">
          {lead}
        </p>
        <ReasonField value={reason} error={error} onChange={setReason} />
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={close}>
            {t.close}
          </button>
          <button type="submit" className="btn primary" disabled={sending}>
            {sending ? t.sending : t.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}
