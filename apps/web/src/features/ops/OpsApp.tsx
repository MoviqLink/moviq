import type { OpsSession } from '@moviq/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiRequestError, type ApiFailure } from '../../shared/api/errors';
import { useT } from '../../shared/i18n';
import { opsApi } from './api';
import { parseOpsPath } from './routes';
import { SessionContext, type SessionValue } from './session';
import { ConnectionNotice } from './ui/ConnectionNotice';
import { Shell } from './ui/Shell';
import { LoginView } from './views/LoginView';
import { Screen } from './views/Screen';

type Gate =
  | { readonly status: 'checking' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly session: OpsSession }
  | { readonly status: 'unreachable'; readonly failure: ApiFailure }
  | { readonly status: 'crashed'; readonly error: unknown };

/** Asks the API whether a session is open, again each time `attempt` changes. */
function useGate(attempt: number): [Gate, (gate: Gate) => void] {
  const [gate, setGate] = useState<Gate>({ status: 'checking' });
  useEffect(() => {
    const controller = new AbortController();
    opsApi.session(controller.signal).then(
      (session) => {
        setGate(session === null ? { status: 'signed-out' } : { status: 'signed-in', session });
      },
      (error: unknown) => {
        if (!(error instanceof ApiRequestError)) setGate({ status: 'crashed', error });
        else if (error.failure.kind !== 'aborted') {
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

/** The control room: a private area that opens only with a server session. */
export function OpsApp({ segments }: { segments: readonly string[] }) {
  const t = useT();
  const [attempt, setAttempt] = useState(0);
  const [gate, setGate] = useGate(attempt);
  const recheck = useCallback(() => {
    setGate({ status: 'checking' });
    setAttempt((n) => n + 1);
  }, [setGate]);
  const expire = useCallback(() => {
    setGate({ status: 'signed-out' });
  }, [setGate]);
  const value = useMemo<SessionValue | null>(
    () => (gate.status === 'signed-in' ? { session: gate.session, expire } : null),
    [gate, expire],
  );
  const signOut = () => {
    opsApi.signOut().then(expire, expire);
  };
  const route = parseOpsPath(segments);
  // A programming error reaches the error boundary instead of leaving the screen blank.
  if (gate.status === 'crashed') throw gate.error;

  return (
    <Shell route={value === null ? null : route} session={value} onSignOut={signOut}>
      {gate.status === 'checking' && <p className="quiet">{t.ops.login.checking}</p>}
      {gate.status === 'unreachable' && (
        <ConnectionNotice
          resource={{
            data: null,
            receivedAt: null,
            failure: gate.failure,
            loading: false,
            reload: recheck,
          }}
        />
      )}
      {gate.status === 'signed-out' && <LoginView onSignedIn={recheck} />}
      {value !== null && (
        <SessionContext value={value}>
          <Screen route={route} />
        </SessionContext>
      )}
    </Shell>
  );
}
