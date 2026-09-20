/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFinanceEffects, createFinanceState } from '../../ui/src/services/state/financeState.js';

function setup() {
  const state = { finance: createFinanceState() };
  const get = vi.fn();
  const post = vi.fn();
  const set = (updater) => Object.assign(state, updater(state));
  const effects = createFinanceEffects(set, { get, post });
  return { state, get, post, effects };
}

describe('finance state domain', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with the exact aggregate finance state', () => {
    expect(createFinanceState()).toEqual({ data: null, loading: false, summary: null });
  });

  it('loads and maps the profile summary', async () => {
    const { state, get, effects } = setup();
    const summary = { anyComplete: true, thresholds: { buy: null, rent: null } };
    get.mockResolvedValue({ status: 200, json: summary });

    await expect(effects.getProfileSummary()).resolves.toBe(summary);

    expect(get).toHaveBeenCalledWith('/api/finance/profile-summary');
    expect(state.finance).toEqual({ data: null, loading: false, summary });
  });

  it('keeps calculate payloads and returns the server result', async () => {
    const { post, effects } = setup();
    const profile = { personA: { age: 35 }, financing: { purchasePrice: 300000 } };
    const result = { financing: { loanAmount: 250000 } };
    post.mockResolvedValue({ status: 200, json: result });

    await expect(effects.calculate(profile)).resolves.toBe(result);

    expect(post).toHaveBeenCalledWith('/api/finance/calculate', { profile });
  });

  it('suppresses calculate errors for incomplete and failed drafts', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const badRequest = { status: 400 };
    const serverError = { status: 500 };

    // Recreate each effect with a transport rejection so the public action behavior is tested.
    const incomplete = setup();
    incomplete.post.mockRejectedValueOnce(badRequest);
    await expect(incomplete.effects.calculate({})).resolves.toBeNull();

    const failed = setup();
    failed.post.mockRejectedValueOnce(serverError);
    await expect(failed.effects.calculate({})).resolves.toBeNull();

    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('returns listing finance and preserves null-on-error behavior', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { get, effects } = setup();
    const result = { result: { financing: { loanAmount: 200000 } } };
    get.mockResolvedValueOnce({ status: 200, json: result });

    await expect(effects.getListingFinance('listing-42')).resolves.toBe(result);
    expect(get).toHaveBeenCalledWith('/api/finance/listing/listing-42');

    get.mockRejectedValueOnce(new Error('offline'));
    await expect(effects.getListingFinance('listing-42')).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('maps affordability results and clears loading after success', async () => {
    const { state, post, effects } = setup();
    const payload = { profile: { personA: { age: 35 } }, filter: { jobId: 'job-1' } };
    const result = { items: [], skipped: { noPrice: 0, incompleteProfile: 0 } };
    let resolveRequest;
    post.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const request = effects.getAffordability(payload);
    expect(state.finance.loading).toBe(true);
    resolveRequest({ status: 200, json: result });
    await expect(request).resolves.toBe(result);

    expect(post).toHaveBeenCalledWith('/api/finance/affordability', payload);
    expect(state.finance).toEqual({ data: result, loading: false, summary: null });
  });

  it('clears loading and rethrows affordability failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { state, post, effects } = setup();
    const failure = new Error('offline');
    post.mockRejectedValue(failure);

    await expect(effects.getAffordability({ profile: {} })).rejects.toBe(failure);

    expect(state.finance).toEqual({ data: null, loading: false, summary: null });
    expect(consoleError).toHaveBeenCalledWith(
      'Error while trying to score listings for affordability. Error:',
      failure,
    );
  });
});
