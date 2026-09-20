/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  draftKey,
  hasContent,
  saveDraft,
  loadDraft,
  clearDraft,
  DRAFT_FIELDS,
  type DraftStorage,
  type JobDraft,
} from '../../ui/src/services/jobs/jobDraft.js';

function memoryStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => map.set(key, String(value)),
    removeItem: (key: string) => map.delete(key),
  };
}

/** Storage that refuses to write, the way a full or disabled one does. */
function hostileStorage(): DraftStorage {
  return {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };
}

const aDraft = (): JobDraft => ({
  name: 'Cologne 3-room',
  dealType: 'rent',
  providerData: [{ id: 'immoscout', url: 'https://www.immobilienscout24.de/Suche/de/koeln/wohnung-mieten' }],
  selectedChannelIds: [],
  blacklist: ['Tausch'],
  shareWithUsers: [],
  enabled: true,
  spatialFilter: null,
  specFilter: null,
  commuteFilter: { action: 'notify', limits: { Work: 35 } },
});

describe('jobDraft', () => {
  let storage: DraftStorage & { map: Map<string, string> };
  beforeEach(() => {
    storage = memoryStorage();
  });

  describe('keys', () => {
    it('keeps a new job apart from an edited one', () => {
      expect(draftKey(null)).not.toBe(draftKey('job-1'));
      expect(draftKey(undefined)).toBe(draftKey(null));
    });

    it('never lets one job restore another job draft', () => {
      saveDraft('job-1', aDraft(), storage);
      expect(loadDraft('job-2', storage)).toBeNull();
      expect(loadDraft(null, storage)).toBeNull();
      expect(loadDraft('job-1', storage)).not.toBeNull();
    });
  });

  describe('deciding there is something to keep', () => {
    it.each([
      ['a name', { name: 'x' }],
      ['a provider', { providerData: [{ id: 'a' }] }],
      ['a channel', { selectedChannelIds: ['a'] }],
      ['a blacklist word', { blacklist: ['x'] }],
      ['a deal type', { dealType: 'buy' }],
      ['a drawn area', { spatialFilter: { type: 'Polygon' } }],
      ['a travel time limit', { commuteFilter: { action: 'notify', limits: { Work: 35 } } }],
      ['automatic inquiries', { autoSendInquiry: true }],
    ])('counts %s', (_what: string, draft: Record<string, unknown>) => {
      expect(hasContent(draft)).toBe(true);
    });

    it.each([
      ['nothing at all', {}],
      ['a blank name', { name: '   ' }],
      ['empty lists', { providerData: [], selectedChannelIds: [], blacklist: [] }],
      ['only the activation default', { enabled: true }],
      ['null', null],
    ])('does not count %s', (_what: string, draft: Record<string, unknown> | null) => {
      expect(hasContent(draft)).toBe(false);
    });
  });

  describe('round trip', () => {
    it('gives back what it was given', () => {
      saveDraft(null, aDraft(), storage);
      expect(loadDraft(null, storage)).toEqual(aDraft());
    });

    it('stores only the fields a draft is allowed to carry', () => {
      saveDraft(null, { ...aDraft(), jobId: 'sneaky', csrf: 'token' }, storage);
      const loaded = loadDraft(null, storage);
      expect(loaded).not.toBeNull();
      expect(
        Object.keys(loaded ?? {}).every((key) => DRAFT_FIELDS.includes(key as (typeof DRAFT_FIELDS)[number])),
      ).toBe(true);
    });

    it('writes nothing for an untouched form', () => {
      saveDraft(null, { enabled: true }, storage);
      expect(storage.map.size).toBe(0);
    });

    it('removes an existing draft once the form is emptied again', () => {
      saveDraft(null, aDraft(), storage);
      saveDraft(null, { enabled: true }, storage);
      expect(loadDraft(null, storage)).toBeNull();
    });
  });

  describe('refusing what it should not restore', () => {
    it('drops a draft written by an older version', () => {
      storage.setItem(draftKey(null), JSON.stringify({ version: 0, savedAt: Date.now(), draft: aDraft() }));
      expect(loadDraft(null, storage)).toBeNull();
      expect(storage.map.size).toBe(0);
    });

    it('drops an unparsable entry rather than failing on every visit', () => {
      storage.setItem(draftKey(null), 'not json');
      expect(loadDraft(null, storage)).toBeNull();
      expect(storage.map.size).toBe(0);
    });

    it('drops a stale draft', () => {
      saveDraft(null, aDraft(), storage);
      const thirteenHours = 13 * 60 * 60 * 1000;
      expect(loadDraft(null, storage, Date.now() + thirteenHours)).toBeNull();
    });

    it('keeps a draft that is merely old', () => {
      saveDraft(null, aDraft(), storage);
      const elevenHours = 11 * 60 * 60 * 1000;
      expect(loadDraft(null, storage, Date.now() + elevenHours)).not.toBeNull();
    });

    it('drops an entry with no timestamp', () => {
      storage.setItem(draftKey(null), JSON.stringify({ version: 1, draft: aDraft() }));
      expect(loadDraft(null, storage)).toBeNull();
    });
  });

  describe('staying in step with the form', () => {
    const form = fs.readFileSync(
      path.join(import.meta.dirname, '../../ui/src/views/jobs/mutation/JobMutation.tsx'),
      'utf-8',
    );

    it('carries every piece of state the job form asks it to keep', () => {
      const [, literal] = form.match(/saveDraft\(draftId,\s*\{([^}]*)\}/) ?? [];
      expect(literal).toBeDefined();
      const saved = (literal ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

      expect(saved.filter((field) => !DRAFT_FIELDS.includes(field as (typeof DRAFT_FIELDS)[number]))).toEqual([]);
    });

    it('has a reset for every field it restores', () => {
      const restored = [...form.matchAll(/if \(draft\.(\w+) !== undefined\)/g)].map((match) => match[1]);
      expect(restored.length).toBeGreaterThan(0);

      const [, discard] = form.match(/const discardDraft = \(\) => \{([\s\S]*?)\n {2}\};/) ?? [];
      expect(discard).toBeDefined();
      expect(
        restored.filter((field) => !new RegExp(`set${field[0].toUpperCase()}${field.slice(1)}\\(`).test(discard ?? '')),
      ).toEqual([]);
    });
  });

  describe('clearing', () => {
    it('forgets the draft', () => {
      saveDraft(null, aDraft(), storage);
      clearDraft(null, storage);
      expect(loadDraft(null, storage)).toBeNull();
    });
  });

  describe('when storage will not cooperate', () => {
    it('never takes the form down with it', () => {
      const hostile = hostileStorage();
      expect(() => saveDraft(null, aDraft(), hostile)).not.toThrow();
      expect(() => clearDraft(null, hostile)).not.toThrow();
      expect(loadDraft(null, hostile)).toBeNull();
    });

    it('does nothing at all when there is no storage', () => {
      expect(() => saveDraft(null, aDraft(), null)).not.toThrow();
      expect(loadDraft(null, null)).toBeNull();
    });
  });
});
