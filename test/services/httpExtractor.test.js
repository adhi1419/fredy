/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/services/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { default: fetchHtml, BROWSER_HEADERS } = await import('../../lib/services/extractor/httpExtractor.js');

const respond = (status, body) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => body }));

afterEach(() => vi.unstubAllGlobals());

describe('httpExtractor', () => {
  it('returns the page and sends browser-like German headers', async () => {
    const fetchMock = respond(200, '<html>ok</html>');
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHtml('https://example.org/a', { headers: { Referer: 'x' } })).resolves.toBe('<html>ok</html>');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({ ...BROWSER_HEADERS, Referer: 'x' });
    expect(init.headers['Accept-Language']).toMatch(/^de-DE/);
  });

  it('answers null for a bot wall, a non-2xx answer and a network error, never throwing', async () => {
    vi.stubGlobal('fetch', respond(403, 'Forbidden'));
    await expect(fetchHtml('https://example.org/a')).resolves.toBeNull();

    vi.stubGlobal('fetch', respond(200, '<h1>Please verify you are human</h1>'));
    await expect(fetchHtml('https://example.org/a')).resolves.toBeNull();

    vi.stubGlobal('fetch', respond(500, 'oops'));
    await expect(fetchHtml('https://example.org/a')).resolves.toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );
    await expect(fetchHtml('https://example.org/a')).resolves.toBeNull();
  });
});
