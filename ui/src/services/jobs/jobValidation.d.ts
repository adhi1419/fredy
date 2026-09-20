/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

interface GuidedValidationJobInput {
  name?: unknown;
  dealType?: unknown;
  providerData?: readonly unknown[];
  selectedChannels?: readonly unknown[];
  [key: string]: unknown;
}

interface JobRequirement {
  key: string;
  isMet: (job: GuidedValidationJobInput) => boolean;
}

export function missingRequirements(job: GuidedValidationJobInput | null | undefined): JobRequirement[];
