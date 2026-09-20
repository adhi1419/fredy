/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPLICANT_PROFILE_ONBOARDING_PATH,
  isCommonApplicantProfileComplete,
  resolveApplicantProfileOnboarding,
} from '../../ui/src/services/onboarding/applicantProfileOnboarding.js';

const completeProfile = {
  name: 'Alice Example',
  street: 'Main Street',
  houseNumber: '1',
  postcode: '10115',
  city: 'Berlin',
  employer: 'Example GmbH',
  deutscheWohnenPrivacyAccepted: true,
};

describe('applicant profile onboarding decision seam', () => {
  it('keeps the route in loading while settings are unresolved', () => {
    expect(resolveApplicantProfileOnboarding({ settingsLoaded: false, profile: completeProfile })).toEqual({
      status: 'loading',
      requiresSetup: false,
      shouldRedirect: false,
      path: APPLICANT_PROFILE_ONBOARDING_PATH,
    });
  });

  it('does not mistake a settings load failure for an incomplete applicant profile', () => {
    expect(resolveApplicantProfileOnboarding({ settingsLoaded: true, settingsLoadFailed: true, profile: {} })).toEqual({
      status: 'load-failed',
      requiresSetup: false,
      shouldRedirect: false,
      path: APPLICANT_PROFILE_ONBOARDING_PATH,
    });
  });

  it('requires setup and redirects only from a normal authenticated route', () => {
    expect(
      resolveApplicantProfileOnboarding({ settingsLoaded: true, profile: {}, pathname: '/dashboard' }),
    ).toMatchObject({ status: 'incomplete', requiresSetup: true, shouldRedirect: true });
    expect(
      resolveApplicantProfileOnboarding({
        settingsLoaded: true,
        profile: {},
        pathname: APPLICANT_PROFILE_ONBOARDING_PATH,
      }),
    ).toMatchObject({ status: 'incomplete', requiresSetup: true, shouldRedirect: false });
  });

  it('treats complete common facts as complete without looping on the onboarding URL', () => {
    expect(
      resolveApplicantProfileOnboarding({
        settingsLoaded: true,
        profile: completeProfile,
        pathname: APPLICANT_PROFILE_ONBOARDING_PATH,
      }),
    ).toMatchObject({ status: 'complete', requiresSetup: false, shouldRedirect: false });
  });

  it('keeps a failed save on onboarding and does not redirect it away', () => {
    expect(
      resolveApplicantProfileOnboarding({
        settingsLoaded: true,
        profile: {},
        pathname: APPLICANT_PROFILE_ONBOARDING_PATH,
        saveError: new Error('rejected'),
      }),
    ).toMatchObject({ status: 'save-failed', requiresSetup: true, shouldRedirect: false });
  });

  it('does not require provider-specific facts or consent for common completion', () => {
    expect(isCommonApplicantProfileComplete(completeProfile)).toBe(true);
    expect(
      isCommonApplicantProfileComplete({ ...completeProfile, employer: '', deutscheWohnenPrivacyAccepted: false }),
    ).toBe(true);
  });
});

describe('authenticated app route contract', () => {
  const appSource = fs.readFileSync(path.resolve('ui/src/App.jsx'), 'utf8');

  it('leaves login outside the authenticated onboarding gate', () => {
    expect(appSource).toContain('<Route path="/login" element={<Login />} />');
    expect(appSource).toContain('needsLogin() ? (');
  });

  it('keeps onboarding out of primary navigation and redirects normal routes with return state', () => {
    expect(appSource).toContain('path={APPLICANT_PROFILE_ONBOARDING_PATH}');
    expect(appSource).toContain('onboardingDecision.requiresSetup');
    expect(appSource).toContain('state={{ from: location }}');
    expect(appSource).toContain('primaryVisible={!onboardingDecision.requiresSetup}');
  });
});
