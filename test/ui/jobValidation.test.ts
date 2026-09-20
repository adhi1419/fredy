/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';

import { missingRequirements, canSaveJob } from '../../ui/src/services/jobs/jobValidation.js';
import type { JobRequirementKey, JobValidationInput } from '../../ui/src/services/jobs/jobValidation.js';

/** A job with everything filled in. */
const completeJob = (): JobValidationInput => ({
  name: 'Cologne 3-room',
  dealType: 'rent',
  providerData: [{ id: 'immoscout', url: 'https://www.immobilienscout24.de/Suche/de/koeln/wohnung-mieten' }],
  selectedChannels: [{ id: 'channel-1' }],
});

const missingRequirementCases: ReadonlyArray<[JobRequirementKey, keyof JobValidationInput]> = [
  ['name', 'name'],
  ['dealType', 'dealType'],
  ['provider', 'providerData'],
  ['channel', 'selectedChannels'],
];

const invalidDealTypes: readonly unknown[] = ['sell', '', null, 'RENT '];

describe('jobValidation', () => {
  it('lets a complete job through', () => {
    expect(missingRequirements(completeJob())).toEqual([]);
    expect(canSaveJob(completeJob())).toBe(true);
  });

  it.each(missingRequirementCases)('reports a missing %s by name', (key, field) => {
    const job: JobValidationInput = { ...completeJob(), [field]: undefined };

    expect(canSaveJob(job)).toBe(false);
    expect(missingRequirements(job).map((requirement) => requirement.key)).toEqual([key]);
  });

  it('reports every gap at once rather than one at a time', () => {
    expect(missingRequirements({}).map((requirement) => requirement.key)).toEqual([
      'name',
      'dealType',
      'provider',
      'channel',
    ]);
  });

  it('reports empty provider and channel lists as missing', () => {
    const job = { ...completeJob(), providerData: [], selectedChannels: [] };

    expect(canSaveJob(job)).toBe(false);
    expect(missingRequirements(job).map((requirement) => requirement.key)).toEqual(['provider', 'channel']);
  });

  it('does not accept a name made of whitespace', () => {
    // This used to enable Save and produce a job with no visible name.
    const job = { ...completeJob(), name: '   ' };
    expect(canSaveJob(job)).toBe(false);
    expect(missingRequirements(job)[0].key).toBe('name');
  });

  it.each(invalidDealTypes)('does not accept %s as a deal type', (dealType) => {
    expect(canSaveJob({ ...completeJob(), dealType })).toBe(false);
  });

  it('survives being handed nothing', () => {
    expect(canSaveJob(null)).toBe(false);
    expect(canSaveJob(undefined)).toBe(false);
  });
});
