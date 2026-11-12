import { useState } from 'react';

import { useLocale } from '../../../shared/i18n';
import { formatMoney } from '../../../shared/journey/money';
import { merchantApi } from '../api';
import { scanResult, type ScanResult } from '../model/counter';
import { useMerchantT } from '../texts';
import { useAction } from '../useAction';
import { useResource } from '../useResource';
import { Camera } from '../ui/Camera';
import { ProblemNote } from '../ui/ProblemNote';
import { Head } from '../ui/Head';
import { Refund } from '../ui/Refund';

/** What the scan did, as the server answered: charged, still confirming, or refused and why. */
function Outcome({ result }: { result: ScanResult }) {
  const t = useMerchantT().scan;
  const locale = useLocale();
  if (result.kind === 'charged') {
    return (
      <div className="mc-outcome mc-tone-accepted" role="status">
        <p className="mc-label">{t.charged}</p>
        <p className="mc-number">{formatMoney(result.amount, locale)}</p>
        <p>{t.handedOver(result.code)}</p>
      </div>
    );
  }
  if (result.kind === 'confirming') {
    return (
      <div className="mc-outcome mc-tone-rejected" role="status">
        <p className="mc-outcome-title">{t.confirming}</p>
        <p>{t.confirmingTodo}</p>
      </div>
    );
  }
  const reason = t.reasons[result.reason];
  return (
    <div className="mc-outcome mc-tone-rejected" role="status">
      <p className="mc-outcome-title">{t.refused}</p>
      <p>{reason.what}</p>
      <p>{reason.todo}</p>
      <p className="mc-note">{t.nothingCharged}</p>
    </div>
  );
}

/** "Scan": the pickup code, by camera or pasted, charges once; and refunds of missing lines. */
export function ScanView() {
  const t = useMerchantT();
  const tickets = useResource(merchantApi.tickets);
  const scan = useAction();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const charge = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    setResult(null);
    void scan
      .run(() => merchantApi.scan(trimmed))
      .then((answer) => {
        if (answer !== undefined) {
          setResult(scanResult(answer));
          tickets.reload();
        }
      });
  };
  return (
    <>
      <Head title={t.scan.title} lead={t.scan.lead} />
      <div className="mc-columns">
        <section className="mc-panel">
          <Camera
            onCode={(read) => {
              setCode(read);
              charge(read);
            }}
          />
          <form
            className="mc-form"
            onSubmit={(event) => {
              event.preventDefault();
              charge(code);
            }}
          >
            <div className="field">
              <label htmlFor="mc-code">{t.scan.code}</label>
              <textarea
                id="mc-code"
                className="mono"
                rows={3}
                value={code}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setCode(event.target.value);
                }}
              />
              <p className="hint">{t.scan.codeHint}</p>
            </div>
            <button
              type="submit"
              className="btn primary"
              disabled={scan.pending || code.trim() === ''}
            >
              {scan.pending ? t.scan.submitting : t.scan.submit}
            </button>
          </form>
          {result !== null && <Outcome result={result} />}
          <ProblemNote failure={scan.failure} />
        </section>
        <section className="mc-panel" aria-labelledby="mc-refund-title">
          <h2 id="mc-refund-title" className="mc-panel-title">
            {t.refund.title}
          </h2>
          <p className="mc-note">{t.refund.lead}</p>
          {tickets.data !== null && <Refund tickets={tickets.data} onDone={tickets.reload} />}
          <ProblemNote failure={tickets.failure} onRetry={tickets.reload} />
        </section>
      </div>
    </>
  );
}
