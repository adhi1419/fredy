/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getIdToken } from '../auth/firebaseAuth.js';
import { createAuthenticatedRequestPolicy } from '../authenticatedTransport.js';

export const DEFAULT_RECONNECT_DELAY_MS = 500;
export const MAX_RECONNECT_DELAY_MS = 10_000;

/**
 * Parse an SSE response body into named events. The parser handles chunk boundaries, CRLF, data
 * lines, comments, event names, and a final unterminated event.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @returns {AsyncGenerator<{type:string,data:string,id?:string}>}
 */
export async function* parseSseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const parseBlock = (block) => {
    let eventType = 'message';
    let eventId;
    const dataLines = [];
    for (const line of block.split(/\r\n|\r|\n/)) {
      if (line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'event') eventType = value;
      if (field === 'data') dataLines.push(value);
      if (field === 'id') eventId = value;
    }
    if (dataLines.length === 0) return null;
    return {
      type: eventType || 'message',
      data: dataLines.join('\n'),
      ...(eventId === undefined ? {} : { id: eventId }),
    };
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundary;
    while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer)) != null) {
      const event = parseBlock(buffer.slice(0, boundary.index));
      buffer = buffer.slice(boundary.index + boundary[0].length);
      if (event) yield event;
    }

    if (done) break;
  }

  if (buffer.length > 0) {
    const event = parseBlock(buffer);
    if (event) yield event;
  }
}

/**
 * Create a reconnecting authenticated SSE stream.
 *
 * @param {string} url
 * @param {{
 *   onEvent?: (event: {type:string,data:string,id?:string}) => void,
 *   onError?: (error: Error) => void,
 *   fetchImpl?: typeof fetch,
 *   tokenGetter?: (forceRefresh?: boolean) => Promise<string|null>,
 *   setTimeoutImpl?: typeof setTimeout,
 *   clearTimeoutImpl?: typeof clearTimeout,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number,
 *   apiBaseUrl?: string,
 *   signal?: AbortSignal,
 * }} [options]
 * @returns {{start: () => void, close: () => void}}
 */
export function createAuthenticatedEventStream(url, options = {}) {
  const policy = createAuthenticatedRequestPolicy({
    fetchImpl: options.fetchImpl,
    tokenGetter: options.tokenGetter ?? getIdToken,
    apiBaseUrl: options.apiBaseUrl,
  });
  const setTimeoutImpl = options.setTimeoutImpl ?? globalThis.setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? globalThis.clearTimeout;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? MAX_RECONNECT_DELAY_MS;

  let stopped = false;
  let started = false;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let controller = null;

  const reportError = (error) => {
    if (!stopped) options.onError?.(error instanceof Error ? error : new Error(String(error)));
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== null) return;
    const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      void connect(true);
    }, delay);
  };

  const connect = async (isReconnect) => {
    if (stopped) return;

    controller = new AbortController();
    try {
      const response = await policy.request(
        url,
        {
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        },
        isReconnect,
      );
      if (!response.ok) {
        policy.handleSse(response.status);
        throw new Error(`SSE request failed with status ${response.status}`);
      }
      if (!response.body) throw new Error('SSE response has no body');

      reconnectAttempt = 0;
      for await (const event of parseSseEvents(response.body)) {
        if (stopped) return;
        options.onEvent?.(event);
      }
      scheduleReconnect();
    } catch (error) {
      if (stopped || error?.name === 'AbortError') return;
      reportError(error);
      scheduleReconnect();
    }
  };

  const start = () => {
    if (started || stopped) return;
    started = true;
    void connect(false);
  };

  const close = () => {
    if (stopped) return;
    stopped = true;
    if (reconnectTimer !== null) {
      clearTimeoutImpl(reconnectTimer);
      reconnectTimer = null;
    }
    controller?.abort();
    controller = null;
  };

  if (options.signal) {
    if (options.signal.aborted) close();
    else options.signal.addEventListener('abort', close, { once: true });
  }

  return { start, close };
}
