/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The notification adapter that needs the browser's permission.
 *
 * Matches the `id` in `lib/notification/adapter/browser.js`; the test suite checks that the two
 * have not drifted apart, because a silent mismatch here means the permission is never asked for
 * and browser notifications simply never arrive.
 */
export const BROWSER_ADAPTER_ID = 'browser';

/**
 * Whether any of these jobs actually sends browser notifications.
 *
 * This decides whether Fredy asks for notification permission at all. It used to ask on every load,
 * which meant most people met an operating-system dialog for a feature they had not switched on -
 * and a permission prompt that arrives out of nowhere is the one most likely to be denied outright,
 * which then costs the feature for the people who did want it.
 *
 * Written to be total: jobs arrive from the store, which starts empty and may hold whatever an
 * older instance wrote.
 */
interface BrowserAdapterJob {
  notificationAdapter?: Array<{ id?: string } | null | undefined>;
}

export function usesBrowserAdapter(jobs: unknown): boolean {
  if (!Array.isArray(jobs)) {
    return false;
  }
  return (jobs as BrowserAdapterJob[]).some(
    (job) =>
      Array.isArray(job?.notificationAdapter) &&
      job.notificationAdapter.some((adapter) => adapter?.id === BROWSER_ADAPTER_ID),
  );
}
