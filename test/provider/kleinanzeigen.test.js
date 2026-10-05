/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as similarityCache from '../../lib/services/similarity-check/similarityCache.js';
import { get } from '../mocks/mockNotification.js';
import { mockFredy, providerConfig } from '../utils.js';
import { expect } from 'vitest';
import * as provider from '../../lib/provider/kleinanzeigen.js';

/** Run-scoped provider config, built per test via createConfig(). */
let runConfig;

// Kleinanzeigen serves both the search page and each detail page over plain HTTP, so a run makes
// its two requests (search + detail) with the HTTP loader - no browser is involved.
const TEST_TIMEOUT = 180_000;

describe('#kleinanzeigen testsuite()', () => {
  let liveListings;

  it(
    'should test kleinanzeigen provider',
    async () => {
      const Fredy = await mockFredy();
      const mockedJob = {
        id: 'kleinanzeigen',
        notificationAdapter: null,
        spatialFilter: null,
        specFilter: null,
      };
      runConfig = provider.createConfig(providerConfig.kleinanzeigen, [], []);
      return await new Promise((resolve, reject) => {
        const fredy = new Fredy(runConfig, mockedJob, provider.metaInformation.id, similarityCache);

        fredy.execute().then((listing) => {
          if (listing == null || listing.length === 0) {
            reject('Listings is empty!');
            return;
          }

          liveListings = listing;
          expect(listing).toBeInstanceOf(Array);
          const notificationObj = get();
          expect(notificationObj).toBeTypeOf('object');
          expect(notificationObj.serviceName).toBe('kleinanzeigen');
          notificationObj.payload.forEach((notify) => {
            /** check the actual structure **/
            expect(notify.id).toBeTypeOf('string');
            expect(notify.title).toBeTypeOf('string');
            expect(notify.link).toBeTypeOf('string');
            expect(notify.address).toBeTypeOf('string');
            /** check the values if possible **/
            expect(notify.title).not.toBe('');
            expect(notify.link).toContain('https://www.kleinanzeigen.de');
            expect(notify.address).not.toBe('');
          });
          resolve();
        });
      });
    },
    TEST_TIMEOUT,
  );

  describe('with provider_details enabled', () => {
    it(
      'should enrich listings with details',
      async () => {
        if (!liveListings?.length) throw new Error('No listings from first test to enrich');

        // Call fetchDetails directly on the first live listing - no need to re-scrape the search
        // page. The detail page is read over plain HTTP.
        const enriched = await runConfig.fetchDetails(liveListings[0]);

        expect(enriched).toBeTruthy();
        expect(enriched.link).toContain('https://www.kleinanzeigen.de');
        expect(enriched.address).toBeTypeOf('string');
        expect(enriched.address).not.toBe('');
        expect(enriched.description).toBeTypeOf('string');
        expect(enriched.description).not.toBe('');
      },
      TEST_TIMEOUT,
    );
  });
});
