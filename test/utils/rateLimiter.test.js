/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { createIntervalPacer, createSerialPacer, intervalForRpm } from '../../lib/utils/rateLimiter.js';

/** A controllable clock: sleeping advances it, so spacing is asserted without real time. */
function fakeClock(start = 1_000) {
  let current = start;
  return {
    now: () => current,
    sleepImpl: (ms) => {
      current += ms;
      return Promise.resolve();
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

/** Let queued microtasks run, so an asynchronously-started queue has actually begun. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('intervalForRpm', () => {
  it('converts a per-minute budget into a start interval', () => {
    expect(intervalForRpm(60)).toBe(1000);
    expect(intervalForRpm(14)).toBe(4286);
  });

  it('treats a missing or nonsensical budget as unpaced', () => {
    expect(intervalForRpm(0)).toBe(0);
    expect(intervalForRpm(-5)).toBe(0);
    expect(intervalForRpm(undefined)).toBe(0);
  });
});

describe('createSerialPacer', () => {
  it('runs one call at a time, in order', async () => {
    const clock = fakeClock();
    const pacer = createSerialPacer({ intervalMs: 0, ...clock });
    const events = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    const first = pacer.run(async () => {
      events.push('first:start');
      await gate;
      events.push('first:end');
    });
    const second = pacer.run(async () => {
      events.push('second:start');
    });

    // The queue starts asynchronously, so let it begin before judging what ran.
    await flush();
    // The second call must not have started while the first is still running.
    expect(events).toEqual(['first:start']);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('does not make the first call wait, then spaces the following ones', async () => {
    const clock = fakeClock();
    const pacer = createSerialPacer({ intervalMs: 1000, ...clock });
    const starts = [];

    await pacer.run(async () => starts.push(clock.now()));
    await pacer.run(async () => starts.push(clock.now()));
    await pacer.run(async () => starts.push(clock.now()));

    expect(starts[0]).toBe(1000); // immediate
    expect(starts[1] - starts[0]).toBe(1000);
    expect(starts[2] - starts[1]).toBe(1000);
  });

  it('keeps serving after a rejection rather than stalling the queue', async () => {
    const clock = fakeClock();
    const pacer = createSerialPacer({ intervalMs: 0, ...clock });

    const failed = pacer.run(async () => {
      throw new Error('boom');
    });
    await expect(failed).rejects.toThrow('boom');

    await expect(pacer.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('reports pending work so a cache does not evict a pacer that is still busy', async () => {
    const clock = fakeClock();
    const pacer = createSerialPacer({ intervalMs: 0, ...clock });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    expect(pacer.pending).toBe(0);
    const inFlight = pacer.run(async () => {
      await gate;
    });
    const queued = pacer.run(async () => {});
    expect(pacer.pending).toBe(2);

    release();
    await Promise.all([inFlight, queued]);
    expect(pacer.pending).toBe(0);
  });
});

describe('createIntervalPacer', () => {
  it('reserves a distinct start slot per concurrent caller', async () => {
    // A fixed clock plus recorded waits is what proves the reservation: reading a shared clock after
    // resuming cannot distinguish slots, because every sleeper sees the same "now" once it advances.
    const waits = [];
    const pacer = createIntervalPacer({
      intervalMs: 1000,
      now: () => 1000,
      sleepImpl: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    await Promise.all([pacer.run(async () => {}), pacer.run(async () => {}), pacer.run(async () => {})]);

    // First call takes the slot that is already free (no wait); each later one waits a further
    // interval, so the three starts are spaced rather than simultaneous.
    expect(waits).toEqual([1000, 2000]);
  });

  it('lets calls overlap instead of serialising them', async () => {
    const clock = fakeClock();
    const pacer = createIntervalPacer({ intervalMs: 0, ...clock });
    const events = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    const slow = pacer.run(async () => {
      events.push('slow:start');
      await gate;
      events.push('slow:end');
    });
    const quick = pacer.run(async () => {
      events.push('quick:start');
    });

    await quick;
    // The quick call finished while the slow one was still in flight.
    expect(events).toEqual(['slow:start', 'quick:start']);
    release();
    await slow;
  });
});
