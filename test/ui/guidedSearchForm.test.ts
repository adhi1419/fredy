/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { transform } from '../../ui/src/services/transformer/providerTransformer.js';
import {
  GUIDED_STEPS,
  buildGuidedJobPayload,
  canMoveToGuidedStep,
  canonicalGuidedProviderSource,
  firstBlockedGuidedStep,
  mergeProviderCapability,
  migrateLegacyDraftProviderPolicies,
  missingGuidedRequirements,
  setSourceAutomaticPolicy,
  sourcePolicyControl,
  resolveProviderSource,
  type ApplicationPolicy,
  type GuidedJobPayloadInput,
  type GuidedProviderSource,
  type ProviderMetadata,
} from '../../ui/src/services/jobs/guidedSearchForm.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const guidedStyles = fs.readFileSync(path.join(here, '../../ui/src/views/jobs/mutation/GuidedJobForm.less'), 'utf8');

const metadata: ProviderMetadata[] = [
  {
    id: 'supported',
    name: 'Supported',
    capabilities: { application: { automatic: true, eligibility: 'provider', connectionRequired: false } },
  },
  {
    id: 'listing-scoped',
    name: 'Listing scoped',
    capabilities: { application: { automatic: true, eligibility: 'listing', connectionRequired: false } },
  },
  {
    id: 'connected',
    name: 'Connected',
    capabilities: { application: { automatic: true, eligibility: 'provider', connectionRequired: true } },
  },
  {
    id: 'unsupported',
    name: 'Unsupported',
    capabilities: { application: { automatic: false, eligibility: 'none', connectionRequired: false } },
  },
];

const complete: GuidedJobPayloadInput = {
  name: 'Berlin homes',
  dealType: 'rent',
  providerData: [{ id: 'supported', url: 'https://supported.example/search' }],
  selectedChannels: [{ id: 'channel-1' }],
};

const source = (id: string, applicationPolicy?: ApplicationPolicy): GuidedProviderSource => ({
  id,
  name: id,
  url: `https://${id}.example/search`,
  enabled: true,
  ...(applicationPolicy ? { applicationPolicy } : {}),
});

describe('guidedSearchForm', () => {
  it('defines exactly the approved four steps in order', () => {
    expect(GUIDED_STEPS.map(({ label }) => label)).toEqual([
      'Providers',
      'Home criteria',
      'Real-world fit',
      'Delivery/review',
    ]);
  });

  it('keeps the mobile progress ribbon sticky and carries the persistent step actions', () => {
    expect(guidedStyles).toMatch(/guidedJobForm__mobileProgress\s*{[^}]*position:\s*sticky/s);
    // Req 12: the redundant bottom footer is hidden on mobile; the sticky ribbon owns the controls.
    expect(guidedStyles).toMatch(/@media \(max-width: 850px\)[\s\S]*guidedJobForm__footer\s*{[^}]*display:\s*none/s);
    expect(guidedStyles).not.toMatch(/guidedJobForm__footer\s*{[^}]*position:\s*static/s);
    expect(guidedStyles).not.toMatch(/guidedJobForm__footer\s*{[^}]*bottom:\s*calc\(64px/s);
    // The persistent actions cluster stays a 44px-tappable target inside the ribbon.
    expect(guidedStyles).toMatch(/guidedJobForm__mobileActions\s*{[^}]*min-height:\s*44px/s);
    expect(guidedStyles).toMatch(/guidedJobForm__panel\s*{[^}]*scroll-margin-top:/s);
    expect(guidedStyles).toMatch(/jobMutation__notificationActions\s*{[^}]*grid-template-columns:\s*1fr/s);
  });

  it('blocks forward navigation on the first incomplete requirement', () => {
    expect(firstBlockedGuidedStep({}, 3)).toBe(0);
    expect(missingGuidedRequirements(0, {}).map(({ key }) => key)).toEqual(['name', 'provider']);
    expect(firstBlockedGuidedStep({ name: 'Homes', providerData: [{ id: 'supported' }] }, 3)).toBe(1);
    expect(firstBlockedGuidedStep({ ...complete, dealType: 'rent' }, 3)).toBe(null);
    expect(canMoveToGuidedStep(0, 1, { name: 'Homes', providerData: [{ id: 'supported' }] })).toBe(false);
    expect(canMoveToGuidedStep(2, 1, {})).toBe(true);
  });

  it('merges metadata only for the display view', () => {
    const merged = mergeProviderCapability(source('supported'), metadata);
    expect(merged.provider).toMatchObject({ id: 'supported', name: 'Supported' });
    expect(merged.capability.automatic).toBe(true);
    expect(merged.source).not.toHaveProperty('capabilities');
  });

  it('rejects unsafe URL-only identity before display hydration and canonicalization', () => {
    const immoscoutMetadata: ProviderMetadata[] = [
      { id: 'immoscout', name: 'Immoscout', baseUrl: 'https://www.immobilienscout24.de/' },
    ];
    const unsafeSources = [
      { url: 'javascript://www.immobilienscout24.de/Suche/de/berlin' },
      { url: 'ftp://www.immobilienscout24.de/Suche/de/berlin' },
      { url: 'https://user:password@www.immobilienscout24.de/Suche/de/berlin' },
      { url: 'https://www.immobilienscout24.de.evil.example/Suche/de/berlin' },
      { id: 'immoscout', url: 'javascript://www.immobilienscout24.de/Suche/de/berlin' },
    ];

    for (const source of unsafeSources) {
      expect(resolveProviderSource(source, immoscoutMetadata).provider).toBeNull();
      expect(() => canonicalGuidedProviderSource(source, immoscoutMetadata)).toThrow();
    }
  });

  it('resolves a URL-only ImmoScout source for display, edit hydration, and save payloads', () => {
    const legacy = {
      url: 'https://www.immobilienscout24.de/Suche/de/berlin/wohnung-mieten',
      applicationPolicy: { automatic: 'enabled' as const },
    };
    const immoscoutMetadata: ProviderMetadata[] = [
      {
        id: 'immoscout',
        name: 'Immoscout',
        baseUrl: 'https://www.immobilienscout24.de/',
        countries: ['de'],
        capabilities: { application: { automatic: true, eligibility: 'provider' } },
      },
    ];

    const resolved = resolveProviderSource(legacy, immoscoutMetadata);
    expect(resolved.source).toMatchObject({ id: 'immoscout', name: 'Immoscout', url: legacy.url });
    expect(resolved.provider).toMatchObject({ id: 'immoscout', countries: ['de'] });
    expect(resolved.capability.automatic).toBe(true);

    const payload = buildGuidedJobPayload({ providerData: [legacy], providerMetadata: immoscoutMetadata });
    expect(payload.provider[0]).toMatchObject({ id: 'immoscout', name: 'Immoscout', url: legacy.url });
  });

  it('allows supported provider policy and keeps listing-scoped eligibility visible', () => {
    const supported = sourcePolicyControl(source('supported'), metadata);
    expect(supported).toMatchObject({ enabled: false, canEnable: true, disabled: false, reason: null });

    const listing = sourcePolicyControl(source('listing-scoped'), metadata);
    expect(listing).toMatchObject({ canEnable: true, reason: 'listing' });

    const enabled = setSourceAutomaticPolicy(source('supported'), metadata, true);
    expect(enabled.applicationPolicy).toEqual({ automatic: 'enabled' });
  });

  it('fails closed for unsupported, connection-required, and incomplete-profile sources', () => {
    expect(sourcePolicyControl(source('unsupported'), metadata)).toMatchObject({
      canEnable: false,
      disabled: true,
      reason: 'unsupported',
    });
    expect(setSourceAutomaticPolicy(source('unsupported'), metadata, true)).toEqual(source('unsupported'));

    expect(sourcePolicyControl(source('connected'), metadata)).toMatchObject({
      canEnable: false,
      disabled: true,
      reason: 'connection',
    });
    expect(sourcePolicyControl(source('supported'), metadata, { profileReady: false })).toMatchObject({
      canEnable: false,
      disabled: true,
      reason: 'profile',
    });
  });

  it('migrates legacy draft intent only onto capable sources without overriding explicit policies', () => {
    expect(
      migrateLegacyDraftProviderPolicies(
        [
          source('supported'),
          source('unsupported'),
          source('listing-scoped'),
          source('supported', { automatic: 'disabled' }),
        ],
        true,
        metadata,
      ).map((provider) => provider.applicationPolicy),
    ).toEqual([
      { automatic: 'enabled' },
      { automatic: 'disabled' },
      { automatic: 'enabled' },
      { automatic: 'disabled' },
    ]);
  });

  it('canonicalizes source state without credentials or capability metadata', () => {
    expect(
      canonicalGuidedProviderSource({
        ...source('supported'),
        applicationPolicy: { automatic: 'enabled', token: 'secret' },
        capabilities: metadata[0].capabilities,
        credentials: { password: 'secret' },
      }),
    ).toEqual({
      id: 'supported',
      name: 'supported',
      url: 'https://supported.example/search',
      enabled: true,
      applicationPolicy: { automatic: 'enabled' },
    });
    expect(canonicalGuidedProviderSource(source('unsupported'))).toMatchObject({
      applicationPolicy: { automatic: 'disabled' },
    });
  });

  it('builds a guided payload with independent policies and no legacy override field', () => {
    const payload = buildGuidedJobPayload({
      ...complete,
      providerData: [source('supported', { automatic: 'enabled' }), source('listing-scoped')],
      selectedChannels: [{ id: 'channel-1' }],
      autoSendInquiry: true,
    });

    expect(payload.provider).toEqual([
      expect.objectContaining({ id: 'supported', applicationPolicy: { automatic: 'enabled' } }),
      expect.objectContaining({ id: 'listing-scoped', applicationPolicy: { automatic: 'disabled' } }),
    ]);
    expect(payload).not.toHaveProperty('autoSendInquiry');
    expect(payload.notificationAdapter).toEqual([{ configuredAdapterId: 'channel-1' }]);
  });

  it('retains source policy when the provider URL edit is transformed', () => {
    expect(
      transform({
        id: 'supported',
        name: 'Supported',
        enabled: true,
        url: 'https://supported.example/changed-search',
        applicationPolicy: { automatic: 'enabled' },
      }),
    ).toEqual({
      id: 'supported',
      name: 'Supported',
      enabled: true,
      url: 'https://supported.example/changed-search',
      applicationPolicy: { automatic: 'enabled' },
    });
  });
});
