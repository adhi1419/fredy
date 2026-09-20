/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../ui/src/services/auth/firebaseAuth.js', () => ({ getIdToken: vi.fn() }));

import { authenticatedFetch, headersWithBearer, publicFetch } from '../../ui/src/services/authenticatedFetch.js';

describe('authenticatedFetch', () => {
  it('adds the current Firebase ID token and omits cookies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    const tokenGetter = vi.fn().mockResolvedValue('fresh-token');

    await authenticatedFetch('/api/jobs', { headers: { Accept: 'application/json' } }, { fetchImpl, tokenGetter });

    const [, options] = fetchImpl.mock.calls[0];
    expect(tokenGetter).toHaveBeenCalledWith(false);
    expect(options.credentials).toBe('omit');
    expect(options.headers.get('Authorization')).toBe('Bearer fresh-token');
    expect(options.headers.get('Accept')).toBe('application/json');
  });

  it('does not mutate caller headers', () => {
    const original = new Headers({ Authorization: 'old', Accept: 'application/json' });
    const result = headersWithBearer(original, 'new');
    expect(original.get('Authorization')).toBe('old');
    expect(result.get('Authorization')).toBe('Bearer new');
  });

  it('keeps public bootstrap requests free of cookies and authorization', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    await publicFetch('/api/auth/config', { headers: { Authorization: 'stale' } }, fetchImpl);
    const [, options] = fetchImpl.mock.calls[0];
    expect(options.credentials).toBe('omit');
    expect(options.headers.has('Authorization')).toBe(false);
  });
});
