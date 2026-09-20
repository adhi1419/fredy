/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Exponential backoff with full jitter, shared by the outbound calls that a large run can rate
 * limit (Gemini message generation, Telegram delivery).
 *
 * Why full jitter: a scrape drafts and sends one call per new listing, and now that ImmoScout is
 * paginated a first run can surface dozens at once. Retrying them all after the same fixed delay
 * just recreates the burst one interval later (the "thundering herd"). Full jitter spreads the
 * retries across the window, so 35 calls that all hit a per-minute limit at 23:59 do not all wake
 * at 00:00 and trip it again.
 *
 * The server's own hint wins when it gives one: Telegram's `retry_after` and Gemini's `RetryInfo`
 * say exactly how long to wait, and honoring it is both faster and politer than guessing.
 */

/** @type {(ms: number) => Promise<void>} */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Full-jitter backoff delay for a zero-based attempt number: a random value in
 * `[0, min(maxDelayMs, baseDelayMs * 2**attempt)]`.
 *
 * @param {number} attempt Zero-based attempt index (0 is the first retry).
 * @param {{baseDelayMs?: number, maxDelayMs?: number, random?: () => number}} [options]
 * @returns {number} Delay in milliseconds.
 */
export function backoffDelay(attempt, { baseDelayMs = 500, maxDelayMs = 30_000, random = Math.random } = {}) {
  const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * capped);
}

/**
 * Run an async operation, retrying it with exponential backoff and full jitter while a caller-
 * supplied predicate says the failure is retriable.
 *
 * The operation receives the zero-based attempt number. `shouldRetry(error, attempt)` decides
 * whether to retry at all; `retryAfterMs(error)` may return a server-dictated wait that overrides
 * the computed backoff (capped at `maxDelayMs` so one call cannot park the run for minutes). When
 * retries are exhausted the last error is rethrown, so the caller's existing error handling still
 * applies.
 *
 * @template T
 * @param {(attempt: number) => Promise<T>} operation
 * @param {{
 *   retries?: number,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number,
 *   shouldRetry?: (error: unknown, attempt: number) => boolean,
 *   retryAfterMs?: (error: unknown) => number | null,
 *   onRetry?: (info: {attempt: number, delayMs: number, error: unknown}) => void,
 *   random?: () => number,
 *   sleepImpl?: (ms: number) => Promise<void>,
 * }} [options]
 * @returns {Promise<T>}
 */
export async function retryWithBackoff(
  operation,
  {
    retries = 4,
    baseDelayMs = 500,
    maxDelayMs = 30_000,
    shouldRetry = () => true,
    retryAfterMs = () => null,
    onRetry = () => {},
    random = Math.random,
    sleepImpl = sleep,
  } = {},
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error, attempt)) throw error;

      const hinted = retryAfterMs(error);
      const delayMs =
        hinted != null && Number.isFinite(hinted) && hinted > 0
          ? Math.min(maxDelayMs, hinted)
          : backoffDelay(attempt, { baseDelayMs, maxDelayMs, random });

      onRetry({ attempt, delayMs, error });
      await sleepImpl(delayMs);
    }
  }
  // Unreachable: the loop returns or throws.
  throw lastError;
}
