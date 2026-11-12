import { Component, type ErrorInfo, type ReactNode } from 'react';

import { useT } from '../shared/i18n';

function Crash() {
  const t = useT().app;
  return (
    <div className="crash" role="alert">
      <h1>{t.crashTitle}</h1>
      <p className="muted">{t.crashBody}</p>
      <button
        type="button"
        className="btn primary"
        onClick={() => {
          window.location.reload();
        }}
      >
        {t.reload}
      </button>
    </div>
  );
}

interface State {
  readonly failed: boolean;
}

/** Catches a screen that fails while drawing and says so, instead of leaving the page blank. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The browser console is the only log a static page has.
    reportError(Object.assign(error, { componentStack: info.componentStack }));
  }

  override render(): ReactNode {
    return this.state.failed ? <Crash /> : this.props.children;
  }
}
