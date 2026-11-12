import { useState } from 'react';

import { merchantApi } from '../api';
import { useMerchantT } from '../texts';
import { useResource } from '../useResource';
import { Head } from '../ui/Head';
import { Loaded } from '../ui/Loaded';
import { AgentForm } from './AgentForm';
import { AgentKitchen } from './AgentKitchen';
import { AgentPreview } from './AgentPreview';
import { AgentTalk } from './AgentTalk';

/**
 * "Your agent": the program's minimum, the rules and opening hours the agent follows, the talk
 * with the agent, what its rules compose now, and what the kitchen allows. A new version, saved
 * from the form or confirmed in the talk, opens the form and the preview on it.
 */
export function AgentView() {
  const t = useMerchantT().agent;
  const agent = useResource(merchantApi.agent);
  const [said, setSaid] = useState<string | null>(null);
  const saved = (text: string) => {
    setSaid(text);
    agent.reload();
  };
  return (
    <>
      <Head title={t.title} lead={t.lead} />
      <Loaded resource={agent}>
        {(setup) => (
          <div className="mc-stack">
            <section className="mc-hero mc-hero-row" aria-label={t.minimumLabel}>
              <p className="mc-label">{t.minimumLabel}</p>
              <p className="mc-number">{t.minimum(setup.minRewardPercent)}</p>
              <p className="mc-note">{t.minimumNote}</p>
            </section>
            <div className="mc-columns">
              <AgentForm key={setup.version} setup={setup} said={said} onSaved={saved} />
              <div className="mc-stack">
                <AgentTalk setup={setup} onSaved={saved} />
                <AgentPreview key={setup.version} />
                <AgentKitchen menu={setup.menu} />
              </div>
            </div>
          </div>
        )}
      </Loaded>
    </>
  );
}
