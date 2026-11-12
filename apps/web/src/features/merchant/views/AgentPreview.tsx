import { useLocale } from '../../../shared/i18n';
import { formatMoney } from '../../../shared/journey/money';
import { formatCityTime } from '../../../shared/time/city';
import { merchantApi } from '../api';
import { preferenceTags } from '../model/conversation';
import { lineText } from '../model/counter';
import type { AgentPreview as AgentPreviewAnswer, PreviewCase } from '../schemas';
import { useMerchantT } from '../texts';
import { useResource } from '../useResource';
import { Loaded } from '../ui/Loaded';

/** What the server's check said of one example offer, and its numbers on the right. */
function Verdict({ outcome }: { outcome: PreviewCase['outcome'] }) {
  const t = useMerchantT();
  const locale = useLocale();
  if (outcome.kind === 'nothing') {
    return (
      <div className="mc-preview-offer">
        <p className="mc-preview-verdict mc-tone-closed">{t.preview.nothing}</p>
        <p className="mc-note">{t.preview.nothingTodo}</p>
      </div>
    );
  }
  const accepted = outcome.kind === 'accepted';
  return (
    <>
      <div className="mc-preview-offer">
        <ul className="mc-preview-lines" lang="en">
          {outcome.lines.map((line, index) => (
            <li key={index}>{lineText(line)}</li>
          ))}
        </ul>
        <p className={`mc-preview-verdict ${accepted ? 'mc-tone-accepted' : 'mc-tone-rejected'}`}>
          {accepted ? t.preview.accepted : t.preview.rejected}
          {outcome.kind === 'rejected' &&
            `: ${outcome.refusals.map((r) => t.conversation.refusal[r.reason]).join('; ')}`}
        </p>
      </div>
      <div className="mc-preview-numbers">
        {accepted && (
          <>
            <p className="mono mc-preview-price">{formatMoney(outcome.reward.price, locale)}</p>
            <p className="mono mc-note">{t.preview.reward(outcome.reward.percent)}</p>
          </>
        )}
        <p className="mono mc-note">{t.preview.ready(formatCityTime(outcome.pickupAt, locale))}</p>
      </div>
    </>
  );
}

function Case({ item }: { item: PreviewCase }) {
  const t = useMerchantT();
  const tags = preferenceTags(item.preferences, t.conversation);
  return (
    <li className="mc-preview-case">
      <span className="mc-preview-node" aria-hidden="true" />
      <div className="mc-preview-who">
        <p>
          <b>{item.alias}</b> <span className="mc-demo">{t.preview.exampleMark}</span>
        </p>
        <p className="mc-note">{tags.length === 0 ? t.preview.noTags : tags.join(' · ')}</p>
        <p className="mc-note">{t.preview.asks(item.craving)}</p>
      </div>
      <Verdict outcome={item.outcome} />
    </li>
  );
}

/** The example customers, each with what the rules composed and the server's check. */
export function PreviewCases({ preview }: { preview: AgentPreviewAnswer }) {
  const t = useMerchantT();
  const locale = useLocale();
  return (
    <>
      <ol className="mc-preview" aria-label={t.preview.label}>
        {preview.cases.map((item) => (
          <Case key={item.example} item={item} />
        ))}
      </ol>
      <p className="mc-note mono">
        {t.preview.composedAt(formatCityTime(preview.composedAt, locale))}
      </p>
    </>
  );
}

/** F-J9-09: what the agent's rules compose now for three example customers; saved nowhere. */
export function AgentPreview() {
  const t = useMerchantT();
  const preview = useResource(merchantApi.preview);
  return (
    <section className="mc-panel" aria-labelledby="mc-preview-title">
      <div className="mc-preview-head">
        <div>
          <h2 id="mc-preview-title" className="mc-panel-title">
            {t.preview.title}
          </h2>
          <p className="mc-note">{t.preview.lead}</p>
        </div>
        <button
          type="button"
          className="btn small"
          onClick={preview.reload}
          disabled={preview.loading}
        >
          {preview.loading ? t.preview.composing : t.preview.again}
        </button>
      </div>
      <Loaded resource={preview}>{(composed) => <PreviewCases preview={composed} />}</Loaded>
    </section>
  );
}
