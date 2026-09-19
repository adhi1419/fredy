/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React, { useEffect } from 'react';

import cityBackground from '../../assets/city_background.jpg';
import Logo from '../../components/logo/Logo';
import { useLocation, useNavigate } from 'react-router';
import { useActions, useSelector } from '../../services/state/store';
import { Button, Banner, Spin } from '@douyinfe/semi-ui-19';
import { authReady } from '../../services/auth/firebaseAuth.js';

import './login.less';
import { useTranslation } from '../../services/i18n/i18n.jsx';

/** Google sign-in SVG icon (official branding colors). */
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
  const demoMode = useSelector((state) => state.demoMode.demoMode || false);
  const navigate = useNavigate();
  const location = useLocation();
  const [authClient, setAuthClient] = React.useState(null);
  const [authInitError, setAuthInitError] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [pending, setPending] = React.useState(false);

  useEffect(() => {
    let active = true;
    actions.demoMode.getDemoMode();

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
    navigate(location.state?.from?.pathname || '/dashboard');
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
      await completeLogin();
    } catch (err) {
      console.error('Google sign-in failed:', err?.code ?? err);
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        setPending(false);
        return;
      }
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

        {(error || authInitError) && (
          <Banner
            type="danger"
            closeIcon={null}
            description={error || authInitError}
            style={{ marginBottom: '1rem' }}
          />
        )}

        {!authClient && !authInitError ? (
          <Spin size="large" />
        ) : (
          <Button
            block
            type="primary"
            onClick={handleGoogleSignIn}
            theme="solid"
            loading={pending}
            disabled={!authClient || !!authInitError}
            icon={!pending ? <GoogleIcon /> : undefined}
            className="login__submit"
            style={{ marginTop: '1rem' }}
          >
            {pending ? t('login.firebaseSigningIn') : t('login.firebaseGoogleButton')}
          </Button>
        )}
      </div>
    </div>
  );
}

Login.displayName = 'Login';
