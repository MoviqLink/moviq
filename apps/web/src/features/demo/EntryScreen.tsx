import { useCallback, useEffect, useRef, useState } from 'react';

import { LangSwitch } from '../../shared/i18n/LangSwitch';
import { Logo } from '../../shared/ui/Logo';
import { Intro } from '../home/intro/Intro';
import { introPending, introPlayed } from '../home/intro/once';
import { demoApi } from './api';
import { useDemoT } from './text';
import { useDemoLogin, type Role } from './useDemoLogin';
import { loginFields } from './loginFields';
import { LOGIN_DURATION_MS } from './loginTimeline';
import './login.css';

function Access({ role, onBack }: { readonly role: Role; readonly onBack: () => void }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <AccessAttempt
      key={attempt}
      role={role}
      onBack={onBack}
      retry={() => {
        setAttempt((n) => n + 1);
      }}
    />
  );
}

function LoginInputs({ fields }: { readonly fields: ReturnType<typeof loginFields> }) {
  const t = useDemoT();
  return (
    <>
      <label htmlFor="demo-user-id">{t.userId}</label>
      <input
        id="demo-user-id"
        type="text"
        autoComplete="off"
        readOnly
        value={fields.userId}
        placeholder="demo"
      />
      <label htmlFor="demo-password">{t.password}</label>
      <input
        id="demo-password"
        type="password"
        autoComplete="off"
        readOnly
        value={fields.password}
      />
    </>
  );
}

function AccessAttempt({
  role,
  onBack,
  retry,
}: {
  readonly role: Role;
  readonly onBack: () => void;
  readonly retry: () => void;
}) {
  const t = useDemoT();
  const heading = useRef<HTMLHeadingElement>(null);
  const login = useDemoLogin(role);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const fields = loginFields(role, login.elapsed);
  return (
    <section className="demo-access" aria-labelledby="demo-access-title">
      <div className="demo-access-logo">
        <Logo />
      </div>
      <h2 id="demo-access-title" ref={heading} tabIndex={-1}>
        {t.signIn}
      </h2>
      <p className="demo-access-note">
        {role === 'traveller' ? t.travellerAccount : t.businessAccount}
      </p>
      <form
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          login.skip();
        }}
      >
        <LoginInputs fields={fields} />
        <p className="demo-access-status" role="status">
          {login.state === 'error' ? (
            t.failed
          ) : login.complete ? (
            <>
              <span className="demo-success" aria-hidden="true">
                ✓
              </span>
              {t.signedIn}
            </>
          ) : (
            t.preparingAccess
          )}
        </p>
        <progress max={LOGIN_DURATION_MS} value={login.elapsed} aria-label={t.preparingAccess} />
        {login.state === 'error' ? (
          <button className="btn primary" type="button" onClick={retry}>
            {t.retry}
          </button>
        ) : (
          !login.complete && (
            <button className="demo-link demo-skip" type="submit">
              {t.skipAnimation}
            </button>
          )
        )}
      </form>
      <p className="demo-access-foot">{t.demoFoot}</p>
      <button className="demo-link" type="button" onClick={onBack}>
        {t.back}
      </button>
    </section>
  );
}

function useDemoStatus() {
  const [enabled, setEnabled] = useState<boolean | 'error' | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void demoApi.status(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setEnabled(data.enabled);
      },
      () => {
        if (!controller.signal.aborted) setEnabled('error');
      },
    );
    return () => {
      controller.abort();
    };
  }, [attempt]);
  return {
    enabled,
    retry: () => {
      setAttempt((n) => n + 1);
    },
  };
}

export function EntryScreen() {
  const t = useDemoT();
  const [intro, setIntro] = useState(introPending);
  const [role, setRole] = useState<Role | null>(null);
  const { enabled, retry } = useDemoStatus();
  const ended = useCallback(() => {
    introPlayed();
    setIntro(false);
  }, []);
  return (
    <main className={intro ? 'demo-entry demo-entry-waiting' : 'demo-entry'} id="main">
      <div className="demo-entry-top">
        <Logo />
        <LangSwitch />
      </div>
      <div
        className={
          role === null ? 'demo-entry-content' : 'demo-entry-content demo-entry-content-access'
        }
      >
        {role === null ? (
          <section>
            <h1>{t.entry}</h1>
            <p>{t.notice}</p>
            <div className="demo-roles">
              <button
                className="btn primary"
                disabled={enabled !== true}
                onClick={() => {
                  setRole('traveller');
                }}
              >
                {t.user}
              </button>
              <button
                className="btn"
                disabled={enabled !== true}
                onClick={() => {
                  setRole('partner');
                }}
              >
                {t.business}
              </button>
            </div>
            {enabled === false && <p role="status">{t.disabled}</p>}
            {enabled === 'error' && (
              <div role="alert">
                <p>{t.failed}</p>
                <button
                  className="btn"
                  onClick={() => {
                    retry();
                  }}
                >
                  {t.retry}
                </button>
              </div>
            )}
            <a href="#/how-it-works">{t.how}</a>
          </section>
        ) : (
          <Access
            key={role}
            role={role}
            onBack={() => {
              setRole(null);
            }}
          />
        )}
      </div>
      {intro && <Intro onDone={ended} />}
    </main>
  );
}
