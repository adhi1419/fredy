/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockFredy } from './utils.js';
import { setKnownListingsForRepair, setUserSettings } from './mocks/mockStore.js';
import { setDebugLogSink } from '../lib/services/logger.js';

const entries = [];

function pipelineEvents() {
  return entries
    .filter((entry) => entry.message.startsWith('PIPELINE_RUN '))
    .map((entry) => JSON.parse(entry.message.slice('PIPELINE_RUN '.length)));
}

describe('pipeline run timing', () => {
  beforeEach(() => {
    entries.length = 0;
    setKnownListingsForRepair([]);
    setUserSettings({});
    setDebugLogSink((entry) => entries.push(entry));
  });

  afterEach(() => {
    setDebugLogSink(null);
  });

  it('records every scrape stage and correlates the repair pass', async () => {
    const Fredy = await mockFredy();
    const providerConfig = {
      url: 'https://provider.example/search',
      getListings: async () => [
        {
          id: 'listing-1',
          link: 'https://provider.example/listing-1',
          title: 'Listing',
          address: 'Address',
          price: 900,
        },
      ],
      normalize: (listing) => listing,
      filter: () => true,
      requiredFieldNames: ['id', 'link', 'title', 'address', 'price'],
    };
    const job = {
      id: 'job-1',
      provider: [{ id: 'test-provider', applicationPolicy: { automatic: 'disabled' } }],
      notificationAdapter: [],
      specFilter: null,
      spatialFilter: null,
      commuteFilter: null,
    };
    const executioner = new Fredy(providerConfig, job, 'test-provider', {
      checkAndAddEntry: () => false,
    });

    await executioner.execute();
    await executioner.reconcile();

    const [scrape, repair] = pipelineEvents();
    expect(scrape).toMatchObject({
      event: 'pipeline_run',
      schemaVersion: 1,
      jobId: 'job-1',
      providerId: 'test-provider',
      runType: 'scrape',
      outcome: 'completed',
    });
    expect(scrape.stages.map(({ name }) => name)).toEqual([
      'load-context',
      'prepare-url',
      'fetch-listings',
      'normalize',
      'provider-filter',
      'find-new',
      'spec-filter',
      'geocode',
      'store',
      'distance',
      'similarity-filter',
      'area-filter',
      'travel-times',
      'commute-filter',
      'inquiry-drafts',
      'inquiry-delivery',
      'notifications',
    ]);
    expect(scrape.stages.find(({ name }) => name === 'fetch-listings')).toMatchObject({
      outputCount: 1,
      outcome: 'completed',
    });
    expect(scrape.stages.every(({ durationMs }) => durationMs >= 0)).toBe(true);

    expect(repair).toMatchObject({
      event: 'pipeline_run',
      executionId: scrape.executionId,
      jobId: 'job-1',
      providerId: 'test-provider',
      runType: 'repair',
      outcome: 'completed',
    });
    expect(repair.stages.map(({ name }) => name)).toEqual(['load-context', 'query-candidates']);
    expect(repair.stages.find(({ name }) => name === 'query-candidates').outputCount).toBe(0);
  });
});
