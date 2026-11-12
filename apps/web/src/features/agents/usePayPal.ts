import type { TicketAutopay } from '@moviq/contracts';
import { useEffect, useState } from 'react';
import { ticketsApi } from '../tickets/api';

export type PayPalReturn = 'connected' | 'failed' | null;

/** What PayPal sent back in `#/agents?autopay=…`, read once when the screen opens. */
function readReturn(): PayPalReturn {
  const query = window.location.hash.split('?')[1] ?? '';
  const value = new URLSearchParams(query).get('autopay');
  return value === 'connected' || value === 'failed' ? value : null;
}

/** Whether Sara may buy with PayPal, and the actions that change it. */
export function usePayPal() {
  const [state, setState] = useState<TicketAutopay | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [returned] = useState<PayPalReturn>(readReturn);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (returned !== null) window.history.replaceState(null, '', '#/agents');
  }, [returned]);
  useEffect(() => {
    const controller = new AbortController();
    ticketsApi
      .autopay(controller.signal)
      .then((value) => {
        setState(value);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, [attempt]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return {
    state,
    failed,
    busy,
    returned,
    retry: () => {
      setAttempt((count) => count + 1);
    },
    setEnabled: (enabled: boolean) =>
      run(async () => {
        setState(await ticketsApi.setAutopayEnabled(enabled));
      }),
    connect: () =>
      run(async () => {
        const { approvalUrl } = await ticketsApi.connectAutopay();
        window.location.assign(approvalUrl);
      }),
    disconnect: () =>
      run(async () => {
        setState(await ticketsApi.disconnectAutopay());
      }),
  };
}

export type PayPal = ReturnType<typeof usePayPal>;
