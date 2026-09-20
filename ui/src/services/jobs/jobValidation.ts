/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/** The fields inspected while deciding whether a guided job can be saved. */
export interface JobValidationInput {
  /** The user-visible saved-search name; runtime validation rejects non-strings. */
  name?: unknown;
  /** The selected transaction type; runtime validation accepts only `rent` or `buy`. */
  dealType?: unknown;
  /** Configured providers; only non-empty length is required by this boundary. */
  providerData?: readonly unknown[];
  /** Configured notification channels; only non-empty length is required by this boundary. */
  selectedChannels?: readonly unknown[];
}

/** Stable identifiers for the requirements, in guided-form order. */
export type JobRequirementKey = 'name' | 'dealType' | 'provider' | 'channel';

/** One independently reportable condition required before saving a job. */
export interface JobRequirement {
  key: JobRequirementKey;
  isMet: (job: JobValidationInput | null | undefined) => boolean;
}

/**
 * What a job needs before it can be saved.
 *
 * A list of named rules rather than one boolean expression: each rule stands on its own, is tested
 * on its own, and reads in the order the sections appear in the form. The form itself only asks
 * whether the list is empty - the Save button is disabled until it is, and says nothing about why.
 */
export const JOB_REQUIREMENTS: JobRequirement[] = [
  {
    key: 'name',
    // Trimmed: a name of three spaces used to satisfy this and be saved as a job with no visible
    // name at all.
    isMet: (job) => typeof job?.name === 'string' && job.name.trim().length > 0,
  },
  {
    key: 'dealType',
    isMet: (job) => job?.dealType === 'rent' || job?.dealType === 'buy',
  },
  {
    key: 'provider',
    isMet: (job) => (job?.providerData?.length ?? 0) > 0,
  },
  {
    key: 'channel',
    isMet: (job) => (job?.selectedChannels?.length ?? 0) > 0,
  },
];

/**
 * What is still missing from a job.
 *
 * @param job The guided job input, or nullish input before a form exists.
 * @returns Empty when the job is ready to save.
 */
export function missingRequirements(job: JobValidationInput | null | undefined): JobRequirement[] {
  return JOB_REQUIREMENTS.filter((requirement) => !requirement.isMet(job));
}

/** Whether a job can be saved. */
export function canSaveJob(job: JobValidationInput | null | undefined): boolean {
  return missingRequirements(job).length === 0;
}
