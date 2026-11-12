import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiRequestError, type ApiFailure } from '../../shared/api/errors';
import { merchantApi } from './api';
import { parseMerchantPath, sectionOf } from './routes';
import type { DemoMerchant } from './schemas';
import { MerchantSessionContext, type MerchantSession } from './session';
import { useMerchantT } from './texts';
import { ProblemNote } from './ui/ProblemNote';
import { Shell } from './ui/Shell';
import { SignIn } from './ui/SignIn';
import { Screen } from './views/Screen';
import './merchant.css';
import './screens.css';
import './talk.css';
import './counter.css';

type Gate =
  | { readonly status: 'checking' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly merchant: DemoMerchant }
  | { readonly status: 'unreachable'; readonly failure: ApiFailure };

/** Asks the API whether a demo session is open, again each time `attempt` changes. */
function useGate(attempt: number): [Gate, (gate: Gate) => void] {
  const [gate, setGate] = useState<Gate>({ status: 'checking' });
  useEffect(() => {
    const controller = new AbortController();
    merchantApi.session(controller.signal).then(
      (merchant) => {
        setGate(merchant === null ? { status: 'signed-out' } : { status: 'signed-in', merchant });
      },
      (error: unknown) => {
        if (!(error instanceof ApiRequestError)) throw error;
        if (error.failure.kind !== 'aborted') {
          setGate({ status: 'unreachable', failure: error.failure });
        }
      },
    );
    return () => {
      controller.abort();
    };
  }, [attempt]);
  return [gate, setGate];
}

/**
 * The merchant panel (`#/merchant/…`): every merchant is a demo, chosen on entry, with a demo
 * session the server keeps in an HttpOnly cookie. Outside the traveller's navigation.
 */
export function MerchantApp({ segments }: { segments: readonly string[] }) {
  const t = useMerchantT();
  const [attempt, setAttempt] = useState(0);
  const [gate, setGate] = useGate(attempt);
  const expire = useCallback(() => {
    setGate({ status: 'signed-out' });
  }, [setGate]);
  const session = useMemo<MerchantSession | null>(
    () => (gate.status === 'signed-in' ? { merchant: gate.merchant, expire } : null),
    [gate, expire],
  );
  const route = parseMerchantPath(segments);
  const signOut = () => {
    merchantApi.signOut().then(expire, expire);
  };
  return (
    <Shell
      merchant={session?.merchant ?? null}
      current={session === null ? null : sectionOf(route)}
      onSignOut={signOut}
    >
      {gate.status === 'checking' && <p className="mc-quiet">{t.checking}</p>}
      {gate.status === 'unreachable' && (
        <ProblemNote
          failure={gate.failure}
          onRetry={() => {
            setGate({ status: 'checking' });
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {gate.status === 'signed-out' && (
        <SignIn
          onSignedIn={(merchant) => {
            setGate({ status: 'signed-in', merchant });
          }}
        />
      )}
      {session !== null && (
        <MerchantSessionContext value={session}>
          <Screen route={route} />
        </MerchantSessionContext>
      )}
    </Shell>
  );
}
