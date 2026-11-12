import type { ConversationEntry } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { formatCityTime } from '../../../shared/time/city';
import { Icon } from '../../../shared/ui/Icon';
import { conversationSteps, type Step } from '../model/conversation';
import { useMerchantT } from '../texts';

function StepItem({ step }: { step: Step }) {
  const t = useMerchantT();
  const locale = useLocale();
  return (
    <li className={`mc-step mc-from-${step.who} mc-tone-${step.tone}`}>
      <span className="mc-step-node" aria-hidden="true">
        {step.who === 'sara' && <Icon name="ring" />}
        {step.who === 'server' && <Icon name={step.tone === 'rejected' ? 'cross' : 'check'} />}
      </span>
      <div className="mc-step-body">
        <p className="mc-step-who">
          <span>{t.conversation.who[step.who]}</span>
          <span className="mono">{formatCityTime(step.at, locale)}</span>
        </p>
        <p className="mc-step-title">{step.title}</p>
        {step.lines.length > 0 && (
          <ul className="mc-step-lines">
            {step.lines.map((line, index) => (
              <li key={`${String(index)}-${line}`}>{line}</li>
            ))}
          </ul>
        )}
        {step.quoted.map((quote, index) => (
          <q key={`${String(index)}-${quote}`} className="mc-step-quote" lang="en">
            {quote}
          </q>
        ))}
      </div>
    </li>
  );
}

interface Props {
  readonly alias: string;
  readonly entries: readonly ConversationEntry[];
  /** The menu's dish names by id, so an offer reads "Tonkotsu ramen" and not its id. */
  readonly dishes: ReadonlyMap<string, string>;
}

/**
 * "Sara talks to your agent": the conversation on one line, Sara on one side, the merchant's
 * agent on the other and the server's checks on the line itself, in the order they were written.
 * The line ends in the dot ahead: where the conversation stands now.
 */
export function Conversation({ alias, entries, dishes }: Props) {
  const t = useMerchantT();
  const locale = useLocale();
  const steps = conversationSteps(
    entries,
    { t: t.conversation, locale, dishes },
    (status) => t.status[status],
  );
  return (
    <ol className="mc-talk" aria-label={t.conversation.label(alias)}>
      {steps.map((step) => (
        <StepItem key={step.seq} step={step} />
      ))}
    </ol>
  );
}
