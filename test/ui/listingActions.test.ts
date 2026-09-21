/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getAppliedMessage,
  getGoogleMapsUrl,
  getSafeExternalUrl,
  isListingApplied,
  LISTING_LIFECYCLE_ACTIONS,
  MOBILE_LISTING_ACTION_LABELS,
  MOBILE_LISTING_ACTION_ORDER,
} from '../../ui/src/views/listings/listingActions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const styles = fs.readFileSync(path.join(here, '../../ui/src/views/listings/ListingDetail.less'), 'utf8');
const listingDetailSource = fs.readFileSync(path.join(here, '../../ui/src/views/listings/ListingDetail.tsx'), 'utf8');
const listingsStateSource = fs.readFileSync(path.join(here, '../../ui/src/services/state/listingsState.ts'), 'utf8');
const segmentPartSource = fs.readFileSync(path.join(here, '../../ui/src/components/segment/SegmentPart.tsx'), 'utf8');
const segmentPartStyles = fs.readFileSync(path.join(here, '../../ui/src/components/segment/SegmentParts.less'), 'utf8');

describe('listing action contract', () => {
  it('keeps the approved mobile action order and accessible label keys', () => {
    expect(MOBILE_LISTING_ACTION_ORDER).toEqual(['apply', 'maps', 'provider']);
    expect(
      MOBILE_LISTING_ACTION_ORDER.map((action: 'apply' | 'maps' | 'provider') => MOBILE_LISTING_ACTION_LABELS[action]),
    ).toEqual(['listing.detail.mobile.apply', 'listing.detail.mobile.openMaps', 'listing.detail.mobile.openProvider']);
  });

  it('keeps icon targets inside their mobile grid columns', () => {
    expect(styles).toMatch(/&__mobile-icon-action\s*{[^}]*box-sizing:\s*border-box/s);
    expect(styles).toMatch(/&__mobile-icon-action\s*{[^}]*min-width:\s*44px/s);
  });

  it('maps visible lifecycle controls to the canonical API action vocabulary', () => {
    expect(LISTING_LIFECYCLE_ACTIONS).toEqual({
      appliedSelf: 'applied',
      viewing: 'viewing',
      archive: 'archive',
    });
    expect(listingsStateSource).toContain(
      "export type ListingLifecycleAction = 'applied' | 'viewing' | 'archive' | 'restore';",
    );
    expect(listingDetailSource).toContain('action: ListingLifecycleAction');
  });

  it('accepts only HTTP(S) provider URLs', () => {
    expect(getSafeExternalUrl('https://example.com/listing/1')).toBe('https://example.com/listing/1');
    expect(getSafeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(getSafeExternalUrl('not a URL')).toBeNull();
    expect(getSafeExternalUrl(null)).toBeNull();
  });

  it('prefers a valid address and falls back to finite coordinates for Maps', () => {
    expect(getGoogleMapsUrl({ address: 'Hauptstraße 1, Berlin', latitude: 52.5, longitude: 13.4 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Hauptstra%C3%9Fe%201%2C%20Berlin',
    );
    expect(getGoogleMapsUrl({ address: '', latitude: 52.5, longitude: 13.4 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=52.5%2C13.4',
    );
    expect(getGoogleMapsUrl({ address: '', latitude: null, longitude: null })).toBeNull();
  });

  it('recognizes provider-confirmed and manual Applied lifecycle state', () => {
    expect(isListingApplied({ lifecycle: { state: 'applied' } })).toBe(true);
    expect(isListingApplied({ inquiry_send_status: 'sent' })).toBe(true);
    expect(isListingApplied({ lifecycle: { state: 'viewed' }, inquiry_send_status: 'unknown' })).toBe(false);
  });

  it('discloses only the persisted submitted message', () => {
    expect(getAppliedMessage({ inquiry_message: '  Hallo Vermieter  ' })).toBe('Hallo Vermieter');
    expect(getAppliedMessage({ inquiry_message: '' })).toBeNull();
    expect(getAppliedMessage({ inquiry_message: null })).toBeNull();
  });
});

describe('accessibility action contracts', () => {
  it('uses the approved outbound icon for every detail provider action', () => {
    expect(listingDetailSource).toContain('IconExternalOpen');
    expect(listingDetailSource).not.toContain('IconLink');
    expect(listingDetailSource.match(/<IconExternalOpen/g)).toHaveLength(3);
    expect(listingDetailSource).toContain('href={providerListingUrl}');
    expect(listingDetailSource).toContain('href={providerListingUrl ?? undefined}');
    expect(listingDetailSource).toContain('target="_blank"');
    expect(listingDetailSource).toContain('rel="noopener noreferrer"');
    expect(listingDetailSource).toContain('aria-label={t(MOBILE_LISTING_ACTION_LABELS.provider)}');
    expect(listingDetailSource).toContain('aria-disabled={!providerListingUrl}');
    expect(listingDetailSource).toContain('if (!providerListingUrl) event.preventDefault();');
  });

  it('keeps the Applied disclosure submitted-message-only and nonmodal while managing focus', () => {
    expect(listingDetailSource).toContain('id={APPLIED_TRIGGER_ID}');
    expect(listingDetailSource).toContain('ref={appliedCloseButtonRef}');
    expect(listingDetailSource).toContain('appliedCloseButtonRef.current?.focus()');
    expect(listingDetailSource).toContain(
      'requestAnimationFrame(() => document.getElementById(APPLIED_TRIGGER_ID)?.focus())',
    );
    expect(listingDetailSource).toContain("event.key === 'Escape'");
    expect(listingDetailSource).toContain('closeAppliedPopover();');
    expect(listingDetailSource).toContain('role="dialog"');
    expect(listingDetailSource).toContain("aria-label={t('listing.detail.mobile.appliedMessageTitle')}");
    expect(listingDetailSource).not.toContain('aria-modal');
    expect(listingDetailSource).toContain('listingApplied && appliedPopoverOpen');
  });

  it('uses a semantic help button without changing the SegmentPart mark styling contract', () => {
    expect(segmentPartSource).toContain('<button type="button" className="segmentParts__helpMark"');
    expect(segmentPartSource).not.toContain('role="note"');
    expect(segmentPartStyles).toContain('padding: 0;');
    expect(segmentPartStyles).toContain('border: 0;');
    expect(segmentPartStyles).toContain('background: transparent;');
    expect(segmentPartStyles).toContain('cursor: help;');
  });

  it('keeps the fit-status pill a view of the one lifecycle (New/Applied/Viewed/Archived), never a second boolean', () => {
    // The photo-led fit status must render the shared lifecycle label and mark any non-new state
    // selected, so the pill, the heading pill, and the Home filter cannot drift apart.
    expect(listingDetailSource).toContain('listing-detail__fit-status--selected');
    expect(listingDetailSource).toContain("lifecycle !== 'new' ? ' listing-detail__fit-status--selected' : ''");
    expect(listingDetailSource).toMatch(/listing-detail__fit-status[\s\S]{0,160}\{lifecycleLabel\}/);
    // The old Applied/New-only ternary must not come back for the fit status.
    expect(listingDetailSource).not.toContain("{listingApplied ? t('home.activityApplied') : t('home.activityNew')}");
    // Travel stays the first fit metric and reads in the accent role; affordability is not primary.
    expect(styles).toContain('&__fit-metric-value--accent');
    expect(listingDetailSource).toContain('listing-detail__fit-metric-value--accent');
    expect(listingDetailSource).toContain('listing-detail__fit-metric--travel');
    expect(listingDetailSource).toContain('listing-detail__heading-description');
    expect(styles).toContain('&__fit-status--selected');
    expect(styles).toContain('color: @color-on-accent;');
    expect(styles).toContain('&__fit-metric--travel');
    const travel = listingDetailSource.indexOf('listing-detail__fit-metric--travel');
    const facts = listingDetailSource.indexOf('listing-detail__fit-metrics', travel + 1);
    // Lifecycle mutation controls no longer live in the Fit card (they belong once, in Your
    // Activity), so the Fit card runs travel -> facts with nothing between.
    expect(listingDetailSource).not.toContain('listing-detail__fit-lifecycle');
    expect(travel).toBeGreaterThan(0);
    expect(facts).toBeGreaterThan(travel);
  });
});
