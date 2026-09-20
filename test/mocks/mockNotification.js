/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

let tmpStore = {};

export const send = (serviceName, payload) => {
  tmpStore = { serviceName, payload };
  return [Promise.resolve()];
};

/**
 * Per-listing/per-channel send used by the notification delivery orchestrator.
 *
 * The pipeline no longer fans one batch out to every adapter; it reserves and sends one listing to
 * one channel at a time. The tests still observe "which listings were notified about" through
 * {@link get}, so this accumulates each sent listing into the same payload array a batch `send`
 * would have produced. It resolves like a real adapter send.
 *
 * @param {{serviceName: string, listing: Object, channel: Object, jobKey: string, baseUrl: string}} params
 * @returns {Promise<void>}
 */
export const sendOneToChannel = ({ serviceName, listing }) => {
  if (tmpStore.payload == null) tmpStore = { serviceName, payload: [] };
  tmpStore.payload.push(listing);
  return Promise.resolve();
};

export const get = () => {
  return tmpStore;
};

/**
 * Forget the last notification.
 *
 * Needed by any test asserting that nothing was sent: without it the previous test's payload is
 * still here, and "no notification" reads exactly like "the one from before".
 */
export const reset = () => {
  tmpStore = {};
};
