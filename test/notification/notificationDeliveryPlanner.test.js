/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import {
  resolveChannels,
  planDeliveryTargets,
  planDeliveryByListing,
  isListingNotificationComplete,
} from '../../lib/notification/notificationDeliveryPlanner.js';
import {
  deliveryDocId,
  INITIAL_LISTING_NOTIFICATION_EVENT_KEY,
} from '../../lib/services/storage/firestore/collections.js';

const channel = (configuredAdapterId, adapterId) => ({ id: adapterId, configuredAdapterId, name: 'n', fields: {} });

describe('notificationDeliveryPlanner', () => {
  describe('resolveChannels', () => {
    it('keeps only entries with both a configuredAdapterId and an adapterId', () => {
      const resolved = resolveChannels([
        channel('c1', 'telegram'),
        { id: 'slack' }, // no configuredAdapterId
        { configuredAdapterId: 'c2' }, // no adapterId
        null,
      ]);
      expect(resolved).toEqual([{ configuredAdapterId: 'c1', adapterId: 'telegram' }]);
    });

    it('collapses duplicate references to the same channel', () => {
      const resolved = resolveChannels([channel('c1', 'telegram'), channel('c1', 'telegram')]);
      expect(resolved).toHaveLength(1);
    });

    it('keeps two channels that share an adapter type distinct', () => {
      const resolved = resolveChannels([channel('c1', 'telegram'), channel('c2', 'telegram')]);
      expect(resolved).toEqual([
        { configuredAdapterId: 'c1', adapterId: 'telegram' },
        { configuredAdapterId: 'c2', adapterId: 'telegram' },
      ]);
    });

    it('returns [] for non-arrays', () => {
      expect(resolveChannels(null)).toEqual([]);
      expect(resolveChannels(undefined)).toEqual([]);
    });
  });

  describe('planDeliveryTargets', () => {
    it('produces one target per (listing, channel) with a deterministic delivery id', () => {
      const targets = planDeliveryTargets(
        [{ id: 'L1' }, { id: 'L2' }],
        [channel('c1', 'telegram'), channel('c2', 'slack')],
      );
      expect(targets).toHaveLength(4);
      const t = targets.find((x) => x.listingId === 'L1' && x.configuredAdapterId === 'c1');
      expect(t.deliveryId).toBe(deliveryDocId('L1', 'c1', INITIAL_LISTING_NOTIFICATION_EVENT_KEY));
      expect(t.eventKey).toBe(INITIAL_LISTING_NOTIFICATION_EVENT_KEY);
      expect(t.adapterId).toBe('telegram');
    });

    it('is deterministic: same inputs yield the same ids', () => {
      const a = planDeliveryTargets([{ id: 'L1' }], [channel('c1', 'telegram')]);
      const b = planDeliveryTargets([{ id: 'L1' }], [channel('c1', 'telegram')]);
      expect(a[0].deliveryId).toBe(b[0].deliveryId);
    });

    it('returns [] when there are no channels (no targets, no completion later)', () => {
      expect(planDeliveryTargets([{ id: 'L1' }], [])).toEqual([]);
    });

    it('returns [] when there are no listings', () => {
      expect(planDeliveryTargets([], [channel('c1', 'telegram')])).toEqual([]);
    });

    it('honours a custom event key so a future event partitions cleanly', () => {
      const [t] = planDeliveryTargets([{ id: 'L1' }], [channel('c1', 'telegram')], 'price-change-v1');
      expect(t.deliveryId).toBe(deliveryDocId('L1', 'c1', 'price-change-v1'));
      expect(t.deliveryId).not.toBe(deliveryDocId('L1', 'c1', INITIAL_LISTING_NOTIFICATION_EVENT_KEY));
    });

    it('attaches the sorted intended-channel snapshot to every target', () => {
      const targets = planDeliveryTargets([{ id: 'L1' }], [channel('c2', 'slack'), channel('c1', 'telegram')]);
      for (const t of targets) {
        expect(t.intendedConfiguredAdapterIds).toEqual(['c1', 'c2']);
        expect(t.intendedChannelCount).toBe(2);
      }
    });
  });

  describe('planDeliveryByListing', () => {
    it('groups targets per listing with a shared sorted intended set', () => {
      const groups = planDeliveryByListing(
        [{ id: 'L1' }, { id: 'L2' }],
        [channel('c2', 'slack'), channel('c1', 'telegram')],
      );
      expect(groups).toHaveLength(2);
      for (const g of groups) {
        expect(g.intendedConfiguredAdapterIds).toEqual(['c1', 'c2']);
        expect(g.intendedChannelCount).toBe(2);
        expect(g.targets).toHaveLength(2);
        expect(g.targets.every((t) => t.listingId === g.listingId)).toBe(true);
      }
    });

    it('flat planDeliveryTargets equals the flattened grouped targets', () => {
      const listings = [{ id: 'L1' }, { id: 'L2' }];
      const config = [channel('c1', 'telegram'), channel('c2', 'slack')];
      const flat = planDeliveryTargets(listings, config).map((t) => t.deliveryId);
      const grouped = planDeliveryByListing(listings, config)
        .flatMap((g) => g.targets)
        .map((t) => t.deliveryId);
      expect(flat).toEqual(grouped);
    });

    it('returns [] for no channels or no listings', () => {
      expect(planDeliveryByListing([{ id: 'L1' }], [])).toEqual([]);
      expect(planDeliveryByListing([], [channel('c1', 'telegram')])).toEqual([]);
    });
  });

  describe('isListingNotificationComplete', () => {
    it('is true only when every intended channel is sent', () => {
      expect(isListingNotificationComplete(2, 2)).toBe(true);
      expect(isListingNotificationComplete(2, 1)).toBe(false);
      expect(isListingNotificationComplete(3, 3)).toBe(true);
    });

    it('never claims completion for a listing with no targets', () => {
      expect(isListingNotificationComplete(0, 0)).toBe(false);
    });

    it('rejects malformed counts', () => {
      expect(isListingNotificationComplete(NaN, 1)).toBe(false);
      expect(isListingNotificationComplete(1, NaN)).toBe(false);
      expect(isListingNotificationComplete(-1, 0)).toBe(false);
    });
  });
});
