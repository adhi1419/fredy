/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { auditDocuments, valueType } from '../../scripts/schema-audit.js';

describe('schema audit', () => {
  it('names value types the way Firestore stores them', () => {
    expect([null, [], {}, 1, 1.5, 'x', true].map(valueType)).toEqual([
      'null',
      'array',
      'map',
      'integer',
      'double',
      'string',
      'boolean',
    ]);
  });

  it('counts field types and flags fields missing from some documents', () => {
    const report = auditDocuments([{ a: 1, b: null }, { a: 'x' }]);
    expect(report.count).toBe(2);
    expect(report.fields.a).toEqual({ integer: 1, string: 1 });
    expect(report.partial).toEqual(['b']);
  });
});
