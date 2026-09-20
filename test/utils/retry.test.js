/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import { backoffDelay, hintedDelay, retryWithBackoff } from '../../lib/utils/retry.js';

describe('backoffDelay', () => {
  it('grows exponentially and is capped', () => {
    const random = () => 1; // full jitter picks the top of the window
    expect(backoffDelay(0, { baseDelayMs: 500, maxDelayMs: 30_000, random })).toBe(500);
    expect(backoffDelay(1, { baseDelayMs: 500, maxDelayMs: 30_000, random })).toBe(1000);
    expect(backoffDelay(2, { baseDelayMs: 500, maxDelayMs: 30_000, random })).toBe(2000);
    // 500 * 2**6 = 32000, capped to 30000.
    expect(backoffDelay(6, { baseDelayMs: 500, maxDelayMs: 30_000, random })).toBe(30_000);
  });

  it('applies full jitter: the delay never exceeds the exponential window', () => {
    const delay = backoffDelay(3, { baseDelayMs: 500, maxDelayMs: 30_000, random: () => 0.5 });
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(4000); // 500 * 2**3
  });
});

describe('retryWithBackoff', () => {
  const noSleep = () => Promise.resolve();

  it('returns the first success without retrying', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(op, { sleepImpl: noSleep });
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries a retriable failure, then succeeds', async () => {
    const op = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    const result = await retryWithBackoff(op, { retries: 3, sleepImpl: noSleep });
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('stops immediately when shouldRetry says no', async () => {
    const op = vi.fn().mockRejectedValue(Object.assign(new Error('4xx'), { status: 400 }));
    await expect(retryWithBackoff(op, { shouldRetry: (e) => e.status !== 400, sleepImpl: noSleep })).rejects.toThrow(
      '4xx',
    );
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('rethrows the last error after exhausting retries', async () => {
    const op = vi.fn().mockRejectedValue(new Error('always'));
    await expect(retryWithBackoff(op, { retries: 2, sleepImpl: noSleep })).rejects.toThrow('always');
    expect(op).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('honors a server-dictated retryAfterMs, capping the hint at maxDelayMs', async () => {
    const waits = [];
    const op = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValue('ok');
    await retryWithBackoff(op, {
      retries: 3,
      maxDelayMs: 10_000,
      retryAfterMs: () => 999_999, // absurdly long hint
      random: () => 0, // no jitter, so the cap itself is what is asserted
      sleepImpl: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(waits).toEqual([10_000]); // hint capped to maxDelayMs
  });
});

describe('hintedDelay', () => {
  it('never waits less than the server asked for', () => {
    // Waiting less than the hint just earns another refusal, so the jitter only ever adds.
    expect(hintedDelay(10_000, 30_000, () => 0)).toBe(10_000);
    expect(hintedDelay(10_000, 30_000, () => 0.999)).toBeGreaterThan(10_000);
  });

  it('spreads the same hint across callers so they do not wake together', () => {
    // The defect this closes: a verbatim hint gave every concurrent retrier the identical delay,
    // so they re-synchronised into a burst on every cycle.
    const delays = [0.1, 0.4, 0.9].map((r) => hintedDelay(10_000, 30_000, () => r));
    expect(new Set(delays).size).toBe(3);
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(10_000);
      expect(d).toBeLessThanOrEqual(15_000); // hint + 50%
    }
  });

  it('caps the hint at maxDelayMs before adding jitter', () => {
    expect(hintedDelay(999_999, 10_000, () => 0)).toBe(10_000);
    expect(hintedDelay(999_999, 10_000, () => 0.5)).toBe(12_500);
  });

  it('applies the jittered hint through retryWithBackoff', async () => {
    const waits = [];
    const op = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValue('ok');
    await retryWithBackoff(op, {
      retries: 2,
      maxDelayMs: 30_000,
      retryAfterMs: () => 10_000,
      random: () => 0.5,
      sleepImpl: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(waits).toEqual([12_500]); // 10s hint + 50% of 10s * 0.5
  });
});
