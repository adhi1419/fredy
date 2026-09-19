/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { getProviders } from '../../lib/utils.js';
import {
  normalizeApplicationCapabilities,
  normalizeProviderMetaInformation,
  UNSUPPORTED_APPLICATION_CAPABILITIES,
} from '../../lib/services/providers/capabilities.js';
import providerPlugin from '../../lib/api/routes/providerRouter.js';

const expectedKeys = [
  'manual',
  'automatic',
  'eligibility',
  'validation',
  'profileRequirements',
  'consentRequirements',
  'connectionRequired',
];

describe('provider application capabilities', () => {
  it('uses a conservative unsupported shape for missing declarations', () => {
    expect(normalizeApplicationCapabilities()).toEqual(UNSUPPORTED_APPLICATION_CAPABILITIES);
    expect(normalizeProviderMetaInformation({ id: 'unknown' }).capabilities.application).toEqual(
      UNSUPPORTED_APPLICATION_CAPABILITIES,
    );
  });

  it('does not confuse opening a provider URL with Fredy application support', () => {
    const normalized = normalizeProviderMetaInformation({
      id: 'future-provider',
      name: 'Future Provider',
      baseUrl: 'https://example.test/',
      countries: ['de'],
      legacyField: 'preserved',
    });

    expect(normalized).toMatchObject({
      id: 'future-provider',
      name: 'Future Provider',
      baseUrl: 'https://example.test/',
      countries: ['de'],
      legacyField: 'preserved',
    });
    expect(normalized.capabilities.application).toEqual(UNSUPPORTED_APPLICATION_CAPABILITIES);
  });

  it('exposes normalized declarations for every loaded provider', async () => {
    const providers = await getProviders();

    expect(providers.length).toBeGreaterThan(0);
    for (const provider of providers) {
      const capability = provider.metaInformation.capabilities?.application;
      expect(Object.keys(capability), provider.metaInformation.id).toEqual(expectedKeys);
      expect(typeof capability.manual, provider.metaInformation.id).toBe('boolean');
      expect(typeof capability.automatic, provider.metaInformation.id).toBe('boolean');
      expect(['provider', 'local', 'none'], provider.metaInformation.id).toContain(capability.validation);
      expect(Array.isArray(capability.profileRequirements), provider.metaInformation.id).toBe(true);
      expect(Array.isArray(capability.consentRequirements), provider.metaInformation.id).toBe(true);
      expect(typeof capability.connectionRequired, provider.metaInformation.id).toBe('boolean');
    }
  });

  it('maps the existing application adapters without exposing form data', async () => {
    const providers = await getProviders();
    const byId = new Map(providers.map((provider) => [provider.metaInformation.id, provider.metaInformation]));

    expect(byId.get('immoscout').capabilities.application).toEqual({
      manual: true,
      automatic: true,
      eligibility: 'provider',
      validation: 'provider',
      profileRequirements: ['identity', 'contact', 'address', 'household', 'employment', 'income', 'move-in'],
      consentRequirements: ['provider-privacy'],
      connectionRequired: false,
    });
    expect(byId.get('deutscheWohnen').capabilities.application).toEqual({
      manual: true,
      automatic: true,
      eligibility: 'provider',
      validation: 'local',
      profileRequirements: ['identity', 'contact', 'income'],
      consentRequirements: ['provider-privacy'],
      connectionRequired: false,
    });
    expect(byId.get('inberlinwohnen').capabilities.application).toEqual({
      manual: true,
      automatic: true,
      eligibility: 'listing',
      validation: 'local',
      profileRequirements: ['identity'],
      consentRequirements: ['provider-application'],
      connectionRequired: false,
    });

    const serialized = JSON.stringify([...byId.values()]);
    expect(serialized).not.toMatch(/password|token|cookie|credential/i);
  });

  it('delivers the same additive capability metadata from the provider API', async () => {
    const app = Fastify();
    await app.register(providerPlugin, { prefix: '/api/jobs/provider' });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/jobs/provider' });
      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.length).toBeGreaterThan(0);
      expect(payload.find((provider) => provider.id === 'immoscout')).toMatchObject({
        id: 'immoscout',
        name: 'Immoscout',
        baseUrl: 'https://www.immobilienscout24.de/',
        capabilities: {
          application: {
            automatic: true,
            eligibility: 'provider',
            validation: 'provider',
            connectionRequired: false,
          },
        },
      });
      expect(payload.every((provider) => provider.capabilities?.application != null)).toBe(true);
    } finally {
      await app.close();
    }
  });
});
