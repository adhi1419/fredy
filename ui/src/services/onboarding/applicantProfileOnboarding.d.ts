/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/* Copyright (c) 2026 by Christian Kellner. */

export const APPLICANT_PROFILE_ONBOARDING_PATH: '/onboarding/applicant-profile';
export const REQUIRED_COMMON_PROFILE_FIELDS: readonly string[];
export function getInvalidCommonApplicantProfileFields(profile?: Record<string, unknown> | null): string[];
export function isCommonApplicantProfileComplete(profile?: Record<string, unknown> | null): boolean;
export interface ApplicantProfileDecision {
  status: 'loading' | 'load-failed' | 'incomplete' | 'complete' | 'save-failed';
  requiresSetup: boolean;
  shouldRedirect: boolean;
  path: string;
}
export function resolveApplicantProfileOnboarding(input?: {
  settingsLoaded?: boolean;
  settingsLoadFailed?: boolean;
  profile?: unknown;
  pathname?: string;
  saveError?: unknown;
}): ApplicantProfileDecision;
