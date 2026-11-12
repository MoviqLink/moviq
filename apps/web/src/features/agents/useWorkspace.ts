import type { AgentDetail } from '@moviq/contracts';
import { useEffect, useState } from 'react';
import { agentsApi } from './api';

const REFRESH_MS = 30_000;

/** Sara's conversation and watches, refreshed every 30 s while the screen is open. */
export function useWorkspace() {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const start = async () => {
      const { agents } = await agentsApi.list();
      const sara = agents.find((agent) => agent.primary) ?? agents[0];
      if (sara === undefined) throw new Error('No assistant available');
      const refresh = async () => {
        const value = await agentsApi.detail(sara.id);
        if (active) {
          setDetail(value);
          setFailed(false);
        }
      };
      await refresh();
      if (!active) return;
      timer = window.setInterval(() => {
        refresh().catch(() => {
          if (active) setFailed(true);
        });
      }, REFRESH_MS);
    };
    start().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [attempt]);
  const change = (value: AgentDetail) => {
    setDetail((current) =>
      current === null || current.agent.id === value.agent.id ? value : current,
    );
  };
  const retry = () => {
    setAttempt((count) => count + 1);
  };
  return { detail, failed, change, retry };
}
