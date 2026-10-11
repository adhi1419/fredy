/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React, { useEffect } from 'react';
import type { ReactElement } from 'react';

import loginHero from '../../assets/login_hero.jpg';
import { useLocation, useNavigate } from 'react-router';
import { useActions } from '../../services/state/store';
import { authReady, signOutFirebase } from '../../services/auth/firebaseAuth.js';
import { xhrGet, xhrPost } from '../../services/xhr.js';
import type { FirebaseAuthClient } from '../../services/auth/firebaseAuth.js';

import './login.less';
import { useTranslation } from '../../services/i18n/i18n.jsx';

/** The effects the login screen dispatches. */
interface LoginActions {
  user: { getCurrentUser: () => Promise<void> };
}

/** History state carried by the route guard when it bounces an unauthenticated visitor here. */
interface LoginLocationState {
  from?: { pathname?: string };
}

/** An auth error that may carry a Firebase error code and an HTTP status. */
interface AuthError {
  code?: string;
  status?: number;
}

/**
 * Where a verified Google account stands with this instance. `approved` is on the allowlist;
 * `none` has never asked; `pending` and `declined` are the operator's queue states. `unknown`
 * is the client's own state before the question has been asked.
 */
export type AccessStatus = 'unknown' | 'approved' | 'none' | 'pending' | 'declined';

/** The access status the server reports for the bearer the client already holds. */
async function fetchAccessStatus(): Promise<AccessStatus> {
  const response = await xhrGet('/api/auth/access-request');
  return (response.json as { status: AccessStatus }).status;
}

/** Google sign-in mark (official branding colours; Google's guidelines require the coloured mark). */
function GoogleIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * The sign-in screen: a listing photo beside a paper column that carries the wordmark, the
 * headline and the one Google button. It shares the app's grammar (text wordmark, mono eyebrows,
 * ruled notes, square ink controls) so the first screen and the app read as one product.
 */
export default function Login(): ReactElement {
  const t = useTranslation();
  const actions = useActions<LoginActions>();
  const navigate = useNavigate();
  const location = useLocation();
  const [authClient, setAuthClient] = React.useState<FirebaseAuthClient | null>(null);
  const [authInitError, setAuthInitError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [access, setAccess] = React.useState<AccessStatus>('unknown');
  const [requesting, setRequesting] = React.useState(false);

  useEffect(() => {
    let active = true;

    authReady
      .then((client) => {
        if (!active) return;
        if (!client.enabled) throw new Error('Firebase authentication is disabled');
        setAuthClient(client);
      })
      .catch(() => {
        if (active) setAuthInitError(t('login.firebaseError'));
      });

    return () => {
      active = false;
    };
  }, [actions, t]);

  /** Complete navigation after /api/auth/me has accepted the Firebase bearer token. */
  const completeLogin = async () => {
    await actions.user.getCurrentUser();
    const state = location.state as LoginLocationState | null;
    navigate(state?.from?.pathname || '/dashboard');
  };

  const handleGoogleSignIn = async () => {
    if (pending || !authClient) return;
    setError(null);
    setPending(true);

    try {
      // The auth client and persistence are prepared before this handler runs, so the popup call
      // remains the first awaited operation in the user-gesture chain.
      const result = await authClient.signInWithPopup(authClient.auth, new authClient.GoogleAuthProvider());
      await result.user.getIdToken();
      // Ask where this account stands before touching /me: /me answers a non-allowlisted account
      // with a 403 that signs the Firebase user out again, and the access request needs that token.
      const status = await fetchAccessStatus();
      if (status !== 'approved') {
        setAccess(status);
        setPending(false);
        return;
      }
      await completeLogin();
    } catch (err) {
      const authError = err as AuthError | null;
      console.error('Google sign-in failed:', authError?.code ?? err);
      if (authError?.code === 'auth/popup-closed-by-user' || authError?.code === 'auth/cancelled-popup-request') {
        setPending(false);
        return;
      }
      if (authError?.status === 403) {
        setError(t('login.firebaseNotApproved'));
      } else if (authError?.status === 429) {
        setError(t('login.firebaseRateLimited'));
      } else {
        setError(t('login.firebaseError'));
      }
      setPending(false);
    }
  };

  /** Queue this account for the operator; the server keeps a declined account declined. */
  const handleRequestAccess = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      const response = await xhrPost('/api/auth/access-request', {});
      setAccess((response.json as { status: AccessStatus }).status);
    } catch {
      setError(t('login.firebaseError'));
    } finally {
      setRequesting(false);
    }
  };

  /** Drop the Firebase session so another Google account can be tried. */
  const handleSwitchAccount = async () => {
    await signOutFirebase().catch(() => {});
    setAccess('unknown');
    setError(null);
  };

  const message = error || authInitError;
  const waiting = !authClient && !authInitError;
  const busy = pending || waiting;
  const gated = access === 'none' || access === 'pending' || access === 'declined';

  return (
    <div className="login">
      <div className="login__photo" aria-hidden="true">
        <img src={loginHero} alt="" />
        <div className="login__scrim" />
        <div className="login__caption">
          <span>{t('login.captionLeft')}</span>
          <span>{t('login.captionRight')}</span>
        </div>
      </div>

      <div className="login__form">
        <div className="login__top">
          <span className="login__brand">Fredy</span>
          <span className="login__eyebrow">{t('login.eyebrowTop')}</span>
        </div>

        <div className="login__mid">
          <p className="login__eyebrow login__eyebrow--lead">{t('login.welcome')}</p>
          <h1 className="login__headline">{t('login.headline')}</h1>
          <p className="login__lede">{t('login.lede')}</p>

          <div className="login__actions">
            {message && (
              <p className="login__note login__note--error" role="alert">
                <b>{t('login.errorLead')}</b> {message}
              </p>
            )}
            {gated ? (
              <>
                <p className="login__note login__note--notice" role="status">
                  <b>{t(`login.access.${access}Lead`)}</b> {t(`login.access.${access}`)}
                </p>
                {access === 'none' && (
                  <button
                    type="button"
                    className="login__submit"
                    onClick={handleRequestAccess}
                    disabled={requesting}
                    aria-busy={requesting || undefined}
                  >
                    {requesting && <span className="login__spinner" aria-hidden="true" />}
                    {t('login.access.request')}
                  </button>
                )}
                <button type="button" className="login__submit login__submit--ghost" onClick={handleSwitchAccount}>
                  {t('login.access.switchAccount')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="login__submit"
                onClick={handleGoogleSignIn}
                disabled={busy || !!authInitError}
                aria-busy={busy || undefined}
              >
                {busy ? (
                  <span className="login__spinner" aria-hidden="true" />
                ) : (
                  <span className="login__g">
                    <GoogleIcon />
                  </span>
                )}
                {pending ? t('login.firebaseSigningIn') : t('login.firebaseGoogleButton')}
              </button>
            )}
          </div>
        </div>

        <div className="login__bottom">
          <span className="login__fine">
            {t('login.creditsRoutes')}{' '}
            <a href="https://transitous.org/" target="_blank" rel="noreferrer">
              Transitous
            </a>{' '}
            · {t('login.creditsMap')}{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap
            </a>
          </span>
          <span className="login__fine">
            {t('footer.originalProjectBy')}{' '}
            <a href="https://github.com/orangecoding" target="_blank" rel="noreferrer">
              Christian Kellner
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}

Login.displayName = 'Login';
