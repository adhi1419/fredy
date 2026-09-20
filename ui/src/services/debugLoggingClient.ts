/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { authenticatedFetch } from './authenticatedFetch.js';

/**
 * Tiny client wrapping the /api/admin/debug endpoints.
 *
 * The server returns the same status payload from every mutation endpoint so the UI
 * does not need to re-fetch after enable/disable, it can apply the response payload
 * directly.
 */

export interface DebugStatus {
  enabled: boolean;
  size: number;
  max: number;
  hasLogs: boolean;
  everEnabled: boolean;
}

/** An error raised when the debug bundle download has nothing to export. */
export class NoDebugLogsError extends Error {
  readonly code = 'NO_LOGS';
}

function extractFileNameFromDisposition(disposition: string | null): string {
  const dispo = disposition || '';
  // RFC 6266 says the UTF-8 encoded `filename*=` form takes precedence over the
  // legacy `filename=` form when both are present. Match each form independently
  // and prefer the UTF-8 one so we cannot accidentally pick the wrong encoding.
  const utf8Match = dispo.match(/filename\*=UTF-8''([^;]+)/);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // malformed percent-encoding; fall through to the legacy form
    }
  }
  const legacyMatch = dispo.match(/filename="?([^";]+)"?/);
  if (legacyMatch) return legacyMatch[1];
  return 'FredyDebug.zip';
}

/**
 * Fetch the current feature status. Requires admin auth.
 */
export async function fetchDebugStatus(): Promise<DebugStatus> {
  const resp = await authenticatedFetch('/api/admin/debug/status', {});
  if (!resp.ok) throw new Error('Failed to load debug logging status');
  return resp.json() as Promise<DebugStatus>;
}

/**
 * Lightweight "is debug logging active right now?" probe usable by any authenticated
 * user. Used by the app-wide red banner so non-admin users also see the warning. The
 * payload is intentionally a single boolean, no other settings are exposed.
 */
export async function fetchDebugActive(): Promise<{ enabled: boolean }> {
  const resp = await authenticatedFetch('/api/debug/active', {});
  if (!resp.ok) throw new Error('Failed to load debug active flag');
  return resp.json() as Promise<{ enabled: boolean }>;
}

/**
 * Enable the feature. When clearPrevious is true, existing log rows are dropped
 * before the new collection starts.
 */
export async function enableDebugLogging({
  clearPrevious = false,
}: { clearPrevious?: boolean } = {}): Promise<unknown> {
  const resp = await authenticatedFetch('/api/admin/debug/enable', {
    method: 'POST',

    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clearPrevious }),
  });
  if (!resp.ok) throw new Error('Failed to enable debug logging');
  return resp.json();
}

/**
 * Disable the feature. Existing logs remain on disk so they can still be downloaded.
 */
export async function disableDebugLogging(): Promise<unknown> {
  const resp = await authenticatedFetch('/api/admin/debug/disable', {
    method: 'POST',
  });
  if (!resp.ok) throw new Error('Failed to disable debug logging');
  return resp.json();
}

/**
 * Drop every stored debug log row. Does NOT change the enabled flag: if recording
 * was on, it stays on and the table simply starts filling again. Returns the new
 * status payload.
 */
export async function clearDebugLogs(): Promise<unknown> {
  const resp = await authenticatedFetch('/api/admin/debug/logs', {
    method: 'DELETE',
  });
  if (!resp.ok) throw new Error('Failed to clear debug logs');
  return resp.json();
}

/**
 * Trigger the debug bundle download. Throws when there is nothing to export (server
 * returns 409 in that case) or any other non-2xx response.
 */
export async function downloadDebugBundle(): Promise<void> {
  const resp = await authenticatedFetch('/api/admin/debug/download', {});
  if (resp.status === 409) {
    const data = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new NoDebugLogsError(data?.error || 'No debug logs available yet');
  }
  if (!resp.ok) throw new Error('Failed to download debug bundle');
  const blob = await resp.blob();
  const fileName = extractFileNameFromDisposition(resp.headers.get('Content-Disposition'));
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
