/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { estimateProjectCost } from '../../../lib/services/monitoring/billingExport.js';

describe('billing export estimate', () => {
  it('extends observed MTD spend to now in the billing currency', () => {
    const estimate = estimateProjectCost(
      { status: 'available', amount: 5, currency: 'EUR', through: 2000 },
      1000,
      3000,
    );
    expect(estimate).toMatchObject({ status: 'estimated', amount: 10, currency: 'EUR' });
  });

  it('fails closed instead of inflating an estimate when billing data predates the month', () => {
    expect(
      estimateProjectCost({ status: 'available', amount: 5, currency: 'EUR', through: 999 }, 1000, 3000),
    ).toMatchObject({ status: 'unavailable', amount: null, currency: 'EUR' });
  });
});
