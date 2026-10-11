/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const source = fs.readFileSync('scripts/backfill-monitoring.js', 'utf8');

describe('Monitoring backfill command lifecycle', () => {
  it('initializes Firestore before writes and closes it afterwards', () => {
    const initialize = source.indexOf('await FirestoreConnection.init()');
    const write = source.indexOf('await mergeHistoricalHour(');
    const close = source.indexOf('await FirestoreConnection.close()');
    expect(initialize).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(initialize);
    expect(close).toBeGreaterThan(write);
  });
});
