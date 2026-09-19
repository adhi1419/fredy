/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedRequestPolicy,
  dispatchHttpUnauthorized,
  headersWithBearer,
} from '../../ui/src/services/authenticatedTransport.js';

describe('authenticated request policy', () => {
  it('resolves API URLs and builds an authenticated cookie-free request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    const tokenGetter = vi.fn().mockResolvedValue('policy-token');
    const policy = createAuthenticatedRequestPolicy({
      apiBaseUrl: 'https://fredy.example.run.app/',
      fetchImpl,
      tokenGetter,
    });

    await policy.request('/api/jobs', { headers: { Accept: 'application/json' } });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://fredy.example.run.app/api/jobs');
    expect(tokenGetter).toHaveBeenCalledWith(false);
    expect(options.credentials).toBe('omit');
    expect(options.headers.get('Authorization')).toBe('Bearer policy-token');
    expect(options.headers.get('Accept')).toBe('application/json');
  });

  it('forces token refresh on a reconnecting request without touching cookies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    const tokenGetter = vi.fn().mockResolvedValueOnce('initial').mockResolvedValueOnce('refreshed');
    const policy = createAuthenticatedRequestPolicy({ fetchImpl, tokenGetter });

    await policy.request('/api/jobs/events', { headers: { Accept: 'text/event-stream' } }, false);
    await policy.request('/api/jobs/events', { headers: { Accept: 'text/event-stream' } }, true);

    expect(tokenGetter).toHaveBeenNthCalledWith(1, false);
    expect(tokenGetter).toHaveBeenNthCalledWith(2, true);
    expect(fetchImpl.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer initial');
    expect(fetchImpl.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer refreshed');
    expect(fetchImpl.mock.calls[1][1].credentials).toBe('omit');
  });

  it('keeps public bootstrap requests free of cookies and authorization', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    const policy = createAuthenticatedRequestPolicy({ fetchImpl });

    await policy.publicRequest('/api/auth/config', { headers: { Authorization: 'stale' } });

    const [, options] = fetchImpl.mock.calls[0];
    expect(options.credentials).toBe('omit');
    expect(options.headers.has('Authorization')).toBe(false);
  });

  it('applies distinct HTTP and SSE unauthorized rules and dispatches the stable event', () => {
    const eventTypes = [];
    const eventTarget = {
      dispatchEvent: vi.fn((event) => {
        eventTypes.push(event.type);
        return true;
      }),
    };
    const policy = createAuthenticatedRequestPolicy({ eventTarget });

    expect(dispatchHttpUnauthorized(401, undefined, eventTarget)).toBe(true);
    expect(dispatchHttpUnauthorized(403, 'not allowed', eventTarget)).toBe(true);
    expect(dispatchHttpUnauthorized(403, 'forbidden', eventTarget)).toBe(false);
    expect(policy.handleSse(403)).toBe(true);
    expect(policy.handleSse(404)).toBe(false);
    expect(eventTypes).toEqual(['fredy:unauthorized', 'fredy:unauthorized', 'fredy:unauthorized']);
  });

  it('does not mutate caller headers when adding the bearer', () => {
    const original = new Headers({ Authorization: 'old', Accept: 'application/json' });
    const result = headersWithBearer(original, 'new');
    expect(original.get('Authorization')).toBe('old');
    expect(result.get('Authorization')).toBe('Bearer new');
  });
});
