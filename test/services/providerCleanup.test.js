/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const jobs = new Map();
let storedProviders;

const jobStorageMock = {
  getJobs: vi.fn(async () => [...jobs.values()]),
  upsertJob: vi.fn(async (job) => {
    jobs.set(job.jobId, { ...job, id: job.jobId });
  }),
};

const listingsStorageMock = {
  getStoredProviderIdsForSystem: vi.fn(async () => storedProviders),
};

vi.mock('../../lib/services/storage/jobStorage.js', () => jobStorageMock);
vi.mock('../../lib/services/storage/listingsStorage.js', () => listingsStorageMock);

const provider = (id) => ({ metaInformation: { id } });

const addJob = (id, name, providerConfig) => {
  jobs.set(id, { id, name, provider: providerConfig });
};

const providerConfigOf = (id) => jobs.get(id).provider;

describe('providerCleanup', () => {
  let removeObsoleteProviders;

  beforeEach(async () => {
    jobs.clear();
    storedProviders = [];
    vi.clearAllMocks();
    addJob('job-1', 'Test', [{ id: 'immoscout', url: 'https://example.org' }]);
    ({ removeObsoleteProviders } = await import('../../lib/services/providers/providerCleanup.js'));
  });

  describe('job configs', () => {
    it('removes a provider that no longer exists and keeps the remaining ones', async () => {
      addJob('job-2', 'Mixed', [{ id: 'immoscout' }, { id: 'immonet', url: 'https://immonet.de' }]);

      const result = await removeObsoleteProviders([provider('immoscout')]);

      expect(providerConfigOf('job-2')).toEqual([{ id: 'immoscout' }]);
      expect(result.jobsUpdated).toBe(1);
      expect(result.providerConfigsRemoved).toBe(1);
      expect(result.obsoleteProviderIds).toEqual(['immonet']);
    });

    it('empties the config of a job that only used obsolete providers', async () => {
      addJob('job-2', 'Dead', [{ id: 'immonet' }, { id: 'wohnungsboerse' }]);

      await removeObsoleteProviders([provider('immoscout')]);

      expect(providerConfigOf('job-2')).toEqual([]);
    });

    it('leaves jobs untouched when every configured provider still exists', async () => {
      const result = await removeObsoleteProviders([provider('immoscout'), provider('immowelt')]);

      expect(providerConfigOf('job-1')).toEqual([{ id: 'immoscout', url: 'https://example.org' }]);
      expect(result.jobsUpdated).toBe(0);
      expect(result.obsoleteProviderIds).toEqual([]);
    });
  });

  describe('Firestore listing inventory', () => {
    it('reports obsolete listing providers without pretending to delete them', async () => {
      storedProviders = ['immoscout', 'immonet'];

      const result = await removeObsoleteProviders([provider('immoscout')]);

      expect(result.obsoleteProviderIds).toEqual(['immonet']);
      expect(result.listingsRemoved).toBe(0);
    });

    it('reports orphan listings alongside an updated job config', async () => {
      addJob('job-2', 'Mixed', [{ id: 'immoscout' }, { id: 'immonet' }]);
      storedProviders = ['immonet'];

      const result = await removeObsoleteProviders([provider('immoscout')]);

      expect(providerConfigOf('job-2')).toEqual([{ id: 'immoscout' }]);
      expect(result).toEqual({
        obsoleteProviderIds: ['immonet'],
        jobsUpdated: 1,
        providerConfigsRemoved: 1,
        listingsRemoved: 0,
      });
    });
  });

  it('does nothing when no provider module could be loaded', async () => {
    const result = await removeObsoleteProviders([]);

    expect(providerConfigOf('job-1')).toEqual([{ id: 'immoscout', url: 'https://example.org' }]);
    expect(jobStorageMock.getJobs).not.toHaveBeenCalled();
    expect(listingsStorageMock.getStoredProviderIdsForSystem).not.toHaveBeenCalled();
    expect(result).toEqual({
      obsoleteProviderIds: [],
      jobsUpdated: 0,
      providerConfigsRemoved: 0,
      listingsRemoved: 0,
    });
  });
});
