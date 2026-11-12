import { useMemo } from 'react';

import { useLocale } from '../../../shared/i18n';
import { formatCityDay, formatCityTime } from '../../../shared/time/city';
import { Icon } from '../../../shared/ui/Icon';
import { merchantApi } from '../api';
import { merchantHref } from '../routes';
import type { MerchantRequest } from '../schemas';
import { useMerchantT } from '../texts';
import { useResource } from '../useResource';
import { Conversation } from '../ui/Conversation';
import { Head } from '../ui/Head';
import { Loaded } from '../ui/Loaded';
import { OfferSummary } from '../ui/OfferSummary';

type Dishes = ReadonlyMap<string, string>;

/** The menu's dish names by id, from "Your agent"; until they arrive an offer names its ids. */
function useDishes(): Dishes {
  const agent = useResource(merchantApi.agent);
  return useMemo(
    () => new Map((agent.data?.menu ?? []).map((item) => [item.id, item.name] as const)),
    [agent.data],
  );
}

function RequestList(props: { requests: readonly MerchantRequest[]; open: string | null }) {
  const t = useMerchantT();
  const locale = useLocale();
  if (props.requests.length === 0) {
    return (
      <div className="mc-empty">
        <p className="mc-empty-title">{t.requests.empty}</p>
        <p>{t.requests.emptyBody}</p>
      </div>
    );
  }
  return (
    <nav aria-label={t.requests.label}>
      <p className="mc-label">{t.requests.count(props.requests.length)}</p>
      <ul className="mc-requests">
        {props.requests.map((request) => (
          <li key={request.threadId}>
            <a
              href={merchantHref.request(request.threadId)}
              aria-current={props.open === request.threadId ? 'true' : undefined}
            >
              <span className="mc-req-time mono">
                {formatCityDay(request.at, locale)} · {formatCityTime(request.at, locale)}
              </span>
              <span className="mc-req-main">
                <b>{request.alias}</b> · {request.craving}
              </span>
              <span className="mc-req-status">{t.requests.thread[request.status]}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function RequestDetail({ threadId, dishes }: { threadId: string; dishes: Dishes }) {
  const t = useMerchantT();
  const request = useResource((signal) => merchantApi.request(threadId, signal));
  return (
    <article className="mc-detail">
      <a className="mc-back link" href={merchantHref.requests}>
        <Icon name="back" />
        {t.requests.back}
      </a>
      <Loaded resource={request}>
        {(data) => (
          <>
            <h2 className="mc-detail-title">
              {data.alias} · {data.craving}
            </h2>
            <OfferSummary offer={data.offer} />
            <Conversation alias={data.alias} entries={data.conversation} dishes={dishes} />
          </>
        )}
      </Loaded>
    </article>
  );
}

/** "Requests": each need Sara brought, and the conversation with this merchant's agent. */
export function RequestsView({ threadId }: { threadId: string | null }) {
  const t = useMerchantT();
  const requests = useResource(merchantApi.requests);
  const dishes = useDishes();
  return (
    <>
      <Head title={t.requests.title} lead={t.requests.lead} receivedAt={requests.receivedAt} />
      <div className="mc-split" data-open={threadId === null ? 'false' : 'true'}>
        <div className="mc-split-list">
          <Loaded resource={requests}>
            {(data) => <RequestList requests={data} open={threadId} />}
          </Loaded>
        </div>
        <div className="mc-split-detail">
          {threadId === null ? (
            <p className="mc-quiet mc-pick-hint">{t.requests.pick}</p>
          ) : (
            <RequestDetail key={threadId} threadId={threadId} dishes={dishes} />
          )}
        </div>
      </div>
    </>
  );
}
