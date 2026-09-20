/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * notificationSendOutcome — the pure classifier for what a notification adapter's resolved value
 * actually means.
 *
 * A resolved promise from an adapter is NOT proof of a delivered message. The shipped adapters
 * return wildly different shapes:
 *   - Slack / Telegram / Discord / webhook adapters resolve a `Promise.allSettled` array whose
 *     entries can individually be `{status: 'rejected'}` even though the outer promise fulfilled.
 *   - HTTP / Mattermost / Apprise resolve a `fetch` Response that can be `{ok: false}` (non-2xx).
 *   - Plain SDK adapters resolve an ordinary success object (or undefined).
 *
 * `assertSendResolved` walks the resolved value and THROWS when any part of it proves failure, so
 * the orchestrator only ever records a delivery `sent` for a value that contains no evidence of
 * failure. Thrown errors carry a non-secret code plus, for a Response, only its numeric status —
 * never a URL, header, or body, because a webhook URL is itself a credential.
 */

/** A settled result is a rejection. */
const isRejectedSettlement = (value) => value != null && typeof value === 'object' && value.status === 'rejected';

/** A settled result is a fulfilment carrying a nested value. */
const isFulfilledSettlement = (value) =>
  value != null && typeof value === 'object' && value.status === 'fulfilled' && 'value' in value;

/** Looks like a fetch Response: has a boolean `ok` and a numeric `status`. */
const isResponseLike = (value) =>
  value != null && typeof value === 'object' && typeof value.ok === 'boolean' && typeof value.status === 'number';

/**
 * Throw when a resolved adapter value proves (anywhere within it) that delivery failed.
 *
 * Rejection rules, applied recursively so a `Promise.allSettled` array of Responses is fully
 * checked:
 *   - a `PromiseSettledResult` with `status: 'rejected'` → reject;
 *   - a fulfilled `PromiseSettledResult` whose nested `value` fails the same check → reject;
 *   - a Response-like value with `ok === false` → reject (only the status is disclosed);
 *   - a thenable → await it and apply the same checks to its value;
 *   - a non-empty array → every element must pass; an empty array proves no delivery ran.
 *
 * Everything else — `undefined`, an ordinary SDK success object, a Response with `ok === true`,
 * or a non-empty array of successful results — is a success.
 *
 * @param {*} value The resolved value from an adapter's `send`.
 * @returns {Promise<void>} Resolves when the value contains no failure evidence.
 * @throws {Error} with a non-secret message when the value proves failure.
 */
export async function assertSendResolved(value) {
  if (value != null && typeof value.then === 'function') {
    try {
      await assertSendResolved(await value);
    } catch {
      throw new Error('adapter promise rejected');
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error('adapter produced no delivery results');
    }
    for (const element of value) await assertSendResolved(element);
    return;
  }
  if (isRejectedSettlement(value)) {
    // Never surface `value.reason` — it can be an Error whose message embeds a webhook URL/token.
    throw new Error('adapter settlement rejected');
  }
  if (isFulfilledSettlement(value)) {
    await assertSendResolved(value.value);
    return;
  }
  if (isResponseLike(value) && value.ok === false) {
    // Status only. No URL, no headers, no body.
    throw new Error(`adapter responded with non-2xx status ${value.status}`);
  }
}
