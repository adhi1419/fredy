/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { hash, verify } from '../../lib/services/security/hash.js';

describe('password hashing (CWE-328)', () => {
  it('produces salted hashes: two hashes of the same password differ', async () => {
    const a = await hash('correcthorsebatterystaple');
    const b = await hash('correcthorsebatterystaple');
    expect(a).not.toEqual(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(b.startsWith('scrypt$')).toBe(true);
  });

  it('verify() accepts the correct password and rejects wrong ones', async () => {
    const stored = await hash('s3cret!');
    expect(await verify('s3cret!', stored)).toBe(true);
    expect(await verify('wrong', stored)).toBe(false);
    expect(await verify('', stored)).toBe(false);
  });

  it('verify() safely rejects malformed stored values', async () => {
    expect(await verify('x', null)).toBe(false);
    expect(await verify('x', '')).toBe(false);
    expect(await verify('x', 'scrypt$notenoughfields')).toBe(false);
    expect(await verify('x', 'scrypt$32768$8$1$zz$zz')).toBe(false);
  });
});
