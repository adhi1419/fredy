/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getNotificationAdapters, getProviders } from '../../lib/utils.js';
import { DEFAULT_COUNTRIES, normalizeCountries } from '../../lib/services/providers/countries.js';
import testProviderConfig from '../provider/testProvider.json';
import contract from './fixtures/plugin-contracts.json';

const root = resolve('.');
const utilsPath = `${root}/lib/utils.js`;
const loggerPath = `${root}/lib/services/logger.js`;

const providerProjection = (provider) => ({
  id: provider.metaInformation.id,
  name: provider.metaInformation.name,
  baseUrl: provider.metaInformation.baseUrl,
  countries: provider.metaInformation.countries,
  requiredFieldNames: provider.config.requiredFieldNames,
});

const adapterProjection = (adapter) => ({
  id: adapter.config.id,
  name: adapter.config.name,
  fields: Object.fromEntries(
    Object.entries(adapter.config.fields ?? {}).map(([key, definition]) => [
      key,
      {
        type: definition.type,
        optional: definition.optional === true,
        secret: definition.secret === true,
        target: definition.target === true,
      },
    ]),
  ),
});

/**
 * The static plugin contract is deliberately asserted against a JSON fixture. A Rust parity test
 * can consume the same file without loading Node modules or reproducing their directory layout.
 */
describe('Rust plugin parity contract', () => {
  it('freezes provider metadata and static configuration', async () => {
    const providers = (await getProviders()).sort((a, b) => a.metaInformation.id.localeCompare(b.metaInformation.id));
    expect(providers.map(providerProjection)).toEqual(contract.providers);

    for (const provider of providers) {
      const id = provider.metaInformation.id;
      expect(typeof provider.createConfig, `${id}.createConfig`).toBe('function');
      expect(provider.config.url, `${id}.config.url`).toBeNull();
      expect(provider.config.filter, `${id}.config.filter`).toBeUndefined();
      expect(typeof provider.config.normalize, `${id}.config.normalize`).toBe('function');

      const sourceConfig = { url: testProviderConfig[id].url, enabled: true };
      const first = provider.createConfig(sourceConfig, []);
      const second = provider.createConfig(sourceConfig, []);

      expect(first, `${id} config identity`).not.toBe(second);
      expect(first.url, `${id}.run.url`).toEqual(expect.any(String));
      expect(first.enabled, `${id}.run.enabled`).toBe(true);
      expect(typeof first.normalize, `${id}.run.normalize`).toBe('function');
      expect(typeof first.filter, `${id}.run.filter`).toBe('function');
      expect(first.filter, `${id} filter identity`).not.toBe(second.filter);
    }
  });

  it('freezes country defaults and normalization expectations', () => {
    expect(DEFAULT_COUNTRIES).toEqual(contract.countryDefaults.default);
    expect(normalizeCountries(undefined)).toEqual(contract.countryDefaults.default);
    expect(normalizeCountries([])).toEqual(contract.countryDefaults.default);
    expect(normalizeCountries(['DE', 'fr', 'de', 'not-a-country'])).toEqual(['de', 'fr']);
  });

  it('freezes every shipped adapter declaration and discovery shape', async () => {
    const adapters = (await getNotificationAdapters())
      .filter((adapter) => adapter.config?.id != null)
      .sort((a, b) => a.config.id.localeCompare(b.config.id));

    expect(adapters.map(adapterProjection)).toEqual(contract.notificationAdapters);
    for (const adapter of adapters) {
      expect(typeof adapter.send, `${adapter.config.id}.send`).toBe('function');
      expect(typeof adapter.sendPriceChange, `${adapter.config.id}.sendPriceChange`).toBe('function');
    }
  });

  it('freezes startup versus schedule-only task classification and cron expressions', () => {
    expect(contract.schedules).toHaveLength(7);
    expect(new Set(contract.schedules.map((task) => task.id)).size).toBe(contract.schedules.length);
    expect(contract.schedules.filter((task) => task.startup).map((task) => task.id)).toEqual([
      'active-checker',
      'geocoding',
      'listing-retention',
      'connectivity',
    ]);
    expect(contract.schedules.filter((task) => !task.startup).map((task) => task.id)).toEqual([
      'demo-cleanup',
      'price-tracking',
      'travel-time',
    ]);
    expect(contract.schedules.find((task) => task.id === 'demo-cleanup').condition).toBe('demoMode');
    for (const task of contract.schedules) {
      expect(task.cron, `${task.id}.cron`).toMatch(/^[^\n]+$/);
    }
  });
});

/**
 * Load the dispatcher with a controlled adapter. This checks the call contract without invoking a
 * network-backed shipped adapter; shipped discovery and declarative fields are tested above.
 *
 * @param {Object[]} adapters
 * @returns {Promise<any>}
 */
async function loadNotify(adapters) {
  vi.resetModules();
  vi.doMock(utilsPath, async (importOriginal) => ({
    ...(await importOriginal()),
    getNotificationAdapters: async () => adapters,
  }));
  vi.doMock(loggerPath, () => ({ default: { warn: vi.fn() } }));
  return import(`${root}/lib/notification/notify.js`);
}

describe('notification send call contract', () => {
  it('passes the frozen object payload to each configured adapter', async () => {
    const send = vi.fn(() => Promise.resolve());
    const adapter = { config: { id: 'contract-adapter' }, send };
    const newListings = [{ id: 'listing-1' }];
    const notificationConfig = [{ id: 'contract-adapter', fields: {} }];
    const notify = await loadNotify([adapter]);

    const promises = notify.send('immowelt', newListings, notificationConfig, 'job-1', 'https://fredy.example');
    await Promise.all(promises);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(Object.keys(payload)).toEqual(contract.sendCall.object);
    expect(payload).toEqual({
      serviceName: 'immowelt',
      newListings,
      notificationConfig,
      jobKey: 'job-1',
      baseUrl: 'https://fredy.example',
    });
  });
});
