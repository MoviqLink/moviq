import { useId, useState, type SubmitEvent } from 'react';

import { ApiRequestError } from '../../../shared/api/errors';
import { useT } from '../../../shared/i18n';
import { opsApi } from '../api';
import { PageHead } from '../ui/PageHead';

/** The sign-in form. The token goes to the API once, which answers with a session cookie. */
export function LoginView({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useT();
  const ids = { input: useId(), note: useId(), error: useId() };
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token.trim() === '') return;
    setSending(true);
    setError(null);
    try {
      await opsApi.signIn(token.trim());
      setToken('');
      onSignedIn();
    } catch (failure) {
      const refused = failure instanceof ApiRequestError && failure.code === 'unauthorized';
      setError(refused ? t.ops.login.wrong : t.conn.lost);
      setSending(false);
    }
  }

  return (
    <div className="login">
      <PageHead title={t.ops.login.title} lead={t.ops.login.lead} />
      <form className="login-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor={ids.input}>{t.ops.login.token}</label>
          <input
            id={ids.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            maxLength={512}
            required
            value={token}
            aria-invalid={error !== null}
            aria-describedby={error === null ? ids.note : `${ids.note} ${ids.error}`}
            onChange={(event) => {
              setToken(event.target.value);
            }}
          />
          <span id={ids.note} className="hint">
            {t.ops.login.note}
          </span>
          {error !== null && (
            <span id={ids.error} className="error" role="alert">
              {error}
            </span>
          )}
        </div>
        <button type="submit" className="btn primary" disabled={sending || token.trim() === ''}>
          {sending ? t.ops.login.submitting : t.ops.login.submit}
        </button>
      </form>
    </div>
  );
}
