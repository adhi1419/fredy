/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import type { SseEvent } from '../../ui/src/services/sse/authenticatedEventStream.js';

vi.mock('../../ui/src/services/auth/firebaseAuth.js', () => ({ getIdToken: vi.fn() }));

import { createAuthenticatedEventStream, parseSseEvents } from '../../ui/src/services/sse/authenticatedEventStream.js';

const streamFrom = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });

async function collect(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of parseSseEvents(body)) events.push(event);
  return events;
}

describe('parseSseEvents', () => {
  it('parses named, multiline events and ignores heartbeats', async () => {
    const events = await collect(
      streamFrom([': connected\n\nevent: jobStatus\ndata: {"jobId":', '"one"}\ndata: tail\n\n']),
    );
    expect(events).toEqual([{ type: 'jobStatus', data: '{"jobId":"one"}\ntail' }]);
  });

  it('handles CRLF event boundaries split across chunks', async () => {
    const events = await collect(streamFrom(['event: listings:new\r\ndata: {"count":2}\r', '\n\r\n']));
    expect(events).toEqual([{ type: 'listings:new', data: '{"count":2}' }]);
  });
});

describe('createAuthenticatedEventStream', () => {
  it('uses a fresh token when reconnecting and aborts on close', async () => {
    const tokenGetter = vi.fn().mockResolvedValueOnce('initial').mockResolvedValueOnce('refreshed');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(streamFrom(['event: jobStatus\ndata: {}\n\n']), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    let reconnect: () => void = () => {};
    const setTimeoutImpl = vi.fn((callback: () => void) => {
      reconnect = callback;
      return 1;
    }) as unknown as typeof setTimeout;
    const clearTimeoutImpl = vi.fn();
    const onEvent = vi.fn();

    const client = createAuthenticatedEventStream('/api/jobs/events', {
      tokenGetter: tokenGetter as unknown as (forceRefresh?: boolean) => Promise<string | null>,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      setTimeoutImpl,
      clearTimeoutImpl: clearTimeoutImpl as unknown as typeof clearTimeout,
      onEvent,
    });
    client.start();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(setTimeoutImpl).toHaveBeenCalledTimes(1));
    const firstInit = fetchImpl.mock.calls[0][1] as RequestInit & { headers: Headers };
    expect(firstInit.headers.get('Authorization')).toBe('Bearer initial');
    expect(onEvent).toHaveBeenCalledWith({ type: 'jobStatus', data: '{}' });

    reconnect();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(tokenGetter).toHaveBeenLastCalledWith(true);
    const secondInit = fetchImpl.mock.calls[1][1] as RequestInit & { headers: Headers; signal: AbortSignal };
    expect(secondInit.headers.get('Authorization')).toBe('Bearer refreshed');

    client.close();
    expect(secondInit.signal.aborted).toBe(true);
  });
});
