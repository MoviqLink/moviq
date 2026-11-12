import { useEffect, useState } from 'react';

import { ApiRequestError, type ApiFailure } from '../../../shared/api/errors';
import { Icon } from '../../../shared/ui/Icon';
import { merchantApi } from '../api';
import type { DemoMerchant } from '../schemas';
import { useMerchantT } from '../texts';
import { ProblemNote } from './ProblemNote';

type List =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly merchants: readonly DemoMerchant[] }
  | { readonly status: 'failed'; readonly failure: ApiFailure };

function useMerchants(attempt: number): List {
  const [list, setList] = useState<List>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    merchantApi.merchants(controller.signal).then(
      (merchants) => {
        setList({ status: 'ready', merchants });
      },
      (error: unknown) => {
        if (!(error instanceof ApiRequestError)) throw error;
        if (error.failure.kind !== 'aborted') setList({ status: 'failed', failure: error.failure });
      },
    );
    return () => {
      controller.abort();
    };
  }, [attempt]);
  return list;
}

/** A demo merchant to enter as: its name, kind, stop and buses, all marked demo. */
function MerchantRow(props: { merchant: DemoMerchant; busy: boolean; onEnter: () => void }) {
  const t = useMerchantT();
  const { merchant } = props;
  return (
    <li>
      <button
        type="button"
        className="mc-pick"
        onClick={props.onEnter}
        disabled={props.busy}
        aria-label={t.signIn.enter(merchant.name)}
      >
        <span className="mc-pick-main">
          <span className="mc-pick-name">{merchant.name}</span>
          <span className="mc-demo">{t.demo}</span>
        </span>
        <span className="mc-pick-kind">{t.signIn.kind[merchant.kind]}</span>
        <span className="mc-pick-stop">
          <Icon name="bus" />
          <span>
            {merchant.stop.name} · {t.signIn.lines(merchant.stop.routes.join(', '))} ·{' '}
            {t.signIn.walk(merchant.walkMinutes)}
          </span>
        </span>
        <Icon name="send" className="mc-pick-go" />
      </button>
    </li>
  );
}

/** The access key is held only while signing in, never persisted in browser storage. */
function AccessKey(props: { value: string; onChange: (value: string) => void; invalid: boolean }) {
  const t = useMerchantT();
  return (
    <div className="field">
      <label className="mc-label" htmlFor="merchant-access-key">
        {t.signIn.accessKey}
      </label>
      <input
        id="merchant-access-key"
        type="password"
        autoComplete="current-password"
        maxLength={256}
        value={props.value}
        aria-invalid={props.invalid}
        aria-describedby={
          props.invalid ? 'merchant-key-help merchant-key-error' : 'merchant-key-help'
        }
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
      <p id="merchant-key-help" className="mc-quiet">
        {t.signIn.accessHelp}
      </p>
      {props.invalid && (
        <p id="merchant-key-error" role="alert">
          {t.signIn.invalidKey}
        </p>
      )}
    </div>
  );
}

/** Choosing a demo merchant opens its panel with a demo session (an HttpOnly cookie). */
export function SignIn({ onSignedIn }: { onSignedIn: (merchant: DemoMerchant) => void }) {
  const t = useMerchantT();
  const [attempt, setAttempt] = useState(0);
  const [token, setToken] = useState('');
  const list = useMerchants(attempt);
  const [entering, setEntering] = useState<DemoMerchant | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const enter = (merchant: DemoMerchant) => {
    setEntering(merchant);
    setFailure(null);
    merchantApi.signIn(merchant.id, token).then(
      (opened) => {
        if (opened !== null) {
          setToken('');
          onSignedIn(opened);
        }
      },
      (error: unknown) => {
        if (!(error instanceof ApiRequestError)) throw error;
        setEntering(null);
        setFailure(error.failure);
      },
    );
  };
  return (
    <section className="mc-signin" aria-labelledby="mc-signin-title">
      <h1 id="mc-signin-title">{t.signIn.title}</h1>
      <p className="mc-lead">{t.signIn.lead}</p>
      <AccessKey
        value={token}
        onChange={setToken}
        invalid={failure?.kind === 'http' && failure.status === 401}
      />
      {failure?.kind === 'http' && failure.status === 401 ? null : (
        <ProblemNote failure={failure} />
      )}
      {list.status === 'failed' && (
        <ProblemNote
          failure={list.failure}
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {list.status === 'loading' && <p className="mc-quiet">{t.loading}</p>}
      {list.status === 'ready' && (
        <>
          <h2 className="mc-label">{t.signIn.choose}</h2>
          {list.merchants.length === 0 && <p className="mc-quiet">{t.signIn.none}</p>}
          <ul className="mc-picks">
            {list.merchants.map((merchant) => (
              <MerchantRow
                key={merchant.id}
                merchant={merchant}
                busy={entering !== null || token.length === 0}
                onEnter={() => {
                  enter(merchant);
                }}
              />
            ))}
          </ul>
          {entering !== null && (
            <p className="mc-quiet" role="status">
              {t.signIn.entering(entering.name)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
