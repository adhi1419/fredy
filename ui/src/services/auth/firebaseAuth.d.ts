/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/* Copyright (c) 2026 by Christian Kellner. */

export interface FirebaseAuthIdentity {
  uid: string;
  email?: string | null;
}

export function signOutFirebase(): Promise<void>;
export function subscribeToAuthState(listener: (user: FirebaseAuthIdentity | null) => void): () => void;
