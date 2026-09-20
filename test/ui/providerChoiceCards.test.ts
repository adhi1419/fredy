/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildGuidedJobPayload,
  resolveProviderSource,
  setSourceAutomaticPolicy,
  sourcePolicyControl,
  type GuidedProviderSource,
  type ProviderMetadata,
} from '../../ui/src/services/jobs/guidedSearchForm.js';
import { getSafeProviderUrl, validateProviderUrl } from '../../ui/src/services/jobs/providerUrl.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cardsSource = fs.readFileSync(
  path.join(root, 'ui/src/views/jobs/mutation/components/provider/ProviderChoiceCards.tsx'),
  'utf8',
);
const formSource = fs.readFileSync(path.join(root, 'ui/src/views/jobs/mutation/GuidedJobForm.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'ui/src/views/jobs/mutation/GuidedJobForm.less'), 'utf8');
const mutatorSource = fs.readFileSync(
  path.join(root, 'ui/src/views/jobs/mutation/components/provider/ProviderMutator.jsx'),
  'utf8',
);

const metadata: ProviderMetadata[] = [
  {
    id: 'immoscout',
    name: 'ImmoScout24',
    baseUrl: 'https://www.immobilienscout24.de/',
    countries: ['de'],
    capabilities: { application: { automatic: true, eligibility: 'provider', connectionRequired: false } },
  },
  {
    id: 'connected',
    name: 'Connected provider',
    countries: ['at'],
    capabilities: { application: { automatic: true, eligibility: 'provider', connectionRequired: true } },
  },
];

const sources: GuidedProviderSource[] = [
  { id: 'immoscout', name: 'ImmoScout24', url: 'https://www.immobilienscout24.de/Suche/berlin', enabled: true },
  { id: 'connected', name: 'Connected provider', url: 'https://connected.example/search', enabled: true },
];

describe('provider choice cards', () => {
  it('replaces the table boundary while preserving the guided four-step controller', () => {
    expect(fs.existsSync(path.join(root, 'ui/src/components/table/ProviderTable.jsx'))).toBe(false);
    expect(formSource).toContain("import ProviderChoiceCards from './components/provider/ProviderChoiceCards';");
    expect(formSource).toContain('<ProviderChoiceCards');
    expect(formSource).toContain('GUIDED_STEPS.length - 1');
    expect(formSource).toContain('onStepSelect');
  });

  it('renders source identity, entered URL, capability, readiness, and source-local policy controls', () => {
    for (const marker of [
      'labelWithFlags',
      'mergeProviderCapability',
      'displaySource.url',
      'providerChoiceCards__countryCode',
      'policy.capability.automatic',
      'policy.capability.connectionRequired',
      "policy.reason === 'unsupported'",
      'policyUnsupportedStatus',
      'policyProfileReady',
      'onPolicyChange',
      'onEdit',
      'onRemove',
      'onCompleteProfile',
      'policyToggle',
    ]) {
      expect(cardsSource).toContain(marker);
    }
  });

  it('renders only validated provider hrefs and localized country labels', () => {
    expect(cardsSource).toContain('getSafeProviderUrl(displaySource.url, provider)');
    expect(cardsSource).toContain('href={safeProviderUrl}');
    expect(cardsSource).not.toContain('href={displaySource.url}');
    expect(cardsSource).toContain("t('jobs.mutation.providerCountries'");
    expect(cardsSource).not.toContain('aria-label={`Countries: ${countryCodes}`}');
    expect(getSafeProviderUrl('javascript://www.immobilienscout24.de/Suche/de/berlin', metadata[0])).toBeNull();
    expect(getSafeProviderUrl('https://www.immobilienscout24.de.evil.example/Suche/de/berlin', metadata[0])).toBeNull();
  });

  it('keeps policy changes independent per source and preserves payload parity', () => {
    const enabled = setSourceAutomaticPolicy(sources[0], metadata, true);
    const connected = setSourceAutomaticPolicy(sources[1], metadata, true);
    expect(enabled.applicationPolicy).toEqual({ automatic: 'enabled' });
    expect(connected).toEqual(sources[1]);

    const payload = buildGuidedJobPayload({
      providerData: [enabled, sources[1]],
      selectedChannels: [{ id: 'channel-1' }],
      name: 'Berlin homes',
      dealType: 'rent',
    });
    expect(payload.provider).toEqual([
      expect.objectContaining({ id: 'immoscout', applicationPolicy: { automatic: 'enabled' } }),
      expect.objectContaining({ id: 'connected', applicationPolicy: { automatic: 'disabled' } }),
    ]);
    expect(payload).not.toHaveProperty('autoSendInquiry');
  });

  it('resolves URL-only ImmoScout cards and canonicalizes their save payload', () => {
    const legacy = { url: 'https://www.immobilienscout24.de/Suche/de/berlin/wohnung-mieten' };
    const resolved = resolveProviderSource(legacy, metadata);
    const payload = buildGuidedJobPayload({ providerData: [legacy], providerMetadata: metadata });

    expect(resolved.source).toMatchObject({ id: 'immoscout', name: 'ImmoScout24' });
    expect(resolved.provider).toMatchObject({ countries: ['de'] });
    expect(resolved.capability.automatic).toBe(true);
    expect(payload.provider[0]).toMatchObject({ id: 'immoscout', url: legacy.url });
    expect(mutatorSource).toContain('resolveProviderSource(providerToEdit, provider)');
  });

  it('fails closed for connection and profile readiness states', () => {
    expect(sourcePolicyControl(sources[1], metadata)).toMatchObject({
      canEnable: false,
      disabled: true,
      reason: 'connection',
    });
    expect(sourcePolicyControl(sources[0], metadata, { profileReady: false })).toMatchObject({
      canEnable: false,
      disabled: true,
      reason: 'profile',
    });
  });

  it('preserves provider selection, URL validation, removal, and edit hydration seams', () => {
    expect(mutatorSource).toContain('setSelectedProvider(provider.find((pro) => pro.id === value))');
    expect(mutatorSource).toContain('validateProviderUrl(providerUrl, selectedProvider)');
    expect(mutatorSource).toContain('applicationPolicy: providerToEdit.applicationPolicy');
    expect(cardsSource).toContain('onRemove(displaySource.url)');
    expect(formSource).toContain('onProviderRemove');
    expect(
      validateProviderUrl('https://www.immobilienscout24.de/Suche/berlin', {
        baseUrl: 'https://www.immobilienscout24.de',
      }),
    ).toMatchObject({
      ok: true,
    });
    expect(
      validateProviderUrl('https://www.immobilienscout24.de', { baseUrl: 'https://www.immobilienscout24.de' }),
    ).toMatchObject({
      ok: false,
      problem: 'bareHost',
    });
  });

  it('keeps card actions and policy controls at keyboard-sized mobile targets', () => {
    expect(cardsSource).toContain("t('common.edit')");
    expect(cardsSource).toContain("t('common.delete')");
    expect(styles).toMatch(/providerChoiceCards__actions[\s\S]*min-height: 44px;/);
    expect(styles).toMatch(/providerChoiceCards__policyControl[\s\S]*min-height: 44px;/);
    expect(styles).toMatch(/@media \(max-width: 850px\)[\s\S]*providerChoiceCards__details/);
  });
});
