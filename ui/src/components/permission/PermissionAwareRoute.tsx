/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Navigate } from 'react-router';
import type { ReactNode } from 'react';

interface PermissionAwareRouteProps {
  currentUser?: { isAdmin?: boolean } | null;
  children: ReactNode;
}

export default function PermissionAwareRoute({ currentUser, children }: PermissionAwareRouteProps) {
  const isAdmin = currentUser != null && currentUser.isAdmin;
  return isAdmin ? children : <Navigate to="/403" replace />;
}
