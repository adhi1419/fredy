/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { IconUser } from '@douyinfe/semi-icons';
import { useNavigate } from 'react-router';
import { useActions } from '../../services/state/store';
import { signOutFirebase } from '../../services/auth/firebaseAuth.js';

const Logout = function Logout({ text }) {
  const navigate = useNavigate();
  const actions = useActions();

  const handleLogout = async () => {
    try {
      await signOutFirebase();
    } finally {
      actions.user.resetCurrentUser();
      navigate('/login', { replace: true });
    }
  };

  return (
    <button
      type="button"
      className={`navigate__logout-btn${!text ? ' navigate__logout-btn--icon-only' : ''}`}
      onClick={handleLogout}
    >
      <IconUser size="default" />
      {text && 'Logout'}
    </button>
  );
};

export default Logout;
