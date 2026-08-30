/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React, { useEffect, useId } from 'react';

import cityBackground from '../../assets/city_background.jpg';
import Logo from '../../components/logo/Logo';
import { xhrGet, xhrPost } from '../../services/xhr';
import { useLocation, useNavigate } from 'react-router';
import { useActions, useSelector } from '../../services/state/store';
import { Input, Button, Banner, Spin } from '@douyinfe/semi-ui-19';

import './login.less';
import { IconUser, IconLock, IconAlertTriangle } from '@douyinfe/semi-icons';
import { useTranslation } from '../../services/i18n/i18n.jsx';

/**
 * Reads the caps lock state from a keyboard event, if the browser reports it.
 * @param {React.KeyboardEvent} event
 * @returns {boolean|null} true/false when known, null when the event carries no modifier state
 */
function readCapsLockState(event) {
  const nativeEvent = event?.nativeEvent ?? event;
  if (typeof nativeEvent?.getModifierState !== 'function') {
    return null;
  }
  return nativeEvent.getModifierState('CapsLock');
}

/**
 * Google sign-in SVG icon (official branding colors).
 * Inlined to avoid an external asset dependency.
 */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" style={{ marginRight: 8, verticalAlign: 'middle' }}>
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

export default function Login() {
  const t = useTranslation();
  const actions = useActions();
  const [username, setUserName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(null);
  const [pending, setPending] = React.useState(false);
  const [capsLockOn, setCapsLockOn] = React.useState(false);
  const demoMode = useSelector((state) => state.demoMode.demoMode || false);
  const navigate = useNavigate();
  const location = useLocation();
  const usernameId = useId();
  const passwordId = useId();
  const capsLockHintId = useId();

  // Firebase auth mode state
  const [authMode, setAuthMode] = React.useState(null); // null = loading, 'password' | 'firebase'
  // Firebase auth handle, initialized on mount (NOT in the click handler):
  // signInWithPopup must run inside the user-gesture chain, and awaiting the
  // SDK import + init first makes Firefox's popup blocker kill the popup
  // silently. Holds { auth, signInWithPopup, GoogleAuthProvider } when ready.
  const [firebaseAuth, setFirebaseAuth] = React.useState(null);

  useEffect(() => {
    async function init() {
      await actions.demoMode.getDemoMode();

      // Fetch auth mode from backend
      try {
        const { json } = await xhrGet('/api/login/firebase/config');
        if (json.enabled && json.firebaseConfig) {
          setAuthMode('firebase');
          // Pre-load and pre-initialize the SDK now so the click handler can
          // open the popup with no awaits before it. Still lazy for
          // password-mode users: this only runs when firebase is enabled.
          const [{ initializeApp }, { getAuth, signInWithPopup, GoogleAuthProvider }] = await Promise.all([
            import('firebase/app'),
            import('firebase/auth'),
          ]);
          const app = initializeApp(json.firebaseConfig);
          setFirebaseAuth({ auth: getAuth(app), signInWithPopup, GoogleAuthProvider });
        } else {
          setAuthMode('password');
        }
      } catch {
        // If the endpoint fails or doesn't exist, fall back to password mode
        setAuthMode('password');
      }
    }

    init();
  }, []);

  /**
   * Post-login navigation logic — shared by both password and Firebase flows.
   */
  const completeLogin = async () => {
    await actions.user.getCurrentUser();
    const returnTo = new URLSearchParams(location.search).get('returnTo');
    // OAuth passes a server-relative authorization URL. Restrict this hand-off so the login
    // screen cannot be used as an open redirect.
    if (typeof returnTo === 'string' && returnTo.startsWith('/api/oauth/authorize?')) {
      window.location.assign(returnTo);
      return;
    }
    navigate(location.state?.from?.pathname || '/dashboard');
  };

  // ---------- Password login flow (unchanged) ----------

  const tryLogin = async () => {
    if (pending) {
      return;
    }
    if (!username?.trim() || !password) {
      setError(t('login.errorMandatory'));
      return;
    }
    setError(null);
    setPending(true);

    try {
      await xhrPost('/api/login', {
        username: username.trim(),
        password,
      });
      /* eslint-disable no-unused-vars */
    } catch (ignored) {
      setError(t('login.errorInvalid'));
      setPending(false);
      return;
    }

    await completeLogin();
  };

  /** @param {React.KeyboardEvent} e */
  const submitOnEnter = async (e) => {
    if (e.key === 'Enter') {
      await tryLogin();
    }
  };

  /** @param {React.KeyboardEvent} e */
  const trackCapsLock = (e) => {
    const state = readCapsLockState(e);
    if (state !== null) {
      setCapsLockOn(state);
    }
  };

  // ---------- Firebase Google sign-in flow ----------

  const handleGoogleSignIn = async () => {
    if (pending) return;
    if (!firebaseAuth) {
      // SDK still loading (or failed to load) — treat as a transient error.
      setError(t('login.errorGeneric'));
      return;
    }
    setError(null);
    setPending(true);

    try {
      // FIRST await must be the popup call itself: anything awaited before it
      // breaks the user-gesture chain and gets the popup blocked.
      const { auth, signInWithPopup, GoogleAuthProvider } = firebaseAuth;
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await result.user.getIdToken();

      // Exchange the Firebase token for a Fredy session cookie
      await xhrPost('/api/login/firebase', { idToken });

      await completeLogin();
    } catch (err) {
      // User closed the popup or Firebase SDK error
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        setPending(false);
        return;
      }

      // Backend errors from POST /api/login/firebase
      if (err?.status === 403) {
        setError(t('login.firebaseNotApproved'));
      } else if (err?.status === 429) {
        setError(t('login.firebaseRateLimited'));
      } else {
        setError(t('login.firebaseError'));
      }
      setPending(false);
    }
  };

  // ---------- Render ----------

  // While determining auth mode, show a minimal loading state
  if (authMode === null) {
    return (
      <div className="login">
        <div className="login__bgImage" style={{ backgroundImage: `url("${cityBackground}")` }} />
        <div className="login__glow" />
        <div className="login__loginWrapper">
          <div className="login__scanLine" aria-hidden="true" />
          <div className="login__logoWrapper">
            <Logo width={250} white />
          </div>
          <Spin size="large" />
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="login__bgImage" style={{ backgroundImage: `url("${cityBackground}")` }} />
      <div className="login__glow" />
      <div className="login__loginWrapper">
        <div className="login__scanLine" aria-hidden="true" />
        <div className="login__logoWrapper">
          <Logo width={250} white />
        </div>

        {demoMode && (
          <Banner
            fullMode={true}
            type="info"
            bordered
            closeIcon={null}
            description={t('login.demoBanner')}
            style={{ marginBottom: '1.5rem' }}
          />
        )}

        {error && <Banner type="danger" closeIcon={null} description={error} style={{ marginBottom: '1rem' }} />}

        {authMode === 'firebase' ? (
          <Button
            block
            type="primary"
            onClick={handleGoogleSignIn}
            theme="solid"
            loading={pending}
            icon={!pending ? <GoogleIcon /> : undefined}
            className="login__submit"
            style={{ marginTop: '1rem' }}
          >
            {pending ? t('login.firebaseSigningIn') : t('login.firebaseGoogleButton')}
          </Button>
        ) : (
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="login__inputGroup login__inputGroup--first">
              <label className="login__label" htmlFor={usernameId}>
                {t('login.usernameLabel')}
              </label>
              <Input
                id={usernameId}
                size="large"
                prefix={<IconUser />}
                value={username}
                showClear
                autoFocus
                onChange={(value) => setUserName(value)}
                onKeyUp={trackCapsLock}
                onKeyPress={submitOnEnter}
              />
            </div>

            <div className="login__inputGroup login__inputGroup--second">
              <label className="login__label" htmlFor={passwordId}>
                {t('login.passwordLabel')}
              </label>
              <Input
                id={passwordId}
                size="large"
                mode="password"
                prefix={<IconLock />}
                value={password}
                aria-describedby={capsLockOn ? capsLockHintId : undefined}
                onChange={(value) => setPassword(value)}
                onKeyUp={trackCapsLock}
                onBlur={() => setCapsLockOn(false)}
                onKeyPress={submitOnEnter}
              />
              {capsLockOn && (
                <div className="login__capsHint" id={capsLockHintId} role="status">
                  <IconAlertTriangle size="small" />
                  {t('login.capsLockHint')}
                </div>
              )}
            </div>

            <Button
              block
              type="primary"
              onClick={tryLogin}
              theme="solid"
              loading={pending}
              className="login__submit"
              style={{ marginTop: '1rem' }}
            >
              {pending ? t('login.loginButtonPending') : t('login.loginButton')}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

Login.displayName = 'Login';
