/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi } from 'vitest';
import { readFile } from 'fs/promises';
import * as mockStore from './mocks/mockStore.js';
import { send, sendOneToChannel } from './mocks/mockNotification.js';

export const providerConfig = JSON.parse(
  await readFile(new URL('./provider/testProvider.json', import.meta.url), 'utf-8'),
);

vi.mock('../lib/services/storage/listingsStorage.js', () => mockStore);
vi.mock('../lib/services/storage/settingsStorage.js', () => mockStore);
vi.mock('../lib/services/geocoding/geoCodingService.js', () => ({
  geocodeAddress: mockStore.geocodeAddress,
}));
vi.mock('../lib/services/storage/jobStorage.js', () => ({
  getJob: (jobKey) => ({ id: jobKey, userId: 'user1' }),
}));
vi.mock('../lib/services/storage/userStorage.js', () => ({
  getUser: (userId) => ({ id: userId, username: 'user1@example.com' }),
}));
vi.mock('../lib/notification/notify.js', () => ({ send, sendOneToChannel }));

// The notification delivery ledger. In tests it never blocks: every reservation succeeds so the
// pipeline attempts each configured channel exactly once, and finishing is a no-op. The per-channel
// send itself is recorded through the notify mock above. Real reservation/duplicate-suppression is
// proven by the dedicated ledger unit and contract suites, not here.
vi.mock('../lib/services/storage/notificationLedgerStorage.js', () => ({
  reserveDelivery: async ({ listingId, configuredAdapterId }) => ({
    reserved: true,
    state: 'sending',
    deliveryId: `${listingId}:${configuredAdapterId}`,
  }),
  finishDelivery: async () => 1,
  getDelivery: async () => null,
  getDeliveryById: async () => null,
}));

export const inquiryDeliveries = [];
let inquiryDeliveryError = null;
export function setInquiryDeliveryError(error) {
  inquiryDeliveryError = error;
}
vi.mock('../lib/services/inquiries/sendInquiry.js', () => ({
  supportsInquirySending: (providerId, listing) => {
    if (['deutscheWohnen', 'immoscout', 'kleinanzeigen'].includes(providerId)) return true;
    if (providerId !== 'inberlinwohnen' || listing == null) return providerId === 'inberlinwohnen';
    const host = new URL(listing.link).hostname.toLowerCase().replace(/^www\./, '');
    return ['howoge.de', 'wbm.de', 'stadtundland.de'].includes(host);
  },
  inquiryRequiresMessage: (providerId, listing) => !(providerId === 'inberlinwohnen' && listing != null),
}));
vi.mock('../lib/services/inquiries/deliverInquiry.js', () => ({
  deliverInquiry: async (params) => {
    inquiryDeliveries.push(params);
    if (inquiryDeliveryError) throw inquiryDeliveryError;
    params.listing.inquirySendStatus = 'sent';
    return { started: true, status: 'sent', requestId: 'request-test', sentAt: 1234 };
  },
}));

// Providers read server-rendered pages over plain HTTP. In offline mode the HTTP loader is swapped
// for the fixture reader: it answers "the page's HTML, or null", and the run name maps
// partner-domain detail pages back to their fixture.
vi.mock('../lib/services/extractor/httpExtractor.js', async (importOriginal) => {
  if (process.env.TEST_MODE !== 'offline') {
    return importOriginal();
  }
  const { readFixture } = await import('./offlineFixtures.js');
  const actual = await importOriginal();
  return { ...actual, default: (url, options) => readFixture(url, options) };
});

if (process.env.TEST_MODE === 'offline') {
  const { buildFetchMock } = await import('./offlineFixtures.js');
  vi.stubGlobal('fetch', buildFetchMock());
}

/**
 * The pipeline, with the detail-page enrichment capped at one listing.
 *
 * The cap used to live in the pipeline itself as `process.env.NODE_ENV === 'test'`. It belongs
 * here: a fixture run only needs to prove the enrichment path works once, and walking every
 * listing's detail page makes the provider suites slow (and, in live mode, rude).
 *
 * @returns {Promise<typeof import('../lib/FredyPipelineExecutioner.js').default>} A subclass that
 *   applies the cap, so the tests can keep constructing it with the production signature.
 */
export const mockFredy = async () => {
  const mod = await import('../lib/FredyPipelineExecutioner.js');
  const FredyPipelineExecutioner = mod.default;
  return class TestPipeline extends FredyPipelineExecutioner {
    constructor(providerConfig, job, providerId, similarityCache, options = {}) {
      const configured = Array.isArray(job?.notificationAdapter) ? job.notificationAdapter : [];
      const notificationAdapter = (configured.length > 0 ? configured : [{ id: 'test' }]).map((entry, index) => ({
        ...entry,
        configuredAdapterId: entry.configuredAdapterId || `test-channel-${index}`,
      }));
      super(providerConfig, { ...job, notificationAdapter }, providerId, similarityCache, {
        maxDetailFetches: 1,
        ...options,
      });
    }
  };
};
