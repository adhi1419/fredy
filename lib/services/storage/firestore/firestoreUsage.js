/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const usageStorage = new AsyncLocalStorage();

/**
 * Run an operation with Firestore read/write accounting enabled.
 *
 * @param {string} name Human-readable operation name.
 * @param {Function} fn Operation to run.
 * @returns {Promise<unknown>} The operation result.
 */
export async function withFirestoreUsageScope(name, fn) {
  if (typeof fn !== 'function') throw new TypeError('withFirestoreUsageScope requires a function');
  const usage = { name: String(name ?? 'unknown'), reads: 0, writes: 0 };
  return usageStorage.run(usage, fn);
}

/**
 * Return the active Firestore usage counters, or null outside a scope.
 *
 * @returns {{name: string, reads: number, writes: number}|null}
 */
export function currentFirestoreUsage() {
  return usageStorage.getStore() ?? null;
}

export function recordFirestoreRead(count = 1) {
  const usage = usageStorage.getStore();
  if (usage) usage.reads += Math.max(0, Number(count) || 0);
}

export function recordFirestoreWrite(count = 1) {
  const usage = usageStorage.getStore();
  if (usage) usage.writes += Math.max(0, Number(count) || 0);
}
