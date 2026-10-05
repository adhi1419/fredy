/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import {
  getKleinanzeigenWebSession,
  persistKleinanzeigenSessionCookies,
  withKleinanzeigenSession,
} from '../../../lib/services/kleinanzeigen/sessionClient.js';

const store = (credential = { secret: 'SESSION=one; PREF=two', revision: 3 }) => ({
  get: vi.fn().mockResolvedValue(credential),
  rotate: vi.fn().mockResolvedValue(4),
});

describe('Kleinanzeigen encrypted web session', () => {
  it('loads only the owning user credential and attaches it as a Cookie header', async () => {
    const credentialStore = store();
    const session = await getKleinanzeigenWebSession({ userId: 'user-1', credentialStore });

    expect(credentialStore.get).toHaveBeenCalledWith('user-1', 'kleinanzeigen');
    expect(withKleinanzeigenSession(session, { headers: { Accept: 'text/html' } })).toMatchObject({
      headers: { Accept: 'text/html', Cookie: 'SESSION=one; PREF=two' },
    });
  });

  it('discards the Astro experiment cookie from stored and rotated sessions', async () => {
    const credentialStore = store({ secret: 'SESSION=one; __ka_vip-astro-v1=enabled', revision: 3 });
    const session = await getKleinanzeigenWebSession({ userId: 'user-1', credentialStore });

    expect(withKleinanzeigenSession(session)).toMatchObject({ headers: { Cookie: 'SESSION=one' } });

    await persistKleinanzeigenSessionCookies(session, {
      headers: { getSetCookie: () => ['__ka_vip-astro-v1=enabled; Path=/; Secure'] },
    });

    expect(credentialStore.rotate).not.toHaveBeenCalled();
    expect(withKleinanzeigenSession(session)).toMatchObject({ headers: { Cookie: 'SESSION=one' } });
  });

  it('fails closed for a missing owner or credential', async () => {
    await expect(getKleinanzeigenWebSession()).rejects.toMatchObject({ permanent: true, phase: 'authentication' });
    await expect(getKleinanzeigenWebSession({ userId: 'user-1', credentialStore: store(null) })).rejects.toMatchObject({
      phase: 'authentication',
    });
  });

  it('persists provider cookie rotation with the credential revision guard', async () => {
    const credentialStore = store();
    const session = await getKleinanzeigenWebSession({ userId: 'user-1', credentialStore });
    const response = { headers: { getSetCookie: () => ['SESSION=rotated; Path=/; Secure', 'PREF=; Max-Age=0'] } };

    const updated = await persistKleinanzeigenSessionCookies(session, response);

    expect(credentialStore.rotate).toHaveBeenCalledWith({
      userId: 'user-1',
      providerId: 'kleinanzeigen',
      secret: 'SESSION=rotated',
      expectedRevision: 3,
    });
    expect(updated.revision).toBe(4);
  });

  it('does not write when a response carries no changed cookies', async () => {
    const credentialStore = store();
    const session = await getKleinanzeigenWebSession({ userId: 'user-1', credentialStore });

    await persistKleinanzeigenSessionCookies(session, { headers: { getSetCookie: () => [] } });

    expect(credentialStore.rotate).not.toHaveBeenCalled();
  });
});
