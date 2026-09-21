/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/// <reference path="../../ui/src/views/jobs/savedSearchesLegacy.d.ts" />

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getAppliedMessage,
  getGoogleMapsUrl,
  getSafeExternalUrl,
  isListingApplied,
  MOBILE_LISTING_ACTION_LABELS,
  MOBILE_LISTING_ACTION_ORDER,
} from '../../ui/src/views/listings/listingActions.js';
import { sanitizeReturnTo } from '../../ui/src/services/routes/returnTo.js';
import { getInquirySendEligibility } from '../../ui/src/services/inquiries/profile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const source = fs.readFileSync(path.join(root, 'ui/src/views/listings/ListingDetail.tsx'), 'utf8');
const profileSource = fs.readFileSync(path.join(root, 'ui/src/services/inquiries/profile.ts'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'ui/src/views/listings/ListingDetail.less'), 'utf8');

const listing = {
  id: 'listing-1',
  address: 'Hauptstraße 1, Berlin',
  latitude: 52.5,
  longitude: 13.4,
  link: 'https://provider.example/listing-1',
};

const readyInquiry = {
  providerId: 'immoscout',
  listing,
  profile: {
    name: 'Ada Lovelace',
    street: 'Hauptstraße',
    houseNumber: '1',
    postcode: '10115',
    city: 'Berlin',
    immoscoutPrivacyAccepted: true,
  },
  message: 'Guten Tag, ich interessiere mich für dieses Inserat.',
};

describe('Listing Detail Slice 5', () => {
  it('preserves a safe Home return context and rejects external navigation', () => {
    const homeContext = '/dashboard?view=map&activity=applied&provider=immoscout';

    expect(sanitizeReturnTo(homeContext)).toBe(homeContext);
    expect(sanitizeReturnTo('https://evil.example/steal')).toBeNull();
    expect(source).toContain("const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));");
    expect(source).toContain('onClick={() => (returnTo ? navigate(returnTo) : navigate(-1))}');
  });

  it('keeps the provider URL policy and the diagonal external-link source action', () => {
    expect(getSafeExternalUrl(listing.link)).toBe(listing.link);
    expect(getSafeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(getGoogleMapsUrl(listing)).toContain('google.com/maps/search');
    expect(source).toContain('IconExternalOpen');
    expect(source).toContain('href={providerListingUrl}');
    expect(source).toContain('aria-label={t(MOBILE_LISTING_ACTION_LABELS.provider)}');
    expect(source).toContain('if (!providerListingUrl) event.preventDefault();');
  });

  it('keeps provider inquiry and unknown-outcome semantics explicit and non-retrying', () => {
    expect(isListingApplied({ lifecycle: { state: 'applied' } })).toBe(true);
    expect(isListingApplied({ inquiry_send_status: 'sent' })).toBe(true);
    expect(isListingApplied({ inquiry_send_status: 'unknown' })).toBe(false);
    expect(getAppliedMessage({ inquiry_message: ' submitted message ' })).toBe('submitted message');
    expect(getAppliedMessage({ inquiry_message: '' })).toBeNull();
    expect(source).toContain('isInquiryProviderSupported');
    expect(source).toContain('getInquirySendEligibility');
    expect(profileSource).toContain("const BLOCKED_INQUIRY_SEND_STATUSES = new Set(['sending', 'sent', 'unknown']);");
    expect(source).toContain("listing.inquiry_send_status === 'unknown'");
    expect(source).toContain("listing.inquiry_send_status === 'failed'");
    expect(source).toContain('getAppliedMessage(listing)');
  });

  it.each(['sending', 'sent', 'unknown', 'provider-error'])(
    'blocks persisted inquiry status %s from every send path',
    (status) => {
      const eligibility = getInquirySendEligibility({ ...readyInquiry, status });
      expect(eligibility.statusAllowsSend).toBe(false);
      expect(eligibility.canSend).toBe(false);
      expect(eligibility.canRetry).toBe(false);
    },
  );

  it('allows only the initial state and explicit failed state to send', () => {
    expect(getInquirySendEligibility(readyInquiry)).toMatchObject({
      statusAllowsSend: true,
      canRetry: false,
      canSend: true,
    });
    expect(getInquirySendEligibility({ ...readyInquiry, status: 'failed' })).toMatchObject({
      statusAllowsSend: true,
      canRetry: true,
      canSend: true,
    });
    expect(source).toContain('const applyNeedsConfirmation = inquiryEligibility.canSend;');
    expect(source).toContain(
      'disabled={\n                  !listingApplied && (!inquiryEligibility.providerSupported || !inquiryEligibility.statusAllowsSend)\n                }',
    );
    expect(source).toContain('inquiryEligibility.canSend ? (');
    expect(source).toContain('if (!eligibility.canSend || inquirySendInFlightRef.current) return;');
    expect(source).toContain('inquirySendInFlightRef.current = true;');
    expect(source).toContain('inquirySendInFlightRef.current = false;');
  });

  it('restores the accessible Add notes lifecycle action and mobile-only canonical Apply control', () => {
    expect(source).toContain("aria-label={t('listing.detail.mobile.addNotes')}");
    expect(source).toContain('onClick={focusNotes}');
    expect(styles).toMatch(/&__lifecycle-actions[\s\S]*\.semi-button[\s\S]*min-height:\s*44px/);
    expect(styles).toMatch(/&__rail-primary-action[\s\S]*display:\s*none/);
  });

  it('keeps the approved mobile action order, labels, containment, and touch targets', () => {
    expect(MOBILE_LISTING_ACTION_ORDER).toEqual(['apply', 'maps', 'provider']);
    expect(
      MOBILE_LISTING_ACTION_ORDER.map((action: 'apply' | 'maps' | 'provider') => MOBILE_LISTING_ACTION_LABELS[action]),
    ).toEqual(['listing.detail.mobile.apply', 'listing.detail.mobile.openMaps', 'listing.detail.mobile.openProvider']);
    expect(source).toContain('data-testid="listing-mobile-actions"');
    expect(styles).toMatch(/&__mobile-action-dock\s*{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 52px 52px;/);
    expect(styles).toMatch(/&__mobile-icon-action\s*{[\s\S]*min-width:\s*44px;/);
    expect(styles).toMatch(/&__mobile-apply,\s*&__mobile-icon-action\s*{[\s\S]*min-height:\s*44px;/);
  });

  it('places Back at the top right on mobile and holds lifecycle controls in Your Activity only', () => {
    // (9) Back navigation lives in the header actions and is pinned to the right of the header row
    // on a phone (the header becomes a flex row, actions justified to the flex-end).
    expect(source).toContain('className="listing-detail__heading-actions"');
    expect(source).toContain('<IconArrowLeft />');
    const mobile = styles.slice(styles.indexOf('@media (max-width: 768px)'));
    expect(mobile).toMatch(/&__heading\s*{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*space-between;/);
    expect(mobile).toMatch(/&__heading-actions\s*{[\s\S]*?justify-content:\s*flex-end;/);

    // The lifecycle mutation controls are removed from the Fit card entirely and belong once, below
    // the main details, inside "Your Activity" (listing-detail__lifecycle-actions).
    expect(source).not.toContain('listing-detail__fit-lifecycle');
    expect(styles).not.toContain('&__fit-lifecycle');
    expect(source).toContain('className="listing-detail__lifecycle-actions"');
    // The activity lifecycle group is the single home of the state-aware icons and Unarchive.
    const activityBlock = source.slice(source.indexOf('listing-detail__activity scrollspyTabs-section'));
    expect(activityBlock).toContain('listing-detail__lifecycle-actions');
    expect(activityBlock).toContain('handleUnarchive');
    // The fixed Apply/Maps/provider dock is untouched.
    expect(source).toContain('data-testid="listing-mobile-actions"');
    expect(source).toContain('listing-detail__mobile-action-dock');
  });

  it('renders the approved fit/evidence/activity/action-rail composition without legacy outer boundaries', () => {
    for (const marker of [
      'listing-detail__heading',
      'listing-detail__fit',
      'listing-detail__evidence',
      'listing-detail__activity',
      'listing-detail__action-rail',
      'listing-detail__rail-primary-action',
      'listing-detail__guard',
      'aria-labelledby="listing-fit-heading"',
      'aria-labelledby="listing-evidence-heading"',
      'aria-labelledby="listing-action-heading"',
    ]) {
      expect(source).toContain(marker);
    }
    expect(source).not.toContain('<Card className="listing-detail__card">');
    expect(source).not.toContain('<Headline');
    expect(source).not.toContain('<Row>');
    expect(source).not.toContain('<Col span={24} lg={12}>');
    expect(styles).toMatch(/&__lifecycle--selected,[\s\S]*background:\s*@color-accent-fill;/);
    expect(styles).toMatch(/&__fit-status\s*{[\s\S]*color:\s*@color-accent;/);
    expect(source).toContain("t('listing.detail.actionGuardTitle')");
  });

  it('keeps deep behavior sections inside evidence', () => {
    for (const marker of [
      'ListingFinanceCard',
      'PriceHistoryChart',
      'MapCanvas',
      'AddressEditor',
      'NearbyStops',
      'TravelTimes',
      'ConnectivityCard',
      'listing-detail__notes',
      'handleReactivate',
      'handleArchive',
      'routeMode',
      'startPinDrop',
    ]) {
      expect(source).toContain(marker);
    }
  });

  it('strips Watch, generic Status, and destructive Delete from the lifecycle surface', () => {
    // The user lifecycle surface keeps only the canonical set: Mark applied / Mark viewed / Archive.
    // Watch, the generic Status control, and the destructive Delete entry, their handlers, and the
    // deletion modal are all gone, so none remains reachable from Listing Detail.
    for (const removed of [
      'ListingDeletionModal',
      'StatusControl',
      'handleStatusChange',
      'handleWatch',
      'confirmDeletion',
      'deleteModalVisible',
      'setListingStatus',
      'IconDelete',
      'IconStarStroked',
      "t('listing.detail.delete')",
      "t('listing.detail.watch')",
      "xhrDelete('/api/listings/'",
      'statusLabel',
      "t('listing.detail.fieldStatus')",
      "t('listing.detail.fieldAffordability')",
    ]) {
      expect(source).not.toContain(removed);
    }
    // Archive stays a canonical lifecycle action, never a storage delete.
    expect(source).toContain(
      "handleLifecycleAction(LISTING_LIFECYCLE_ACTIONS.archive, 'listing.detail.mobile.archiveToast')",
    );
    expect(source).toContain("t('listing.detail.mobile.appliedSelf')");
    expect(source).toContain("t('listing.detail.mobile.viewing')");
    expect(source).toContain("t('listing.detail.mobile.archive')");
    // Submitted inquiry evidence and guarded unknown outcomes remain.
    expect(source).toContain('getAppliedMessage(listing)');
    expect(source).toContain("listing.inquiry_send_status === 'unknown'");
    expect(source).toContain("listing.inquiry_send_status === 'failed'");
  });
});
