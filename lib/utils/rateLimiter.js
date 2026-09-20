/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Proactive pacing for the outbound calls a large run can rate limit.
 *
 * Backoff is the safety net after a refusal; these pacers are what keep the refusal from happening.
 * The difference matters because a 429 response is itself a request: a burst that retries its way
 * through a rate limit spends more of the limit than one that never exceeded it.
 *
 * Two shapes, because the two callers need different guarantees:
 *
 * - `createSerialPacer` runs ONE call at a time per key and spaces the starts. A call that sits in a
 *   retry loop therefore holds the queue, which is the point: the alternative lets every later call
 *   start anyway and pile dozens of concurrent retriers onto the same rate-limited resource.
 * - `createIntervalPacer` only spaces the starts and lets calls overlap. That is the honest shape
 *   for a requests-per-minute quota, where what is capped is how often a request may START, and
 *   serialising would make one slow call delay every later one for no quota benefit.
 */

import { sleep } from './retry.js';

/**
 * A pacer that runs one operation at a time and keeps consecutive starts at least `intervalMs`
 * apart.
 *
 * Ordering is FIFO. A rejection never breaks the chain: the internal tail swallows outcomes so one
 * failed call cannot stall everything queued behind it. `pending` counts calls that are queued or
 * in flight, which is what lets a cache of pacers evict an idle entry without discarding one that
 * still has work - dropping a live pacer would hand the next caller a fresh one and undo the
 * serialisation exactly when it is carrying the load.
 *
 * @param {{intervalMs?: number, sleepImpl?: (ms: number) => Promise<void>, now?: () => number}} [options]
 * @returns {{run: <T>(fn: () => Promise<T>) => Promise<T>, pending: number}}
 */
export function createSerialPacer({ intervalMs = 0, sleepImpl = sleep, now = Date.now } = {}) {
  let tail = Promise.resolve();
  let lastStartedAt = 0;
  let pending = 0;

  function run(fn) {
    pending += 1;
    const result = tail.then(async () => {
      // A first call must not pay the interval: the gap is between calls, not before the first one.
      const wait = lastStartedAt === 0 ? 0 : Math.max(0, lastStartedAt + intervalMs - now());
      if (wait > 0) await sleepImpl(wait);
      lastStartedAt = now();
      return fn();
    });

    const settled = () => {
      pending -= 1;
    };
    // Both derived promises handle rejection, so a caller that ignores its own result never turns
    // into an unhandled rejection from the bookkeeping.
    tail = result.then(
      () => {},
      () => {},
    );
    result.then(settled, settled);
    return result;
  }

  return {
    run,
    get pending() {
      return pending;
    },
  };
}

/**
 * A pacer that lets calls overlap but reserves a start slot for each, keeping consecutive starts at
 * least `intervalMs` apart.
 *
 * The slot is reserved synchronously when `run` is called, so concurrent callers queue for distinct
 * slots rather than all reading the same "last start" and firing together.
 *
 * @param {{intervalMs?: number, sleepImpl?: (ms: number) => Promise<void>, now?: () => number}} [options]
 * @returns {{run: <T>(fn: () => Promise<T>) => Promise<T>}}
 */
export function createIntervalPacer({ intervalMs = 0, sleepImpl = sleep, now = Date.now } = {}) {
  let nextAvailableAt = 0;

  async function run(fn) {
    const current = now();
    const startAt = Math.max(current, nextAvailableAt);
    nextAvailableAt = startAt + intervalMs;
    const wait = startAt - current;
    if (wait > 0) await sleepImpl(wait);
    return fn();
  }

  return { run };
}

/**
 * Milliseconds between starts for a requests-per-minute budget.
 *
 * @param {number} perMinute Requests allowed per minute.
 * @returns {number}
 */
export function intervalForRpm(perMinute) {
  const rpm = Number(perMinute);
  if (!Number.isFinite(rpm) || rpm <= 0) return 0;
  return Math.ceil(60_000 / rpm);
}
