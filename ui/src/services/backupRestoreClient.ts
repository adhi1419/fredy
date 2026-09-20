/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { authenticatedFetch } from './authenticatedFetch.js';

/**
 * Lightweight client for Backup & Restore interactions with the backend.
 *
 * Usage (in React components):
 * ```js
 * import { downloadBackup, precheckRestore, restore } from '../../services/backupRestoreClient';
 * await downloadBackup();
 * const info = await precheckRestore(file);
 * await restore(file, false);
 * ```
 */

/** The compatibility verdict returned by a dry-run restore. */
export interface RestorePrecheck {
  compatible: boolean;
  severity: string;
  message: string;
  backupMigration: number | null;
  requiredMigration: number;
  fredyVersion?: string | null;
}

/** The result of a completed restore. */
export interface RestoreResult {
  restored: true;
  warning: string | null;
  details: unknown;
}

/** The zip payload the browser can upload. */
type BackupFile = Blob | ArrayBuffer | Uint8Array;

/** An error raised when a restore is refused by the server, carrying the server payload. */
export class RestoreError extends Error {
  readonly payload: unknown;

  constructor(message: string, payload: unknown) {
    super(message);
    this.payload = payload;
  }
}

function extractFileNameFromDisposition(disposition: string | null): string {
  const dispo = disposition || '';
  const match = dispo.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/);
  return decodeURIComponent(match?.[1] || match?.[2] || 'FredyBackup.zip');
}

export class BackupRestoreClient {
  /**
   * Trigger a backup download and save it using the filename provided by the server.
   */
  static async downloadBackup(): Promise<void> {
    const resp = await authenticatedFetch('/api/admin/backup', {});
    if (!resp.ok) throw new Error('Failed to create backup');
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

  /**
   * Upload a backup zip for analysis without restoring.
   * @param file - Backup zip content.
   */
  static async precheckRestore(file: BackupFile): Promise<RestorePrecheck> {
    const resp = await authenticatedFetch('/api/admin/backup/restore?dryRun=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: file as BodyInit,
    });
    return resp.json() as Promise<RestorePrecheck>;
  }

  /**
   * Perform a database restore from a backup zip.
   * @param file - Backup zip content.
   * @param force - When true, proceed even if reported incompatible.
   */
  static async restore(file: BackupFile, force: boolean): Promise<RestoreResult> {
    const resp = await authenticatedFetch(`/api/admin/backup/restore?force=${force ? 'true' : 'false'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: file as BodyInit,
    });
    const data = (await resp.json()) as RestoreResult & { message?: string };
    if (!resp.ok) {
      throw new RestoreError(data?.message || 'Restore failed', data);
    }
    return data;
  }
}

// Convenience named exports
export const downloadBackup = (): Promise<void> => BackupRestoreClient.downloadBackup();
export const precheckRestore = (file: BackupFile): Promise<RestorePrecheck> =>
  BackupRestoreClient.precheckRestore(file);
export const restore = (file: BackupFile, force: boolean): Promise<RestoreResult> =>
  BackupRestoreClient.restore(file, force);
