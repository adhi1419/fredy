/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Keeps a half-finished job around while the user goes somewhere else.
 *
 * The job form holds twelve pieces of plain component state, and the form itself offers two links
 * that unmount it: "Manage channels", and the picker's "you have no channels yet". A first-time
 * user has to follow one of them - a job cannot be saved without a notification channel, and
 * channels are only created on the Settings page - and until now that threw away the name, the deal
 * type and every provider URL they had pasted in.
 *
 * `sessionStorage`, not `localStorage`: an abandoned draft should not still be waiting weeks later
 * on a shared machine. It lasts exactly as long as the tab the user left it in.
 */

export type DraftDealType = 'rent' | 'buy';

export interface DraftProvider {
  id?: string;
  name?: string;
  url?: string;
  [key: string]: unknown;
}

export interface DraftCommuteFilter {
  action?: string;
  limits?: Record<string, number>;
  [key: string]: unknown;
}

export interface JobDraft {
  name?: string | null;
  dealType?: DraftDealType | null;
  providerData?: readonly DraftProvider[];
  selectedChannelIds?: readonly string[];
  blacklist?: readonly string[];
  shareWithUsers?: readonly string[];
  enabled?: boolean;
  spatialFilter?: unknown | null;
  specFilter?: unknown | null;
  commuteFilter?: DraftCommuteFilter | null;
  autoSendInquiry?: boolean;
  [key: string]: unknown;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Bumped whenever the stored shape changes. */
const VERSION = 1;
const PREFIX = 'fredy:jobDraft:';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** The fields a draft carries. Anything not listed is either derived or belongs to the server. */
export const DRAFT_FIELDS = [
  'name',
  'dealType',
  'providerData',
  'selectedChannelIds',
  'blacklist',
  'shareWithUsers',
  'enabled',
  'spatialFilter',
  'specFilter',
  'commuteFilter',
  'autoSendInquiry',
] as const;

export type DraftField = (typeof DRAFT_FIELDS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasEntries(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/** Where a draft for a given job is kept. */
export function draftKey(jobId: string | null | undefined): string {
  return `${PREFIX}${jobId ?? 'new'}`;
}

/** Whether a draft holds anything worth restoring. */
export function hasContent(draft: unknown): draft is JobDraft {
  if (!isRecord(draft)) {
    return false;
  }
  return (
    (typeof draft.name === 'string' && draft.name.trim().length > 0) ||
    hasEntries(draft.providerData) ||
    hasEntries(draft.selectedChannelIds) ||
    hasEntries(draft.blacklist) ||
    hasEntries(draft.shareWithUsers) ||
    draft.dealType != null ||
    draft.spatialFilter != null ||
    draft.specFilter != null ||
    draft.commuteFilter != null ||
    draft.autoSendInquiry === true
  );
}

/** Keep only the fields a draft is allowed to carry. */
function pick(draft: Record<string, unknown>): Partial<JobDraft> {
  const out: Record<string, unknown> = {};
  for (const field of DRAFT_FIELDS) {
    if (draft[field] !== undefined) {
      out[field] = draft[field];
    }
  }
  return out as Partial<JobDraft>;
}

/** Store a draft, or remove it when there is nothing in it. */
export function saveDraft(
  jobId: string | null,
  draft: unknown,
  storage: DraftStorage | null = globalThis.sessionStorage,
): void {
  if (storage == null) {
    return;
  }
  if (!hasContent(draft)) {
    clearDraft(jobId, storage);
    return;
  }
  try {
    storage.setItem(draftKey(jobId), JSON.stringify({ version: VERSION, savedAt: Date.now(), draft: pick(draft) }));
  } catch {
    // A full or disabled storage must not take the form down with it. Losing the safety net is
    // survivable; losing the page the user is typing into is not.
  }
}

/** Read a draft back. */
export function loadDraft(
  jobId: string | null,
  storage: DraftStorage | null = globalThis.sessionStorage,
  now = Date.now(),
): Partial<JobDraft> | null {
  if (storage == null) {
    return null;
  }
  let raw: string | null;
  try {
    raw = storage.getItem(draftKey(jobId));
  } catch {
    return null;
  }
  if (raw == null) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    clearDraft(jobId, storage);
    return null;
  }

  const record = isRecord(payload) ? payload : null;
  const tooOld = typeof record?.savedAt !== 'number' || now - record.savedAt > MAX_AGE_MS;
  if (record?.version !== VERSION || tooOld || !hasContent(record?.draft)) {
    clearDraft(jobId, storage);
    return null;
  }
  return pick(record.draft);
}

/** Forget a draft. */
export function clearDraft(jobId: string | null, storage: DraftStorage | null = globalThis.sessionStorage): void {
  try {
    storage?.removeItem(draftKey(jobId));
  } catch {
    // Nothing to do: the draft is already unreachable.
  }
}
